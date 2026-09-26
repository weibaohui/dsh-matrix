'use strict'

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

if (typeof module !== 'undefined' && module.exports) module.exports = { detectMainLeft, pickComposerLeft, pickMainLeft, pickSidebarRight, SIDEBAR_W_MIN, SIDEBAR_W_MAX }
