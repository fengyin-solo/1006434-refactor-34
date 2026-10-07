import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { SHIFT_ROSTER } from '@/data/shift-roster'
import {
  CLOSED_HANDOVER_STATUSES,
  OPEN_HANDOVER_STATUSES,
  SHIFT_MODULE_KEY,
  reconcileHandover,
  summarizeHandovers,
  type HandoverView,
} from '@/domain/shift-handover'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SubmitResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

/**
 * 交接班列表、看板、概览共用的取数口：
 * 先跑统一超时算法，把结论回写交班台账，再按需筛选。三处拿到的永远是同一份结果。
 */
function handoverViews(filters: Record<string, string> = {}, now: Date = new Date()): HandoverView[] {
  const rows = listRows(SHIFT_MODULE_KEY)
  const { views, ledger, changed } = reconcileHandover(rows, now)
  if (changed) {
    saveRows(SHIFT_MODULE_KEY, ledger)
  }
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return views
  }
  return views.filter((view) =>
    pairs.every(([field, value]) => {
      const key = field as keyof HandoverView
      const current = view[key]
      return String(current ?? '').includes(value.trim())
    }),
  )
}

/** 交接班列表：返回统一算法算出的视图，超时结论已经回写台账。 */
export function listHandovers(
  filters: Record<string, string> = {},
  now: Date = new Date(),
): { items: HandoverView[]; total: number } {
  const items = handoverViews(filters, now)
  return { items, total: items.length }
}

/** 值班看板：按值班班组分组，班组/人员/超时全部走花名册与统一算法。 */
export function loadShiftBoard(
  now: Date = new Date(),
): { groups: { crew: string; slot: string; outgoing: string; incoming: string; items: HandoverView[] }[]; unassigned: HandoverView[]; views: HandoverView[] } {
  const views = handoverViews({}, now)
  const groups = SHIFT_ROSTER.map((entry) => ({
    crew: entry.crew,
    slot: entry.slot,
    outgoing: entry.outgoing,
    incoming: entry.incoming,
    items: views.filter((view) => view.crew === entry.crew && view.slot === entry.slot),
  }))
  const unassigned = views.filter((view) => view.roster === null)
  return { groups, unassigned, views }
}

export type HandoverDraft = {
  code: string
  crew: string
  slot: string
  matters: string
  handoverAt: string
}

function localDateTimeLabel(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/**
 * 提交交接班记录：同一张交接单（交接编号相同）重复提交只记一次，
 * 已存在时直接返回原记录，不会另起一条、也不会再算一遍超时。
 */
export function submitHandover(draft: HandoverDraft, now: Date = new Date()): SubmitResult {
  const code = draft.code.trim()
  const crew = draft.crew.trim()
  const slot = draft.slot.trim()
  const matters = draft.matters.trim()
  const handoverAt = draft.handoverAt.trim()
  if (!code) {
    return { ok: false, message: '交接编号不能为空' }
  }
  if (!crew || !slot) {
    return { ok: false, message: '值班班组与班次必须选择' }
  }
  if (!handoverAt) {
    return { ok: false, message: '交接时间必须填写' }
  }

  const rows = listRows(SHIFT_MODULE_KEY)
  const existing = rows.find((row) => String(row['交接编号']) === code)
  if (existing) {
    // 同一张交接单重复提交：只记一次，原记录原样返回。
    return { ok: true, id: Number(existing.id), duplicated: true, message: `交接单 ${code} 已登记，重复提交不再另记` }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const created: EntryRow = {
    id,
    status: '待交接',
    pending: true,
    abnormal: false,
    交接编号: code,
    值班班组: crew,
    班次: slot,
    交班人员: '',
    接班人员: '',
    交接事项: matters,
    交接时间: handoverAt,
    完成时间: '',
  }
  const appended = [...rows, created]
  // 立刻按统一算法算一遍并回写台账（花名册口径的班组/人员也在这一步归并）。
  const { ledger, changed } = reconcileHandover(appended, now)
  saveRows(SHIFT_MODULE_KEY, changed ? ledger : appended)
  return { ok: true, id, duplicated: false, message: `交接单 ${code} 已登记，当前状态「待交接」` }
}

/**
 * 交接班动作流转：办结（确认交接/登记遗留）时记录完成时间并冻结超时结论，
 * 已办结的历史记录不能再流转，结论按当时的高低留着、不重算。
 */
export function runShiftAction(id: number, action: string, now: Date = new Date()): ActionResult {
  const meta = moduleMeta(SHIFT_MODULE_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(SHIFT_MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]
  const currentStatus = String(current.status)
  if (currentStatus === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (CLOSED_HANDOVER_STATUSES.includes(currentStatus)) {
    return { ok: false, message: `${meta.entity}已办结（${currentStatus}），超时结论已留档，不再回头重算` }
  }

  const closing = CLOSED_HANDOVER_STATUSES.includes(target)
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: OPEN_HANDOVER_STATUSES.includes(target),
    abnormal: closing
      ? Boolean(current.abnormal) || target === '有遗留'
      : NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (closing) {
    updated['完成时间'] = localDateTimeLabel(now)
  }
  const next = [...rows]
  next[index] = updated
  // 统一算法在这一刻把超时结论回写交班台账；办结即冻结。
  const { ledger } = reconcileHandover(next, now)
  saveRows(SHIFT_MODULE_KEY, ledger)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(now: Date = new Date()): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  // 交接班超时不跟状态走：和列表、看板一样，统一从共享算法取，并回写交班台账。
  const { views, ledger, changed } = reconcileHandover(listRows(SHIFT_MODULE_KEY), now)
  if (changed) {
    saveRows(SHIFT_MODULE_KEY, ledger)
  }
  const shiftSummary = summarizeHandovers(views)
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '交接超时', value: shiftSummary.overdue },
    { label: '交接准时', value: shiftSummary.onTime },
  ]
  return { cards, modules, shift: shiftSummary }
}
