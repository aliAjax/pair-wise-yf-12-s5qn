<script setup lang="ts">
import { onMounted, ref } from "vue";
import ParkingView from "./parking/ParkingView.vue";
import StationView from "./parking/StationView.vue";
import { useParkingStore } from "./parking/store";

const store = useParkingStore();
onMounted(() => store.init());

const tabs = [
  { key: "parking", label: "停车预约" },
  { key: "stations", label: "油站管理" }
] as const;

const activeTab = ref<(typeof tabs)[number]["key"]>("parking");
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环</p>
          <h1>油站网点地图管理</h1>
          <p class="subtitle">
            维护油站位置与营业状态，登记危化品车 / 普通货车停车预约，自动处理候补递补与逾期释放。
            数据保存在浏览器 localStorage。
          </p>
        </div>
        <nav class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="tab"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </nav>
      </header>

      <ParkingView v-if="activeTab === 'parking'" />
      <StationView v-else />
    </div>
  </main>
</template>
