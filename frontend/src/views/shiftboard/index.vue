<template>
  <section class="page" data-module="shift-board">
    <header class="page-head">
      <div>
        <h2>值班看板</h2>
        <p class="page-desc">
          按值班班组汇总交接班。班组、交班人员、接班人员与超时结论全部取自交班台账的共用算法，
          和交接班列表、运营概览是同一份结果；有遗留事项的记录只计一次超时。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新看板</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div v-for="group in groups" :key="group.team" class="team-board">
      <header class="team-head">
        <h3>{{ group.team }}</h3>
        <p>
          值长：{{ group.leader }} · 交班：{{ group.outgoing }} · 接班：{{ group.incoming }}
          <small>（人员来自排班，台账只存排班键）</small>
        </p>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>交接编号</th>
            <th>班次</th>
            <th>计划交接时刻</th>
            <th>交接时限</th>
            <th>办结时刻</th>
            <th>交接状态</th>
            <th>超时结论</th>
            <th>遗留事项</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="view in group.items" :key="view.record.id">
            <td>{{ view.record.code }}</td>
            <td>{{ view.schedule.kind }}</td>
            <td>{{ view.verdict.scheduledAt }}</td>
            <td>{{ view.verdict.deadline }}</td>
            <td>{{ view.verdict.completedAt ?? '—' }}</td>
            <td>{{ view.record.status }}</td>
            <td>
              <span :class="['verdict-tag', view.verdict.overdue ? 'verdict-overdue' : 'verdict-ok']">
                {{ view.verdict.status }}<template v-if="view.verdict.overdue">（{{ view.verdict.overdueMinutes }} 分钟）</template>
              </span>
              <small v-if="view.verdict.frozen" class="frozen-hint">办结冻结</small>
            </td>
            <td>{{ view.record.leftover || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ groups.length }} 个值班值 · 超时口径以交班台账冻结结论为准</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { boardGroups, handoverStats } from '@/domain/shift'

type TeamGroup = ReturnType<typeof boardGroups>[number]

const groups = ref<TeamGroup[]>([])

const statCards = computed(() => {
  const stats = handoverStats()
  return [
    { label: '交接单总数', value: stats.total },
    { label: '待交接', value: stats.pending },
    { label: '交接中', value: stats.inProgress },
    { label: '已办结', value: stats.completed },
    { label: '有遗留事项', value: stats.withLeftover },
    { label: '超时班次', value: stats.overdue },
    { label: '按时办结', value: stats.onTime },
  ]
})

function reload() {
  groups.value = boardGroups()
}

onMounted(reload)
</script>

<style scoped>
.team-board {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.team-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.team-head p {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 12px;
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
.frozen-hint {
  display: block;
  color: var(--muted);
  margin-top: 2px;
}
</style>
