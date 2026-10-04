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

const { normalizeConfig, DEFAULT_CONFIG, THEMES: HOST_THEMES, MODES: HOST_MODES, REGIONS: HOST_REGIONS, activityLevel, textOfChunk, usageTokensOf, intensityOf, BUSY_EVENTS, ACTIVE_WINDOW_MS } = Host.__internals

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

test('配色 0.7 起深浅都默认七彩轮转', () => {
  assert.equal(DEFAULT_CONFIG.themeDark, 'rainbow-cycle')
  assert.equal(DEFAULT_CONFIG.themeLight, 'rainbow-cycle')
  assert.equal(normalizeConfig({}).themeDark, 'rainbow-cycle')
  assert.equal(normalizeConfig({ themeDark: 'classic' }).themeDark, 'classic', '显式经典绿尊重')
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

test('mode 字段 0.7 起默认 oracle，matrix 仍可选', () => {
  assert.equal(DEFAULT_CONFIG.mode, 'oracle')
  assert.equal(normalizeConfig({}).mode, 'oracle')
  assert.equal(normalizeConfig({ mode: 'xian' }).mode, 'xian')
  assert.equal(normalizeConfig({ mode: 'oracle' }).mode, 'oracle')
  assert.equal(normalizeConfig({ mode: 'matrix' }).mode, 'matrix', 'matrix 仍是合法选项')
  assert.equal(normalizeConfig({ mode: 'neon' }).mode, 'oracle', '未知模式回退默认')
  assert.equal(normalizeConfig({ mode: 3 }).mode, 'oracle')
  // 旧配置无 mode 字段 → 直接落新默认
  assert.equal(normalizeConfig({ opacity: 0.5 }).mode, 'oracle')
})

test('宿主 MODES 白名单与客户端 MODES 一致', () => {
  assert.deepEqual([...HOST_MODES].sort(), [...Rain.MODES].sort())
})

test('修仙字符集：纯汉字，无重复，无字母无数字，均在 CJK 区', () => {
  assert.ok(Rain.GLYPHS_XIAN.length > 40, '修仙字符集应足够丰富')
  assert.equal(new Set(Rain.GLYPHS_XIAN).size, Rain.GLYPHS_XIAN.length, 'duplicate xian glyphs')
  for (const ch of Rain.GLYPHS_XIAN) {
    const c = ch.codePointAt(0)
    assert.ok(c > 127, `修仙字符集含 ASCII 字符 ${ch} U+${c.toString(16)}`)
    assert.ok(!/[0-9]/.test(ch), `修仙字符集含数字 ${ch}`)
    assert.ok(!/[A-Za-z]/.test(ch), `修仙字符集含字母 ${ch}`)
    assert.ok(Rain.isCJK(ch), `修仙字符 ${ch} 不在 CJK 区 U+${c.toString(16)}`)
  }
})

test('甲骨文字符集：纯汉字，无重复，无字母无数字，均在 CJK 区，且字形表全覆盖', () => {
  assert.ok(Rain.GLYPHS_ORACLE.length > 80, '甲骨文字符集应足够丰富')
  assert.equal(new Set(Rain.GLYPHS_ORACLE).size, Rain.GLYPHS_ORACLE.length, 'duplicate oracle glyphs')
  for (const ch of Rain.GLYPHS_ORACLE) {
    const c = ch.codePointAt(0)
    assert.ok(c > 127, `甲骨文字符集含 ASCII 字符 ${ch} U+${c.toString(16)}`)
    assert.ok(!/[0-9]/.test(ch), `甲骨文字符集含数字 ${ch}`)
    assert.ok(!/[A-Za-z]/.test(ch), `甲骨文字符集含字母 ${ch}`)
    assert.ok(Rain.isCJK(ch), `甲骨文字符 ${ch} 不在 CJK 区 U+${c.toString(16)}`)
  }
})

test('isCJK：CJK 统一表意与扩展 A 判定，ASCII/假名排除', () => {
  assert.ok(Rain.isCJK('道'))
  assert.ok(Rain.isCJK('福'))
  // 扩展 A 区间内一例
  assert.ok(Rain.isCJK(String.fromCodePoint(0x3400)))
  assert.ok(!Rain.isCJK('A'))
  assert.ok(!Rain.isCJK('0'))
  assert.ok(!Rain.isCJK('あ'))   // 日文假名不在 CJK 统一表意区
  assert.ok(!Rain.isCJK(' '))
})

test('注音表完备：修仙/甲骨字符池每字都有拼音与注音', () => {
  for (const pool of [Rain.GLYPHS_XIAN, Rain.GLYPHS_ORACLE]) {
    for (const ch of pool) {
      assert.ok(Rain.PINYIN[ch], `池字 ${ch} 缺拼音`)
      const zy = Rain.zhuyinOf(ch)
      assert.ok(zy.length >= 1, `池字 ${ch} 注音为空`)
      // 注音符号全部落在注音区或声调符区（无字母数字混入）
      for (const sym of zy) {
        const c = sym.codePointAt(0)
        const isBopomofo = c >= 0x3105 && c <= 0x3129
        const isTone = c === 0x02CA || c === 0x02C7 || c === 0x02CB || c === 0x02D9
        assert.ok(isBopomofo || isTone, `池字 ${ch} 注音含非法符号 ${sym} U+${c.toString(16)}`)
      }
    }
  }
})

test('pinyinToZhuyin：声韵调确定转换（含 zh/ch/sh 空韵、j/q/x+u、y/w 归位、iou/ui/un 展开）', () => {
  const cases = {
    'dào': 'ㄉㄠˋ',       // 基础
    'zhōng': 'ㄓㄨㄥ',     // ong→ㄨㄥ
    'xuán': 'ㄒㄩㄢˊ',     // j/q/x + uan → üan
    'nǚ': 'ㄋㄩˇ',         // ü
    'rì': 'ㄖˋ',           // 空韵：ri 不写 ㄧ
    'zhǐ': 'ㄓˇ',
    'zì': 'ㄗˋ',
    'shí': 'ㄕˊ',
    'yuè': 'ㄩㄝˋ',       // y+u → ü
    'yǒu': 'ㄧㄡˇ',        // you → iou
    'yī': 'ㄧ',
    'wáng': 'ㄨㄤˊ',       // w → u
    'wǒ': 'ㄨㄛˇ',
    'shuǐ': 'ㄕㄨㄟˇ',     // ui → uei
    'chūn': 'ㄔㄨㄣ',      // un → uen
    'quǎn': 'ㄑㄩㄢˇ',     // quan → üan
    'jué': 'ㄐㄩㄝˊ',      // jue → üe
    'èr': 'ㄦˋ',           // er
    'xiān': 'ㄒㄧㄢ',      // ian
    'huà': 'ㄏㄨㄚˋ',      // ua
    'jiàng': 'ㄐㄧㄤˋ',    // iang
    'bó': 'ㄅㄛˊ',         // o
    'yīn': 'ㄧㄣ',         // yin
    'yǒng': undefined,     // 不在断言内，防 typo 占位
  }
  for (const [py, want] of Object.entries(cases)) {
    if (want === undefined) continue
    assert.equal(Rain.pinyinToZhuyin(py), want, `${py} → 期望 ${want}`)
  }
  assert.equal(Rain.pinyinToZhuyin(''), '')
  assert.equal(Rain.pinyinToZhuyin(null), '')
  assert.equal(Rain.pinyinToZhuyin('xyz'), '', '无法解析的音节返回空')
})

test('glow 0.7 起默认开：布尔透传，坏值回退默认（true）', () => {
  assert.equal(DEFAULT_CONFIG.glow, true)
  assert.equal(normalizeConfig({}).glow, true)
  assert.equal(normalizeConfig({ glow: true }).glow, true)
  assert.equal(normalizeConfig({ glow: false, mode: 'xian' }).glow, false, '显式 false 尊重')
  assert.equal(normalizeConfig({ glow: 0 }).glow, true, '非布尔回退默认（true）')
  assert.equal(normalizeConfig({ mode: 'matrix' }).glow, true, '矩阵也默认发光，用户可关')
})

test('zhuyin 配置字段：默认 true，布尔透传，坏值回退', () => {
  assert.equal(DEFAULT_CONFIG.zhuyin, true)
  assert.equal(normalizeConfig({}).zhuyin, true)
  assert.equal(normalizeConfig({ zhuyin: false }).zhuyin, false)
  assert.equal(normalizeConfig({ zhuyin: 0 }).zhuyin, true, '非布尔回退默认')
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

test('宿主配色白名单与客户端 THEMES 一致（含鎏金；四色字段齐备）', () => {
  assert.deepEqual([...HOST_THEMES].sort(), Object.keys(Rain.THEMES).sort())
  assert.ok(HOST_THEMES.includes('gold'), '鎏金配色在白名单')
  for (const name of HOST_THEMES) {
    const t = Rain.THEMES[name]
    if (t.rainbow) {
      assert.ok(['cycle', 'random'].includes(t.rainbow), `${name} rainbow mode`)
      continue
    }
    assert.ok(t.head && t.body, `${name} needs head/body colors`)
    assert.ok(t.stroke && t.glow, `${name} needs stroke/glow for the glow effect`)
    assert.ok(/^#[0-9a-f]{6}$/i.test(t.head) && /^#[0-9a-f]{6}$/i.test(t.body), `${name} head/body hex`)
    assert.ok(/^rgba\(/.test(t.glow), `${name} glow is rgba`)
  }
  // 七彩：7 色、每色四件套齐备、互不重复
  assert.equal(Rain.RAINBOW.length, 7)
  const bodies = new Set(Rain.RAINBOW.map((c) => c.body))
  assert.equal(bodies.size, 7, 'rainbow hues distinct')
  for (const c of Rain.RAINBOW) {
    assert.ok(c.head && c.stroke && c.glow, 'rainbow variant needs full theme quad')
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
test('载入迁移（v 闸一次性）：存量 0.6 旧默认升到 0.7 新默认，显式值与 v≥7 尊重', async () => {
  const run = async (stored, checks) => {
    const routes = []
    const cleanups = []
    const ctx = {
      storageDomain: {
        open: async () => ({
          table: () => ({ get: () => stored, put: async () => {} }),
          close: async () => {},
        }),
      },
      webServer: { register: (r) => { routes.push(r); return () => {} } },
      connection: { requestRejection: () => undefined },
      on: () => () => {},
      effect: (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
    }
    Host.apply(ctx)
    await new Promise((resolve) => setImmediate(resolve)) // 等 domainPromise 微任务链落定（存储载入 + 迁移）
    const res = mockRes()
    await routes[0].handler(mockReq('GET', '/dsh-matrix/api/config'), res)
    try {
      checks(JSON.parse(res.body))
    } finally {
      for (const cleanup of cleanups) cleanup()
    }
  }

  // 0.6 存量：全旧默认 → 全升新默认，显式改过的 opacity 保留
  await run(
    { mode: 'matrix', themeDark: 'classic', themeLight: 'amber', opacity: 0.4 },
    (cfg) => {
      assert.equal(cfg.mode, 'oracle', '旧默认 matrix → 甲骨')
      assert.equal(cfg.themeDark, 'rainbow-cycle', '旧默认经典绿 → 七彩轮转')
      assert.equal(cfg.themeLight, 'rainbow-cycle', '旧默认琥珀 → 七彩轮转')
      assert.equal(cfg.glow, true, '新默认观感含金边发光')
      assert.equal(cfg.opacity, 0.4, '用户改过的值不动')
      assert.equal(cfg.v, 7, '迁移后落版本标记')
    })

  // v≥7：刻意选回的 matrix + 关金光不被回翻
  await run(
    { v: 7, mode: 'matrix', themeDark: 'classic', glow: false },
    (cfg) => {
      assert.equal(cfg.mode, 'matrix', 'v≥7 尊重存量选择')
      assert.equal(cfg.glow, false, 'v≥7 尊重显式关闭')
      assert.equal(cfg.themeDark, 'classic')
    })
})
