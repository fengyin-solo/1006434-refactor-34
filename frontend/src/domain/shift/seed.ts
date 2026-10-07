import { addDays, formatDate, formatDateTime, scheduleFor } from './schedule'
import { decideVerdict } from './timeout'
import type { HandoverRecord, HandoverStatus, ShiftSchedule } from './types'

/**
 * 交接班台账的初始数据。
 *
 * 已办结的历史记录在播种时就把超时结论冻结进 verdict：
 * 「按当时的高低留着」——以后算法再调整、看板再刷新，都直接回放这份结论，不回头重算。
 * 未办结记录不带 verdict，超时与否由共用算法按当前时刻实时评估。
 */

type SeedDraft = {
  code: string
  date: string
  kind: ShiftSchedule['kind']
  status: HandoverStatus
  matter: string
  leftover: string
  /** 相对播种当天的天数偏移：办结/发起发生在「今天 + offset 天」。 */
  dayOffset: number
  /** 完成时刻相对计划交接时刻的分钟偏移：正数表示拖到时限之后（超时），负数表示提前完成。 */
  finishOffsetMinutes: number
  startedOffsetMinutes: number
}

const DRAFTS: SeedDraft[] = [
  // —— 已办结历史：结论全部冻结 ——
  {
    code: 'SHIF-20260928-D',
    date: '2026-09-28',
    kind: '白班',
    status: '已交接',
    matter: '1号炉负荷平稳，渗滤液液位正常，无异常',
    leftover: '',
    dayOffset: 0,
    finishOffsetMinutes: -6,
    startedOffsetMinutes: -20,
  },
  {
    code: 'SHIF-20260928-N',
    date: '2026-09-28',
    kind: '夜班',
    status: '已交接',
    matter: '后半夜2号给料机卡料一次，已疏通',
    leftover: '',
    dayOffset: 0,
    finishOffsetMinutes: 32,
    startedOffsetMinutes: -15,
  },
  {
    code: 'SHIF-20260929-D',
    date: '2026-09-29',
    kind: '白班',
    status: '有遗留',
    matter: 'CEMS 采样泵流量偏低，已挂缺陷',
    leftover: '采样泵返厂检测，接班值跟踪备件到货（该遗留事项不改变交接超时结论）',
    dayOffset: 0,
    finishOffsetMinutes: -3,
    startedOffsetMinutes: -18,
  },
  {
    code: 'SHIF-20260929-N',
    date: '2026-09-29',
    kind: '夜班',
    status: '已交接',
    matter: '烟气净化石灰浆管路冲洗完成',
    leftover: '',
    dayOffset: 0,
    finishOffsetMinutes: 47,
    startedOffsetMinutes: -10,
  },
  {
    code: 'SHIF-20260930-D',
    date: '2026-09-30',
    kind: '白班',
    status: '已交接',
    matter: '月度盘点配合完成，库存账实相符',
    leftover: '',
    dayOffset: 0,
    finishOffsetMinutes: -10,
    startedOffsetMinutes: -25,
  },
  // —— 未办结：结论实时评估，不落库 ——
  {
    code: 'SHIF-TODAY-D',
    date: '', // 占位，生成时替换成今天
    kind: '白班',
    status: '待交接',
    matter: '白班当班运行记录，等待接班值到岗',
    leftover: '',
    dayOffset: 0,
    finishOffsetMinutes: 0,
    startedOffsetMinutes: 0,
  },
]

function buildClosed(draft: SeedDraft, id: number): HandoverRecord {
  const schedule = scheduleFor(draft.date, draft.kind)
  const completedAt = new Date(
    new Date(`${schedule.scheduledAt}:00`).getTime() + draft.finishOffsetMinutes * 60_000,
  )
  const startedAt = new Date(
    new Date(`${schedule.scheduledAt}:00`).getTime() + draft.startedOffsetMinutes * 60_000,
  )
  const base: HandoverRecord = {
    id,
    code: draft.code,
    scheduleKey: schedule.key,
    matter: draft.matter,
    status: draft.status,
    startedAt: formatDateTime(startedAt),
    completedAt: formatDateTime(completedAt),
    leftover: draft.leftover,
    verdict: null,
  }
  // 办结记录的超时结论在播种这一刻冻结。
  return { ...base, verdict: decideVerdict(base, schedule, completedAt) }
}

function buildOpenToday(today: Date, id: number): HandoverRecord {
  const date = formatDate(today)
  const schedule = scheduleFor(date, '白班')
  return {
    id,
    code: `SHIF-${date.replace(/-/g, '')}-D`,
    scheduleKey: schedule.key,
    matter: '白班当班运行记录，等待接班值到岗',
    status: '待交接',
    startedAt: null,
    completedAt: null,
    leftover: '',
    verdict: null,
  }
}

/** 生成播种台账；now 仅用于给「今天」的待交接记录定位。 */
export function buildSeedRecords(now: Date = new Date()): HandoverRecord[] {
  const records: HandoverRecord[] = []
  let id = 1
  for (const draft of DRAFTS) {
    if (draft.status === '待交接') {
      records.push(buildOpenToday(addDays(now, draft.dayOffset), id))
    } else {
      records.push(buildClosed(draft, id))
    }
    id += 1
  }
  return records
}
