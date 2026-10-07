/**
 * 交接班超时的唯一算法实现。
 *
 * 收拢前三处算法各算各的：
 * - 交接班列表拿「交接时间」往后推；
 * - 值班看板拿交班人员的排班推；
 * - 运营概览跟着交接状态走。
 * 收拢后统一口径：以值班花名册里「交班人员」的排班下班点为基准（看板口径），
 * 再给 HANDOVER_GRACE_MINUTES 的办理宽限，得到交接截止时刻；列表、看板、概览都取这一份结论。
 *
 * 历史结论不回头重算：记录办结（已交接/有遗留）的那一刻把结论冻结进交班台账，
 * 以后哪怕排班或时间字段变了，也沿用台账里当时的高低，不再重算。
 * 有遗留事项的记录办结后同样冻结，不会被再算一遍超时。
 */

import type { EntryRow } from '@/data/types'
import { resolveHandoverCrew, type RosterEntry } from '@/data/shift-roster'

export const SHIFT_MODULE_KEY = 'shift'

/** 排班下班点之后允许的交接办理宽限（分钟）。 */
export const HANDOVER_GRACE_MINUTES = 15

/** 办理中的交接状态：超时随时间滚动重算，不冻结。 */
export const OPEN_HANDOVER_STATUSES = ['待交接', '交接中']
/** 办结状态：进入即冻结超时结论，历史记录不回头重算。 */
export const CLOSED_HANDOVER_STATUSES = ['已交接', '有遗留']

export type HandoverVerdict = '准时' | '超时' | '未排班' | '办理中'

/** 回写到交班台账的字段（办结后按当时的高低冻结留档）。 */
export const HANDOVER_LEDGER_FIELDS = {
  deadline: '交接截止时刻',
  verdict: '超时结论',
  overMinutes: '超时分钟',
  usedMinutes: '办理用时分钟',
  evaluatedAt: '结论判定时间',
  frozen: '结论已冻结',
} as const

/** 列表/看板/概览共用的一条交接班视图。 */
export type HandoverView = {
  id: number
  code: string
  status: string
  pending: boolean
  abnormal: boolean
  matters: string
  handoverAt: string
  completedAt: string
  crew: string
  slot: string
  outgoing: string
  incoming: string
  /** 花名册口径的排班，对不上时为 null（结论=未排班）。 */
  roster: RosterEntry | null
  deadlineIso: string | null
  deadlineLabel: string
  verdict: HandoverVerdict
  overMinutes: number | null
  usedMinutes: number | null
  evaluatedAtLabel: string
  frozen: boolean
  /** 是否与台账里旧值不同、需要回写。 */
  dirty: boolean
  /** 结论本次是否发生切换（办理中→超时等），切换时才刷新判定时间。 */
  verdictChanged: boolean
}

function field(row: EntryRow, name: string): string {
  const value = row[name]
  return value === undefined || value === null ? '' : String(value)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 解析「YYYY-MM-DD HH:mm」或「YYYY-MM-DD」，允许用空格/T 分隔。 */
function parseHandoverTime(text: string): Date | null {
  const raw = text.trim()
  if (!raw) {
    return null
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/.exec(raw)
  if (!match) {
    return null
  }
  const [, y, m, d, hh, mm] = match
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    hh === undefined ? 0 : Number(hh),
    mm === undefined ? 0 : Number(mm),
    0,
    0,
  )
  return Number.isNaN(date.getTime()) ? null : date
}

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

/** HH:mm 拆成时分。 */
function hhmm(text: string): { hour: number; minute: number } {
  const [hour, minute] = text.split(':').map((part) => Number(part))
  return { hour: hour || 0, minute: minute || 0 }
}

/**
 * 以交接班基准时刻为锚点，找「不早于交接时刻的最近一个排班下班点」：
 * 交班不可能在起班之前完成，所以当天早上的下班点不能算给当天晚上才起的夜班。
 * 白班锚点取当天 end；夜班锚点取次日 end。再补前后一天兜底锚点时刻略有偏差的情况。
 */
function expectedEndCandidates(base: Date, roster: RosterEntry): Date[] {
  const end = hhmm(roster.end)
  const offsets = roster.overnight ? [1, 0, 2] : [0, 1, -1]
  return offsets.map((offset) => {
    const date = new Date(base)
    date.setDate(date.getDate() + offset)
    date.setHours(end.hour, end.minute, 0, 0)
    return date
  })
}

function nearestEnd(base: Date, roster: RosterEntry): Date {
  const candidates = expectedEndCandidates(base, roster)
  const notBefore = candidates.filter((candidate) => candidate.getTime() >= base.getTime())
  if (notBefore.length) {
    return notBefore.reduce((earliest, candidate) =>
      candidate.getTime() < earliest.getTime() ? candidate : earliest,
    )
  }
  // 理论上不会走到（锚点本身就是候选之一）；保留兜底。
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate.getTime() - base.getTime()) < Math.abs(nearest.getTime() - base.getTime())
      ? candidate
      : nearest,
  )
}

