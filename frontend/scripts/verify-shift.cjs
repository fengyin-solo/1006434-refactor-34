/**
 * 交接班超时收拢实现的端到端验证（不入业务包）。
 * 先由 scripts/build-verify-bundle.sh 用 esbuild 打成单文件 ESM，再在 Node 里以内存版 localStorage 运行。
 */
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  },
}

const assert = require('node:assert')

const domain = require('./.build/scripts/verify-entry.js')
const {
  buildSeedRecords,
  loadRecordsFor,
  allRecords,
  listHandovers,
  handoverStats,
  boardGroups,
  submitHandover,
  startHandover,
  confirmHandover,
  registerLeftover,
  resetLedger,
  scheduleFor,
  handoverDeadline,
  HANDOVER_GRACE_MINUTES,
  resolveSchedule,
} = domain

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ---- 1. 播种数据：已办结记录冻结了超时结论，且超时/未超时各有代表 ----
loadRecordsFor(buildSeedRecords(new Date(2026, 9, 7, 10, 0)))
const closed = allRecords().filter((r) => r.verdict)
assert.ok(closed.some((r) => r.verdict.overdue), '播种数据里应含冻结的超时办结记录')
assert.ok(closed.some((r) => !r.verdict.overdue), '播种数据里应含冻结的按时办结记录')
const leftoverRec = allRecords().find((r) => r.leftover)
assert.ok(leftoverRec.verdict, '有遗留的记录也应只有办结时那一份冻结结论')

// ---- 2. 三处同口径：列表 / 看板 / 概览统计拿到同一条记录的超时结论 ----
const list = listHandovers()
const board = boardGroups()
const stats = handoverStats()
assert.ok(stats.total > 0)
const targetCode = 'SHIF-20260928-N' // 拖了 32 分钟的夜班
const fromList = list.items.find((v) => v.record.code === targetCode)
const fromBoard = board.flatMap((g) => g.items).find((v) => v.record.code === targetCode)
check('列表与看板对同一张单的超时结论一致（冻结回放）', () => {
  assert.strictEqual(fromList.verdict.overdue, true)
  assert.strictEqual(fromList.verdict.frozen, true)
  assert.strictEqual(fromBoard.verdict.overdue, fromList.verdict.overdue)
  assert.strictEqual(fromBoard.verdict.overdueMinutes, fromList.verdict.overdueMinutes)
})

// ---- 3. 班组与双方人员全部来自排班 ----
check('班组/交班/接班人员统一解析自排班，记录里只存排班键', () => {
  const sched = scheduleFor('2026-09-28', '夜班')
  assert.strictEqual(fromList.team, sched.team)
  assert.strictEqual(fromList.outgoingOperator, sched.outgoingOperator)
  assert.strictEqual(fromList.incomingOperator, sched.incomingOperator)
  assert.strictEqual(fromList.record.scheduleKey, sched.key)
})

// ---- 4. 遗留事项不改变既有超时结论 ----
const leftoverView = list.items.find((v) => v.record.code === 'SHIF-20260929-D')
check('有遗留但按时办结的记录不被再算成超时', () => {
  assert.strictEqual(leftoverView.verdict.overdue, false)
  assert.strictEqual(leftoverView.record.status, '有遗留')
})
const before = JSON.stringify(leftoverView.record.verdict)
const again = registerLeftover(leftoverView.record.id, '再补一条遗留')
check('对已办结单重复登记遗留只回放原结论，不重算', () => {
  assert.strictEqual(again.ok, true)
  assert.strictEqual(again.duplicated, true)
  const after = JSON.stringify(allRecords().find((r) => r.id === leftoverView.record.id).verdict)
  assert.strictEqual(after, before)
})

// ---- 5. 办结后篡改时钟也不回头重算 ----
check('历史办结结论冻结：换个“现在”也不变', () => {
  const future = new Date(2030, 0, 1)
  const views = listHandovers({}, () => future)
  const v = views.items.find((x) => x.record.code === targetCode)
  assert.strictEqual(v.verdict.overdue, true)
  assert.strictEqual(v.verdict.frozen, true)
  assert.strictEqual(v.verdict.overdueMinutes, fromList.verdict.overdueMinutes)
})

