/**
 * 停车预约纯规则层：只处理数据与时间，不碰 localStorage / Vue。
 *
 * 规则要点：
 * 1. 登记车牌、油站、入场时刻、停留时长。
 * 2. 同一车牌在同一油站时间重叠的未结单子只保留一条（重复登记被拒）。
 * 3. 危化品车只占专用位，不占普通车位；普通货车只占普通位。
 * 4. 车位满则进入候补；有空位时按登记先后（createdAt）递补，
 *    轮到危化品车时分配专用位。
 * 5. 超过入场时刻 15 分钟未签到：释放车位并让最早候补接上。
 * 6. 站点暂停营业后不接新预约；已入场车辆仍可签退。
 */
import {
  BookingInput,
  CHECK_IN_GRACE_MIN,
  DEFAULT_HAZMAT_SPOTS,
  DEFAULT_NORMAL_SPOTS,
  Reservation,
  ReservationStatus,
  RuleResult,
  Station,
  VehicleKind,
  isTerminal
} from "./types";

export function toTime(value: string | number | Date): number {
  return new Date(value).getTime();
}

/** 预约占用车位的时间区间（毫秒时间戳） */
export function intervalOf(r: Pick<Reservation, "startAt" | "durationMin">): {
  start: number;
  end: number;
} {
  const start = toTime(r.startAt);
  return { start, end: start + r.durationMin * 60000 };
}

export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 规范化车牌：去空格、转大写，便于判重 */
export function normalizePlate(plate: string): string {
  return plate.replace(/\s+/g, "").toUpperCase();
}

/** 未结单子：还会占车位或排队的单子（终态不参与重叠判重） */
function isOpen(r: Reservation): boolean {
  return !isTerminal(r.status);
}

/** 同一车牌、同一油站、时间重叠的未结单子 */
export function findDuplicate(
  list: Reservation[],
  input: BookingInput
): Reservation | undefined {
  const plate = normalizePlate(input.plate);
  const target = intervalOf(input);
  return list.find(
    (r) =>
      isOpen(r) &&
      r.stationId === input.stationId &&
      normalizePlate(r.plate) === plate &&
      overlaps(intervalOf(r), target)
  );
}

export function stationCapacity(station: Station, kind: VehicleKind): number {
  return kind === "hazmat"
    ? station.hazmatSpots ?? DEFAULT_HAZMAT_SPOTS
    : station.normalSpots ?? DEFAULT_NORMAL_SPOTS;
}

/**
 * 当前真正占用某类车位的单子：
 * reserved（已分配待签到）与 checkedIn（已入场）都占车位；
 * waiting / 终态不占。
 */
export function isOccupying(status: ReservationStatus): boolean {
  return status === "reserved" || status === "checkedIn";
}

export type Occupancy = {
  normal: { used: number; capacity: number };
  hazmat: { used: number; capacity: number };
};

/** 统计某站的车位占用（供页面展示占用指标） */
export function occupancyOf(list: Reservation[], station: Station): Occupancy {
  const atStation = list.filter((r) => r.stationId === station.id);
  const normal = atStation.filter(
    (r) => r.kind === "normal" && isOccupying(r.status)
  ).length;
  const hazmat = atStation.filter(
    (r) => r.kind === "hazmat" && isOccupying(r.status)
  ).length;
  return {
    normal: { used: normal, capacity: stationCapacity(station, "normal") },
    hazmat: { used: hazmat, capacity: stationCapacity(station, "hazmat") }
  };
}

/** 某站某类车位剩余数量 */
export function freeSpots(
  list: Reservation[],
  station: Station,
  kind: VehicleKind
): number {
  const occ = occupancyOf(list, station);
  const slot = kind === "hazmat" ? occ.hazmat : occ.normal;
  return Math.max(0, slot.capacity - slot.used);
}

