import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  importApi,
  type BankRow,
  type PreviewRow,
  type ApplyRow,
  type DuplicateFingerprints,
} from '../../api/import.api'

function isEffectiveDuplicate(
  row: PreviewRow,
  familyId: string | null,
  childId: string | null,
  fingerprints: DuplicateFingerprints | null,
): boolean {
  if (row.is_duplicate) return true
  if (!fingerprints || (!familyId && !childId)) return false
  const amt = row.amount.toFixed(2)
  const date = row.date.substring(0, 10)
  if (familyId && fingerprints.family.includes(`${familyId}|${date}|${amt}`)) return true
  if (childId && fingerprints.child.includes(`child:${childId}|${date}|${amt}`)) return true
  return false
}
import { familiesApi } from '../../api/families.api'
import { childrenApi } from '../../api/children.api'
import { importTemplatesApi, type ImportTemplate, type ImportTemplateInput } from '../../api/import_templates.api'

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
        const data  = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb    = XLSX.read(data, { type: 'array', raw: true })
        const ws    = wb.Sheets[wb.SheetNames[0]]
        const ref = ws['!ref']
        if (!ref) { resolve([]); return }
        const range = XLSX.utils.decode_range(ref)
        const result: unknown[][] = []
        // Read every row 0..range.e.r so result[i] = 0-indexed Excel row i.
        for (let r = 0; r <= range.e.r; r++) {
          if (r < range.s.r) {
            result.push([])
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

function parseSheet(file: File, template: ImportTemplate | null): Promise<BankRow[]> {
  return readSheetRows(file).then((rows) => {
    if (template === null) {
      // Legacy: hardcoded PrivatBank format
      const result: BankRow[] = []
      for (let i = 2; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        const typeCell = String(r[2] ?? '').trim().toLowerCase()
        const rawAmount = parseFloat(String(r[7] ?? '').replace(',', '.'))
        if (typeCell !== 'кредит' || isNaN(rawAmount) || rawAmount <= 0) continue
        const edrpouRaw = String(r[5] ?? '').replace(/\D/g, '')
        const ibanRaw = String(r[6] ?? '').replace(/\s/g, '').trim()
        result.push({
          row_index: i - 2,
          date: parseExcelDate(r[0]),
          counterparty_name: String(r[4] ?? '').replace(/[\n\r]+/g, ' ').trim(),
          edrpou: edrpouRaw.length >= 8 ? edrpouRaw : null,
          iban: ibanRaw.toUpperCase().startsWith('UA') && ibanRaw.length >= 29 ? ibanRaw : null,
          amount: rawAmount,
          description: String(r[3] ?? '').replace(/[\n\r]+/g, ' ').trim(),
        })
      }
      return result
    }

    // Template mode
    const headerRow = (rows[template.header_row_index] ?? []) as unknown[]
    const dateIdx        = findColIdx(headerRow, template.col_date)
    const amountIdx      = findColIdx(headerRow, template.col_amount)
    const typeIdx        = findColIdx(headerRow, template.col_type)
    const counterpartyIdx = findColIdx(headerRow, template.col_counterparty)
    const innIdx         = findColIdx(headerRow, template.col_inn)
    const ibanColIdx     = findColIdx(headerRow, template.col_iban)
    const descIdx        = findColIdx(headerRow, template.col_description)

    if (dateIdx === -1) throw new Error(`Колонку "${template.col_date}" не знайдено у файлі`)
    if (amountIdx === -1) throw new Error(`Колонку "${template.col_amount}" не знайдено у файлі`)

    const result: BankRow[] = []
    let dataIdx = 0
    for (let i = template.data_start_row_index; i < rows.length; i++) {
      const r = rows[i] as unknown[]
      if (r.every(cell => String(cell ?? '').trim() === '')) continue

      let rawAmount = parseFloat(String(r[amountIdx] ?? '').replace(',', '.'))
      if (isNaN(rawAmount)) continue
      if (template.amount_negate) rawAmount = -rawAmount

      if (typeIdx !== -1 && template.col_type_credit_value) {
        const typeCell = normalizeHeader(r[typeIdx])
        if (typeCell !== normalizeHeader(template.col_type_credit_value)) continue
      }

      if (rawAmount <= 0) continue

      const innRaw  = innIdx !== -1  ? String(r[innIdx] ?? '').replace(/\D/g, '') : ''
      const ibanRaw = ibanColIdx !== -1 ? String(r[ibanColIdx] ?? '').replace(/\s/g, '').trim() : ''

      result.push({
        row_index: dataIdx++,
        date: parseExcelDate(r[dateIdx]),
        counterparty_name: counterpartyIdx !== -1 ? String(r[counterpartyIdx] ?? '').replace(/[\n\r]+/g, ' ').trim() : '',
        edrpou: innRaw.length >= 8 ? innRaw : null,
        iban: ibanRaw.toUpperCase().startsWith('UA') && ibanRaw.length >= 29 ? ibanRaw : null,
        amount: rawAmount,
        description: descIdx !== -1 ? String(r[descIdx] ?? '').replace(/[\n\r]+/g, ' ').trim() : '',
      })
    }
    return result
  })
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PreviewRow['status'] }) {
  const map: Record<PreviewRow['status'], { label: string; cls: string }> = {
    matched:   { label: 'Знайдено',     cls: 'bg-green-100 text-green-800' },
    conflict:  { label: 'Конфлікт',    cls: 'bg-amber-100 text-amber-800' },
    partial:   { label: 'Схоже',       cls: 'bg-orange-100 text-orange-700' },
    unmatched: { label: 'Не знайдено', cls: 'bg-gray-100 text-gray-600' },
    duplicate: { label: 'Дублікат',    cls: 'bg-blue-100 text-blue-700' },
  }
  const { label, cls } = map[status]
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

// ─── Editor config ─────────────────────────────────────────────────────────────

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

const COL_FIELDS: { key: keyof ImportTemplateInput; label: string; required?: boolean; hint?: string }[] = [
  { key: 'col_date',               label: 'Дата',                   required: true },
  { key: 'col_amount',             label: 'Сума',                   required: true },
  { key: 'col_type',               label: 'Тип операції',           hint: 'порожньо = фільтр за знаком суми' },
  { key: 'col_type_credit_value',  label: 'Значення "надходження"', hint: 'напр. "кредит"' },
  { key: 'col_counterparty',       label: 'Контрагент' },
  { key: 'col_inn',                label: 'ІНН',                    hint: 'ІНН / ЄДРПОУ платника' },
  { key: 'col_iban',               label: 'IBAN' },
  { key: 'col_description',        label: 'Призначення' },
  { key: 'col_doc_number',         label: '№ документу',            hint: 'для контролю дублів' },
  { key: 'col_reference',          label: 'Референс банку',         hint: 'для контролю дублів' },
]

// ─── Main component ────────────────────────────────────────────────────────────

export function BankImportTab({ accountId }: Props) {
  const [view, setView]                       = useState<'import' | 'templates' | 'editor'>('import')
  const [editingTemplate, setEditingTemplate] = useState<ImportTemplate | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const qc          = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parseError, setParseError]   = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null)
  const [duplicateFingerprints, setDuplicateFingerprints] = useState<DuplicateFingerprints | null>(null)
  const [checked, setChecked]         = useState<Set<number>>(new Set())
  const [forceImport, setForceImport] = useState<Set<number>>(new Set())
  const [familyOverride, setFamilyOverride] = useState<Map<number, { family_id: string | null; child_id: string | null; display_name: string }>>(new Map())
  const [familySearch, setFamilySearch]     = useState<Map<number, string>>(new Map())
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    profiles: number
    errors: { row_index: number; message: string }[]
  } | null>(null)

  const { data: templates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['import-templates'],
    queryFn: importTemplatesApi.list,
  })

  const { data: allFamilies } = useQuery({
    queryKey: ['families-list'],
    queryFn: () => familiesApi.list({ limit: 500 }),
    select: (d) => d.data,
  })

  const { data: allChildren } = useQuery({
    queryKey: ['children-list-active'],
    queryFn: () => childrenApi.list({ is_active: true, limit: 500 }),
    select: (d) => d.data,
  })

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null

  const previewMutation = useMutation({
    mutationFn: (rows: BankRow[]) => importApi.preview(accountId, rows),
    onSuccess: (resp) => {
      const rows = resp.rows
      setPreviewRows(rows)
      setDuplicateFingerprints(resp.duplicate_fingerprints)
      const defaultChecked = new Set<number>()
      for (const r of rows) {
        if (r.status === 'matched' && !r.is_duplicate) defaultChecked.add(r.row_index)
      }
      setChecked(defaultChecked)
      setForceImport(new Set())
      setFamilyOverride(new Map())
      setFamilySearch(new Map())
      setResult(null)
    },
    onError: () => setParseError('Помилка сервера при аналізі рядків'),
  })

  const applyMutation = useMutation({
    mutationFn: (rows: ApplyRow[]) => importApi.apply(accountId, rows),
    onSuccess: (resp) => {
      setResult({
        imported: resp.imported,
        skipped: resp.skipped_duplicates,
        profiles: resp.profiles_updated,
        errors: resp.errors,
      })
      setPreviewRows(null)
      setDuplicateFingerprints(null)
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['balance'] })
      qc.invalidateQueries({ queryKey: ['account-ledger', accountId] })
      qc.invalidateQueries({ queryKey: ['account', accountId] })
      qc.invalidateQueries({ queryKey: ['child-bank-payers'] })
    },
  })

  async function handleFile(file: File) {
    setParseError(null); setPreviewRows(null); setDuplicateFingerprints(null); setResult(null)
    try {
      const rows = await parseSheet(file, selectedTemplate)
      if (rows.length === 0) { setParseError('У файлі не знайдено жодного рядка із позитивною сумою'); return }
      previewMutation.mutate(rows)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Не вдалося прочитати файл (.xlsx або .xls)')
    }
  }

  function handleDrop(e: React.DragEvent) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }

  function handleApply() {
    if (!previewRows) return
    const applyRows: ApplyRow[] = []
    for (const row of previewRows) {
      if (!checked.has(row.row_index)) continue
      const override = familyOverride.get(row.row_index)
      const effectiveFamilyId = override?.family_id ?? row.matched_family_id
      const effectiveChildId  = override?.child_id  ?? row.matched_child_id
      if (!effectiveFamilyId && !effectiveChildId) continue
      applyRows.push({
        row_index: row.row_index, date: row.date, amount: row.amount,
        family_id: effectiveFamilyId, child_id: effectiveChildId ?? undefined,
        bank_ref: row.bank_ref, counterparty_name: row.counterparty_name,
        edrpou: row.edrpou, iban: row.iban,
        note: row.description || row.counterparty_name,
        force: forceImport.has(row.row_index),
      })
    }
    if (applyRows.length === 0) return
    applyMutation.mutate(applyRows)
  }

  function setOverride(row_index: number, target: { family_id: string | null; child_id: string | null; display_name: string }) {
    setFamilyOverride((p) => { const n = new Map(p); n.set(row_index, target); return n })
    setChecked((p) => { const n = new Set(p); if (target.family_id || target.child_id) n.add(row_index); return n })
  }

  function toggleCheck(row_index: number) {
    setChecked((p) => { const n = new Set(p); n.has(row_index) ? n.delete(row_index) : n.add(row_index); return n })
  }

  function rowTargets(row: PreviewRow) {
    const ov = familyOverride.get(row.row_index)
    return {
      familyId: ov?.family_id ?? row.matched_family_id,
      childId: ov?.child_id ?? row.matched_child_id,
    }
  }

  const checkedCount = previewRows
    ? [...checked].filter((idx) => {
        const r = previewRows.find((r) => r.row_index === idx)
        if (!r) return false
        const { familyId, childId } = rowTargets(r)
        if (isEffectiveDuplicate(r, familyId, childId, duplicateFingerprints) && !forceImport.has(idx)) return false
        return !!(familyId || childId)
      }).length
    : 0

  const duplicateCount = previewRows
    ? previewRows.filter((r) => {
        const { familyId, childId } = rowTargets(r)
        return isEffectiveDuplicate(r, familyId, childId, duplicateFingerprints)
      }).length
    : 0
  const partialCount   = previewRows?.filter((r) => {
    const { familyId, childId } = rowTargets(r)
    return r.status === 'partial' && !isEffectiveDuplicate(r, familyId, childId, duplicateFingerprints)
  }).length ?? 0
  const unmatchedCount = previewRows?.filter((r) => r.status === 'unmatched').length ?? 0

  // ── Template management views ─────────────────────────────────────────────────

  if (view === 'templates') {
    return (
      <TemplatesListView
        templates={templates}
        onBack={() => setView('import')}
        onNew={() => { setEditingTemplate(null); setView('editor') }}
        onEdit={(t) => { setEditingTemplate(t); setView('editor') }}
        onDeleted={() => {
          refetchTemplates()
          setSelectedTemplateId((id) => templates.some((t) => t.id === id) ? id : null)
        }}
      />
    )
  }

  if (view === 'editor') {
    return (
      <TemplateEditorView
        initial={editingTemplate}
        onSaved={(saved) => { refetchTemplates(); setSelectedTemplateId(saved.id); setView('import') }}
        onCancel={() => setView(editingTemplate ? 'templates' : 'import')}
      />
    )
  }

  // ── Import result ─────────────────────────────────────────────────────────────

  if (result) {
    return (
      <div className="p-6 space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800">Імпорт завершено</p>
          <p className="text-sm text-green-700">Імпортовано: <strong>{result.imported}</strong></p>
          <p className="text-sm text-gray-600">Пропущено дублікатів: <strong>{result.skipped}</strong></p>
          {result.profiles > 0 && (
            <p className="text-sm text-gray-600">Оновлено відомих платників: <strong>{result.profiles}</strong></p>
          )}
          {result.errors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-700 mt-2">Помилки ({result.errors.length}):</p>
              {result.errors.map((e) => (
                <p key={e.row_index} className="text-xs text-red-600">Рядок {e.row_index + 1}: {e.message}</p>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { setResult(null); setPreviewRows(null); setDuplicateFingerprints(null) }}
          className="text-sm px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white rounded-lg transition-colors"
        >
          Новий імпорт
        </button>
      </div>
    )
  }

  // ── Upload panel ──────────────────────────────────────────────────────────────

  if (!previewRows) {
    return (
      <div className="p-6 space-y-4">

        {/* Template selector */}
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-gray-100">
          <span className="text-xs font-medium text-gray-500">Шаблон:</span>
          {templates.length > 0 && (
            <>
              <select
                value={selectedTemplateId ?? ''}
                onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                className="text-sm border-gray-300 rounded shadow-sm focus:border-iris-500 focus:ring-iris-500"
              >
                <option value="">— Legacy (ПриватБанк) —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {selectedTemplateId && (
                <button
                  onClick={() => { setEditingTemplate(selectedTemplate); setView('editor') }}
                  className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2 py-1"
                >
                  ✎ Редагувати
                </button>
              )}
            </>
          )}
          <button
            onClick={() => { setEditingTemplate(null); setView('editor') }}
            className="text-xs text-iris-600 hover:text-iris-700 border border-iris-200 rounded px-2 py-1"
          >
            + Новий шаблон
          </button>
          {templates.length > 0 && (
            <button onClick={() => setView('templates')} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">
              Всі шаблони →
            </button>
          )}
        </div>

        {!selectedTemplateId && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <span>⚠</span>
            <span>Шаблон не обрано — використовується формат ПриватБанку за замовчуванням</span>
          </div>
        )}

        {/* Drop zone */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-iris-400 transition-colors cursor-pointer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="text-sm text-gray-500">Перетягніть файл сюди або <span className="text-iris-600 font-medium">оберіть файл</span></p>
          <p className="text-xs text-gray-400 mt-1">.xlsx, .xls</p>
          <input
            ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
          />
        </div>

        {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        {previewMutation.isPending && <p className="text-sm text-gray-500">Аналіз рядків...</p>}
      </div>
    )
  }

  // ── Preview table ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-0">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-4 text-sm">
        <span className="text-gray-700 font-medium">Знайдено рядків: {previewRows.length}</span>
        {selectedTemplate && <span className="text-xs text-gray-400">шаблон: {selectedTemplate.name}</span>}
        {duplicateCount > 0 && <span className="text-blue-600">Дублікатів: {duplicateCount}</span>}
        {partialCount > 0 && <span className="text-orange-600">Схожих: {partialCount}</span>}
        {unmatchedCount > 0 && <span className="text-gray-500">Не зіставлено: {unmatchedCount}</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => { setPreviewRows(null); setResult(null) }}
            className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50"
          >
            Завантажити інший файл
          </button>
          <button
            onClick={handleApply}
            disabled={checkedCount === 0 || applyMutation.isPending}
            className="text-xs px-4 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {applyMutation.isPending ? 'Застосування...' : `Застосувати (${checkedCount})`}
          </button>
        </div>
      </div>

      {applyMutation.isError && (
        <p className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-200">
          Помилка при застосуванні. Спробуйте ще раз.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2.5 w-8"></th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">Дата</th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600">Контрагент</th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600 min-w-[160px]">Призначення</th>
              <th className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap">Сума</th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600">Статус</th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600 min-w-[180px]">Сімʼя</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {previewRows.map((row) => {
              const isForced   = forceImport.has(row.row_index)
              const override   = familyOverride.get(row.row_index)
              const effectiveFamilyId = override?.family_id ?? row.matched_family_id
              const effectiveChildId  = override?.child_id  ?? row.matched_child_id
              const hasTarget  = !!(effectiveFamilyId || effectiveChildId)
              const effectiveDuplicate = isEffectiveDuplicate(row, effectiveFamilyId, effectiveChildId, duplicateFingerprints)
              const isDisabled = effectiveDuplicate && !isForced
              const displayStatus: PreviewRow['status'] = isForced
                ? (hasTarget ? 'matched' : row.status)
                : (effectiveDuplicate ? 'duplicate' : row.status)

              return (
                <tr key={row.row_index} className={`transition-colors ${isDisabled ? 'opacity-50 bg-gray-50' : 'hover:bg-gray-50'}`}>

                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked.has(row.row_index) && !isDisabled}
                      disabled={isDisabled || !hasTarget}
                      onChange={() => toggleCheck(row.row_index)}
                      className="rounded border-gray-300 text-iris-600 focus:ring-iris-500"
                    />
                  </td>

                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                    {row.date ? new Date(row.date).toLocaleDateString('uk-UA') : row.date}
                  </td>

                  <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={row.counterparty_name}>
                    {row.counterparty_name || <span className="text-gray-400">—</span>}
                  </td>

                  <td className="px-3 py-2 text-gray-600 text-xs max-w-[220px] truncate" title={row.description || undefined}>
                    {row.description || <span className="text-gray-300">—</span>}
                  </td>

                  <td className="px-3 py-2 text-right font-medium text-green-700 tabular-nums whitespace-nowrap">
                    +{row.amount.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1 items-start">
                      <StatusBadge status={displayStatus} />
                      {effectiveDuplicate && !isForced && (
                        <button
                          onClick={() => {
                            setForceImport((p) => { const n = new Set(p); n.add(row.row_index); return n })
                            setChecked((p) => { const n = new Set(p); n.add(row.row_index); return n })
                          }}
                          className="text-xs text-amber-600 hover:text-amber-800 underline underline-offset-2 whitespace-nowrap"
                        >
                          Все одно імпортувати
                        </button>
                      )}
                      {isForced && (
                        <button
                          onClick={() => {
                            setForceImport((p) => { const n = new Set(p); n.delete(row.row_index); return n })
                            setChecked((p) => { const n = new Set(p); n.delete(row.row_index); return n })
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 whitespace-nowrap"
                        >
                          Скасувати
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    {displayStatus === 'duplicate' ? (
                      <span className="text-xs text-gray-400 line-through">{row.matched_family_name ?? 'вже імпортовано'}</span>
                    ) : row.status === 'matched' && !override ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-700">{row.matched_family_name}</span>
                        <button
                          onClick={() => setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, ''); return n })}
                          className="text-xs text-gray-400 hover:text-gray-600" title="Змінити сімʼю"
                        >✎</button>
                      </div>
                    ) : row.status === 'partial' && !override ? (
                      familySearch.has(row.row_index) ? (
                        <div className="space-y-1">
                          <TargetCombobox
                            families={allFamilies ?? []}
                            children={allChildren ?? []}
                            search={familySearch.get(row.row_index) ?? ''}
                            onSearchChange={(s) => setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, s); return n })}
                            onSelect={(target) => {
                              setOverride(row.row_index, target)
                              setFamilySearch((p) => { const n = new Map(p); n.delete(row.row_index); return n })
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setFamilySearch((p) => { const n = new Map(p); n.delete(row.row_index); return n })}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            ← До списку схожих
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <select
                            value=""
                            onChange={(e) => {
                              const i = parseInt(e.target.value)
                              if (!isNaN(i)) {
                                const f = row.candidate_families[i]
                                if (f) setOverride(row.row_index, { family_id: f.family_id, child_id: f.child_id, display_name: f.family_name })
                              }
                            }}
                            className="text-xs border border-orange-300 rounded px-1.5 py-0.5 focus:border-iris-500 focus:ring-iris-500 w-full"
                          >
                            <option value="">Оберіть зі схожих...</option>
                            {row.candidate_families.map((f, i) => (
                              <option key={f.family_id ?? f.child_id} value={i}>{f.family_name} ({f.parent_name})</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, ''); return n })}
                            className="text-xs text-iris-600 hover:text-iris-800 underline underline-offset-2"
                          >
                            Обрати вручну
                          </button>
                        </div>
                      )
                    ) : row.status === 'conflict' && !override ? (
                      <select
                        value=""
                        onChange={(e) => {
                          const i = parseInt(e.target.value)
                          if (!isNaN(i)) {
                            const f = row.candidate_families[i]
                            if (f) setOverride(row.row_index, { family_id: f.family_id, child_id: f.child_id, display_name: f.family_name })
                          }
                        }}
                        className="text-xs border border-amber-300 rounded px-1.5 py-0.5 focus:border-iris-500 focus:ring-iris-500 w-full"
                      >
                        <option value="">Оберіть...</option>
                        {row.candidate_families.map((f, i) => (
                          <option key={f.family_id ?? f.child_id} value={i}>{f.family_name} ({f.parent_name})</option>
                        ))}
                      </select>
                    ) : familySearch.has(row.row_index) || (row.status === 'unmatched' && !override) ? (
                      <TargetCombobox
                        families={allFamilies ?? []}
                        children={allChildren ?? []}
                        search={familySearch.get(row.row_index) ?? ''}
                        onSearchChange={(s) => setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, s); return n })}
                        onSelect={(target) => {
                          setOverride(row.row_index, target)
                          setFamilySearch((p) => { const n = new Map(p); n.delete(row.row_index); return n })
                        }}
                      />
                    ) : override ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-iris-700">{override.display_name}</span>
                        <button
                          onClick={() => {
                            setFamilyOverride((p) => { const n = new Map(p); n.delete(row.row_index); return n })
                            setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, ''); return n })
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >✎</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Templates list view ───────────────────────────────────────────────────────

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
          + Створити шаблон
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-400">Шаблони ще не створено.</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">Назва</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">Опис</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Рядок заголовка</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{t.description ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">Рядок {t.header_row_index}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => onEdit(t)} className="text-xs text-iris-600 hover:text-iris-700">Редагувати</button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                      >
                        Видалити
                      </button>
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

