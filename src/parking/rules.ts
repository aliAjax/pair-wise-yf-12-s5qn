/**
 * 停车预约规则层：纯函数，不接触 localStorage，也不依赖 Vue。
 * 所有时间都由调用方以 Date（默认当前时间）传入，方便测试与回放。
 */
import type {
  Reservation,
  ReservationInput,
  ReservationStatus,
  SpotKind,
  Station,
  SubmitResult,
  VehicleType,
} from "./types";

/** 超过入场时刻多少分钟未签到就释放车位。 */
export const CHECK_IN_GRACE_MIN = 15;

/** 占用车位的状态：已分位未签到也算占用（车位已为其锁定）。 */
export const SPOT_HOLDING_STATUSES: readonly ReservationStatus[] = ["reserved", "checkedIn"];

/** 仍在候补队列中的状态。 */
export const WAITING_STATUSES: readonly ReservationStatus[] = ["waiting"];

/** 终态，不再参与任何计数与排队。 */
export const TERMINAL_STATUSES: readonly ReservationStatus[] = ["completed", "cancelled"];

export function spotKindOf(vehicleType: VehicleType): SpotKind {
  // 危化品车只进专用位，普通车只进普通位，两类车位互不挤占。
  return vehicleType === "hazmat" ? "hazmat" : "normal";
}

export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase();
}

/** [开始, 结束) 两个半开时间区间是否重叠。 */
export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

export function enterTime(r: Pick<Reservation, "enterAt">): number {
  return new Date(r.enterAt).getTime();
}

/** 预约计划离场时刻（入场时刻 + 停留时长）。 */
export function plannedExitTime(r: Pick<Reservation, "enterAt" | "durationMin">): number {
  return new Date(r.enterAt).getTime() + r.durationMin * 60_000;
}

/**
 * 签到截止时刻：恒为入场时刻 + 15 分钟。
 * 候补补上只是重新分配车位，并不延长该预约的入场时限；
 * 若补上时已过时限，settle 会立即判其逾期并继续补队列中的下一辆。
 * promotedAt 仅用于页面展示「补位时刻」。
 */
export function checkInDeadline(r: Reservation): number {
  return enterTime(r) + CHECK_IN_GRACE_MIN * 60_000;
}

/**
 * 同车牌在同一油站、时间区间重叠且单子仍“有效”（未终态）时，
 * 只能保留一条。比较时把逾期未签到也视为占用到应释放时刻。
 */
export function findOverlappingDuplicate(
  list: readonly Reservation[],
  input: ReservationInput
): Reservation | undefined {
  const plate = normalizePlate(input.plate);
  const start = new Date(input.enterAt).getTime();
  const end = start + input.durationMin * 60_000;
  return list.find((r) => {
    if (TERMINAL_STATUSES.includes(r.status)) return false;
    if (r.station !== input.station || normalizePlate(r.plate) !== plate) return false;
    return intervalsOverlap(start, end, enterTime(r), plannedExitTime(r));
  });
}

/** 某站某类车位的总车位数。 */
export function capacityOf(station: Station, kind: SpotKind): number {
  return kind === "hazmat" ? station.hazmatSpots : station.normalSpots;
}

/** 当前锁定某站某类车位的预约数（reserved + checkedIn）。 */
export function countHeldSpots(
  list: readonly Reservation[],
  station: string,
  kind: SpotKind
): number {
  return list.filter(
    (r) =>
      r.station === station &&
      spotKindOf(r.vehicleType) === kind &&
      SPOT_HOLDING_STATUSES.includes(r.status)
  ).length;
}

export function isStationPaused(station: Station): boolean {
  return station.paused;
}

/**
 * 候补排序：按登记先后（createdAt 升序），相同则按 id 保证稳定。
 */