/** 校验登记入参 */
export function validateBooking(input: BookingInput): RuleResult {
  if (!input.plate || !input.plate.trim()) {
    return { ok: false, message: "请填写车牌号" };
  }
  if (!input.stationId) {
    return { ok: false, message: "请选择油站" };
  }
  if (!input.startAt || !Number.isFinite(toTime(input.startAt))) {
    return { ok: false, message: "请选择入场时刻" };
  }
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    return { ok: false, message: "停留时长需为大于 0 的分钟数" };
  }
  return { ok: true, message: "" };
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 登记一条新预约（不修改原数组）。
 * - 暂停营业站点：不接新预约。
 * - 同车牌同站时间重叠且未结：拒绝（只留一条）。
 * - 对应车位有空：reserved（占车位）；否则 waiting（候补）。
 */
export function book(
  list: Reservation[],
  stations: Station[],
  input: BookingInput,
  now: Date = new Date()
): RuleResult<Reservation[]> {
  const validation = validateBooking(input);
  if (!validation.ok) return validation;

  const station = stations.find((s) => s.id === input.stationId);
  if (!station) return { ok: false, message: "油站不存在，请重新选择" };

  if (station.status === "暂停营业") {
    return { ok: false, message: "该站已暂停营业，暂不接受新预约" };
  }

  const duplicate = findDuplicate(list, input);
  if (duplicate) {
    return {
      ok: false,
      message: `车牌 ${normalizePlate(input.plate)} 在该站已有时间重叠的未结预约`
    };
  }

  const status: ReservationStatus =
    freeSpots(list, station, input.kind) > 0 ? "reserved" : "waiting";

  const reservation: Reservation = {
    id: makeId(),
    plate: normalizePlate(input.plate),
    stationId: input.stationId,
    kind: input.kind,
    startAt: new Date(input.startAt).toISOString(),
    durationMin: Math.round(input.durationMin),
    status,
    createdAt: now.toISOString(),
    notes: input.notes?.trim() || undefined
  };

  return {
    ok: true,
    message: status === "reserved" ? "预约成功，已分配车位" : "车位已满，已进入候补",
    data: [reservation, ...list]
  };
}

/** 签到：仅 reserved（含候补递补上来的）可签到，逾期单不可签到 */
export function checkIn(
  list: Reservation[],
  id: string,
  now: Date = new Date()
): RuleResult<Reservation[]> {
  const target = list.find((r) => r.id === id);
  if (!target) return { ok: false, message: "预约不存在" };
  if (target.status === "checkedIn") {
    return { ok: false, message: "该车辆已入场" };
  }
  if (target.status === "waiting") {
    return { ok: false, message: "仍在候补中，分配车位后才能签到" };
  }
  if (target.status !== "reserved") {
    return { ok: false, message: "当前状态不可签到" };
  }
  const deadline = toTime(target.startAt) + CHECK_IN_GRACE_MIN * 60000;
  if (now.getTime() > deadline) {
    return { ok: false, message: "已超过入场时刻 15 分钟，车位已释放" };
  }
  return {
    ok: true,
    message: "签到成功",
    data: list.map((r) =>
      r.id === id ? { ...r, status: "checkedIn", checkedInAt: now.toISOString() } : r
    )
  };
}

/**
 * 签退：已入场车辆随时可签退（站点暂停营业也允许）。
 * 签退后释放车位并触发候补递补。
 */
export function checkOut(
  list: Reservation[],
  stations: Station[],
  id: string,
  now: Date = new Date()
): RuleResult<Reservation[]> {
  const target = list.find((r) => r.id === id);
  if (!target) return { ok: false, message: "预约不存在" };
  if (target.status !== "checkedIn") {
    return { ok: false, message: "车辆未入场，无法签退" };
  }
  const released = list.map((r) =>
    r.id === id
      ? { ...r, status: "checkedOut" as const, checkedOutAt: now.toISOString() }
      : r
  );
  // 先清理已过宽限期的单子，再递补，避免把车位补到已作废的候补上
  const expired = expireOverdue(released, stations, now);
  return {
    ok: true,
    message: "签退成功，车位已释放",
    data: promoteWaiting(expired, stations, target.stationId, now)
  };
}

