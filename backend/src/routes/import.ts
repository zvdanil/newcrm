import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { getFamilyDebts, computeWaterfall } from '../services/waterfallService.js'
import { createTransaction } from '../services/balanceService.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BankRow {
  row_index: number
  date: string              // YYYY-MM-DD
  counterparty_name: string
  edrpou: string | null
  iban: string | null
  amount: number
  description: string
}

interface CandidateFamily {
  family_id: string
  family_name: string
  parent_name: string
}

export interface PreviewRow extends BankRow {
  status: 'matched' | 'conflict' | 'unmatched' | 'duplicate'
  match_method: 'edrpou' | 'iban' | 'name_fuzzy' | null
  matched_family_id: string | null
  matched_family_name: string | null
  matched_parent_name: string | null
  candidate_families: CandidateFamily[]
  bank_ref: string
  is_duplicate: boolean
  duplicate_tx_id: string | null
}

interface ApplyRow {
  row_index: number
  date: string
  amount: number
  family_id: string
  bank_ref: string
  counterparty_name: string
  edrpou: string | null
  note?: string
  force?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\n\r]/g, ' ')
    .replace(/[.,\-'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 2)
}

function containsAllTokens(haystack: string, needleTokens: string[]): boolean {
  if (needleTokens.length === 0) return false
  const h = normalize(haystack)
  return needleTokens.every((t) => h.includes(t))
}

function makeBankRef(row: BankRow): string {
  const key = row.edrpou ?? normalize(row.counterparty_name)
  return `${row.date}|${row.amount.toFixed(2)}|${key}`
}

// ─── Matching ─────────────────────────────────────────────────────────────────

interface MatchResult {
  method: 'edrpou' | 'iban' | 'name_fuzzy' | null
  families: CandidateFamily[]
}

async function matchRow(
  row: BankRow,
  allParents: { id: string; full_name: string; note: string | null; edrpou: string | null; iban: string | null }[],
  parentFamilies: Map<string, CandidateFamily[]>,
  allChildren: { id: string; full_name: string; note: string | null; family_id: string | null }[],
  childFamilies: Map<string, { family_id: string; family_name: string }>,
): Promise<MatchResult> {

  // 1. ЄДРПОУ match
  if (row.edrpou) {
    const matched = allParents.filter((p) => p.edrpou === row.edrpou)
    if (matched.length > 0) {
      const families = deduplicateFamilies(matched.flatMap((p) => parentFamilies.get(p.id) ?? []))
      if (families.length > 0) return { method: 'edrpou', families }
    }
  }

  // 2. IBAN match
  if (row.iban) {
    const matched = allParents.filter((p) => p.iban === row.iban)
    if (matched.length > 0) {
      const families = deduplicateFamilies(matched.flatMap((p) => parentFamilies.get(p.id) ?? []))
      if (families.length > 0) return { method: 'iban', families }
    }
  }

  // 3. Fuzzy name match across all searchable fields
  const needle = tokens(row.counterparty_name)
  if (needle.length === 0) return { method: null, families: [] }

  const matchedFamilyIds = new Set<string>()
  const candidates: CandidateFamily[] = []

  // Check parents (full_name + note)
  for (const p of allParents) {
    const matchesName = containsAllTokens(p.full_name, needle)
    const matchesNote = p.note ? containsAllTokens(p.note, needle) : false
    if (matchesName || matchesNote) {
      for (const fam of parentFamilies.get(p.id) ?? []) {
        if (!matchedFamilyIds.has(fam.family_id)) {
          matchedFamilyIds.add(fam.family_id)
          candidates.push(fam)
        }
      }
    }
  }

  // Check children (full_name + note)
  for (const c of allChildren) {
    if (!c.family_id) continue
    const matchesName = containsAllTokens(c.full_name, needle)
    const matchesNote = c.note ? containsAllTokens(c.note, needle) : false
    if (matchesName || matchesNote) {
      const fam = childFamilies.get(c.family_id)
      if (fam && !matchedFamilyIds.has(fam.family_id)) {
        matchedFamilyIds.add(fam.family_id)
        candidates.push({ family_id: fam.family_id, family_name: fam.family_name, parent_name: c.full_name })
      }
    }
  }

  if (candidates.length > 0) return { method: 'name_fuzzy', families: candidates }
  return { method: null, families: [] }
}

function deduplicateFamilies(input: CandidateFamily[]): CandidateFamily[] {
  const seen = new Set<string>()
  return input.filter((f) => {
    if (seen.has(f.family_id)) return false
    seen.add(f.family_id)
    return true
  })
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function importRoutes(app: FastifyInstance) {

  // POST /api/import/preview
  app.post<{
    Body: { account_id: string; rows: BankRow[] }
  }>(
    '/preview',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { account_id, rows } = request.body
      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id є обовʼязковим' })
      if (!Array.isArray(rows) || rows.length === 0) return reply.status(400).send({ error: 'BadRequest', message: 'rows не може бути порожнім' })

      // Load all parents with matching fields
      const allParents = await db
        .selectFrom('parents')
        .select(['id', 'full_name', 'note', 'edrpou', 'iban'])
        .execute()

      // Load family memberships for all parents
      const allMemberships = await db
        .selectFrom('family_members as fm')
        .innerJoin('families as f', 'f.id', 'fm.family_id')
        .innerJoin('parents as p', 'p.id', 'fm.parent_id')
        .select(['fm.parent_id', 'fm.family_id', 'f.name as family_name', 'p.full_name as parent_name'])
        .execute()

      const parentFamilies = new Map<string, CandidateFamily[]>()
      for (const m of allMemberships) {
        const list = parentFamilies.get(m.parent_id) ?? []
        list.push({ family_id: m.family_id, family_name: m.family_name, parent_name: m.parent_name })
        parentFamilies.set(m.parent_id, list)
      }

      // Load all children
      const allChildren = await db
        .selectFrom('children')
        .select(['id', 'full_name', 'note', 'family_id'])
        .where('is_active', '=', true)
        .execute()

      // Load family names for child matching
      const familyRows = await db
        .selectFrom('families')
        .select(['id', 'name'])
        .execute()
      const childFamilies = new Map<string, { family_id: string; family_name: string }>()
      for (const f of familyRows) {
        childFamilies.set(f.id, { family_id: f.id, family_name: f.name })
      }

      // Batch duplicate detection — two levels:
      // 1. bank_ref tag (re-import of same bank row)
      // 2. family + date + amount on same account (catches manually entered payments)
      const existingTxRows = await db
        .selectFrom('transactions as t')
        .innerJoin('children as c', 'c.id', 't.child_id')
        .select([
          't.id',
          sql<string>`t.amount::text`.as('amount'),
          sql<string>`t.transaction_date::text`.as('transaction_date'),
          'c.family_id',
          sql<string>`t.metadata_json::text`.as('metadata_json_raw'),
        ])
        .where('t.is_deleted', '=', false)
        .where('t.type', '=', 'PAYMENT')
        .where('t.account_id', '=', account_id)
        .execute()

      const duplicateMap = new Map<string, string>()      // bank_ref → tx_id
      const familyPaymentSet = new Map<string, string>()  // family|date|amount → tx_id

      for (const tx of existingTxRows) {
        const meta = tx.metadata_json_raw ? JSON.parse(tx.metadata_json_raw) as Record<string, unknown> : null
        if (meta && meta['source'] === 'bank_import' && typeof meta['bank_ref'] === 'string') {
          duplicateMap.set(meta['bank_ref'] as string, tx.id)
        }
        if (tx.family_id) {
          const amt = parseFloat(tx.amount).toFixed(2)
          const key = `${tx.family_id}|${tx.transaction_date}|${amt}`
          familyPaymentSet.set(key, tx.id)
        }
      }

      // Process each row
      const result: PreviewRow[] = []

      for (const row of rows) {
        const bank_ref = makeBankRef(row)
        const dup_tx_id = duplicateMap.get(bank_ref) ?? null

        if (dup_tx_id) {
          result.push({
            ...row,
            status: 'duplicate',
            match_method: null,
            matched_family_id: null,
            matched_family_name: null,
            matched_parent_name: null,
            candidate_families: [],
            bank_ref,
            is_duplicate: true,
            duplicate_tx_id: dup_tx_id,
          })
          continue
        }

        const match = await matchRow(row, allParents, parentFamilies, allChildren, childFamilies)

        let status: PreviewRow['status']
        let matched_family_id: string | null = null
        let matched_family_name: string | null = null
        let matched_parent_name: string | null = null
        let candidate_families: CandidateFamily[] = []

        if (match.families.length === 0) {
          status = 'unmatched'
        } else if (match.families.length === 1) {
          status = 'matched'
          matched_family_id = match.families[0].family_id
          matched_family_name = match.families[0].family_name
          matched_parent_name = match.families[0].parent_name
        } else {
          status = 'conflict'
          candidate_families = match.families
        }

        // Secondary duplicate check: same family + date + amount on this account
        // Catches manually entered payments that correspond to the same bank row
        let is_duplicate = false
        let duplicate_tx_id: string | null = null
        if (matched_family_id) {
          const key = `${matched_family_id}|${row.date}|${row.amount.toFixed(2)}`
          const existing = familyPaymentSet.get(key)
          if (existing) {
            is_duplicate = true
            duplicate_tx_id = existing
            status = 'duplicate'
          }
        }

        result.push({
          ...row,
          status,
          match_method: match.method,
          matched_family_id,
          matched_family_name,
          matched_parent_name,
          candidate_families,
          bank_ref,
          is_duplicate,
          duplicate_tx_id,
        })
      }

      return { rows: result }
    }
  )

  // POST /api/import/apply
  app.post<{
    Body: { account_id: string; rows: ApplyRow[] }
  }>(
    '/apply',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { account_id, rows } = request.body
      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id є обовʼязковим' })
      if (!Array.isArray(rows) || rows.length === 0) return reply.status(400).send({ error: 'BadRequest', message: 'rows не може бути порожнім' })

      // Re-check duplicates (defensive, mirrors preview logic)
      const existingTxRows = await db
        .selectFrom('transactions as t')
        .innerJoin('children as c', 'c.id', 't.child_id')
        .select([
          't.id',
          sql<string>`t.amount::text`.as('amount'),
          sql<string>`t.transaction_date::text`.as('transaction_date'),
          'c.family_id',
          sql<string>`t.metadata_json::text`.as('metadata_json_raw'),
        ])
        .where('t.is_deleted', '=', false)
        .where('t.type', '=', 'PAYMENT')
        .where('t.account_id', '=', account_id)
        .execute()

      const duplicateSet = new Set<string>()          // bank_ref keys
      const familyPaymentSet = new Set<string>()      // family|date|amount keys

      for (const tx of existingTxRows) {
        const meta = tx.metadata_json_raw ? JSON.parse(tx.metadata_json_raw) as Record<string, unknown> : null
        if (meta && meta['source'] === 'bank_import' && typeof meta['bank_ref'] === 'string') {
          duplicateSet.add(meta['bank_ref'] as string)
        }
        if (tx.family_id) {
          familyPaymentSet.add(`${tx.family_id}|${tx.transaction_date}|${parseFloat(tx.amount).toFixed(2)}`)
        }
      }

      const createdBy = request.user.sub

      type AllocationEntry = { child_id: string; child_name: string; amount: number; tx_id: string }
      const allocationsOut: { row_index: number; family_id: string; family_name: string; allocations: AllocationEntry[] }[] = []
      const errors: { row_index: number; message: string }[] = []
      let imported = 0
      let skipped_duplicates = 0

      for (const row of rows) {
        const familyKey = `${row.family_id}|${row.date}|${row.amount.toFixed(2)}`
        if (!row.force && (duplicateSet.has(row.bank_ref) || familyPaymentSet.has(familyKey))) {
          skipped_duplicates++
          continue
        }

        try {
          const debts = await getFamilyDebts(row.family_id, account_id)
          const waterfall = computeWaterfall(debts, row.amount, undefined)
          const dateStr = row.date

          if (waterfall.allocations.length === 0) {
            // No debts — create advance for first active child
            const firstChild = await db
              .selectFrom('children')
              .select(['id', 'full_name'])
              .where('family_id', '=', row.family_id)
              .where('is_active', '=', true)
              .orderBy('full_name', 'asc')
              .executeTakeFirst()

            if (!firstChild) {
              errors.push({ row_index: row.row_index, message: 'У сім\'ї немає активних дітей' })
              continue
            }

            const tx_id = await createTransaction({
              type: 'PAYMENT',
              child_id: firstChild.id,
              account_id,
              amount: row.amount,
              transaction_date: dateStr,
              note: row.note ?? row.counterparty_name,
              metadata_json: {
                source: 'bank_import',
                bank_ref: row.bank_ref,
                counterparty_name: row.counterparty_name,
                edrpou: row.edrpou,
              },
              created_by: createdBy,
            })

            const family = await db.selectFrom('families').select('name').where('id', '=', row.family_id).executeTakeFirst()
            allocationsOut.push({
              row_index: row.row_index,
              family_id: row.family_id,
              family_name: family?.name ?? '',
              allocations: [{ child_id: firstChild.id, child_name: firstChild.full_name, amount: row.amount, tx_id }],
            })
          } else {
            const rowAllocations: AllocationEntry[] = []
            for (const alloc of waterfall.allocations) {
              const tx_id = await createTransaction({
                type: 'PAYMENT',
                child_id: alloc.child_id,
                account_id,
                amount: alloc.amount,
                transaction_date: dateStr,
                note: row.note ?? row.counterparty_name,
                metadata_json: {
                  source: 'bank_import',
                  bank_ref: row.bank_ref,
                  counterparty_name: row.counterparty_name,
                  edrpou: row.edrpou,
                },
                created_by: createdBy,
              })
              rowAllocations.push({ child_id: alloc.child_id, child_name: alloc.child_name, amount: alloc.amount, tx_id })
            }

            // If there's a remainder (payment > total debt), allocate it as advance to first child
            if (waterfall.remainder > 0 && waterfall.allocations.length > 0) {
              const firstChildId = waterfall.allocations[0].child_id
              const tx_id = await createTransaction({
                type: 'PAYMENT',
                child_id: firstChildId,
                account_id,
                amount: waterfall.remainder,
                transaction_date: dateStr,
                note: row.note ?? row.counterparty_name,
                metadata_json: {
                  source: 'bank_import',
                  bank_ref: row.bank_ref,
                  counterparty_name: row.counterparty_name,
                  edrpou: row.edrpou,
                  advance: true,
                },
                created_by: createdBy,
              })
              const existing = rowAllocations.find((a) => a.child_id === firstChildId)
              if (existing) {
                existing.amount += waterfall.remainder
                existing.tx_id = tx_id
              } else {
                rowAllocations.push({ child_id: firstChildId, child_name: waterfall.allocations[0].child_name, amount: waterfall.remainder, tx_id })
              }
            }

            const family = await db.selectFrom('families').select('name').where('id', '=', row.family_id).executeTakeFirst()
            allocationsOut.push({
              row_index: row.row_index,
              family_id: row.family_id,
              family_name: family?.name ?? '',
              allocations: rowAllocations,
            })
          }

          duplicateSet.add(row.bank_ref)
          imported++
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push({ row_index: row.row_index, message: msg })
        }
      }

      return { imported, skipped_duplicates, errors, allocations: allocationsOut }
    }
  )
}
