<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useParkingStore } from "../store";
import { VEHICLE_LABEL } from "../selectors";
import type { VehicleType } from "../types";

const store = useParkingStore();

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** 默认入场时刻：当前时间向后取整到下一个 5 分钟。 */
function defaultEnterAt(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + (5 - (d.getMinutes() % 5)));
  return toLocalInputValue(d);
}

const form = reactive({
  plate: "",
  station: "" as string,
  vehicleType: "normal" as VehicleType,
  enterAt: defaultEnterAt(),
  durationMin: 60,
  notes: "",
});

const message = ref<{ type: "ok" | "error"; text: string } | null>(null);

const bookable = computed(() => store.stations.filter((s) => !s.paused));

const selectedStation = computed(() => store.stationByName.get(form.station));

function resetEnterAt() {
  form.enterAt = defaultEnterAt();
}

function submit() {
  message.value = null;
  const enterAtMs = new Date(form.enterAt).getTime();
  if (!Number.isFinite(enterAtMs)) {
    message.value = { type: "error", text: "请选择有效的入场时刻" };
    return;
  }
  const result = store.submit({
    plate: form.plate,
    station: form.station,
    vehicleType: form.vehicleType,
    enterAt: new Date(enterAtMs).toISOString(),
    durationMin: Number(form.durationMin),
    notes: form.notes,
  });
  if (!result.ok) {
    message.value = { type: "error", text: result.message };
    return;
  }
  message.value = {
    type: "ok",
    text: result.waited
      ? `登记成功：车位已满，车牌 ${result.reservation.plate} 已进入候补队列`
      : `登记成功：车牌 ${result.reservation.plate} 已分配${
          result.reservation.vehicleType === "hazmat" ? "危化品专用位" : "普通车位"
        }`,
  };
  form.plate = "";
  form.notes = "";
  resetEnterAt();
}
</script>

<template>
  <form class="panel parking-form" @submit.prevent="submit">
    <h2>停车预约登记</h2>
    <div class="form-grid">
      <label>
        车牌号
        <input v-model="form.plate" placeholder="如 沪A12345" required maxlength="12" />
      </label>

      <label>
        油站
        <select v-model="form.station" required>
          <option value="">请选择油站</option>
          <option v-for="s in store.stations" :key="s.name" :value="s.name" :disabled="s.paused">
            {{ s.name }}{{ s.paused ? "（暂停营业）" : "" }}
          </option>
        </select>
      </label>

      <div class="seg" role="radiogroup" aria-label="车辆类型">
        <span
          v-for="opt in (['normal', 'hazmat'] as VehicleType[])"
          :key="opt"
          class="seg-item"
          :class="{ active: form.vehicleType === opt, hazmat: opt === 'hazmat' }"
          role="radio"
          :aria-checked="form.vehicleType === opt"
          @click="form.vehicleType = opt"
        >
          {{ VEHICLE_LABEL[opt] }}
        </span>
      </div>
      <p class="seg-hint">
        {{ form.vehicleType === "hazmat" ? "危化品车只分配专用位，不占普通车位" : "普通货车停普通车位，不进入危化品专用位" }}
      </p>

      <label>
        入场时刻
        <input v-model="form.enterAt" type="datetime-local" required />
      </label>

      <label>
        停留时长（分钟）
        <input v-model.number="form.durationMin" type="number" min="1" step="15" required />
      </label>

      <label>
        备注
        <textarea v-model="form.notes" placeholder="随车物品、对接人等现场备注（选填）" />
      </label>

      <p v-if="selectedStation" class="capacity-hint">
        当前本站剩余：普通位
        <strong>{{ store.spotUsage(selectedStation.name, 'normal').free }}</strong> /
        危化品专用位
        <strong>{{ store.spotUsage(selectedStation.name, 'hazmat').free }}</strong>
        <span v-if="store.spotUsage(selectedStation.name, form.vehicleType).waiting > 0">
          ，同类候补 {{ store.spotUsage(selectedStation.name, form.vehicleType).waiting }} 辆
        </span>
      </p>

      <div v-if="message" class="alert" :class="message.type" role="status">{{ message.text }}</div>

      <button type="submit" :disabled="bookable.length === 0">提交预约</button>
      <p v-if="bookable.length === 0" class="seg-hint">所有油站均已暂停营业，暂不接受新预约。</p>
    </div>
  </form>
</template>
