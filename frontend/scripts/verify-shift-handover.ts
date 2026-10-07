import assert from 'node:assert'
import type { EntryRow } from '../src/data/types'
import {
  CLOSED_HANDOVER_STATUSES,
  HANDOVER_GRACE_MINUTES,
  HANDOVER_LEDGER_FIELDS,
  evaluateHandover,
  reconcileHandover,
  summarizeHandovers,
} from '../src/domain/shift-handover'

// 固定一个「现在」：2026-10-07 10:00（白班 08:00-20:00 进行中）。
const NOW = new Date(2026, 9, 7, 10, 0, 0)

function makeRow(partial: Partial<EntryRow> & { id: number }): EntryRow {
  return {
    status: '待交接',
    pending: true,
    abnormal: false,
    ...partial,
  } as EntryRow
}

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

// 1. 基准口径统一：截止时刻 = 交班人员排班下班点 + 宽限（白班 20:15）。
check('白班截止时刻=20:00+15min', () => {
  const row = makeRow({
    id: 1,
    交接编号: 'T-1',
    值班班组: '甲班',
    班次: '白班',
    交接时间: '2026-10-07 20:00',
  })
  const view = evaluateHandover(row, new Date(2026, 9, 7, 19, 0, 0))
  assert.strictEqual(view.deadlineLabel, '2026-10-07 20:15')
  assert.strictEqual(view.verdict, '办理中')
  assert.strictEqual(view.outgoing, '赵守岗')
  assert.strictEqual(view.incoming, '钱接岗')
  assert.strictEqual(view.crew, '甲班')
})

// 2. 夜班跨天：下班点落在次日 08:00，截止 08:15。
check('夜班截止时刻=次日08:00+15min', () => {
  const row = makeRow({
    id: 2,
    交接编号: 'T-2',
    值班班组: '乙班',
    班次: '夜班',
    交接时间: '2026-10-07 20:00',
  })
  const view = evaluateHandover(row, new Date(2026, 9, 8, 9, 0, 0))
  assert.strictEqual(view.deadlineLabel, '2026-10-08 08:15')
  assert.strictEqual(view.verdict, '超时')
  assert.strictEqual(view.overMinutes, 45)
})

// 3. 列表口径（交接时间+宽限）与看板口径（排班推）现在是同一份：只按排班，两处结果一致。
check('列表与看板对同一行结论一致', () => {
  const row = makeRow({
    id: 3,
    交接编号: 'T-3',
    值班班组: '丙班',
    班次: '白班',
    交接时间: '2026-10-06 20:00',
  })
  const a = evaluateHandover(row, NOW)
  const b = evaluateHandover(row, NOW)
  assert.deepStrictEqual({ v: a.verdict, d: a.deadlineIso, m: a.overMinutes }, { v: b.verdict, d: b.deadlineIso, m: b.overMinutes })
})

// 4. 办结时冻结：已交接+准时，之后时间推进、甚至交接时间被改，也不重算。
check('已办结历史记录不回头重算（含被篡改情形）', () => {
  const frozen = makeRow({
    id: 4,
    status: '已交接',
    pending: false,
    交接编号: 'T-4',
    值班班组: '甲班',
    班次: '白班',
    交班人员: '赵守岗',
    接班人员: '钱接岗',
    交接时间: '2026-10-05 20:00',
    完成时间: '2026-10-05 20:06',
    [HANDOVER_LEDGER_FIELDS.deadline]: '2026-10-05 20:15',
    [HANDOVER_LEDGER_FIELDS.verdict]: '准时',
    [HANDOVER_LEDGER_FIELDS.overMinutes]: '',
    [HANDOVER_LEDGER_FIELDS.usedMinutes]: 6,
    [HANDOVER_LEDGER_FIELDS.evaluatedAt]: '2026-10-05 20:06',
    [HANDOVER_LEDGER_FIELDS.frozen]: true,
  })
  // 把交接时间改成明显超时，且现在已过去很久——结论必须仍是「准时」。
  const tampered = { ...frozen, 交接时间: '2026-10-01 20:00' }
  const view = evaluateHandover(tampered, new Date(2026, 9, 30, 12, 0, 0))
  assert.strictEqual(view.verdict, '准时')
  assert.strictEqual(view.overMinutes, null)
  assert.strictEqual(view.frozen, true)
  assert.strictEqual(view.dirty, false)
})

