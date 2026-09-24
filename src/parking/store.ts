/**
 * 页面接入层（Pinia store）：把纯规则与浏览器存储粘合起来，
 * 维护一个推进用的时钟，定时执行逾期释放与候补递补。
 * 组件只与本 store 交互，不直接碰 localStorage 或规则细节。
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  book as ruleBook,
  cancelReservation,
  checkIn as ruleCheckIn,
  checkOut as ruleCheckOut,
  intervalOf,
  occupancyOf,
  overdueReservations,
  tick,
  toTime,
  waitingQueue
} from "./rules";
import {
  loadReservations,
  loadStations,
  saveReservations,
  saveStations,
  SEED_STATIONS
} from "./storage";
import {
  BookingInput,
  Reservation,
  RuleResult,
  Station,
  StationStatus,
  DEFAULT_HAZMAT_SPOTS,
  DEFAULT_NORMAL_SPOTS
} from "./types";

const CLOCK_INTERVAL_MS = 20_000;

export type StationInput = {
  station: string;
  area?: string;
  manager?: string;
  stock?: number;
  normalSpots: number;
  hazmatSpots: number;
  notes?: string;
};

export const useParkingStore = defineStore("parking", () => {
  const stations = ref<Station[]>(loadStations());
  const reservations = ref<Reservation[]>([]);
  /** 仅用于驱动页面刷新的"当前时间" */
  const clock = ref<Date>(new Date());
  const flash = ref<{ type: "success" | "error"; text: string } | null>(null);
  let timer: number | undefined;

  const stationById = computed(() => new Map(stations.value.map((s) => [s.id, s])));

  function stationName(id: string): string {
    return stationById.value.get(id)?.station ?? "（油站已删除）";
  }

  function persistReservations() {
    saveReservations(reservations.value);
  }

  function persistStations() {
    saveStations(stations.value);
  }

  /** 推进时间：逾期释放 + 空位候补递补 */
  function advance(when: Date = new Date()) {
    clock.value = when;
    const next = tick(reservations.value, stations.value, when);
    if (next !== reservations.value) {
      reservations.value = next;
      persistReservations();
    }
  }

  /** 应用挂载时调用：读取预约并立即做一次时间推进，随后定时推进 */
  function init() {
    clock.value = new Date();
    reservations.value = tick(loadReservations(), stations.value, clock.value);
    persistReservations();
    if (timer === undefined) {
      timer = window.setInterval(() => advance(new Date()), CLOCK_INTERVAL_MS);
    }
  }

  function notify(result: RuleResult) {
    flash.value = { type: result.ok ? "success" : "error", text: result.message };
  }

  function clearFlash() {
    flash.value = null;
  }

  function booking(input: BookingInput) {
    advance();
    const result = ruleBook(reservations.value, stations.value, input, clock.value);
    if (result.ok && result.data) {
      reservations.value = result.data;
      persistReservations();
    }
    notify(result);
    return result.ok;
  }

  function checkIn(id: string) {
    advance();
    const result = ruleCheckIn(reservations.value, id, new Date());
    if (result.ok && result.data) {
      reservations.value = result.data;
      persistReservations();
    }
    notify(result);
    return result.ok;
  }

  function checkOut(id: string) {
    advance();
    const result = ruleCheckOut(reservations.value, stations.value, id, new Date());
    if (result.ok && result.data) {
      reservations.value = result.data;
      persistReservations();
    }
    notify(result);
    return result.ok;
  }

  function cancel(id: string) {
    advance();
    const result = cancelReservation(reservations.value, stations.value, id, new Date());
    if (result.ok && result.data) {
      reservations.value = result.data;
      persistReservations();
    }
    notify(result);
    return result.ok;
  }

  /** 清理终态记录（已签退 / 已逾期 / 已取消） */
  function cleanupTerminal() {
    reservations.value = reservations.value.filter(
      (r) => r.status !== "checkedOut" && r.status !== "expired" && r.status !== "cancelled"
    );
    persistReservations();
    notify({ ok: true, message: "已清理结束的预约记录" });
  }

  /** 删除单条记录（管理用途） */
  function removeReservation(id: string) {
    reservations.value = reservations.value.filter((r) => r.id !== id);
    persistReservations();
  }

  // ---- 油站管理（旧油站数据照常读写同一个 localStorage key） ----

  function addStation(input: StationInput) {
    const station: Station = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `station-${Date.now()}`,
      station: input.station.trim(),
      area: input.area?.trim() || undefined,
      manager: input.manager?.trim() || undefined,
      stock: input.stock,
      status: "营业中",
      notes: input.notes?.trim() || "暂无备注",
      normalSpots: input.normalSpots,
      hazmatSpots: input.hazmatSpots,
      createdAt: new Date().toISOString()
    };
    stations.value = [station, ...stations.value];
    persistStations();
    notify({ ok: true, message: "油站已保存" });
  }

  const STATION_FLOW: StationStatus[] = ["营业中", "暂停营业", "库存紧张"];

  function cycleStationStatus(id: string) {
    const station = stations.value.find((s) => s.id === id);
    if (!station) return;
    const index = STATION_FLOW.indexOf(station.status);
    station.status = STATION_FLOW[(index + 1) % STATION_FLOW.length];
    persistStations();
    // 恢复营业时可能有空位需要补候补
    advance();
  }

  function updateStationSpots(id: string, patch: { normalSpots?: number; hazmatSpots?: number }) {
    const station = stations.value.find((s) => s.id === id);
    if (!station) return;
    if (patch.normalSpots !== undefined) station.normalSpots = patch.normalSpots;
    if (patch.hazmatSpots !== undefined) station.hazmatSpots = patch.hazmatSpots;
    persistStations();
    advance();
  }

  function removeStation(id: string) {
    stations.value = stations.value.filter((s) => s.id !== id);
    persistStations();
  }

  // ---- 列表与指标 ----

  const waiting = computed(() => waitingQueue(reservations.value));
  const overdue = computed(() => overdueReservations(reservations.value, clock.value));

  /** 每条候补在其所属站点队列中的序号（从 1 开始） */
  const waitingPosition = computed(() => {
    const map = new Map<string, number>();
    const byStation = new Map<string, Reservation[]>();
    for (const r of waiting.value) {
      const list = byStation.get(r.stationId) ?? [];
      list.push(r);
      byStation.set(r.stationId, list);
    }
    for (const list of byStation.values()) {
      list.forEach((r, i) => map.set(r.id, i + 1));
    }
    return map;
  });

  const occupiedCount = computed(
    () => reservations.value.filter((r) => r.status === "reserved" || r.status === "checkedIn").length
  );
  const checkedInCount = computed(
    () => reservations.value.filter((r) => r.status === "checkedIn").length
  );

  /** 各站车位占用：普通位 / 危化品专用位 */
  const stationOccupancy = computed(() =>
    stations.value.map((station) => ({
      station,
      occupancy: occupancyOf(reservations.value, station)
    }))
  );

  function expectedLeaveAt(r: Reservation): number {
    return intervalOf(r).end;
  }

  /** 是否已过签到宽限期（用于列表"逾期"标记） */
  function isOverdue(r: Reservation): boolean {
    if (r.status !== "reserved" && r.status !== "waiting") return false;
    return clock.value.getTime() > toTime(r.startAt) + 15 * 60000;
  }

  return {
    // state
    stations,
    reservations,
    clock,
    flash,
    seedStationCount: SEED_STATIONS.length,
    defaultNormalSpots: DEFAULT_NORMAL_SPOTS,
    defaultHazmatSpots: DEFAULT_HAZMAT_SPOTS,
    // lifecycle
    init,
    advance,
    clearFlash,
    // reservation actions
    booking,
    checkIn,
    checkOut,
    cancel,
    cleanupTerminal,
    removeReservation,
    // station actions
    addStation,
    cycleStationStatus,
    updateStationSpots,
    removeStation,
    // selectors
    stationName,
    waiting,
    overdue,
    waitingPosition,
    occupiedCount,
    checkedInCount,
    stationOccupancy,
    expectedLeaveAt,
    isOverdue
  };
});
