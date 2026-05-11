import { useState, useCallback, useMemo } from 'react'
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

// ─── Attendance cell ───────────────────────────────────────────────────────────

const STATUS_CYCLE: (AttendanceStatus | null)[] = ['present', 'absent_excused', 'absent_unexcused', null]
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
  special:          '★',
}

function isFrozen(status: string, frozenFrom: string | null, frozenTo: string | null, dateStr: string): boolean {
  if (status !== 'frozen') return false
  if (!frozenFrom || !frozenTo) return false
  return dateStr >= frozenFrom && dateStr <= frozenTo
}

interface CellProps {
  enrollmentId: string
  dateStr:      string
  logId:        string | null
  currentStatus: AttendanceStatus | null
  frozen:        boolean
  onMark:        (enrollmentId: string, dateStr: string, logId: string | null, status: AttendanceStatus | null) => void
  pending:       boolean
}

function AttendanceCell({ enrollmentId, dateStr, logId, currentStatus, frozen, onMark, pending }: CellProps) {
  if (frozen) {
    return (
      <td className="px-0.5 py-1 text-center">
        <span className="inline-block w-7 h-7 rounded border border-gray-200 bg-gray-50 text-gray-300 text-xs leading-7">—</span>
      </td>
    )
  }

  const handleClick = () => {
    const idx   = STATUS_CYCLE.indexOf(currentStatus)
    const next  = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    onMark(enrollmentId, dateStr, logId, next)
  }

  if (!currentStatus) {
    return (
      <td className="px-0.5 py-1 text-center">
        <button
          onClick={handleClick}
          disabled={pending}
          className="w-7 h-7 rounded border border-dashed border-gray-300 text-gray-300 text-xs hover:border-green-400 hover:text-green-500 transition-colors disabled:opacity-40"
        />
      </td>
    )
  }

  return (
    <td className="px-0.5 py-1 text-center">
      <button
        onClick={handleClick}
        disabled={pending}
        className={`w-7 h-7 rounded border text-xs font-medium transition-colors disabled:opacity-40 ${STATUS_STYLE[currentStatus]}`}
        title={currentStatus}
      >
        {STATUS_LABEL[currentStatus]}
      </button>
    </td>
  )
}

// ─── Activity color palette ────────────────────────────────────────────────────

