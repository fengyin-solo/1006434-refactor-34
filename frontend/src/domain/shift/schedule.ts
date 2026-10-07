import type { ShiftKind, ShiftSchedule } from './types'

/**
 * 排班表：值班班组、交班人员、接班人员的唯一来源。
 *
 * 背景：过去值班看板拿「交班人员的排班」推、交接列表拿交接时间推、运营概览跟着状态走，
 * 三处口径不一。收拢以后，任何页面要拿班组或交接双方，都只能从这里解析。
 *
 * 现场为四值两运转：甲、乙、丙、丁四个运行值轮白班/夜班；
 * 白班 08:00–20:00，夜班 20:00–次日 08:00，到点交班，给 HANDOVER_GRACE_MINUTES 分钟宽限。
 */

/** 交接宽限分钟数：计划交接时刻之后这么多分钟内完成都不算超时。 */
export const HANDOVER_GRACE_MINUTES = 15

/** 每个班次的计划交接（下班）时刻。 */
export const SHIFT_PLAN: Record<ShiftKind, { start: string; handover: string }> = {
  白班: { start: '08:00', handover: '20:00' },
  夜班: { start: '20:00', handover: '08:00' },
}

/** 四个运行值按日轮转，同一天白班、夜班由相邻两个值承担。 */
const TEAM_ROTATION = ['甲值', '乙值', '丙值', '丁值'] as const
/** 交接班双方的固定姓氏排班（按值内岗位定岗）。 */
const OPERATOR_POOL = ['张伟', '王磊', '李娜', '陈强', '刘洋', '赵敏', '周杰', '吴芳']
const LEADER_POOL = ['孙建国', '马海涛', '朱晓东', '胡立军']

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 把 Date 格式化成 YYYY-MM-DD（本地时区，与现场录入习惯一致）。 */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 把 Date 格式化成 YYYY-MM-DD HH:mm。 */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** 与 Date 的天数差（b - a），按本地零点计算，不受 DST 影响。 */
export function diffDays(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((db - da) / 86_400_000)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** 解析 YYYY-MM-DD HH:mm 为本地 Date。 */
export function parseDateTime(value: string): Date {
  const [datePart, timePart = '00:00'] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/** 排班键。 */
export function scheduleKeyOf(date: string, kind: ShiftKind): string {
  return `${date}#${kind}`
}

/**
 * 生成某自然日某班次的排班。
 * 轮转基准取 2026-10-01：当天白班为甲值，之后每天递进一个值，夜班再递进一个值。
 */
export function scheduleFor(date: string, kind: ShiftKind): ShiftSchedule {
  const dayIndex = diffDays(parseDate('2026-10-01'), parseDate(date))
  const rotationBase = kind === '白班' ? 0 : 1
  const teamIndex = ((dayIndex + rotationBase) % TEAM_ROTATION.length + TEAM_ROTATION.length) % TEAM_ROTATION.length
  const team = TEAM_ROTATION[teamIndex]
  const handoverClock = SHIFT_PLAN[kind].handover

  // 夜班在次日 08:00 交班；白班当天 20:00 交班。
  const handoverDate = kind === '夜班' ? formatDate(addDays(parseDate(date), 1)) : date
  const scheduledAt = `${handoverDate} ${handoverClock}`

  const leader = LEADER_POOL[teamIndex]
  const outgoing = OPERATOR_POOL[teamIndex * 2 % OPERATOR_POOL.length]
  const incoming = OPERATOR_POOL[(teamIndex * 2 + 1) % OPERATOR_POOL.length]

  return {
    key: scheduleKeyOf(date, kind),
    date,
    kind,
    team,
    leader,
    outgoingOperator: outgoing,
    incomingOperator: incoming,
    scheduledAt,
  }
}

/** 生成给定日期区间（含首尾）的全部白班/夜班排班。 */
export function scheduleRange(startDate: string, endDate: string): ShiftSchedule[] {
  const result: ShiftSchedule[] = []
  const total = diffDays(parseDate(startDate), parseDate(endDate))
  for (let offset = 0; offset <= total; offset += 1) {
    const date = formatDate(addDays(parseDate(startDate), offset))
    result.push(scheduleFor(date, '白班'))
    result.push(scheduleFor(date, '夜班'))
  }
  return result
}

const scheduleCache = new Map<string, ShiftSchedule>()

/** 按排班键取排班；取到的对象是共享只读的，谁都不允许在上面改人员。 */
export function resolveSchedule(key: string): ShiftSchedule | null {
  const [date, kind] = key.split('#')
  if (!date || (kind !== '白班' && kind !== '夜班') || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null
  }
  const [, month, day] = date.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const cached = scheduleCache.get(key)
  if (cached) {
    return cached
  }
  const schedule = scheduleFor(date, kind)
  scheduleCache.set(key, schedule)
  return schedule
}

/** 交接时限：计划交接时刻 + 宽限分钟。 */
export function handoverDeadline(scheduledAt: string): Date {
  const deadline = parseDateTime(scheduledAt)
  deadline.setMinutes(deadline.getMinutes() + HANDOVER_GRACE_MINUTES)
  return deadline
}
