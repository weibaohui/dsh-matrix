'use strict'

/**
 * dsh-matrix — 数字雨引擎（Canvas2D，零依赖）
 *
 * 经典黑客帝国配方：
 *   · 英文大写 + 数字 + 符号字符集（纯拉丁，无任何日文假名）
 *   · 每列一条雨柱，独立速度、独立亮度（tone），离屏错落起跑
 *   · 雨头白炽（head），身后一格染回主题色（body）——白头绿身
 *   · 同列相邻字符永不重复（AAA/666 是廉价感的来源）
 *   · 拖尾用 destination-out 逐帧擦除「攒」出来：画布永远透明，
 *     对话内容透过来，透明度由 canvas.style.opacity 整体控制
 *   · 偶发在拖尾区随机重写一格（trail flicker），模拟字符闪烁
 *   · 约 1/3 雨头字符来自 agent 正在流式输出的 token 原文（feed），
 *     宿主经 SSE 推来，屏幕上落的就是你自己的对话
 *
 * 性能（dsh-fireworks 843a49c 同款思路）：
 *   · 渲染分辨率封顶：DPR 1.5 + 长边 2400，Retina 屏光栅像素省 5 倍起
 *     （ glyphs 由 CSS 线性放大，雨柱本就柔和，无感）
 *   · 30fps 节流：雨是离散行步进，30fps 足够顺滑；擦除/落笔全员减半
 *   · 字形图集：字符按主题色预渲染进离屏 atlas，运行期 drawImage 贴图，
 *     不再逐字 fillText（文本塑形只发生一次）
 *   · 两遍批量落笔：先全体雨身、后全体雨头，fillStyle 状态切换每帧两次
 *   · 自适应画质：帧率撑不住时先关拖尾闪烁、再降 24fps，恢复后自动回升
 *   · 帧率无关：擦除比例按 dt 折算（1 - 0.1^(dt/TRAIL_MS)），拖尾等长
 *
 * 纯函数（GLYPHS / THEMES / columnCount）导出供 node 离线测试；
 * createRain 仅在浏览器侧被 bundle 内联调用。
 */

/** 字符集：纯英文大写 + 数字 + 符号——不含任何日文假名。 */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$+-*/=#%&<>@!?|~^'

const GLYPH_INDEX = new Map(GLYPHS.split('').map((ch, i) => [ch, i]))

/**
 * 随机取一个与 prev 不同的下标：同一列相邻字符永不重复，
 * 满屏 AAA/666 的粗制滥造感就是这么来的。
 */
function nextIndex(prev, len) {
  if (len <= 1) return 0
  return (prev + 1 + ((Math.random() * (len - 1)) | 0)) % len
}

/** 拉丁大写化（喂入的对话原文统一进字符池的形态）。 */
function upperLatin(ch) {
  const c = ch.charCodeAt(0)
  return c >= 97 && c <= 122 ? String.fromCharCode(c - 32) : ch
}

/** 配色主题：head 白炽雨头 / body 雨身。 */
const THEMES = {
  classic: { head: '#e8ffe8', body: '#00ff41' },
  amber:   { head: '#fff3d0', body: '#ffb000' },
  cyan:    { head: '#e0ffff', body: '#00e5ff' },
  magenta: { head: '#ffe0f7', body: '#ff2fd6' },
}

/** 字体栈：等宽优先，半角假名宽度约为字号一半，列距自然疏朗。 */
const FONT_STACK = '"SF Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace'

/** 拖尾时长基准 ms（衰减到 10% 所需时间）——拉长让雨柱垂满屏高。 */
const TRAIL_MS = 4000
/** 排空停机：水流关闭后再擦这么久即视为干净，rAF 收摊。 */
const DRAIN_MS = TRAIL_MS + 800

/** 雨柱速度区间（行/秒），配置 speed 为其倍率。 */
const ROWS_PER_SEC_MIN = 7
const ROWS_PER_SEC_SPAN = 11

/** 拖尾闪烁概率（每步进一格时）。 */
const TRAIL_FLICKER_P = 0.15
const TRAIL_FLICKER_ROWS = 20

