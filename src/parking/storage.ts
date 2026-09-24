/**
 * 存储层：只管浏览器数据的读写与形状校验，不包含任何预约规则。
 * - 旧油站数据沿用原键 hxwlfront-21-station-map，照常读取（含其内置种子）；
 * - 停车预约使用独立新键，暂停营业覆盖、车位容量等本地配置一并保存在这里；
 * - 旧数据被油站管理页改动后，本层通过 refreshStations 实时合并，不做缓存写回。
 */
import type {
  LegacyStationRecord,
  Reservation,
  ReservationStatus,
  Station,
  VehicleType,
} from "./types";

export const LEGACY_STATION_KEY = "hxwlfront-21-station-map";
export const PARKING_STORAGE_KEY = "hxwlfront-21-parking";
export const PARKING_STATE_VERSION = 1;

/** 旧油站管理页首次访问时内置的两条种子数据，缺失本地数据时保持同样的兜底。 */
const LEGACY_SEED: readonly LegacyStationRecord[] = [
  { station: "东区一站", area: "东区", stock: 36000, manager: "刘站长", status: "营业中", notes: "库存正常" },
  { station: "机场快线站", area: "机场线", stock: 9000, manager: "王站长", status: "库存紧张", notes: "柴油待补" },
];

/** 旧数据没有车位字段，新站默认每站 3 个普通位 + 1 个危化品专用位，可在页面调整。 */
export const DEFAULT_NORMAL_SPOTS = 3;
export const DEFAULT_HAZMAT_SPOTS = 1;

export interface StationOverride {
  paused?: boolean;
  normalSpots?: number;
  hazmatSpots?: number;
}

export interface ParkingState {
  version: typeof PARKING_STATE_VERSION;
  reservations: Reservation[];
  overrides: Record<string, StationOverride>;
}

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 读取旧油站数据：本地有数据用本地的，没有就用旧页面的种子数据。 */
export function readLegacyStations(): LegacyStationRecord[] {
  const parsed = safeParse<LegacyStationRecord[]>(localStorage.getItem(LEGACY_STATION_KEY));
  if (Array.isArray(parsed)) {
    const rows = parsed.filter((row) => !!asString(row?.station));
    if (rows.length > 0) return rows;
  }
  return LEGACY_SEED.map((row) => ({ ...row }));
}

const VALID_STATUSES: ReadonlySet<ReservationStatus> = new Set<ReservationStatus>([
  "waiting",
  "reserved",
  "checkedIn",
  "overdue",
  "completed",
  "cancelled",
]);

/** 单条预约的防御式校验，旧版本/坏数据直接丢弃，避免页面整体崩掉。 */
function sanitizeReservation(raw: unknown): Reservation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id);
  const plate = asString(r.plate);
  const station = asString(r.station);
  const enterAt = asString(r.enterAt);
  const status = asString(r.status) as ReservationStatus | undefined;
  const durationMin = Number(r.durationMin);
  if (
    !id ||
    !plate ||
    !station ||
    !enterAt ||
    !status ||
    !VALID_STATUSES.has(status) ||
    !Number.isFinite(new Date(enterAt).getTime()) ||
    !Number.isFinite(durationMin) ||
    durationMin <= 0
  ) {
    return undefined;
  }
  const vehicleType: VehicleType = r.vehicleType === "hazmat" ? "hazmat" : "normal";
  const createdAt = asString(r.createdAt) ?? new Date(0).toISOString();
  const out: Reservation = {
    id,
    plate: plate.toUpperCase(),
    station,
    vehicleType,
    enterAt: new Date(enterAt).toISOString(),
    durationMin: Math.round(durationMin),
    status,
    createdAt: Number.isFinite(new Date(createdAt).getTime())
      ? new Date(createdAt).toISOString()
      : new Date(0).toISOString(),
  };
  for (const key of ["promotedAt", "checkedInAt", "checkedOutAt", "expiredAt"] as const) {
    const v = asString(r[key]);
    if (v && Number.isFinite(new Date(v).getTime())) out[key] = new Date(v).toISOString();
  }
  const notes = asString(r.notes);
  if (notes) out.notes = notes;
  return out;
}

export function emptyParkingState(): ParkingState {
  return { version: PARKING_STATE_VERSION, reservations: [], overrides: {} };
}

export function loadParkingState(): ParkingState {
  const parsed = safeParse<Partial<ParkingState>>(localStorage.getItem(PARKING_STORAGE_KEY));
  if (!parsed || typeof parsed !== "object") return emptyParkingState();
  const reservations = Array.isArray(parsed.reservations)
    ? (parsed.reservations.map(sanitizeReservation).filter(Boolean) as Reservation[])
    : [];
  const overrides: Record<string, StationOverride> = {};
  if (parsed.overrides && typeof parsed.overrides === "object") {
    for (const [name, value] of Object.entries(parsed.overrides)) {
      if (!name || !value || typeof value !== "object") continue;
      const o = value as StationOverride;
      const clean: StationOverride = {};
      if (typeof o.paused === "boolean") clean.paused = o.paused;
      if (Number.isFinite(o.normalSpots) && (o.normalSpots as number) >= 0) {
        clean.normalSpots = Math.round(o.normalSpots as number);
      }
      if (Number.isFinite(o.hazmatSpots) && (o.hazmatSpots as number) >= 0) {
        clean.hazmatSpots = Math.round(o.hazmatSpots as number);
      }
      if (Object.keys(clean).length > 0) overrides[name] = clean;
    }
  }
  return { version: PARKING_STATE_VERSION, reservations, overrides };
}

export function saveParkingState(state: ParkingState): void {
  localStorage.setItem(PARKING_STORAGE_KEY, JSON.stringify(state));
}

/**
 * 合并旧油站数据与本模块的本地覆盖（暂停营业开关、车位容量）。
 * 旧数据里的「暂停营业」原文照常生效；覆盖项只做增量，不回写旧存储。
 */
export function buildStations(overrides: Record<string, StationOverride>): Station[] {
  return readLegacyStations().map((row) => {
    const name = asString(row.station)!;
    const legacyStatus = asString(row.status) ?? "营业中";
    const override = overrides[name] ?? {};
    const normalSpots = override.normalSpots ?? DEFAULT_NORMAL_SPOTS;
    const hazmatSpots = override.hazmatSpots ?? DEFAULT_HAZMAT_SPOTS;
    return {
      name,
      status: legacyStatus,
      area: asString(row.area),
      manager: asString(row.manager),
      paused: override.paused ?? legacyStatus.includes("暂停"),
      normalSpots,
      hazmatSpots,
      source: "legacy" as const,
    };
  });
}
