<template>
  <section class="page" data-module="shift">
    <header class="page-head">
      <div>
        <h2>值班交接班管理</h2>
        <p class="page-desc">值班班组、交班人员、接班人员统一取自值班花名册；超时结论由统一算法回写交班台账，列表、看板与运营概览一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记交接班记录</button>
        <button class="btn" type="button" @click="exportRows">导出值班交接班清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>超时结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ formatCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span :class="['verdict', verdictClass(row.verdict)]">
              {{ row.verdict }}<template v-if="row.overMinutes !== null">（{{ row.overMinutes }} 分钟）</template>
            </span>
            <span v-if="row.frozen" class="frozen-tag" title="办结时按当时口径冻结，不回头重算">已留档</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions(row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无值班交接班数据，可先登记交接班记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条值班交接班记录；超时结论已回写交班台账，办结记录按当时高低留档</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="submitForm">
        <h3>登记交接班记录</h3>
        <label class="modal-field">
          <span>交接编号</span>
          <input v-model="form.code" placeholder="如 SHIF-0007" />
        </label>
        <label class="modal-field">
          <span>值班班组 / 班次</span>
          <select v-model="form.rosterKey">
            <option value="" disabled>请选择排班班组</option>
            <option v-for="entry in rosterOptions" :key="`${entry.crew}/${entry.slot}`" :value="`${entry.crew}/${entry.slot}`">
              {{ entry.crew }} · {{ entry.slot }}（{{ entry.start }}-{{ entry.end }}，交班 {{ entry.outgoing }} / 接班 {{ entry.incoming }}）
            </option>
          </select>
        </label>
        <label class="modal-field">
          <span>交接时间</span>
          <input v-model="form.handoverAt" type="datetime-local" />
        </label>
        <label class="modal-field">
          <span>交接事项</span>
          <textarea v-model="form.matters" rows="3" placeholder="交接事项与遗留说明"></textarea>
        </label>
        <p class="modal-tip">交班人员、接班人员与交接截止时刻按花名册排班自动带出；同一交接编号重复提交只记一次。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">提交交接单</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listHandovers,
  moduleMeta,
  runShiftAction,
  submitHandover,
} from '@/api/local-service'
import { SHIFT_ROSTER } from '@/data/shift-roster'
import { CLOSED_HANDOVER_STATUSES, type HandoverView } from '@/domain/shift-handover'

const meta = moduleMeta('shift')
const columns = ["交接编号", "值班班组", "班次", "交班人员", "接班人员", "交接事项", "交接时间", "交接截止时刻", "办理用时分钟"]
const statuses = ["待交接", "交接中", "已交接", "有遗留"]

const rows = ref<HandoverView[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["交接编号", "值班班组", "交班人员"]

const stats = computed(() => [
  { label: '待交接班次', value: rows.value.filter((row) => row.status === '待交接').length },
  { label: '交接中', value: rows.value.filter((row) => row.status === '交接中').length },
  { label: '已交接班次', value: rows.value.filter((row) => row.status === '已交接').length },
  { label: '有遗留事项', value: rows.value.filter((row) => row.status === '有遗留').length },
  { label: '超时交接', value: rows.value.filter((row) => row.verdict === '超时').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const rosterOptions = SHIFT_ROSTER

function formatCell(row: HandoverView, column: string): string {
  if (column === '交接截止时刻') {
    return row.deadlineLabel
  }
  if (column === '办理用时分钟') {
    return row.usedMinutes === null ? '—' : `${row.usedMinutes} 分钟`
  }
  const value = row[column as keyof HandoverView]
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

function verdictClass(verdict: HandoverView['verdict']): string {
  if (verdict === '超时') {
    return 'verdict-overdue'
  }
  if (verdict === '准时') {
    return 'verdict-ontime'
  }
  if (verdict === '未排班') {
    return 'verdict-unresolved'
  }
  return 'verdict-open'
}

function availableActions(row: HandoverView): string[] {
  if (CLOSED_HANDOVER_STATUSES.includes(row.status)) {
    return []
  }
  if (row.status === '待交接') {
    return ['发起交接', '登记遗留']
  }
  // 交接中
  return ['确认交接', '登记遗留']
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  // 先刷新一次，保证导出的就是统一算法回写后的台账。
  reload()
  downloadEntries(meta.key)
}

const creating = ref(false)
const form = ref({ code: '', rosterKey: '', handoverAt: '', matters: '' })

function openCreate() {
  errorMessage.value = ''
  form.value = { code: '', rosterKey: '', handoverAt: '', matters: '' }
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitForm() {
  errorMessage.value = ''
  const [crew, slot] = form.value.rosterKey.split('/')
  const result = submitHandover({
    code: form.value.code,
    crew: crew ?? '',
    slot: slot ?? '',
    matters: form.value.matters,
    handoverAt: form.value.handoverAt.replace('T', ' '),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.duplicated ? result.message : ''
  creating.value = false
  reload()
}

function runAction(action: string, row: HandoverView) {
  errorMessage.value = ''
  const result = runShiftAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listHandovers(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '值班交接班列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.verdict {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.verdict-overdue {
  background: #fee4e2;
  color: #b42318;
}
.verdict-ontime {
  background: #dcfae6;
  color: #067647;
}
.verdict-unresolved {
  background: #fef0c7;
  color: #b54708;
}
.verdict-open {
  background: #eef2f7;
  color: #475467;
}
.frozen-tag {
  margin-left: 6px;
  font-size: 12px;
  color: var(--muted);
}
.muted-text {
  color: var(--muted);
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 460px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-card h3 {
  margin: 0;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.modal-field input,
.modal-field select,
.modal-field textarea {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: #1f2937;
}
.modal-tip {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