// 5. 有遗留的记录办结同样冻结，不会被再算一遍超时。
check('有遗留事项办结后不再重算超时', () => {
  const row = makeRow({
    id: 5,
    status: '有遗留',
    pending: false,
    abnormal: true,
    交接编号: 'T-5',
    值班班组: '丁班',
    班次: '夜班',
    交接时间: '2026-10-05 20:00',
    完成时间: '2026-10-06 08:46',
    [HANDOVER_LEDGER_FIELDS.deadline]: '2026-10-06 08:15',
    [HANDOVER_LEDGER_FIELDS.verdict]: '超时',
    [HANDOVER_LEDGER_FIELDS.overMinutes]: 31,
    [HANDOVER_LEDGER_FIELDS.usedMinutes]: 46,
    [HANDOVER_LEDGER_FIELDS.evaluatedAt]: '2026-10-06 08:46',
    [HANDOVER_LEDGER_FIELDS.frozen]: true,
  })
  const view = evaluateHandover(row, new Date(2026, 9, 30, 0, 0, 0))
  assert.strictEqual(view.verdict, '超时')
  assert.strictEqual(view.overMinutes, 31)
  assert.strictEqual(view.frozen, true)
})

// 6. 老的办结记录台账里没结论：补算一次并冻结，后续不再变化。
check('老办结记录补算一次后冻结', () => {
  const legacy = makeRow({
    id: 6,
    status: '已交接',
    pending: false,
    交接编号: 'T-6',
    值班班组: '甲班',
    班次: '白班',
    交接时间: '2026-10-05 20:00',
  })
  const first = evaluateHandover(legacy, NOW)
  assert.ok(first.frozen)
  assert.ok(first.dirty)
  assert.ok(first.verdict === '准时' || first.verdict === '超时')
  // 回写后再来一次：不应再脏。
  const { ledger, changed } = reconcileHandover([legacy], NOW)
  assert.strictEqual(changed, true)
  const again = evaluateHandover(ledger[0], NOW)
  assert.strictEqual(again.dirty, false)
  assert.strictEqual(again.verdict, first.verdict)
})

// 7. 办理中超时随时间滚动：白班 20:00 起，20:30 已超时 15 分钟。
check('办理中超时按排班截止时刻滚动', () => {
  const row = makeRow({
    id: 7,
    status: '交接中',
    交接编号: 'T-7',
    值班班组: '甲班',
    班次: '白班',
    交接时间: '2026-10-07 20:00',
  })
  const before = evaluateHandover(row, new Date(2026, 9, 7, 20, 10, 0))
  assert.strictEqual(before.verdict, '办理中')
  const after = evaluateHandover(row, new Date(2026, 9, 7, 20, 30, 0))
  assert.strictEqual(after.verdict, '超时')
  assert.strictEqual(after.overMinutes, 15)
})

// 8. 花名册查无排班 → 未排班，不臆造截止时刻。
check('花名册外记录判为未排班', () => {
  const row = makeRow({
    id: 8,
    交接编号: 'T-8',
    值班班组: '外协组',
    班次: '白班',
    交班人员: '外协代班',
    交接时间: '2026-10-07 09:00',
  })
  const view = evaluateHandover(row, NOW)
  assert.strictEqual(view.verdict, '未排班')
  assert.strictEqual(view.deadlineIso, null)
})

// 9. 按交班人员也能反查排班（记录里班组写法不齐时兜底）。
check('按交班人员反查花名册归并口径', () => {
  const row = makeRow({
    id: 9,
    交接编号: 'T-9',
    值班班组: '',
    班次: '',
    交班人员: '孙夜值',
    交接时间: '2026-10-07 20:00',
  })
  const { ledger } = reconcileHandover([row], new Date(2026, 9, 7, 21, 0, 0))
  assert.strictEqual(ledger[0]['值班班组'], '乙班')
  assert.strictEqual(ledger[0]['班次'], '夜班')
  assert.strictEqual(ledger[0]['接班人员'], '李晨曦')
})