export function waitingQueue(list: readonly Reservation[], station: string, kind: SpotKind) {
  return list
    .filter(
      (r) =>
        r.station === station &&
        spotKindOf(r.vehicleType) === kind &&
        WAITING_STATUSES.includes(r.status)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export interface ReservationError {
  reason: "station-paused" | "duplicate" | "invalid";
  message: string;
}

/** 校验表单输入，返回归一化后的值或错误信息。 */
export function validateInput(
  input: ReservationInput,
  stations: readonly Station[]
): { value?: ReservationInput; error?: ReservationError } {
  const plate = normalizePlate(input.plate);
  if (!plate) {
    return { error: { reason: "invalid", message: "请填写车牌号" } };
  }
  const station = stations.find((s) => s.name === input.station);
  if (!station) {
    return { error: { reason: "invalid", message: "请选择有效的油站" } };
  }
  if (isStationPaused(station)) {
    return {
      error: { reason: "station-paused", message: `「${station.name}」已暂停营业，不接受新预约` },
    };
  }
  const enterAt = new Date(input.enterAt).getTime();
  if (!Number.isFinite(enterAt)) {
    return { error: { reason: "invalid", message: "请选择有效的入场时刻" } };
  }
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    return { error: { reason: "invalid", message: "停留时长需为大于 0 的分钟数" } };
  }
  return {
    value: {
      plate,
      station: input.station,
      vehicleType: input.vehicleType,
      enterAt: new Date(enterAt).toISOString(),
      durationMin: Math.round(input.durationMin),
      notes: input.notes?.trim() || undefined,
    },
  };
}

/**
 * 登记一条新预约：
 * 1. 暂停营业站点拒收；
 * 2. 同车牌同站时间重叠只留一条；
 * 3. 对应车位池有空位则直接分位（危化品车走专用位），否则进入候补。
 * 纯函数：返回新列表与结果对象，不改入参。
 */
export function submitReservation(
  list: readonly Reservation[],
  stations: readonly Station[],
  raw: ReservationInput,
  now: Date = new Date()
): { list: Reservation[]; result: SubmitResult } {
  const checked = validateInput(raw, stations);
  if (checked.error || !checked.value) {
    return {
      list: [...list],
      result: { ok: false, reason: checked.error!.reason, message: checked.error!.message },
    };
  }
  const input = checked.value;

  const duplicate = findOverlappingDuplicate(list, input);
  if (duplicate) {
    return {
      list: [...list],
      result: {
        ok: false,
        reason: "duplicate",
        message: `车牌 ${input.plate} 在该站已有时间重叠的预约单（${duplicate.id.slice(0, 8)}），每车仅保留一条`,
      },
    };
  }

  const station = stations.find((s) => s.name === input.station)!;
  const kind = spotKindOf(input.vehicleType);
  const held = countHeldSpots(list, station.name, kind);
  const capacity = capacityOf(station, kind);
  const nowIso = now.toISOString();

  const reservation: Reservation = {
    id: crypto.randomUUID(),
    plate: input.plate,
    station: input.station,
    vehicleType: input.vehicleType,
    enterAt: input.enterAt,
    durationMin: input.durationMin,
    status: held < capacity ? "reserved" : "waiting",
    createdAt: nowIso,
    notes: input.notes,
  };

  return {
    list: [reservation, ...list],
    result: { ok: true, reservation, waited: reservation.status === "waiting" },
  };
}

/** 签到：必须处于已分位状态，且未超过 15 分钟时限。 */
export function checkIn(
  list: readonly Reservation[],
  id: string,
  now: Date = new Date()
): { list: Reservation[]; ok: boolean; message?: string } {
  const target = list.find((r) => r.id === id);
  if (!target) return { list: [...list], ok: false, message: "预约单不存在" };
  if (target.status === "checkedIn") return { list: [...list], ok: false, message: "该车辆已签到" };
  if (target.status !== "reserved") {
    return { list: [...list], ok: false, message: "当前状态不能签到" };
  }
  if (now.getTime() > checkInDeadline(target)) {
    return { list: [...list], ok: false, message: "已超过入场时刻 15 分钟，请重新预约" };
  }
  return {
    list: list.map((r) =>
      r.id === id ? { ...r, status: "checkedIn", checkedInAt: now.toISOString() } : r
    ),
    ok: true,
  };
}

/** 签退：已入场车辆（含暂停营业站点）均可签退，释放车位。 */
export function checkOut(
  list: readonly Reservation[],
  id: string,
  now: Date = new Date()
): { list: Reservation[]; ok: boolean; message?: string } {
  const target = list.find((r) => r.id === id);
  if (!target) return { list: [...list], ok: false, message: "预约单不存在" };
  if (target.status !== "checkedIn") {
    return { list: [...list], ok: false, message: "只有已入场车辆可以签退" };
  }
  return {
    list: list.map((r) =>
      r.id === id ? { ...r, status: "completed", checkedOutAt: now.toISOString() } : r
    ),
    ok: true,
  };
}

export function cancelReservation(
  list: readonly Reservation[],
  id: string
): { list: Reservation[]; ok: boolean; message?: string } {
  const target = list.find((r) => r.id === id);
  if (!target) return { list: [...list], ok: false, message: "预约单不存在" };
  if (TERMINAL_STATUSES.includes(target.status)) {
    return { list: [...list], ok: false, message: "该单子已结束，无法取消" };
  }
  return {
    list: list.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r)),
    ok: true,
  };
}