// ─── Template editor view ──────────────────────────────────────────────────────

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
      setSampleHeaders(headerRow.map((h) => String(h ?? '').trim()).filter(Boolean))
    } catch { /* ignore */ }
  }

  function setField<K extends keyof ImportTemplateInput>(key: K, value: ImportTemplateInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setColField(key: keyof ImportTemplateInput, value: string) {
    setForm((f) => ({ ...f, [key]: value || null }))
  }

  async function handleSave() {
    setError(null)
    if (!form.name.trim())       { setError('Назва обовʼязкова'); return }
    if (!form.col_date.trim())   { setError('Колонка "Дата" обовʼязкова'); return }
    if (!form.col_amount.trim()) { setError('Колонка "Сума" обовʼязкова'); return }
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

      {/* Basic info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Назва *</label>
          <input
            type="text" value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="напр. ПриватБанк"
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Опис</label>
          <input
            type="text" value={form.description ?? ''}
            onChange={(e) => setField('description', e.target.value || null)}
            placeholder="Необовʼязковий опис"
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Рядок заголовків
            <span className="font-normal text-gray-400 ml-1">(Excel рядок − 1)</span>
          </label>
          <input
            type="number" min={0} value={form.header_row_index}
            onChange={(e) => { setField('header_row_index', Number(e.target.value)); setSampleHeaders([]) }}
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
          <p className="text-xs text-gray-400 mt-0.5">Напр. Excel рядок 13 → введіть 12</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Перший рядок даних
            <span className="font-normal text-gray-400 ml-1">(Excel рядок − 1)</span>
          </label>
          <input
            type="number" min={0} value={form.data_start_row_index}
            onChange={(e) => setField('data_start_row_index', Number(e.target.value))}
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
          <p className="text-xs text-gray-400 mt-0.5">Зазвичай = рядок заголовків + 1</p>
        </div>
      </div>

      {/* Sample file */}
      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium text-gray-600">Зразок файлу</p>
        <p className="text-xs text-gray-400">Завантажте файл виписки, щоб побачити назви колонок для вибору</p>
        <button
          type="button"
          onClick={() => sampleFileRef.current?.click()}
          className="text-xs text-iris-600 hover:text-iris-700 border border-iris-200 rounded px-2 py-1"
        >
          Обрати файл
        </button>
        <input ref={sampleFileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleSampleFile(e.target.files[0]) }}
        />
        {sampleHeaders.length > 0 && (
          <p className="text-xs text-gray-500">
            Знайдено: <span className="font-medium">{sampleHeaders.join(' · ')}</span>
          </p>
        )}
      </div>

      {/* Column mapping */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Маппінг колонок</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COL_FIELDS.map(({ key, label, required, hint }) => {
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
                    onChange={(e) => setColField(key, e.target.value)}
                    className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
                  >
                    <option value="">— не використовувати —</option>
                    {sampleHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                ) : (
                  <input
                    type="text" value={value}
                    onChange={(e) => setColField(key, e.target.value)}
                    placeholder="Назва колонки..."
                    className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-iris-500 focus:ring-iris-500"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Amount negate */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox" checked={form.amount_negate}
          onChange={(e) => setField('amount_negate', e.target.checked)}
          className="rounded border-gray-300 text-iris-600 focus:ring-iris-500"
        />
        <span className="text-gray-700">Надходження = від'ємна сума</span>
        <span className="text-xs text-gray-400">(напр. Монобанк)</span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <button
          onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Збереження...' : 'Зберегти'}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-900">
          Скасувати
        </button>
      </div>
    </div>
  )
}

// ─── Target combobox ──────────────────────────────────────────────────────────

type TargetOption = { family_id: string | null; child_id: string | null; display_name: string }

interface TargetComboboxProps {
  families: { id: string; name: string; primary_parent_name: string }[]
  children: { id: string; full_name: string; family_id: string | null }[]
  search: string
  onSearchChange: (s: string) => void
  onSelect: (target: TargetOption) => void
}

function TargetCombobox({ families, children, search, onSearchChange, onSelect }: TargetComboboxProps) {
  const q = search.toLowerCase()

  const filteredFamilies = q.length >= 1
    ? families.filter((f) => f.name.toLowerCase().includes(q) || f.primary_parent_name.toLowerCase().includes(q)).slice(0, 5)
    : []

  const filteredChildren = q.length >= 1
    ? children.filter((c) => c.full_name.toLowerCase().includes(q)).slice(0, 5)
    : []

  const showDropdown = filteredFamilies.length > 0 || filteredChildren.length > 0

  return (
    <div className="relative">
      <input
        type="text" value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Пошук сімʼї або дитини..."
        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500 focus:ring-iris-500"
        autoFocus
      />
      {showDropdown && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-md max-h-52 overflow-y-auto">
          {filteredFamilies.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">Сімʼї</div>
              {filteredFamilies.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelect({ family_id: f.id, child_id: null, display_name: f.name })}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-iris-50 hover:text-iris-700"
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="text-gray-400 ml-1">({f.primary_parent_name})</span>
                </button>
              ))}
            </>
          )}
          {filteredChildren.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">Діти</div>
              {filteredChildren.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect({ family_id: null, child_id: c.id, display_name: c.full_name })}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-iris-50 hover:text-iris-700"
                >
                  <span className="font-medium">{c.full_name}</span>
                  <span className="text-gray-400 ml-1 text-[10px]">дитина</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
