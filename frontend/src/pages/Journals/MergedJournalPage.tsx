import React, { useState, useCallback, useMemo, memo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mergedJournalsApi } from '../../api/mergedJournals.api'
import { attendanceApi } from '../../api/attendance.api'
import type { AttendanceStatus } from '../../types'

type Mode = 'day' | 'week' | 'month'

// ─── Date utils ───────────────────────────────────────────────────────────────

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
  if (mode === 'day')  { d.setDate(d.getDate() + dir); return toStr(d) }
  if (mode === 'week') { d.setDate(d.getDate() + dir * 7); return toStr(d) }
  d.setMonth(d.getMonth() + dir); return toStr(d)
}

function formatHeader(from: string, to: string, mode: Mode) {
  const fmt = (s: string) => parseDate(s).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
  if (mode === 'day')  return parseDate(from).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })
  if (mode === 'week') return `${fmt(from)} — ${fmt(to)}`
  return parseDate(from).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
}

function formatDayCol(dateStr: string) {
  const d = parseDate(dateStr)
  return { day: d.toLocaleDateString('uk-UA', { weekday: 'short' }), num: d.getDate() }
}

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present:          'bg-green-100 text-green-700 border-green-200 hover:bg-green-200',
  absent_excused:   'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
  absent_unexcused: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200',
  special:          'bg-iris-100 text-iris-700 border-iris-200 hover:bg-iris-200',
  separate_billing: 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200',
}
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present:          'П',
  absent_excused:   'В',
  absent_unexcused: 'Н',
  special:          '',
  separate_billing: 'ОР',
}

function isFrozen(status: string, frozenFrom: string | null, frozenTo: string | null, dateStr: string): boolean {
  if (status !== 'frozen') return false
  if (!frozenFrom || !frozenTo) return false
  return dateStr >= frozenFrom && dateStr <= frozenTo
}

// ─── Attendance cell ──────────────────────────────────────────────────────────

interface CellProps {
  enrollmentId: string
  dateStr:      string
  log:          any
  frozen:       boolean
  isHighlighted: boolean
  onMark:       (enrollmentId: string, dateStr: string) => void
  onOpenDialog: (enrollmentId: string, dateStr: string, context: 'edit' | 'note') => void
  onHover:      (dateStr: string | null) => void
  pending:      boolean
}

const AttendanceCell = memo(({ enrollmentId, dateStr, log, frozen, isHighlighted, onMark, onOpenDialog, onHover, pending }: CellProps) => {
  const baseClasses = `relative w-6 h-6 mx-auto rounded border transition-all select-none cursor-pointer group flex items-center justify-center text-[10px] ${
    isHighlighted ? 'border-iris-300' : 'border-transparent'
  }`

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    onOpenDialog(enrollmentId, dateStr, 'note')
  }

  if (frozen) {
    return (
      <div className={`${baseClasses} border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed`} title="Заморожено">—</div>
    )
  }

  if (!log) {
    return (
      <button
        onClick={() => onMark(enrollmentId, dateStr)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => onHover(dateStr)}
        onMouseLeave={() => onHover(null)}
        disabled={pending}
        className={`${baseClasses} border-dashed border-gray-200 bg-transparent text-gray-300 hover:border-gray-300 hover:text-gray-400 hover:bg-black/5 disabled:opacity-40`}
      >
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">+</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => onOpenDialog(enrollmentId, dateStr, 'edit')}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => onHover(dateStr)}
      onMouseLeave={() => onHover(null)}
      disabled={pending}
      className={`${baseClasses} font-bold disabled:opacity-40 ${STATUS_STYLE[log.status as AttendanceStatus]}`}
    >
      {log.status === 'special' ? (
        <span className="font-black leading-tight">{Number(log.custom_amount).toFixed(0)}</span>
      ) : STATUS_LABEL[log.status as AttendanceStatus]}
      {log.note && (
        <div className="absolute top-0 right-0 w-1 h-1 bg-red-500 rounded-full border border-white" />
      )}
    </button>
  )
})

// ─── Activity colors ──────────────────────────────────────────────────────────

const ACTIVITY_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
]

// ─── Attendance dialog ────────────────────────────────────────────────────────

