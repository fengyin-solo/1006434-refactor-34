import {
  allRecords,
  hasSchedule,
  persist,
  purgeLegacyShift,
  resetLedger,
} from './store'
import { resolveSchedule, formatDate } from './schedule'
import { decideVerdict, evaluate, isClosed, toView, type Clock, defaultClock } from './timeout'
import type {
  HandoverActionResult,
  HandoverRecord,
  HandoverStats,
  HandoverStatus,
  HandoverView,
  ShiftKind,
} from './types'

/**
 * 交接班领域服务：列表、值班看板、运营概览共用的唯一出入口。
 *
 * - 班组 / 交班人员 / 接班人员：全部由排班解析，记录不存人名；
 * - 超时结论：全部来自 timeout.ts 的共用算法，办结时冻结并回写台账；
 * - 提交幂等：交接编号相同的交接单重复提交只记一次；
 * - 历史记录：已办结的 verdict 原样回放，概览与看板不做任何重算。
 */

export type HandoverFilters = {
  keyword?: string
  team?: string
  status?: string
}

export type HandoverPage = {
  items: HandoverView[]
  total: number
}

export type NewHandoverInput = {
  code: string
  scheduleKey: string
  matter: string
}

let initialized = false

/** 首次访问台账时清掉旧通用表里的 shift 遗留数据，只执行一次。 */
function ensureInitialized(): void {
  if (initialized) {
    return
  }
  purgeLegacyShift()
  initialized = true
}

function asViews(records: HandoverRecord[], now: Date): HandoverView[] {
  const views: HandoverView[] = []
  for (const record of records) {
    const schedule = resolveSchedule(record.scheduleKey)
    // 排班键理论上必须可解析；解析不到的脏数据跳过，不让页面读到分裂口径。
    if (!schedule) {
      continue
    }
    views.push({ ...toView(record, schedule), verdict: evaluate(record, schedule, now) })
  }
  return views
}

/** 列出交接台账（拼好排班与超时结论），三个页面都走这个方法。 */
export function listHandovers(
  filters: HandoverFilters = {},
  clock: Clock = defaultClock,
): HandoverPage {
  ensureInitialized()
  const now = clock()
  const keyword = filters.keyword?.trim() ?? ''
  const team = filters.team?.trim() ?? ''
  const status = filters.status?.trim() ?? ''

  const items = asViews(allRecords(), now)
    .filter((view) => (keyword === '' ? true : `${view.record.code}${view.record.matter}`.includes(keyword)))
    .filter((view) => (team === '' ? true : view.team === team))
    .filter((view) => (status === '' ? true : view.record.status === status))
    .sort(
      (a, b) =>
        new Date(`${a.schedule.scheduledAt}:00`).getTime() -
        new Date(`${b.schedule.scheduledAt}:00`).getTime(),
    )

  return { items, total: items.length }
}

/** 看板 / 概览共用的统计：逐条记录只算一次，遗留事项不会让超时被再算一遍。 */
export function handoverStats(clock: Clock = defaultClock): HandoverStats {
  ensureInitialized()
  const views = asViews(allRecords(), clock())
  return views.reduce<HandoverStats>(
    (stats, view) => {
      stats.total += 1
      if (view.record.status === '待交接') {
        stats.pending += 1
      }
      if (view.record.status === '交接中') {
        stats.inProgress += 1
      }
      if (isClosed(view.record)) {
        stats.completed += 1
        if (view.record.leftover) {
          stats.withLeftover += 1
        }
        if (view.verdict.overdue) {
          stats.overdue += 1
        } else {
          stats.onTime += 1
        }
      } else if (view.verdict.overdue) {
        // 未办结但已越过时限的，看板上作为超时班次预警，不进办结口径。
        stats.overdue += 1
      }
      return stats
    },
    { total: 0, pending: 0, inProgress: 0, completed: 0, withLeftover: 0, overdue: 0, onTime: 0 },
  )
}

/** 当前在班班组一览（看板用）：同样只读台账视图。 */
export function boardGroups(clock: Clock = defaultClock) {
  const { items } = listHandovers({}, clock)
  const groups = new Map<
    string,
    { team: string; leader: string; outgoing: string; incoming: string; items: HandoverView[] }
  >()
  for (const view of items) {
    const key = view.team
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(view)
    } else {
      groups.set(key, {
        team: view.team,
        leader: view.leader,
        outgoing: view.outgoingOperator,
        incoming: view.incomingOperator,
        items: [view],
      })
    }
  }
  return [...groups.values()]
}

function findRecord(id: number): { record: HandoverRecord; index: number; rows: HandoverRecord[] } | null {
  const rows = allRecords()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) {
    return null
  }
  return { record: rows[index], index, rows }
}

function save(rows: HandoverRecord[]): void {
  persist(rows)
}

/**
 * 登记（提交）一张交接单。
 * 交接编号是业务幂等键：同一张交接单重复提交只记一次，第二次直接返回既有记录，
 * 不新建、不改写状态、不重算超时。
 */
