import { buildSeedRecords } from './seed'
import { resolveSchedule } from './schedule'
import type { HandoverRecord } from './types'

/**
 * 交接班台账的本地持久化。
 * 独立于通用模块的 localStorage 键：交接班有自己的领域模型（排班键 + 冻结结论），
 * 不再走 EntryRow 那套通用结构。
 */

const STORAGE_KEY = 'waste-to-energy-plant:shift-handover-ledger'
const SCHEMA_VERSION = 1

type PersistedLedger = {
  version: number
  records: HandoverRecord[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): HandoverRecord[] {
  const fallback = buildSeedRecords()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeStorage(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as PersistedLedger
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.records)) {
      writeStorage(fallback)
      return fallback
    }
    return parsed.records
  } catch {
    writeStorage(fallback)
    return fallback
  }
}

function writeStorage(records: HandoverRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const payload: PersistedLedger = { version: SCHEMA_VERSION, records }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

let cache: HandoverRecord[] | null = null

export function allRecords(): HandoverRecord[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 保存整份台账（先克隆再落库，避免调用方继续改对象）。 */
export function persist(records: HandoverRecord[]): HandoverRecord[] {
  const frozen = clone(records)
  cache = frozen
  writeStorage(frozen)
  return clone(frozen)
}

export function resetLedger(): HandoverRecord[] {
  return persist(buildSeedRecords())
}

export function ledgerStorageKey(): string {
  return STORAGE_KEY
}

/** 顺手清掉旧版通用表里的 shift 数据，避免和新台账并存造成口径分裂。 */
export function purgeLegacyShift(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const LEGACY_KEY = 'waste-to-energy-plant:entries'
  const raw = window.localStorage.getItem(LEGACY_KEY)
  if (!raw) {
    return
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!('shift' in parsed)) {
      return
    }
    delete parsed.shift
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(parsed))
  } catch {
    // 旧数据损坏时不影响新台账工作，忽略即可。
  }
}

/** 给测试/脚本直接装载一份台账用。 */
export function loadRecordsFor(records: HandoverRecord[]): HandoverRecord[] {
  return persist(records)
}

/** 校验排班键是否有效（班组、人员都要能从排班解析出来）。 */
export function hasSchedule(scheduleKey: string): boolean {
  return resolveSchedule(scheduleKey) !== null
}
