<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useParkingStore } from "./store";
import { toTime } from "./rules";
import { KIND_LABEL, Reservation, ReservationStatus, STATUS_LABEL, VehicleKind } from "./types";
import { formatDateTime, minutesLabel, toLocalInputValue } from "./format";

const store = useParkingStore();

const statusFilters: { value: string; label: string; match: (s: ReservationStatus) => boolean }[] = [
  { value: "all", label: "全部状态", match: () => true },
  { value: "active", label: "占用中", match: (s) => s === "reserved" || s === "checkedIn" },
  { value: "reserved", label: "待签到", match: (s) => s === "reserved" },
  { value: "checkedIn", label: "已入场", match: (s) => s === "checkedIn" },
  { value: "waiting", label: "候补中", match: (s) => s === "waiting" },
  {
    value: "overdue",
    label: "逾期未签到",
    match: (s) => s === "reserved" || s === "waiting"
  },
  {
    value: "finished",
    label: "已结束",
    match: (s) => s === "checkedOut" || s === "expired" || s === "cancelled"
  }
];

function defaultStart(): string {
  const d = new Date(Date.now() + 5 * 60000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

const form = reactive({
  plate: "",
  stationId: store.stations.find((s) => s.status !== "暂停营业")?.id ?? store.stations[0]?.id ?? "",
  kind: "normal" as VehicleKind,
  startAt: defaultStart(),
  durationMin: 30,
  notes: ""
});

const durationPresets = [15, 30, 60, 120, 240];

const stationFilter = ref<string>("all");
const statusFilter = ref<string>("all");

const activeFilter = computed(() => statusFilters.find((f) => f.value === statusFilter.value)!);

const visibleReservations = computed(() => {
  const list = store.reservations.filter((r) => {
    if (stationFilter.value !== "all" && r.stationId !== stationFilter.value) return false;
    if (!activeFilter.value.match(r.status)) return false;
    if (statusFilter.value === "overdue" && !store.isOverdue(r)) return false;
    return true;
  });
  const rank: Record<ReservationStatus, number> = {
    checkedIn: 0,
    reserved: 1,
    waiting: 2,
    checkedOut: 3,
    expired: 4,
    cancelled: 5
  };
  return [...list].sort((a, b) => {
    const gap = rank[a.status] - rank[b.status];
    return gap !== 0 ? gap : toTime(b.createdAt) - toTime(a.createdAt);
  });
});

function submit() {
  const input = {
    plate: form.plate,
    stationId: form.stationId,
    kind: form.kind,
    startAt: form.startAt,
    durationMin: Number(form.durationMin),
    notes: form.notes
  };
  if (store.booking(input)) {
    form.plate = "";
    form.notes = "";
    form.startAt = defaultStart();
  }
}

/** 距离签到截止（入场时刻 + 15 分钟）剩余分钟；负数表示已逾期 */
function remainMinutes(r: Reservation): number {
  const deadline = toTime(r.startAt) + 15 * 60000;
  return Math.round((deadline - store.clock.getTime()) / 60000);
}

function statusClass(r: Reservation): string {
  if (store.isOverdue(r)) return "status status-overdue";
  return `status status-${r.status}`;
}

function badgeText(r: Reservation): string {
  if (store.isOverdue(r)) return "逾期未签到";
  return STATUS_LABEL[r.status];
}
</script>

<template>
  <div class="parking">
    <section v-if="store.flash" class="flash" :class="store.flash.type" @click="store.clearFlash()">
      {{ store.flash.text }}（点击关闭）
    </section>

    <section class="metrics metrics-4">
      <article class="metric">
        <span>占用车位</span>
        <strong>{{ store.occupiedCount }}</strong>
      </article>
      <article class="metric">
        <span>在场车辆</span>
        <strong>{{ store.checkedInCount }}</strong>
      </article>
      <article class="metric">
        <span>候补车辆</span>
        <strong>{{ store.waiting.length }}</strong>
      </article>
      <article class="metric">
        <span>逾期未签到</span>
        <strong :class="{ warn: store.overdue.length > 0 }">{{ store.overdue.length }}</strong>
      </article>
    </section>

    <section class="occupancy-grid">
      <article v-for="row in store.stationOccupancy" :key="row.station.id" class="occ-card">
        <div class="occ-head">
          <p class="occ-name">
            {{ row.station.station }}
            <span v-if="row.station.status === '暂停营业'" class="station-tag paused">暂停营业</span>
            <span v-else-if="row.station.status === '库存紧张'" class="station-tag tight">库存紧张</span>
          </p>
        </div>
        <div class="occ-row">
          <span class="occ-label">普通位</span>
          <div class="bar-track">
            <div
              class="bar-fill"
              :class="{ full: row.occupancy.normal.used >= row.occupancy.normal.capacity }"
              :style="{ width: `${Math.min(100, (row.occupancy.normal.used / Math.max(1, row.occupancy.normal.capacity)) * 100)}%` }"
            />
          </div>
          <strong>{{ row.occupancy.normal.used }}/{{ row.occupancy.normal.capacity }}</strong>
        </div>
        <div class="occ-row">
          <span class="occ-label">危化品位</span>
          <div class="bar-track">
            <div
              class="bar-fill hazmat"
              :class="{ full: row.occupancy.hazmat.used >= row.occupancy.hazmat.capacity }"
              :style="{ width: `${Math.min(100, (row.occupancy.hazmat.used / Math.max(1, row.occupancy.hazmat.capacity)) * 100)}%` }"
            />
          </div>
          <strong>{{ row.occupancy.hazmat.used }}/{{ row.occupancy.hazmat.capacity }}</strong>
        </div>
      </article>
    </section>

    <section class="workspace">
      <form class="panel" @submit.prevent="submit">
        <h2>停车预约登记</h2>
        <div class="form-grid">
          <label>
            车牌号
            <input v-model="form.plate" placeholder="例：京A12345" required />
          </label>
          <label>
            油站
            <select v-model="form.stationId" required>
              <option value="" disabled>请选择油站</option>
              <option
                v-for="s in store.stations"
                :key="s.id"
                :value="s.id"
                :disabled="s.status === '暂停营业'"
              >
                {{ s.station }}{{ s.status === "暂停营业" ? "（暂停营业）" : "" }}
              </option>
            </select>
          </label>
          <label>
            车辆类型
            <div class="seg">
              <button
                type="button"
                :class="{ active: form.kind === 'normal' }"
                @click="form.kind = 'normal'"
              >
                普通货车
              </button>
              <button
                type="button"
                class="hazmat-btn"
                :class="{ active: form.kind === 'hazmat' }"
                @click="form.kind = 'hazmat'"
              >
                危化品车
              </button>
            </div>
            <small class="hint">危化品车只分配专用位，不占普通车位</small>
          </label>
          <label>
            入场时刻
            <input v-model="form.startAt" type="datetime-local" required />
          </label>
          <label>
            停留时长（分钟）
            <input v-model.number="form.durationMin" type="number" min="1" step="1" required />
            <div class="presets">
              <button
                v-for="m in durationPresets"
                :key="m"
                type="button"
                class="chip"
                :class="{ active: form.durationMin === m }"
                @click="form.durationMin = m"
              >
                {{ minutesLabel(m) }}
              </button>
            </div>
          </label>
          <label>
            备注
            <textarea v-model="form.notes" placeholder="随车人员、物料等备注（可选）" />
          </label>
          <button type="submit">提交预约</button>
          <p class="rule-note">
            超过入场时刻 15 分钟未签到将自动释放车位；车位满时按登记先后候补。
          </p>
        </div>
      </form>

      <section class="list-panel">
        <div class="toolbar">
          <h2>预约列表</h2>
          <div class="filters">
            <select v-model="stationFilter">
              <option value="all">全部油站</option>
              <option v-for="s in store.stations" :key="s.id" :value="s.id">{{ s.station }}</option>
            </select>
            <select v-model="statusFilter">
              <option v-for="f in statusFilters" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
            <button type="button" class="secondary" @click="store.cleanupTerminal()">清理结束记录</button>
          </div>
        </div>

        <div class="record-grid">
          <div v-if="visibleReservations.length === 0" class="empty">暂无匹配的预约</div>
          <article v-for="r in visibleReservations" :key="r.id" class="record">
            <div class="record-head">
              <p class="record-title">
                {{ r.plate }}
                <span class="kind-tag" :class="r.kind">{{ KIND_LABEL[r.kind] }}</span>
              </p>
              <span :class="statusClass(r)">{{ badgeText(r) }}</span>
            </div>
            <div class="details">
              <span>油站: {{ store.stationName(r.stationId) }}</span>
              <span>入场: {{ formatDateTime(r.startAt) }}</span>
              <span>停留: {{ minutesLabel(r.durationMin) }}</span>
              <span>预计离场: {{ formatDateTime(store.expectedLeaveAt(r)) }}</span>
              <span>登记时间: {{ formatDateTime(r.createdAt) }}</span>
              <span v-if="r.status === 'waiting'" class="wait-info">
                候补序号：第 {{ store.waitingPosition.get(r.id) }} 位（有空位自动补上）
              </span>
              <span
                v-else-if="(r.status === 'reserved' || r.status === 'waiting')"
                class="wait-info"
              >
                <template v-if="remainMinutes(r) > 0">
                  签到截止剩余 {{ remainMinutes(r) }} 分钟
                </template>
                <template v-else>已逾时，即将释放</template>
              </span>
              <span v-if="r.checkedInAt">签到: {{ formatDateTime(r.checkedInAt) }}</span>
              <span v-if="r.checkedOutAt">签退: {{ formatDateTime(r.checkedOutAt) }}</span>
            </div>
            <p v-if="r.notes" class="note">{{ r.notes }}</p>
            <div class="actions">
              <button v-if="r.status === 'reserved'" type="button" @click="store.checkIn(r.id)">
                签到
              </button>
              <button v-if="r.status === 'checkedIn'" type="button" @click="store.checkOut(r.id)">
                签退
              </button>
              <button
                v-if="r.status === 'reserved' || r.status === 'waiting'"
                type="button"
                class="secondary"
                @click="store.cancel(r.id)"
              >
                取消预约
              </button>
              <button
                v-if="r.status === 'checkedOut' || r.status === 'expired' || r.status === 'cancelled'"
                type="button"
                class="danger"
                @click="store.removeReservation(r.id)"
              >
                删除
              </button>
            </div>
          </article>
        </div>
      </section>
    </section>
  </div>
</template>
