<template>
  <section class="page" data-module="shift">
    <header class="page-head">
      <div>
        <h2>值班交接班管理</h2>
        <p class="page-desc">
          交班台账：班组、交班/接班人员统一取自排班；超时结论由共用算法在办结时回写，列表、值班看板、运营概览同一份结果。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记交接班记录</button>
        <button class="btn" type="button" @click="exportRows">导出交班台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form v-if="creating" class="filter-bar" @submit.prevent="submitNew">
      <label class="filter-item">
        <span>交接编号</span>
        <input v-model="draft.code" placeholder="如 SHIF-20261007-D" />
      </label>
      <label class="filter-item">
        <span>排班（班组与交接人员来源）</span>
        <select v-model="draft.scheduleKey">
          <option value="" disabled>请选择排班</option>
          <option v-for="option in scheduleOptions" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>交接事项</span>
        <input v-model="draft.matter" placeholder="当班主要运行情况" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="creating = false">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>检索</span>
        <input v-model="filters.keyword" placeholder="按交接编号 / 交接事项检索" />
      </label>
      <label class="filter-item">
        <span>值班班组</span>
        <input v-model="filters.team" placeholder="如 甲值" />
      </label>
      <label class="filter-item">
        <span>交接状态</span>
        <input v-model="filters.status" placeholder="待交接 / 交接中 / 已交接 / 有遗留" />
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
        <tr v-for="view in rows" :key="view.record.id">
          <td>{{ view.record.code }}</td>
          <td>{{ view.team }}</td>
          <td>{{ view.schedule.kind }}</td>
          <td>{{ view.outgoingOperator }}</td>
          <td>{{ view.incomingOperator }}</td>
          <td>{{ view.record.matter || '—' }}</td>
          <td>{{ view.verdict.scheduledAt }}</td>
          <td>{{ view.record.status }}</td>
          <td>
            <span :class="['verdict-tag', verdictClass(view.verdict.overdue, view.verdict.frozen)]">
              {{ view.verdict.status }}<template v-if="view.verdict.overdue">（{{ view.verdict.overdueMinutes }} 分钟）</template>
            </span>
            <small v-if="view.verdict.frozen" class="frozen-hint">办结冻结，不重算</small>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="runAction('start', view.record.id)">发起交接</button>
            <button class="link" type="button" @click="runAction('confirm', view.record.id)">确认交接</button>
            <button class="link" type="button" @click="askLeftover(view.record.id)">登记遗留</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无交接班记录，可先登记交接班单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条交接班记录 · 超时结论在办结瞬间回写交班台账</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadHandoverLedger } from '@/api/local-service'
import {
  handoverStats,
  listHandovers,
  startHandover,
  confirmHandover,
  registerLeftover,
  submitHandover,
  upcomingScheduleKinds,
  type HandoverView,
} from '@/domain/shift'

const columns = ['交接编号', '值班班组', '班次', '交班人员', '接班人员', '交接事项', '计划交接时刻']

const rows = ref<HandoverView[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = reactive({ keyword: '', team: '', status: '' })

const creating = ref(false)
const draft = reactive({ code: '', scheduleKey: '', matter: '' })
const scheduleOptions = upcomingScheduleKinds(7)

const statCards = computed(() => {
  const stats = handoverStats()
  return [
    { label: '交接单总数', value: stats.total },
    { label: '待交接 / 交接中', value: stats.pending + stats.inProgress },
    { label: '已办结', value: stats.completed },
    { label: '其中有遗留事项', value: stats.withLeftover },
    { label: '超时班次', value: stats.overdue },
  ]
})

function verdictClass(overdue: boolean, frozen: boolean): string {
  if (frozen && !overdue) {
    return 'verdict-ok-frozen'
  }
  return overdue ? 'verdict-overdue' : 'verdict-ok'
}

function resetFilters() {
  filters.keyword = ''
  filters.team = ''
  filters.status = ''
  reload()
}

function exportRows() {
  downloadHandoverLedger()
}

function openCreate() {
  creating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  draft.code = ''
  draft.matter = ''
}

function submitNew() {
  errorMessage.value = ''
  const result = submitHandover({ code: draft.code, scheduleKey: draft.scheduleKey, matter: draft.matter })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  creating.value = false
  noticeMessage.value = result.message
  reload()
}

function askLeftover(id: number) {
  const text = window.prompt('请填写遗留事项（登记后交接即办结，超时结论冻结）')
  if (text === null) {
    return
  }
  runCustom(() => registerLeftover(id, text))
}

function runAction(action: 'start' | 'confirm', id: number) {
  if (action === 'start') {
    runCustom(() => startHandover(id))
  } else {
    runCustom(() => confirmHandover(id))
  }
}

function runCustom(fn: () => { ok: boolean; message: string }) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = fn()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listHandovers({
      keyword: filters.keyword,
      team: filters.team,
      status: filters.status,
    })
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '交班台账读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.verdict-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.verdict-overdue {
  background: #fde8e8;
  color: #b42318;
}
.verdict-ok {
  background: #e6f4ea;
  color: #1a7f37;
}
.verdict-ok-frozen {
  background: #eef2f7;
  color: #475569;
}
.frozen-hint {
  display: block;
  color: var(--muted);
  margin-top: 2px;
}
.notice-text {
  color: #1a7f37;
}
.filter-item select {
  min-width: 320px;
}
</style>
