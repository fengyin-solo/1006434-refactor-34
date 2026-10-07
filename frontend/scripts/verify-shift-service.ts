/**
 * 服务层行为验证：幂等提交、办结冻结回写、列表/看板/概览同源。
 * 用极简 localStorage 垫片在 Node 里跑真实的 local-service。
 */
import assert from 'node:assert'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

type ServiceModule = typeof import('../src/api/local-service')

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

function main(): void {
  // 垫片装好后再 require，避免 local-store 在模块加载时拿到真 localStorage。
  ;(globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() }
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  const service = require('../src/api/local-service') as ServiceModule
  const { listHandovers, loadShiftBoard, loadOverview, submitHandover, runShiftAction, resetModule } = service

  // 固定起点：回到播种后的种子数据。
  resetModule('shift')

  check('初始列表/看板/概览超时数完全一致', () => {
    const list = listHandovers()
    const board = loadShiftBoard()
    const overview = loadOverview()
    assert.strictEqual(overview.shift?.overdue, list.items.filter((r) => r.verdict === '超时').length)
    assert.strictEqual(overview.shift?.overdue, board.views.filter((r) => r.verdict === '超时').length)
    // 两条历史超时（SHIF-0002 +18、SHIF-0003 +31）永远冻结在台账里，与运行时刻无关；
    // 办理中的那条是否已超时随当前时间滚动，所以只断言下界。
    const frozenOverdue = list.items.filter((r) => r.frozen && r.verdict === '超时')
    assert.strictEqual(frozenOverdue.length, 2)
    assert.ok(overview.shift!.overdue >= 2)
  })

  check('种子里办结记录已冻结，超时分钟按当时高低保留', () => {
    const list = listHandovers()
    const shif2 = list.items.find((r) => r.code === 'SHIF-0002')
    const shif3 = list.items.find((r) => r.code === 'SHIF-0003')
    assert.strictEqual(shif2?.verdict, '超时')
    assert.strictEqual(shif2?.overMinutes, 18)
    assert.strictEqual(shif2?.frozen, true)
    assert.strictEqual(shif3?.verdict, '超时')
    assert.strictEqual(shif3?.overMinutes, 31)
    assert.strictEqual(shif3?.frozen, true)
  })

  check('同一张交接单重复提交只记一次', () => {
    const before = listHandovers().total
    const draft = {
      code: 'SHIF-DUP',
      crew: '甲班',
      slot: '白班',
      matters: '幂等测试',
      handoverAt: '2026-10-08 19:00',
    }
    const first = submitHandover(draft)
    assert.strictEqual(first.ok, true)
    assert.strictEqual(first.duplicated, false)
    const second = submitHandover({ ...draft, matters: '改了事项的重复提交' })
    assert.strictEqual(second.ok, true)
    assert.strictEqual(second.duplicated, true)
    assert.strictEqual(second.id, first.id)
    const after = listHandovers()
    assert.strictEqual(after.total, before + 1)
    // 原记录不被第二次提交覆盖。
    const row = after.items.find((r) => r.code === 'SHIF-DUP')
    assert.strictEqual(row?.matters, '幂等测试')
  })

  check('空编号/空班组被拒', () => {
    assert.strictEqual(
      submitHandover({ code: '', crew: '甲班', slot: '白班', matters: '', handoverAt: '2026-10-08 19:00' }).ok,
      false,
    )
    assert.strictEqual(
      submitHandover({ code: 'X', crew: '', slot: '', matters: '', handoverAt: '2026-10-08 19:00' }).ok,
      false,
    )
  })

  check('确认交接后超时结论回写台账并冻结，有遗留同样冻结', () => {
    // 找一条办理中的记录做确认交接。
    const before = listHandovers().items.find((r) => r.status === '交接中' && r.verdict !== '未排班')
    assert.ok(before)
    const result = runShiftAction(before!.id, '确认交接')
    assert.strictEqual(result.ok, true, result.message)
    const after = listHandovers().items.find((r) => r.id === before!.id)!
    assert.strictEqual(after.status, '已交接')
    assert.strictEqual(after.frozen, true)
    assert.ok(after.verdict === '准时' || after.verdict === '超时')
    assert.notStrictEqual(after.evaluatedAtLabel, '—')
    // 已办结不能再流转，结论不重算。
    const again = runShiftAction(before!.id, '登记遗留')
    assert.strictEqual(again.ok, false)
  })

  check('冻结记录不受花名册/时间变化影响（三处仍一致）', () => {
    const a = listHandovers()
    const b = loadShiftBoard()
    const c = loadOverview()
    const frozenCodes = a.items.filter((r) => r.frozen).map((r) => r.code).sort()
    const boardFrozen = b.views.filter((r) => r.frozen).map((r) => r.code).sort()
    assert.deepStrictEqual(frozenCodes, boardFrozen)
    assert.strictEqual(c.shift?.overdue, a.items.filter((r) => r.verdict === '超时').length)
  })

  check('新提交记录的交班/接班人员由花名册带出并落台账', () => {
    const result = submitHandover({
      code: 'SHIF-CREW',
      crew: '丙班',
      slot: '白班',
      matters: '花名册归并',
      handoverAt: '2026-10-09 19:00',
    })
    assert.strictEqual(result.ok, true)
    const row = listHandovers().items.find((r) => r.code === 'SHIF-CREW')
    assert.strictEqual(row?.outgoing, '周建国')
    assert.strictEqual(row?.incoming, '吴立新')
    // 截止时刻也按白班排班算好：当天 20:15。
    assert.strictEqual(row?.deadlineLabel, '2026-10-09 20:15')
  })

  check('看板按花名册班组分组，花名册外记录单列', () => {
    const board = loadShiftBoard()
    assert.ok(board.groups.some((g) => g.crew === '甲班' && g.slot === '白班'))
    assert.ok(board.groups.some((g) => g.crew === '乙班' && g.slot === '夜班'))
    assert.ok(board.unassigned.some((r) => r.code === 'SHIF-0006'))
    assert.ok(board.unassigned.every((r) => r.verdict === '未排班'))
  })

  console.log(`\n服务层 ${passed} 项通过`)
}

main()