/**
 * 时间推进结算（每次操作和页面定时刷新时调用），只依赖传入的 stations/list：
 * 1. 超过签到时限仍 reserved 的单子 → overdue，释放车位；
 * 2. 任意车位释放后，按登记先后把该站该类候补补上，
 *    轮到危化品车时自然分配的是专用位（按 kind 分队列）；
 * 3. 候补补上后若本身已过 15 分钟时限，本轮直接判逾期，继续补下一个。
 * 幂等：重复调用结果稳定。
 */
export function settle(
  list: readonly Reservation[],
  stations: readonly Station[],
  now: Date = new Date()
): Reservation[] {
  const nowMs = now.getTime();
  let next = [...list];

  // 1. 逾期释放：已分位未签到的，过时限即释放；
  //    尚在候补但连预约时段都已结束的，同样清出队列。
  next = next.map((r) => {
    if (r.status === "reserved" && nowMs > checkInDeadline(r)) {
      return { ...r, status: "overdue", expiredAt: new Date(checkInDeadline(r)).toISOString() };
    }
    if (r.status === "waiting" && plannedExitTime(r) <= nowMs) {
      return { ...r, status: "overdue", expiredAt: now.toISOString() };
    }
    return r;
  });

  // 2 & 3. 逐站、逐车位池补位
  for (const station of stations) {
    for (const kind of ["normal", "hazmat"] as SpotKind[]) {
      const capacity = capacityOf(station, kind);
      // 暂停营业不影响已入场车辆，也不再为候补分新位。
      if (station.paused) continue;

      let guard = 0;
      while (guard++ < next.length + 1) {
        const held = countHeldSpots(next, station.name, kind);
        if (held >= capacity) break;
        const queue = waitingQueue(next, station.name, kind);
        if (queue.length === 0) break;
        const first = queue[0];
        const promotedAt = now.toISOString();
        if (nowMs > checkInDeadline(first)) {
          // 轮到它时已过入场时限（超过 15 分钟），直接判逾期，把机会给下一个。
          next = next.map((r) =>
            r.id === first.id
              ? {
                  ...r,
                  status: "overdue",
                  promotedAt,
                  expiredAt: new Date(checkInDeadline(first)).toISOString(),
                }
              : r
          );
          continue;
        }
        next = next.map((r) =>
          r.id === first.id ? { ...r, status: "reserved", promotedAt } : r
        );
      }
    }
  }

  return next;
}

/** 是否逾期（用于指标与列表徽标；settle 会把状态真正流转为 overdue）。 */
export function isOverdue(r: Reservation, now: Date = new Date()): boolean {
  if (r.status === "overdue") return true;
  return r.status === "reserved" && now.getTime() > checkInDeadline(r);
}
