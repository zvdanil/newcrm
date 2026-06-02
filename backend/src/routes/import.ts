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
  family_id: string | null   // null = direct child payment (no family link)
  child_id: string | null    // set when family_id is null
  family_name: string        // display name: family name OR child name
  parent_name: string
}

export type NameMatchMethod =
  | 'description_fuzzy'
  | 'description_partial'
  | 'counterparty_fuzzy'
  | 'counterparty_partial'

export interface PreviewRow extends BankRow {
  status: 'matched' | 'conflict' | 'unmatched' | 'duplicate' | 'partial'
  match_method: 'edrpou' | 'iban' | 'profile_inn' | 'profile_iban' | NameMatchMethod | null
  matched_family_id: string | null
  matched_child_id: string | null
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
  family_id: string | null
  child_id?: string
  bank_ref: string
  counterparty_name: string
  edrpou: string | null
  iban?: string | null
  note?: string
  force?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[­​‌‍⁠﻿]/g, '')
    .toLowerCase()
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[.,\-'"():;«»!?]/g, '')
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

function normalizeTxDate(d: string): string {
  return d.substring(0, 10)
}

function paymentAmountKey(amount: number): string {
  return amount.toFixed(2)
}

// ─── Duplicate index (preview + apply) ─────────────────────────────────────

interface DuplicateHit {
  txId: string
  childId: string
}

interface DuplicateIndex {
  byBankRef: Map<string, DuplicateHit>
  byFamily: Map<string, DuplicateHit>
  byChild: Map<string, DuplicateHit>
}

function buildDuplicateIndex(
  existingTxRows: {
    id: string
    child_id: string
    amount: string
    transaction_date: string
    family_id: string | null
    metadata_json_raw: string | null
  }[],
): DuplicateIndex {
  const byBankRef = new Map<string, DuplicateHit>()
  const byFamily = new Map<string, DuplicateHit>()
  const byChild = new Map<string, DuplicateHit>()

  for (const tx of existingTxRows) {
    const hit: DuplicateHit = { txId: tx.id, childId: tx.child_id }
    const meta = tx.metadata_json_raw ? JSON.parse(tx.metadata_json_raw) as Record<string, unknown> : null
    if (meta && meta['source'] === 'bank_import' && typeof meta['bank_ref'] === 'string') {
      byBankRef.set(meta['bank_ref'] as string, hit)
    }
    const amt = paymentAmountKey(parseFloat(tx.amount))
    const date = normalizeTxDate(tx.transaction_date)
    if (tx.family_id) {
      byFamily.set(`${tx.family_id}|${date}|${amt}`, hit)
    } else {
      byChild.set(`child:${tx.child_id}|${date}|${amt}`, hit)
    }
  }

  return { byBankRef, byFamily, byChild }
}

function findPaymentDuplicate(
  index: DuplicateIndex,
  row: { date: string; amount: number; bank_ref?: string },
  familyId: string | null,
  childId: string | null,
): DuplicateHit | null {
  if (row.bank_ref) {
    const byRef = index.byBankRef.get(row.bank_ref)
    if (byRef) return byRef
  }
  const amt = paymentAmountKey(row.amount)
  const date = normalizeTxDate(row.date)
  if (familyId) {
    const hit = index.byFamily.get(`${familyId}|${date}|${amt}`)
    if (hit) return hit
  }
  if (childId) {
    const hit = index.byChild.get(`child:${childId}|${date}|${amt}`)
    if (hit) return hit
  }
  return null
}

function duplicateFingerprintsFromIndex(index: DuplicateIndex): { family: string[]; child: string[] } {
  return {
    family: [...index.byFamily.keys()],
    child: [...index.byChild.keys()],
  }
}

function registerImportedPayment(
  index: DuplicateIndex,
  row: { bank_ref: string; date: string; amount: number; family_id?: string | null },
  txId: string,
  childId: string,
): void {
  const hit: DuplicateHit = { txId, childId }
  index.byBankRef.set(row.bank_ref, hit)
  const amt = paymentAmountKey(row.amount)
  const date = normalizeTxDate(row.date)
  if (row.family_id) {
    index.byFamily.set(`${row.family_id}|${date}|${amt}`, hit)
  } else {
    index.byChild.set(`child:${childId}|${date}|${amt}`, hit)
  }
}

async function resolveChildIdsForPayerProfile(
  row: ApplyRow,
  duplicateHit: DuplicateHit | null,
): Promise<string[]> {
  if (row.child_id && !row.family_id) return [row.child_id]
  if (duplicateHit) return [duplicateHit.childId]
  if (row.family_id) {
    const firstChild = await db
      .selectFrom('children')
      .select('id')
      .where('family_id', '=', row.family_id)
      .where('is_active', '=', true)
      .orderBy('full_name', 'asc')
      .executeTakeFirst()
    return firstChild ? [firstChild.id] : []
  }
  return []
}

// ─── Matching ─────────────────────────────────────────────────────────────────

interface MatchResult {
  method: 'edrpou' | 'iban' | 'profile_inn' | 'profile_iban' | NameMatchMethod | null
  families: CandidateFamily[]
}

// Ratio of needle tokens (length ≥ 3) found in haystack. 0 = none, 1 = all.
function partialMatchScore(haystack: string, needle: string[]): number {
  const sig = needle.filter((t) => t.length >= 3)
  if (sig.length === 0) return 0
  const h = normalize(haystack)
  return sig.filter((t) => h.includes(t)).length / sig.length
}

type ProfileRow = { child_id: string; full_name: string; family_id: string | null }

function profilesToCandidates(profiles: ProfileRow[]): CandidateFamily[] {
  return deduplicateFamilies(
    profiles.map((p) => ({
      family_id: p.family_id,
      child_id: p.family_id ? null : p.child_id,
      family_name: p.full_name,
      parent_name: p.full_name,
    })),
  )
}

/** Learned payer profiles — last resort; shared PSP ІНН/IBAN need text disambiguation. */
async function matchByPayerProfiles(
  row: BankRow,
  field: 'inn' | 'iban',
  value: string,
): Promise<MatchResult> {
  const method = field === 'inn' ? 'profile_inn' : 'profile_iban'
  const profiles = await db
    .selectFrom('bank_payer_profiles as bpp')
    .innerJoin('children as c', 'c.id', 'bpp.child_id')
    .select(['c.id as child_id', 'c.full_name', 'c.family_id'])
    .where(field === 'inn' ? 'bpp.inn' : 'bpp.iban', '=', value)
    .execute()

  if (profiles.length === 0) return { method: null, families: [] }
  if (profiles.length === 1) return { method, families: profilesToCandidates(profiles) }

  // Same ІНН/IBAN у кількох дітей (типово — платіжна система): звужуємо за призначенням / контрагентом
  const searchTexts = [row.description.trim(), row.counterparty_name.trim()].filter(Boolean)
  if (searchTexts.length > 0) {
    const narrowed = profiles.filter((p) => {
      const childTokens = tokens(p.full_name)
      if (childTokens.length === 0) return false
      return searchTexts.some((text) => containsAllTokens(text, childTokens))
    })
    const families = profilesToCandidates(narrowed)
    if (families.length === 1) return { method, families }
    if (families.length > 1) return { method, families }
  }

  // Не вдалося відрізнити — конфлікт для ручного вибору
  return { method, families: profilesToCandidates(profiles) }
}

async function matchRow(
  row: BankRow,
  allParents: { id: string; full_name: string; note: string | null; edrpou: string | null; iban: string | null }[],
  parentFamilies: Map<string, CandidateFamily[]>,
  allChildren: { id: string; full_name: string; note: string | null; family_id: string | null }[],
  childFamilies: Map<string, { family_id: string; family_name: string }>,
  allFamilies: { id: string; name: string }[],
): Promise<MatchResult> {

  // 1–2. ІНН/IBAN батьків у картці (особисті реквізити, не платіжна система)
  if (row.edrpou) {
    const matched = allParents.filter((p) => p.edrpou === row.edrpou)
    if (matched.length > 0) {
      const families = deduplicateFamilies(matched.flatMap((p) => parentFamilies.get(p.id) ?? []))
      if (families.length > 0) return { method: 'edrpou', families }
    }
  }

  if (row.iban) {
    const matched = allParents.filter((p) => p.iban === row.iban)
    if (matched.length > 0) {
      const families = deduplicateFamilies(matched.flatMap((p) => parentFamilies.get(p.id) ?? []))
      if (families.length > 0) return { method: 'iban', families }
    }
  }

  // 3–4. Fuzzy: призначення, потім контрагент (головний ідентифікатор для PSP)
  const description = row.description.trim()
  if (description) {
    const descMatch = collectFuzzyCandidates(
      description, allParents, parentFamilies, allChildren, childFamilies, allFamilies,
    )
    if (descMatch.full.length > 0) return { method: 'description_fuzzy', families: descMatch.full }
    if (descMatch.partial.length > 0) return { method: 'description_partial', families: descMatch.partial }
  }

  const counterparty = row.counterparty_name.trim()
  if (counterparty) {
    const cpMatch = collectFuzzyCandidates(
      counterparty, allParents, parentFamilies, allChildren, childFamilies, allFamilies,
    )
    if (cpMatch.full.length > 0) return { method: 'counterparty_fuzzy', families: cpMatch.full }
    if (cpMatch.partial.length > 0) return { method: 'counterparty_partial', families: cpMatch.partial }
  }

  // 5–6. Відомі платники — після тексту; при спільному ІНН звужуємо за ФІО в призначенні
  if (row.edrpou) {
    const profileMatch = await matchByPayerProfiles(row, 'inn', row.edrpou)
    if (profileMatch.families.length > 0) return profileMatch
  }

  if (row.iban) {
    const profileMatch = await matchByPayerProfiles(row, 'iban', row.iban)
    if (profileMatch.families.length > 0) return profileMatch
  }

  return { method: null, families: [] }
}

function collectFuzzyCandidates(
  searchText: string,
  allParents: { id: string; full_name: string; note: string | null }[],
  parentFamilies: Map<string, CandidateFamily[]>,
  allChildren: { id: string; full_name: string; note: string | null; family_id: string | null }[],
  childFamilies: Map<string, { family_id: string; family_name: string }>,
  allFamilies: { id: string; name: string }[],
): { full: CandidateFamily[]; partial: CandidateFamily[] } {
  const needle = tokens(searchText)
  if (needle.length === 0) return { full: [], partial: [] }

  const matchedKeys = new Set<string>()
  const candidates: CandidateFamily[] = []

  for (const p of allParents) {
    const matchesName = containsAllTokens(p.full_name, needle)
    const matchesNote = p.note ? containsAllTokens(p.note, needle) : false
    if (matchesName || matchesNote) {
      for (const fam of parentFamilies.get(p.id) ?? []) {
        const key = fam.family_id ?? `child:${fam.child_id}`
        if (!matchedKeys.has(key)) {
          matchedKeys.add(key)
          candidates.push(fam)
        }
      }
    }
  }

  for (const c of allChildren) {
    const matchesName = containsAllTokens(c.full_name, needle)
    const matchesNote = c.note ? containsAllTokens(c.note, needle) : false
    if (matchesName || matchesNote) {
      if (c.family_id) {
        const fam = childFamilies.get(c.family_id)
        if (fam && !matchedKeys.has(fam.family_id)) {
          matchedKeys.add(fam.family_id)
          candidates.push({ family_id: fam.family_id, child_id: null, family_name: fam.family_name, parent_name: c.full_name })
        }
      } else {
        const childKey = `child:${c.id}`
        if (!matchedKeys.has(childKey)) {
          matchedKeys.add(childKey)
          candidates.push({ family_id: null, child_id: c.id, family_name: c.full_name, parent_name: c.full_name })
        }
      }
    }
  }

  for (const f of allFamilies) {
    const familyTokens = tokens(f.name)
    if (familyTokens.length > 0 && containsAllTokens(searchText, familyTokens)) {
      if (!matchedKeys.has(f.id)) {
        matchedKeys.add(f.id)
        candidates.push({ family_id: f.id, child_id: null, family_name: f.name, parent_name: f.name })
      }
    }
  }

  const partialMap = new Map<string, { candidate: CandidateFamily; score: number }>()

  function tryPartial(candidate: CandidateFamily, score: number) {
    const key = candidate.family_id ?? `child:${candidate.child_id}`
    const existing = partialMap.get(key)
    if (!existing || score > existing.score) partialMap.set(key, { candidate, score })
  }

  for (const p of allParents) {
    const fields = [p.full_name, p.note].filter((f): f is string => f !== null)
    const score = Math.max(0, ...fields.map((f) => partialMatchScore(f, needle)))
    if (score > 0) {
      for (const fam of parentFamilies.get(p.id) ?? []) tryPartial(fam, score)
    }
  }

  for (const c of allChildren) {
    const fields = [c.full_name, c.note].filter((f): f is string => f !== null)
    const score = Math.max(0, ...fields.map((f) => partialMatchScore(f, needle)))
    if (score > 0) {
      if (c.family_id) {
        const fam = childFamilies.get(c.family_id)
        if (fam) tryPartial({ family_id: fam.family_id, child_id: null, family_name: fam.family_name, parent_name: c.full_name }, score)
      } else {
        tryPartial({ family_id: null, child_id: c.id, family_name: c.full_name, parent_name: c.full_name }, score)
      }
    }
  }

  const partial = [...partialMap.values()]
    .sort((a, b) => b.score - a.score)
    .map((x) => x.candidate)

  return { full: candidates, partial }
}

function isPartialMatchMethod(method: MatchResult['method']): boolean {
  return method === 'description_partial' || method === 'counterparty_partial'
}

function applyDuplicateToPreview(
  row: BankRow & { bank_ref: string },
  index: DuplicateIndex,
  familyId: string | null,
  childId: string | null,
): { is_duplicate: boolean; duplicate_tx_id: string | null; status: PreviewRow['status'] | null } {
  const hit = findPaymentDuplicate(index, row, familyId, childId)
  if (!hit) return { is_duplicate: false, duplicate_tx_id: null, status: null }
  return { is_duplicate: true, duplicate_tx_id: hit.txId, status: 'duplicate' }
}

function deduplicateFamilies(input: CandidateFamily[]): CandidateFamily[] {
  const seen = new Set<string>()
  return input.filter((f) => {
    const key = f.family_id ?? `child:${f.child_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function upsertPayerProfile(
  childId: string,
  counterpartyName: string,
  inn: string | null | undefined,
  iban: string | null | undefined,
  importDate: string,
) {
  if (inn) {
    await sql`
      INSERT INTO bank_payer_profiles (child_id, counterparty_name, inn, iban, last_import_date)
      VALUES (${childId}, ${counterpartyName}, ${inn}, ${iban ?? null}, ${importDate}::date)
      ON CONFLICT (child_id, inn) WHERE inn IS NOT NULL
      DO UPDATE SET
        counterparty_name = EXCLUDED.counterparty_name,
        iban              = COALESCE(EXCLUDED.iban, bank_payer_profiles.iban),
        import_count      = bank_payer_profiles.import_count + 1,
        last_import_date  = EXCLUDED.last_import_date,
        updated_at        = now()
    `.execute(db)
  } else if (iban) {
    await sql`
      INSERT INTO bank_payer_profiles (child_id, counterparty_name, iban, last_import_date)
      VALUES (${childId}, ${counterpartyName}, ${iban}, ${importDate}::date)
      ON CONFLICT (child_id, iban) WHERE iban IS NOT NULL AND inn IS NULL
      DO UPDATE SET
        counterparty_name = EXCLUDED.counterparty_name,
        import_count      = bank_payer_profiles.import_count + 1,
        last_import_date  = EXCLUDED.last_import_date,
        updated_at        = now()
    `.execute(db)
  }
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
        list.push({ family_id: m.family_id, child_id: null, family_name: m.family_name, parent_name: m.parent_name })
        parentFamilies.set(m.parent_id, list)
      }

      // Also include parents linked via child_parents (direct child-parent link, newer system)
      const childParentLinks = await db
        .selectFrom('child_parents as cp')
        .innerJoin('children as c', 'c.id', 'cp.child_id')
        .innerJoin('parents as p', 'p.id', 'cp.parent_id')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .select(['cp.parent_id', 'c.id as child_id', 'c.full_name as child_name', 'c.family_id', 'f.name as family_name', 'p.full_name as parent_name'])
        .execute()

      for (const link of childParentLinks) {
        const list = parentFamilies.get(link.parent_id) ?? []
        const entryKey = link.family_id ?? `child:${link.child_id}`
        const alreadyPresent = list.some((e) => (e.family_id ?? `child:${e.child_id}`) === entryKey)
        if (!alreadyPresent) {
          list.push({
            family_id: link.family_id ?? null,
            child_id: link.family_id ? null : link.child_id,
            family_name: link.family_name ?? link.child_name,
            parent_name: link.parent_name,
          })
        }
        parentFamilies.set(link.parent_id, list)
      }

      // Load all children (family_id is optional)
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
      // 2. family|child + date + amount on same account (catches manually entered payments)
      const existingTxRows = await db
        .selectFrom('transactions as t')
        .innerJoin('children as c', 'c.id', 't.child_id')
        .select([
          't.id',
          't.child_id',
          sql<string>`t.amount::text`.as('amount'),
          sql<string>`t.transaction_date::text`.as('transaction_date'),
          'c.family_id',
          sql<string>`t.metadata_json::text`.as('metadata_json_raw'),
        ])
        .where('t.is_deleted', '=', false)
        .where('t.type', '=', 'PAYMENT')
        .where('t.account_id', '=', account_id)
        .execute()

      const dupIndex = buildDuplicateIndex(existingTxRows)
      const duplicate_fingerprints = duplicateFingerprintsFromIndex(dupIndex)

      // Process each row
      const result: PreviewRow[] = []

      for (const row of rows) {
        const bank_ref = makeBankRef(row)
        const bankRefHit = dupIndex.byBankRef.get(bank_ref) ?? null

        if (bankRefHit) {
          result.push({
            ...row,
            status: 'duplicate',
            match_method: null,
            matched_family_id: null,
            matched_child_id: null,
            matched_family_name: null,
            matched_parent_name: null,
            candidate_families: [],
            bank_ref,
            is_duplicate: true,
            duplicate_tx_id: bankRefHit.txId,
          })
          continue
        }

        const match = await matchRow(row, allParents, parentFamilies, allChildren, childFamilies, familyRows)

        let status: PreviewRow['status']
        let matched_family_id: string | null = null
        let matched_child_id: string | null = null
        let matched_family_name: string | null = null
        let matched_parent_name: string | null = null
        let candidate_families: CandidateFamily[] = []

        if (match.families.length === 0) {
          status = 'unmatched'
        } else if (isPartialMatchMethod(match.method)) {
          status = 'partial'
          candidate_families = match.families
        } else if (match.families.length === 1) {
          status = 'matched'
          matched_family_id = match.families[0].family_id
          matched_child_id = match.families[0].child_id
          matched_family_name = match.families[0].family_name
          matched_parent_name = match.families[0].parent_name
        } else {
          status = 'conflict'
          candidate_families = match.families
        }

        let is_duplicate = false
        let duplicate_tx_id: string | null = null

        const primaryDup = applyDuplicateToPreview(
          { ...row, bank_ref },
          dupIndex,
          matched_family_id,
          matched_child_id,
        )
        if (primaryDup.is_duplicate) {
          is_duplicate = true
          duplicate_tx_id = primaryDup.duplicate_tx_id
          status = 'duplicate'
        }

        // Among candidates: if exactly one would duplicate an existing manual payment, pre-select it
        if (!is_duplicate && candidate_families.length > 0) {
          const dupCandidates = candidate_families.filter((c) =>
            findPaymentDuplicate(dupIndex, { ...row, bank_ref }, c.family_id, c.child_id) !== null,
          )
          if (dupCandidates.length === 1) {
            const c = dupCandidates[0]
            matched_family_id = c.family_id
            matched_child_id = c.child_id
            matched_family_name = c.family_name
            matched_parent_name = c.parent_name
            candidate_families = []
            const hit = findPaymentDuplicate(dupIndex, { ...row, bank_ref }, c.family_id, c.child_id)!
            is_duplicate = true
            duplicate_tx_id = hit.txId
            status = 'duplicate'
          }
        }

        result.push({
          ...row,
          status,
          match_method: match.method,
          matched_family_id,
          matched_child_id,
          matched_family_name,
          matched_parent_name,
          candidate_families,
          bank_ref,
          is_duplicate,
          duplicate_tx_id,
        })
      }

      return { rows: result, duplicate_fingerprints }
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
          't.child_id',
          sql<string>`t.amount::text`.as('amount'),
          sql<string>`t.transaction_date::text`.as('transaction_date'),
          'c.family_id',
          sql<string>`t.metadata_json::text`.as('metadata_json_raw'),
        ])
        .where('t.is_deleted', '=', false)
        .where('t.type', '=', 'PAYMENT')
        .where('t.account_id', '=', account_id)
        .execute()

      const dupIndex = buildDuplicateIndex(existingTxRows)

      const createdBy = request.user.sub

      type AllocationEntry = { child_id: string; child_name: string; amount: number; tx_id: string }
      const allocationsOut: { row_index: number; family_id: string | null; family_name: string; allocations: AllocationEntry[] }[] = []
      const errors: { row_index: number; message: string }[] = []
      let imported = 0
      let skipped_duplicates = 0
      let profiles_updated = 0

      for (const row of rows) {
        const duplicateHit = findPaymentDuplicate(dupIndex, row, row.family_id, row.child_id ?? null)

        if (!row.force && duplicateHit) {
          const profileChildIds = await resolveChildIdsForPayerProfile(row, duplicateHit)
          for (const childId of profileChildIds) {
            await upsertPayerProfile(childId, row.counterparty_name, row.edrpou, row.iban ?? null, row.date)
            profiles_updated++
          }
          skipped_duplicates++
          continue
        }

        try {
          if (row.child_id && !row.family_id) {
            // Direct child payment — no family waterfall needed
            const child = await db
              .selectFrom('children')
              .select(['id', 'full_name'])
              .where('id', '=', row.child_id)
              .executeTakeFirst()

            if (!child) {
              errors.push({ row_index: row.row_index, message: 'Дитину не знайдено' })
              continue
            }

            const tx_id = await createTransaction({
              type: 'PAYMENT',
              child_id: child.id,
              account_id,
              amount: row.amount,
              transaction_date: row.date,
              note: row.note ?? row.counterparty_name,
              metadata_json: {
                source: 'bank_import',
                bank_ref: row.bank_ref,
                counterparty_name: row.counterparty_name,
                edrpou: row.edrpou,
              },
              created_by: createdBy,
            })

            await upsertPayerProfile(child.id, row.counterparty_name, row.edrpou, row.iban ?? null, row.date)

            allocationsOut.push({
              row_index: row.row_index,
              family_id: null,
              family_name: child.full_name,
              allocations: [{ child_id: child.id, child_name: child.full_name, amount: row.amount, tx_id }],
            })
            registerImportedPayment(dupIndex, row, tx_id, child.id)
            imported++

          } else if (row.family_id) {
            // Family waterfall payment
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

              await upsertPayerProfile(firstChild.id, row.counterparty_name, row.edrpou, row.iban ?? null, row.date)

              const family = await db.selectFrom('families').select('name').where('id', '=', row.family_id).executeTakeFirst()
              allocationsOut.push({
                row_index: row.row_index,
                family_id: row.family_id,
                family_name: family?.name ?? '',
                allocations: [{ child_id: firstChild.id, child_name: firstChild.full_name, amount: row.amount, tx_id }],
              })
            } else {
              const rowAllocations: AllocationEntry[] = []
              const profiledChildren = new Set<string>()
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
                if (!profiledChildren.has(alloc.child_id)) {
                  profiledChildren.add(alloc.child_id)
                  await upsertPayerProfile(alloc.child_id, row.counterparty_name, row.edrpou, row.iban ?? null, row.date)
                }
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

            const lastAlloc = allocationsOut[allocationsOut.length - 1]?.allocations[0]
            if (lastAlloc) {
              registerImportedPayment(dupIndex, { ...row, family_id: row.family_id }, lastAlloc.tx_id, lastAlloc.child_id)
            }
            imported++

          } else {
            errors.push({ row_index: row.row_index, message: 'Не вказано сімʼю або дитину' })
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push({ row_index: row.row_index, message: msg })
        }
      }

      return { imported, skipped_duplicates, profiles_updated, errors, allocations: allocationsOut }
    }
  )
}
