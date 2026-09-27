/* Generated from client/detect.js + client/rain.js + client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@weibaohui/dsh-matrix",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    /**
     * dsh-matrix — 对话区左缘探测（动态识别侧栏宽度）
     *
     * 侧栏可收缩、可拖宽，固定 clamp 偏移会错位。这里用几何探测替代固定值，
     * 不依赖 shell 的编译期类名，三级递进：
     *
     *   1. 输入框祖先链：对话输入 textarea 向上爬祖先，取「宽 ≥40vw 且高 ≥50vh」
     *      祖先中最靠右的左缘——即主对话列（composer 列窄于阈值被跳过，app 根
     *      left=0 被 max 折掉，天然抗误判）
     *   2. 侧栏元素：aside / nav / [role=complementary|navigation] / class 含
     *      sidebar|side-bar|sider——贴左缘、高度过半、宽度像侧栏者，右缘即对话区
     *   3. 兜底：结构化 main / [role=main]，再不行宽泛 class 探测
     *
     * 全部探测不到 → 返回 null，调用方回退 clamp 估算。
     * pickComposerLeft / pickMainLeft / pickSidebarRight 为纯函数，node 离线测试。
     */

    /** 侧栏宽度像样区间：覆盖图标栏（收缩态 ~48px）到拖宽上限。 */
    const SIDEBAR_W_MIN = 36
    const SIDEBAR_W_MAX = 600

    const MAIN_SEL_STRUCTURAL = 'main, [role="main"]'
    const MAIN_SEL_LOOSE = '[class*="chat" i], [class*="conversation" i]'
    const SIDEBAR_SEL = 'aside, nav, [role="complementary"], [role="navigation"], [class*="sidebar" i], [class*="side-bar" i], [class*="sider" i]'

    /**
     * 可见且有面积才返回 rect（display:none / 零尺寸 → null，
     * 侧栏收缩隐藏时自然落到「无侧栏」分支）。
     */
    function visibleRect(el) {
      try {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return null
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') return null
        return r
      } catch { return null }
    }

    /**
     * 输入框祖先链 → 主对话列左缘：宽 ≥40vw 且高 ≥50vh 的祖先里最靠右的 left。
     * 纯函数：rects 按从内到外的祖先顺序（含输入框自身可不入）。
     */
    function pickComposerLeft(rects, vw, vh) {
      let best = null
      for (const r of rects) {
        if (r.width < vw * 0.4) continue
        if (r.height < vh * 0.5) continue
        best = best == null ? r.left : Math.max(best, r.left)
      }
      return best
    }

    /** 主区候选 → 合格（宽 ≥40vw、高 ≥50vh、不离谱偏移）者中最靠左的左缘。 */
    function pickMainLeft(rects, vw, vh) {
      let best = null
      for (const r of rects) {
        if (r.width < vw * 0.4) continue
        if (r.height < vh * 0.5) continue
        if (r.left < 0 || r.left > vw * 0.5) continue
        if (best == null || r.left < best) best = r.left
      }
      return best
    }

    /** 侧栏候选 → 贴左缘、高度过半、宽度像侧栏者中最宽者的右缘。 */
    function pickSidebarRight(rects, vh) {
      let best = null
      for (const r of rects) {
        if (r.left > 8) continue
        if (r.width < SIDEBAR_W_MIN || r.width > SIDEBAR_W_MAX) continue
        if (r.height < vh * 0.5) continue
        if (!best || r.width > best.width) best = r
      }
      return best ? best.right : null
    }

    /** 浏览器侧：探测对话区左缘 px；全部探测不到返回 null（调用方回退估算）。 */
    function detectMainLeft() {
      if (typeof document === 'undefined' || typeof window === 'undefined') return null
      const vw = window.innerWidth
      const vh = window.innerHeight

      // 1. 输入框祖先链
      for (const ta of document.querySelectorAll('textarea')) {
        const rects = []
        let el = ta
        for (let i = 0; el && el !== document.body && i < 10; i += 1) {
          const r = visibleRect(el)
          if (r) rects.push(r)
          el = el.parentElement
        }
        const left = pickComposerLeft(rects, vw, vh)
        if (left != null) return left
      }

      // 2. 侧栏元素右缘
      const sidebarRects = []
      for (const el of document.querySelectorAll(SIDEBAR_SEL)) {
        const r = visibleRect(el)
        if (r) sidebarRects.push(r)
      }
      const side = pickSidebarRight(sidebarRects, vh)
      if (side != null) return side

      // 3. main 结构 → 宽泛 class
      for (const sel of [MAIN_SEL_STRUCTURAL, MAIN_SEL_LOOSE]) {
        const rects = []
        for (const el of document.querySelectorAll(sel)) {
          const r = visibleRect(el)
          if (r) rects.push(r)
        }
        const left = pickMainLeft(rects, vw, vh)
        if (left != null) return left
      }
      return null
    }

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

    'use strict'

    /**
     * dsh-matrix — Client half
     *
     * 在对话窗口上空挂一块全屏透明画布（position:fixed; pointer-events:none，
     * z-index 低于设置浮层），引擎（client/rain.js）在其中下雨——英文与数字
     * 雨柱倾泻、白炽雨头绿身拖尾。画布本身透明（destination-out 擦除拖尾），
     * 对话内容透过来；canvas.style.opacity 是「雨中看代码」的总旋钮。
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
     * 显示范围：画布不必铺满全屏。除左侧栏 = 从对话区左缘起雨——左缘由
     * detectMainLeft() 动态探测（输入框祖先链 → 侧栏元素 → main 结构，三级
     * 递进），侧栏收缩/拖宽实时跟随；探测不到回退 clamp 估算。区域键与宿主
     * REGIONS 枚举一致。
     */
    const REGION_CSS = {
      'no-left': { top: '0', bottom: '0', right: '0' },
      fullscreen: { top: '0', left: '0', width: '100vw', height: '100vh' },
    }
    const NO_LEFT_FALLBACK = 'clamp(220px, 24vw, 400px)'

    // ── 雨布浮层 ─────────────────────────────────────────────────────────────

    /**
     * 全屏/区域透明画布浮层。pointer-events:none 不挡任何点击；z-index 低于
     * 设置/对话框浮层（2147483000 一带），高于对话内容——雨「飘」在窗口上，
     * 靠透明度与内容共存。
     */
    function mountOverlay() {
      const canvas = document.createElement('canvas')
      canvas.setAttribute('data-dsh-matrix', '')
      canvas.style.cssText = 'position:fixed;pointer-events:none;z-index:2147482000'
      document.body.appendChild(canvas)

      const engine = createRain(canvas, {})
      let region = 'no-left'
      let lastLeftCss = null

      // 先清后设：切换区域时旧的长宽/锚点不能残留
      const applyRegion = (r) => {
        region = REGION_CSS[r] ? r : 'no-left'
        const css = REGION_CSS[region]
        for (const k of ['top', 'bottom', 'left', 'right', 'width', 'height']) canvas.style[k] = ''
        for (const [k, v] of Object.entries(css)) canvas.style[k] = v
        lastLeftCss = null
        refresh()
      }

      // 除左侧栏的左缘动态探测：侧栏收缩/拖宽时对话区左缘随之变化
      const refreshNoLeft = () => {
        if (region !== 'no-left') return
        const l = detectMainLeft()
        const leftCss = l == null ? NO_LEFT_FALLBACK : Math.max(0, Math.round(l)) + 'px'
        if (leftCss !== lastLeftCss) {
          lastLeftCss = leftCss
          canvas.style.left = leftCss
          engine.resize()
        }
      }

      const refresh = () => { refreshNoLeft(); engine.resize() }
      applyRegion(region)

      const onResize = () => refresh()
      window.addEventListener('resize', onResize)
      const onVisibility = () => engine.setEnabled(!document.hidden && overlayEnabled)
      document.addEventListener('visibilitychange', onVisibility)

      // 布局自适应：插件加载早于页面布局稳定时，首测量会量到过渡态（雨柱行数
      // 偏少、盖不满屏）。ResizeObserver 盯住根节点与 body，布局一变就重测；
      // 兜底轮询防 body 被整体替换，并让侧栏收缩/拖宽实时跟随。引擎侧有尺寸
      // 去重 + 左缘去重，没变化就零成本跳过。
      let ro = null
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(onResize)
        ro.observe(document.documentElement)
        if (document.body) ro.observe(document.body)
      }
      const layoutWatch = setInterval(onResize, 2000)

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
          window.removeEventListener('resize', onResize)
          document.removeEventListener('visibilitychange', onVisibility)
          if (ro) ro.disconnect()
          clearInterval(layoutWatch)
          engine.dispose()
          canvas.remove()
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

        // ── 深浅主题自适应：采样页面底色，深浅各自用自己配的雨色 ────────────
        // （烟花 detectTone 同款：画布 pointer-events:none，elementFromPoint 穿透
        //   命中下层元素，沿父链找第一个非透明背景色，亮于阈值 → light）
        let tone = 'dark'
        const applyTheme = () => {
          if (!currentConfig) return
          overlay.engine.setTheme(tone === 'light'
            ? (typeof currentConfig.themeLight === 'string' ? currentConfig.themeLight : 'amber')
            : (typeof currentConfig.themeDark === 'string' ? currentConfig.themeDark : 'classic'))
        }
        const detectTone = () => {
          try {
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
        const toneTimer = setInterval(applyTone, 3000)
        ctx.effect(() => () => clearInterval(toneTimer), 'dsh-matrix: tone')

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
    return module.exports
  }
})
