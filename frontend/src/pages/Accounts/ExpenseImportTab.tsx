import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  expenseImportApi,
  type ExpenseBankRow,
  type ExpensePreviewRow,
  type ApplyExpenseRow,
} from '../../api/expense_import.api'
import { expensesApi, type ExpenseCategory } from '../../api/expenses.api'
import {
  importTemplatesApi,
  type ImportTemplate,
  type ImportTemplateInput,
} from '../../api/import_templates.api'

interface Props {
  accountId: string
}

// ─── Excel helpers ─────────────────────────────────────────────────────────────

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

function normalizeHeader(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')                          // canonical form, fixes e.g. full-width chars
    .replace(/[   -​  　﻿]/g, ' ') // all Unicode spaces → space
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function findColIdx(headers: unknown[], name: string | null): number {
  if (!name) return -1
  const n = normalizeHeader(name)
  return headers.findIndex(h => normalizeHeader(h) === n)
}

export function readSheetRows(file: File): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb   = XLSX.read(data, { type: 'array', raw: true })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const ref = ws['!ref']
        if (!ref) { resolve([]); return }
        const range = XLSX.utils.decode_range(ref)
        const result: unknown[][] = []

        // Read every row 0..range.e.r so result[i] always = 0-indexed Excel row i.
        // We cannot rely on sheet_to_json because it skips physically-empty rows (no
        // cells defined in the XML), which causes an off-by-one when the file's used
        // range starts at row 2 but row 1 is empty.
        for (let r = 0; r <= range.e.r; r++) {
          if (r < range.s.r) {
            result.push([])   // before used range
          } else {
            const row: unknown[] = []
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c })]
              row.push(cell != null ? cell.v : '')
            }
            result.push(row)
          }
        }
        resolve(result)
      } catch (err) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

