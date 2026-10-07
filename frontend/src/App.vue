<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">生活垃圾焚烧发电厂运行管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向垃圾进厂计量、垃圾池管理、焚烧炉与余热锅炉运行、汽轮发电机组、烟气净化与在线排放监测、飞灰固化与炉渣处理、渗滤液处理、设备点检检修与值班交接的一体化生活垃圾焚烧发电厂运行管理工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "垃圾进厂计量", path: "/weighbridge" }, { label: "垃圾池管理", path: "/pit" }, { label: "焚烧炉运行", path: "/incinerator" }, { label: "余热锅炉运行", path: "/boiler" }, { label: "汽轮发电机组", path: "/turbine" }, { label: "烟气净化运行", path: "/fluegas" }, { label: "在线排放监测", path: "/cems" }, { label: "飞灰固化处置", path: "/flyash" }, { label: "炉渣处理", path: "/slag" }, { label: "渗滤液处理", path: "/leachate" }, { label: "设备点检", path: "/equipcheck" }, { label: "设备检修管理", path: "/overhaul" }, { label: "备件台账管理", path: "/spare" }, { label: "发电量统计", path: "/powerstat" }, { label: "环保指标监控", path: "/emission" }, { label: "值班交接班", path: "/shift" }, { label: "值班看板", path: "/shift-board" }, { label: "应急预案管理", path: "/safetyplan" }, { label: "安全培训管理", path: "/training" }]
</script>
