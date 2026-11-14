# 设计说明 · 观测单元 GL-01

> 本文记录官网视觉的来源、规则与 3D 源资产的再生成方法。改视觉之前先读这一页。

## 概念

「观澜」取自《孟子·尽心上》「观水有术，必观其澜」。站点把它落成一座**数字观测站**：一件悬在数据之海上方的精密仪器，
持续观看「澜」——舰队与单机遥测汇成的波面。

- **观测单元 GL-01**：七层同轴的虚构仪器。自下而上是网络（含四组双色实时通道租约灯）、磁盘与存储池（镜面盘片 + 径向存储池阵列滑架）、内存（放射状 DIMM 走线与钢制卡扣）、处理器（钢制压框与镀金针脚硅片）、显卡（均热板鳍片与多引擎导光柱）、风扇（CNC 铝进风环与转子），最上层是观测窗（石英穹顶、琥珀脉冲与三段 15 秒青色租约弧）；它是隐喻，文案明确说明这是虚构仪器。
- **海面点阵与舰队星群**：位置 = f(网格坐标, 时间) 的波面，波峰由灰转琥珀；一道琥珀「观测脉冲」与青色「实时 challenge / pong 回波」从仪器正下方向外扩散，点亮分布在海面各处的自定义设备组信标（`clusters`）与组内连线。
- **双模遥测流**：常规琥珀采样粒子自海面设备组升起汇入底座，同时伴有青色双向实时直查流线；桌面端首屏与收尾支持轻量阻尼视差。
- **剖面**：向下滚动时仪器沿轴线展开成爆炸视图，镜头自上而下逐层聚焦，琥珀聚焦环与引线把文字面板连到对应的层（此段归零鼠标视差以保证引线精确指向）。

## 色彩

与 `design/observatory.json` 的 `palette` 同源，CSS 变量见 `src/styles/global.css`。

| 名 | 值 | 用途 |
| --- | --- | --- |
| void | `#06080b`（页面）/ `#07090c`（3D） | 底色，近黑偏冷 |
| bone | `#e9e6df` | 正文、刻度 |
| amber | `#ffa64a` | **只**用于数据与信号：脉冲、波峰、常规遥测流、提示水位、强调数字、主按钮 |
| teal | `#35d8b6` | **只**用于「在线 / 健康 / 实时直连租约」：状态点、实时双向流、正常组信标 |
| anodized / graphite / steel / copper | 见 spec | 仪器的金属材质 |

## 字体

| 角色 | 字体 | 说明 |
| --- | --- | --- |
| 中文展示与正文 | Noto Sans SC Variable | 展示字重 200，按 unicode-range 分片，浏览器只下载用到的字 |
| 拉丁正文 | Geist Variable | |
| 数字、标签、代码 | Geist Mono Variable | 等宽数字，像仪表读数 |

全部自托管（`@fontsource-variable/*`），不请求第三方字体服务。

## 版式语汇

- 区段编号 `§ 0N`、右上角大号描边数字（`.section[data-idx]`）、发丝线、套准标记 `+`、等宽小号大写标签；
- 卡片一律直角、1px 发丝边、无大圆角与投影堆叠；琥珀与青色各司其职，不做渐变彩虹。

## 动效与性能原则

- 首屏先显示 Blender Cycles AgX 渲染静帧（横版 / 竖版按视口选择），three 与模型在空闲时动态加载，就绪后画布淡入；任何失败都停在静帧上；
- `prefers-reduced-motion: reduce` 或不支持 WebGL 时不启动场景（`html.no-gl`），剖面改为静态列表 + 爆炸视图静帧；
- 舞台只在首屏、剖面、收尾三段渲染，其余区段与标签页隐藏时停止渲染；
- 自适应画质：前 30 帧多数慢于 30fps 关闭泛光并把像素比降到 1；单帧超过 250ms 立即降级；之后仍慢再降到 0.75；
- 剖面的文字面板只依赖滚动位置，与渲染帧率解耦；
- 粗指针设备、≤4 核或 ≤4GB 内存的设备直接走低配：无泛光、无 MSAA、海面点阵 130² 而非 220²。

## 设计源资产

| 文件 | 作用 |
| --- | --- |
| `design/observatory.json` | 唯一的几何、配色、海面波形、设备组信标（`clusters`）与机位定义——Blender 与 three.js 共用 |
| `design/blender/build_observatory.py` | 在 Blender 4.2+ / 5.x 中按 spec 生成观测单元、海面点阵与组信标、摄影棚灯光与渲染母版 |
| `design/blender/guanlan_observatory.blend` | 上述脚本生成的场景（含灯光、相机、海面与组信标） |
| `design/tools/model.mjs` | 原始 GLB → `public/models/observatory.glb`（gltfpack，meshopt 压缩，保留节点名与材质名） |
| `design/tools/media.mjs` | 渲染母版 → `src/assets/renders/*.webp`、`public/og/og.png`、`public/apple-touch-icon.png` |

模型约定（站点依赖，改脚本时保持）：每层根节点 `L_<id>`，层内几何按局部坐标（底面 z = 0）构建；可动部件
`fan_rotor`、`disk_platter` 为独立节点；同层同材质合并为一个网格；材质名 `glass`、`amber`、`teal`、`tick`、
`reticle` 由站点覆写或驱动自发光。

### 重新生成

1. Blender（无头命令行）：

   ```bash
   blender -b -P design/blender/build_observatory.py -- \
     --spec design/observatory.json \
     --glb observatory_raw.glb \
     --blend design/blender/guanlan_observatory.blend \
     --renders masters --samples 96
   ```

   母版：`hero.png`（2560×1440，物体按 spec 的 `shiftX` 右移）、`hero-portrait.png`（1080×1920）、`exploded.png`（1400×1600）。Cycles + OIDN 降噪，AgX。
2. 在本地构建区（`$BUILD_SCRATCH_ROOT`）：

   ```bash
   node design/tools/model.mjs observatory_raw.glb
   node design/tools/media.mjs masters
   ```

3. 改了 `observatory.json` 的几何或机位：两边都要重新生成（站点场景自动跟随 spec，静帧需要重新渲染）。