const ACTIVITY_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
]

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

  // Filters
  const [activeActivityIds, setActiveActivityIds] = useState<Set<string> | null>(null) // null = all
  const [groupFilter, setGroupFilter] = useState<string>('')

  const { data, isLoading } = useQuery({
    queryKey: ['merged-journal', id, from, to],
    queryFn:  () => mergedJournalsApi.getJournal(id!, from, to),
    enabled:  !!id,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['merged-journal', id, from, to] })

  const markMutation = useMutation({
    mutationFn: async ({ enrollmentId, dateStr, logId, status }: {
      enrollmentId: string; dateStr: string; logId: string | null; status: AttendanceStatus | null
    }) => {
      if (status === null && logId) { await attendanceApi.remove(logId); return }
      if (logId)  { await attendanceApi.update(logId, { status: status! }); return }
      await attendanceApi.mark({ enrollment_id: enrollmentId, date: dateStr, status: status! })
    },
    onSuccess: invalidate,
  })

  const handleMark = useCallback((enrollmentId: string, dateStr: string, logId: string | null, status: AttendanceStatus | null) => {
    markMutation.mutate({ enrollmentId, dateStr, logId, status })
  }, [markMutation])

  const mj         = data?.merged_journal
  const activities  = data?.activities ?? []
  const dates       = data?.dates ?? []
  const allRows     = data?.rows ?? []

  // Activity color map
  const activityColorMap = useMemo(() => {
    const map = new Map<string, string>()
    activities.forEach((a, i) => map.set(a.id, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]))
    return map
  }, [activities])

  // Unique groups for filter
  const groups = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of allRows) {
      if (r.group_id && r.group_name) seen.set(r.group_id, r.group_name)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [allRows])

  // Filtered rows
  const rows = useMemo(() => {
    return allRows.filter(r => {
      if (groupFilter && r.group_id !== groupFilter) return false
      if (activeActivityIds !== null && !activeActivityIds.has(r.activity_id)) return false
      return true
    })
  }, [allRows, groupFilter, activeActivityIds])

  const toggleActivity = (actId: string) => {
    setActiveActivityIds(prev => {
      const all = new Set(activities.map(a => a.id))
      const current = prev ?? all
      const next = new Set(current)
      if (next.has(actId)) next.delete(actId)
      else next.add(actId)
      if (next.size === all.size) return null // all = no filter
      return next
    })
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  if (!mj) return <div className="py-12 text-center text-sm text-gray-400">Журнал не знайдено</div>

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/journals" className="hover:text-iris-600 transition-colors">Журнали</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{mj.name}</span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Mode switcher */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 transition-colors ${mode === m ? 'bg-iris-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {m === 'day' ? 'День' : m === 'week' ? 'Тиждень' : 'Місяць'}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(navigate(baseDate, mode, -1))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">←</button>
          <span className="text-sm font-medium text-gray-800 min-w-[180px] text-center">
            {formatHeader(from, to, mode)}
          </span>
          <button onClick={() => setDate(navigate(baseDate, mode, 1))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">→</button>
        </div>

        {/* Group filter */}
        {groups.length > 0 && (
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-iris-500">
            <option value="">Усі групи</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        <span className="text-sm text-gray-400">{rows.length} дітей</span>
      </div>

      {/* Activity filter chips */}
      {activities.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {activities.map(a => {
            const color = activityColorMap.get(a.id) ?? ACTIVITY_COLORS[0]
            const isOn  = activeActivityIds === null || activeActivityIds.has(a.id)
            return (
              <button key={a.id} onClick={() => toggleActivity(a.id)}
                className={`text-xs px-3 py-1 rounded-full border transition-all ${
                  isOn ? color + ' border-transparent' : 'bg-gray-100 text-gray-400 border-gray-200'
                }`}>
                {a.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {activities.length === 0
              ? 'У цьому журналі ще немає активностей'
              : 'Немає записаних дітей для вибраних фільтрів'}
          </div>
        ) : (
          <table className="text-sm border-collapse min-w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[180px]">
                  Дитина
                </th>
                {activities.length > 1 && (
                  <th className="text-left px-2 py-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[120px]">
                    Журнал
                  </th>
                )}
                {dates.map(d => {
                  const { day, num } = formatDayCol(d)
                  return (
                    <th key={d} className="px-0.5 py-2 text-center font-medium text-gray-400 min-w-[32px]">
                      <div className="text-xs leading-tight">{day}</div>
                      <div className="text-xs leading-tight">{num}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(row => {
                const frozen_check = (dateStr: string) => isFrozen(row.status, row.frozen_from, row.frozen_to, dateStr)
                const actColor = activityColorMap.get(row.activity_id) ?? ACTIVITY_COLORS[0]
                const actName  = activities.find(a => a.id === row.activity_id)?.name ?? ''

                return (
                  <tr key={row.enrollment_id} className="hover:bg-gray-50">
                    {/* Child name */}
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{row.child_name}</div>
                      {row.group_name && (
                        <div className="text-xs text-gray-400">{row.group_name}</div>
                      )}
                      {row.status === 'frozen' && (
                        <span className="text-xs text-blue-500">❄ Заморожено</span>
                      )}
                    </td>

                    {/* Source activity badge */}
                    {activities.length > 1 && (
                      <td className="px-2 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${actColor}`}>
                          {actName}
                        </span>
                      </td>
                    )}

                    {/* Attendance cells */}
                    {dates.map(dateStr => {
                      const log    = row.logs[dateStr]
                      const logId  = log?.id ?? null
                      const status = (log?.status ?? null) as AttendanceStatus | null
                      return (
                        <AttendanceCell
                          key={dateStr}
                          enrollmentId={row.enrollment_id}
                          dateStr={dateStr}
                          logId={logId}
                          currentStatus={status}
                          frozen={frozen_check(dateStr)}
                          onMark={handleMark}
                          pending={markMutation.isPending}
                        />
                      )
                    })}
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