/** 单帧 dt 上限 ms（tab 切回不至于一整帧擦掉全部拖尾）。 */
const DT_CAP_MS = 100

/** 预滚动：布局后先离线模拟这么久，雨一打开就是稳态满屏，不从空屏渐显。 */
const PRE_ROLL_MS = 6000
const PRE_ROLL_STEP_MS = 33

// ── 性能常量 ─────────────────────────────────────────────────────────────

/** 渲染分辨率：DPR 封顶 1.5、backing 长边封顶 2400（烟花同款），CSS 放大无感。 */
const MAX_DPR = 1.5
const LONG_EDGE_CAP = 2400

/** 帧率档位：常态 30fps，低画质 24fps（雨的离散步进对帧率不敏感）。 */
const FRAME_MS_NORMAL = 33
const FRAME_MS_LOW = 42

/** 自适应画质阈值：帧率 EMA 低于 26（撑不住 30fps）降质，回到 29 以上回升。 */
const Q_DEGRADE_FPS = 26
const Q_RECOVER_FPS = 29
const Q_LOW = 0.6   // 低于此值：降帧率档
const Q_FLICKER = 0.8 // 低于此值：关拖尾闪烁

/** boost（活动跟随）平滑时间常数 ms：雨速呼吸感而非突变。 */
const BOOST_SMOOTH_MS = 400

/** 列数：pitch = fontSize / density；density > 1 列距收窄、雨更密。 */
function columnCount(width, fontSize, density) {
  const pitch = fontSize / Math.max(0.5, density || 1)
  return Math.max(1, Math.round(width / pitch))
}

function randGlyphIdx() {
  return (Math.random() * GLYPHS.length) | 0
}

// 对话原文进雨的参数：约 1/3 的雨头字符来自 agent 正在生成的 token，
// 混合比例足够「雨里能认出你在聊什么」，又不至于喧宾夺主
const FEED_P = 0.35
const FEED_CAP = 1024
const FEED_MIN = 16

