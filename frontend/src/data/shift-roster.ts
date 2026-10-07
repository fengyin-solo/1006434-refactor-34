/**
 * 值班花名册：值班班组、班次、排班起止、交班人员、接班人员的唯一数据源。
 * 交接班列表、值班看板、运营概览都从这里取班组与人员，任何页面都不再各自维护一份。
 */

export type ShiftSlotLabel = '白班' | '夜班'

export type RosterEntry = {
  /** 值班班组 */
  crew: string
  /** 班次 */
  slot: ShiftSlotLabel
  /** 开班时刻 HH:mm */
  start: string
  /** 交班人员排班下班点 HH:mm；夜班该时刻落在次日 */
  end: string
  /** 是否跨次日（夜班） */
  overnight: boolean
  /** 交班人员 */
  outgoing: string
  /** 接班人员 */
  incoming: string
}

export const SHIFT_ROSTER: RosterEntry[] = [
  { crew: '甲班', slot: '白班', start: '08:00', end: '20:00', overnight: false, outgoing: '赵守岗', incoming: '钱接岗' },
  { crew: '乙班', slot: '夜班', start: '20:00', end: '08:00', overnight: true, outgoing: '孙夜值', incoming: '李晨曦' },
  { crew: '丙班', slot: '白班', start: '08:00', end: '20:00', overnight: false, outgoing: '周建国', incoming: '吴立新' },
  { crew: '丁班', slot: '夜班', start: '20:00', end: '08:00', overnight: true, outgoing: '郑海涛', incoming: '王晓明' },
]

export function rosterKey(crew: string, slot: string): string {
  return `${crew.trim()}/${slot.trim()}`
}

/** 按「值班班组 + 班次」取排班；列表、看板、概览的班组与人员都从这一条返回值取。 */
export function findRosterEntry(crew: string, slot: string): RosterEntry | null {
  const c = crew.trim()
  const s = slot.trim()
  return SHIFT_ROSTER.find((item) => item.crew === c && item.slot === s) ?? null
}

/** 只按交班人员反查排班（历史记录里班组/班次写法不齐时兜底）。 */
export function findRosterByOutgoing(outgoing: string): RosterEntry | null {
  const name = outgoing.trim()
  if (!name) {
    return null
  }
  return SHIFT_ROSTER.find((item) => item.outgoing === name) ?? null
}

export type ResolvedHandoverCrew = {
  entry: RosterEntry | null
  crew: string
  slot: string
  outgoing: string
  incoming: string
}

/**
 * 把交接班记录上的班组/班次/人员归并到花名册口径：
 * 先按班组+班次对排班，对不上再按交班人员反查；都对不上才沿用记录原值（判为未排班）。
 */
export function resolveHandoverCrew(fields: {
  crew: string
  slot: string
  outgoing?: string
  incoming?: string
}): ResolvedHandoverCrew {
  const byCrew = findRosterEntry(fields.crew ?? '', fields.slot ?? '')
  if (byCrew) {
    return {
      entry: byCrew,
      crew: byCrew.crew,
      slot: byCrew.slot,
      outgoing: byCrew.outgoing,
      incoming: byCrew.incoming,
    }
  }
  const byPerson = findRosterByOutgoing(fields.outgoing ?? '')
  if (byPerson) {
    return {
      entry: byPerson,
      crew: byPerson.crew,
      slot: byPerson.slot,
      outgoing: byPerson.outgoing,
      incoming: byPerson.incoming,
    }
  }
  return {
    entry: null,
    crew: (fields.crew ?? '').trim(),
    slot: (fields.slot ?? '').trim(),
    outgoing: (fields.outgoing ?? '').trim(),
    incoming: (fields.incoming ?? '').trim(),
  }
}
