'use strict'

/**
 * dsh-matrix — Client half
 *
 * 往会话列里挂一块透明画布（容器插槽 absolute:inset:0，pointer-events:none，
 * z-index 低于设置浮层），引擎（client/rain.js）在其中下雨——英文与数字
 * 雨柱倾泻、白炽雨头绿身拖尾。画布本身透明（destination-out 擦除拖尾），
 * 对话内容透过来；canvas.style.opacity 是「雨中看代码」的总旋钮。
 *
 * 挂载方式对齐知识库 dsh-kb / 梦回高三 dsh-gaokao 的「会话列插槽」方案：
 * 容器 div 追加为会话列（[data-pane="conversation"] / [class*="centerCol"] /
 * .dshDesktopConversationSurface，三代壳层选择器同源）末尾子节点，宽高=列尺寸
 * 由浏览器布局给定——侧栏收缩/拖宽即时跟随，不做 JS 测宽、不做布局轮询。
 * 「全屏」区域把画布换成 position:fixed（fixed 不受 relative 祖先影响，仍锚视口）。
 * 探测不到会话列的外来壳层定时重试，雨暂不出现（与 dsh-kb 行为一致）。
 *
 * 设置页（settings.section）：总开关、透明度、速度、密度、字号、配色、
 * 跟随 agent 活动、引擎实时状态。配置经 /dsh-matrix/api/config 读写，
 * 宿主持久化到 storageDomain；活跃度经 EventSource 订阅宿主 SSE
 * （/dsh-matrix/api/stream）抵达：
 *
 *   { kind: 'activity', level } → boost = 1 + 0.3×level（封顶 1.9）
 *     → 引擎内部平滑逼近，雨速呼吸式起伏，亮度微微联动
 *
 * rain.js 由构建脚本内联进本文件所在工厂作用域（bundle 中 createRain /
 * THEMES 为名直接可用）；本文件是动态插件的源真身，client/bundle.js 由
 * npm run build:client 生成。
 */

const LOCALE_NS = 'settings.dshMatrix'

const ZH = {
  nav: '黑客帝国',
  title: '黑客帝国数字雨',
  intro: '对话窗口铺上经典的黑客帝国字符雨背景——英文与数字的雨柱倾泻而下，白炽雨头绿身拖尾，agent 正在生成的 token 原文实时掺进雨里。字符在窗口上流动，代码在雨中生长。',
  enabled: '数字雨',
  enabledHint: '关闭后雨布收起，界面恢复原样。',
  opacity: '透明度',
  opacityHint: '雨布整体不透明度（5%–100%）。越低越像幽灵的低语，越高越是正经矩阵——默认 30% 兼顾氛围与可读性。',
  speed: '下落速度',
  speedHint: '雨柱下落速度倍率（0.3–2.5）。',
  density: '密度',
  densityHint: '雨柱疏密（0.5–2）。密度大于 1 时列距收窄，雨更茂密。',
  fontSize: '字号',
  fontSizeHint: '字符大小（12–24px），决定雨柱粗细与行高。',
  themeDark: '暗色配色',
  themeDarkHint: 'UI 深色时的雨色。经典绿是母体原色；琥珀/青/品红是其它舰船的终端。',
  themeLight: '亮色配色',
  themeLightHint: 'UI 浅色时的雨色——白底上琥珀比纯绿更压得住。切换深浅实时跟随。',
  themeClassic: '经典绿',
  themeAmber: '琥珀',
  themeCyan: '赛博青',
  themeMagenta: '品红',
  region: '显示范围',
  regionHint: '除左侧栏：会话列表保持干净，其余区域下雨（默认）。',
  regionFullscreen: '全屏',
  regionNoLeft: '除左侧栏',
  reactive: '跟随 agent 活动',
  reactiveHint: '事件越频繁、工具越多、token 越多，雨越急越亮（雨速最高 ×1.9）；空闲回落。',
  feed: '雨里掺对话原文',
  feedHint: 'agent 正在流式输出的 token 原文会混进雨柱字符——屏幕上落的就是你自己的对话（默认开）。',
  continuous: '持续下雨',
  continuousHint: '关闭后，对话未开始或已收尾时雨会渐渐停歇；agent 开始干活才落雨。',
  dblClickTip: '双击切换雨布',
  dblClickTipHint: '窗口里双击，随时在清屏与下雨之间切换；输入框内双击选词不触发。',
  clearOffToast: '已清屏 · 双击恢复下雨',
  clearOnToast: '雨已恢复',
  status: '状态',
  statusRaining: '正在下雨',
  statusPaused: '已暂停',
  statusLive: '已连接宿主活动流',
  statusConnecting: '正在连接宿主活动流…',
  statusOff: '未连接（宿主插件未启用或页面刚加载）',
  activityIdle: '母体平静',
  activityBusy: '{level} 个会话活跃',
  engineStats: '雨柱 {columns} 条 · {fps} fps · 帧耗 {frameMs}ms · 画质 {quality} · 倍率 {boost}×',
  loading: '正在加载配置…',
  save: '保存',
  saved: '已保存 ✓',
  retry: '重试',
  reducedMotion: '检测到系统「减弱动态效果」偏好，数字雨已暂停；开启下方「忽略系统减弱动态效果」可强制下雨，或在 系统设置 → 辅助功能 → 显示 中关闭该偏好（需刷新页面）。',
  ignoreReducedMotion: '忽略系统「减弱动态效果」',
  ignoreReducedMotionHint: '开启后即使系统偏好减弱动态效果，也照常下雨。',
}

