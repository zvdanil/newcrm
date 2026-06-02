import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExpenseBankRow {
  row_index:         number
  date:              string         // YYYY-MM-DD
  amount:            number         // always positive
  counterparty_name: string
  edrpou:            string | null
  iban:              string | null
  description:       string
  doc_number:        string | null
  bank_reference:    string | null
}

export interface ExpensePreviewRow extends ExpenseBankRow {
  status:               'matched' | 'unmatched' | 'skip' | 'duplicate'
  match_method:         'edrpou_keyword' | 'iban_keyword' | 'edrpou' | 'iban' | 'keyword' | null
  matched_rule_id:      string | null
  matched_category_id:  string | null
  matched_category_name: string | null
  bank_ref:             string
  is_duplicate:         boolean
  duplicate_expense_id: string | null
}

interface ApplyExpenseRow {
  row_index:         number
  date:              string
  amount:            number
  counterparty_name: string
  edrpou:            string | null
  iban:              string | null
  description:       string
  doc_number:        string | null
  bank_reference:    string | null
  bank_ref:          string
  category_id:       string | null
  note?:             string
  save_rule?:        boolean
  rule_edrpou?:      string | null
  rule_iban?:        string | null
  rule_keyword_pattern?: string | null
  is_skip_rule?:     boolean
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

function makeBankRef(row: ExpenseBankRow): string {
  const key = row.edrpou ?? normalize(row.counterparty_name)
  const docPart = row.doc_number ? `|${row.doc_number}` : ''
  const refPart = row.bank_reference ? `|${row.bank_reference}` : ''
  return `exp|${row.date}|${row.amount.toFixed(2)}|${key}${docPart}${refPart}`
}

function keywordsMatch(description: string, pattern: string): boolean {
  if (!pattern.trim()) return false
  const haystack = normalize(description)
  const keywords = pattern.toLowerCase().split(/\s+/).filter(k => k.length > 0)
  return keywords.every(k => haystack.includes(k))
}

interface Rule {
  id:              string
  edrpou:          string | null
  iban:            string | null
  keyword_pattern: string | null
  category_id:     string | null
  is_skip:         boolean
}

function matchRule(
  row: ExpenseBankRow,
  rules: Rule[]
): { rule: Rule; method: ExpensePreviewRow['match_method'] } | null {
  // Priority 1: EDRPOU + keyword_pattern
  if (row.edrpou) {
    const candidates = rules.filter(r => r.edrpou === row.edrpou && r.keyword_pattern)
    for (const r of candidates) {
      if (keywordsMatch(row.description, r.keyword_pattern!)) {
        return { rule: r, method: 'edrpou_keyword' }
      }
    }
  }

  // Priority 2: IBAN + keyword_pattern
  if (row.iban) {
    const candidates = rules.filter(r => r.iban === row.iban && r.keyword_pattern)
    for (const r of candidates) {
      if (keywordsMatch(row.description, r.keyword_pattern!)) {
        return { rule: r, method: 'iban_keyword' }
      }
    }
  }

  // Priority 3: EDRPOU only (no keyword in rule)
  if (row.edrpou) {
    const r = rules.find(r => r.edrpou === row.edrpou && !r.keyword_pattern)
    if (r) return { rule: r, method: 'edrpou' }
  }

  // Priority 4: IBAN only (no keyword in rule)
  if (row.iban) {
    const r = rules.find(r => r.iban === row.iban && !r.keyword_pattern)
    if (r) return { rule: r, method: 'iban' }
  }

  // Priority 5: keyword_pattern only (no EDRPOU/IBAN in rule)
  const keywordOnlyRules = rules.filter(r => !r.edrpou && !r.iban && r.keyword_pattern)
  for (const r of keywordOnlyRules) {
    if (keywordsMatch(row.description, r.keyword_pattern!)) {
      return { rule: r, method: 'keyword' }
    }
  }

  return null
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function expenseImportRoutes(app: FastifyInstance) {

  // GET /api/expense-import/rules?account_id=
  app.get<{ Querystring: { account_id: string } }>(
    '/rules',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (request, reply) => {
      const { account_id } = request.query
      if (!account_id) return reply.status(400).send({ error: 'account_id required' })

      const rules = await db
        .selectFrom('expense_import_rules as r')
        .leftJoin('expense_categories as c', 'c.id', 'r.category_id')
        .leftJoin('expense_categories as p', 'p.id', 'c.parent_id')
        .select([
          'r.id', 'r.account_id', 'r.edrpou', 'r.iban', 'r.keyword_pattern',
          'r.category_id', 'r.is_skip', 'r.match_count', 'r.last_matched_at',
          'r.created_at', 'r.updated_at',
          'c.name as category_name',
          'c.parent_id as category_parent_id',
          'p.name as parent_category_name',
        ])
        .where('r.account_id', '=', account_id)
        .orderBy('r.match_count', 'desc')
        .orderBy('r.created_at', 'asc')
        .execute()

      return rules
    }
  )

  // POST /api/expense-import/rules
  app.post<{ Body: {
    account_id:      string
    edrpou?:         string | null
    iban?:           string | null
    keyword_pattern?: string | null
    category_id?:    string | null
    is_skip?:        boolean
  } }>(
    '/rules',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (request, reply) => {
      const b = request.body
      if (!b.account_id) return reply.status(400).send({ error: 'account_id required' })
      if (!b.is_skip && !b.category_id) return reply.status(400).send({ error: 'category_id required unless is_skip' })

      const rule = await db
        .insertInto('expense_import_rules')
        .values({
          account_id:      b.account_id,
          edrpou:          b.edrpou?.trim() || null,
          iban:            b.iban?.trim() || null,
          keyword_pattern: b.keyword_pattern?.trim() || null,
          category_id:     b.is_skip ? null : (b.category_id ?? null),
          is_skip:         b.is_skip ?? false,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(rule)
    }
  )

  // PUT /api/expense-import/rules/:id
  app.put<{ Params: { id: string }; Body: {
    edrpou?:          string | null
    iban?:            string | null
    keyword_pattern?: string | null
    category_id?:     string | null
    is_skip?:         boolean
  } }>(
    '/rules/:id',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (request, reply) => {
      const { id } = request.params
      const b = request.body

      const rule = await db
        .updateTable('expense_import_rules')
        .set({
          edrpou:          b.edrpou?.trim() || null,
          iban:            b.iban?.trim() || null,
          keyword_pattern: b.keyword_pattern?.trim() || null,
          category_id:     b.is_skip ? null : (b.category_id ?? null),
          is_skip:         b.is_skip ?? false,
          updated_at:      new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()

      if (!rule) return reply.status(404).send({ error: 'NotFound' })
      return rule
    }
  )

  // DELETE /api/expense-import/rules/:id
  app.delete<{ Params: { id: string } }>(
    '/rules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const deleted = await db
        .deleteFrom('expense_import_rules')
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()

      if (!deleted) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )

  // POST /api/expense-import/preview
  app.post<{ Body: { account_id: string; rows: ExpenseBankRow[] } }>(
    '/preview',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (request, reply) => {
      const { account_id, rows } = request.body
      if (!account_id) return reply.status(400).send({ error: 'account_id required' })
      if (!Array.isArray(rows) || rows.length === 0) return reply.status(400).send({ error: 'rows required' })

      // Load rules for this account
      const rules = await db
        .selectFrom('expense_import_rules')
        .select(['id', 'edrpou', 'iban', 'keyword_pattern', 'category_id', 'is_skip'])
        .where('account_id', '=', account_id)
        .execute()

      // Build duplicate lookup from bank_ref stored in note field
      const existingRefs = await db
        .selectFrom('expenses')
        .select(['id', 'note'])
        .where('account_id', '=', account_id)
        .where('is_deleted', '=', false)
        .where('note', 'like', 'bank_ref:%')
        .execute()

      // Also check by date+amount+edrpou combination
      const existingExpenses = await db
        .selectFrom('expenses')
        .select(['id', 'amount', 'accrual_date', 'note'])
        .where('account_id', '=', account_id)
        .where('is_deleted', '=', false)
        .execute()

      const bankRefSet = new Map<string, string>()
      for (const e of existingRefs) {
        if (e.note && e.note.startsWith('bank_ref:')) {
          bankRefSet.set(e.note.replace('bank_ref:', '').trim(), e.id)
        }
      }

      const previewRows: ExpensePreviewRow[] = []

      for (const row of rows) {
        const bank_ref = makeBankRef(row)

        // Check duplicate by bank_ref
        const dupId = bankRefSet.get(bank_ref)
        if (dupId) {
          previewRows.push({
            ...row,
            bank_ref,
            status: 'duplicate',
            match_method: null,
            matched_rule_id: null,
            matched_category_id: null,
            matched_category_name: null,
            is_duplicate: true,
            duplicate_expense_id: dupId,
          })
          continue
        }

        // Check duplicate by date+amount (secondary check)
        const accrualDate = row.date
        const dupByCombo = existingExpenses.find(e => {
          const rawDate = e.accrual_date as unknown
          const eDate = rawDate instanceof Date
            ? rawDate.toISOString().substring(0, 10)
            : String(rawDate).substring(0, 10)
          const eAmount = parseFloat(String(e.amount))
          return eDate === accrualDate && Math.abs(eAmount - row.amount) < 0.01
        })
        if (dupByCombo) {
          previewRows.push({
            ...row,
            bank_ref,
            status: 'duplicate',
            match_method: null,
            matched_rule_id: null,
            matched_category_id: null,
            matched_category_name: null,
            is_duplicate: true,
            duplicate_expense_id: dupByCombo.id,
          })
          continue
        }

        // Match against rules
        const match = matchRule(row, rules)

        if (match) {
          if (match.rule.is_skip) {
            previewRows.push({
              ...row,
              bank_ref,
              status: 'skip',
              match_method: match.method,
              matched_rule_id: match.rule.id,
              matched_category_id: null,
              matched_category_name: null,
              is_duplicate: false,
              duplicate_expense_id: null,
            })
          } else {
            previewRows.push({
              ...row,
              bank_ref,
              status: 'matched',
              match_method: match.method,
              matched_rule_id: match.rule.id,
              matched_category_id: match.rule.category_id,
              matched_category_name: null,
              is_duplicate: false,
              duplicate_expense_id: null,
            })
          }
        } else {
          previewRows.push({
            ...row,
            bank_ref,
            status: 'unmatched',
            match_method: null,
            matched_rule_id: null,
            matched_category_id: null,
            matched_category_name: null,
            is_duplicate: false,
            duplicate_expense_id: null,
          })
        }
      }

      // Enrich matched rows with category names
      const catIds = [...new Set(previewRows
        .filter(r => r.matched_category_id)
        .map(r => r.matched_category_id!))]

      if (catIds.length > 0) {
        const cats = await db
          .selectFrom('expense_categories as c')
          .leftJoin('expense_categories as p', 'p.id', 'c.parent_id')
          .select(['c.id', 'c.name', 'c.parent_id', 'p.name as parent_name'])
          .where('c.id', 'in', catIds)
          .execute()

        const catMap = new Map(cats.map(c => [c.id, c]))
        for (const r of previewRows) {
          if (r.matched_category_id && catMap.has(r.matched_category_id)) {
            const cat = catMap.get(r.matched_category_id)!
            r.matched_category_name = cat.parent_name
              ? `${cat.parent_name} → ${cat.name}`
              : cat.name
          }
        }
      }

      return { rows: previewRows }
    }
  )

  // POST /api/expense-import/apply
  app.post<{ Body: { account_id: string; rows: ApplyExpenseRow[] } }>(
    '/apply',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (request, reply) => {
      const { account_id, rows } = request.body
      if (!account_id) return reply.status(400).send({ error: 'account_id required' })
      if (!Array.isArray(rows) || rows.length === 0) return reply.status(400).send({ error: 'rows required' })

      const imported: number[] = []
      const errors: { row_index: number; message: string }[] = []

      for (const row of rows) {
        try {
          // Create instant expense
          await db
            .insertInto('expenses')
            .values({
              account_id:   account_id,
              category_id:  row.category_id ?? null,
              amount:       row.amount,
              accrual_date: row.date,
              payment_date: row.date,
              status:       'paid',
              is_instant:   true,
              note:         `bank_ref:${row.bank_ref}${row.note ? ' ' + row.note : ''}`,
              created_by:   request.user.sub,
            })
            .execute()

          imported.push(row.row_index)

          // Save/update rule if requested
          if (row.save_rule && (row.rule_edrpou || row.rule_iban || row.rule_keyword_pattern)) {
            // Check if similar rule already exists
            let q = db
              .selectFrom('expense_import_rules')
              .select('id')
              .where('account_id', '=', account_id)

            if (row.rule_edrpou) {
              q = q.where('edrpou', '=', row.rule_edrpou)
            } else {
              q = q.where('edrpou', 'is', null)
            }

            if (row.rule_iban) {
              q = q.where('iban', '=', row.rule_iban)
            } else {
              q = q.where('iban', 'is', null)
            }

            if (row.rule_keyword_pattern) {
              q = q.where('keyword_pattern', '=', row.rule_keyword_pattern)
            } else {
              q = q.where('keyword_pattern', 'is', null)
            }

            const existing = await q.executeTakeFirst()

            if (existing) {
              await db
                .updateTable('expense_import_rules')
                .set({
                  category_id:  row.is_skip_rule ? null : (row.category_id ?? null),
                  is_skip:      row.is_skip_rule ?? false,
                  last_matched_at: new Date(),
                  updated_at:   new Date(),
                })
                .where('id', '=', existing.id)
                .execute()
            } else {
              await db
                .insertInto('expense_import_rules')
                .values({
                  account_id:      account_id,
                  edrpou:          row.rule_edrpou ?? null,
                  iban:            row.rule_iban ?? null,
                  keyword_pattern: row.rule_keyword_pattern ?? null,
                  category_id:     row.is_skip_rule ? null : (row.category_id ?? null),
                  is_skip:         row.is_skip_rule ?? false,
                  match_count:     1,
                  last_matched_at: new Date(),
                })
                .execute()
            }
          }

          // Update match_count for the matched rule (if any)
          if (row.save_rule === false && row.rule_edrpou === undefined) {
            // matched by existing rule — bump count via separate mechanism
          }

        } catch (err) {
          errors.push({ row_index: row.row_index, message: String(err) })
        }
      }

      // Bump match_count for rules used in this import batch
      // (rows that had a matched_rule_id but no new rule creation)
      const ruleIds = rows
        .filter(r => !r.save_rule)
        .map(r => (r as unknown as { matched_rule_id?: string }).matched_rule_id)
        .filter((id): id is string => !!id)

      if (ruleIds.length > 0) {
        const uniqueIds = [...new Set(ruleIds)]
        for (const ruleId of uniqueIds) {
          await db
            .updateTable('expense_import_rules')
            .set({ last_matched_at: new Date() })
            .where('id', '=', ruleId)
            .execute()
        }
      }

      return { imported: imported.length, skipped: 0, errors }
    }
  )
}
