/**
 * Build `client/bundle.js` from `client/rain.js` + `client/index.js`.
 *
 * The static-install artifact follows the client-modules bundle protocol:
 * `window.__ModuleLoader__.load({ id, factory })` registers a lazy CommonJS
 * factory that receives a `require` resolving framework modules (react is a
 * platform module; everything else is inlined). rain.js lands in the same
 * factory scope ahead of index.js, so the glue code references createRain /
 * THEMES as bare names — dsh-fireworks build-client.mjs 同款内联方案。
 * detect.js 不再内联：会话列插槽方案落地后浏览器入口已不测宽（纯函数库仅
 * 供离线测试与复用）。
 *
 * Stripped from the helper source: the `'use strict'` prologue and the
 * node-only `module.exports` guard line (it would clobber the factory's
 * module.exports before index.js sets it).
 *
 * Run: `npm run build:client`
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

/**
 * 修仙模式嵌入的篆体字体（OFL-1.1，霞鹜篆书/说文小篆）。base64 内联进 bundle，
 * 客户端 FontFace 用 data: URL 加载——单文件自包含，不联网、不依赖宿主静态路由。
 * 字体文件缺席（fresh checkout 未带）则注入 null，rain.js 退相对路径 / CDN 兜底。
 * OFL 许可随包分发：client/fonts/lxgw-seal-OFL.txt。
 */
const sealFontPath = join(here, '..', 'client', 'fonts', 'lxgw-seal.ttf')
const sealFontSrc = existsSync(sealFontPath)
  ? 'data:font/ttf;base64,' + readFileSync(sealFontPath).toString('base64')
  : null

/**
 * 甲骨文模式嵌入的字形 path 表（CC-BY 4.0，aylqs2025 数据集，polyline 折线）。
 * client/oracle/glyphs.json 是 {字: {d, vb:[w,h]}} 的精简表（仅命中的 152 字，
 * ~7.5KB）。构建脚本整文件注入为 __DSH_ORACLE_GLYPHS，客户端 Path2D 渲染——
 * 单文件自包含，不联网。文件缺席则注入 null，rain.js 退 fetch 相对路径（demo）。
 * 署名见 client/oracle/ATTRIBUTION.txt。
 */
const oracleGlyphsPath = join(here, '..', 'client', 'oracle', 'glyphs.json')
const oracleGlyphs = existsSync(oracleGlyphsPath)
  ? JSON.parse(readFileSync(oracleGlyphsPath, 'utf8'))
  : null

/** 读入 helper 源并剥掉 node-only 外壳。 */
const helper = (name) => readFileSync(join(here, '..', 'client', name), 'utf8')
  .replace(/^'use strict'\s*/, '')
  .replace(/^if \(typeof module !== 'undefined' && module\.exports\) module\.exports = .+$/gm, '')
  .trim()

const kitClient = readFileSync(createRequire(import.meta.url).resolve('@weibaohui/dsh-plugin-kit/client/source.js'), 'utf8').replace(/^'use strict'\s*/, '').trim()
const rain = helper('rain.js')
const source = readFileSync(join(here, '..', 'client', 'index.js'), 'utf8').trim()

const banner = `/* Generated from client/rain.js + client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    var __DSH_SEAL_FONT = ${JSON.stringify(sealFontSrc)}
    var __DSH_ORACLE_GLYPHS = ${JSON.stringify(oracleGlyphs)}
`

const footer = `
    return module.exports
  }
})
`

const indent = (code) => code
  .split('\n')
  .map((line) => (line.length === 0 ? line : '    ' + line))
  .join('\n')

const body = `${indent(kitClient)}\n\n${indent(rain)}\n\n${indent(source)}`
writeFileSync(join(here, '..', 'client', 'bundle.js'), banner + body + footer)
console.log(`built client/bundle.js (${Buffer.byteLength(banner + body + footer, 'utf8')} bytes)`)
