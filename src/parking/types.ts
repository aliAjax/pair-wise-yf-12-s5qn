/**
 * 停车预约领域模型与纯规则类型。
 * 本文件不依赖浏览器 API 与 Vue，方便单测与替换实现。
 */

/** 车辆类型：普通货车 / 危化品车（危化品车只占专用位） */
export type VehicleKind = "normal" | "hazmat";

/**
 * 预约状态流转：
 * reserved（已占车位，待签到）
 *   ├─ checkedIn（已入场）
 *   │    └─ checkedOut（已签退，终态）
 *   └─ expired（超入场时刻 15 分钟未签到，终态，车位已释放）
 * waiting（车位已满，候补中）
 *   ├─ reserved（有空位按登记先后递补）
 *   └─ expired（候补期间错过入场时刻 15 分钟，终态）
 * cancelled（主动取消，终态）
 */
export type ReservationStatus =
  | "reserved"
  | "waiting"
  | "checkedIn"
  | "checkedOut"
  | "expired"
  | "cancelled";

/** 油站营业状态（沿用旧系统：暂停营业后不接新预约） */
export type StationStatus = "营业中" | "暂停营业" | "库存紧张";

export interface Station {
  id: string;
  /** 油站名称 */
  station: string;
  area?: string;
  manager?: string;
  stock?: number;
  status: StationStatus;
  notes?: string;
  /** 普通车位数（旧数据没有时用默认值） */
  normalSpots: number;
  /** 危化品专用车位数（旧数据没有时用默认值） */
  hazmatSpots: number;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Reservation {
  id: string;
  /** 车牌号 */
  plate: string;
  /** 油站 id */
  stationId: string;
  kind: VehicleKind;
  /** 入场时刻（ISO 字符串） */
  startAt: string;
  /** 停留时长（分钟） */
  durationMin: number;
  status: ReservationStatus;
  /** 登记时间（ISO 字符串），候补递补按此先后 */
  createdAt: string;
  /** 实际签到时间 */
  checkedInAt?: string;
  /** 实际签退时间 */
  checkedOutAt?: string;
  notes?: string;
}

/** 预约表单入参 */
export interface BookingInput {
  plate: string;
  stationId: string;
  kind: VehicleKind;
  startAt: string;
  durationMin: number;
  notes?: string;
}

/** 规则执行结果 */
export interface RuleResult<T = Reservation[]> {
  ok: boolean;
  message: string;
  data?: T;
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  reserved: "待签到",
  waiting: "候补中",
  checkedIn: "已入场",
  checkedOut: "已签退",
  expired: "已逾期",
  cancelled: "已取消"
};

export const KIND_LABEL: Record<VehicleKind, string> = {
  normal: "普通货车",
  hazmat: "危化品车"
};

/** 超过入场时刻多少分钟未签到即释放车位 */
export const CHECK_IN_GRACE_MIN = 15;

/** 旧油站数据没有车位数时的默认值 */
export const DEFAULT_NORMAL_SPOTS = 8;
export const DEFAULT_HAZMAT_SPOTS = 2;

/** 终态：不再占车位、不再参与候补 */
export function isTerminal(status: ReservationStatus): boolean {
  return status === "checkedOut" || status === "expired" || status === "cancelled";
}
