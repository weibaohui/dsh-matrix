'use strict'

/**
 * dsh-matrix — Host half
 *
 * 两件事：
 *
 *   1. 配置持久化：GET/POST /dsh-matrix/api/config，normalize 后落
 *      storageDomain（域 dsh_matrix），多窗口共享；存储不可用降级内存。
 *   2. 活动广播：订阅 session/event，凡有会话在流式输出/调工具就算活跃，
 *      2.5s 滑动窗口内的活跃会话数即「母体活跃度」level，经 SSE
 *      （GET /dsh-matrix/api/stream）在 level 变化时广播给客户端雨布——
 *      agent 忙得越欢，雨下得越急。客户端 reactive 开关关闭时忽略。
 *
 * 路由信任栅栏沿用 dsh-flow 同款：connection.requestRejection 的
 * Host/Origin 检查 + 浏览器认证。零 npm 运行时依赖。
 */

const DEFAULT_CONFIG = {
  enabled: true,
  opacity: 0.3,            // 0.05..1 画布整体透明度——雨中看代码的关键旋钮
  speed: 1,                // 0.3..2.5 雨柱下落速度倍率
  density: 1.3,            // 0.5..2 雨柱密度（列距 = 字号 / density）
  fontSize: 16,            // 12..24 字号（决定雨柱粗细与行高）
  themeDark: 'classic',    // 暗色 UI 的雨色（classic | amber | cyan | magenta）
  themeLight: 'amber',     // 亮色 UI 的雨色——白底上琥珀比纯绿更压得住
  region: 'no-left',       // no-left 除左侧会话栏（默认） | fullscreen 全屏
  reactive: true,          // true 时雨速跟随 agent 活跃度起伏
  feed: true,              // true 时 agent 流式输出的 token 原文掺进雨柱
  continuous: true,        // false 时对话未开始/已收尾雨会排空停歇，干活才落雨
  ignoreReducedMotion: false,  // true 时无视系统「减弱动态效果」偏好照常下雨
}

/** 配色合法值（客户端 rain.js THEMES 同名键）。 */
const THEMES = ['classic', 'amber', 'cyan', 'magenta']

/** 显示范围合法值（客户端 REGION_CSS 同名键）。 */
const REGIONS = ['no-left', 'fullscreen']

/** 算作「agent 正在忙」的会话事件。 */
const BUSY_EVENTS = new Set([
  'assistant/chunk',   // 流式输出中
  'assistant/message', // 消息落成
  'tool/call',         // 发起工具调用
  'tool/result',       // 工具返回
  'turn/start',        // 回合开始
])

/** 活跃判定滑窗：最近一次忙碌事件在此窗口内才算活跃。 */
const ACTIVE_WINDOW_MS = 2500
/** level 重算周期；level 变化 / 新 token 文本就绪时经此节奏广播。 */
const TICK_MS = 700

/**
 * 从 assistant/chunk 事件里取流式 token 文本（text-delta 增量优先，
 * text 整块兜底——dsh-plugin-kit 同款形状防御）。纯函数，离线测试用。
 */
function textOfChunk(data) {
  const chunk = data && typeof data === 'object' ? data.chunk : null
  if (!chunk || typeof chunk.text !== 'string' || chunk.text === '') return ''
  return chunk.type === 'text-delta' || chunk.type === 'text' ? chunk.text : ''
}

/** 单帧广播文本上限；缓冲超限裁尾。 */
const TEXT_FRAME_CAP = 512
const TEXT_BUF_CAP = 4096

/**
 * 从 assistant/message 里折算 token：output + 0.2×(input+cache)——
 * dsh-fireworks 同款公式；usage 缺失或为坏值时按 0 处理。纯函数。
 */
function usageTokensOf(data) {
  const d = data && typeof data === 'object' ? data : {}
  const usage = (d.usage && typeof d.usage === 'object') ? d.usage
    : (d.message && typeof d.message === 'object' && d.message.usage && typeof d.message.usage === 'object') ? d.message.usage
    : null
  if (!usage) return 0
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  return num(usage.outputTokens) + 0.2 * (num(usage.inputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens))
}

/**
 * 三维活跃强度 0..1：token 吞吐（40%）+ 工具调用频次（30%）+ 活跃会话数（30%）。
 * tokens 按单个 tick 窗口计（流式字符按 1/4 折算进 token）；饱和点：
 * 400 token / 12 次工具 / 3 个会话。纯函数，离线测试用。
 */
function intensityOf(tokens, tools, level) {
  const t = Math.max(0, tokens || 0)
  const g = Math.max(0, tools || 0)
  const l = Math.max(0, level || 0)
  return Math.min(1,
    0.4 * Math.min(1, t / 400) +
    0.3 * Math.min(1, g / 12) +
    0.3 * Math.min(1, l / 3))
}

