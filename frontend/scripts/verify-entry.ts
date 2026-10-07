/** 仅供 verify-shift 脚本打包用：把领域公开 API 与存储内部件一起导出。 */
export * from '../src/domain/shift'
export { allRecords, loadRecordsFor } from '../src/domain/shift/store'
export { handoverDeadline } from '../src/domain/shift/schedule'
export { buildSeedRecords } from '../src/domain/shift/seed'
