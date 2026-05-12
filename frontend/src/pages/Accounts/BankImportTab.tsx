import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useMutation, useQuery } from '@tanstack/react-query'
import { importApi, type BankRow, type PreviewRow, type ApplyRow } from '../../api/import.api'
import { familiesApi } from '../../api/families.api'

interface Props {
  accountId: string
}

// ─── Excel parsing ─────────────────────────────────────────────────────────────

function parseExcelDate(raw: unknown): string {
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    }
  }
  const s = String(raw ?? '').trim()
  const parts = s.split('.')
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  return s
}

function parseSheet(file: File): Promise<BankRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', raw: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })

        // rows[0] = bank header line, rows[1] = column headers, rows[2+] = data
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
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PreviewRow['status'] }) {
  const map: Record<PreviewRow['status'], { label: string; cls: string }> = {
    matched:   { label: 'Знайдено',  cls: 'bg-green-100 text-green-800' },
    conflict:  { label: 'Конфлікт', cls: 'bg-amber-100 text-amber-800' },
    unmatched: { label: 'Не знайдено', cls: 'bg-gray-100 text-gray-600' },
    duplicate: { label: 'Дублікат',  cls: 'bg-blue-100 text-blue-700' },
  }
  const { label, cls } = map[status]
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

// ─── Main component ────────────────────────────────────────────────────────────

export function BankImportTab({ accountId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [forceImport, setForceImport] = useState<Set<number>>(new Set())
  const [familyOverride, setFamilyOverride] = useState<Map<number, string>>(new Map())
  const [familySearch, setFamilySearch] = useState<Map<number, string>>(new Map())
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: { row_index: number; message: string }[] } | null>(null)

  const { data: allFamilies } = useQuery({
    queryKey: ['families-list'],
    queryFn: () => familiesApi.list({ limit: 500 }),
    select: (d) => d.data,
  })

  const previewMutation = useMutation({
    mutationFn: (rows: BankRow[]) => importApi.preview(accountId, rows),
    onSuccess: (resp) => {
      const rows = resp.rows
      setPreviewRows(rows)
      const defaultChecked = new Set<number>()
      for (const r of rows) {
        if (r.status === 'matched') defaultChecked.add(r.row_index)
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
      setResult({ imported: resp.imported, skipped: resp.skipped_duplicates, errors: resp.errors })
      setPreviewRows(null)
    },
  })

  async function handleFile(file: File) {
    setParseError(null)
    setPreviewRows(null)
    setResult(null)
    try {
      const rows = await parseSheet(file)
      if (rows.length === 0) {
        setParseError('У файлі не знайдено жодного кредитового рядка із позитивною сумою')
        return
      }
      previewMutation.mutate(rows)
    } catch {
      setParseError('Не вдалося прочитати файл. Перевірте формат (.xlsx або .xls)')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleApply() {
    if (!previewRows) return
    const applyRows: ApplyRow[] = []
    for (const row of previewRows) {
      if (!checked.has(row.row_index)) continue
      const family_id = familyOverride.get(row.row_index) ?? row.matched_family_id
      if (!family_id) continue
      applyRows.push({
        row_index: row.row_index,
        date: row.date,
        amount: row.amount,
        family_id,
        bank_ref: row.bank_ref,
        counterparty_name: row.counterparty_name,
        edrpou: row.edrpou,
        note: row.description || row.counterparty_name,
        force: forceImport.has(row.row_index),
      })
    }
    if (applyRows.length === 0) return
    applyMutation.mutate(applyRows)
  }

  function setOverride(row_index: number, family_id: string) {
    setFamilyOverride((prev) => {
      const next = new Map(prev)
      next.set(row_index, family_id)
      return next
    })
    setChecked((prev) => {
      const next = new Set(prev)
      if (family_id) next.add(row_index)
      return next
    })
  }

  function toggleCheck(row_index: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(row_index)) next.delete(row_index)
      else next.add(row_index)
      return next
    })
  }

  const checkedCount = previewRows
    ? [...checked].filter((idx) => {
        const r = previewRows.find((r) => r.row_index === idx)
        if (!r) return false
        if (r.is_duplicate && !forceImport.has(idx)) return false
        return !!(familyOverride.get(idx) ?? r.matched_family_id)
      }).length
    : 0

  const duplicateCount = previewRows?.filter((r) => r.is_duplicate).length ?? 0
  const unmatchedCount = previewRows?.filter((r) => r.status === 'unmatched').length ?? 0

  // ── Render ──────────────────────────────────────────────────────────────────

  if (result) {
    return (
      <div className="p-6 space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800">Імпорт завершено</p>
          <p className="text-sm text-green-700">Імпортовано: <strong>{result.imported}</strong></p>
          <p className="text-sm text-gray-600">Пропущено дублікатів: <strong>{result.skipped}</strong></p>
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
          onClick={() => { setResult(null); setPreviewRows(null) }}
          className="text-sm px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white rounded-lg transition-colors"
        >
          Новий імпорт
        </button>
      </div>
    )
  }

  if (!previewRows) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-gray-600">
          Завантажте Excel-виписку з банку (формат PrivatBank / Monobank). Система автоматично знайде
          кредитові операції і спробує зіставити їх із сім'ями клієнтів.
        </p>

        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-iris-400 transition-colors cursor-pointer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="text-sm text-gray-500">Перетягніть файл сюди або <span className="text-iris-600 font-medium">оберіть файл</span></p>
          <p className="text-xs text-gray-400 mt-1">.xlsx, .xls</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
          />
        </div>

        {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        {previewMutation.isPending && (
          <p className="text-sm text-gray-500">Аналіз рядків...</p>
        )}
      </div>
    )
  }

  // Preview table
  return (
    <div className="space-y-0">
      {/* Summary bar */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-4 text-sm">
        <span className="text-gray-700 font-medium">Знайдено рядків: {previewRows.length}</span>
        {duplicateCount > 0 && <span className="text-blue-600">Дублікатів: {duplicateCount}</span>}
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
              <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">ЄДРПОУ</th>
              <th className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap">Сума</th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600">Статус</th>
              <th className="px-3 py-2.5 text-left font-medium text-gray-600 min-w-[180px]">Сімʼя</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {previewRows.map((row) => {
              const isForced = forceImport.has(row.row_index)
              const isDisabled = row.is_duplicate && !isForced
              const override = familyOverride.get(row.row_index)
              const effectiveFamilyId = override ?? row.matched_family_id

              return (
                <tr
                  key={row.row_index}
                  className={`transition-colors ${isDisabled ? 'opacity-50 bg-gray-50' : 'hover:bg-gray-50'}`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked.has(row.row_index) && !isDisabled}
                      disabled={isDisabled || !effectiveFamilyId}
                      onChange={() => toggleCheck(row.row_index)}
                      className="rounded border-gray-300 text-iris-600 focus:ring-iris-500"
                    />
                  </td>

                  {/* Date */}
                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                    {row.date
                      ? new Date(row.date).toLocaleDateString('uk-UA')
                      : row.date}
                  </td>

                  {/* Counterparty */}
                  <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={row.counterparty_name}>
                    {row.counterparty_name || <span className="text-gray-400">—</span>}
                  </td>

                  {/* ЄДРПОУ */}
                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                    {row.edrpou ?? <span className="text-gray-300">—</span>}
                  </td>

                  {/* Amount */}
                  <td className="px-3 py-2 text-right font-medium text-green-700 tabular-nums whitespace-nowrap">
                    +{row.amount.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1 items-start">
                      <StatusBadge status={isForced ? 'matched' : row.status} />
                      {row.is_duplicate && !isForced && (
                        <button
                          onClick={() => {
                            setForceImport((prev) => { const n = new Set(prev); n.add(row.row_index); return n })
                            setChecked((prev) => { const n = new Set(prev); n.add(row.row_index); return n })
                          }}
                          className="text-xs text-amber-600 hover:text-amber-800 underline underline-offset-2 whitespace-nowrap"
                        >
                          Все одно імпортувати
                        </button>
                      )}
                      {isForced && (
                        <button
                          onClick={() => {
                            setForceImport((prev) => { const n = new Set(prev); n.delete(row.row_index); return n })
                            setChecked((prev) => { const n = new Set(prev); n.delete(row.row_index); return n })
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 whitespace-nowrap"
                        >
                          Скасувати
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Family selector */}
                  <td className="px-3 py-2">
                    {row.status === 'duplicate' ? (
                      <span className="text-xs text-gray-400 line-through">{row.matched_family_name ?? 'вже імпортовано'}</span>
                    ) : row.status === 'matched' && !override ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-700">{row.matched_family_name}</span>
                        <button
                          onClick={() => setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, ''); return n })}
                          className="text-xs text-gray-400 hover:text-gray-600"
                          title="Змінити сімʼю"
                        >
                          ✎
                        </button>
                      </div>
                    ) : row.status === 'conflict' && !override ? (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) setOverride(row.row_index, e.target.value) }}
                        className="text-xs border border-amber-300 rounded px-1.5 py-0.5 focus:border-iris-500 focus:ring-iris-500 w-full"
                      >
                        <option value="">Оберіть сімʼю...</option>
                        {row.candidate_families.map((f) => (
                          <option key={f.family_id} value={f.family_id}>{f.family_name} ({f.parent_name})</option>
                        ))}
                      </select>
                    ) : familySearch.has(row.row_index) || (row.status === 'unmatched' && !override) ? (
                      <FamilyCombobox
                        families={allFamilies ?? []}
                        value={override ?? ''}
                        search={familySearch.get(row.row_index) ?? ''}
                        onSearchChange={(s) => setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, s); return n })}
                        onSelect={(id) => {
                          setOverride(row.row_index, id)
                          setFamilySearch((p) => { const n = new Map(p); n.delete(row.row_index); return n })
                        }}
                      />
                    ) : override ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-iris-700">{allFamilies?.find((f) => f.id === override)?.name ?? override}</span>
                        <button
                          onClick={() => {
                            setFamilyOverride((p) => { const n = new Map(p); n.delete(row.row_index); return n })
                            setFamilySearch((p) => { const n = new Map(p); n.set(row.row_index, ''); return n })
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          ✎
                        </button>
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

// ─── Family combobox ───────────────────────────────────────────────────────────

interface FamilyComboboxProps {
  families: { id: string; name: string; primary_parent_name: string }[]
  value: string
  search: string
  onSearchChange: (s: string) => void
  onSelect: (id: string) => void
}

function FamilyCombobox({ families, search, onSearchChange, onSelect }: FamilyComboboxProps) {
  const filtered = search.length >= 1
    ? families.filter((f) =>
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.primary_parent_name.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : []

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Пошук сімʼї..."
        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500 focus:ring-iris-500"
        autoFocus
      />
      {filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-md max-h-40 overflow-y-auto">
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-iris-50 hover:text-iris-700"
            >
              <span className="font-medium">{f.name}</span>
              <span className="text-gray-400 ml-1">({f.primary_parent_name})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
