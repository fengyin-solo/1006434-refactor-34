/**
 * 值班交接班领域模型。
 *
 * 这一份类型是交接班列表、值班看板、运营概览的共同语言：
 * - 值班班组、交班人员、接班人员一律从「排班（ShiftSchedule）」取，记录里只存排班键；
 * - 超时结论（HandoverVerdict）由共用算法 evaluateHandover 产出，办结后冻结并回写台账；
 * - 三个页面只读 HandoverView，不再各算各的。
 */

/** 班次：白班 / 夜班。 */
export type ShiftKind = '白班' | '夜班'

/** 交接状态：待交接 → 交接中 → 已交接（有遗留事项的办结记录仍归在「有遗留」）。 */
export type HandoverStatus = '待交接' | '交接中' | '已交接' | '有遗留'

/** 排班：班组与班次下的交班、接班人员的唯一来源。 */
export type ShiftSchedule = {
  /** 排班业务键：YYYY-MM-DD#班次，如 2026-10-07#白班。 */
  key: string
  /** 班次所在自然日。 */
  date: string
  kind: ShiftKind
  team: string
  leader: string
  outgoingOperator: string
  incomingOperator: string
  /** 计划交接时刻（ISO 字符串，含时分），超时算法的基准点。 */
  scheduledAt: string
}

/** 超时结论：办结时冻结进台账，此后任何页面、任何动作都不再重算。 */
export type HandoverVerdict = {
  /** 是否超时。 */
  overdue: boolean
  /** 计划交接时刻。 */
  scheduledAt: string
  /** 交接时限（计划交接时刻 + 宽限分钟）。 */
  deadline: string
  /** 办结时刻（实际完成交接的时刻）。 */
  completedAt: string
  /** 超时分钟数：未超时为 0。 */
  overdueMinutes: number
  /** 结论生成时刻，即回写台账的时刻。 */
  decidedAt: string
}

/** 交接班台账记录（持久化形态）。 */
export type HandoverRecord = {
  id: number
  /** 交接编号：同一张交接单的业务幂等键，重复提交只记一次。 */
  code: string
  /** 排班键：班组、交班/接班人员都凭它从排班解析。 */
  scheduleKey: string
  matter: string
  status: HandoverStatus
  /** 发起交接的时刻。 */
  startedAt: string | null
  /** 办结时刻（确认交接或登记遗留的时刻）。 */
  completedAt: string | null
  /** 遗留事项说明；为空表示没有遗留。 */
  leftover: string
  /** 办结后冻结的超时结论；未办结为 null，办结后不再改动。 */
  verdict: HandoverVerdict | null
}

/** 台账记录拼上排班后的只读视图，三个页面消费的都是这一份。 */
export type HandoverView = {
  record: HandoverRecord
  schedule: ShiftSchedule
  team: string
  leader: string
  outgoingOperator: string
  incomingOperator: string
  /** 共用算法给出的超时结论：办结记录取冻结结论，未办结记录按当前时刻实时评估。 */
  verdict: HandoverVerdictView
}

/** 给页面展示用的超时结论（未办结记录也带一份实时结果，但不会落库）。 */
export type HandoverVerdictView = {
  overdue: boolean
  status: '超时' | '未超时' | '进行中'
  scheduledAt: string
  deadline: string
  completedAt: string | null
  overdueMinutes: number
  /** 结论是否已冻结（办结历史记录为 true，概览/看板不得重算）。 */
  frozen: boolean
}

/** 动作执行结果。 */
export type HandoverActionResult = {
  ok: boolean
  message: string
  /** 是否命中了「同一张交接单重复提交」：true 表示直接沿用既有记录，没有新增/改写。 */
  duplicated?: boolean
}

/** 看板 / 概览共用的统计口径，全部按台账记录逐条统计，遗留记录只算一次。 */
export type HandoverStats = {
  total: number
  pending: number
  inProgress: number
  completed: number
  withLeftover: number
  overdue: number
  onTime: number
}
