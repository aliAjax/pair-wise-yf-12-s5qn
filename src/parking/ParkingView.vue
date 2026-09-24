<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useParkingStore } from "./store";
import { summarize } from "./selectors";
import { CHECK_IN_GRACE_MIN } from "./rules";
import ParkingForm from "./components/ParkingForm.vue";
import ReservationList from "./components/ReservationList.vue";
import StationPanel from "./components/StationPanel.vue";

const store = useParkingStore();
const metrics = computed(() => summarize(store.reservations, store.now));

const metricCards = computed(() => [
  { label: "占用车位（已分位+在场）", value: metrics.value.occupied, tone: "occupied" },
  { label: "候补车辆", value: metrics.value.waiting, tone: "waiting" },
  { label: "逾期待处理", value: metrics.value.overdue, tone: "overdue" },
  { label: "当前在场车辆", value: metrics.value.checkedIn, tone: "checkedin" },
]);

onMounted(() => {
  store.startTicker();
  window.addEventListener("storage", store.onStorage);
  document.addEventListener("visibilitychange", onVisible);
});

onUnmounted(() => {
  store.stopTicker();
  window.removeEventListener("storage", store.onStorage);
  document.removeEventListener("visibilitychange", onVisible);
});

function onVisible() {
  if (document.visibilityState === "visible") store.tick(new Date());
}
</script>

<template>
  <main class="app parking-app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环 · 停车预约</p>
          <h1>油站停车预约调度</h1>
          <p class="subtitle">
            登记车牌、油站、入场时刻与停留时长；普通车位与危化品专用位分开调度，
            车位满即候补、空位按登记先后补上，超过入场时刻 {{ CHECK_IN_GRACE_MIN }}
            分钟未签到自动释放并顺补。数据保存在浏览器，旧油站数据照常读取。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">规则/存储/页面分层</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics metrics-4">
        <article v-for="card in metricCards" :key="card.label" class="metric" :class="`tone-${card.tone}`">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </section>

      <section class="workspace parking-workspace">
        <div class="left-col">
          <ParkingForm />
          <StationPanel />
        </div>
        <ReservationList />
      </section>

      <footer class="foot-note">
        预约数据独立存储于 <code>hxwlfront-21-parking</code>；旧油站数据
        <code>hxwlfront-21-station-map</code> 只读引用，不会被本功能改写。
      </footer>
    </div>
  </main>
</template>
