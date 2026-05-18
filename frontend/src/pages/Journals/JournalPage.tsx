import React, { useState, useCallback, useMemo, memo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attendanceApi } from '../../api/attendance.api'
import { childrenApi } from '../../api/children.api'
import type { AttendanceStatus, JournalRow, AttendanceLog } from '../../types'

type Mode = 'day' | 'week' | 'month'

// ─── Утиліти дат ──────────────────────────────────────────────────────────────

function toStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function getRange(base: string, mode: Mode): [string, string] {
  const d = parseDate(base)
  if (mode === 'day') return [base, base]
  if (mode === 'week') {
    const day = d.getDay() === 0 ? 7 : d.getDay()
    const mon = new Date(d); mon.setDate(d.getDate() - day + 1)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return [toStr(mon), toStr(sun)]
  }
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return [toStr(first), toStr(last)]
}

function navigate(base: string, mode: Mode, dir: 1 | -1): string {
  const d = parseDate(base)
  if (mode === 'day')   { d.setDate(d.getDate() + dir); return toStr(d) }
  if (mode === 'week')  { d.setDate(d.getDate() + dir * 7); return toStr(d) }
  d.setMonth(d.getMonth() + dir); return toStr(d)
}

function formatHeader(from: string, to: string, mode: Mode) {
  const fmt = (s: string) => parseDate(s).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
  if (mode === 'day') return parseDate(from).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })
  if (mode === 'week') return `${fmt(from)} — ${fmt(to)}`
  return parseDate(from).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
}

function formatDayCol(dateStr: string) {
  const d = parseDate(dateStr)
  return { day: d.toLocaleDateString('uk-UA', { weekday: 'short' }), num: d.getDate() }
}

function isFrozenOn(row: JournalRow, dateStr: string): boolean {
  if (row.status !== 'frozen') return false
  if (!row.frozen_from || !row.frozen_to) return false
  return dateStr >= row.frozen_from && dateStr <= row.frozen_to
}

// ─── Оптимізована клітинка ───────────────────────────────────────────────────

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present:           'bg-green-100 text-green-700 border-green-200 hover:bg-green-200',
  absent_excused:    'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
  absent_unexcused:  'bg-red-100 text-red-700 border-red-200 hover:bg-red-200',
  special:           'bg-iris-100 text-iris-700 border-iris-200 hover:bg-iris-200',
}
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present:          'П',
  absent_excused:   'В',
  absent_unexcused: 'Н',
  special:          '',
}

interface CellProps {
  enrollmentId: string
  dateStr: string
  log: AttendanceLog | null
  frozen: boolean
  isHighlightedDate: boolean
  onMarkQuick: (enrollmentId: string, dateStr: string) => void
  onOpenDialog: (row: JournalRow, dateStr: string, context: 'edit' | 'note') => void
  onHoverDate: (dateStr: string | null) => void
  compact?: boolean
  row: JournalRow // needed for dialog
}

// Memoized to prevent re-renders of the whole grid
const AttendanceCell = memo(({ enrollmentId, dateStr, log, frozen, isHighlightedDate, onMarkQuick, onOpenDialog, onHoverDate, compact, row }: CellProps) => {
  const baseClasses = `relative flex items-center justify-center rounded border transition-all select-none cursor-pointer group ${
    compact ? 'h-6 w-6' : 'h-7 px-1.5 min-w-[1.75rem]'
  } ${isHighlightedDate ? 'border-iris-300' : 'border-transparent'}`

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    onOpenDialog(row, dateStr, 'note')
  }

  if (frozen) {
    return (
      <div className={`${baseClasses} border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed`} title="Заморожено">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
    )
  }

  if (!log) {
    return (
      <div
        onClick={() => onMarkQuick(enrollmentId, dateStr)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => onHoverDate(dateStr)}
        onMouseLeave={() => onHoverDate(null)}
        className={`${baseClasses} border-dashed border-gray-200 bg-transparent text-gray-300 hover:border-gray-300 hover:text-gray-400 hover:bg-black/5`}
      >
        <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">+</span>
      </div>
    )
  }

  return (
    <div
      onClick={() => onOpenDialog(row, dateStr, 'edit')}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => onHoverDate(dateStr)}
      onMouseLeave={() => onHoverDate(null)}
      className={`${baseClasses} font-bold ${STATUS_STYLE[log.status]}`}
    >
      {log.status === 'special' ? (
        <span className="text-[9px] leading-tight font-black">
          {Number(log.custom_amount).toFixed(0)}
        </span>
      ) : (
        <span className="text-[10px]">{STATUS_LABEL[log.status]}</span>
      )}
      
      {log.note && (
        <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-full border border-white" />
      )}
    </div>
  )
})

