<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；交接超时与交接班列表、值班看板共用同一份算法。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <div v-if="shift" class="shift-summary">
      <h3>交接班超时</h3>
      <p class="status-legend">
        <span class="legend-item">办理中：{{ shift.open }}</span>
        <span class="legend-item">已办结：{{ shift.closed }}</span>
        <span class="legend-item">准时：{{ shift.onTime }}</span>
        <span class="legend-item">超时：{{ shift.overdue }}</span>
        <span class="legend-item">未排班：{{ shift.unresolved }}</span>
      </p>
      <table class="data-table">
        <thead>
          <tr><th>交接编号</th><th>值班班组</th><th>交班人员</th><th>接班人员</th><th>状态</th><th>超时结论</th><th>留档</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in handoverRows" :key="row.id">
            <td>{{ row.code }}</td>
            <td>{{ row.crew || '—' }}</td>
            <td>{{ row.outgoing || '—' }}</td>
            <td>{{ row.incoming || '—' }}</td>
            <td>{{ row.status }}</td>
            <td>
              {{ row.verdict }}<template v-if="row.overMinutes !== null">（{{ row.overMinutes }} 分钟）</template>
            </td>
            <td>{{ row.frozen ? '已冻结' : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3>各业务模块</h3>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；超时结论已回写交班台账，办结记录不回头重算</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listHandovers, loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'
import type { HandoverView } from '@/domain/shift-handover'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const shift = ref<OverviewResult['shift']>()
const handoverRows = ref<HandoverView[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  shift.value = payload.shift
  // 与统计卡片同一次对账的结果，保证表上看到的和卡片、列表、看板一致。
  handoverRows.value = listHandovers().items
}

onMounted(refresh)
</script>

<style scoped>
.shift-summary {
  margin-bottom: 16px;
}
h3 {
  font-size: 14px;
  margin: 12px 0 8px;
}
</style>
