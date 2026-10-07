<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
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

    <section class="handover-panel">
      <header class="handover-head">
        <h3>值班交接班（交班台账口径）</h3>
        <p class="page-desc">与交接班列表、值班看板共用同一套超时算法；已办结记录按当时结论留存，概览不重算。</p>
      </header>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">交接单总数</span>
          <strong class="stat-value">{{ handover.total }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待交接 / 交接中</span>
          <strong class="stat-value">{{ handover.pending }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已办结</span>
          <strong class="stat-value">{{ handover.completed }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">有遗留事项</span>
          <strong class="stat-value">{{ handover.withLeftover }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">超时班次</span>
          <strong class="stat-value" :class="{ 'overdue-num': handover.overdue > 0 }">{{ handover.overdue }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">按时办结</span>
          <strong class="stat-value">{{ handover.onTime }}</strong>
        </article>
      </div>
    </section>

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
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const handover = ref<OverviewResult['handover']>({
  total: 0,
  pending: 0,
  completed: 0,
  withLeftover: 0,
  overdue: 0,
  onTime: 0,
})

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  handover.value = payload.handover
}

onMounted(refresh)
</script>

<style scoped>
.handover-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.handover-head h3 {
  margin: 0 0 2px;
  font-size: 15px;
}
.overdue-num {
  color: #b42318;
}
</style>