const CONFIG_KEY = 'config'
const MAX_BODY_BYTES = 16 * 1024

/** 数值钳制工具。 */
function clamp(v, lo, hi, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}

/** 配置校验：宽松合并，坏字段回退默认值。 */
function normalizeConfig(raw) {
  const out = Object.assign({}, DEFAULT_CONFIG)
  if (!raw || typeof raw !== 'object') return out
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  out.opacity = clamp(raw.opacity, 0.05, 1, out.opacity)
  out.speed = clamp(raw.speed, 0.3, 2.5, out.speed)
  out.density = clamp(raw.density, 0.5, 2, out.density)
  out.fontSize = Math.round(clamp(raw.fontSize, 12, 24, out.fontSize))
  // 深浅各自配色；旧配置的单 theme 字段映射进 themeDark（升级不丢偏好）
  const pickTheme = (v, fb) => (typeof v === 'string' && THEMES.includes(v) ? v : fb)
  out.themeDark = pickTheme(raw.themeDark, pickTheme(raw.theme, out.themeDark))
  out.themeLight = pickTheme(raw.themeLight, out.themeLight)
  if (typeof raw.region === 'string' && REGIONS.includes(raw.region)) out.region = raw.region
  if (typeof raw.reactive === 'boolean') out.reactive = raw.reactive
  if (typeof raw.feed === 'boolean') out.feed = raw.feed
  if (typeof raw.continuous === 'boolean') out.continuous = raw.continuous
  if (typeof raw.ignoreReducedMotion === 'boolean') out.ignoreReducedMotion = raw.ignoreReducedMotion
  return out
}

/**
 * 活跃度：lastBusy 表（sessionId → ts）里窗口内未过期的会话数；
 * 顺带清掉陈旧条目。纯函数，离线测试直接断言。
 */