function parseExpenseSheet(file: File, template: ImportTemplate | null): Promise<ExpenseBankRow[]> {
  return readSheetRows(file).then((rows) => {
    if (template === null) {
      // Built-in PrivatBank format (no template selected)
      // Filter: negative amounts only (expenses = debits)
      // Cols: 0=№doc, 1=date, 2=Ч, 3=amount, 4=currency, 5=description, 6=edrpou, 7=counterparty, 8=iban, 9=reference
      const result: ExpenseBankRow[] = []
      let dataIdx = 0
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        if (r.every(cell => String(cell ?? '').trim() === '')) continue
        const rawAmount = parseFloat(String(r[3] ?? '').replace(',', '.'))
        if (isNaN(rawAmount) || rawAmount >= 0) continue   // skip income (positive) rows
        const amount = Math.abs(rawAmount)
        const edrpouRaw = String(r[6] ?? '').replace(/\D/g, '')
        const ibanRaw   = String(r[8] ?? '').replace(/\s/g, '').trim()
        result.push({
          row_index:         dataIdx++,
          date:              parseExcelDate(r[1]),
          amount,
          counterparty_name: String(r[7] ?? '').replace(/[\n\r]+/g, ' ').trim(),
          edrpou:            edrpouRaw.length >= 8 ? edrpouRaw : null,
          iban:              ibanRaw.toUpperCase().startsWith('UA') && ibanRaw.length >= 29 ? ibanRaw : null,
          description:       String(r[5] ?? '').replace(/[\n\r]+/g, ' ').trim(),
          doc_number:        String(r[0] ?? '').trim() || null,
          bank_reference:    String(r[9] ?? '').trim() || null,
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

    const foundHeaders = headerRow
      .map(h => String(h ?? '').trim())
      .filter(Boolean)
      .join(' | ')

    if (dateIdx === -1) throw new Error(
      `Колонку «${template.col_date}» не знайдено у файлі.\n` +
      `Знайдені колонки (рядок ${template.header_row_index}): ${foundHeaders || '(порожній рядок)'}`
    )
    if (amountIdx === -1) throw new Error(
      `Колонку «${template.col_amount}» не знайдено у файлі.\n` +
      `Знайдені колонки (рядок ${template.header_row_index}): ${foundHeaders || '(порожній рядок)'}`
    )

    const result: ExpenseBankRow[] = []
    let dataIdx = 0
    for (let i = template.data_start_row_index; i < rows.length; i++) {
      const r = rows[i] as unknown[]
      if (r.every(cell => String(cell ?? '').trim() === '')) continue

      let rawAmount = parseFloat(String(r[amountIdx] ?? '').replace(',', '.'))
      if (isNaN(rawAmount)) continue
      if (template.amount_negate) rawAmount = -rawAmount

      if (typeIdx !== -1 && template.col_type_credit_value) {
        // col_type_credit_value stores the DEBIT marker for expense templates
        const typeCell = normalizeHeader(r[typeIdx])
        const debitVal = normalizeHeader(template.col_type_credit_value)
        if (typeCell !== debitVal) continue
      } else {
        // No type column → filter by sign (debit = negative before negation)
        if (rawAmount >= 0) continue
      }

      const amount = Math.abs(rawAmount)
      if (amount <= 0) continue

      const innRaw  = innIdx !== -1  ? String(r[innIdx]  ?? '').replace(/\D/g, '') : ''
      const ibanRaw = ibanColIdx !== -1 ? String(r[ibanColIdx] ?? '').replace(/\s/g, '').trim() : ''
      const docNum  = docNumIdx !== -1 ? String(r[docNumIdx] ?? '').trim() : ''
      const bankRef = refIdx !== -1    ? String(r[refIdx]    ?? '').trim() : ''

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

// ─── Template editor config ────────────────────────────────────────────────────

const EMPTY_TEMPLATE: ImportTemplateInput = {
  name: '', description: null,
  header_row_index: 1, data_start_row_index: 2,
  col_date: '', col_amount: '',
  col_type: null, col_type_credit_value: null,
  col_counterparty: null, col_inn: null,
  col_iban: null, col_description: null,
  col_doc_number: null, col_reference: null,
  amount_negate: false,
}

const EXPENSE_COL_FIELDS: { key: keyof ImportTemplateInput; label: string; required?: boolean; hint?: string }[] = [
  { key: 'col_date',              label: 'Дата',                    required: true },
  { key: 'col_amount',            label: 'Сума',                    required: true },
  { key: 'col_type',              label: 'Тип операції',            hint: 'колонка з "Дебет"/"Кредит"' },
  { key: 'col_type_credit_value', label: 'Значення типу «Дебет»',  hint: 'напр. Дебет або D' },
  { key: 'col_counterparty',      label: 'Контрагент' },
  { key: 'col_inn',               label: 'ЄДРПОУ / ІНН' },
  { key: 'col_iban',              label: 'IBAN контрагента' },
  { key: 'col_description',       label: 'Призначення платежу' },
  { key: 'col_doc_number',        label: '№ документу',            hint: 'для контролю дублів' },
  { key: 'col_reference',         label: 'Референс банку',         hint: 'для контролю дублів' },
]

// ─── Template list ─────────────────────────────────────────────────────────────

function TemplatesListView({
  templates, onBack, onNew, onEdit, onDeleted,
}: {
  templates: ImportTemplate[]
  onBack: () => void
  onNew: () => void
  onEdit: (t: ImportTemplate) => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('Видалити шаблон?')) return
    setDeleting(id)
    try { await importTemplatesApi.delete(id); onDeleted() }
    finally { setDeleting(null) }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-900">← Назад до імпорту</button>
        <button onClick={onNew} className="text-sm px-3 py-1.5 bg-iris-600 hover:bg-iris-700 text-white rounded-lg transition-colors">
          + Новий шаблон
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Шаблони описують структуру файлу виписки (яка колонка = яке поле).
        Для витрат у полі «Значення типу Дебет» вкажіть значення, яке відповідає видатковим операціям.
      </p>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-400">Шаблони ще не створено. Натисніть «+ Новий шаблон» щоб розпочати.</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">Назва</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 hidden sm:table-cell">Опис</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Рядок заголовка</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs hidden sm:table-cell">{t.description ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">Рядок {t.header_row_index}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => onEdit(t)} className="text-xs text-iris-600 hover:text-iris-700">Редагувати</button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                      >Видалити</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Template editor ───────────────────────────────────────────────────────────

function TemplateEditorView({
  initial, onSaved, onCancel,
}: {
  initial: ImportTemplate | null
  onSaved: (t: ImportTemplate) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<ImportTemplateInput>(
    initial
      ? {
          name: initial.name, description: initial.description,
          header_row_index: initial.header_row_index, data_start_row_index: initial.data_start_row_index,
          col_date: initial.col_date, col_amount: initial.col_amount,
          col_type: initial.col_type, col_type_credit_value: initial.col_type_credit_value,
          col_counterparty: initial.col_counterparty, col_inn: initial.col_inn,
          col_iban: initial.col_iban, col_description: initial.col_description,
          col_doc_number: initial.col_doc_number ?? null,
          col_reference: initial.col_reference ?? null,
          amount_negate: initial.amount_negate,
        }
      : { ...EMPTY_TEMPLATE }
  )
  const [sampleHeaders, setSampleHeaders] = useState<string[]>([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const sampleFileRef = useRef<HTMLInputElement>(null)

  async function handleSampleFile(file: File) {
    try {
      const rows = await readSheetRows(file)
      const headerRow = (rows[form.header_row_index] ?? []) as unknown[]
      setSampleHeaders(headerRow.map(h => String(h ?? '').trim()).filter(Boolean))
    } catch { /* ignore */ }
  }

  function setField<K extends keyof ImportTemplateInput>(key: K, value: ImportTemplateInput[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function setColField(key: keyof ImportTemplateInput, value: string) {
    setForm(f => ({ ...f, [key]: value || null }))
  }

  async function handleSave() {
    setError(null)
    if (!form.name.trim())       { setError('Назва обовʼязкова'); return }
    if (!form.col_date.trim())   { setError('Колонка «Дата» обовʼязкова'); return }
    if (!form.col_amount.trim()) { setError('Колонка «Сума» обовʼязкова'); return }
    setSaving(true)
    try {
      const saved = initial
        ? await importTemplatesApi.update(initial.id, form)
        : await importTemplatesApi.create(form)
      onSaved(saved)
    } catch { setError('Помилка збереження') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-900">
        {initial ? 'Редагування шаблону' : 'Новий шаблон'}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Назва *</label>
          <input type="text" value={form.name}
            onChange={e => setField('name', e.target.value)}
            placeholder="напр. ПриватБанк витрати"
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Опис</label>
          <input type="text" value={form.description ?? ''}
            onChange={e => setField('description', e.target.value || null)}
            placeholder="Необовʼязковий опис"
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Рядок заголовків
            <span className="font-normal text-gray-400 ml-1">(Excel рядок − 1)</span>
          </label>
          <input type="number" min={0} value={form.header_row_index}
            onChange={e => { setField('header_row_index', Number(e.target.value)); setSampleHeaders([]) }}
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          <p className="text-xs text-gray-400 mt-0.5">Напр. Excel рядок 13 → введіть 12</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Перший рядок даних
            <span className="font-normal text-gray-400 ml-1">(Excel рядок − 1)</span>
          </label>
          <input type="number" min={0} value={form.data_start_row_index}
            onChange={e => setField('data_start_row_index', Number(e.target.value))}
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          <p className="text-xs text-gray-400 mt-0.5">Зазвичай = рядок заголовків + 1</p>
        </div>
      </div>

      {/* Sample file upload */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
        <p className="text-xs font-semibold text-amber-800">Крок 1 — завантажте зразок файлу виписки</p>
        <p className="text-xs text-amber-700">
          Завантажте файл виписки, щоб система автоматично знайшла назви колонок.
          Тоді у полях нижче замість ручного вводу з'явиться зручний список.
        </p>
        <button
          type="button"
          onClick={() => sampleFileRef.current?.click()}
          className="text-xs text-amber-700 border border-amber-400 bg-white hover:bg-amber-50 rounded px-3 py-1.5 transition-colors"
        >
          📂 Обрати файл виписки (.xlsx / .xls)
        </button>
        <input ref={sampleFileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleSampleFile(e.target.files[0]) }} />
        {sampleHeaders.length > 0 && (
          <div className="text-xs text-amber-800 bg-amber-100 rounded px-3 py-2">
            <span className="font-medium">Знайдено колонки:</span>{' '}
            {sampleHeaders.map((h, i) => (
              <span key={i} className="inline-block mr-1 px-1 bg-white border border-amber-300 rounded">{h}</span>
            ))}
          </div>
        )}
      </div>

      {/* Column mapping */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Крок 2 — вкажіть відповідність колонок
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EXPENSE_COL_FIELDS.map(({ key, label, required, hint }) => {
            const value = ((form[key] as string | null) ?? '')
            return (
              <div key={String(key)}>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {label}{required && ' *'}
                  {hint && <span className="font-normal text-gray-400 ml-1">({hint})</span>}
                </label>
                {sampleHeaders.length > 0 ? (
                  <select
                    value={value}
                    onChange={e => setColField(key, e.target.value)}
                    className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
                  >
                    <option value="">— не використовувати —</option>
                    {sampleHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                ) : (
                  <input type="text" value={value}
                    onChange={e => setColField(key, e.target.value)}
                    placeholder="Назва колонки..."
                    className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={form.amount_negate}
          onChange={e => setField('amount_negate', e.target.checked)}
          className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
        <span className="text-gray-700">Витрати мають від'ємний знак у файлі</span>
        <span className="text-xs text-gray-400">(у більшості виписок так)</span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          {saving ? 'Збереження...' : 'Зберегти шаблон'}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-900">Скасувати</button>
      </div>
    </div>
  )
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

// ─── Category picker ───────────────────────────────────────────────────────────

function buildCategoryTree(cats: ExpenseCategory[]) {
  const parents  = cats.filter(c => !c.parent_id && c.is_active)
  const children = cats.filter(c => c.parent_id  && c.is_active)
  return parents.map(p => ({ ...p, children: children.filter(c => c.parent_id === p.id) }))
}

function CategoryPicker({
  categories, value, onChange, placeholder,
}: {
  categories: ExpenseCategory[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
}) {
  const tree = buildCategoryTree(categories)
  return (
    <select value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500">
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
  rowIndex:     number
  categoryId:   string | null
  isSkip:       boolean
  saveRule:     boolean
  ruleEdrpou:   string
  ruleIban:     string
  ruleKeywords: string
}

function ClassifyDialog({
  row, categories, onSave, onCancel,
}: {
  row:        ExpensePreviewRow
  categories: ExpenseCategory[]
  onSave:     (state: ClassifyState) => void
  onCancel:   () => void
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

  const catLabel = (() => {
    const c = categories.find(c => c.id === state.categoryId)
    if (!c) return ''
    const p = categories.find(p => p.id === c.parent_id)
    return p ? `${p.name} → ${c.name}` : c.name
  })()

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg space-y-4 p-5">
        <h3 className="text-sm font-semibold text-gray-900">Класифікація витрати</h3>

        <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
          <div className="flex gap-4 flex-wrap">
            <span><span className="text-gray-500">Дата:</span> <b>{new Date(row.date).toLocaleDateString('uk-UA')}</b></span>
            <span><span className="text-gray-500">Сума:</span> <b className="text-red-600">{row.amount.toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴</b></span>
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
          {row.description && (
            <div className="flex gap-2">
              <span className="text-gray-500 shrink-0">Призначення:</span>
              <span className="text-gray-600 line-clamp-2">{row.description}</span>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={state.isSkip}
            onChange={e => setState(s => ({ ...s, isSkip: e.target.checked, categoryId: null }))} />
          <span className="text-gray-700">Завжди пропускати цей тип транзакцій</span>
        </label>

        {!state.isSkip && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Категорія витрати</label>
            <CategoryPicker categories={categories} value={state.categoryId}
              onChange={id => setState(s => ({ ...s, categoryId: id }))} />
          </div>
        )}

        <div className="border-t border-gray-100 pt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={state.saveRule}
              onChange={e => setState(s => ({ ...s, saveRule: e.target.checked }))} />
            <span className="text-gray-700">Запам'ятати правило для наступних імпортів</span>
          </label>

          {state.saveRule && (
            <div className="bg-iris-50 rounded-lg p-3 space-y-2 text-xs">
              <p className="text-iris-700 font-medium">Умови розпізнавання (заповніть потрібні):</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-gray-500 mb-0.5">ЄДРПОУ</label>
                  <input type="text" value={state.ruleEdrpou}
                    onChange={e => setState(s => ({ ...s, ruleEdrpou: e.target.value }))}
                    placeholder="необов'язково"
                    className="w-full border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                </div>
                <div>
                  <label className="block text-gray-500 mb-0.5">IBAN контрагента</label>
                  <input type="text" value={state.ruleIban}
                    onChange={e => setState(s => ({ ...s, ruleIban: e.target.value }))}
                    placeholder="необов'язково"
                    className="w-full border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                </div>
              </div>
              <div>
                <label className="block text-gray-500 mb-0.5">Ключові слова в призначенні (через пробіл)</label>
                <input type="text" value={state.ruleKeywords}
                  onChange={e => setState(s => ({ ...s, ruleKeywords: e.target.value }))}
                  placeholder="напр. EPITCENTR ремонт"
                  className="w-full border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                <p className="text-gray-400 mt-0.5">Всі слова мають бути присутні в призначенні платежу</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel}
            className="text-xs px-4 py-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors">
            Скасувати
          </button>
          <button
            onClick={() => { if (!state.isSkip && !state.categoryId) return; onSave(state) }}
            disabled={!state.isSkip && !state.categoryId}
            className="text-xs px-4 py-1.5 bg-iris-600 hover:bg-iris-700 text-white rounded-md disabled:opacity-50 transition-colors">
            {state.isSkip ? 'Пропустити' : `Рознести: ${catLabel}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Rules view ────────────────────────────────────────────────────────────────

function RulesView({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['expense-import-rules', accountId],
    queryFn: () => expenseImportApi.listRules(accountId),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseImportApi.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-import-rules', accountId] }),
  })

  return (
    <div className="space-y-0">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700">← Назад</button>
        <h3 className="text-sm font-semibold text-gray-800">Правила розпізнавання витрат</h3>
        <span className="ml-auto text-xs text-gray-400">{rules.length} правил</span>
      </div>
      <div className="p-4">
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
              {rules.map(rule => {
                const parts: string[] = []
                if (rule.edrpou) parts.push(`ЄДРПОУ: ${rule.edrpou}`)
                if (rule.iban) parts.push(`IBAN: ${rule.iban}`)
                if (rule.keyword_pattern) parts.push(`Слова: "${rule.keyword_pattern}"`)
                const catLabel = rule.is_skip
                  ? <span className="text-blue-600 font-medium">Пропустити</span>
                  : rule.parent_category_name
                    ? <span><span className="text-gray-400">{rule.parent_category_name} → </span>{rule.category_name}</span>
                    : <span>{rule.category_name ?? '—'}</span>
                return (
                  <tr key={rule.id} className="hover:bg-gray-50 group">
                    <td className="px-4 py-2.5 text-gray-600">{parts.join(', ') || '—'}</td>
                    <td className="px-4 py-2.5">{catLabel}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{rule.match_count}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => { if (confirm('Видалити правило?')) deleteMutation.mutate(rule.id) }}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

type View = 'import' | 'templates' | 'editor' | 'rules'

export function ExpenseImportTab({ accountId }: Props) {
  const [view, setView]               = useState<View>('import')
  const [editingTemplate, setEditingTemplate] = useState<ImportTemplate | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [parseError, setParseError]   = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<ExpensePreviewRow[] | null>(null)
  const [checked, setChecked]         = useState<Set<number>>(new Set())
  const [overrides, setOverrides]     = useState<Map<number, ClassifyState>>(new Map())
  const [classifyRow, setClassifyRow] = useState<ExpensePreviewRow | null>(null)
  const [result, setResult]           = useState<{ imported: number; errors: { row_index: number; message: string }[] } | null>(null)
  const [scanRows, setScanRows]       = useState<{ rowIdx: number; headers: string[] }[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scanFileRef  = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: templates = [], refetch: refetchTemplates } = useQuery({
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
      for (const r of rows) if (r.status === 'matched') defaultChecked.add(r.row_index)
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
    setParseError(null); setPreviewRows(null); setResult(null)
    try {
      const rows = await parseExpenseSheet(file, selectedTemplate)
      if (rows.length === 0) {
        setParseError(
          selectedTemplate
            ? `Дебетових рядків не знайдено. Перевірте шаблон: колонка типу "${selectedTemplate.col_type ?? 'не вказана'}", значення дебету "${selectedTemplate.col_type_credit_value ?? 'не вказано'}".`
            : 'У файлі не знайдено дебетових рядків (очікується колонка типу зі значенням "Дебет").'
        )
        return
      }
      previewMutation.mutate(rows)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Не вдалося прочитати файл (.xlsx або .xls)')
    }
  }

  function handleDrop(e: React.DragEvent) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }

  async function handleScanFile(file: File) {
    try {
      const allRows = await readSheetRows(file)
      // Show first 5 non-empty rows with their index and cell values
      const result: { rowIdx: number; headers: string[] }[] = []
      for (let i = 0; i < Math.min(allRows.length, 15) && result.length < 5; i++) {
        const row = allRows[i] as unknown[]
        const cells = row.map(c => String(c ?? '').trim()).filter(Boolean)
        if (cells.length > 0) result.push({ rowIdx: i, headers: cells })
      }
      setScanRows(result)
    } catch {
      setScanRows([])
    }
  }

  function getEffective(row: ExpensePreviewRow) {
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
      const eff = getEffective(row)
      if (eff.isSkip) continue
      applyRows.push({
        row_index: row.row_index, date: row.date, amount: row.amount,
        counterparty_name: row.counterparty_name, edrpou: row.edrpou, iban: row.iban,
        description: row.description, doc_number: row.doc_number, bank_reference: row.bank_reference,
        bank_ref: row.bank_ref, category_id: eff.categoryId,
        matched_rule_id: row.matched_rule_id,
        save_rule: eff.saveRule,
        rule_edrpou:          eff.ruleEdrpou || null,
        rule_iban:            eff.ruleIban || null,
        rule_keyword_pattern: eff.ruleKeywords || null,
        is_skip_rule: false,
      })
    }
    if (applyRows.length === 0) return
    applyMutation.mutate(applyRows)
  }

  const allRows = previewRows ?? []
  const importableRows = allRows.filter(r => r.status !== 'duplicate')
  const checkedCount = [...checked].filter(idx => {
    const row = allRows.find(r => r.row_index === idx)
    return row && !getEffective(row).isSkip
  }).length
  const allImportableChecked = importableRows.length > 0 && importableRows.every(r => checked.has(r.row_index))

  // ── Routing ───────────────────────────────────────────────────────────────────

  if (view === 'rules') return <RulesView accountId={accountId} onBack={() => setView('import')} />

  if (view === 'templates') return (
    <TemplatesListView
      templates={templates}
      onBack={() => setView('import')}
      onNew={() => { setEditingTemplate(null); setView('editor') }}
      onEdit={(t) => { setEditingTemplate(t); setView('editor') }}
      onDeleted={() => { refetchTemplates(); setSelectedTemplateId(null) }}
    />
  )

  if (view === 'editor') return (
    <TemplateEditorView
      initial={editingTemplate}
      onSaved={(t) => {
        refetchTemplates()
        setSelectedTemplateId(t.id)
        setView('import')
      }}
      onCancel={() => setView('templates')}
    />
  )

  // ── Import view ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-800">Імпорт витрат з виписки</h3>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => setView('rules')} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
            Правила →
          </button>
          <button onClick={() => setView('templates')} className="text-xs text-iris-600 hover:text-iris-800 transition-colors">
            Шаблони →
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Template selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-gray-500 shrink-0">Шаблон виписки:</label>
          <select value={selectedTemplateId ?? ''}
            onChange={e => setSelectedTemplateId(e.target.value || null)}
            className="text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500">
            <option value="">ПриватБанк (вбудований, без шаблону)</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={() => { setEditingTemplate(null); setView('editor') }}
            className="text-xs text-iris-600 hover:text-iris-800 border border-iris-200 rounded px-2 py-1 transition-colors">
            + Новий шаблон
          </button>
        </div>

        {/* Column scanner */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Не знаєте які колонки у файлі?</span>
          <button
            onClick={() => { setScanRows(null); scanFileRef.current?.click() }}
            className="text-xs text-gray-500 hover:text-iris-700 border border-gray-200 rounded px-2 py-1 transition-colors"
          >
            🔍 Визначити колонки файлу
          </button>
          <input ref={scanFileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleScanFile(f); e.target.value = '' }} />
        </div>

        {scanRows !== null && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-700">Знайдені рядки у файлі:</p>
              <button onClick={() => setScanRows(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {scanRows.length === 0 ? (
              <p className="text-gray-400">Файл порожній або не вдалося прочитати</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-gray-500 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <b>Ліва колонка</b> = індекс для шаблону (вводьте це число у «Рядок заголовків» / «Перший рядок даних»).
                  Рядок Excel = індекс + 1.
                </p>
                {scanRows.map(({ rowIdx, headers }) => (
                  <div key={rowIdx} className="flex gap-2 items-start">
                    <span className="text-iris-700 font-mono font-semibold shrink-0 w-8 text-right">{rowIdx}</span>
                    <span className="text-gray-300 shrink-0">│</span>
                    <div className="flex flex-wrap gap-1">
                      {headers.slice(0, 12).map((h, i) => (
                        <span key={i} className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 font-mono">
                          {h.length > 35 ? h.substring(0, 35) + '…' : h}
                        </span>
                      ))}
                      {headers.length > 12 && <span className="text-gray-400">+{headers.length - 12}</span>}
                    </div>
                  </div>
                ))}
                <p className="text-gray-400 pt-1 border-t border-gray-100">
                  Знайдіть рядок з назвами колонок («Дата операції», «Сума» тощо) — це і є «Рядок заголовків».
                  «Перший рядок даних» = наступний індекс. Назви колонок копіюйте точно як показано.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Hint when no template */}
        {!selectedTemplateId && !previewRows && !result && !scanRows && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800 space-y-1">
            <p className="font-medium">Як починати роботу</p>
            <p>
              Вбудований формат ПриватБанку фільтрує рядки з від'ємними сумами — спробуйте без шаблону.
              Якщо ваш файл має іншу структуру — натисніть <b>«Визначити колонки»</b>, потім <b>«+ Новий шаблон»</b>.
            </p>
          </div>
        )}

        {/* Upload zone */}
        {!previewRows && !previewMutation.isPending && (
          <div onDrop={handleDrop} onDragOver={e => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-iris-300 hover:bg-iris-50 transition-colors">
            <div className="text-3xl mb-2">📂</div>
            <p className="text-sm text-gray-600 font-medium">Перетягніть файл виписки або натисніть</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx або .xls — тільки дебетові операції</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </div>
        )}

        {previewMutation.isPending && (
          <div className="py-8 text-center text-sm text-gray-400">Аналіз файлу...</div>
        )}

        {parseError && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-2">
            <p className="font-medium">Помилка читання файлу</p>
            {parseError.split('\n').map((line, i) => (
              <p key={i} className={i === 0 ? '' : 'text-red-500 font-mono break-all'}>{line}</p>
            ))}
            <div className="flex gap-3 pt-1 flex-wrap">
              <button onClick={() => { setScanRows(null); scanFileRef.current?.click() }}
                className="text-red-700 underline hover:no-underline">
                🔍 Визначити колонки файлу
              </button>
              {selectedTemplateId && (
                <button onClick={() => { setEditingTemplate(templates.find(t => t.id === selectedTemplateId) ?? null); setView('editor') }}
                  className="text-red-700 underline hover:no-underline">
                  ✎ Редагувати шаблон
                </button>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm">
            <p className="font-medium text-green-800">Імпортовано: {result.imported} витрат</p>
            {result.errors.length > 0 && <p className="text-red-600 text-xs mt-1">Помилки: {result.errors.length}</p>}
            <button onClick={() => { setResult(null); setPreviewRows(null) }}
              className="mt-2 text-xs text-green-700 underline hover:no-underline">
              Завантажити ще одну виписку
            </button>
          </div>
        )}

        {/* Preview table */}
        {previewRows && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-xs">
              {(['matched', 'unmatched', 'skip', 'duplicate'] as const).map(s => {
                const count = previewRows.filter(r => r.status === s).length
                if (count === 0) return null
                const labels = { matched: 'Класифіковано', unmatched: 'Не розпізнано', skip: 'Пропустити', duplicate: 'Дублікати' }
                const colors = { matched: 'text-green-700', unmatched: 'text-gray-600', skip: 'text-blue-600', duplicate: 'text-amber-700' }
                return <span key={s} className={colors[s]}>{labels[s]}: <b>{count}</b></span>
              })}
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        <input type="checkbox" checked={allImportableChecked}
                          onChange={e => setChecked(e.target.checked ? new Set(importableRows.map(r => r.row_index)) : new Set())} />
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
                      const eff = getEffective(row)
                      const isDuplicate = row.status === 'duplicate'
                      const hasOverride = overrides.has(row.row_index)
                      const displayStatus = hasOverride ? (eff.isSkip ? 'skip' : 'matched') : row.status

                      return (
                        <tr key={row.row_index} className={`${isDuplicate ? 'opacity-40' : 'hover:bg-gray-50'} transition-colors`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={checked.has(row.row_index)} disabled={isDuplicate}
                              onChange={e => {
                                const next = new Set(checked)
                                if (e.target.checked) next.add(row.row_index); else next.delete(row.row_index)
                                setChecked(next)
                              }} />
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
                          <td className="px-3 py-2 text-gray-600 max-w-[140px]">
                            {eff.isSkip
                              ? <span className="text-blue-500">пропустити</span>
                              : eff.categoryId
                                ? <span className="truncate block">
                                    {hasOverride
                                      ? (() => {
                                          const c = categories.find(c => c.id === eff.categoryId)
                                          const p = c ? categories.find(p => p.id === c.parent_id) : null
                                          return p ? `${p.name} → ${c?.name}` : c?.name ?? '—'
                                        })()
                                      : row.matched_category_name ?? '—'
                                    }
                                  </span>
                                : <span className="text-gray-400">—</span>
                            }
                          </td>
                          <td className="px-3 py-2">
                            {!isDuplicate && (
                              <button onClick={() => setClassifyRow(row)}
                                className="text-xs text-iris-600 hover:text-iris-800 whitespace-nowrap transition-colors">
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

            <div className="flex items-center justify-between pt-1">
              <button onClick={() => { setPreviewRows(null); setParseError(null) }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                ← Завантажити інший файл
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">Вибрано: <b>{checkedCount}</b></span>
                <button onClick={handleApply} disabled={checkedCount === 0 || applyMutation.isPending}
                  className="text-xs px-4 py-1.5 bg-iris-600 hover:bg-iris-700 text-white rounded-md disabled:opacity-50 transition-colors">
                  {applyMutation.isPending ? 'Зберігається...' : `Імпортувати (${checkedCount})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {classifyRow && (
        <ClassifyDialog row={classifyRow} categories={categories}
          onSave={(state) => {
            setOverrides(prev => { const n = new Map(prev); n.set(state.rowIndex, state); return n })
            setChecked(prev => {
              const n = new Set(prev)
              if (!state.isSkip) n.add(state.rowIndex); else n.delete(state.rowIndex)
              return n
            })
            setClassifyRow(null)
          }}
          onCancel={() => setClassifyRow(null)} />
      )}
    </div>
  )
}
