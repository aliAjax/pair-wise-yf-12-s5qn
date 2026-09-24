/** 停车预约领域模型，只描述数据结构，不包含任何存储或页面逻辑。 */

/** 车辆类型：hazmat 为危化品车，只能停专用位；normal 为普通货车，停普通位。 */
export type VehicleType = "hazmat" | "normal";

/**
 * 预约状态机：
 * - waiting    已登记，暂无对应车位，在该站候补队列中
 * - reserved   已分配车位，等待签到（入场时刻起 15 分钟内必须签到）
 * - checkedIn  已签到入场，车位实际占用中
 * - overdue    超过入场时刻 15 分钟未签到，车位已释放
 * - completed  已签退，车位释放（终态）
 * - cancelled  主动取消（终态）
 */
export type ReservationStatus =
  | "waiting"
  | "reserved"
  | "checkedIn"
  | "overdue"
  | "completed"
  | "cancelled";

/** 车位池类型：普通位与危化品专用位完全分开计数。 */
export type SpotKind = "normal" | "hazmat";

export interface Reservation {
  id: string;
  /** 车牌号（统一大写存储） */
  plate: string;
  /** 油站名称，与旧油站数据中的 station 字段对应 */
  station: string;
  vehicleType: VehicleType;
  /** 预约入场时刻，ISO 字符串 */
  enterAt: string;
  /** 计划停留时长，分钟 */
  durationMin: number;
  status: ReservationStatus;
  /** 登记时间，候补排序依据（越早越优先） */
  createdAt: string;
  /** 分配到车位的时间；从候补补上时按此刻重新计算签到时限 */
  promotedAt?: string;
  /** 实际签到时间 */
  checkedInAt?: string;
  /** 实际签退时间 */
  checkedOutAt?: string;
  /** 逾期释放时间 */
  expiredAt?: string;
  notes?: string;
}

/** 旧油站数据（hxwlfront-21-station-map）读出来的站点结构，只取需要的字段。 */
export interface LegacyStationRecord {
  station?: unknown;
  status?: unknown;
  area?: unknown;
  manager?: unknown;
  [key: string]: unknown;
}

export interface Station {
  name: string;
  /** 旧数据里的营业状态原文，如「营业中 / 暂停营业 / 库存紧张」 */
  status: string;
  area?: string;
  manager?: string;
  /** 是否暂停营业；旧数据没有时按名称兜底判断 */
  paused: boolean;
  /** 普通车位数 */
  normalSpots: number;
  /** 危化品专用位数 */
  hazmatSpots: number;
  /** 数据来源，页面上用来提示「旧油站数据照常读取」 */
  source: "legacy" | "seed";
}

/** 新建预约时的表单输入。 */
export interface ReservationInput {
  plate: string;
  station: string;
  vehicleType: VehicleType;
  enterAt: string;
  durationMin: number;
  notes?: string;
}

export type SubmitResult =
  | { ok: true; reservation: Reservation; waited: boolean }
  | { ok: false; reason: "station-paused" | "duplicate" | "invalid"; message: string };