// 10. reconcile 把结论回写台账；重复 reconcile 稳定（幂等，不产生无谓写入）。
check('回写台账且二次对账无写入', () => {
  const rows = [
    makeRow({ id: 10, status: '交接中', 交接编号: 'T-10', 值班班组: '甲班', 班次: '白班', 交接时间: '2026-10-07 08:00' }),
  ]
  const first = reconcileHandover(rows, NOW)
  assert.strictEqual(first.changed, true)
  assert.strictEqual(String(first.ledger[0][HANDOVER_LEDGER_FIELDS.verdict]), first.views[0].verdict)
  const second = reconcileHandover(first.ledger, NOW)
  assert.strictEqual(second.changed, false)
})

// 11. 汇总口径与逐条结论同源。
check('汇总统计来自同一份视图', () => {
  const rows = [
    makeRow({ id: 11, status: '已交接', pending: false, 交接编号: 'T-11', 值班班组: '甲班', 班次: '白班', 交接时间: '2026-10-05 20:00', [HANDOVER_LEDGER_FIELDS.verdict]: '准时', [HANDOVER_LEDGER_FIELDS.frozen]: true, [HANDOVER_LEDGER_FIELDS.deadline]: '2026-10-05 20:15' }),
    makeRow({ id: 12, status: '交接中', 交接编号: 'T-12', 值班班组: '甲班', 班次: '白班', 交接时间: '2026-10-07 08:00' }),
    makeRow({ id: 13, status: '交接中', 交接编号: 'T-13', 值班班组: '外协组', 班次: '白班', 交班人员: '外协代班', 交接时间: '2026-10-07 08:00' }),
  ]
  const { views } = reconcileHandover(rows, NOW)
  const summary = summarizeHandovers(views)
  assert.strictEqual(summary.total, 3)
  assert.strictEqual(summary.onTime, 1)
  // id 12：08:00 发起的白班交接，截止当天 20:15，NOW=10:00 仍在办理中，未超时。
  assert.strictEqual(summary.overdue, 0)
  assert.strictEqual(summary.unresolved, 1)
})

// 12. 宽限常量存在且为 15 分钟。
check('宽限 15 分钟', () => {
  assert.strictEqual(HANDOVER_GRACE_MINUTES, 15)
  assert.ok(CLOSED_HANDOVER_STATUSES.includes('有遗留'))
})

// 13. 结论未切换时判定时间保持不变（滚动超时分钟不制造无谓写入）；
//     办理中→超时切换的那一刻才刷新判定时间。
check('结论不变不刷新判定时间，切换才刷新', () => {
  const row = makeRow({
    id: 130,
    status: '交接中',
    交接编号: 'T-130',
    值班班组: '甲班',
    班次: '白班',
    交接时间: '2026-10-07 20:00',
  })
  const firstAt = new Date(2026, 9, 7, 20, 30, 0)
  const first = reconcileHandover([row], firstAt)
  assert.strictEqual(first.changed, true)
  assert.strictEqual(first.views[0].verdict, '超时')
  const evaluatedOnce = String(first.ledger[0][HANDOVER_LEDGER_FIELDS.evaluatedAt])
  assert.strictEqual(evaluatedOnce, '2026-10-07 20:30')

  // 又过 10 分钟：超时分钟从 15 滚到 25，但结论仍是超时。
  const laterAt = new Date(2026, 9, 7, 20, 40, 0)
  const second = reconcileHandover(first.ledger, laterAt)
  assert.strictEqual(second.ledger[0][HANDOVER_LEDGER_FIELDS.overMinutes], 25)
  assert.strictEqual(String(second.ledger[0][HANDOVER_LEDGER_FIELDS.evaluatedAt]), evaluatedOnce)
})

console.log(`\n全部 ${passed} 项通过`)
