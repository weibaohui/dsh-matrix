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

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

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
