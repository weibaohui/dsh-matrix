/**
 * dsh-matrix 离线测试：对话区左缘探测的纯函数（几何打分）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Detect = require('../client/detect.js')

const vw = 1440
const vh = 900
const rect = (left, width, height, top = 0) => ({ left, width, height, top, right: left + width })

test('pickComposerLeft：取宽高合格祖先中最靠右的左缘（主对话列）', () => {
  // 输入框 → composer 列（窄，跳过）→ 主列（280 起）→ app 根（0，被 max 折掉）
  const rects = [
    rect(300, 840, 120),   // composer，高不足
    rect(280, 1160, 900),  // 主对话列
    rect(0, 1440, 900),    // app 根
  ]
  assert.equal(Detect.pickComposerLeft(rects, vw, vh), 280)
})

test('pickComposerLeft：窄窗口主列不足 40vw 仍按合格者取值', () => {
  const rects = [rect(260, 700, 900), rect(0, 960, 900)]
  assert.equal(Detect.pickComposerLeft(rects, 960, vh), 260)
  assert.equal(Detect.pickComposerLeft([], vw, vh), null)
})

test('pickSidebarRight：贴左缘、高度过半、宽度像侧栏的最宽者', () => {
  assert.equal(Detect.pickSidebarRight([rect(0, 280, 900)], vh), 280)
  // 多候选取最宽（aside 嵌套 nav 的场景）
  assert.equal(Detect.pickSidebarRight([rect(0, 220, 900), rect(0, 280, 900)], vh), 280)
  assert.equal(Detect.pickSidebarRight([rect(0, 280, 400)], vh), null, '高度不足一半')
  assert.equal(Detect.pickSidebarRight([rect(40, 280, 900)], vh), null, '不贴左缘')
})

test('pickSidebarRight：收缩态与超宽都判非侧栏', () => {
  assert.equal(Detect.pickSidebarRight([rect(0, 0, 900)], vh), null, '完全收缩宽度 0')
  assert.equal(Detect.pickSidebarRight([rect(0, 16, 900)], vh), null, '过窄')
  assert.equal(Detect.pickSidebarRight([rect(0, 800, 900)], vh), null, '过宽不是侧栏')
  assert.ok(Detect.SIDEBAR_W_MIN <= 48, '图标栏收缩态（~48px）必须落在识别区间内')
})

test('pickMainLeft：main/主区取合格者中最靠左，离谱偏移跳过', () => {
  assert.equal(Detect.pickMainLeft([rect(280, 1160, 900)], vw, vh), 280)
  assert.equal(Detect.pickMainLeft([rect(0, 1440, 900)], vw, vh), 0, '全屏 main 合法（无侧栏布局）')
  assert.equal(Detect.pickMainLeft([rect(1500, 400, 900)], vw, vh), null, '偏出视口右半')
  assert.equal(Detect.pickMainLeft([rect(280, 300, 900)], vw, vh), null, '宽度不足 40vw')
})

test('侧栏识别判定与视口比例解耦（高度阈值按 vh 折算）', () => {
  const vhSmall = 600
  assert.equal(Detect.pickSidebarRight([rect(0, 280, 350)], vhSmall), 280, '350 ≥ 600/2')
  assert.equal(Detect.pickSidebarRight([rect(0, 280, 250)], vhSmall), null, '250 < 300')
})
