import { useState, useCallback, useMemo, memo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mergedJournalsApi } from '../../api/mergedJournals.api'
import { attendanceApi } from '../../api/attendance.api'
import type { AttendanceStatus, AttendanceLog } from '../../types'

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
}
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present:          'П',
  absent_excused:   'В',
  absent_unexcused: 'Н',
  special:          '',
}

function isFrozen(status: string, frozenFrom: string | null, frozenTo: string | null, dateStr: string): boolean {
  if (status !== 'frozen') return false
  if (!frozenFrom || !frozenTo) return false
  return dateStr >= frozenFrom && dateStr <= frozenTo
}

// ─── Optimized Attendance cell ────────────────────────────────────────────────

interface CellProps {
  enrollmentId: string
  dateStr:      string
  log:          AttendanceLog | null
  frozen:        boolean
  isHighlighted: boolean
  onMark:        (enrollmentId: string, dateStr: string) => void
  onOpenDialog:  (enrollmentId: string, dateStr: string) => void
  onHover:       (dateStr: string | null) => void
  pending:       boolean
}

const AttendanceCell = memo(({ enrollmentId, dateStr, log, frozen, isHighlighted, onMark, onOpenDialog, onHover, pending }: CellProps) => {
  const baseClasses = `w-7 h-7 mx-auto rounded border transition-all select-none cursor-pointer group flex items-center justify-center text-xs ${
    isHighlighted ? 'journal-cell-highlighted ring-1 ring-iris-200' : ''
  }`

  if (frozen) {
    return (
      <div className={`${baseClasses} border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed`} title="Заморожено">—</div>
    )
  }

  if (!log) {
    return (
      <button
        onClick={() => onMark(enrollmentId, dateStr)}
        onMouseEnter={() => onHover(dateStr)}
        onMouseLeave={() => onHover(null)}
        disabled={pending}
        className={`${baseClasses} border-dashed border-gray-300 text-gray-300 hover:border-gray-400 hover:text-gray-400 disabled:opacity-40`}
      >
        <span className="opacity-0 group-hover:opacity-100">+</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => onOpenDialog(enrollmentId, dateStr)}
      onMouseEnter={() => onHover(dateStr)}
      onMouseLeave={() => onHover(null)}
      disabled={pending}
      className={`${baseClasses} font-bold transition-all disabled:opacity-40 ${STATUS_STYLE[log.status as AttendanceStatus]}`}
    >
      {log.status === 'special' ? Number(log.custom_amount).toFixed(0) : STATUS_LABEL[log.status as AttendanceStatus]}
      {log.note && (
        <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-full border border-white" />
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

function MergedAttendanceDialog({ enrollmentId, dateStr, log, onSave, onDelete, onClose }: any) {
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
        <div className="grid grid-cols-4 gap-2">
          {(['present', 'absent_excused', 'absent_unexcused', 'special'] as AttendanceStatus[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`py-2 px-1 rounded-xl border text-xs font-bold transition-all ${status === s ? STATUS_STYLE[s] + ' ring-2 ring-offset-1 ring-iris-500' : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100'}`}>
              {s === 'present' ? 'П' : s === 'absent_excused' ? 'В' : s === 'absent_unexcused' ? 'Н' : '$$$'}
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
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-xl border-gray-200 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500 resize-none" />
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

  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [dialogTarget, setDialogTarget] = useState<any | null>(null)

  const setMode = (m: Mode) => setSearchParams({ mode: m, date: baseDate })
  const setDate = (d: string) => setSearchParams({ mode, date: d })

  const [activeActivityIds, setActiveActivityIds] = useState<Set<string> | null>(null)
  const [groupFilter, setGroupFilter] = useState<string>('')

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
  const activities  = data?.activities ?? []
  const dates       = data?.dates ?? []
  const allRows     = data?.rows ?? []

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

  const rows = useMemo(() => {
    return allRows.filter(r => {
      if (groupFilter && r.group_id !== groupFilter) return false
      if (activeActivityIds !== null && !activeActivityIds.has(r.activity_id)) return false
      return true
    }).sort((a, b) => a.child_name.localeCompare(b.child_name))
  }, [allRows, groupFilter, activeActivityIds])

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
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/journals" className="hover:text-iris-600 transition-colors">Журнали</Link>
        <span>/</span>
        <span className="text-gray-900 font-bold">{mj.name}</span>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex p-1 bg-gray-50 rounded-xl text-xs font-bold">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-lg transition-all ${mode === m ? 'bg-white text-iris-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              {m === 'day' ? 'ДЕНЬ' : m === 'week' ? 'ТИЖДЕНЬ' : 'МІСЯЦЬ'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setDate(navigate(baseDate, mode, -1))} className="p-2 border border-gray-100 rounded-xl hover:bg-gray-50 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-sm font-bold text-gray-800 min-w-[180px] text-center">{formatHeader(from, to, mode)}</span>
          <button onClick={() => setDate(navigate(baseDate, mode, 1))} className="p-2 border border-gray-100 rounded-xl hover:bg-gray-50 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        {groups.length > 0 && (
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="text-xs font-bold border border-gray-100 rounded-xl px-3 py-2 text-gray-600 focus:ring-iris-500 focus:border-iris-500">
            <option value="">УСІ ГРУПИ</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      {activities.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {activities.map(a => {
            const color = activityColorMap.get(a.id) ?? ACTIVITY_COLORS[0]
            const isOn  = activeActivityIds === null || activeActivityIds.has(a.id)
            return (
              <button key={a.id} onClick={() => toggleActivity(a.id)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${isOn ? color + ' border-transparent shadow-sm' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                {a.name.toUpperCase()}
              </button>
            )
          })}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto overflow-y-visible relative">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-[64px] z-30 shadow-sm bg-gray-50">
            <tr>
              <th className="sticky left-0 z-40 bg-gray-50 text-left px-5 py-3 font-bold text-gray-400 text-[10px] uppercase tracking-widest border-b border-gray-100 min-w-[200px]">Дитина</th>
              {activities.length > 1 && <th className="z-20 bg-gray-50 text-left px-2 py-3 font-bold text-gray-400 text-[10px] uppercase tracking-widest border-b border-gray-100">Журнал</th>}
              {dates.map(d => {
                const { day, num } = formatDayCol(d)
                return (
                  <th key={d} onMouseEnter={() => setHoveredDate(d)} onMouseLeave={() => setHoveredDate(null)}
                    className={`px-0.5 py-2 text-center font-bold border-b border-gray-100 transition-colors ${hoveredDate === d ? 'bg-iris-50' : 'bg-gray-50'}`}>
                    <div className="text-[10px] text-gray-400 leading-tight">{day}</div>
                    <div className={`text-sm leading-tight ${hoveredDate === d ? 'text-iris-600' : 'text-gray-800'}`}>{num}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(row => {
              const actColor = activityColorMap.get(row.activity_id) ?? ACTIVITY_COLORS[0]
              const actName  = activities.find(a => a.id === row.activity_id)?.name ?? ''

              return (
                <tr key={row.enrollment_id} className="hover:bg-iris-50/20 transition-colors group">
                  <td className="sticky left-0 z-10 px-5 py-3 whitespace-nowrap border-r border-gray-50 bg-white group-hover:bg-inherit font-bold text-gray-900 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                    <Link to={`/children/${row.child_id}`} className="hover:text-iris-600 transition-colors">
                      {row.child_name}
                    </Link>
                    {row.group_name && <div className="text-[9px] text-gray-400 uppercase">{row.group_name}</div>}
                  </td>
                  {activities.length > 1 && (
                    <td className="px-2 py-2">
                      <span className={`text-[9px] font-bold px-2 py-1 rounded-lg uppercase whitespace-nowrap ${actColor}`}>{actName}</span>
                    </td>
                  )}
                  {dates.map(dateStr => (
                    <td key={dateStr} className={`px-0.5 py-1 text-center transition-colors ${hoveredDate === dateStr ? 'bg-iris-50/40' : ''}`}>
                      <AttendanceCell
                        enrollmentId={row.enrollment_id}
                        dateStr={dateStr}
                        log={row.logs[dateStr]}
                        frozen={isFrozen(row.status, row.frozen_from, row.frozen_to, dateStr)}
                        isHighlighted={hoveredDate === dateStr}
                        onMark={handleQuickMark}
                        onOpenDialog={(eId, dStr) => setDialogTarget({ enrollmentId: eId, dateStr: dStr, log: row.logs[dStr] })}
                        onHover={setHoveredDate}
                        pending={markMutation.isPending}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {dialogTarget && (
        <MergedAttendanceDialog
          enrollmentId={dialogTarget.enrollmentId}
          dateStr={dialogTarget.dateStr}
          log={dialogTarget.log}
          onSave={markMutation.mutate}
          onDelete={removeMutation.mutate}
          onClose={() => setDialogTarget(null)}
        />
      )}
    </div>
  )
}
