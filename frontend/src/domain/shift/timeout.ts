import { formatDateTime, handoverDeadline, parseDateTime } from './schedule'
import type {
  HandoverRecord,
  HandoverStatus,
  HandoverVerdict,
  HandoverVerdictView,
  HandoverView,
  ShiftSchedule,
} from './types'

/**
 * 交接超时的唯一算法实现。
 *
 * 旧的三套口径：
 * 1. 交接班列表：拿「交接时间」往后推一个宽限期；
 * 2. 值班看板：拿「交班人员的排班」推时限；
 * 3. 运营概览：跟着交接状态走（有遗留就计超时）。
 * 同一张记录三处结果不一致，遗留事项还会让记录被再算一遍超时。
 *
 * 收拢后的口径（三处都走这里）：
 * - 基准时刻只认排班给的「计划交接时刻」，人员与班组也只从排班取；
 * - 时限 = 计划交接时刻 + HANDOVER_GRACE_MINUTES；
 * - 办结时刻（实际交接完成）晚于时限即超时；
 * - 已办结记录返回台账里冻结的结论，永不重算——「有遗留」只是办结的一种结果，不再触发超时；
 * - 未办结记录按当前时刻实时评估，仅用于展示，不落库。
 */

export type Clock = () => Date

export const defaultClock: Clock = () => new Date()

const CLOSED_STATUSES: HandoverStatus[] = ['已交接', '有遗留']

export function isClosed(record: HandoverRecord): boolean {
  return CLOSED_STATUSES.includes(record.status)
}

export function toView(record: HandoverRecord, schedule: ShiftSchedule): HandoverView {
  return {
    record,
    schedule,
    team: schedule.team,
    leader: schedule.leader,
    outgoingOperator: schedule.outgoingOperator,
    incomingOperator: schedule.incomingOperator,
    verdict: evaluate(record, schedule),
  }
}

/**
 * 评估一条交接记录的超时结论。
 * 这是全仓库唯一允许判定「超时/未超时」的入口。
 */
export function evaluate(
  record: HandoverRecord,
  schedule: ShiftSchedule,
  now: Date = defaultClock(),
): HandoverVerdictView {
  const deadline = handoverDeadline(schedule.scheduledAt)
  const base = {
    scheduledAt: schedule.scheduledAt,
    deadline: formatDateTime(deadline),
  }

  // 已办结：直接回放冻结结论，历史是高是低都留着，不回头重算。
  if (isClosed(record) && record.verdict) {
    return {
      ...base,
      overdue: record.verdict.overdue,
      status: record.verdict.overdue ? '超时' : '未超时',
      completedAt: record.verdict.completedAt,
      overdueMinutes: record.verdict.overdueMinutes,
      frozen: true,
    }
  }

  // 未办结：到时限仍没办结即实时判超时；办结动作发生时才会把结论冻结回写。
  const completedAt = record.completedAt ? formatDateTime(parseDateTime(record.completedAt)) : null
  if (now.getTime() <= deadline.getTime()) {
    return { ...base, overdue: false, status: '进行中', completedAt, overdueMinutes: 0, frozen: false }
  }

  const overdueMs = now.getTime() - deadline.getTime()
  return {
    ...base,
    overdue: true,
    status: '超时',
    completedAt,
    overdueMinutes: Math.max(1, Math.floor(overdueMs / 60_000)),
    frozen: false,
  }
}

/**
 * 办结时刻生成超时结论（冻结值）。仅在办结动作里调用一次。
 * 若记录已带冻结结论，原样返回，保证遗留登记等后续动作不会把超时再算一遍。
 */
export function decideVerdict(
  record: HandoverRecord,
  schedule: ShiftSchedule,
  completedAt: Date = defaultClock(),
): HandoverVerdict {
  if (record.verdict) {
    return record.verdict
  }
  const deadline = handoverDeadline(schedule.scheduledAt)
  const overdueMs = completedAt.getTime() - deadline.getTime()
  const overdue = overdueMs > 0
  return {
    overdue,
    scheduledAt: schedule.scheduledAt,
    deadline: formatDateTime(deadline),
    completedAt: formatDateTime(completedAt),
    overdueMinutes: overdue ? Math.max(1, Math.floor(overdueMs / 60_000)) : 0,
    decidedAt: formatDateTime(new Date()),
  }
}
