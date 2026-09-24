<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useParkingStore } from "../store";
import { checkInDeadline, waitingQueue } from "../rules";
import {
  STATUS_LABEL,
  VEHICLE_LABEL,
  checkInCountdown,
  formatDateTime,
  formatDuration,
} from "../selectors";
import type { Reservation, ReservationStatus } from "../types";

const store = useParkingStore();

type FilterKey = "active" | "all" | ReservationStatus;
const filter = ref<FilterKey>("active");
const stationFilter = ref<string>("all");
const now = ref(new Date());

// 本地秒级心跳，只驱动倒计时文案；真正的状态流转由 store 的定时结算完成。
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 1000);
});
onUnmounted(() => timer && clearInterval(timer));

const STATUS_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "active", label: "进行中" },
  { key: "waiting", label: "候补" },
  { key: "reserved", label: "已分位" },
  { key: "checkedIn", label: "已入场" },
  { key: "overdue", label: "逾期" },
  { key: "all", label: "全部" },
];

function queueIndex(r: Reservation): number {
  return waitingQueue(store.reservations, r.station, r.vehicleType === "hazmat" ? "hazmat" : "normal")
    .findIndex((q) => q.id === r.id) + 1;
}

const sorted = computed(() => {
  const rank: Record<ReservationStatus, number> = {
    overdue: 0,
    reserved: 1,
    waiting: 1,
    checkedIn: 2,
    completed: 3,
    cancelled: 3,
  };
  return [...store.reservations].sort((a, b) => {
    const ra = rank[a.status];
    const rb = rank[b.status];
    if (ra !== rb) return ra - rb;
    if (ra < 3) return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });
});

const visible = computed(() =>
  sorted.value.filter((r) => {
    if (stationFilter.value !== "all" && r.station !== stationFilter.value) return false;
    if (filter.value === "all") return true;
    if (filter.value === "active") {
      return ["waiting", "reserved", "checkedIn", "overdue"].includes(r.status);
    }
    return r.status === filter.value;
  })
);

function actionMessage(id: string, result: { ok: boolean; message?: string }) {
  if (!result.ok && result.message) flash(id, result.message);
}

const flashes = ref<Record<string, string>>({});
function flash(id: string, text: string) {
  flashes.value = { ...flashes.value, [id]: text };
  setTimeout(() => {
    const next = { ...flashes.value };
    delete next[id];
    flashes.value = next;
  }, 2600);
}

function onCheckIn(r: Reservation) {
  actionMessage(r.id, store.checkIn(r.id));
}
function onCheckOut(r: Reservation) {
  if (store.checkOut(r.id).ok) flash(r.id, "已签退，车位已释放并补给最早候补");
}
function onCancel(r: Reservation) {
  actionMessage(r.id, store.cancel(r.id));
}

function deadlineText(r: Reservation) {
  return formatDateTime(new Date(checkInDeadline(r)).toISOString());
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>预约列表</h2>
      <div class="toolbar-controls">
        <select v-model="stationFilter">
          <option value="all">全部油站</option>
          <option v-for="s in store.stations" :key="s.name" :value="s.name">{{ s.name }}</option>
        </select>
      </div>
    </div>

    <div class="chips">
      <button
        v-for="item in STATUS_FILTERS"
        :key="item.key"
        type="button"
        class="chip"
        :class="{ on: filter === item.key }"
        @click="filter = item.key"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="record-grid">
      <div v-if="visible.length === 0" class="empty">暂无匹配的预约单</div>

      <article
        v-for="r in visible"
        :key="r.id"
        class="record"
        :class="[
          `st-${r.status}`,
          { hazmat: r.vehicleType === 'hazmat', danger: r.status === 'overdue' },
        ]"
      >
        <div class="record-head">
          <p class="record-title">
            <span class="plate">{{ r.plate }}</span>
            <span class="vehicle-badge" :class="r.vehicleType">{{ VEHICLE_LABEL[r.vehicleType] }}</span>
            <span v-if="r.status === 'waiting'" class="queue-badge">候补 #{{ queueIndex(r) }}</span>
          </p>
          <span class="status" :class="r.status">{{ STATUS_LABEL[r.status] }}</span>
        </div>

        <div class="details">
          <span>油站：{{ r.station }}</span>
          <span>入场时刻：{{ formatDateTime(r.enterAt) }}</span>
          <span>停留时长：{{ formatDuration(r.durationMin) }}</span>
          <span>登记时间：{{ formatDateTime(r.createdAt) }}</span>
          <span v-if="r.promotedAt">补位时间：{{ formatDateTime(r.promotedAt) }}</span>
          <span v-if="r.checkedInAt">签到时间：{{ formatDateTime(r.checkedInAt) }}</span>
          <span v-if="r.checkedOutAt">签退时间：{{ formatDateTime(r.checkedOutAt) }}</span>
          <span v-if="r.status === 'reserved'">签到截止：{{ deadlineText(r) }}</span>
        </div>

        <p v-if="r.status === 'reserved'" class="countdown" :class="{ late: checkInCountdown(r, now) === '已超时' }">
          ⏱ {{ checkInCountdown(r, now) }}，超时未签到将释放车位并补给最早候补
        </p>
        <p v-else-if="r.status === 'waiting'" class="countdown waiting">
          车位已满，按登记顺序候补；轮到时危化品车自动分配专用位
        </p>
        <p v-else-if="r.status === 'overdue'" class="countdown overdue-text">
          超过入场时刻 15 分钟未签到，车位已释放
        </p>
        <p v-if="r.notes" class="note">{{ r.notes }}</p>
        <p v-if="flashes[r.id]" class="inline-msg">{{ flashes[r.id] }}</p>

        <div class="actions">
          <button v-if="r.status === 'reserved'" type="button" @click="onCheckIn(r)">签到入场</button>
          <button v-if="r.status === 'checkedIn'" type="button" @click="onCheckOut(r)">签退离场</button>
          <button
            v-if="['waiting', 'reserved'].includes(r.status)"
            class="secondary"
            type="button"
            @click="onCancel(r)"
          >
            取消预约
          </button>
          <span v-if="r.status === 'checkedIn'" class="checked-tag">在场中，站点暂停营业也可正常签退</span>
        </div>
      </article>
    </div>
  </section>
</template>
