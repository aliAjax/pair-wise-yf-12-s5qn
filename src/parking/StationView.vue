<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useParkingStore } from "./store";
import { Station, StationStatus } from "./types";

const store = useParkingStore();

const areaOptions = ["东区", "西区", "机场线"];
const statuses: StationStatus[] = ["营业中", "暂停营业", "库存紧张"];
const filters = ["全部区域", ...areaOptions];

const filter = ref(filters[0]);

const blank = () => ({
  station: "",
  area: "",
  stock: 0,
  manager: "",
  normalSpots: store.defaultNormalSpots,
  hazmatSpots: store.defaultHazmatSpots,
  notes: ""
});

const form = reactive(blank());

const filteredStations = computed(() => {
  if (filter.value.startsWith("全部")) return store.stations;
  return store.stations.filter((s) => s.area === filter.value);
});

const metrics = computed(() => [
  store.stations.length,
  store.stations.filter((s) => s.status === "营业中").length,
  store.stations.filter((s) => s.status === "暂停营业").length
]);

const chartRows = computed(() =>
  statuses.map((status) => ({
    status,
    value: store.stations.filter((s) => s.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function submit() {
  if (!form.station.trim()) return;
  store.addStation({
    station: form.station,
    area: form.area,
    manager: form.manager,
    stock: Number(form.stock) || 0,
    normalSpots: Number(form.normalSpots) || 0,
    hazmatSpots: Number(form.hazmatSpots) || 0,
    notes: form.notes
  });
  Object.assign(form, blank());
}

function flow(s: Station) {
  store.cycleStationStatus(s.id);
}

function occupancy(s: Station) {
  const row = store.stationOccupancy.find((r) => r.station.id === s.id);
  return row?.occupancy;
}
</script>

<template>
  <div class="parking">
    <section class="metrics">
      <article class="metric"><span>油站数</span><strong>{{ metrics[0] }}</strong></article>
      <article class="metric"><span>营业中</span><strong>{{ metrics[1] }}</strong></article>
      <article class="metric"><span>暂停营业</span><strong>{{ metrics[2] }}</strong></article>
    </section>

    <section class="workspace">
      <form class="panel" @submit.prevent="submit">
        <h2>新增油站</h2>
        <div class="form-grid">
          <label>油站名称<input v-model="form.station" required /></label>
          <label>
            区域
            <select v-model="form.area" required>
              <option value="" disabled>请选择</option>
              <option v-for="a in areaOptions" :key="a">{{ a }}</option>
            </select>
          </label>
          <label>库存摘要L<input v-model.number="form.stock" type="number" /></label>
          <label>负责人<input v-model="form.manager" /></label>
          <label>普通车位数<input v-model.number="form.normalSpots" type="number" min="0" /></label>
          <label>危化品专用位<input v-model.number="form.hazmatSpots" type="number" min="0" /></label>
          <label>备注<textarea v-model="form.notes" placeholder="现场说明" /></label>
          <button type="submit">保存油站</button>
        </div>
      </form>

      <section class="list-panel">
        <div class="toolbar">
          <h2>油站列表</h2>
          <select v-model="filter">
            <option v-for="f in filters" :key="f">{{ f }}</option>
          </select>
        </div>

        <div class="record-grid">
          <div v-if="filteredStations.length === 0" class="empty">暂无匹配油站</div>
          <article v-for="s in filteredStations" :key="s.id" class="record">
            <div class="record-head">
              <p class="record-title">{{ s.station }}</p>
              <span class="status" :class="{ 'status-paused': s.status === '暂停营业' }">{{ s.status }}</span>
            </div>
            <div class="details">
              <span>区域: {{ s.area || "--" }}</span>
              <span>负责人: {{ s.manager || "--" }}</span>
              <span>库存L: {{ s.stock ?? "--" }}</span>
              <span v-if="occupancy(s)">
                车位: 普通 {{ occupancy(s)!.normal.used }}/{{ occupancy(s)!.normal.capacity }}
                ，危化品 {{ occupancy(s)!.hazmat.used }}/{{ occupancy(s)!.hazmat.capacity }}
              </span>
            </div>
            <p class="note">{{ s.notes || "暂无备注" }}</p>
            <div class="actions">
              <button type="button" @click="flow(s)">切换营业状态</button>
              <button class="danger" type="button" @click="store.removeStation(s.id)">删除油站</button>
            </div>
          </article>
        </div>

        <div class="mini-chart">
          <div v-for="row in chartRows" :key="row.status" class="bar">
            <span>{{ row.status }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
            </div>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </section>
  </div>
</template>
