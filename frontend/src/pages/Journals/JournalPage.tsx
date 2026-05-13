import { useState, useCallback } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attendanceApi } from '../../api/attendance.api'
import type { AttendanceStatus, JournalRow } from '../../types'

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
  // month
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

// ─── Клітинка відмітки ────────────────────────────────────────────────────────

const STATUS_CYCLE: (AttendanceStatus | null)[] = ['present', 'absent_excused', 'absent_unexcused', null]

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
  special:          '★',
}
const STATUS_FULL: Record<AttendanceStatus, string> = {
  present:          'Присутній',
  absent_excused:   'Відсутній (поважна)',
  absent_unexcused: 'Відсутній (неповажна)',
  special:          'Спец. тариф',
}

interface CellProps {
  row: JournalRow
  dateStr: string
  onMark: (enrollmentId: string, dateStr: string, logId: string | null, status: AttendanceStatus | null) => void
  onSpecial: (row: JournalRow, dateStr: string) => void
  compact?: boolean
}

function AttendanceCell({ row, dateStr, onMark, onSpecial, compact }: CellProps) {
  const frozen = isFrozenOn(row, dateStr)
  const log = row.logs[dateStr]

  if (frozen) {
    return (
      <div className={`flex items-center justify-center rounded border border-gray-100 bg-gray-50 text-gray-300 select-none ${compact ? 'h-7 w-7' : 'h-8 px-2 min-w-[2rem]'}`}
        title="Заморожено">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
    )
  }

  if (!log) {
    return (
      <button
        onClick={() => onMark(row.enrollment_id, dateStr, null, 'present')}
        className={`rounded border border-dashed border-gray-200 bg-white text-gray-300 hover:border-gray-400 hover:text-gray-400 transition-colors ${compact ? 'h-7 w-7' : 'h-8 px-3 min-w-[2rem]'}`}
        title="Поставити відмітку"
      >
        <span className="text-xs">+</span>
      </button>
    )
  }

  const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(log.status) + 1) % STATUS_CYCLE.length]

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => {
          if (log.status === 'special') { onSpecial(row, dateStr); return }
          onMark(row.enrollment_id, dateStr, log.id, next)
        }}
        className={`rounded border font-medium transition-colors ${STATUS_STYLE[log.status]} ${compact ? 'h-7 w-7 text-xs' : 'h-8 px-2 text-xs min-w-[2rem]'}`}
        title={STATUS_FULL[log.status] + (log.custom_amount ? ` · ${Number(log.custom_amount).toFixed(0)} грн` : '')}
      >
        {compact ? STATUS_LABEL[log.status] : (
          <span>{STATUS_LABEL[log.status]}{log.custom_amount ? ` ${Number(log.custom_amount).toFixed(0)}` : ''}</span>
        )}
      </button>
      {!compact && log.status !== 'special' && (
        <button
          onClick={() => onSpecial(row, dateStr)}
          className="h-8 w-6 text-gray-300 hover:text-iris-500 transition-colors text-xs"
          title="Спец. тариф"
        >★</button>
      )}
    </div>
  )
}

// ─── Попап спец-тарифу ────────────────────────────────────────────────────────

interface SpecialPopupProps {
  row: JournalRow
  dateStr: string
  onSave: (enrollmentId: string, dateStr: string, logId: string | null, amount: number, note: string) => void
  onClose: () => void
}

function SpecialPopup({ row, dateStr, onSave, onClose }: SpecialPopupProps) {
  const log = row.logs[dateStr]
  const [amount, setAmount] = useState(log?.custom_amount ? String(Number(log.custom_amount)) : '')
  const [note, setNote]   = useState(log?.note ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-5 w-80 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-semibold text-gray-900">Спец. тариф</h3>
          <p className="text-xs text-gray-500 mt-0.5">{row.child_name} · {dateStr}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Сума (грн)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Примітка</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>
        <div className="flex gap-3">
          <button onClick={() => { if (!amount) return; onSave(row.enrollment_id, dateStr, log?.id ?? null, Number(amount), note) }}
            disabled={!amount}
            className="flex-1 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            Зберегти
          </button>
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium">Скасувати</button>
        </div>
      </div>
    </div>
  )
}

