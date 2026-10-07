<template>
  <section class="page" data-module="shift-board">
    <header class="page-head">
      <div>
        <h2>值班看板</h2>
        <p class="page-desc">按值班花名册分组展示各班交接情况；超时口径与交接班列表、运营概览共用同一份算法，不再拿交班人员排班各推各的。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新看板</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in cards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div v-for="group in groups" :key="`${group.crew}/${group.slot}`" class="crew-block">
      <h3 class="crew-head">
        {{ group.crew }} · {{ group.slot }}
        <span class="crew-sub">交班 {{ group.outgoing }} → 接班 {{ group.incoming }}</span>
        <span class="crew-count">{{ group.items.length }} 单</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>交接编号</th>
            <th>交接时间</th>
            <th>交接截止时刻</th>
            <th>交接事项</th>
            <th>状态</th>
            <th>超时结论</th>
            <th>留档</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.items" :key="row.id">
            <td>{{ row.code }}</td>
            <td>{{ row.handoverAt || '—' }}</td>
            <td>{{ row.deadlineLabel }}</td>
            <td>{{ row.matters || '—' }}</td>
            <td>{{ row.status }}</td>
            <td>
              <span :class="['verdict', verdictClass(row.verdict)]">
                {{ row.verdict }}<template v-if="row.overMinutes !== null">（{{ row.overMinutes }} 分钟）</template>
              </span>
            </td>
            <td>{{ row.frozen ? '已冻结' : '—' }}</td>
          </tr>
          <tr v-if="!group.items.length">
            <td colspan="7" class="empty-state">该班组暂无交接班记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="unassigned.length" class="crew-block">
      <h3 class="crew-head">
        花名册外记录
        <span class="crew-sub">班组/交班人员在花名册里对不上，统一判为「未排班」，不臆造截止时刻</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>交接编号</th>
            <th>值班班组</th>
            <th>班次</th>
            <th>交班人员</th>
            <th>接班人员</th>
            <th>状态</th>
            <th>超时结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in unassigned" :key="row.id">
            <td>{{ row.code }}</td>
            <td>{{ row.crew || '—' }}</td>
            <td>{{ row.slot || '—' }}</td>
            <td>{{ row.outgoing || '—' }}</td>
            <td>{{ row.incoming || '—' }}</td>
            <td>{{ row.status }}</td>
            <td><span class="verdict verdict-unresolved">{{ row.verdict }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>超时结论回写交班台账；已办结记录按当时高低冻结，看板刷新也不会重算</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadShiftBoard } from '@/api/local-service'
import { summarizeHandovers, type HandoverView } from '@/domain/shift-handover'

const groups = ref<ReturnType<typeof loadShiftBoard>['groups']>([])
const unassigned = ref<HandoverView[]>([])
const views = ref<HandoverView[]>([])
const errorMessage = ref('')

const cards = computed(() => {
  const summary = summarizeHandovers(views.value)
  return [
    { label: '交接单总数', value: summary.total },
    { label: '办理中', value: summary.open },
    { label: '已办结', value: summary.closed },
    { label: '准时交接', value: summary.onTime },
    { label: '超时交接', value: summary.overdue },
    { label: '未排班', value: summary.unresolved },
  ]
})

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

function reload() {
  errorMessage.value = ''
  try {
    const payload = loadShiftBoard()
    groups.value = payload.groups
    unassigned.value = payload.unassigned
    views.value = payload.views
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '值班看板读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.crew-block {
  margin-bottom: 16px;
}
.crew-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 12px 0 6px;
  font-size: 14px;
}
.crew-sub {
  font-size: 12px;
  color: var(--muted);
  font-weight: normal;
}
.crew-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  font-weight: normal;
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
</style>