function parseStoredMinutes(value: string): number | null {
  if (value.trim() === '') {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function diffMinutes(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60000)
}

/** 超时结论（含截止时刻、超时/用时分钟）：三处页面看到的都是这一份。 */
export function evaluateHandover(row: EntryRow, now: Date = new Date()): HandoverView {
  const closed = CLOSED_HANDOVER_STATUSES.includes(String(row.status))
  const resolved = resolveHandoverCrew({
    crew: field(row, '值班班组'),
    slot: field(row, '班次'),
    outgoing: field(row, '交班人员'),
    incoming: field(row, '接班人员'),
  })

  const handoverText = field(row, '交接时间')
  const handoverDate = parseHandoverTime(handoverText)
  const completedText = field(row, '完成时间')
  const completedDate = parseHandoverTime(completedText)

  const storedVerdict = field(row, HANDOVER_LEDGER_FIELDS.verdict) as HandoverVerdict | ''
  const storedFrozenFlag = Boolean(row[HANDOVER_LEDGER_FIELDS.frozen])
  const hasFinalVerdict = storedVerdict === '准时' || storedVerdict === '超时'

  // 已冻结的历史记录（办结时留档，或旧台账里已有最终结论）：按当时的高低留着，不回头重算。
  if (closed && (storedFrozenFlag || hasFinalVerdict)) {
    const overMinutes = parseStoredMinutes(field(row, HANDOVER_LEDGER_FIELDS.overMinutes))
    return {
      id: Number(row.id),
      code: field(row, '交接编号'),
      status: String(row.status),
      pending: Boolean(row.pending),
      abnormal: Boolean(row.abnormal),
      matters: field(row, '交接事项'),
      handoverAt: handoverText,
      completedAt: completedText,
      crew: resolved.crew,
      slot: resolved.slot,
      outgoing: resolved.outgoing,
      incoming: resolved.incoming,
      roster: resolved.entry,
      deadlineIso: field(row, HANDOVER_LEDGER_FIELDS.deadline) || null,
      deadlineLabel: field(row, HANDOVER_LEDGER_FIELDS.deadline) || '—',
      verdict: storedVerdict as HandoverVerdict,
      overMinutes: storedVerdict === '超时' ? overMinutes : null,
      usedMinutes: parseStoredMinutes(field(row, HANDOVER_LEDGER_FIELDS.usedMinutes)),
      evaluatedAtLabel: field(row, HANDOVER_LEDGER_FIELDS.evaluatedAt) || '—',
      frozen: true,
      dirty: false,
      verdictChanged: false,
    }
  }

  // 未冻结记录统一以交班人员排班下班点 + 宽限为截止时刻。
  if (!resolved.entry || !handoverDate) {
    return buildLiveView(row, resolved, handoverText, completedText, {
      deadlineIso: null,
      deadlineLabel: '未排班',
      verdict: '未排班',
      overMinutes: null,
      usedMinutes: null,
    })
  }

  const expectedEnd = nearestEnd(handoverDate, resolved.entry)
  const deadline = new Date(expectedEnd.getTime() + HANDOVER_GRACE_MINUTES * 60000)
  const deadlineIso = toLocalIso(deadline)

  if (closed) {
    // 老的办结记录台账里没有结论：按当时数据补算一次并冻结，只此一次，以后不再重算。
    const closeAt = completedDate ?? handoverDate
    const used = diffMinutes(handoverDate, closeAt)
    const over = diffMinutes(deadline, closeAt)
    const isOver = over > 0
    return buildLiveView(row, resolved, handoverText, completedText, {
      deadlineIso,
      deadlineLabel: deadlineIso,
      verdict: isOver ? '超时' : '准时',
      overMinutes: isOver ? over : null,
      usedMinutes: used < 0 ? 0 : used,
    })
  }

  const used = diffMinutes(handoverDate, now)
  const over = diffMinutes(deadline, now)
  if (over > 0) {
    return buildLiveView(row, resolved, handoverText, completedText, {
      deadlineIso,
      deadlineLabel: deadlineIso,
      verdict: '超时',
      overMinutes: over,
      usedMinutes: used < 0 ? 0 : used,
    })
  }
  return buildLiveView(row, resolved, handoverText, completedText, {
    deadlineIso,
    deadlineLabel: deadlineIso,
    verdict: '办理中',
    overMinutes: null,
    usedMinutes: used < 0 ? 0 : used,
  })
}

type LiveResult = {
  deadlineIso: string | null
  deadlineLabel: string
  verdict: HandoverVerdict
  overMinutes: number | null
  usedMinutes: number | null
}

function buildLiveView(
  row: EntryRow,
  resolved: ReturnType<typeof resolveHandoverCrew>,
  handoverText: string,
  completedText: string,
  result: LiveResult,
): HandoverView {
  const closed = CLOSED_HANDOVER_STATUSES.includes(String(row.status))
  const frozen = closed && (result.verdict === '准时' || result.verdict === '超时')
  const storedVerdict = field(row, HANDOVER_LEDGER_FIELDS.verdict)
  const storedOver = field(row, HANDOVER_LEDGER_FIELDS.overMinutes)
  const storedDeadline = field(row, HANDOVER_LEDGER_FIELDS.deadline)
  const storedUsed = field(row, HANDOVER_LEDGER_FIELDS.usedMinutes)
  // 花名册口径的班组/人员也要回写：新建记录上人员为空时，靠这次对账补齐。
  const crewChanged =
    field(row, '值班班组') !== resolved.crew ||
    field(row, '班次') !== resolved.slot ||
    field(row, '交班人员') !== resolved.outgoing ||
    field(row, '接班人员') !== resolved.incoming
  const verdictChanged = storedVerdict !== result.verdict
  const dirty =
    verdictChanged ||
    storedDeadline !== (result.deadlineIso ?? '') ||
    storedOver !== (result.overMinutes === null ? '' : String(result.overMinutes)) ||
    storedUsed !== (result.usedMinutes === null ? '' : String(result.usedMinutes)) ||
    Boolean(row[HANDOVER_LEDGER_FIELDS.frozen]) !== frozen ||
    crewChanged

  return {
    id: Number(row.id),
    code: field(row, '交接编号'),
    status: String(row.status),
    pending: Boolean(row.pending),
    abnormal: Boolean(row.abnormal),
    matters: field(row, '交接事项'),
    handoverAt: handoverText,
    completedAt: completedText,
    crew: resolved.crew,
    slot: resolved.slot,
    outgoing: resolved.outgoing,
    incoming: resolved.incoming,
    roster: resolved.entry,
    deadlineIso: result.deadlineIso,
    deadlineLabel: result.deadlineLabel,
    verdict: result.verdict,
    overMinutes: result.overMinutes,
    usedMinutes: result.usedMinutes,
    evaluatedAtLabel: field(row, HANDOVER_LEDGER_FIELDS.evaluatedAt) || '—',
    frozen,
    dirty,
    verdictChanged,
  }
}

/**
 * 把一条视图结论回写到交班台账行（仅对账发现有差异时调用）。
 * - 办结冻结：写入最终结论与判定时间，此后不再变化；
 * - 办理中：结论发生切换（办理中→超时等）才刷新判定时间；
 *   仅超时分钟在滚动时，判定时间沿用上次，避免每次读取都产生一次写入。
 */
export function patchLedgerFromView(row: EntryRow, view: HandoverView, now: Date = new Date()): EntryRow {
  const previousEvaluatedAt = view.evaluatedAtLabel !== '—' ? view.evaluatedAtLabel : ''
  const normalized: EntryRow = {
    ...row,
    值班班组: view.crew,
    班次: view.slot,
    交班人员: view.outgoing,
    接班人员: view.incoming,
  }
  normalized[HANDOVER_LEDGER_FIELDS.verdict] = view.verdict
  normalized[HANDOVER_LEDGER_FIELDS.deadline] = view.deadlineIso ?? ''
  normalized[HANDOVER_LEDGER_FIELDS.overMinutes] = view.overMinutes === null ? '' : view.overMinutes
  normalized[HANDOVER_LEDGER_FIELDS.usedMinutes] = view.usedMinutes === null ? '' : view.usedMinutes
  normalized[HANDOVER_LEDGER_FIELDS.frozen] = view.frozen
  if (view.frozen || view.verdictChanged || !previousEvaluatedAt) {
    normalized[HANDOVER_LEDGER_FIELDS.evaluatedAt] = previousEvaluatedAt || toLocalIso(now)
  } else {
    normalized[HANDOVER_LEDGER_FIELDS.evaluatedAt] = previousEvaluatedAt
  }
  return normalized
}

/**
 * 把一整套交接班记录按统一算法算一遍，并把超时结论回写交班台账。
 * 返回视图（页面用）与持久化后的台账行；列表、看板、概览看到的都是这一份结果。
 */
export function reconcileHandover(
  rows: EntryRow[],
  now: Date = new Date(),
): { views: HandoverView[]; ledger: EntryRow[]; changed: boolean } {
  const views: HandoverView[] = []
  const ledger = rows.map((row) => {
    const view = evaluateHandover(row, now)
    views.push(view)
    if (!view.dirty) {
      return row
    }
    return patchLedgerFromView(row, view, now)
  })
  const changed = views.some((view) => view.dirty)
  return { views, ledger, changed }
}

export type HandoverBoardSummary = {
  total: number
  open: number
  closed: number
  onTime: number
  overdue: number
  unresolved: number
}

export function summarizeHandovers(views: HandoverView[]): HandoverBoardSummary {
  return {
    total: views.length,
    open: views.filter((item) => OPEN_HANDOVER_STATUSES.includes(item.status)).length,
    closed: views.filter((item) => CLOSED_HANDOVER_STATUSES.includes(item.status)).length,
    onTime: views.filter((item) => item.verdict === '准时').length,
    overdue: views.filter((item) => item.verdict === '超时').length,
    unresolved: views.filter((item) => item.verdict === '未排班').length,
  }
}
