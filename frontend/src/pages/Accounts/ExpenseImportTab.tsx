import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  expenseImportApi,
  type ExpenseBankRow,
  type ExpensePreviewRow,
  type ApplyExpenseRow,
  type ExpenseImportRule,
} from '../../api/expense_import.api'
import { expensesApi, type ExpenseCategory } from '../../api/expenses.api'
import { importTemplatesApi, type ImportTemplate } from '../../api/import_templates.api'

interface Props {
  accountId: string
}

// ─── Excel parsing ─────────────────────────────────────────────────────────────

function parseExcelDate(raw: unknown): string {
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(raw ?? '').trim()
  const parts = s.split('.')
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  return s
}

function normalizeHeader(s: unknown) { return String(s ?? '').trim().toLowerCase() }

function findColIdx(headers: unknown[], name: string | null): number {
  if (!name) return -1
  const n = normalizeHeader(name)
  return headers.findIndex(h => normalizeHeader(h) === n)
}

function readSheetRows(file: File): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', raw: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' }))
      } catch (err) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

function parseExpenseSheet(file: File, template: ImportTemplate | null): Promise<ExpenseBankRow[]> {
  return readSheetRows(file).then((rows) => {
    if (template === null) {
      // Hardcoded PrivatBank debit format
      // Columns: 0=№doc, 1=date, 2=type(Дебет/Кредит), 3=amount, 4=currency, 5=description, 6=edrpou, 7=counterparty, 8=iban, 9=reference
      const result: ExpenseBankRow[] = []
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        const typeCell = String(r[2] ?? '').trim().toLowerCase()
        if (typeCell !== 'дебет' && typeCell !== 'дебит' && typeCell !== 'd' && typeCell !== 'debet') continue
        const rawAmount = parseFloat(String(r[3] ?? '').replace(',', '.'))
        if (isNaN(rawAmount)) continue
        const amount = Math.abs(rawAmount)
        if (amount <= 0) continue

        const edrpouRaw = String(r[6] ?? '').replace(/\D/g, '')
        const ibanRaw = String(r[8] ?? '').replace(/\s/g, '').trim()
        const docNum = String(r[0] ?? '').trim()
        const bankRef = String(r[9] ?? '').trim()

        result.push({
          row_index:         i - 1,
          date:              parseExcelDate(r[1]),
          amount,
          counterparty_name: String(r[7] ?? '').replace(/[\n\r]+/g, ' ').trim(),
          edrpou:            edrpouRaw.length >= 8 ? edrpouRaw : null,
          iban:              ibanRaw.toUpperCase().startsWith('UA') && ibanRaw.length >= 29 ? ibanRaw : null,
          description:       String(r[5] ?? '').replace(/[\n\r]+/g, ' ').trim(),
          doc_number:        docNum || null,
          bank_reference:    bankRef || null,
        })
      }
      return result
    }

    // Template mode
    const headerRow = (rows[template.header_row_index] ?? []) as unknown[]
    const dateIdx         = findColIdx(headerRow, template.col_date)
    const amountIdx       = findColIdx(headerRow, template.col_amount)
    const typeIdx         = findColIdx(headerRow, template.col_type)
    const counterpartyIdx = findColIdx(headerRow, template.col_counterparty)
    const innIdx          = findColIdx(headerRow, template.col_inn)
    const ibanColIdx      = findColIdx(headerRow, template.col_iban)
    const descIdx         = findColIdx(headerRow, template.col_description)
    const docNumIdx       = findColIdx(headerRow, template.col_doc_number ?? null)
    const refIdx          = findColIdx(headerRow, template.col_reference ?? null)

    if (dateIdx === -1) throw new Error(`Колонку "${template.col_date}" не знайдено у файлі`)
    if (amountIdx === -1) throw new Error(`Колонку "${template.col_amount}" не знайдено у файлі`)

    const result: ExpenseBankRow[] = []
    let dataIdx = 0
    for (let i = template.data_start_row_index; i < rows.length; i++) {
      const r = rows[i] as unknown[]
      if (r.every(cell => String(cell ?? '').trim() === '')) continue

      let rawAmount = parseFloat(String(r[amountIdx] ?? '').replace(',', '.'))
      if (isNaN(rawAmount)) continue
      if (template.amount_negate) rawAmount = -rawAmount

      // Filter: only debit (negative original or positive after negate with debit type filter)
      if (typeIdx !== -1 && template.col_type_credit_value) {
        // col_type_credit_value is the DEBIT marker for expense imports
        const typeCell = normalizeHeader(r[typeIdx])
        const debitVal = normalizeHeader(template.col_type_credit_value)
        if (typeCell !== debitVal) continue
      } else {
        // No type column: filter negative amounts only (expenses are outflows)
        if (rawAmount >= 0) continue
      }

      const amount = Math.abs(rawAmount)
      if (amount <= 0) continue

      const innRaw  = innIdx !== -1  ? String(r[innIdx] ?? '').replace(/\D/g, '') : ''
      const ibanRaw = ibanColIdx !== -1 ? String(r[ibanColIdx] ?? '').replace(/\s/g, '').trim() : ''
      const docNum  = docNumIdx !== -1 ? String(r[docNumIdx] ?? '').trim() : ''
      const bankRef = refIdx !== -1 ? String(r[refIdx] ?? '').trim() : ''

      result.push({
        row_index:         dataIdx++,
        date:              parseExcelDate(r[dateIdx]),
        amount,
        counterparty_name: counterpartyIdx !== -1 ? String(r[counterpartyIdx] ?? '').replace(/[\n\r]+/g, ' ').trim() : '',
        edrpou:            innRaw.length >= 8 ? innRaw : null,
        iban:              ibanRaw.toUpperCase().startsWith('UA') && ibanRaw.length >= 29 ? ibanRaw : null,
        description:       descIdx !== -1 ? String(r[descIdx] ?? '').replace(/[\n\r]+/g, ' ').trim() : '',
        doc_number:        docNum || null,
        bank_reference:    bankRef || null,
      })
    }
    return result
  })
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ExpensePreviewRow['status'] }) {
  const map: Record<ExpensePreviewRow['status'], { label: string; cls: string }> = {
    matched:   { label: 'Класифіковано',  cls: 'bg-green-100 text-green-800' },
    unmatched: { label: 'Не розпізнано',  cls: 'bg-gray-100 text-gray-600' },
    skip:      { label: 'Пропустити',     cls: 'bg-blue-100 text-blue-700' },
    duplicate: { label: 'Дублікат',       cls: 'bg-amber-100 text-amber-800' },
  }
  const { label, cls } = map[status]
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

// ─── Category helpers ──────────────────────────────────────────────────────────

function buildCategoryTree(cats: ExpenseCategory[]) {
  const parents = cats.filter(c => !c.parent_id && c.is_active)
  const children = cats.filter(c => c.parent_id && c.is_active)
  return parents.map(p => ({
    ...p,
    children: children.filter(c => c.parent_id === p.id),
  }))
}

function CategoryPicker({
  categories,
  value,
  onChange,
  placeholder,
}: {
  categories: ExpenseCategory[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
}) {
  const tree = buildCategoryTree(categories)
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500"
    >
      <option value="">{placeholder ?? '— оберіть категорію —'}</option>
      {tree.map(parent => (
        parent.children.length > 0 ? (
          <optgroup key={parent.id} label={parent.name}>
            {parent.children.map(child => (
              <option key={child.id} value={child.id}>{child.name}</option>
            ))}
          </optgroup>
        ) : (
          <option key={parent.id} value={parent.id}>{parent.name}</option>
        )
      ))}
    </select>
  )
}

// ─── Classify dialog ───────────────────────────────────────────────────────────

interface ClassifyState {
  rowIndex: number
  categoryId: string | null
  isSkip: boolean
  saveRule: boolean
  ruleEdrpou: string
  ruleIban: string
  ruleKeywords: string
}

function ClassifyDialog({
  row,
  categories,
  onSave,
  onCancel,
}: {
  row: ExpensePreviewRow
  categories: ExpenseCategory[]
  onSave: (state: ClassifyState) => void
  onCancel: () => void
}) {
  const [state, setState] = useState<ClassifyState>({
    rowIndex:     row.row_index,
    categoryId:   row.matched_category_id,
    isSkip:       row.status === 'skip',
    saveRule:     true,
    ruleEdrpou:   row.edrpou ?? '',
    ruleIban:     row.iban ?? '',
    ruleKeywords: '',
  })

  const catName = categories.find(c => c.id === state.categoryId)?.name ?? ''

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg space-y-4 p-5">
        <h3 className="text-sm font-semibold text-gray-900">Класифікація витрати</h3>

        {/* Row info */}
        <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
          <div className="flex gap-4">
            <span className="text-gray-500">Дата:</span>
            <span className="font-medium">{new Date(row.date).toLocaleDateString('uk-UA')}</span>
            <span className="text-gray-500 ml-4">Сума:</span>
            <span className="font-medium text-red-600">{row.amount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 shrink-0">Контрагент:</span>
            <span className="text-gray-800 truncate">{row.counterparty_name || '—'}</span>
          </div>
          {row.edrpou && (
            <div className="flex gap-2">
              <span className="text-gray-500 shrink-0">ЄДРПОУ:</span>
              <span className="font-mono text-gray-700">{row.edrpou}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-gray-500 shrink-0">Призначення:</span>
            <span className="text-gray-600 text-xs leading-relaxed line-clamp-2">{row.description || '—'}</span>
          </div>
        </div>

        {/* Skip toggle */}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={state.isSkip}
            onChange={e => setState(s => ({ ...s, isSkip: e.target.checked, categoryId: null }))}
          />
          <span className="text-gray-700">Завжди пропускати цей тип транзакцій</span>
        </label>

        {/* Category picker */}
        {!state.isSkip && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Категорія витрати</label>
            <CategoryPicker
              categories={categories}
              value={state.categoryId}
              onChange={id => setState(s => ({ ...s, categoryId: id }))}
            />
          </div>
        )}

        {/* Save rule */}
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={state.saveRule}
              onChange={e => setState(s => ({ ...s, saveRule: e.target.checked }))}
            />
            <span className="text-gray-700">Запам'ятати правило для наступних імпортів</span>
          </label>

          {state.saveRule && (
            <div className="bg-iris-50 rounded-lg p-3 space-y-2 text-xs">
              <p className="text-iris-700 font-medium">Умови розпізнавання:</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-gray-500 mb-0.5">ЄДРПОУ</label>
                  <input
                    type="text"
                    value={state.ruleEdrpou}
                    onChange={e => setState(s => ({ ...s, ruleEdrpou: e.target.value }))}
                    placeholder="необов'язково"
                    className="w-full border border-gray-300 rounded px-2 py-1 focus:border-iris-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 mb-0.5">IBAN контрагента</label>
                  <input
                    type="text"
                    value={state.ruleIban}
                    onChange={e => setState(s => ({ ...s, ruleIban: e.target.value }))}
                    placeholder="необов'язково"
                    className="w-full border border-gray-300 rounded px-2 py-1 focus:border-iris-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-500 mb-0.5">Ключові слова в призначенні платежу (через пробіл)</label>
                <input
                  type="text"
                  value={state.ruleKeywords}
                  onChange={e => setState(s => ({ ...s, ruleKeywords: e.target.value }))}
                  placeholder="напр. EPITCENTR ремонт"
                  className="w-full border border-gray-300 rounded px-2 py-1 focus:border-iris-500"
                />
                <p className="text-gray-400 mt-0.5">Всі введені слова мають бути в призначенні платежу</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="text-xs px-4 py-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
          >
            Скасувати
          </button>
          <button
            onClick={() => {
              if (!state.isSkip && !state.categoryId) return
              onSave(state)
            }}
            disabled={!state.isSkip && !state.categoryId}
            className="text-xs px-4 py-1.5 bg-iris-600 hover:bg-iris-700 text-white rounded-md disabled:opacity-50 transition-colors"
          >
            {state.isSkip ? 'Пропустити' : `Рознести: ${catName}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Rules view ────────────────────────────────────────────────────────────────

function RulesView({
  accountId,
  onBack,
}: {
  accountId: string
  onBack: () => void
}) {
  const qc = useQueryClient()
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['expense-import-rules', accountId],
    queryFn: () => expenseImportApi.listRules(accountId),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseImportApi.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-import-rules', accountId] }),
  })

  function getCategoryLabel(rule: ExpenseImportRule) {
    if (rule.is_skip) return <span className="text-blue-600 font-medium">Пропустити</span>
    if (!rule.category_name) return <span className="text-gray-400">—</span>
    return (
      <span className="text-gray-700">
        {rule.parent_category_name && <span className="text-gray-400">{rule.parent_category_name} → </span>}
        {rule.category_name}
      </span>
    )
  }

  function getRuleCondition(rule: ExpenseImportRule) {
    const parts: string[] = []
    if (rule.edrpou) parts.push(`ЄДРПОУ: ${rule.edrpou}`)
    if (rule.iban) parts.push(`IBAN: ${rule.iban}`)
    if (rule.keyword_pattern) parts.push(`Слова: "${rule.keyword_pattern}"`)
    return parts.join(', ') || <span className="text-gray-400">—</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700">← Назад</button>
        <h3 className="text-sm font-semibold text-gray-800">Правила розпізнавання витрат</h3>
        <span className="ml-auto text-xs text-gray-400">{rules.length} правил</span>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">Завантаження...</div>
      ) : rules.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          Правил ще немає. Вони з'являться після першого класифікованого імпорту.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Умова</th>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Категорія</th>
              <th className="text-right px-4 py-2 text-gray-500 font-medium">Спрацювань</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map(rule => (
              <tr key={rule.id} className="hover:bg-gray-50 group">
                <td className="px-4 py-2.5 text-gray-600">{getRuleCondition(rule)}</td>
                <td className="px-4 py-2.5">{getCategoryLabel(rule)}</td>
                <td className="px-4 py-2.5 text-right text-gray-400">{rule.match_count}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => {
                      if (window.confirm('Видалити це правило?')) {
                        deleteMutation.mutate(rule.id)
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

type View = 'import' | 'rules'

export function ExpenseImportTab({ accountId }: Props) {
  const [view, setView]               = useState<View>('import')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [parseError, setParseError]   = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<ExpensePreviewRow[] | null>(null)
  const [checked, setChecked]         = useState<Set<number>>(new Set())
  const [overrides, setOverrides]     = useState<Map<number, { categoryId: string | null; isSkip: boolean; saveRule: boolean; ruleEdrpou: string; ruleIban: string; ruleKeywords: string }>>(new Map())
  const [classifyRow, setClassifyRow] = useState<ExpensePreviewRow | null>(null)
  const [result, setResult]           = useState<{ imported: number; errors: { row_index: number; message: string }[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: templates = [] } = useQuery({
    queryKey: ['import-templates'],
    queryFn: importTemplatesApi.list,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: expensesApi.getCategories,
  })

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null

  const previewMutation = useMutation({
    mutationFn: (rows: ExpenseBankRow[]) => expenseImportApi.preview(accountId, rows),
    onSuccess: (resp) => {
      const rows = resp.rows
      setPreviewRows(rows)
      const defaultChecked = new Set<number>()
      for (const r of rows) {
        if (r.status === 'matched') defaultChecked.add(r.row_index)
      }
      setChecked(defaultChecked)
      setOverrides(new Map())
      setResult(null)
    },
    onError: () => setParseError('Помилка сервера при аналізі рядків'),
  })

  const applyMutation = useMutation({
    mutationFn: (rows: ApplyExpenseRow[]) => expenseImportApi.apply(accountId, rows),
    onSuccess: (resp) => {
      setResult({ imported: resp.imported, errors: resp.errors })
      setPreviewRows(null)
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['account-ledger', accountId] })
      qc.invalidateQueries({ queryKey: ['account', accountId] })
      qc.invalidateQueries({ queryKey: ['expense-import-rules', accountId] })
    },
  })

  async function handleFile(file: File) {
    setParseError(null)
    setPreviewRows(null)
    setResult(null)
    try {
      const rows = await parseExpenseSheet(file, selectedTemplate)
      if (rows.length === 0) {
        setParseError('У файлі не знайдено жодного дебетового рядка із ненульовою сумою')
        return
      }
      previewMutation.mutate(rows)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Не вдалося прочитати файл (.xlsx або .xls)')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function getEffectiveRow(row: ExpensePreviewRow) {
    const ov = overrides.get(row.row_index)
    return {
      categoryId:   ov?.categoryId   ?? row.matched_category_id,
      isSkip:       ov?.isSkip       ?? (row.status === 'skip'),
      saveRule:     ov?.saveRule     ?? false,
      ruleEdrpou:   ov?.ruleEdrpou   ?? '',
      ruleIban:     ov?.ruleIban     ?? '',
      ruleKeywords: ov?.ruleKeywords ?? '',
    }
  }

  function handleApply() {
    if (!previewRows) return
    const applyRows: ApplyExpenseRow[] = []

    for (const row of previewRows) {
      if (!checked.has(row.row_index)) continue
      const eff = getEffectiveRow(row)
      if (eff.isSkip) continue

      applyRows.push({
        row_index:             row.row_index,
        date:                  row.date,
        amount:                row.amount,
        counterparty_name:     row.counterparty_name,
        edrpou:                row.edrpou,
        iban:                  row.iban,
        description:           row.description,
        doc_number:            row.doc_number,
        bank_reference:        row.bank_reference,
        bank_ref:              row.bank_ref,
        category_id:           eff.categoryId,
        matched_rule_id:       row.matched_rule_id,
        save_rule:             eff.saveRule,
        rule_edrpou:           eff.ruleEdrpou || null,
        rule_iban:             eff.ruleIban || null,
        rule_keyword_pattern:  eff.ruleKeywords || null,
        is_skip_rule:          false,
      })
    }

    if (applyRows.length === 0) return
    applyMutation.mutate(applyRows)
  }

  const allRows = previewRows ?? []
  const importableRows = allRows.filter(r => r.status !== 'duplicate')
  const checkedCount = [...checked].filter(idx => {
    const row = allRows.find(r => r.row_index === idx)
    const eff = row ? getEffectiveRow(row) : null
    return row && !eff?.isSkip
  }).length

  const allImportableChecked = importableRows.length > 0 &&
    importableRows.every(r => checked.has(r.row_index))

  if (view === 'rules') {
    return (
      <RulesView
        accountId={accountId}
        onBack={() => setView('import')}
      />
    )
  }

  return (
    <div className="space-y-0">
      {/* Header toolbar */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-800">Імпорт витрат з виписки</h3>
        <button
          onClick={() => setView('rules')}
          className="ml-auto text-xs text-iris-600 hover:text-iris-800 transition-colors"
        >
          Правила розпізнавання →
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Template selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500 shrink-0">Шаблон виписки:</label>
          <select
            value={selectedTemplateId ?? ''}
            onChange={e => setSelectedTemplateId(e.target.value || null)}
            className="text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500"
          >
            <option value="">ПриватБанк (за замовчуванням)</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Upload zone */}
        {!previewRows && !previewMutation.isPending && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-iris-300 hover:bg-iris-50 transition-colors"
          >
            <div className="text-3xl mb-2">📂</div>
            <p className="text-sm text-gray-600 font-medium">Перетягніть файл виписки або натисніть</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx або .xls — тільки дебетові операції</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>
        )}

        {previewMutation.isPending && (
          <div className="py-8 text-center text-sm text-gray-400">Аналіз файлу...</div>
        )}

        {parseError && (
          <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{parseError}</div>
        )}

        {/* Result */}
        {result && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm">
            <p className="font-medium text-green-800">
              Імпортовано: {result.imported} витрат
            </p>
            {result.errors.length > 0 && (
              <p className="text-red-600 text-xs mt-1">Помилки: {result.errors.length}</p>
            )}
            <button
              onClick={() => { setResult(null); setPreviewRows(null) }}
              className="mt-2 text-xs text-green-700 underline hover:no-underline"
            >
              Завантажити ще одну виписку
            </button>
          </div>
        )}

        {/* Preview table */}
        {previewRows && (
          <div className="space-y-3">
            {/* Stats */}
            <div className="flex flex-wrap gap-3 text-xs">
              {(['matched', 'unmatched', 'skip', 'duplicate'] as const).map(s => {
                const count = previewRows.filter(r => r.status === s).length
                if (count === 0) return null
                const labels = { matched: 'Класифіковано', unmatched: 'Не розпізнано', skip: 'Пропустити', duplicate: 'Дублікати' }
                const colors = { matched: 'text-green-700', unmatched: 'text-gray-600', skip: 'text-blue-600', duplicate: 'text-amber-700' }
                return (
                  <span key={s} className={colors[s]}>
                    {labels[s]}: <b>{count}</b>
                  </span>
                )
              })}
            </div>

            {/* Table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        <input
                          type="checkbox"
                          checked={allImportableChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setChecked(new Set(importableRows.map(r => r.row_index)))
                            } else {
                              setChecked(new Set())
                            }
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Дата</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-medium">Сума</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Контрагент / Призначення</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Статус</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Категорія</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map(row => {
                      const eff = getEffectiveRow(row)
                      const isDuplicate = row.status === 'duplicate'
                      const isChecked = checked.has(row.row_index)
                      const hasOverride = overrides.has(row.row_index)
                      const displayStatus = hasOverride
                        ? (eff.isSkip ? 'skip' : 'matched')
                        : row.status

                      return (
                        <tr
                          key={row.row_index}
                          className={`${isDuplicate ? 'opacity-40' : 'hover:bg-gray-50'} transition-colors`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isDuplicate}
                              onChange={e => {
                                const next = new Set(checked)
                                if (e.target.checked) next.add(row.row_index)
                                else next.delete(row.row_index)
                                setChecked(next)
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap tabular-nums">
                            {new Date(row.date).toLocaleDateString('uk-UA')}
                          </td>
                          <td className="px-3 py-2 text-right text-red-600 font-medium tabular-nums whitespace-nowrap">
                            {row.amount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                          </td>
                          <td className="px-3 py-2 max-w-xs">
                            <div className="truncate text-gray-800">{row.counterparty_name || '—'}</div>
                            {row.description && (
                              <div className="truncate text-gray-400 mt-0.5" title={row.description}>{row.description}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <StatusBadge status={displayStatus} />
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {eff.isSkip
                              ? <span className="text-blue-500 text-xs">пропустити</span>
                              : eff.categoryId
                                ? <span className="text-gray-700">{
                                    hasOverride
                                      ? (categories.find(c => c.id === eff.categoryId)?.name ?? '—')
                                      : (row.matched_category_name ?? '—')
                                  }</span>
                                : <span className="text-gray-400">—</span>
                            }
                          </td>
                          <td className="px-3 py-2">
                            {!isDuplicate && (
                              <button
                                onClick={() => setClassifyRow(row)}
                                className="text-xs text-iris-600 hover:text-iris-800 whitespace-nowrap transition-colors"
                              >
                                {row.status === 'unmatched' ? 'Класифікувати' : 'Змінити'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => { setPreviewRows(null); setParseError(null) }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Завантажити інший файл
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  Вибрано до імпорту: <b>{checkedCount}</b>
                </span>
                <button
                  onClick={handleApply}
                  disabled={checkedCount === 0 || applyMutation.isPending}
                  className="text-xs px-4 py-1.5 bg-iris-600 hover:bg-iris-700 text-white rounded-md disabled:opacity-50 transition-colors"
                >
                  {applyMutation.isPending ? 'Зберігається...' : `Імпортувати (${checkedCount})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Classify dialog */}
      {classifyRow && (
        <ClassifyDialog
          row={classifyRow}
          categories={categories}
          onSave={(state) => {
            setOverrides(prev => {
              const next = new Map(prev)
              next.set(state.rowIndex, {
                categoryId:   state.categoryId,
                isSkip:       state.isSkip,
                saveRule:     state.saveRule,
                ruleEdrpou:   state.ruleEdrpou,
                ruleIban:     state.ruleIban,
                ruleKeywords: state.ruleKeywords,
              })
              return next
            })
            // Auto-check the row
            setChecked(prev => {
              const next = new Set(prev)
              if (!state.isSkip) next.add(state.rowIndex)
              else next.delete(state.rowIndex)
              return next
            })
            setClassifyRow(null)
          }}
          onCancel={() => setClassifyRow(null)}
        />
      )}
    </div>
  )
}
