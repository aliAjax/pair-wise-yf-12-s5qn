/**
 * 页面展示辅助：状态文案、时间格式化、指标汇总。
 * 不含任何变更逻辑，纯读操作。
 */
import { CHECK_IN_GRACE_MIN, checkInDeadline, isOverdue } from "./rules";
import type { Reservation, ReservationStatus, Station, VehicleType } from "./types";

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  waiting: "候补中",
  reserved: "已分位",
  checkedIn: "已入场",
  overdue: "已逾期",
  completed: "已签退",
  cancelled: "已取消",
};

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  normal: "普通货车",
  hazmat: "危化品车",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 格式化为 yyyy-MM-dd HH:mm（预约时刻不展示秒，更贴近纸质登记习惯）。 */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** 分钟数转「x小时y分」。 */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 已分位未签到时的倒计时文案，超时显示「已超时」。 */
export function checkInCountdown(r: Reservation, now: Date): string {
  if (r.status !== "reserved") return "";
  const remainMs = checkInDeadline(r) - now.getTime();
  if (remainMs <= 0) return "已超时";
  const min = Math.floor(remainMs / 60_000);
  const sec = Math.floor((remainMs % 60_000) / 1000);
  return `剩余签到时限 ${pad(Math.max(0, min))}:${pad(Math.max(0, sec))}`;
}

export interface ParkingMetrics {
  /** 当前实际锁定车位数（已分位 + 已入场） */
  occupied: number;
  /** 候补总单数 */
  waiting: number;
  /** 已逾期单数（含本轮 tick 前即将流转的） */
  overdue: number;
  checkedIn: number;
  reserved: number;
  total: number;
}

export function summarize(list: readonly Reservation[], now: Date): ParkingMetrics {
  return {
    total: list.length,
    occupied: list.filter((r) => r.status === "reserved" || r.status === "checkedIn").length,
    waiting: list.filter((r) => r.status === "waiting").length,
    overdue: list.filter((r) => isOverdue(r, now)).length,
    checkedIn: list.filter((r) => r.status === "checkedIn").length,
    reserved: list.filter((r) => r.status === "reserved").length,
  };
}

/** 当前可接新预约的站点（暂停营业除外）。 */
export function bookableStations(stations: readonly Station[]): Station[] {
  return stations.filter((s) => !s.paused);
}

export { CHECK_IN_GRACE_MIN };