export function submitHandover(input: NewHandoverInput): HandoverActionResult {
  ensureInitialized()
  const code = input.code.trim()
  if (code === '') {
    return { ok: false, message: '交接编号不能为空' }
  }
  if (!hasSchedule(input.scheduleKey)) {
    return { ok: false, message: '排班不存在，班组与交接人员无法确定' }
  }
  const rows = allRecords()
  const existing = rows.find((row) => row.code === code)
  if (existing) {
    return {
      ok: true,
      duplicated: true,
      message: `交接单 ${code} 已登记（当前状态「${existing.status}」），重复提交未重复记账`,
    }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const record: HandoverRecord = {
    id: nextId,
    code,
    scheduleKey: input.scheduleKey,
    matter: input.matter.trim(),
    status: '待交接',
    startedAt: null,
    completedAt: null,
    leftover: '',
    verdict: null,
  }
  save([...rows, record])
  return { ok: true, message: `交接单 ${code} 已登记，状态「待交接」` }
}

/** 发起交接：待交接 → 交接中。 */
export function startHandover(id: number, clock: Clock = defaultClock): HandoverActionResult {
  const found = findRecord(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接班记录` }
  }
  const { record, index, rows } = found
  if (record.status === '交接中') {
    return { ok: true, duplicated: true, message: `交接单 ${record.code} 已在交接中，无需重复发起` }
  }
  if (isClosed(record)) {
    return { ok: true, duplicated: true, message: `交接单 ${record.code} 已办结，发起动作被忽略，超时结论维持原结论` }
  }
  const updated: HandoverRecord = {
    ...record,
    status: '交接中',
    startedAt: record.startedAt ?? formatNow(clock),
  }
  const next = [...rows]
  next[index] = updated
  save(next)
  return { ok: true, message: `交接单 ${record.code} 已发起，当前状态「交接中」` }
}

/**
 * 确认交接：办结并把超时结论冻结回写台账。
 * 对已办结记录重复确认只回放既有结论，不改写办结时刻、不重算超时。
 */
export function confirmHandover(id: number, clock: Clock = defaultClock): HandoverActionResult {
  return closeHandover(id, '已交接', '', clock)
}

/**
 * 登记遗留事项：也是一种办结，超时结论在这一刻冻结一次。
 * 之后再补登 / 修改遗留描述都不会把超时再算一遍（旧实现里遗留记录被重复计超时的根源在此堵死）。
 */
export function registerLeftover(
  id: number,
  leftover: string,
  clock: Clock = defaultClock,
): HandoverActionResult {
  const text = leftover.trim()
  if (text === '') {
    return { ok: false, message: '请填写遗留事项内容' }
  }
  return closeHandover(id, '有遗留', text, clock)
}

function closeHandover(
  id: number,
  target: HandoverStatus,
  leftover: string,
  clock: Clock,
): HandoverActionResult {
  const found = findRecord(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接班记录` }
  }
  const { record, index, rows } = found
  const schedule = resolveSchedule(record.scheduleKey)
  if (!schedule) {
    return { ok: false, message: `交接单 ${record.code} 的排班已失效，无法办结` }
  }

  // 幂等：同一张交接单重复提交办结，只记一次结论。
  if (isClosed(record)) {
    const oldVerdict = record.verdict
    return {
      ok: true,
      duplicated: true,
      message:
        `交接单 ${record.code} 已办结（${oldVerdict?.overdue ? '超时' : '未超时'}），` +
        '重复提交未重复记账，超时结论维持原结论',
    }
  }

  const now = clock()
  const startedAt = record.startedAt ?? formatNow(clock)
  const updated: HandoverRecord = {
    ...record,
    status: target,
    startedAt,
    completedAt: record.completedAt ?? formatNow(clock),
    leftover: leftover || record.leftover,
  }
  // 超时结论在办结瞬间生成并回写，此后任何页面读到的都是这份冻结值。
  updated.verdict = decideVerdict(updated, schedule, now)

  const next = [...rows]
  next[index] = updated
  save(next)
  return {
    ok: true,
    message:
      `交接单 ${record.code} 已${target === '有遗留' ? '登记遗留' : '确认交接'}：` +
      `${updated.verdict.overdue ? `超时 ${updated.verdict.overdueMinutes} 分钟` : '未超时'}，结论已回写交班台账`,
  }
}

/** 重置台账到示例数据（仅维护入口使用）。 */
export function resetHandoverLedger(): HandoverPage {
  resetLedger()
  return listHandovers()
}

/** 可选排班（登记表单用）：今天起若干天的白班/夜班。 */
export function upcomingScheduleKinds(days: number, clock: Clock = defaultClock) {
  // 动态 import 会让测试打包麻烦，这里直接用 scheduleRange 的等价内联：
  // 保持服务层依赖简单，直接复用 resolveSchedule + scheduleKey 规则。
  const kinds: ShiftKind[] = ['白班', '夜班']
  const result: { key: string; label: string; scheduledAt: string }[] = []
  const base = clock()
  for (let offset = 0; offset < days; offset += 1) {
    const dateText = formatDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset))
    for (const kind of kinds) {
      const schedule = resolveSchedule(`${dateText}#${kind}`)
      if (schedule) {
        result.push({
          key: schedule.key,
          label: `${dateText} ${kind}（${schedule.team} · 交班 ${schedule.outgoingOperator} / 接班 ${schedule.incomingOperator}）`,
          scheduledAt: schedule.scheduledAt,
        })
      }
    }
  }
  return result
}

function formatNow(clock: Clock): string {
  const date = clock()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export type { HandoverView }