const EN = {
  nav: 'Matrix Rain',
  title: 'Matrix Digital Rain',
  intro: 'The classic Matrix digital rain as your chat window backdrop — columns of letters and digits pouring down, white-hot heads over green fading trails, with the agent\'s streaming tokens woven into the rain. Characters flow across the window; code grows in the rain.',
  enabled: 'Digital rain',
  enabledHint: 'When off, the rain canvas is hidden entirely.',
  opacity: 'Opacity',
  opacityHint: 'Overall opacity of the rain canvas (5%–100%). Lower is a ghostly whisper, higher is the real Matrix — 30% by default.',
  speed: 'Fall speed',
  speedHint: 'Rain fall speed multiplier (0.3–2.5).',
  density: 'Density',
  densityHint: 'Column density (0.5–2). Above 1 the pitch tightens and the rain gets lush.',
  fontSize: 'Font size',
  fontSizeHint: 'Glyph size (12–24px); sets column thickness and row height.',
  themeDark: 'Dark-mode theme',
  themeDarkHint: 'Rain color while the UI is dark. Classic green is the Matrix; amber/cyan/magenta are other ships’ terminals.',
  themeLight: 'Light-mode theme',
  themeLightHint: 'Rain color while the UI is light — amber holds up better than pure green on white. Follows theme switches live.',
  themeClassic: 'Classic green',
  themeAmber: 'Amber',
  themeCyan: 'Cyber cyan',
  themeMagenta: 'Magenta',
  region: 'Display region',
  regionHint: 'No left rail: keep the session list clean, rain everywhere else (default).',
  regionFullscreen: 'Fullscreen',
  regionNoLeft: 'No left rail',
  reactive: 'Follow agent activity',
  reactiveHint: 'More events, more tool calls, more tokens — faster and brighter rain (up to ×1.9); settles when idle.',
  feed: 'Weave live tokens into the rain',
  feedHint: 'Characters from the agent\'s streaming output fall in the rain — what drips down is your own conversation (on by default).',
  continuous: 'Continuous rain',
  continuousHint: 'When off, the rain drains away while no conversation is running; it starts again as soon as the agent works.',
  dblClickTip: 'Double-click toggle',
  dblClickTipHint: 'Double-click the window to switch between cleared and raining at any time; double-clicking inside inputs won\'t trigger it.',
  clearOffToast: 'Rain cleared · double-click to resume',
  clearOnToast: 'Rain resumed',
  status: 'Status',
  statusRaining: 'Raining',
  statusPaused: 'Paused',
  statusLive: 'Connected to host activity stream',
  statusConnecting: 'Connecting to host activity stream…',
  statusOff: 'Not connected (host plugin disabled or page just loaded)',
  activityIdle: 'The Matrix is calm',
  activityBusy: '{level} active session(s)',
  engineStats: '{columns} columns · {fps} fps · frame {frameMs}ms · quality {quality} · boost {boost}×',
  loading: 'Loading config…',
  save: 'Save',
  saved: 'Saved ✓',
  retry: 'Retry',
  reducedMotion: 'Your system prefers reduced motion — the rain is paused. Turn on "Ignore reduced motion" below to force it, or change the OS accessibility setting (then refresh).',
  ignoreReducedMotion: 'Ignore system "reduce motion"',
  ignoreReducedMotionHint: 'Keep raining even when the OS prefers reduced motion.',
}

