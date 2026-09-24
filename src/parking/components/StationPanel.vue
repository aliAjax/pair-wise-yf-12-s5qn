<script setup lang="ts">
import { ref } from "vue";
import { useParkingStore } from "../store";

const store = useParkingStore();
const editing = ref<string | null>(null);
const draft = ref<{ normal: number; hazmat: number }>({ normal: 0, hazmat: 0 });
const message = ref<string | null>(null);

function startEdit(name: string, normal: number, hazmat: number) {
  editing.value = name;
  draft.value = { normal, hazmat };
}

function saveCapacity(name: string) {
  if (draft.value.normal < 0 || draft.value.hazmat < 0) {
    message.value = "车位数不能为负";
    return;
  }
  store.setStationCapacity(name, "normal", draft.value.normal);
  store.setStationCapacity(name, "hazmat", draft.value.hazmat);
  editing.value = null;
  message.value = `已更新「${name}」车位配置，扩容空位已按候补顺序补上`;
  setTimeout(() => (message.value = null), 3000);
}

function togglePaused(name: string, paused: boolean) {
  store.setStationPaused(name, paused);
  message.value = paused
    ? `「${name}」已暂停营业：不再接新预约，已入场车辆仍可签退`
    : `「${name}」已恢复营业，候补队列重新开始补位`;
  setTimeout(() => (message.value = null), 3000);
}
</script>

<template>
  <section class="panel stations-panel">
    <div class="toolbar">
      <h2>油站车位</h2>
      <button type="button" class="secondary small" @click="store.refreshStations()">重新读取旧油站数据</button>
    </div>
    <p class="seg-hint">
      站点资料（名称、状态、负责人）读取自旧油站管理数据
      <code>hxwlfront-21-station-map</code>，在此基础上配置车位与营业开关。
    </p>
    <p v-if="message" class="alert ok" role="status">{{ message }}</p>

    <div class="station-list">
      <article v-for="s in store.stations" :key="s.name" class="station-card" :class="{ paused: s.paused }">
        <div class="station-head">
          <div>
            <p class="station-name">
              {{ s.name }}
              <span class="legacy-tag" :title="`旧数据状态：${s.status}`">{{ s.status }}</span>
            </p>
            <p class="station-meta">
              <span v-if="s.area">{{ s.area }}</span>
              <span v-if="s.manager">负责人：{{ s.manager }}</span>
            </p>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="s.paused"
              @change="togglePaused(s.name, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ s.paused ? "已暂停营业" : "营业中" }}</span>
          </label>
        </div>

        <div v-for="kind in (['normal', 'hazmat'] as const)" :key="kind" class="spot-row">
          <span class="spot-label">{{ kind === "hazmat" ? "危化品专用位" : "普通车位" }}</span>
          <div class="spot-bar">
            <div
              class="spot-fill"
              :class="kind"
              :style="{
                width: `${Math.min(100, (store.spotUsage(s.name, kind).used / Math.max(1, store.spotUsage(s.name, kind).capacity)) * 100)}%`,
              }"
            />
          </div>
          <strong>{{ store.spotUsage(s.name, kind).used }}/{{ store.spotUsage(s.name, kind).capacity }}</strong>
          <span v-if="store.spotUsage(s.name, kind).waiting > 0" class="wait-count">
            候补 {{ store.spotUsage(s.name, kind).waiting }}
          </span>
          <span v-else class="free-count">空 {{ store.spotUsage(s.name, kind).free }}</span>
        </div>

        <div class="station-foot">
          <template v-if="editing === s.name">
            <label class="mini-input">
              普通位
              <input v-model.number="draft.normal" type="number" min="0" max="99" />
            </label>
            <label class="mini-input">
              专用位
              <input v-model.number="draft.hazmat" type="number" min="0" max="99" />
            </label>
            <button type="button" class="small" @click="saveCapacity(s.name)">保存</button>
            <button type="button" class="secondary small" @click="editing = null">取消</button>
          </template>
          <button
            v-else
            type="button"
            class="secondary small"
            @click="startEdit(s.name, s.normalSpots, s.hazmatSpots)"
          >
            配置车位
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
