/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  /** 交接班超时：与交接班列表、值班看板共用同一份算法结论。 */
  shift?: {
    total: number
    open: number
    closed: number
    onTime: number
    overdue: number
    unresolved: number
  }
}

/** 交接班提交/动作结果：同一张交接单重复提交只记一次。 */
export type SubmitResult = ActionResult & { id?: number; duplicated?: boolean }