// ─── Діалоги ─────────────────────────────────────────────────────────────────

interface AttendanceDialogProps {
  row: JournalRow
  dateStr: string
  openContext: 'edit' | 'note'
  onSave: (payload: { enrollmentId: string, dateStr: string, logId: string | null, status: AttendanceStatus, amount?: number | null, note?: string | null }) => void
  onDelete: (logId: string) => void
  onClose: () => void
}

function AttendanceDialog({ row, dateStr, openContext, onSave, onDelete, onClose }: AttendanceDialogProps) {
  const log = row.logs[dateStr]
  const [status, setStatus] = useState<AttendanceStatus>(log?.status ?? 'present')
  const [amount, setAmount] = useState(log?.custom_amount != null ? String(Number(log.custom_amount)) : '')
  const [note, setNote]     = useState(log?.note ?? '')

  const handleSave = () => {
    onSave({
      enrollmentId: row.enrollment_id,
      dateStr,
      logId: log?.id ?? null,
      status,
      amount: status === 'special' ? (amount === '' ? 0 : Number(amount)) : null,
      note: note.trim() || null
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-6 w-[340px] space-y-5 animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Відмітка</h3>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{row.child_name} · {dateStr}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {(['present', 'absent_excused', 'absent_unexcused', 'special'] as AttendanceStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              autoFocus={openContext === 'edit' && s === 'absent_excused'}
              className={`py-2 px-1 rounded-xl border text-xs font-bold transition-all focus:outline-none ${
                status === s 
                  ? STATUS_STYLE[s] + ' ring-2 ring-offset-1 ring-iris-500' 
                  : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100 focus:ring-2 focus:ring-iris-200'
              }`}
            >
              {s === 'present' ? 'П' : s === 'absent_excused' ? 'В' : s === 'absent_unexcused' ? 'Н' : '$$$'}
              <div className="text-[8px] opacity-60 mt-0.5 leading-none">
                {s === 'present' ? 'Прис' : s === 'absent_excused' ? 'Пов' : s === 'absent_unexcused' ? 'Неп' : 'Спец'}
              </div>
            </button>
          ))}
        </div>

        {status === 'special' && (
          <div className="animate-in slide-in-from-top-2 duration-200">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Сума спец. тарифу (грн)</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
              placeholder="0.00"
              className="w-full rounded-xl border-gray-200 text-sm font-medium shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Примітка (бачить адмін)</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            autoFocus={openContext === 'note'}
            placeholder="Введіть коментар..."
            className="w-full rounded-xl border-gray-200 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500 resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          {log && (
            <button onClick={() => onDelete(log.id)}
              className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors font-semibold text-sm">
              Видалити
            </button>
          )}
          <button onClick={handleSave}
            className="flex-1 py-2.5 bg-iris-600 hover:bg-iris-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-iris-200 transition-all transform active:scale-95">
            Зберегти
          </button>
        </div>
      </div>
    </div>
  )
}

function EnrollModal({ activityId, accountId, onClose }: { activityId: string, accountId: string, onClose: () => void }) {
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()

  const { data: resp, isLoading } = useQuery({
    queryKey: ['children-search', search],
    queryFn: () => childrenApi.list({ search }),
    enabled: true
  })
  const children = resp?.data

  const enrollMutation = useMutation({
    mutationFn: async (childId: string) => {
      const today = new Date().toISOString().slice(0, 10)
      await childrenApi.createEnrollment(childId, {
        activity_id: activityId,
        account_id: accountId,
        start_date: today
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      onClose()
    }
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-6 w-[400px] space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-gray-900 text-lg">Записати дитину</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <input type="text" placeholder="Прізвище або ім'я дитини..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
          className="w-full rounded-xl border-gray-200 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        <div className="h-[400px] overflow-y-auto custom-scrollbar divide-y divide-gray-50 border border-gray-100 rounded-xl">
          {isLoading && <div className="p-4 text-center text-xs text-gray-400">Завантаження...</div>}
          {children?.map(child => (
            <button key={child.id} onClick={() => enrollMutation.mutate(child.id)} disabled={enrollMutation.isPending}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between group transition-colors" >
              <div>
                <div className="text-sm font-semibold text-gray-900 group-hover:text-iris-600">{child.full_name}</div>
                <div className="text-[10px] text-gray-400">ID: {child.id.slice(0, 8)}</div>
              </div>
              <span className="text-xs font-bold text-iris-500 opacity-0 group-hover:opacity-100 transition-opacity">Записати →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Головна сторінка ─────────────────────────────────────────────────────────

export function JournalPage() {
  const { activityId } = useParams<{ activityId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const mode = (searchParams.get('mode') as Mode) ?? 'week'
  const baseDate = searchParams.get('date') ?? toStr(new Date())
  const [from, to] = getRange(baseDate, mode)

  const [groupMode, setGroupMode] = useState<'group' | 'alphabetical'>('group')
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [dialogTarget, setDialogTarget] = useState<{ row: JournalRow, dateStr: string, context: 'edit' | 'note' } | null>(null)
  const [groupPopupTarget, setGroupPopupTarget] = useState<any | null>(null)
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false)

  const setMode = (m: Mode) => setSearchParams({ mode: m, date: baseDate })
  const setDate = (d: string) => setSearchParams({ mode, date: d })

  const { data, isLoading } = useQuery({
    queryKey: ['journal', activityId, from, to],
    queryFn: () => attendanceApi.getJournal(activityId!, from, to),
    enabled: !!activityId,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['journal', activityId, from, to] })

  const markMutation = useMutation({ mutationFn: attendanceApi.mark, onSuccess: invalidate })
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: any) => attendanceApi.update(id, payload), onSuccess: invalidate })
  const removeMutation = useMutation({ mutationFn: attendanceApi.remove, onSuccess: invalidate })
  const groupMarkMutation = useMutation({
    mutationFn: (p: any) => attendanceApi.markGroup({ activity_id: activityId!, date: p.dateStr, status: p.status, lessons_count: p.count }),
    onSuccess: () => { invalidate(); setGroupPopupTarget(null) }
  })
  const groupRemoveMutation = useMutation({
    mutationFn: (id: string) => attendanceApi.removeGroup(id),
    onSuccess: () => { invalidate(); setGroupPopupTarget(null) }
  })

  const handleMarkQuick = useCallback((enrollmentId: string, dateStr: string) => {
    markMutation.mutate({ enrollment_id: enrollmentId, date: dateStr, status: 'present' })
    if (data?.activity?.auto_group_classes) {
      const gLog = data.group_logs[dateStr]
      if (!gLog || gLog.status !== 'conducted') {
        groupMarkMutation.mutate({ dateStr, status: 'conducted', count: 1 })
      }
    }
  }, [markMutation, groupMarkMutation, data])

  const handleDialogSave = (payload: any) => {
    if (payload.logId) updateMutation.mutate({ id: payload.logId, payload: { status: payload.status, custom_amount: payload.amount, note: payload.note } })
    else markMutation.mutate({ enrollment_id: payload.enrollmentId, date: payload.dateStr, status: payload.status, custom_amount: payload.amount, note: payload.note })
    
    if (data?.activity?.auto_group_classes && (payload.status === 'present' || payload.status === 'special')) {
      const gLog = data.group_logs[payload.dateStr]
      if (!gLog || gLog.status !== 'conducted') groupMarkMutation.mutate({ dateStr: payload.dateStr, status: 'conducted', count: 1 })
    }
    setDialogTarget(null)
  }

  const activity = data?.activity
  const dates = data?.dates ?? []
  const rows = data?.rows ?? []
  const groupLogs = data?.group_logs ?? {}
  const compact = mode === 'month'

  const groupedData = useMemo(() => {
    if (groupMode === 'alphabetical') return [{ groupName: null, rows }]
    const groups: Record<string, JournalRow[]> = {}
    rows.forEach(r => {
      const g = r.group_name || 'БЕЗ ГРУПИ'
      if (!groups[g]) groups[g] = []
      groups[g].push(r)
    })
    return Object.entries(groups).map(([name, rows]) => ({ groupName: name, rows }))
  }, [rows, groupMode])

  const columnTotals = useMemo(() => {
    const totals: Record<string, { present: number, excused: number, unexcused: number }> = {}
    dates.forEach(d => { totals[d] = { present: 0, excused: 0, unexcused: 0 } })
    rows.forEach(r => {
      Object.entries(r.logs).forEach(([d, log]) => {
        if (!totals[d]) return
        if (log.status === 'present' || log.status === 'special') totals[d].present++
        else if (log.status === 'absent_excused') totals[d].excused++
        else if (log.status === 'absent_unexcused') totals[d].unexcused++
      })
    })
    return totals
  }, [dates, rows])

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>

  return (
    <div className="space-y-3 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link to="/journals" className="hover:text-iris-600 transition-colors">Журнали</Link>
          <span>/</span>
          <span className="text-gray-900 font-bold">{activity?.name ?? '...'}</span>
        </div>
        <button onClick={() => setIsEnrollModalOpen(true)}
          className="px-3 py-1.5 bg-iris-600 hover:bg-iris-700 text-white text-[11px] font-bold rounded-xl shadow-lg transition-all flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          Записати дитину
        </button>
      </div>

      <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex p-0.5 bg-gray-50 rounded-xl text-[10px] font-black">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg transition-all ${mode === m ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400 hover:text-gray-500'}`}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setDate(navigate(baseDate, mode, -1))} className="p-1.5 border border-gray-100 rounded-lg hover:bg-gray-50 text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-xs font-black text-gray-700 min-w-[140px] text-center uppercase tracking-tighter">{formatHeader(from, to, mode)}</span>
          <button onClick={() => setDate(navigate(baseDate, mode, 1))} className="p-1.5 border border-gray-100 rounded-lg hover:bg-gray-50 text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <div className="flex p-0.5 bg-gray-50 rounded-xl text-[10px] font-black">
          <button onClick={() => setGroupMode('group')} className={`px-3 py-1.5 rounded-lg ${groupMode === 'group' ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400'}`}>ПО ГРУПАХ</button>
          <button onClick={() => setGroupMode('alphabetical')} className={`px-3 py-1.5 rounded-lg ${groupMode === 'alphabetical' ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400'}`}>ПО ФІО</button>
        </div>

        <div className="flex items-center gap-3 ml-auto px-1">
          <div className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-green-100 border-green-200 flex items-center justify-center text-[9px] text-green-700 font-black">П</span> <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Пр</span></div>
          <div className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-amber-100 border-amber-200 flex items-center justify-center text-[9px] text-amber-700 font-black">В</span> <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Пв</span></div>
          <div className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-red-100 border-red-200 flex items-center justify-center text-[9px] text-red-700 font-black">Н</span> <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Нп</span></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-visible">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-14 z-30 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <tr>
              <th className="sticky left-0 z-40 bg-gray-50 text-left px-3 py-1.5 font-black text-gray-400 text-[9px] uppercase tracking-widest border-b border-gray-200 min-w-[180px]">Дитина</th>
              {dates.map(d => {
                const { day, num } = formatDayCol(d)
                const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6
                const baseBg = isWeekend ? 'bg-amber-50' : 'bg-gray-50'
                const hoverBg = isWeekend ? 'bg-amber-100' : 'bg-iris-100'
                return (
                  <th key={d} onMouseEnter={() => setHoveredDate(d)} onMouseLeave={() => setHoveredDate(null)}
                    className={`px-0.5 py-1 text-center border-b border-gray-200 transition-colors min-w-[32px] ${hoveredDate === d ? hoverBg : baseBg}`}>
                    <div className="text-[8px] text-gray-400 font-bold uppercase leading-none">{day}</div>
                    <div className={`text-[11px] font-black leading-tight ${hoveredDate === d ? 'text-iris-700' : 'text-gray-800'}`}>{num}</div>
                  </th>
                )
              })}
            </tr>
            <tr className="bg-white">
              <th className="sticky left-0 z-40 bg-white border-b border-gray-200 text-[8px] font-black text-gray-300 text-right pr-3 uppercase py-0.5">Підсумки:</th>
              {dates.map(d => {
                const t = columnTotals[d]
                const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6
                const hoverBg = isWeekend ? 'bg-amber-100' : 'bg-iris-100'
                const baseBg = isWeekend ? 'bg-amber-50/50' : ''
                return (
                  <th key={`total-${d}`} className={`px-0.5 py-0.5 border-b border-gray-200 text-[8px] min-w-[32px] ${hoveredDate === d ? hoverBg : baseBg}`}>
                    <div className="flex flex-col gap-0 items-center font-black leading-none">
                      {t.present > 0 && <span className="text-green-500">{t.present}</span>}
                      {t.excused > 0 && <span className="text-amber-500">{t.excused}</span>}
                      {t.unexcused > 0 && <span className="text-red-500">{t.unexcused}</span>}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
              {activity?.has_group_classes && (
                <tr className="bg-iris-50/5 hover:bg-iris-50/10 transition-colors">
                  <td className="sticky left-0 z-10 px-3 py-1.5 font-black text-iris-600 text-[9px] border-r border-b border-gray-200 bg-inherit shadow-[1px_0_0_0_rgba(0,0,0,0.03)] min-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-iris-500 rounded-full animate-pulse" />
                      ГРУПОВЕ ЗАНЯТТЯ
                    </div>
                  </td>
                  {dates.map(d => {
                    const gLog = groupLogs[d]
                    const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6
                    const hoverBg = isWeekend ? 'bg-amber-100/80' : 'bg-iris-100/50'
                    const baseBg = isWeekend ? 'bg-amber-50/30' : ''
                    return (
                      <td key={`group-${d}`} className={`px-0.5 py-0.5 text-center border-r border-b border-gray-200 transition-colors min-w-[32px] ${hoveredDate === d ? hoverBg : baseBg}`}>
                        {!gLog || gLog.status !== 'conducted' ? (
                          <button onClick={() => groupMarkMutation.mutate({ dateStr: d, status: 'conducted', count: 1 })}
                            className="w-5 h-5 mx-auto rounded border border-dashed border-iris-200 text-iris-300 hover:border-iris-500 hover:text-iris-500 transition-all flex items-center justify-center text-[10px]">+</button>
                        ) : (
                          <button onClick={() => setGroupPopupTarget({ log: gLog, dateStr: d })}
                            className="w-5 h-5 mx-auto rounded bg-iris-500 text-white shadow-sm flex items-center justify-center text-[8px] font-black hover:bg-iris-600 transition-colors">{gLog.lessons_count > 1 ? `x${gLog.lessons_count}` : '✔'}</button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )}

              {groupedData.map((group) => (
                <React.Fragment key={group.groupName || 'all'}>
                  {group.groupName && (
                    <tr className="bg-gray-100/30">
                      <td colSpan={dates.length + 1} className="sticky left-0 z-10 px-3 py-1 text-[8px] font-black text-gray-400 uppercase tracking-widest bg-inherit border-y border-gray-200">
                        {group.groupName}
                      </td>
                    </tr>
                  )}
                  {group.rows.map((row) => {
                    const isRowHovered = hoveredRowId === row.enrollment_id
                    return (
                      <tr key={row.enrollment_id} 
                        onMouseEnter={() => setHoveredRowId(row.enrollment_id)}
                        onMouseLeave={() => setHoveredRowId(null)}
                        className={`transition-colors group ${isRowHovered ? 'bg-iris-100/50' : ''}`}>
                        <td className={`sticky left-0 z-10 px-3 py-1 whitespace-nowrap border-r border-b border-gray-200 shadow-[1px_0_0_0_rgba(0,0,0,0.03)] transition-colors min-w-[180px] ${isRowHovered ? 'bg-iris-100' : 'bg-white'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <Link to={`/children/${row.child_id}`} className="text-[11px] font-bold text-gray-800 hover:text-iris-600 truncate block transition-colors leading-tight">
                                {row.child_name}
                              </Link>
                              {groupMode === 'alphabetical' && row.group_name && (
                                <div className="text-[7px] font-bold text-gray-300 uppercase leading-none mt-0.5">{row.group_name}</div>
                              )}
                            </div>
                            {row.status === 'frozen' && (
                              <div className="text-blue-400" title="Заморожено">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                              </div>
                            )}
                          </div>
                        </td>
                        {dates.map(dateStr => {
                          const isColHovered = hoveredDate === dateStr
                          const isCrosshair = isRowHovered && isColHovered
                          const isWeekend = new Date(dateStr).getDay() === 0 || new Date(dateStr).getDay() === 6
                          
                          let bgClass = ''
                          if (isCrosshair) bgClass = isWeekend ? 'bg-amber-200/60' : 'bg-iris-200/60'
                          else if (isColHovered) bgClass = isWeekend ? 'bg-amber-100' : 'bg-iris-100'
                          else if (isWeekend) bgClass = 'bg-amber-50/30'

                          return (
                            <td key={dateStr} className={`px-0.5 py-0.5 text-center border-r border-b border-gray-200 transition-colors min-w-[32px] ${bgClass}`}>
                              <AttendanceCell
                                row={row}
                                enrollmentId={row.enrollment_id}
                                dateStr={dateStr}
                                log={row.logs[dateStr]}
                                frozen={isFrozenOn(row, dateStr)}
                                isHighlightedDate={isCrosshair}
                                onMarkQuick={handleMarkQuick}
                                onOpenDialog={(r, d, context) => setDialogTarget({ row: r, dateStr: d, context })}
                                onHoverDate={setHoveredDate}
                                compact={compact}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      {dialogTarget && <AttendanceDialog row={dialogTarget.row} dateStr={dialogTarget.dateStr} openContext={dialogTarget.context} onSave={handleDialogSave} onDelete={(id) => { removeMutation.mutate(id); setDialogTarget(null) }} onClose={() => setDialogTarget(null)} />}
      {groupPopupTarget && (
        <GroupPopup
          log={groupPopupTarget.log}
          dateStr={groupPopupTarget.dateStr}
          onUpdate={(count: number) => {
            groupMarkMutation.mutate({ dateStr: groupPopupTarget.dateStr, status: 'conducted', count })
            setGroupPopupTarget(null)
          }}
          onDelete={() => {
            groupRemoveMutation.mutate(groupPopupTarget.log.id)
            setGroupPopupTarget(null)
          }}
          onClose={() => setGroupPopupTarget(null)}
        />
      )}
      {isEnrollModalOpen && <EnrollModal activityId={activityId!} accountId={(activity as any)?.account_id || ''} onClose={() => setIsEnrollModalOpen(false)} />}
    </div>
  )
}

// ─── Group Popup ─────────────────────────────────────────────────────────────

function GroupPopup({ log, dateStr, onUpdate, onDelete, onClose }: any) {
  const [count, setCount] = useState(log.lessons_count || 1)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-5 w-[280px] space-y-4 animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-gray-900">Групове заняття</h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{dateStr}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Кількість занять</label>
          <div className="flex items-center gap-3">
            <button onClick={() => setCount(Math.max(1, count - 1))} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-gray-600 font-bold">-</button>
            <div className="flex-1 text-center font-black text-lg text-iris-600">{count}</div>
            <button onClick={() => setCount(count + 1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-gray-600 font-bold">+</button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onDelete} className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors font-bold text-[11px] uppercase">Видалити</button>
          <button onClick={() => onUpdate(count)}
            className="flex-1 py-2 bg-iris-600 hover:bg-iris-700 text-white text-[11px] font-bold rounded-xl shadow-lg transition-all uppercase">Зберегти</button>
        </div>
      </div>
    </div>
  )
}
