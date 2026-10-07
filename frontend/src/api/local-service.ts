import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { handoverStats, listHandovers } from '@/domain/shift'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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

export function loadOverview(): OverviewResult {
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
  // 交接班不进通用模块表，超时/办结口径全部取交接班领域的同一份统计。
  const shift = handoverStats()
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) + shift.total },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) + shift.pending + shift.inProgress },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) + shift.overdue },
  ]
  return {
    cards,
    modules,
    handover: {
      total: shift.total,
      pending: shift.pending + shift.inProgress,
      completed: shift.completed,
      withLeftover: shift.withLeftover,
      overdue: shift.overdue,
      onTime: shift.onTime,
    },
  }
}

/** 交班台账导出：字段与超时结论都取自共用领域，避免导出口径再分叉。 */
export function exportHandoverLedger(): { filename: string; content: string } {
  const { items } = listHandovers()
  const header = [
    '交接编号',
    '值班班组',
    '班次',
    '值长',
    '交班人员',
    '接班人员',
    '交接事项',
    '计划交接时刻',
    '交接时限',
    '办结时刻',
    '交接状态',
    '超时结论',
    '超时分钟',
    '遗留事项',
  ]
  const lines = [header.join(',')]
  for (const view of items) {
    const { record, schedule, verdict } = view
    lines.push(
      [
        record.code,
        schedule.team,
        schedule.kind,
        view.leader,
        view.outgoingOperator,
        view.incomingOperator,
        record.matter,
        verdict.scheduledAt,
        verdict.deadline,
        verdict.completedAt ?? '',
        record.status,
        verdict.frozen ? `${verdict.status}（已办结冻结）` : verdict.status,
        verdict.overdueMinutes,
        record.leftover,
      ]
        .map((cell) => String(cell).replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '值班交接班-交班台账.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadHandoverLedger(): void {
  const { filename, content } = exportHandoverLedger()
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