function MergedAttendanceDialog({ enrollmentId, dateStr, log, openContext, onSave, onDelete, onClose }: any) {
  const [status, setStatus] = useState<AttendanceStatus>(log?.status ?? 'present')
  const [amount, setAmount] = useState(log?.custom_amount != null ? String(Number(log.custom_amount)) : '')
  const [note, setNote]     = useState(log?.note ?? '')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-6 w-[340px] space-y-5 animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Відмітка</h3>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{dateStr}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {(['present', 'absent_excused', 'absent_unexcused', 'special', 'separate_billing'] as AttendanceStatus[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              autoFocus={openContext === 'edit' && s === 'absent_excused'}
              className={`py-2 px-0.5 rounded-xl border text-xs font-bold transition-all focus:outline-none ${status === s ? STATUS_STYLE[s] + ' ring-2 ring-offset-1 ring-iris-500' : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100 focus:ring-2 focus:ring-iris-200'}`}>
              {s === 'present' ? 'П' : s === 'absent_excused' ? 'В' : s === 'absent_unexcused' ? 'Н' : s === 'special' ? '$$$' : 'ОР'}
              <div className="text-[8px] opacity-60 mt-0.5 leading-none">
                {s === 'present' ? 'Прис' : s === 'absent_excused' ? 'Пов' : s === 'absent_unexcused' ? 'Неп' : s === 'special' ? 'Спец' : 'Окр'}
              </div>
            </button>
          ))}
        </div>
        {status === 'special' && (
          <div className="animate-in slide-in-from-top-2 duration-200">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Сума (грн)</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus className="w-full rounded-xl border-gray-200 text-sm font-medium shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
        )}
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Примітка</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            autoFocus={openContext === 'note'}
            className="w-full rounded-xl border-gray-200 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500 resize-none" />
        </div>
        <div className="flex gap-3 pt-2">
          {log && <button onClick={() => onDelete(log.id)} className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors font-semibold text-sm">Видалити</button>}
          <button onClick={() => onSave({ enrollmentId, dateStr, logId: log?.id, status, amount: status === 'special' ? Number(amount) : null, note })}
            className="flex-1 py-2.5 bg-iris-600 hover:bg-iris-700 text-white text-sm font-bold rounded-xl shadow-lg transition-all transform active:scale-95">Зберегти</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function MergedJournalPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()

  const mode     = (searchParams.get('mode') as Mode) ?? 'week'
  const baseDate = searchParams.get('date') ?? toStr(new Date())
  const [from, to] = getRange(baseDate, mode)

  const setMode = (m: Mode) => setSearchParams({ mode: m, date: baseDate })
  const setDate = (d: string) => setSearchParams({ mode, date: d })

  const [activeActivityIds, setActiveActivityIds] = useState<Set<string> | null>(null)
  const [groupFilter, setGroupFilter]             = useState<string>('')
  const [groupMode, setGroupMode]                 = useState<'group' | 'alphabetical'>('group')
  const [hoveredDate, setHoveredDate]             = useState<string | null>(null)
  const [hoveredRowId, setHoveredRowId]           = useState<string | null>(null)
  const [dialogTarget, setDialogTarget]           = useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['merged-journal', id, from, to],
    queryFn:  () => mergedJournalsApi.getJournal(id!, from, to),
    enabled:  !!id,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['merged-journal', id, from, to] })

  const markMutation = useMutation({
    mutationFn: async (p: any) => {
      if (p.logId) return attendanceApi.update(p.logId, { status: p.status, custom_amount: p.amount, note: p.note })
      return attendanceApi.mark({ enrollment_id: p.enrollmentId, date: p.dateStr, status: p.status, custom_amount: p.amount, note: p.note })
    },
    onSuccess: () => { invalidate(); setDialogTarget(null) },
  })

  const removeMutation = useMutation({
    mutationFn: attendanceApi.remove,
    onSuccess: () => { invalidate(); setDialogTarget(null) },
  })

  const handleQuickMark = useCallback((enrollmentId: string, dateStr: string) => {
    markMutation.mutate({ enrollmentId, dateStr, status: 'present' })
  }, [markMutation])

  const mj         = data?.merged_journal
  const activities = data?.activities ?? []
  const dates      = data?.dates ?? []
  const allRows    = data?.rows ?? []
  const hasActCol  = activities.length > 1
  const totalCols  = 1 + (hasActCol ? 1 : 0) + dates.length

  const activityColorMap = useMemo(() => {
    const map = new Map<string, string>()
    activities.forEach((a, i) => map.set(a.id, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]))
    return map
  }, [activities])

  const groups = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of allRows) {
      if (r.group_id && r.group_name) seen.set(r.group_id, r.group_name)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [allRows])

  const rows = useMemo(() => allRows.filter(r => {
    if (groupFilter && r.group_id !== groupFilter) return false
    if (activeActivityIds !== null && !activeActivityIds.has(r.activity_id)) return false
    return true
  }).sort((a, b) => a.child_name.localeCompare(b.child_name)), [allRows, groupFilter, activeActivityIds])

  const groupedData = useMemo(() => {
    if (groupMode === 'alphabetical') return [{ groupName: null, rows }]
    const map: Record<string, typeof rows> = {}
    rows.forEach(r => {
      const g = r.group_name || 'БЕЗ ГРУПИ'
      if (!map[g]) map[g] = []
      map[g].push(r)
    })
    return Object.entries(map).map(([groupName, rows]) => ({ groupName, rows }))
  }, [rows, groupMode])

  const columnTotals = useMemo(() => {
    const totals: Record<string, { present: number; excused: number; unexcused: number }> = {}
    dates.forEach(d => { totals[d] = { present: 0, excused: 0, unexcused: 0 } })
    rows.forEach(r => {
      Object.entries(r.logs).forEach(([d, log]: [string, any]) => {
        if (!totals[d]) return
        if (log.status === 'present' || log.status === 'special' || log.status === 'separate_billing') totals[d].present++
        else if (log.status === 'absent_excused') totals[d].excused++
        else if (log.status === 'absent_unexcused') totals[d].unexcused++
      })
    })
    return totals
  }, [dates, rows])

  const groupColumnTotals = useMemo(() => {
    const result: Record<string, Record<string, { present: number; excused: number; unexcused: number }>> = {}
    groupedData.forEach(({ groupName, rows: groupRows }) => {
      const key = groupName || 'all'
      result[key] = {}
      dates.forEach(d => { result[key][d] = { present: 0, excused: 0, unexcused: 0 } })
      groupRows.forEach(r => {
        Object.entries(r.logs).forEach(([d, log]: [string, any]) => {
          if (!result[key][d]) return
          if (log.status === 'present' || log.status === 'special' || log.status === 'separate_billing') result[key][d].present++
          else if (log.status === 'absent_excused') result[key][d].excused++
          else if (log.status === 'absent_unexcused') result[key][d].unexcused++
        })
      })
    })
    return result
  }, [dates, groupedData])

  const toggleActivity = (actId: string) => {
    setActiveActivityIds(prev => {
      const all = new Set(activities.map(a => a.id))
      const current = prev ?? all
      const next = new Set(current)
      if (next.has(actId)) next.delete(actId)
      else next.add(actId)
      if (next.size === all.size) return null
      return next
    })
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  if (!mj) return <div className="py-12 text-center text-sm text-gray-400">Журнал не знайдено</div>

  return (
    <div className="space-y-3 pb-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link to="/journals" className="hover:text-iris-600 transition-colors">Журнали</Link>
        <span>/</span>
        <span className="text-gray-900 font-bold">{mj.name}</span>
      </div>

      {/* Controls */}
      <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3">
        {/* Mode switcher */}
        <div className="flex p-0.5 bg-gray-50 rounded-xl text-[10px] font-black">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg transition-all ${mode === m ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button onClick={() => setDate(navigate(baseDate, mode, -1))} className="p-1.5 border border-gray-100 rounded-lg hover:bg-gray-50 text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-xs font-black text-gray-800 min-w-[140px] text-center uppercase tracking-tighter">{formatHeader(from, to, mode)}</span>
          <button onClick={() => setDate(navigate(baseDate, mode, 1))} className="p-1.5 border border-gray-100 rounded-lg hover:bg-gray-50 text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        {/* Group filter dropdown */}
        {groups.length > 0 && (
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="text-[10px] font-black border border-gray-100 rounded-xl px-3 py-1.5 text-gray-600 focus:ring-iris-500 focus:border-iris-500 uppercase bg-gray-50">
            <option value="">УСІ ГРУПИ</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        {/* Group sort toggle */}
        <div className="flex p-0.5 bg-gray-50 rounded-xl text-[10px] font-black">
          <button onClick={() => setGroupMode('group')}
            className={`px-3 py-1.5 rounded-lg transition-all ${groupMode === 'group' ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400'}`}>
            ПО ГРУПАХ
          </button>
          <button onClick={() => setGroupMode('alphabetical')}
            className={`px-3 py-1.5 rounded-lg transition-all ${groupMode === 'alphabetical' ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400'}`}>
            ПО ФІО
          </button>
        </div>

        <span className="text-[10px] font-bold text-gray-400 ml-auto">{rows.length} дітей</span>
      </div>

      {/* Activity filter chips */}
      {activities.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {activities.map(a => {
            const color = activityColorMap.get(a.id) ?? ACTIVITY_COLORS[0]
            const isOn  = activeActivityIds === null || activeActivityIds.has(a.id)
            return (
              <button key={a.id} onClick={() => toggleActivity(a.id)}
                className={`text-[9px] font-black px-2.5 py-1 rounded-full border transition-all uppercase ${isOn ? color + ' border-transparent shadow-sm' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                {a.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-visible">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {activities.length === 0
              ? 'У цьому журналі ще немає активностей'
              : 'Немає записаних дітей для вибраних фільтрів'}
          </div>
        ) : (
          <table className="w-auto text-sm border-separate border-spacing-0">
            <thead className="sticky top-14 z-30 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              {/* Date header row */}
              <tr>
                <th className="sticky left-0 z-40 bg-gray-50 text-left px-4 py-2 font-black text-gray-400 text-[9px] uppercase tracking-widest border-b border-gray-200 min-w-[180px]">Дитина</th>
                {hasActCol && (
                  <th className="bg-gray-50 text-left px-2 py-2 font-black text-gray-400 text-[9px] uppercase tracking-widest border-b border-gray-200 min-w-[100px]">Журнал</th>
                )}
                {dates.map(d => {
                  const { day, num } = formatDayCol(d)
                  const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6
                  const baseBg  = isWeekend ? 'bg-amber-50' : 'bg-gray-50'
                  const hoverBg = isWeekend ? 'bg-amber-100' : 'bg-iris-100'
                  return (
                    <th key={d}
                      onMouseEnter={() => setHoveredDate(d)}
                      onMouseLeave={() => setHoveredDate(null)}
                      className={`px-0.5 py-1 text-center border-b border-gray-200 transition-colors min-w-[32px] ${hoveredDate === d ? hoverBg : baseBg}`}>
                      <div className="text-[8px] text-gray-400 font-bold uppercase leading-none">{day}</div>
                      <div className={`text-[11px] font-black leading-tight ${hoveredDate === d ? 'text-iris-700' : 'text-gray-800'}`}>{num}</div>
                    </th>
                  )
                })}
              </tr>
              {/* Підсумки row */}
              <tr className="bg-white">
                <th className="sticky left-0 z-40 bg-white border-b border-gray-200 text-[9px] text-gray-300 text-right pr-3 uppercase py-0.5">Підсумки:</th>
                {hasActCol && <th className="bg-white border-b border-gray-200" />}
                {dates.map(d => {
                  const t = columnTotals[d]
                  const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6
                  const hoverBg = isWeekend ? 'bg-amber-100' : 'bg-iris-100'
                  const baseBg  = isWeekend ? 'bg-amber-50/50' : ''
                  return (
                    <th key={`total-${d}`} className={`px-0.5 py-0.5 border-b border-gray-200 text-[9px] min-w-[32px] ${hoveredDate === d ? hoverBg : baseBg}`}>
                      <div className="flex flex-col items-center leading-none">
                        {t.present   > 0 && <span className="text-green-500">{t.present}</span>}
                        {t.excused   > 0 && <span className="text-amber-500">{t.excused}</span>}
                        {t.unexcused > 0 && <span className="text-red-500">{t.unexcused}</span>}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {groupedData.map((group) => (
                <React.Fragment key={group.groupName || 'all'}>
                  {group.groupName && (
                    <tr className="bg-gray-100/30">
                      <td colSpan={totalCols}
                        className="sticky left-0 z-10 px-4 py-1 text-[8px] font-black text-gray-400 uppercase tracking-widest bg-inherit border-y border-gray-200">
                        {group.groupName}
                      </td>
                    </tr>
                  )}
                  {group.rows.map(row => {
                    const isRowHovered = hoveredRowId === row.enrollment_id
                    const actColor = activityColorMap.get(row.activity_id) ?? ACTIVITY_COLORS[0]
                    const actName  = activities.find(a => a.id === row.activity_id)?.name ?? ''

                    return (
                      <tr key={row.enrollment_id}
                        onMouseEnter={() => setHoveredRowId(row.enrollment_id)}
                        onMouseLeave={() => setHoveredRowId(null)}
                        className={`transition-colors ${isRowHovered ? 'bg-iris-100/50' : ''}`}>

                        {/* Child name */}
                        <td className={`sticky left-0 z-10 px-4 py-1.5 whitespace-nowrap border-r border-b border-gray-200 shadow-[1px_0_0_0_rgba(0,0,0,0.03)] transition-colors min-w-[180px] ${isRowHovered ? 'bg-iris-100' : 'bg-white'}`}>
                          <Link to={`/children/${row.child_id}`} className="text-[12px] font-bold text-gray-800 hover:text-iris-600 truncate block transition-colors leading-tight">
                            {row.child_name}
                          </Link>
                          {groupMode === 'alphabetical' && row.group_name && (
                            <div className="text-[7px] font-bold text-gray-300 uppercase leading-none mt-0.5">{row.group_name}</div>
                          )}
                          {row.status === 'frozen' && (
                            <div className="text-[7px] font-bold text-blue-400 leading-none mt-0.5">❄ Заморожено</div>
                          )}
                        </td>

                        {/* Activity badge */}
                        {hasActCol && (
                          <td className={`px-2 py-1.5 border-r border-b border-gray-200 transition-colors ${isRowHovered ? 'bg-iris-50/50' : ''}`}>
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-lg uppercase whitespace-nowrap ${actColor}`}>{actName}</span>
                          </td>
                        )}

                        {/* Attendance cells */}
                        {dates.map(dateStr => {
                          const isColHover = hoveredDate === dateStr
                          const isCross    = isRowHovered && isColHover
                          const isWeekend  = new Date(dateStr).getDay() === 0 || new Date(dateStr).getDay() === 6

                          let bg = ''
                          if (isCross)        bg = isWeekend ? 'bg-amber-200/60' : 'bg-iris-200/60'
                          else if (isColHover) bg = isWeekend ? 'bg-amber-100'   : 'bg-iris-100'
                          else if (isWeekend)  bg = 'bg-amber-50/30'
                          else if (isRowHovered) bg = ''

                          return (
                            <td key={dateStr}
                              className={`px-0.5 py-0.5 text-center border-r border-b border-gray-200 transition-colors min-w-[32px] ${bg}`}>
                              <AttendanceCell
                                enrollmentId={row.enrollment_id}
                                dateStr={dateStr}
                                log={row.logs[dateStr]}
                                frozen={isFrozen(row.status, row.frozen_from, row.frozen_to, dateStr)}
                                isHighlighted={isCross}
                                onMark={handleQuickMark}
                                onOpenDialog={(eId, dStr, context) => setDialogTarget({ enrollmentId: eId, dateStr: dStr, log: row.logs[dStr], context })}
                                onHover={setHoveredDate}
                                pending={markMutation.isPending}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {/* Group subtotals row */}
                  {groupMode === 'group' && group.groupName && (
                    <tr className="bg-gray-50/60">
                      <td className="sticky left-0 z-10 bg-gray-50/60 border-b border-gray-200 text-[9px] text-gray-300 text-right pr-3 py-0.5">підсумок:</td>
                      {hasActCol && <td className="border-b border-gray-200" />}
                      {dates.map(d => {
                        const t = groupColumnTotals[group.groupName!]?.[d] ?? { present: 0, excused: 0, unexcused: 0 }
                        const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6
                        return (
                          <td key={`grp-total-${d}`} className={`px-0.5 py-0.5 border-b border-gray-200 text-[9px] min-w-[32px] ${isWeekend ? 'bg-amber-50/30' : ''}`}>
                            <div className="flex flex-col items-center leading-none">
                              {t.present   > 0 && <span className="text-green-500">{t.present}</span>}
                              {t.excused   > 0 && <span className="text-amber-500">{t.excused}</span>}
                              {t.unexcused > 0 && <span className="text-red-500">{t.unexcused}</span>}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialogTarget && (
        <MergedAttendanceDialog
          enrollmentId={dialogTarget.enrollmentId}
          dateStr={dialogTarget.dateStr}
          log={dialogTarget.log}
          openContext={dialogTarget.context}
          onSave={markMutation.mutate}
          onDelete={removeMutation.mutate}
          onClose={() => setDialogTarget(null)}
        />
      )}
    </div>
  )
}