function activityLevel(lastBusy, now, windowMs) {
  let level = 0
  for (const [id, ts] of lastBusy) {
    if (now - ts < windowMs) level += 1
    else lastBusy.delete(id)
  }
  return level
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

module.exports = {
  name: 'dsh-matrix',
  inject: ['webServer', 'connection', 'storageDomain'],

  // 供离线测试断言；Cordis 忽略多余导出属性。
  __internals: { normalizeConfig, DEFAULT_CONFIG, THEMES, REGIONS, activityLevel, textOfChunk, usageTokensOf, intensityOf, BUSY_EVENTS, ACTIVE_WINDOW_MS },

  apply(ctx) {
    // ── 配置持久化 ───────────────────────────────────────────────────────
    const domainPromise = ctx.storageDomain.open({
      name: 'dsh_matrix',
      version: 1,
      // 坏记录挪备份视为缺失，不让整个域打不开
      invalidRecords: 'backup-and-skip',
      // valueSchema 是 open 时逐条 parse 存量记录的契约：缺了它，表里一旦
      // 有记录整个域就打不开（open 失败 → configTable 永远 null → 保存只
      // 落内存）。形状归一由本文件 normalizeConfig 负责，这里只做透传。
      tables: { config: { valueSchema: { parse: (v) => v } } },
    })
    let configTable = null
    let config = DEFAULT_CONFIG
    domainPromise.then((domain) => {
      configTable = domain.table('config')
      const stored = configTable.get(CONFIG_KEY)
      if (stored && typeof stored === 'object') {
        config = normalizeConfig(stored)
        // 一次性迁移：v0.1 旧默认 density=1 会被设置页整体存盘固化，
        // 存量值恰为 1 视作「从未调过」，升到新默认
        if (stored.density === 1) config.density = DEFAULT_CONFIG.density
      }
    }).catch(() => { /* 存储不可用时用内存默认配置 */ })
    ctx.effect(() => () => {
      domainPromise.then((domain) => domain.close()).catch(() => {})
    }, 'dsh-matrix: storage close')

    // ── SSE 订阅集 ───────────────────────────────────────────────────────
    const subscribers = new Set()
    let seq = 0

    const broadcast = (payload) => {
      if (subscribers.size === 0) return
      seq += 1
      const frame = `id: ${seq}\ndata: ${JSON.stringify(Object.assign({ seq }, payload))}\n\n`
      for (const res of subscribers) {
        try { res.write(frame) } catch { subscribers.delete(res) }
      }
    }

    // ── 活跃度跟踪 + token 原文捕获 ──────────────────────────────────────
    const lastBusy = new Map()
    let level = 0
    let textBuf = ''
    let tokBuf = 0    // 本 tick 窗口 token 折算（流式字符 1/4 + 消息 usage）
    let toolBuf = 0   // 本 tick 窗口工具事件数
    let lastIntensity = -1
    const onSessionEvent = (session, event) => {
      try {
        if (!session || typeof session.id !== 'string') return
        if (!event || typeof event.type !== 'string') return
        if (event.type === 'assistant/chunk') {
          // token 原文：流式增量攒进缓冲；字符数按 1/4 折算 token 进强度
          const text = textOfChunk(event.data)
          textBuf += text
          if (textBuf.length > TEXT_BUF_CAP) textBuf = textBuf.slice(-TEXT_BUF_CAP)
          tokBuf += text.length / 4
          return
        }
        if (event.type === 'assistant/message') {
          tokBuf += usageTokensOf(event.data)
          lastBusy.set(session.id, Date.now())
          return
        }
        if (event.type === 'tool/call' || event.type === 'tool/result') {
          toolBuf += 1
          lastBusy.set(session.id, Date.now())
          return
        }
        if (!BUSY_EVENTS.has(event.type)) return
        lastBusy.set(session.id, Date.now())
      } catch { /* 打点逻辑绝不能把宿主带崩 */ }
    }
    const tick = setInterval(() => {
      const next = activityLevel(lastBusy, Date.now(), ACTIVE_WINDOW_MS)
      // 强度量化到 5%，避免漂移值刷广播
      const intensity = Math.round(intensityOf(tokBuf, toolBuf, next) * 20) / 20
      if (next !== level || intensity !== lastIntensity) {
        level = next
        lastIntensity = intensity
        broadcast({ kind: 'activity', level, intensity, at: Date.now() })
      }
      if (textBuf.length > 0) {
        const text = textBuf.length > TEXT_FRAME_CAP ? textBuf.slice(-TEXT_FRAME_CAP) : textBuf
        textBuf = ''
        if (text.trim() !== '') broadcast({ kind: 'text', text, at: Date.now() })
      }
      tokBuf = 0
      toolBuf = 0
    }, TICK_MS)

    ctx.effect(() => {
      const disposeEvent = ctx.on('session/event', onSessionEvent)
      return () => {
        try { disposeEvent() } catch {}
        clearInterval(tick)
        lastBusy.clear()
      }
    }, 'dsh-matrix: activity tracking')

    // ── HTTP / SSE 路由 ──────────────────────────────────────────────────
    ctx.effect(() => {
      const disposeRoute = ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-matrix/api',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end()
            return
          }
          try {
            const url = new URL(req.url || '/', 'http://dsh.local')
            const apiPath = url.pathname.replace(/\/+$/, '')
            const sendJson = (status, payload) => {
              res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify(payload))
            }

            // GET /dsh-matrix/api/stream → SSE 活跃度直播（level 变化才推帧）
            if (req.method === 'GET' && apiPath.endsWith('/dsh-matrix/api/stream')) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
              })
              res.write('retry: 3000\n\n')
              // 新订阅者立即补一帧当前 level，客户端不必等下一次变化
              res.write(`id: ${seq}\ndata: ${JSON.stringify({ seq, kind: 'activity', level, at: Date.now() })}\n\n`)
              subscribers.add(res)
              const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 25000)
              req.on('close', () => {
                clearInterval(heartbeat)
                subscribers.delete(res)
              })
              return
            }

            // GET /dsh-matrix/api/config → 当前配置
            if (req.method === 'GET' && apiPath.endsWith('/dsh-matrix/api/config')) {
              sendJson(200, config)
              return
            }

            // POST /dsh-matrix/api/config → 保存配置
            if (req.method === 'POST' && apiPath.endsWith('/dsh-matrix/api/config')) {
              const body = await readBody(req, MAX_BODY_BYTES)
              let parsed
              try { parsed = JSON.parse(body) } catch { sendJson(400, { error: 'bad json' }); return }
              config = normalizeConfig(parsed)
              // 先等存储域就绪再落盘：启动瞬间的保存不能因 configTable 未
              // 就位而漏写；存储不可用时 domainPromise 拒绝 → 降级内存
              try { await domainPromise; if (configTable) await configTable.put(CONFIG_KEY, config) } catch { /* 降级内存 */ }
              sendJson(200, config)
              return
            }

            sendJson(404, { error: `no route for ${req.method} ${apiPath}` })
          } catch (e) {
            try {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: (e && e.message) || 'internal error' }))
            } catch { /* res 可能已部分写出 */ }
          }
        },
      })
      return () => {
        try { if (typeof disposeRoute === 'function') disposeRoute() } catch {}
        for (const res of subscribers) { try { res.end() } catch {} }
        subscribers.clear()
      }
    }, 'dsh-matrix: api')
  },
}
