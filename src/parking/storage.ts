/**
 * 存储层：只负责 localStorage 读写与旧数据兼容，不含业务规则、不依赖 Vue。
 *
 * - 油站数据沿用旧系统的 key（旧油站数据照常读取/保存）。
 * - 预约数据使用独立 key，预约状态继续保存在浏览器。
 */
import {
  DEFAULT_HAZMAT_SPOTS,
  DEFAULT_NORMAL_SPOTS,
  Reservation,
  Station,
  StationStatus
} from "./types";

/** 旧油站模块使用的 key，保持不变以兼容历史数据 */
export const STATION_STORAGE_KEY = "hxwlfront-21-station-map";
/** 停车预约专用 key */
export const RESERVATION_STORAGE_KEY = "hxwlfront-21-parking-reservations";

/** 油站初始数据（与旧版页面内置记录保持一致） */
export const SEED_STATIONS: Station[] = [
  {
    id: "seed-1",
    station: "东区一站",
    area: "东区",
    stock: 36000,
    manager: "刘站长",
    status: "营业中",
    notes: "库存正常",
    normalSpots: DEFAULT_NORMAL_SPOTS,
    hazmatSpots: DEFAULT_HAZMAT_SPOTS,
    createdAt: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: "seed-2",
    station: "机场快线站",
    area: "机场线",
    stock: 9000,
    manager: "王站长",
    status: "库存紧张",
    notes: "柴油待补",
    normalSpots: DEFAULT_NORMAL_SPOTS,
    hazmatSpots: DEFAULT_HAZMAT_SPOTS,
    createdAt: new Date().toISOString()
  }
];

const STATION_STATUSES: StationStatus[] = ["营业中", "暂停营业", "库存紧张"];

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * 把旧版油站记录归一化为 Station：
 * 旧记录没有车位字段，补默认车位数；id 缺失时补稳定 id。
 */
export function normalizeStation(raw: unknown, index: number): Station | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const name = typeof item.station === "string" ? item.station : "";
  if (!name) return null;
  const status = STATION_STATUSES.includes(item.status as StationStatus)
    ? (item.status as StationStatus)
    : "营业中";
  const normalSpots = toPositiveInt(item.normalSpots, DEFAULT_NORMAL_SPOTS);
  const hazmatSpots = toPositiveInt(item.hazmatSpots, DEFAULT_HAZMAT_SPOTS);
  return {
    ...(item as object),
    id: typeof item.id === "string" && item.id ? item.id : `station-${index + 1}`,
    station: name,
    status,
    normalSpots,
    hazmatSpots
  } as Station;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/** 读取油站：优先读浏览器里的旧数据；没有则返回种子数据 */
export function loadStations(): Station[] {
  const parsed = safeParse<unknown[]>(localStorage.getItem(STATION_STORAGE_KEY));
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
    return SEED_STATIONS.map((s) => ({ ...s }));
  }
  return parsed
    .map((item, index) => normalizeStation(item, index))
    .filter((s): s is Station => s !== null);
}

/** 保存油站（旧油站管理页继续写同一个 key） */
export function saveStations(stations: Station[]): void {
  localStorage.setItem(STATION_STORAGE_KEY, JSON.stringify(stations));
}

/** 读取预约；数据损坏时返回空数组，不影响油站模块 */
export function loadReservations(): Reservation[] {
  const parsed = safeParse<unknown[]>(localStorage.getItem(RESERVATION_STORAGE_KEY));
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.filter(isReservation).map((x) => x as Reservation);
}

function isReservation(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.plate === "string" &&
    typeof r.stationId === "string" &&
    (r.kind === "normal" || r.kind === "hazmat") &&
    typeof r.startAt === "string" &&
    typeof r.durationMin === "number" &&
    typeof r.status === "string" &&
    typeof r.createdAt === "string"
  );
}

/** 保存预约（状态继续保存在浏览器） */
export function saveReservations(reservations: Reservation[]): void {
  localStorage.setItem(RESERVATION_STORAGE_KEY, JSON.stringify(reservations));
}