// ---- 6. 未办结单的实时超时判定：到时限不办结即超时（但不落库） ----
const openScheduled = scheduleFor('2026-10-07', '白班')
loadRecordsFor([
  {
    id: 1,
    code: 'T-LIVE',
    scheduleKey: openScheduled.key,
    matter: '实时判定用',
    status: '交接中',
    startedAt: '2026-10-07 19:50',
    completedAt: null,
    leftover: '',
    verdict: null,
  },
])
const deadline = handoverDeadline(openScheduled.scheduledAt)
check('未办结单：时限前进行中、时限后实时判超时，但不落库', () => {
  const v1 = listHandovers({}, () => new Date(deadline.getTime() - 60_000)).items[0]
  assert.strictEqual(v1.verdict.status, '进行中')
  assert.strictEqual(v1.verdict.overdue, false)
  const v2 = listHandovers({}, () => new Date(deadline.getTime() + 20 * 60_000)).items[0]
  assert.strictEqual(v2.verdict.overdue, true)
  assert.strictEqual(v2.verdict.overdueMinutes, 20)
  assert.strictEqual(v2.verdict.frozen, false)
  assert.strictEqual(allRecords()[0].verdict, null)
})

// ---- 7. 办结时冻结回写：超时分钟以办结时刻为准 ----
const res = confirmHandover(1, () => new Date(deadline.getTime() + 25 * 60_000))
check('确认交接把超时结论一次性回写台账', () => {
  assert.strictEqual(res.ok, true)
  const rec = allRecords()[0]
  assert.strictEqual(rec.status, '已交接')
  assert.strictEqual(rec.verdict.overdue, true)
  assert.strictEqual(rec.verdict.overdueMinutes, 25)
  assert.ok(rec.verdict.decidedAt, '必须记录结论生成时间')
})
const repeat = confirmHandover(1, () => new Date(deadline.getTime() + 999 * 60_000))
check('重复确认交接不改写办结时刻、不重算超时', () => {
  assert.strictEqual(repeat.ok, true)
  assert.strictEqual(repeat.duplicated, true)
  assert.strictEqual(allRecords()[0].verdict.overdueMinutes, 25)
})

// ---- 8. 同一张交接单重复提交只记一次 ----
resetLedger()
const first = submitHandover({ code: 'DUP-1', scheduleKey: scheduleFor('2026-10-08', '白班').key, matter: '幂等用' })
const second = submitHandover({ code: 'DUP-1', scheduleKey: scheduleFor('2026-10-08', '白班').key, matter: '又提交一次' })
check('交接编号相同的重复提交只记一次', () => {
  assert.strictEqual(first.ok, true)
  assert.strictEqual(second.ok, true)
  assert.strictEqual(second.duplicated, true)
  assert.strictEqual(allRecords().filter((r) => r.code === 'DUP-1').length, 1)
  assert.strictEqual(allRecords().find((r) => r.code === 'DUP-1').matter, '幂等用')
})
const invalid = submitHandover({ code: 'BAD', scheduleKey: '不存在#白班', matter: '' })
check('排班键无效时拒绝登记（班组与人员无法确定）', () => {
  assert.strictEqual(invalid.ok, false)
})

// ---- 9. 统计口径：有遗留按时办结计入 onTime，不进 overdue ----
loadRecordsFor(buildSeedRecords(new Date(2026, 9, 7, 10, 0)))
const s = handoverStats()
check('概览统计逐条只算一次：有遗留的按时单计入按时办结', () => {
  assert.ok(s.completed >= 1)
  assert.ok(s.withLeftover >= 1)
  assert.ok(s.onTime >= 1)
})

// ---- 10. 排班规则 ----
check('白班当天20:00交班、夜班次日08:00交班，宽限 15 分钟', () => {
  assert.strictEqual(scheduleFor('2026-10-07', '白班').scheduledAt, '2026-10-07 20:00')
  assert.strictEqual(scheduleFor('2026-10-07', '夜班').scheduledAt, '2026-10-08 08:00')
  assert.strictEqual(HANDOVER_GRACE_MINUTES, 15)
  assert.strictEqual(resolveSchedule('坏数据'), null)
})

console.log(`\n全部 ${passed} 项检查通过`)