// ─── Головна сторінка журналу ─────────────────────────────────────────────────

export function JournalPage() {
  const { activityId } = useParams<{ activityId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()

  const mode = (searchParams.get('mode') as Mode) ?? 'week'
  const baseDate = searchParams.get('date') ?? toStr(new Date())
  const isEmbedded = searchParams.get('layout') === 'none'
  const [from, to] = getRange(baseDate, mode)

  const [specialTarget, setSpecialTarget] = useState<{ row: JournalRow; dateStr: string } | null>(null)

  // Preserve ?layout=none when navigating within the journal (iframe context)
  const setMode = (m: Mode) => {
    const p: Record<string, string> = { mode: m, date: baseDate }
    if (isEmbedded) p.layout = 'none'
    setSearchParams(p)
  }
  const setDate = (d: string) => {
    const p: Record<string, string> = { mode, date: d }
    if (isEmbedded) p.layout = 'none'
    setSearchParams(p)
  }

  // Notify parent window (calendar) that attendance was saved
  const notifyParent = () => {
    if (isEmbedded && window.parent !== window) {
      window.parent.postMessage({ type: 'JOURNAL_SAVED', activityId, date: baseDate }, window.location.origin)
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['journal', activityId, from, to],
    queryFn: () => attendanceApi.getJournal(activityId!, from, to),
    enabled: !!activityId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['journal', activityId, from, to] })

  const markMutation = useMutation({
    mutationFn: async ({ enrollmentId, dateStr, logId, status }: { enrollmentId: string; dateStr: string; logId: string | null; status: AttendanceStatus | null }) => {
      if (status === null && logId) { await attendanceApi.remove(logId); return }
      if (logId)  { await attendanceApi.update(logId, { status: status! }); return }
      await attendanceApi.mark({ enrollment_id: enrollmentId, date: dateStr, status: status! })
    },
    onSuccess: () => { invalidate(); notifyParent() },
  })

  const groupMarkMutation = useMutation({
    mutationFn: async ({ dateStr, logId, status }: { dateStr: string; logId: string | null; status: 'conducted' | 'cancelled' | null }) => {
      if (status === null && logId) { await attendanceApi.removeGroup(logId); return }
      if (status !== null) { await attendanceApi.markGroup({ activity_id: activityId!, date: dateStr, status }) }
    },
    onSuccess: invalidate,
  })

  const specialMutation = useMutation({
    mutationFn: ({ enrollmentId, dateStr, logId, amount, note }: { enrollmentId: string; dateStr: string; logId: string | null; amount: number; note: string }) => {
      if (logId) return attendanceApi.update(logId, { status: 'special', custom_amount: amount, note: note || null })
      return attendanceApi.mark({ enrollment_id: enrollmentId, date: dateStr, status: 'special', custom_amount: amount, note: note || null })
    },
    onSuccess: () => { invalidate(); notifyParent(); setSpecialTarget(null) },
  })

  const handleMark = useCallback((enrollmentId: string, dateStr: string, logId: string | null, status: AttendanceStatus | null) => {
    markMutation.mutate({ enrollmentId, dateStr, logId, status })
    if (data?.activity?.auto_group_classes && (status === 'present' || status === 'special')) {
      const gLog = data.group_logs[dateStr]
      if (!gLog || gLog.status !== 'conducted') {
        groupMarkMutation.mutate({ dateStr, logId: gLog?.id ?? null, status: 'conducted' })
      }
    }
  }, [markMutation, groupMarkMutation, data])

  const handleSpecialSave = (enrollmentId: string, dateStr: string, logId: string | null, amount: number, note: string) => {
    specialMutation.mutate({ enrollmentId, dateStr, logId, amount, note })
    if (data?.activity?.auto_group_classes) {
      const gLog = data.group_logs[dateStr]
      if (!gLog || gLog.status !== 'conducted') {
        groupMarkMutation.mutate({ dateStr, logId: gLog?.id ?? null, status: 'conducted' })
      }
    }
  }

  const activity = data?.activity
  const rows = data?.rows ?? []
  const groupLogs = data?.group_logs ?? {}
  const dates = data?.dates ?? []
  const compact = mode === 'month'

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/journals" className="hover:text-iris-600 transition-colors">Журнали</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{activity?.name ?? '...'}</span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Mode switcher */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 font-medium transition-colors ${mode === m ? 'bg-iris-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {m === 'day' ? 'День' : m === 'week' ? 'Тиждень' : 'Місяць'}
            </button>
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(navigate(baseDate, mode, -1))}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-gray-900 min-w-[180px] text-center">
            {formatHeader(from, to, mode)}
          </span>
          <button onClick={() => setDate(navigate(baseDate, mode, 1))}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button onClick={() => setDate(toStr(new Date()))}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
            Сьогодні
          </button>
        </div>

        {/* Activity info chips */}
        {activity && (
          <div className="ml-auto flex items-center gap-2">
            {activity.is_rigid && (
              <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-200">жорсткий абонемент</span>
            )}
            {activity.refund_config?.refund_on_excused && (
              <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-200">
                повернення: {activity.refund_config.refund_amount
                  ? `${Number(activity.refund_config.refund_amount).toFixed(0)} грн`
                  : `${activity.refund_config.refund_pct}%`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-green-100 border-green-200 inline-flex items-center justify-center text-green-700 font-medium">П</span> Присутній</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-amber-100 border-amber-200 inline-flex items-center justify-center text-amber-700 font-medium">В</span> Поважна причина</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-red-100 border-red-200 inline-flex items-center justify-center text-red-700 font-medium">Н</span> Неповажна</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded border bg-iris-100 border-iris-200 inline-flex items-center justify-center text-iris-700 font-medium">★</span> Спец. тариф</span>
      </div>

      {/* Journal table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Немає активних підписок для цієї активності.{' '}
            <Link to={`/activities/${activityId}`} className="text-iris-600 hover:underline">Перейти до активності</Link>
          </div>
        ) : mode === 'day' ? (
          // ── Day view (list layout) ──
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Дитина</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Відмітка</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600 hidden sm:table-cell">Примітка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activity?.has_group_classes && (
                <tr className="bg-iris-50/50 hover:bg-iris-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-iris-900 flex items-center gap-2">
                    Групове заняття
                    {activity.auto_group_classes && <span className="text-[10px] uppercase tracking-wider text-iris-500 border border-iris-200 bg-white px-1.5 rounded-sm">auto</span>}
                  </td>
                  <td className="px-5 py-3">
                    {(() => {
                      const gLog = groupLogs[from]
                      if (!gLog) {
                        return (
                          <button onClick={() => groupMarkMutation.mutate({ dateStr: from, logId: null, status: 'conducted' })}
                            className={`rounded border border-dashed border-gray-300 bg-white text-gray-400 hover:border-gray-500 hover:text-gray-500 transition-colors h-8 px-3 min-w-[2rem]`}
                            title="Відмітити проведення">
                            <span className="text-xs">+</span>
                          </button>
                        )
                      }
                      if (gLog.status === 'conducted') {
                        return (
                          <button onClick={() => groupMarkMutation.mutate({ dateStr: from, logId: gLog.id, status: null })}
                            className={`rounded border font-medium transition-colors bg-iris-100 text-iris-700 border-iris-200 hover:bg-iris-200 h-8 px-2 text-xs min-w-[2rem]`}
                            title="Проведено (натисніть щоб скасувати)">
                            <span>✔ Проведено</span>
                          </button>
                        )
                      }
                      return null
                    })()}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400 hidden sm:table-cell"></td>
                </tr>
              )}
              {rows.map((row) => {
                const frozen = isFrozenOn(row, from)
                const log = row.logs[from]
                return (
                  <tr key={row.enrollment_id} className={frozen ? 'bg-gray-50' : 'hover:bg-gray-50 transition-colors'}>
                    <td className="px-5 py-3 font-medium text-gray-900">
                      <Link to={`/children/${row.child_id}`} className="hover:text-iris-600 transition-colors">
                        {row.child_name}
                      </Link>
                      {frozen && <span className="ml-2 text-xs text-gray-400">· заморожено</span>}
                    </td>
                    <td className="px-5 py-3">
                      <AttendanceCell row={row} dateStr={from} onMark={handleMark} onSpecial={(r, d) => setSpecialTarget({ row: r, dateStr: d })} />
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400 hidden sm:table-cell">{log?.note ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          // ── Week / Month view (grid) ──
          <table className="text-sm border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[160px]">Дитина</th>
                {dates.map((d) => {
                  const { day, num } = formatDayCol(d)
                  const isToday = d === toStr(new Date())
                  return (
                    <th key={d} className={`px-1 py-2 font-medium text-center min-w-[${compact ? '32px' : '60px'}] ${isToday ? 'text-iris-600' : 'text-gray-500'}`}>
                      <div className="text-xs">{day}</div>
                      <div className={`text-sm font-semibold ${isToday ? 'bg-iris-600 text-white rounded-full w-6 h-6 flex items-center justify-center mx-auto' : ''}`}>{num}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activity?.has_group_classes && (
                <tr className="bg-iris-50/50 hover:bg-iris-50 transition-colors">
                  <td className="px-4 py-2 font-medium text-iris-900 sticky left-0 bg-iris-50 border-r border-iris-100 flex items-center justify-between">
                    <span>Групове заняття</span>
                    {activity.auto_group_classes && <span className="text-[9px] uppercase tracking-wider text-iris-500 border border-iris-200 bg-white px-1 rounded-sm mr-1">auto</span>}
                  </td>
                  {dates.map((d) => {
                    const gLog = groupLogs[d]
                    return (
                      <td key={d} className="px-1 py-1.5 text-center">
                        {!gLog ? (
                          <button onClick={() => groupMarkMutation.mutate({ dateStr: d, logId: null, status: 'conducted' })}
                            className={`rounded border border-dashed border-gray-300 bg-white text-gray-400 hover:border-gray-500 hover:text-gray-500 transition-colors ${compact ? 'h-7 w-7' : 'h-8 w-8'}`}
                            title="Відмітити проведення">
                            <span className="text-xs">+</span>
                          </button>
                        ) : gLog.status === 'conducted' ? (
                          <button onClick={() => groupMarkMutation.mutate({ dateStr: d, logId: gLog.id, status: null })}
                            className={`rounded border font-medium transition-colors bg-iris-100 text-iris-700 border-iris-200 hover:bg-iris-200 flex items-center justify-center mx-auto ${compact ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-xs'}`}
                            title="Проведено (натисніть щоб скасувати)">
                            <span>✔</span>
                          </button>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.enrollment_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 font-medium text-gray-900 sticky left-0 bg-white border-r border-gray-100">
                    <Link to={`/children/${row.child_id}`} className="truncate block max-w-[155px] hover:text-iris-600 transition-colors" title={row.child_name}>
                      {row.child_name}
                    </Link>
                    {row.status === 'frozen' && (
                      <span className="text-xs text-gray-400">
                        заморожено {row.frozen_from?.slice(5)} – {row.frozen_to?.slice(5)}
                      </span>
                    )}
                  </td>
                  {dates.map((d) => (
                    <td key={d} className="px-1 py-1.5 text-center">
                      <AttendanceCell row={row} dateStr={d} onMark={handleMark}
                        onSpecial={(r, dt) => setSpecialTarget({ row: r, dateStr: dt })} compact={compact} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Spec tariff popup */}
      {specialTarget && (
        <SpecialPopup
          row={specialTarget.row}
          dateStr={specialTarget.dateStr}
          onSave={handleSpecialSave}
          onClose={() => setSpecialTarget(null)}
        />
      )}
    </div>
  )
}
