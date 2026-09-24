/**
 * 页面接入层（Pinia store）：组件只和这里交互。
 * 负责加载/持久化、调用 rules 做登记/签到/签退/结算、
 * 定时推进逾期与候补，并监听跨标签页的存储变化。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  cancelReservation as ruleCancel,
  checkIn as ruleCheckIn,
  checkOut as ruleCheckOut,
  countHeldSpots,
  settle as ruleSettle,
  submitReservation as ruleSubmit,
  waitingQueue,
} from "./rules";
import { buildStations, loadParkingState, saveParkingState, type StationOverride } from "./storage";
import type {
  Reservation,
  ReservationInput,
  SpotKind,
  Station,
  SubmitResult,
} from "./types";

/** 结算轮询间隔：让「15 分钟逾期释放、候补自动补上」不必刷新页面即可发生。 */
const TICK_MS = 20_000;

export const useParkingStore = defineStore("parking", () => {
  const initial = loadParkingState();
  const stations = ref<Station[]>(buildStations(initial.overrides));
  const reservations = ref<Reservation[]>(initial.reservations);
  const now = ref(new Date());

  function persist() {
    saveParkingState({
      version: 1,
      reservations: reservations.value,
      overrides: overrideMap.value,
    });
  }

  // 容量与暂停开关的本地覆盖，来源是存储里的 overrides（buildStations 已应用）。
  const overrideMap = ref<Record<string, StationOverride>>(initial.overrides);

  /** 时间推进：先跑规则结算，再落库；返回是否发生了状态变化。 */
  function tick(time = new Date()): boolean {
    now.value = time;
    const settled = ruleSettle(reservations.value, stations.value, time);
    const changed = settled.some((r, i) => r !== reservations.value[i]) ||
      settled.length !== reservations.value.length;
    if (changed) {
      reservations.value = settled;
      persist();
    }
    return changed;
  }

  // 初始化时立即结算一次（处理刷新页面时已逾期/可补位的情况），并同步落库。
  const settledOnInit = ruleSettle(reservations.value, stations.value, now.value);
  if (settledOnInit.some((r, i) => r !== reservations.value[i])) {
    reservations.value = settledOnInit;
    saveParkingState({ version: 1, reservations: settledOnInit, overrides: overrideMap.value });
  }

  const stationByName = computed(() => {
    const map = new Map<string, Station>();
    for (const s of stations.value) map.set(s.name, s);
    return map;
  });

  function submit(input: ReservationInput): SubmitResult {
    const { list, result } = ruleSubmit(reservations.value, stations.value, input, now.value);
    if (!result.ok) return result;
    // 登记后立即结算（新单可能触发逾期清理或补位）。
    reservations.value = ruleSettle(list, stations.value, now.value);
    persist();
    return result;
  }

  function checkIn(id: string): { ok: boolean; message?: string } {
    const { list, ok, message } = ruleCheckIn(reservations.value, id, now.value);
    reservations.value = list;
    if (ok) persist();
    return { ok, message };
  }

  function checkOut(id: string): { ok: boolean; message?: string } {
    const after = ruleCheckOut(reservations.value, id, now.value);
    if (!after.ok) return { ok: false, message: after.message };
    // 签退释放车位，立即让最早候补接上。
    reservations.value = ruleSettle(after.list, stations.value, now.value);
    persist();
    return { ok: true };
  }

  function cancel(id: string): { ok: boolean; message?: string } {
    const after = ruleCancel(reservations.value, id);
    if (!after.ok) return { ok: false, message: after.message };
    reservations.value = ruleSettle(after.list, stations.value, now.value);
    persist();
    return { ok: true };
  }

  function setStationPaused(name: string, paused: boolean) {
    overrideMap.value = {
      ...overrideMap.value,
      [name]: { ...overrideMap.value[name], paused },
    };
    stations.value = buildStations(overrideMap.value);
    // 暂停营业不影响已入场车辆；恢复营业时立刻补一次位。
    if (!paused) reservations.value = ruleSettle(reservations.value, stations.value, now.value);
    persist();
  }

  function setStationCapacity(name: string, kind: SpotKind, spots: number) {
    const value = Math.max(0, Math.round(spots));
    const prev = overrideMap.value[name] ?? {};
    overrideMap.value = {
      ...overrideMap.value,
      [name]: kind === "hazmat" ? { ...prev, hazmatSpots: value } : { ...prev, normalSpots: value },
    };
    stations.value = buildStations(overrideMap.value);
    // 扩容可能让候补补上，缩容不强制抢回已分车位（等其自然释放）。
    reservations.value = ruleSettle(reservations.value, stations.value, now.value);
    persist();
  }

  /** 重新读取旧油站数据（旧页面新增/改名站点后能立即出现）。 */
  function refreshStations() {
    stations.value = buildStations(overrideMap.value);
    reservations.value = ruleSettle(reservations.value, stations.value, now.value);
    persist();
  }

  /** 某站某类车位的实时占用、容量与候补。 */
  function spotUsage(stationName: string, kind: SpotKind) {
    const station = stationByName.value.get(stationName);
    const capacity = station ? (kind === "hazmat" ? station.hazmatSpots : station.normalSpots) : 0;
    const used = countHeldSpots(reservations.value, stationName, kind);
    const waiting = waitingQueue(reservations.value, stationName, kind).length;
    return { capacity, used, free: Math.max(0, capacity - used), waiting };
  }

  // 定时结算
  let timer: ReturnType<typeof setInterval> | undefined;
  function startTicker() {
    stopTicker();
    timer = setInterval(() => tick(new Date()), TICK_MS);
  }
  function stopTicker() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  // 跨标签页：旧油站数据或本模块数据被改动时同步。
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key === "hxwlfront-21-station-map") {
      refreshStations();
    }
    if (event.key === null || event.key === "hxwlfront-21-parking") {
      const state = loadParkingState();
      overrideMap.value = state.overrides;
      stations.value = buildStations(state.overrides);
      reservations.value = ruleSettle(state.reservations, stations.value, now.value);
    }
  }

  return {
    stations,
    reservations,
    now,
    tick,
    startTicker,
    stopTicker,
    onStorage,
    refreshStations,
    submit,
    checkIn,
    checkOut,
    cancel,
    setStationPaused,
    setStationCapacity,
    spotUsage,
    stationByName,
  };
});