const LOCALE_DICT = { zh: ZH, en: EN }
const API = '/dsh-matrix/api'

const THEME_ORDER = ['classic', 'amber', 'cyan', 'magenta']
const THEME_LABEL_KEYS = { classic: 'themeClassic', amber: 'themeAmber', cyan: 'themeCyan', magenta: 'themeMagenta' }

/** 显示范围合法值（宿主 REGIONS 同名键）。 */
const REGION_ORDER = ['no-left', 'fullscreen']
const REGION_LABEL_KEYS = { 'no-left': 'regionNoLeft', fullscreen: 'regionFullscreen' }

/**
 * 显示范围：画布不必铺满全屏。「除左侧栏」= 插槽 absolute:inset:0，恰好铺满
 * 会话列（含高度），侧栏保持干净；「全屏」= 画布 position:fixed 铺满视口
 * （fixed 的包含块是视口，列上的 position:relative 不影响它）。不再有
 * detectMainLeft 测宽路径——列本身就是宽度的唯一真源。
 */

/** 三代壳层的会话列选择器（与 dsh-kb 同源）。 */
const COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"], .dshDesktopConversationSurface'
/** 插槽在位期间挂在 html 上：CSS 借此把会话列设为插槽的定位基准。 */
const LIVE_ATTR = 'data-dsh-matrix-live'

function ensureSlotStyle() {
  if (typeof document === 'undefined' || document.getElementById('dsh-matrix-style')) return
  const st = document.createElement('style')
  st.id = 'dsh-matrix-style'
  st.textContent = [
    `html[${LIVE_ATTR}] [data-pane="conversation"],html[${LIVE_ATTR}] [class*="centerCol"],` +
      `html[${LIVE_ATTR}] .dshDesktopConversationSurface{position:relative}`,
    '[data-dsh-matrix-slot]{position:absolute;inset:0;pointer-events:none}',
  ].join('\n')
  document.head.appendChild(st)
}

// ── 雨布浮层 ─────────────────────────────────────────────────────────────

/**
 * 会话列插槽内的透明画布浮层。pointer-events:none 不挡任何点击；z-index 低于
 * 设置/对话框浮层（2147483000 一带），高于对话内容——雨「飘」在窗口上，
 * 靠透明度与内容共存。
 */
function mountOverlay() {
  ensureSlotStyle()
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-dsh-matrix', '')
  const engine = createRain(canvas, {})
  let region = 'no-left'
  let slot = null

  /** 按区域同步画布定位。保留 display（setEnabled 会临时藏起画布）。
   *  画布是替换元素，必须显式给 CSS 宽高——inset:0 + width:auto 只会用
   *  backing store 的固有尺寸（曾导致画布 1280px 盖住侧栏）。 */
  const syncRegion = () => {
    const display = canvas.style.display
    canvas.style.cssText = (region === 'fullscreen'
      ? 'position:fixed;left:0;top:0;width:100vw;height:100vh;'
      : 'position:absolute;left:0;top:0;width:100%;height:100%;')
      + 'pointer-events:none;z-index:2147482000'
    canvas.style.display = display
    engine.resize()
  }

  // 插槽安放：容器 div 追加为会话列末尾子节点，React 壳层不管理它。
  // 有意不用 MutationObserver 热响应——它与壳层重渲染互相触发会形成微任务级
  // 自旋卡死页面（dsh-gaokao v0.9.1 实测），幂等的定时补位已足够覆盖晚挂载。
  const place = () => {
    if (slot && slot.isConnected) return
    const column = document.querySelector(COLUMN_SELECTOR)
    if (!column) return
    try { if (slot) slot.remove() } catch {}
    slot = document.createElement('div')
    slot.setAttribute('data-dsh-matrix-slot', '')
    slot.appendChild(canvas)
    column.appendChild(slot)
    document.documentElement.setAttribute(LIVE_ATTR, '')
    syncRegion()
  }
  place()
  const timers = [200, 600, 1500].map((ms) => setTimeout(place, ms))
  const retry = setInterval(place, 2000)

  const applyRegion = (r) => {
    region = REGION_ORDER.includes(r) ? r : 'no-left'
    syncRegion()
  }
  applyRegion(region)

  const onVisibility = () => engine.setEnabled(!document.hidden && overlayEnabled)
  document.addEventListener('visibilitychange', onVisibility)

  // 画布盒子一变（窗口缩放/侧栏折叠/区域切换）就重排引擎：RO 盯画布自身，
  // 精确且零空转——不再监听 window resize、不再观察 html/body、不再轮询。
  let ro = null
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => engine.resize())
    ro.observe(canvas)
  }

  let overlayEnabled = true
  return {
    engine,
    setEnabled(v) {
      overlayEnabled = !!v
      engine.setEnabled(overlayEnabled && !document.hidden)
      canvas.style.display = overlayEnabled ? '' : 'none'
    },
    setRegion: applyRegion,
    dispose() {
      timers.forEach(clearTimeout)
      clearInterval(retry)
      if (ro) ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      try { document.documentElement.removeAttribute(LIVE_ATTR) } catch {}
      try { if (slot) slot.remove() } catch {}
      engine.dispose()
    },
  }
}