/** 取消预约（候补或待签到可取消；取消后释放名额给候补） */
export function cancelReservation(
  list: Reservation[],
  stations: Station[],
  id: string,
  now: Date = new Date()
): RuleResult<Reservation[]> {
  const target = list.find((r) => r.id === id);
  if (!target) return { ok: false, message: "预约不存在" };
  if (isTerminal(target.status)) {
    return { ok: false, message: "该预约已结束，无法取消" };
  }
  if (target.status === "checkedIn") {
    return { ok: false, message: "车辆已入场，请直接签退" };
  }
  const cancelled = list.map((r) =>
    r.id === id ? { ...r, status: "cancelled" as const } : r
  );
  const expired = expireOverdue(cancelled, stations, now);
  return {
    ok: true,
    message: "预约已取消",
    data: promoteWaiting(expired, stations, target.stationId, now)
  };
}

/**
 * 候补递补（核心规则 4）：有空位时按登记先后补上，
 * 轮到危化品车就分配专用位（按 kind 取对应容量，普通位与专用位互不挤占）。
 *
 * @param stationId 只处理指定站；不传则处理所有站
 */
export function promoteWaiting(
  list: Reservation[],
  stations: Station[],
  stationId?: string,
  _now: Date = new Date()
): Reservation[] {
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const next = [...list];
  const stationIds = stationId
    ? [stationId]
    : [...new Set(next.filter((r) => r.status === "waiting").map((r) => r.stationId))];

  for (const sid of stationIds) {
    const station = stationById.get(sid);
    if (!station) continue;
    let progressed = true;
    while (progressed) {
      progressed = false;
      // 该站候补按登记先后排序
      const queue = next
        .filter((r) => r.stationId === sid && r.status === "waiting")
        .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
      for (const candidate of queue) {
        if (freeSpots(next, station, candidate.kind) > 0) {
          const index = next.findIndex((r) => r.id === candidate.id);
          next[index] = { ...next[index], status: "reserved" };
          progressed = true;
          break; // 占用变化后重排队首，保证"先到先得"
        }
      }
    }
  }
  return next;
}

/**
 * 超时处理（核心规则 5）：
 * - reserved 且 now > 入场时刻 + 15 分钟：置 expired，释放车位；
 * - waiting 且错过入场时刻 15 分钟：置 expired（候补未排上，本就不占车位）；
 * - checkedIn 超过预计离场时间不做逾期（以实际签退为准）。
 * 每释放一个 reserved 车位，立即让同站最早候补接上。
 */
export function expireOverdue(
  list: Reservation[],
  stations: Station[],
  now: Date = new Date()
): Reservation[] {
  let next = [...list];
  // 按入场时刻先后处理，释放顺序确定
  const due = list
    .filter((r) => r.status === "reserved" || r.status === "waiting")
    .filter((r) => now.getTime() > toTime(r.startAt) + CHECK_IN_GRACE_MIN * 60000)
    .sort((a, b) => toTime(a.startAt) - toTime(b.startAt));

  for (const r of due) {
    const wasReserved = next.find((x) => x.id === r.id)?.status === "reserved";
    next = next.map((x) => (x.id === r.id ? { ...x, status: "expired" as const } : x));
    if (wasReserved) {
      next = promoteWaiting(next, stations, r.stationId, now);
    }
  }
  return next;
}

/**
 * 统一的时间推进入口：先逾期释放，再对剩余空位做一次候补递补。
 * 页面每次刷新 / 定时触发时调用。
 */
export function tick(
  list: Reservation[],
  stations: Station[],
  now: Date = new Date()
): Reservation[] {
  const expired = expireOverdue(list, stations, now);
  return promoteWaiting(expired, stations, undefined, now);
}

/** 候补队列（按登记先后），供页面展示 */
export function waitingQueue(list: Reservation[], stationId?: string): Reservation[] {
  return list
    .filter((r) => r.status === "waiting" && (!stationId || r.stationId === stationId))
    .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
}

/** 逾期单（已超过宽限期仍未签到），供页面展示 */
export function overdueReservations(
  list: Reservation[],
  now: Date = new Date()
): Reservation[] {
  return list.filter((r) => {
    if (r.status !== "reserved" && r.status !== "waiting") return false;
    const deadline = toTime(r.startAt) + CHECK_IN_GRACE_MIN * 60000;
    return now.getTime() > deadline;
  });
}
