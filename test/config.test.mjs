/**
 * dsh-matrix 离线测试：宿主配置归一化、字符集/配色表完整性、
 * 列数布局纯函数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Rain = require('../client/rain.js')
const Host = require('../src/index.js')

const { normalizeConfig, DEFAULT_CONFIG, THEMES: HOST_THEMES, REGIONS: HOST_REGIONS, activityLevel, textOfChunk, usageTokensOf, intensityOf, BUSY_EVENTS, ACTIVE_WINDOW_MS } = Host.__internals

test('默认配置即合法配置', () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG)
  assert.deepEqual(normalizeConfig('junk'), DEFAULT_CONFIG)
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG)
})

test('透明度钳制在 0.05..1，坏值回退默认', () => {
  assert.equal(normalizeConfig({ opacity: 0 }).opacity, 0.05)
  assert.equal(normalizeConfig({ opacity: 2 }).opacity, 1)
  assert.equal(normalizeConfig({ opacity: 0.5 }).opacity, 0.5)
  assert.equal(normalizeConfig({ opacity: 'high' }).opacity, DEFAULT_CONFIG.opacity)
  assert.equal(normalizeConfig({ opacity: NaN }).opacity, DEFAULT_CONFIG.opacity)
})

test('速度/密度/字号钳制与取整', () => {
  const cfg = normalizeConfig({ speed: 99, density: 0.01, fontSize: 18.6 })
  assert.equal(cfg.speed, 2.5)
  assert.equal(cfg.density, 0.5)
  assert.equal(cfg.fontSize, 19)
  assert.equal(normalizeConfig({ fontSize: 4 }).fontSize, 12)
  assert.equal(normalizeConfig({ fontSize: 99 }).fontSize, 24)
})

test('深浅配色各自归一，旧 theme 字段映射进 themeDark', () => {
  assert.equal(normalizeConfig({ themeDark: 'cyan', themeLight: 'magenta' }).themeDark, 'cyan')
  assert.equal(normalizeConfig({ themeLight: 'magenta' }).themeLight, 'magenta')
  assert.equal(normalizeConfig({ themeDark: 'neon' }).themeDark, DEFAULT_CONFIG.themeDark)
  assert.equal(normalizeConfig({ themeLight: 'nope' }).themeLight, DEFAULT_CONFIG.themeLight)
  const legacy = normalizeConfig({ theme: 'cyan' })
  assert.equal(legacy.themeDark, 'cyan', '旧单 theme 字段进暗色')
  assert.equal(legacy.themeLight, DEFAULT_CONFIG.themeLight)
  assert.equal(legacy.theme, undefined, '新配置不再输出旧字段')
})

test('region/布尔字段只收合法值', () => {
  assert.equal(normalizeConfig({ region: 'fullscreen' }).region, 'fullscreen')
  assert.equal(normalizeConfig({ region: 'bottom-left' }).region, DEFAULT_CONFIG.region)
  assert.equal(normalizeConfig({ region: 3 }).region, DEFAULT_CONFIG.region)
  assert.equal(normalizeConfig({ region: 'no-left' }).region, 'no-left')
  assert.equal(normalizeConfig({ enabled: 0 }).enabled, DEFAULT_CONFIG.enabled)
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ reactive: false }).reactive, false)
  assert.equal(normalizeConfig({ reactive: 1 }).reactive, DEFAULT_CONFIG.reactive)
  assert.equal(normalizeConfig({ feed: false }).feed, false)
  assert.equal(normalizeConfig({ feed: 1 }).feed, DEFAULT_CONFIG.feed)
  assert.equal(normalizeConfig({ continuous: false }).continuous, false)
  assert.equal(normalizeConfig({ continuous: 0 }).continuous, DEFAULT_CONFIG.continuous)
  assert.equal(normalizeConfig({ dblClickClear: 20 }).dblClickClear, undefined, '旧字段不再输出')
  assert.equal(normalizeConfig({ ignoreReducedMotion: true }).ignoreReducedMotion, true)
})

test('activityLevel：滑窗内会话计数，过期条目顺带清除', () => {
  const now = 1_000_000
  const map = new Map([
    ['a', now - 100],                       // 活跃
    ['b', now - ACTIVE_WINDOW_MS + 1],      // 窗口边缘，活跃
    ['c', now - ACTIVE_WINDOW_MS - 1],      // 刚过期
    ['d', now - 60_000],                    // 陈旧
  ])
  assert.equal(activityLevel(map, now, ACTIVE_WINDOW_MS), 2)
  assert.deepEqual([...map.keys()].sort(), ['a', 'b'], '过期条目被清除')
  assert.equal(activityLevel(map, now + ACTIVE_WINDOW_MS, ACTIVE_WINDOW_MS), 0)
})

test('忙碌事件集非空且为小写事件名', () => {
  assert.ok(BUSY_EVENTS.size >= 3)
  for (const name of BUSY_EVENTS) {
    assert.ok(/^[a-z]+\/[a-z]+$/.test(name), `${name} bad shape`)
  }
})

test('宿主配色白名单与客户端 THEMES 一致', () => {
  assert.deepEqual([...HOST_THEMES].sort(), Object.keys(Rain.THEMES).sort())
  for (const name of HOST_THEMES) {
    assert.ok(Rain.THEMES[name].head && Rain.THEMES[name].body, `${name} needs head/body colors`)
  }
})

test('字符集非空、无重复字符，且不含任何日文假名', () => {
  assert.ok(Rain.GLYPHS.length > 20)
  assert.equal(new Set(Rain.GLYPHS).size, Rain.GLYPHS.length, 'duplicate glyphs')
  for (const ch of Rain.GLYPHS) {
    const c = ch.codePointAt(0)
    assert.ok(c < 0x3040 || c > 0x30FF, `GLYPHS 含日文假名 ${ch} U+${c.toString(16)}`)
    assert.ok(c < 0xFF61 || c > 0xFF9F, `GLYPHS 含半角假名 ${ch} U+${c.toString(16)}`)
    assert.ok(c >= 32 && c <= 126, `GLYPHS 含非 ASCII 字符 ${ch}`)
  }
})

test('nextIndex：相邻字符永不重复', () => {
  for (let i = 0; i < 2000; i += 1) {
    const prev = i % Rain.GLYPHS.length
    assert.notEqual(Rain.nextIndex(prev, Rain.GLYPHS.length), prev, `prev=${prev} 重复`)
  }
  assert.equal(Rain.nextIndex(0, 1), 0, '单字符集兜底')
})

test('textOfChunk：text-delta 增量与 text 整块都取文本，其余为空', () => {
  assert.equal(textOfChunk({ chunk: { type: 'text-delta', text: 'Hel' } }), 'Hel')
  assert.equal(textOfChunk({ chunk: { type: 'text', text: 'lo' } }), 'lo')
  assert.equal(textOfChunk({ chunk: { type: 'reasoning-delta', text: '思考流不算' } }), '')
  assert.equal(textOfChunk({ chunk: { type: 'text-delta' } }), '')
  assert.equal(textOfChunk({}), '')
  assert.equal(textOfChunk(null), '')
})

test('usageTokensOf：output + 0.2×(input+cache)，兼容 data.usage / data.message.usage', () => {
  assert.equal(usageTokensOf({ usage: { outputTokens: 100, inputTokens: 500 } }), 200)
  assert.equal(usageTokensOf({ message: { usage: { outputTokens: 100 } } }), 100)
  assert.equal(usageTokensOf({ usage: { outputTokens: -5, inputTokens: 'x' } }), 0)
  assert.equal(usageTokensOf({}), 0)
  assert.equal(usageTokensOf(null), 0)
})

test('intensityOf：三维加权、钳制 0..1，越忙越强', () => {
  assert.equal(intensityOf(0, 0, 0), 0)
  assert.equal(intensityOf(99999, 99, 9), 1, '全饱和封顶 1')
  assert.equal(intensityOf(-5, -1, -2), 0, '负值当 0')
  const busy = intensityOf(500, 15, 4)
  const calm = intensityOf(40, 2, 1)
  assert.ok(busy > calm, '事件/工具/token 越多强度越高')
  assert.ok(intensityOf(500, 0, 0) > intensityOf(100, 0, 0), 'token 越多强度越高')
  assert.ok(intensityOf(0, 12, 0) > intensityOf(0, 3, 0), '工具越多强度越高')
  assert.ok(intensityOf(0, 0, 3) > intensityOf(0, 0, 1), '会话越多强度越高')
})

test('宿主显示范围白名单与客户端 REGION 一致', () => {
  assert.ok(HOST_REGIONS.includes(DEFAULT_CONFIG.region))
})

test('columnCount：密度越大列越多，宽度为 0 也有兜底', () => {
  const sparse = Rain.columnCount(1600, 16, 0.5)
  const normal = Rain.columnCount(1600, 16, 1)
  const dense = Rain.columnCount(1600, 16, 2)
  assert.equal(normal, 100)
  assert.ok(sparse < normal && normal < dense, 'density scales column count')
  assert.equal(Rain.columnCount(0, 16, 1), 1)
})

// ── 宿主路由冒烟（mock ctx，不依赖真实 dsh 运行时）─────────────────────────

function mockRes() {
  return {
    status: 0,
    body: '',
    writeHead(s) { this.status = s; return this },
    write(d) { this.body += String(d); return true },
    end(d) { if (d) this.body += String(d) },
  }
}

function mockReq(method, url, body) {
  const handlers = {}
  const req = {
    method, url,
    on(ev, fn) { handlers[ev] = fn; return this },
    emit(ev, ...args) { if (handlers[ev]) handlers[ev](...args) },
  }
  // data/end 在 handler 同步挂完监听后触发（Promise 执行器同步运行）
  queueMicrotask(() => {
    if (body !== undefined && handlers.data) handlers.data(Buffer.from(body))
    if (handlers.end) handlers.end()
  })
  return req
}

test('宿主路由：config 读写往返 + SSE 首帧 + 活跃度广播', async () => {
  const routes = []
  const cleanups = []
  const listeners = {}
  const ctx = {
    storageDomain: {
      open: async () => ({
        table: () => ({ get: () => null, put: async () => {} }),
        close: async () => {},
      }),
    },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    connection: { requestRejection: () => undefined },
    on: (name, fn) => { listeners[name] = fn; return () => {} },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  try {
    Host.apply(ctx)
    assert.equal(routes.length, 1, '一条 prefix 路由')
    const route = routes[0]

    // GET config → 默认值
    const res1 = mockRes()
    await route.handler(mockReq('GET', '/dsh-matrix/api/config'), res1)
    assert.equal(res1.status, 200)
    assert.deepEqual(JSON.parse(res1.body), DEFAULT_CONFIG)

    // POST config → 钳制后落库；再 GET 读回
    const res2 = mockRes()
    await route.handler(mockReq('POST', '/dsh-matrix/api/config', JSON.stringify({ opacity: 5, themeDark: 'cyan', themeLight: 'magenta', reactive: false })), res2)
    assert.equal(res2.status, 200)
    const saved = JSON.parse(res2.body)
    assert.equal(saved.opacity, 1)
    assert.equal(saved.themeDark, 'cyan')
    assert.equal(saved.themeLight, 'magenta')
    assert.equal(saved.reactive, false)
    const res3 = mockRes()
    await route.handler(mockReq('GET', '/dsh-matrix/api/config'), res3)
    assert.equal(JSON.parse(res3.body).themeDark, 'cyan')

    // SSE：订阅即收当前 level 首帧
    const sse = mockRes()
    const sseReq = mockReq('GET', '/dsh-matrix/api/stream')
    await route.handler(sseReq, sse)
    assert.equal(sse.status, 200)
    assert.match(sse.body, /"kind":"activity"/, '首帧带当前活跃度')

    // 忙碌事件打点 → tick 重算 → level=1 广播进 SSE 流
    listeners['session/event']({ id: 's1' }, { type: 'tool/call' })
    // token 原文：assistant/chunk 增量攒缓冲 → tick 整帧广播
    listeners['session/event']({ id: 's1' }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'WAKE UP NEO' } } })
    // token 强度：消息 usage 折算
    listeners['session/event']({ id: 's1' }, { type: 'assistant/message', data: { usage: { outputTokens: 1000 } } })
    await new Promise((r) => setTimeout(r, 900)) // tick 周期 700ms
    assert.match(sse.body, /"level":1/, '活跃度变化广播')
    assert.match(sse.body, /"intensity"/, '三维强度随广播携带')
    assert.match(sse.body, /"kind":"text"/, 'token 原文广播')
    assert.match(sse.body, /WAKE UP NEO/, '原文内容原样透传')
    sseReq.emit('close') // 关流，清 25s 心跳定时器，测试进程才能退出

    // 未认证请求被信任栅栏拦截
    ctx.connection.requestRejection = () => 403
    const res4 = mockRes()
    await route.handler(mockReq('GET', '/dsh-matrix/api/config'), res4)
    assert.equal(res4.status, 403)
  } finally {
    for (const cleanup of cleanups) cleanup() // 清掉 tick interval，测试进程可退出
  }
})
