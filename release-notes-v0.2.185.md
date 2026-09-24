# v0.2.185

### 改进与修复
1. **修复桌面端小组件拖拽重排与避让失效问题**：
   - 在 `placementStyle` 与 `widgetGrid.ts` 中根据网格坐标 `(x, y)` 动态计算 CSS `order` 属性，使 CSS Grid 能响应布局位置变化并驱动 FLIP 平滑位移动画。
   - 重构 `findNextFreePlacement` 空位扫描算法，修复因 `startX` 导致首行已释放空间被跳过的缺陷，确保被避让组件优先填补紧凑空位。
   - 优化 `moveWidgetWithAvoidance` 序列重排与紧凑排布逻辑，支持拖拽悬停时兄弟组件实时避让与换位。
   - 增强 `findDropTarget` 碰撞判定，增加基于容器内兄弟组件 Bounding Box 的边缘与间隙容错检测。