// ── 设置页 ───────────────────────────────────────────────────────────────

function MatrixPanel({ t }) {
  const h = React.createElement
  const [config, setConfig] = React.useState(null)
  const [loadError, setLoadError] = React.useState(false)
  const [savedTick, setSavedTick] = React.useState(false)
  const [liveState, setLiveState] = React.useState('connecting')
  const [activity, setActivity] = React.useState(0)
  const [stats, setStats] = React.useState(null)

  const load = React.useCallback(() => {
    setLoadError(false)
    fetch(API + '/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((cfg) => setConfig(cfg))
      .catch(() => setLoadError(true))
  }, [])

  React.useEffect(() => { load() }, [load])

  // 引擎状态轮询（连接状态 + 活跃度 + 雨柱统计），1s 一次
  React.useEffect(() => {
    const timer = setInterval(() => {
      const rt = window.__dshMatrix
      if (rt) {
        setLiveState(rt.liveState())
        setActivity(rt.activity())
        setStats(rt.stats())
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const save = (next) => {
    setConfig(next)
    fetch(API + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).then((r) => {
      if (!r.ok) throw new Error('bad status')
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1500)
      if (window.__dshMatrix) window.__dshMatrix.applyConfig(next)
    }).catch(() => load()) // 保存失败不假装成功：回读宿主真实配置，面板弹回真实状态
  }

  if (config === null && !loadError) return h('p', { style: { opacity: 0.7 } }, t('loading'))
  if (loadError && config === null) {
    return h('div', null,
      h('p', { style: { color: 'var(--dsw-alias-label-error, #e06c75)' } }, t('statusOff')),
      h('button', { type: 'button', onClick: load }, t('retry')))
  }

  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const row = { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.15))' }
  const label = { flex: 1, fontSize: '13px' }
  const hint = { display: 'block', opacity: 0.6, fontSize: '12px', marginTop: '2px' }
  const num = { fontSize: '12px', minWidth: '38px', textAlign: 'right' }

  const sliderRow = (key, labelKey, hintKey, min, max, step, fmt) => h('div', { style: row },
    h('span', { style: label }, t(labelKey), h('span', { style: hint }, t(hintKey))),
    h('input', {
      type: 'range', min, max, step, value: config[key],
      onChange: (e) => save(Object.assign({}, config, { [key]: Number(e.target.value) })),
    }),
    h('code', { style: num }, fmt(config[key])))

  // 深浅各自配色：两个下拉共用一套主题选项
  const themeRow = (key, labelKey, hintKey) => h('div', { style: row },
    h('span', { style: label }, t(labelKey), h('span', { style: hint }, t(hintKey))),
    h('select', {
      value: config[key] || 'classic',
      style: { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))', background: 'transparent', color: 'inherit' },
      onChange: (e) => save(Object.assign({}, config, { [key]: e.target.value })),
    },
      THEME_ORDER.map((name) => h('option', { key: name, value: name }, t(THEME_LABEL_KEYS[name])))))
  const themeRows = h('div', null,
    themeRow('themeDark', 'themeDark', 'themeDarkHint'),
    themeRow('themeLight', 'themeLight', 'themeLightHint'))

  return h('div', { style: { maxWidth: '560px' } },
    h('p', { style: { opacity: 0.75, fontSize: '13px', lineHeight: 1.6 } }, t('intro')),

    reducedMotion && !config.ignoreReducedMotion && h('p', { style: { color: 'var(--dsw-alias-label-warning, #d19a66)', fontSize: '12px' } }, t('reducedMotion')),

    // 总开关
    h('div', { style: row },
      h('span', { style: label }, t('enabled'), h('span', { style: hint }, t('enabledHint'))),
      h('input', {
        type: 'checkbox', checked: !!config.enabled,
        onChange: (e) => save(Object.assign({}, config, { enabled: e.target.checked })),
      })),

    // 忽略系统「减弱动态效果」
    h('div', { style: row },
      h('span', { style: label }, t('ignoreReducedMotion'), h('span', { style: hint }, t('ignoreReducedMotionHint'))),
      h('input', {
        type: 'checkbox', checked: !!config.ignoreReducedMotion,
        onChange: (e) => save(Object.assign({}, config, { ignoreReducedMotion: e.target.checked })),
      })),

    // 跟随 agent 活动
    h('div', { style: row },
      h('span', { style: label }, t('reactive'), h('span', { style: hint }, t('reactiveHint'))),
      h('input', {
        type: 'checkbox', checked: config.reactive !== false,
        onChange: (e) => save(Object.assign({}, config, { reactive: e.target.checked })),
      })),

    // 雨里掺对话原文
    h('div', { style: row },
      h('span', { style: label }, t('feed'), h('span', { style: hint }, t('feedHint'))),
      h('input', {
        type: 'checkbox', checked: config.feed !== false,
        onChange: (e) => save(Object.assign({}, config, { feed: e.target.checked })),
      })),

    // 持续下雨
    h('div', { style: row },
      h('span', { style: label }, t('continuous'), h('span', { style: hint }, t('continuousHint'))),
      h('input', {
        type: 'checkbox', checked: config.continuous !== false,
        onChange: (e) => save(Object.assign({}, config, { continuous: e.target.checked })),
      })),

    // 双击切换（纯提示，无控件）
    h('div', { style: row },
      h('span', { style: label }, t('dblClickTip'), h('span', { style: hint }, t('dblClickTipHint')))),

    // 透明度 —— 主角旋钮
    sliderRow('opacity', 'opacity', 'opacityHint', 0.05, 1, 0.05, (v) => Math.round(v * 100) + '%'),
    // 速度 / 密度 / 字号
    sliderRow('speed', 'speed', 'speedHint', 0.3, 2.5, 0.1, (v) => v.toFixed(1) + '×'),
    sliderRow('density', 'density', 'densityHint', 0.5, 2, 0.1, (v) => v.toFixed(1) + '×'),
    sliderRow('fontSize', 'fontSize', 'fontSizeHint', 12, 24, 1, (v) => v + 'px'),

    // 深浅各自配色（两个下拉共用一套主题选项）
    themeRows,

    // 显示范围
    h('div', { style: row },
      h('span', { style: label }, t('region'), h('span', { style: hint }, t('regionHint'))),
      h('select', {
        value: config.region || 'no-left',
        style: { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))', background: 'transparent', color: 'inherit' },
        onChange: (e) => save(Object.assign({}, config, { region: e.target.value })),
      },
        REGION_ORDER.map((name) => h('option', { key: name, value: name }, t(REGION_LABEL_KEYS[name]))))),

    // 状态
    h('h4', { style: { margin: '18px 0 4px', fontSize: '13px' } }, t('status')),
    h('p', { style: { fontSize: '12px', opacity: 0.75 } },
      stats && stats.running ? '🟢 ' + t('statusRaining') : '⚫ ' + t('statusPaused'),
      ' · ',
      liveState === 'live' ? '🟢 ' + t('statusLive')
        : liveState === 'connecting' ? '🟡 ' + t('statusConnecting')
        : '🔴 ' + t('statusOff')),
    config.reactive !== false && h('p', { style: { fontSize: '12px', opacity: 0.75 } },
      activity > 0 ? '🌧️ ' + t('activityBusy', { level: activity }) : '☁️ ' + t('activityIdle')),
    stats && h('p', { style: { fontSize: '12px', opacity: 0.6 } },
      t('engineStats', { columns: stats.columns, fps: stats.fps, frameMs: stats.frameMs, quality: stats.quality, boost: stats.boost })),
    savedTick && h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-success, #5cd6a8)' } }, t('saved')))
}

// ── 插件入口 ─────────────────────────────────────────────────────────────

module.exports = {
  name: '@weibaohui/dsh-matrix',
  inject: ['slots', 'locale'],

  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const locale = ctx.get('locale')
    // locale.bind 只做查表，{var} 插值自承（dsh-flow 同款包裹）；
    // 服务缺席时落到内置中文表，最差也只见中文不见裸 key。
    const tRaw = locale && typeof locale.bind === 'function' ? locale.bind(LOCALE_NS) : null
    const t = (key, vars) => {
      let out = (tRaw && tRaw(key)) || ZH[key] || key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    }
    if (locale && typeof locale.register === 'function') {
      ctx.effect(() => locale.register(LOCALE_NS, LOCALE_DICT))
    }

    // ── 雨布浮层 + 引擎 ────────────────────────────────────────────────
    const overlay = mountOverlay()
    ctx.effect(() => () => overlay.dispose(), 'dsh-matrix: overlay')

    // ── 深浅主题自适应（事件驱动，无轮询）───────────────────────────────
    // 主判据走 dsh 官方主题属性（html[data-ds-theme-source] / body[data-ds-dark-theme]），
    // 属性缺席才回退烟花同款 elementFromPoint 采样；MutationObserver 即时跟随
    // 宿主切主题，matchMedia 兜住 system 模式下的系统深浅切换。
    let tone = 'dark'
    const applyTheme = () => {
      if (!currentConfig) return
      overlay.engine.setTheme(tone === 'light'
        ? (typeof currentConfig.themeLight === 'string' ? currentConfig.themeLight : 'amber')
        : (typeof currentConfig.themeDark === 'string' ? currentConfig.themeDark : 'classic'))
    }
    const detectTone = () => {
      try {
        const root = document.documentElement
        const body = document.body
        const source = (root.getAttribute('data-ds-theme-source') || '').toLowerCase()
        if (source === 'dark') return 'dark'
        if (source === 'light') return 'light'
        if (body && body.hasAttribute('data-ds-dark-theme')) return 'dark'
        let el = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight * 0.55))
        let guard = 0
        while (el && guard++ < 12) {
          const bg = getComputedStyle(el).backgroundColor
          const m = bg && bg.match(/rgba?\(([^)]+)\)/)
          if (m) {
            const parts = m[1].split(',').map((s) => Number(s.trim()))
            const [r, g, b] = parts
            const a = parts.length > 3 ? parts[3] : 1
            if (Number.isNaN(r) || a === 0) { el = el.parentElement; continue }
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? 'light' : 'dark'
          }
          el = el.parentElement
        }
      } catch { /* 采样失败保持当前色调 */ }
      return tone
    }
    const applyTone = () => {
      const next = detectTone()
      if (next !== tone) {
        tone = next
        applyTheme()
      }
    }
    applyTone()
    try {
      const toneMo = new MutationObserver(applyTone)
      toneMo.observe(document.documentElement, { attributes: true })
      if (document.body) toneMo.observe(document.body, { attributes: true })
      const toneMq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
      if (toneMq && toneMq.addEventListener) toneMq.addEventListener('change', applyTone)
      ctx.effect(() => () => {
        toneMo.disconnect()
        if (toneMq && toneMq.removeEventListener) toneMq.removeEventListener('change', applyTone)
      }, 'dsh-matrix: tone')
    } catch { /* 保留挂载时探测结果 */ }

    // ── 配置装载 ───────────────────────────────────────────────────────
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    let currentConfig = null   // 活动流回调要读 reactive 开关
    let activityLevel = 0
    let activityIntensity = 0  // 0..1：token 吞吐 + 工具频次 + 会话数加权
    let dblCleared = false    // 双击切换：true = 已清屏（手动挡，再双击恢复）
    let needReset = false     // 恢复下雨时要重布雨柱（预滚动回满屏）

    const applyBoost = () => {
      const reactive = !currentConfig || currentConfig.reactive !== false
      const intensity = reactive ? Math.min(1, Math.max(0, activityIntensity)) : 0
      // 雨速 ×1..1.9，亮度联动由引擎按 boost 上浮（越忙越亮）
      overlay.engine.setBoost(1 + 0.9 * intensity)
    }

    /** 所有状态入口（配置/活动流/双击清屏/定时恢复）都汇到这里裁决。 */
    const applyAll = () => {
      const cfg = currentConfig || {}
      const masterOn = cfg.enabled !== false
      const allowMotion = !reducedMotion || cfg.ignoreReducedMotion === true
      const continuous = cfg.continuous !== false
      const active = activityIntensity > 0 || activityLevel > 0
      const visible = masterOn && allowMotion && !dblCleared
      overlay.setEnabled(visible)
      // 持续下雨关闭且当前没活动 → 排空模式：雨渐渐停歇，拖尾排净自动停机
      overlay.engine.setFlowing(!dblCleared && (continuous || active))
      if (visible && needReset) {
        needReset = false
        overlay.engine.reset()
      }
    }

    const applyConfig = (cfg) => {
      if (!cfg || typeof cfg !== 'object') return
      currentConfig = cfg
      overlay.engine.setOpacity(typeof cfg.opacity === 'number' ? cfg.opacity : 0.3)
      overlay.engine.setSpeed(typeof cfg.speed === 'number' ? cfg.speed : 1)
      overlay.engine.setDensity(typeof cfg.density === 'number' ? cfg.density : 1.3)
      overlay.engine.setFontSize(typeof cfg.fontSize === 'number' ? cfg.fontSize : 16)
      overlay.setRegion(typeof cfg.region === 'string' ? cfg.region : 'no-left')
      overlay.engine.setFeed(cfg.feed !== false)
      applyTheme()
      applyBoost()
      applyAll()
    }
    fetch(API + '/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => applyConfig(cfg || {}))
      .catch(() => applyConfig({}))

    // ── SSE 活动流：level → boost（雨随 agent 忙闲起伏）─────────────────
    let es = null
    let liveState = 'connecting'
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(API + '/stream')
      es.onopen = () => { liveState = 'live' }
      es.onerror = () => { liveState = 'connecting' } // EventSource 自动重连
      es.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data)
          if (ev && ev.kind === 'activity') {
            if (typeof ev.level === 'number') activityLevel = Math.max(0, ev.level)
            if (typeof ev.intensity === 'number') activityIntensity = Math.min(1, Math.max(0, ev.intensity))
            else if (typeof ev.level === 'number') activityIntensity = Math.min(1, activityLevel / 3) // 旧宿主兜底
            applyBoost()
            applyAll()
          } else if (ev && ev.kind === 'text' && typeof ev.text === 'string') {
            // agent 流式输出的 token 原文 → 掺进雨柱字符池
            overlay.engine.pushText(ev.text)
          }
        } catch { /* 坏帧忽略 */ }
      }
    }
    ctx.effect(() => () => { if (es) try { es.close() } catch {} }, 'dsh-matrix: sse')

    // ── 双击切换：下雨中双击清屏，清屏中双击恢复下雨 ────────────────────
    const toastEl = document.createElement('div')
    toastEl.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482400;pointer-events:none;' +
      'padding:8px 14px;border-radius:10px;font-size:12px;color:#d7ffe0;background:rgba(8,20,12,.85);' +
      'border:1px solid rgba(0,255,65,.35);opacity:0;transition:opacity .4s'
    document.body.appendChild(toastEl)
    let toastTimer = null
    const showToast = (text) => {
      toastEl.textContent = text
      toastEl.style.opacity = '1'
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { toastEl.style.opacity = '0' }, 1800)
    }
    const onDblClick = (e) => {
      const t2 = e && e.target
      if (t2 && typeof t2.closest === 'function' && t2.closest('input, textarea, select, [contenteditable="true"]')) return
      dblCleared = !dblCleared
      if (!dblCleared) needReset = true
      applyAll()
      showToast(dblCleared ? t('clearOffToast') : t('clearOnToast'))
    }
    document.addEventListener('dblclick', onDblClick)
    ctx.effect(() => () => {
      document.removeEventListener('dblclick', onDblClick)
      if (toastTimer) clearTimeout(toastTimer)
      toastEl.remove()
    }, 'dsh-matrix: dblclick toggle')

    // ── 调试入口 ───────────────────────────────────────────────────────
    window.__dshMatrix = {
      applyConfig,
      boost: (level) => { activityLevel = Math.max(0, Number(level) || 0); applyBoost() },
      stats: () => overlay.engine.stats(),
      liveState: () => liveState,
      activity: () => activityLevel,
      intensity: () => activityIntensity,
      tone: () => tone,
    }
    ctx.effect(() => () => { try { delete window.__dshMatrix } catch {} }, 'dsh-matrix: debug api')

    // ── 设置页 ─────────────────────────────────────────────────────────
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: '@weibaohui/dsh-matrix',
        order: 33,
        label: () => t('nav'),
        locale: LOCALE_NS,
      },
      () => React.createElement(MatrixPanel, { t })
    ))
  },
}
