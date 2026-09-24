# 油站网点地图管理

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Pinia、Element Plus、Leaflet
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

这是一个功能最小闭环前端项目，数据默认保存在浏览器 localStorage 中，方便后续扩展接口、权限、图表或地图能力。

## 停车预约

页面分为「停车预约」「油站管理」两个标签，解决危化品车与普通货车抢位、纸笔登记问题。

预约规则：

1. 登记车牌、油站、入场时刻、停留时长。
2. 同一车牌在同一油站时间重叠的未结预约只保留一条（重复登记被拒）。
3. 危化品车只分配专用位，不占普通车位；普通货车只占普通位。
4. 车位满后进入候补；有空位时按登记先后自动递补，轮到危化品车分配专用位。
5. 超过入场时刻 15 分钟未签到自动释放车位，并让同站最早候补接上。
6. 站点暂停营业后不接新预约；已入场车辆仍可签退。
7. 列表与指标实时展示占用、候补、逾期；系统每 20 秒推进一次时间。

### 代码分层（规则 / 存储 / 页面接入分离）

- `src/parking/types.ts`：领域模型与状态枚举。
- `src/parking/rules.ts`：纯规则函数，不依赖浏览器与 Vue，可单测。
- `src/parking/storage.ts`：localStorage 读写与旧数据兼容。
  - 油站数据仍使用旧 key `hxwlfront-21-station-map`，旧油站数据照常读取（缺车位字段时补默认值）。
  - 预约数据使用独立 key `hxwlfront-21-parking-reservations`，预约状态继续保存在浏览器。
- `src/parking/store.ts`：Pinia 接入层，粘合规则与存储、驱动时钟、暴露指标与操作。
- `src/parking/ParkingView.vue` / `StationView.vue`：页面组件。
- `src/parking/format.ts`：展示用时间格式化。