function createRain(canvas, options) {
  // desynchronized：跳过合成器双缓冲等待，Chrome 系有效，他处忽略
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
  const cfg = {
    speed: 1,
    density: 1.3,
    fontSize: 16,
    theme: 'classic',
  }
  if (options && typeof options === 'object') {
    for (const k of Object.keys(cfg)) {
      if (options[k] !== undefined) cfg[k] = options[k]
    }
  }

  let running = false
  let wantRun = false   // 宿主（客户端）要它跑
  let flowing = true    // 水流开关：false = 排空模式（只擦不落）
  let drainStart = 0
  let raf = 0
  let lastRender = 0
  let fpsEma = 0
  let frameMsEma = 0
  let quality = 1
  let columns = []
  let w = 0
  let h = 0
  let rows = 0
  let scale = 1 // CSS px → backing px

  // ── 字形图集 ───────────────────────────────────────────────────────────
  // GLYPHS.length 列 × 2 行（上 body 下 head）的离屏画布；tile 边长随
  // 字号 × 渲染分辨率。字号/主题/分辨率变化时重建，运行期只 drawImage。
  let atlas = null
  let tile = 0   // backing px
  let tileCss = 0 // CSS px（drawImage 目标尺寸）

  // ── boost（跟随 agent 活动）：内部平滑逼近目标值 ────────────────────────
  let boostTarget = 1
  let boostCurrent = 1
  let baseOpacity = 0.3
  let shownOpacity = -1

  const theme = () => THEMES[cfg.theme] || THEMES.classic

  function buildAtlas() {
    if (typeof document === 'undefined') return
    const fs = Math.round(cfg.fontSize * scale)
    const pad = Math.ceil(fs * 0.25)
    tile = fs + pad * 2
    tileCss = tile / scale
    atlas = document.createElement('canvas')
    atlas.width = tile * GLYPHS.length
    atlas.height = tile * 2
    const ac = atlas.getContext('2d')
    if (!ac) { atlas = null; return }
    ac.font = fs + 'px ' + FONT_STACK
    ac.textAlign = 'center'
    ac.textBaseline = 'middle'
    const t = theme()
    for (let i = 0; i < GLYPHS.length; i += 1) {
      ac.fillStyle = t.body
      ac.fillText(GLYPHS[i], i * tile + tile / 2, tile / 2)
      ac.fillStyle = t.head
      ac.fillText(GLYPHS[i], i * tile + tile / 2, tile + tile / 2)
    }
  }

  // ── 对话原文进雨（feed）：宿主 SSE 推来 agent 流式输出的 token 文本，
  //    只留字符池里存在的拉丁字符，环形缓冲循环取用 ─────────────────────
  const feed = []
  let feedHead = 0
  let feedOn = true

  function pushText(text) {
    if (!text) return
    for (const ch of String(text)) {
      const up = upperLatin(ch)
      if (GLYPH_INDEX.has(up)) feed.push(up)
    }
    if (feed.length > FEED_CAP) {
      const cut = feed.length - FEED_CAP
      feed.splice(0, cut)
      feedHead = Math.max(0, feedHead - cut)
    }
  }

  /**
   * 下一格雨头字符：概率走对话原文（跳过与当前相同的），否则随机且必异
   * 于当前——同列相邻字符永不相同。
   */
  function nextGlyphIdx(cur) {
    if (feedOn && feed.length >= FEED_MIN && Math.random() < FEED_P) {
      for (let i = 0; i < 6; i += 1) {
        if (feedHead >= feed.length) feedHead = 0
        const gi = GLYPH_INDEX.get(feed[feedHead])
        feedHead += 1
        if (gi !== undefined && gi !== cur) return gi
      }
    }
    return nextIndex(cur, GLYPHS.length)
  }

  /** 重布雨柱：尺寸/字号/密度变化时整体重生（起跑行随机负偏移，雨柱错落）。 */
  function layout() {
    rows = Math.max(1, Math.ceil(h / cfg.fontSize))
    const n = columnCount(w, cfg.fontSize, cfg.density)
    const pitch = w / n
    columns = []
    for (let i = 0; i < n; i += 1) {
      columns.push({
        x: i * pitch + pitch / 2,
        y: -Math.random() * rows,
        lastRow: -1,
        glyph: randGlyphIdx(),
        rowsPerSec: ROWS_PER_SEC_MIN + Math.random() * ROWS_PER_SEC_SPAN,
        tone: 0.55 + Math.random() * 0.45, // 列亮度，景深层次
      })
    }
    // 预滚动到稳态：雨布首次可见时已是满屏雨，不留「从空屏渐显」的入口期
    for (let t = 0; t < PRE_ROLL_MS; t += PRE_ROLL_STEP_MS) step(PRE_ROLL_STEP_MS)
  }

  function resize() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    const cssW = canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0) || 1
    const cssH = canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0) || 1
    // 渲染分辨率封顶：DPR ≤1.5 且 backing 长边 ≤2400，Retina 屏像素数省 5 倍起；
    // 0.4 兜底防超宽窗把字形压成浆糊
    const nextScale = Math.max(0.4, Math.min(MAX_DPR, dpr, LONG_EDGE_CAP / Math.max(cssW, cssH)))
    // 去重：尺寸没变不重布局（ResizeObserver/轮询会频繁进来，重布局含 6s 预滚动，不能白跑）
    if (cssW === w && cssH === h && nextScale === scale) return
    w = cssW
    h = cssH
    scale = nextScale
    canvas.width = Math.max(2, Math.round(cssW * scale))
    canvas.height = Math.max(2, Math.round(cssH * scale))
    if (ctx) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
    }
    buildAtlas()
    layout()
  }

  /** 拖尾擦除：destination-out 只减 alpha，画布保持透明，对话透过来。 */
  function erase(dt) {
    const k = 1 - Math.pow(0.1, dt / TRAIL_MS)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(0,0,0,' + k.toFixed(4) + ')'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 推进 dt 毫秒并落笔（帧循环与预滚动共用）。两遍批量：先雨后头。 */
  function step(dt) {
    if (!ctx || dt <= 0) return
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    erase(dt)

    const fs = cfg.fontSize
    const dtSec = dt / 1000
    const effSpeed = cfg.speed * boostCurrent
    const flicker = quality >= Q_FLICKER
    const padCss = (tileCss - fs) / 2
    const heads = []

    // 第一遍：步进 + 雨身。上一雨头到新雨头之间的每一格都落字（快速雨柱
    // 一帧跨多行时也不留空洞），雨头原格染回雨身色——白头绿身交接
    for (const col of columns) {
      col.y += col.rowsPerSec * effSpeed * dtSec
      const row = Math.floor(col.y)
      if (row <= col.lastRow) continue

      if (atlas && row >= 0) {
        const start = Math.max(col.lastRow, 0)
        const end = Math.min(row, rows - 1)
        ctx.globalAlpha = col.tone
        for (let r = start; r <= end; r += 1) {
          if (r !== col.lastRow) col.glyph = nextGlyphIdx(col.glyph)
          ctx.drawImage(atlas, col.glyph * tile, 0, tile, tile,
            col.x - tileCss / 2, r * fs - padCss, tileCss, tileCss)
        }
      }

      col.lastRow = row
      if (row >= 0 && row < rows) {
        heads.push(col)

        // 拖尾闪烁：随机重写拖尾区一格，雨柱内部字符像在跳动
        if (flicker && Math.random() < TRAIL_FLICKER_P && atlas) {
          const back = 1 + ((Math.random() * TRAIL_FLICKER_ROWS) | 0)
          const fr = row - back
          if (fr >= 0 && fr < rows) {
            ctx.globalAlpha = col.tone * 0.6
            ctx.drawImage(atlas, nextGlyphIdx(col.glyph) * tile, 0, tile, tile,
              col.x - tileCss / 2, fr * fs - padCss, tileCss, tileCss)
          }
        }
      }

      // 整条雨柱（含拖尾余量）落出底边后回顶部重生
      if (row > rows + TRAIL_FLICKER_ROWS + 4) {
        col.y = -Math.random() * rows * 0.5
        col.lastRow = -1
        col.glyph = nextGlyphIdx(col.glyph)
        col.rowsPerSec = ROWS_PER_SEC_MIN + Math.random() * ROWS_PER_SEC_SPAN
        col.tone = 0.55 + Math.random() * 0.45
      }
    }

    // 第二遍：雨头白炽（压在所有雨身之上）
    for (const col of heads) {
      if (!atlas) break
      ctx.globalAlpha = Math.min(1, col.tone + 0.3)
      ctx.drawImage(atlas, col.glyph * tile, tile, tile, tile,
        col.x - tileCss / 2, col.lastRow * fs - padCss, tileCss, tileCss)
    }
    ctx.globalAlpha = 1

    if (t0) {
      const cost = performance.now() - t0
      frameMsEma = frameMsEma === 0 ? cost : frameMsEma * 0.92 + cost * 0.08
    }
  }

  /** boost 平滑 + 透明度联动（活动越忙，雨越密越亮一丝）。 */
  function applyBoost(dt) {
    if (boostCurrent !== boostTarget) {
      const k = Math.min(1, dt / BOOST_SMOOTH_MS)
      boostCurrent += (boostTarget - boostCurrent) * k
      if (Math.abs(boostTarget - boostCurrent) < 0.01) boostCurrent = boostTarget
    }
    // boost 1 → ×1；boost 1.9 → ×1.18：越忙雨越亮，空闲回到基准透明度
    const eff = Math.min(1, Math.max(0.05, baseOpacity * (0.8 + 0.2 * boostCurrent)))
    if (Math.abs(eff - shownOpacity) > 0.005) {
      shownOpacity = eff
      canvas.style.opacity = eff.toFixed(3)
    }
  }

  /** 自适应画质：撑不住目标帧率先关闪烁、再降帧档；宽裕后回升。 */
  function adaptQuality() {
    if ((fpsEma > 0 && fpsEma < Q_DEGRADE_FPS) || frameMsEma > 10) {
      quality = Math.max(0.5, quality - 0.05)
    } else if (quality < 1 && fpsEma > Q_RECOVER_FPS && frameMsEma < 6) {
      quality = Math.min(1, quality + 0.02)
    }
  }

  /** 按需启停 rAF：wantRun 且未超排空期限才转。 */
  function sync() {
    if (wantRun && !running) {
      running = true
      lastRender = 0
      raf = requestAnimationFrame(frame)
    } else if (!wantRun && running) {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
  }

  function frame(now) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const budget = quality < Q_LOW ? FRAME_MS_LOW : FRAME_MS_NORMAL
    if (lastRender !== 0 && now - lastRender < budget - 2) return // 30fps 节流
    const dt = Math.min(DT_CAP_MS, lastRender === 0 ? budget : now - lastRender)
    lastRender = now
    if (dt > 0) {
      const fps = 1000 / dt
      fpsEma = fpsEma === 0 ? fps : fpsEma * 0.9 + fps * 0.1
    }
    applyBoost(dt)
    if (flowing) {
      step(dt)
      adaptQuality()
    } else {
      // 排空：只擦不落，拖尾淡尽后自动停机
      erase(dt)
      if (drainStart > 0 && now - drainStart > DRAIN_MS) {
        running = false
        cancelAnimationFrame(raf)
        raf = 0
      }
    }
  }

  function setEnabled(v) {
    wantRun = !!v
    sync()
  }

  /**
   * 水流开关（持续下雨）：false 时雨柱停止步进，只做擦除排空——雨渐渐
   * 停歇，拖尾排干净后自动停机省电；true 恢复落雨。
   */
  function setFlowing(v) {
    const next = !!v
    if (next === flowing) return
    flowing = next
    if (!flowing) drainStart = typeof performance !== 'undefined' ? performance.now() : 0
    sync()
  }

  /** 立即清屏并停机（双击清屏）。 */
  function stopAndClear() {
    wantRun = false
    sync()
    if (ctx) ctx.clearRect(0, 0, w, h)
  }

  /** 重布雨柱并预滚动到满屏稳态（清屏恢复时用，避免半空续雨）。 */
  function reset() {
    layout()
  }

  resize()
  // 预滚动已落笔的画布从创建起就带基准透明度，不等第一帧（防页面加载时全亮一闪）
  canvas.style.opacity = String(baseOpacity)
  shownOpacity = baseOpacity

  return {
    resize,
    setEnabled,
    setFlowing,
    stopAndClear,
    reset,
    /** 画布整体透明度基准值：雨中看代码的总旋钮（0.05..1）。 */
    setOpacity(v) {
      baseOpacity = Math.min(1, Math.max(0.05, Number(v) || 0))
      shownOpacity = -1 // 强制下一帧重写 style
    },
    setSpeed(v) { cfg.speed = Math.min(2.5, Math.max(0.3, Number(v) || 1)) },
    setDensity(v) {
      const next = Math.min(2, Math.max(0.5, Number(v) || 1))
      if (next === cfg.density) return
      cfg.density = next
      layout()
    },
    setFontSize(v) {
      const next = Math.min(24, Math.max(12, Math.round(Number(v) || 16)))
      if (next === cfg.fontSize) return
      cfg.fontSize = next
      buildAtlas()
      layout()
    },
    setTheme(name) {
      if (!THEMES[name] || cfg.theme === name) return
      cfg.theme = name
      buildAtlas()
    },
    /** 活动跟随：目标倍率 1..1.9，引擎内部平滑逼近，联动速度+一丝透明度。 */
    setBoost(v) {
      boostTarget = Math.min(1.9, Math.max(1, Number(v) || 1))
    },
    /** 喂入对话原文：agent 流式 token 文本，非字符池字符自动丢弃。 */
    pushText,
    /** 开关对话原文掺雨（设置页「雨里掺对话原文」）。 */
    setFeed(v) { feedOn = !!v },
    stats() {
      return {
        columns: columns.length,
        fps: Math.round(fpsEma),
        frameMs: Math.round(frameMsEma * 100) / 100,
        quality: Math.round(quality * 100) / 100,
        boost: Math.round(boostCurrent * 100) / 100,
        scale: Math.round(scale * 100) / 100,
        running,
      }
    },
    dispose() {
      setEnabled(false)
      if (ctx) ctx.clearRect(0, 0, w, h)
      columns = []
      atlas = null
    },
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createRain, GLYPHS, THEMES, columnCount, nextIndex, TRAIL_MS, MAX_DPR, LONG_EDGE_CAP }
