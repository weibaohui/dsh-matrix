# @weibaohui/dsh-matrix

[![DSH plugin](https://img.shields.io/badge/dsh-plugin-green)](https://github.com/topics/dsh-plugin)
[![npm version](https://img.shields.io/npm/v/@weibaohui/dsh-matrix)](https://www.npmjs.com/package/@weibaohui/dsh-matrix)

**黑客帝国数字雨**：对话窗口铺上经典的绿色字符雨背景——英文与数字的雨柱倾泻而下，白炽雨头绿身拖尾，agent 正在生成的 token 原文实时掺进雨里。字符在窗口上流动，代码在雨中生长。透明度、速度、密度、字号、配色全部可调，雨势还会跟随 agent 活跃度起伏。

## 效果演示

![demo：满屏字符雨 · 对话内容透过雨布 · 右上角设置面板实时调参](https://raw.githubusercontent.com/weibaohui/dsh-matrix/main/dsh-matrixdocs/demo.gif)

| | |
|---|---|
| ![默认 30% 透明度](https://raw.githubusercontent.com/weibaohui/dsh-matrix/main/dsh-matrixdocs/rain-dark.png) | ![浅色主题 45% 透明度](https://raw.githubusercontent.com/weibaohui/dsh-matrix/main/dsh-matrixdocs/rain-light.png) |
| *默认 30% 透明度：氛围与可读性兼顾* | *浅色主题下照样清透* |
| ![70% 透明度 × 1.3 密度](https://raw.githubusercontent.com/weibaohui/dsh-matrix/main/dsh-matrixdocs/rain-strong.png) | |
| *0.7 透明度 + 1.3 密度：正经矩阵* | |

## 核心功能

- **经典配方，英文数字语感**：纯英文大写 + 数字 + 符号字符集（不含任何日文假名）；同列相邻字符永不重复，满屏 AAA/666 的廉价感不存在；每列雨柱独立速度、独立亮度（景深层次），离屏错落起跑；雨头白炽、身后一格染回主题色——白头绿身；偶发在拖尾区随机重写一格，雨柱内部字符像在跳动
- **token 原文落进雨里**：宿主捕获 `assistant/chunk` 流式 token，SSE 推给雨布——约 1/3 的雨头字符来自 agent 正在生成的原文（大写化后进字符池），屏幕上落的就是你自己的对话；非拉丁字符自动丢弃，设置页可关
- **雨随 agent 起伏，三维加权**：宿主实时统计 token 吞吐（40%，流式字符按 1/4 折算 + 消息 usage）、工具调用频次（30%）、活跃会话数（30%），合成 0..1 强度值经 SSE 推给雨布——事件越频繁、工具越多、token 越多，雨速越快（最高 ×1.9）、雨越亮；空闲回落；设置页可关
- **满屏覆盖的长拖尾**：拖尾按 4s 时间常数衰减（帧率无关折算），雨柱垂满屏幕高度、不留大片空屏；快速雨柱一帧跨多行时逐格补字，雨柱内部无空洞
- **透明雨布零侵入**：`position:fixed; pointer-events:none` 画布盖在对话上空，不挡任何点击；拖尾用 `destination-out` 逐帧擦除，**画布本身永远透明**，对话内容透过来，`canvas.style.opacity` 是「雨中看代码」的总旋钮（默认 30%）；显示范围可选**除左侧栏（默认，会话列表保持干净）**或全屏
- **性能自律**（dsh-fireworks 同款思路）：渲染分辨率封顶（DPR≤1.5、长边≤2400，Retina 屏光栅像素省 5 倍起）；30fps 节流（雨是离散步进，30fps 足够顺滑，擦除/落笔全员减半）；字符按主题色预渲染成字形图集，运行期 `drawImage` 贴图不逐字 `fillText`；先雨身后雨头两遍批量落笔，每帧仅两次颜色状态切换；自适应画质——撑不住帧率先关拖尾闪烁、再降 24fps 档，宽裕自动回升；页面隐藏暂停、`prefers-reduced-motion` 自动停放。实测 6 倍 CPU 降速施压：JS 侧逐帧成本 0.72→0.31ms（4.3×↓），帧数 56→30fps（节流封顶），全程画质满格
- **深浅主题各自配色**：暗色用经典绿、亮色用琥珀（各自可另选经典绿/琥珀/赛博青/品红）——客户端每 3s 采样页面底色亮度，UI 切换深浅时雨色实时跟随；旧配置的单「配色」字段自动映射为暗色配色，升级不丢偏好
- **持续下雨可关**：关掉后，对话未开始或已收尾时雨会渐渐停歇（排空模式：只擦不落，拖尾淡尽自动停机省电）；agent 开始干活，雨随之而来
- **双击切换**：窗口里双击，随时在清屏与下雨之间切换（右下角浮标提示；输入框内双击选词不触发）——想安静看段代码，双击就好，想看雨再双击回来
- **开箱即管**：设置页总开关、**透明度滑杆（5%–100%）**、速度/密度/字号滑杆、暗色/亮色配色各一个下拉、显示范围（除左侧栏/全屏）、跟随 agent 活动、掺对话原文、持续下雨、双击清屏、引擎实时状态（雨柱数/fps/帧耗/画质/倍率/连接状态）

## 安装

```bash
dsh plugin --profile web add @weibaohui/dsh-matrix -w
```

装完重启 `dsh web` 即生效。入口：**设置 → 黑客帝国**（管理面板）。

## 使用

1. 装完即在下雨，不用做任何事——除左侧会话栏外整窗都是母体（要全屏雨：设置 → 黑客帝国 → 显示范围切「全屏」）
2. 嫌抢戏：设置页把**透明度**调低（0.15 左右是幽灵的低语）；嫌不够矩阵：拉到 0.6+
3. 换终端配色：暗色/亮色各配各的——暗色经典绿、亮色琥珀是默认档，琥珀/赛博青/品红像切换不同舰船的终端
4. 雨随 agent 忙闲起伏是默认开启的；想要一潭静水：设置页关掉「跟随 agent 活动」
5. 想安静看代码：**双击窗口清屏**，再双击恢复；不聊天时也想让雨停：关掉「持续下雨」
6. 控制台彩蛋：`__dshMatrix.boost(3)`（模拟 3 个会话同时活跃）；`__dshMatrix.applyConfig({ opacity: 0.8, themeDark: 'cyan' })`
7. 不装插件也能预览引擎：浏览器打开 `demo/demo.html`（带全套滑杆的假对话页，`?region=no-left&continuous=0&opacity=0.6` 直达参数）

## 实现说明

```
宿主（src/index.js）                     客户端（client/）
─────────────────                       ─────────────────
session/event 忙碌事件打点               全屏透明 canvas 浮层
  ↓ 2.5s 滑窗计活跃会话数                 (fixed, pointer-events:none)
SSE /dsh-matrix/api/stream ──→          rain.js 引擎下雨
  { kind:'activity', level }              ↓ boost = 1+0.3×level 平滑逼近
storageDomain 持久化配置                  雨速/亮度呼吸起伏
GET/POST /dsh-matrix/api/config ──→     设置页调参实时生效
```

- **宿主**：配置读写与持久化（dsh-flow 同款 `connection` 信任栅栏）+
  活跃度统计（`assistant/chunk`、`tool/call`、`tool/result`、`turn/start`
  等打点，700ms tick 重算，level 变化才广播；新订阅者立即补当前值）
- **渲染**：Canvas2D；`destination-out` 擦除拖尾（不涂黑底，画布恒透明）；
  渲染分辨率封顶 DPR 1.5 / 长边 2400；30fps 节流；字形图集（GLYPHS×双
  色离屏预渲染，运行期 drawImage）；雨柱离散行步进 + 帧率无关衰减；
  列距 = 字号 / 密度；自适应画质（帧率不足先关闪烁再降 24fps 档）
- **构建**：`client/rain.js` + `index.js` 由 `scripts/build-client.mjs`
  内联进 bundle 工厂作用域

## HTTP API（宿主）

| 路由 | 说明 |
|---|---|
| `GET /dsh-matrix/api/stream` | SSE 活跃度直播（level 变化才推帧，25s 心跳） |
| `GET /dsh-matrix/api/config` | 读配置 |
| `POST /dsh-matrix/api/config` | 存配置（storageDomain 持久化，宽松校验） |

配置 schema：`{ enabled, opacity(0.05..1), speed(0.3..2.5), density(0.5..2), fontSize(12..24), themeDark(classic|amber|cyan|magenta), themeLight(…同上), region(no-left|fullscreen), reactive, feed, continuous, ignoreReducedMotion }`

## 开发

```bash
npm run check          # 语法检查
npm test               # 9 项离线测试（配置归一化/字符集/配色一致性/布局/活跃度滑窗）
npm run build:client   # rain + index → client/bundle.js
```

link 安装的实例改完源码 `npm run build:client` 后刷新页面即生效。

## 联系我 :飞书群

![link](https://foruda.gitee.com/images/1774880015525784725/4fd67005_77493.png "link")

## 版本兼容性

本插件与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`）的版本对应关系：

| 插件版本 | 适配 dsh 版本 | 备注 |
|---------|--------------|------|
| 0.1.0 | 0.1.7-rc.2 | 当前版本，已在 @deepseek-ai/dsh@0.1.7-rc.2 下验证运行 |

> **发版约定**：每次发布新版本时，请在上表追加一行，记录该插件版本实际验证所用的 `@deepseek-ai/dsh` 版本。`package.json` 的 `engines.dsh` 声明最低支持版本；本表记录实际验证版本，二者配合使用。

## License

MIT
