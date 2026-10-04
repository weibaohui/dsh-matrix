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

/**
 * 字符集（矩阵模式）：纯英文大写 + 数字 + 符号——不含任何日文假名。
 * 经典黑客帝国配方，半个世纪都没变过。
 */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$+-*/=#%&<>@!?|~^'

/**
 * 字符集（修仙模式）：道法修仙语感的汉字——天干地支、五行八卦、四时、
 * 道德经、修性命炼精化气、丹道神魂、阴阳心性、飞升渡劫等。纯汉字，
 * 不含任何字母与数字（此模式不用字母、不用数字）。raw 串里若手抖重了，
 * 由下面 IIFE 去重——满屏重复字是廉价感的来源。
 */
const GLYPHS_XIAN = (() => {
  const raw = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥金木水火土' +
    '乾坎艮震巽离坤兑春夏秋冬天地人道德经无极太极清静观自在' +
    '修性命炼精化气还虚合丹炁元真玄神灵魂魄阴阳心空悟觉' +
    '仙中福寿飞升渡劫雷罡斗符咒境' +
    // LXGW 霞鹜篆书收录的玄学类目（真篆形覆盖）：二十八宿/五方/五色/五常/朝代
    '角亢氐房心尾箕斗牛女虚危室壁奎娄胃昴毕觜参井鬼柳星张翼轸' +
    '东西南北青白黄赤黑仁义礼智信商周秦汉'
  let out = ''
  const seen = new Set()
  for (const ch of raw) {
    if (!seen.has(ch)) { seen.add(ch); out += ch }
  }
  return out
})()

/**
 * 字符集（甲骨文模式）：商代卜辞语感的汉字——占卜祭祀、祖先自然、天文历数、
 * 基础名物等。共 152 字，均取自 aylqs2025 甲骨文数据集（CC-BY 4.0，见
 * client/oracle/glyphs.json + ATTRIBUTION.txt），字形 path 在数据集中有对应
 * 折线 SVG。此模式不用字母、不用数字。
 */
const GLYPHS_ORACLE = (() => {
  const raw = '卜兆吉祸福利帝祖宗示祭祀祝祈圣巫史尹侯白黑黄赤青文武戎兵戈干戚好美丑老幼少高下新明有生死悔元天鬼命心言止喜王公伯子男女大人小上中出入往升降左右西北春秋冬旦雨雷日月星辰光山水火木土田野邑宫室户井舟牛羊豕犬鱼虫虎象鹿兔年占一二三四五六七八九十百千再首面足口耳目自骨血灾州乡家族氏姓登陟乎余我汝乃其之征伐戍克外'
  let out = ''
  const seen = new Set()
  for (const ch of raw) {
    if (!seen.has(ch)) { seen.add(ch); out += ch }
  }
  return out
})()

/** 渲染模式：matrix 经典英文数字雨 | xian 道法修仙金篆雨 | oracle 甲骨卜辞雨。 */
const MODES = ['matrix', 'xian', 'oracle']

/** 由字符集建 字→下标 索引。 */
function buildGlyphIndex(glyphs) {
  return new Map(glyphs.split('').map((ch, i) => [ch, i]))
}

/** 是否 CJK 统一表意文字（含扩展 A）——修仙模式只放行汉字进雨。 */
function isCJK(ch) {
  const c = ch.codePointAt(0)
  return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)
}

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

/**
 * 配色主题：head 白炽雨头 / body 雨身 / stroke 描边 / glow 外发光。
 * 与模式正交——任何模式（英文数字/篆体/甲骨）配任何色；stroke/glow 供
 * 「金边发光」效果使用（glow 关闭时只用 head/body 双色 fillText）。
 * 七彩主题（rainbow: 'cycle'|'random'）不带固有色，逐格取 RAINBOW 色：
 * cycle 按行位置轮转（雨柱自上而下逐字换色），random 每格独立随机。
 */
const THEMES = {
  classic: { head: '#e8ffe8', body: '#00ff41', stroke: '#006b1d', glow: 'rgba(0,255,65,0.45)' },
  amber:   { head: '#fff3d0', body: '#ffb000', stroke: '#7a5200', glow: 'rgba(255,176,0,0.45)' },
  cyan:    { head: '#e0ffff', body: '#00e5ff', stroke: '#00566b', glow: 'rgba(0,229,255,0.45)' },
  magenta: { head: '#ffe0f7', body: '#ff2fd6', stroke: '#7a0b63', glow: 'rgba(255,47,214,0.45)' },
  gold:    { head: '#fff3b0', body: '#ffce4a', stroke: '#7a5200', glow: 'rgba(255,185,55,0.45)' },
  'rainbow-cycle':  { rainbow: 'cycle' },
  'rainbow-random': { rainbow: 'random' },
}

/**
 * 七彩（赤橙黄绿青蓝紫）：每色一套完整主题四件套（body/head/stroke/glow），
 * head 为该色调亮后的白炽变体——白头彩身与单色主题同构。
 */
const RAINBOW = [
  { body: '#ff4040', head: '#ffd9d9', stroke: '#7a1a1a', glow: 'rgba(255,64,64,0.45)' },   // 赤
  { body: '#ff9500', head: '#ffe3bf', stroke: '#7a4700', glow: 'rgba(255,149,0,0.45)' },   // 橙
  { body: '#ffe000', head: '#fff8bf', stroke: '#7a6e00', glow: 'rgba(255,224,0,0.45)' },   // 黄
  { body: '#3dff3d', head: '#d9ffd9', stroke: '#1a7a1a', glow: 'rgba(61,255,61,0.45)' },   // 绿
  { body: '#00e5ff', head: '#bff5ff', stroke: '#006b7a', glow: 'rgba(0,229,255,0.45)' },   // 青
  { body: '#4d6bff', head: '#ccd9ff', stroke: '#1a2e7a', glow: 'rgba(77,107,255,0.45)' },  // 蓝
  { body: '#c05aff', head: '#eed9ff', stroke: '#57197a', glow: 'rgba(192,90,255,0.45)' },  // 紫
]

/** 字体栈（矩阵模式）：等宽优先，半角假名宽度约为字号一半，列距自然疏朗。 */
const FONT_STACK_MATRIX = '"SF Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace'

/**
 * 字体栈（修仙模式）：篆体优先——系统装的方正小篆 / 方正峄山碑篆 / 汉鼎繁印篆
 * / 崇羲篆體等（秦刻石一脉，覆盖广；方正小篆最接近峄山碑）排最前，有则全屏
 * 真秦篆；否则落 'DSH 小篆'（嵌入的霞鹜篆书 OFL，说文小篆，见 loadSealFont）；
 * 再不行退 CJK 衬线（仍为汉字，唯非篆形）。浏览器按字形逐字回退：篆体字体里
 * 有的字用篆形，没有的退到下一字体——天干地支/五行/二十八宿等收录字呈篆形，
 * 其余汉字呈今字形。装了方正小篆即是真秦篆（峄山碑一脉），无需嵌入字体兜底。
 */
const FONT_STACK_XIAN = '"FZXiaoZhuanTi","方正小篆体","FZYiShanBeiZhuanshu","方正峄山碑篆","汉鼎繁印篆","崇羲篆體","华文篆书","STZhuan","DSH 小篆","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif'

/**
 * 字体栈（甲骨文模式）：字形由 Path2D 折线塑形（不依赖字体文件），此栈仅作
 * fillText 兜底（oracle 模式 atlas 不走 fillText，实际不触发）。CJK 衬线兜底即可。
 */
const FONT_STACK_ORACLE = '"Songti SC","STSong","SimSun","Noto Serif CJK SC",serif'

/**
 * 修仙模式嵌入的篆体字体（OFL-1.1，霞鹜篆书/说文小篆，~75–105 字）。构建脚本
 * 把 client/fonts/lxgw-seal.ttf 整文件 base64 内联进 bundle（__DSH_SEAL_FONT，
 * data: URL），FontFace 用 data: URL 加载——单文件自包含，不联网、不依赖宿主
 * 静态路由。demo 直跑 rain.js 时无该常量，退相对路径 client/fonts/lxgw-seal.ttf
 * （http 服务下可读）；再失败退 jsdelivr CDN 兜底。family 名取中性 'DSH 小篆'——
 * 既不冒充峄山碑、也避 LXGW 保留名（字体文件未改，OFL 允许重分发，FontFace
 * 构造器 family 形参不修改字体文件）。OFL 许可随包分发：client/fonts/lxgw-seal-OFL.txt。
 */
const SEAL_FONT_CDN = 'https://cdn.jsdelivr.net/gh/lxgw/LxgwSeal@v0.001-alpha.7.24/TTF/LXGWSeal-Regular.ttf'
let sealFontPromise = null
function loadSealFont() {
  if (sealFontPromise) return sealFontPromise
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve()
  }
  // 优先嵌入 data: URL；次相对路径（demo）；末 jsdelivr CDN
  let src
  if (typeof __DSH_SEAL_FONT === 'string' && __DSH_SEAL_FONT) {
    src = `url("${__DSH_SEAL_FONT}")`
  } else {
    src = 'url("../client/fonts/lxgw-seal.ttf")'
  }
  const tryLoad = (s) => new FontFace('DSH 小篆', s, { display: 'swap' })
    .load()
    .then((ff) => { try { document.fonts.add(ff) } catch { /* add 失败忽略 */ } })
  try {
    sealFontPromise = tryLoad(src).catch(() => {
      // 嵌入/相对都失败，末路 CDN 兜底
      return tryLoad(`url("${SEAL_FONT_CDN}")`).catch(() => {})
    })
  } catch { sealFontPromise = Promise.resolve() }
  return sealFontPromise
}

/**
 * 发光字形（「金边发光」效果开）：外发光晕（shadow）+ 描边（stroke）+ 实心（fill）。
 * 颜色全部取自主题（head/body/stroke/glow）——任意模式配任意色，金边只是效果。
 * head 行更亮（主题 head 色），body 行主题 body 色——白头彩身，与矩阵白头绿身同构。
 * 在字形图集离屏预渲染时一次性塑形，运行期 drawImage 贴图零额外成本。
 */
function drawGlowGlyph(ac, ch, cx, cy, fs, isHead, t) {
  const fill = isHead ? t.head : t.body
  ac.save()
  ac.textAlign = 'center'
  ac.textBaseline = 'middle'
  // 外发光：用 shadow 把字形晕开成主题色光晕
  ac.shadowColor = t.glow
  ac.shadowBlur = fs * 0.5
  ac.fillStyle = fill
  ac.fillText(ch, cx, cy)
  // 描边 + 实心：关掉阴影保持锐利，描边压住发光边
  ac.shadowBlur = 0
  ac.lineWidth = Math.max(1, fs * 0.1)
  ac.lineJoin = 'round'
  ac.strokeStyle = t.stroke
  ac.strokeText(ch, cx, cy)
  ac.fillStyle = fill
  ac.fillText(ch, cx, cy)
  ac.restore()
}

/**
 * 甲骨文字形数据：构建脚本把 client/oracle/glyphs.json 注入为 __DSH_ORACLE_GLYPHS
 * （{字: {d: "M..L..", vb: [w,h]}}）；demo 直跑 rain.js 时无此常量，按需 fetch 相对
 * 路径 client/oracle/glyphs.json。CC-BY 4.0，署名见 client/oracle/ATTRIBUTION.txt。
 * 数据缺席时 oracle 模式雨照常下（退 CJK 衬线），不阻塞。
 */
let oracleMapPromise = null
function loadOracleGlyphs() {
  if (oracleMapPromise) return oracleMapPromise
  if (typeof __DSH_ORACLE_GLYPHS === 'object' && __DSH_ORACLE_GLYPHS) {
    oracleMapPromise = Promise.resolve(__DSH_ORACLE_GLYPHS)
    return oracleMapPromise
  }
  if (typeof fetch === 'undefined') { oracleMapPromise = Promise.resolve(null); return oracleMapPromise }
  oracleMapPromise = fetch('../client/oracle/glyphs.json', { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return oracleMapPromise
}

/**
 * 甲骨字形塑形：折线描边（甲骨文刻线质感）。颜色取自主题；glow 开时加外发光晕
 * + 主题描边压边，关时单遍主题色描边。head 行主题 head 色、body 行 body 色。
 * Path2D 吃 SVG 的 M/L 数据，按 viewBox 等比缩放进 tile 居中。运行期 drawImage 贴图。
 */
function drawOracleGlyph(ac, ch, cx, cy, fs, isHead, map, t, glow) {
  const g = map && map[ch]
  if (!g || typeof g.d !== 'string' || !Array.isArray(g.vb)) return false
  const [vw, vh] = g.vb
  if (!vw || !vh) return false
  // 按字号等比缩进 viewBox，居中铺进 tile
  const s = fs * 0.86 / Math.max(vw, vh)
  const tx = cx - (vw * s) / 2
  const ty = cy - (vh * s) / 2
  ac.save()
  ac.lineCap = 'round'
  ac.lineJoin = 'round'
  ac.translate(tx, ty)
  ac.scale(s, s)
  try {
    const p = new Path2D(g.d)
    const color = isHead ? t.head : t.body
    if (glow) {
      // 外发光：阴影晕开成主题色光晕（描边即发光），再描一遍主题描边压住锐利
      ac.shadowColor = t.glow
      ac.shadowBlur = fs * 0.5
      ac.strokeStyle = color
      ac.lineWidth = Math.max(1.2, fs * 0.12)
      ac.stroke(p)
      ac.shadowBlur = 0
      ac.strokeStyle = t.stroke
      ac.lineWidth = Math.max(0.6, fs * 0.06)
      ac.stroke(p)
    } else {
      ac.strokeStyle = color
      ac.lineWidth = Math.max(1.2, fs * 0.12)
      ac.stroke(p)
    }
  } catch { /* 坏 path 静默跳过 */ }
  ac.restore()
  return true
}

// ── 汉字注音（老式注音符号 ㄅㄆㄇㄈ）───────────────────────────────────────
// 旧字典的注法：字头上一行小注音。注音字母本身取自古字（ㄅ出自包、ㄇ出自
// 冪、ㄈ出自匚），长得像部首/篆文部件，与篆体/甲骨文一脉相承。修仙/甲骨
// 模式在雨字上方标注，矩阵模式（拉丁数字）不加。

/** 字符池注音表：{字: 带调拼音}。pinyinToZhuyin 负责拼音→注音的确定性转换。 */
const PINYIN = {
  // 天干地支
  '甲':'jiǎ','乙':'yǐ','丙':'bǐng','丁':'dīng','戊':'wù','己':'jǐ','庚':'gēng','辛':'xīn','壬':'rén','癸':'guǐ',
  '子':'zǐ','丑':'chǒu','寅':'yín','卯':'mǎo','辰':'chén','巳':'sì','午':'wǔ','未':'wèi','申':'shēn','酉':'yǒu','戌':'xū','亥':'hài',
  // 五行八卦四时天地
  '金':'jīn','木':'mù','水':'shuǐ','火':'huǒ','土':'tǔ',
  '乾':'qián','坎':'kǎn','艮':'gèn','震':'zhèn','巽':'xùn','离':'lí','坤':'kūn','兑':'duì',
  '春':'chūn','夏':'xià','秋':'qiū','冬':'dōng','天':'tiān','地':'dì','人':'rén',
  // 道德修仙丹道神魂
  '道':'dào','德':'dé','经':'jīng','无':'wú','极':'jí','太':'tài','清':'qīng','静':'jìng','观':'guān','自':'zì','在':'zài',
  '修':'xiū','性':'xìng','命':'mìng','炼':'liàn','精':'jīng','化':'huà','气':'qì','还':'huán','虚':'xū','合':'hé',
  '丹':'dān','炁':'qì','元':'yuán','真':'zhēn','玄':'xuán','神':'shén','灵':'líng','魂':'hún','魄':'pò',
  '阴':'yīn','阳':'yáng','心':'xīn','空':'kōng','悟':'wù','觉':'jué',
  '仙':'xiān','中':'zhōng','福':'fú','寿':'shòu','飞':'fēi','升':'shēng','渡':'dù','劫':'jié',
  '雷':'léi','罡':'gāng','斗':'dǒu','符':'fú','咒':'zhòu','境':'jìng',
  // 二十八宿
  '角':'jiǎo','亢':'kàng','氐':'dī','房':'fáng','尾':'wěi','箕':'jī','牛':'niú','女':'nǚ','危':'wēi','室':'shì','壁':'bì',
  '奎':'kuí','娄':'lóu','胃':'wèi','昴':'mǎo','毕':'bì','觜':'zī','参':'shēn','井':'jǐng','鬼':'guǐ','柳':'liǔ','星':'xīng',
  '张':'zhāng','翼':'yì','轸':'zhěn',
  // 五方五色五常朝代
  '东':'dōng','西':'xī','南':'nán','北':'běi',
  '青':'qīng','白':'bái','黄':'huáng','赤':'chì','黑':'hēi',
  '仁':'rén','义':'yì','礼':'lǐ','智':'zhì','信':'xìn',
  '商':'shāng','周':'zhōu','秦':'qín','汉':'hàn',
  // 甲骨卜辞：占卜祭祀
  '卜':'bǔ','兆':'zhào','吉':'jí','祸':'huò','利':'lì','帝':'dì','祖':'zǔ','宗':'zōng','示':'shì','祭':'jì','祀':'sì',
  '祝':'zhù','祈':'qí','圣':'shèng','巫':'wū','史':'shǐ','尹':'yǐn','侯':'hóu',
  '文':'wén','武':'wǔ','戎':'róng','兵':'bīng','戈':'gē','干':'gān','戚':'qī',
  // 甲骨卜辞：名物形容
  '好':'hǎo','美':'měi','丑':'chǒu','老':'lǎo','幼':'yòu','少':'shǎo','高':'gāo','下':'xià','新':'xīn','明':'míng',
  '有':'yǒu','生':'shēng','死':'sǐ','悔':'huǐ',
  '言':'yán','止':'zhǐ','喜':'xǐ','王':'wáng','公':'gōng','伯':'bó','男':'nán',
  '大':'dà','小':'xiǎo','上':'shàng','出':'chū','入':'rù','往':'wǎng','降':'jiàng',
  '左':'zuǒ','右':'yòu',
  '旦':'dàn','雨':'yǔ','日':'rì','月':'yuè','光':'guāng',
  '山':'shān','田':'tián','野':'yě','邑':'yì','宫':'gōng','户':'hù','舟':'zhōu',
  '羊':'yáng','豕':'shǐ','犬':'quǎn','鱼':'yú','虫':'chóng','虎':'hǔ','象':'xiàng','鹿':'lù','兔':'tù',
  '年':'nián','占':'zhān',
  // 甲骨卜辞：数词人体
  '一':'yī','二':'èr','三':'sān','四':'sì','五':'wǔ','六':'liù','七':'qī','八':'bā','九':'jiǔ','十':'shí',
  '百':'bǎi','千':'qiān','再':'zài',
  '首':'shǒu','面':'miàn','足':'zú','口':'kǒu','耳':'ěr','目':'mù','骨':'gǔ','血':'xuè',
  // 甲骨卜辞：方国人事
  '灾':'zāi','州':'zhōu','乡':'xiāng','家':'jiā','族':'zú','氏':'shì','姓':'xìng',
  '登':'dēng','陟':'zhì','乎':'hū','余':'yú','我':'wǒ','汝':'rǔ','乃':'nǎi','其':'qí','之':'zhī',
  '征':'zhēng','伐':'fá','戍':'shù','克':'kè','外':'wài',
}

/** 声调表：带调韵母 → 声调（1..4；无标记按 1 处理）。 */
const PINYIN_TONE_OF = {
  'ā':1,'á':2,'ǎ':3,'à':4,'ē':1,'é':2,'ě':3,'è':4,'ī':1,'í':2,'ǐ':3,'ì':4,
  'ō':1,'ó':2,'ǒ':3,'ò':4,'ū':1,'ú':2,'ǔ':3,'ù':4,'ǖ':1,'ǘ':2,'ǚ':3,'ǜ':4,
}
/** 注音声调符号：2ˊ 3ˇ 4ˋ（一声不标；轻声按一声处理——池内无轻声字）。 */
const ZHUYIN_TONE_MARK = { 2:'\u02CA', 3:'\u02C7', 4:'\u02CB' }

/** 声母表（长者先：zh/ch/sh 优先于单字母）。 */
const ZHUYIN_INITIALS = [
  ['zh','ㄓ'],['ch','ㄔ'],['sh','ㄕ'],
  ['b','ㄅ'],['p','ㄆ'],['m','ㄇ'],['f','ㄈ'],['d','ㄉ'],['t','ㄊ'],['n','ㄋ'],['l','ㄌ'],
  ['g','ㄍ'],['k','ㄎ'],['h','ㄏ'],['j','ㄐ'],['q','ㄑ'],['x','ㄒ'],['r','ㄖ'],
  ['z','ㄗ'],['c','ㄘ'],['s','ㄙ'],
]

/** 韵母表（长者先：iang 先于 an，üe 先于 e，ie 先于 i……）。 */
const ZHUYIN_FINALS = [
  ['iong','ㄩㄥ'],['iang','ㄧㄤ'],['uang','ㄨㄤ'],['ueng','ㄨㄥ'],
  ['iao','ㄧㄠ'],['iou','ㄧㄡ'],['uai','ㄨㄞ'],['uei','ㄨㄟ'],['üan','ㄩㄢ'],
  ['ian','ㄧㄢ'],['uan','ㄨㄢ'],['üe','ㄩㄝ'],['ün','ㄩㄣ'],
  ['ing','ㄧㄥ'],['ong','ㄨㄥ'],['uen','ㄨㄣ'],
  ['in','ㄧㄣ'],['un','ㄨㄣ'],['ui','ㄨㄟ'],['iu','ㄧㄡ'],
  ['ie','ㄧㄝ'],['ue','ㄩㄝ'],['ia','ㄧㄚ'],['ua','ㄨㄚ'],['uo','ㄨㄛ'],
  ['ai','ㄞ'],['ei','ㄟ'],['ao','ㄠ'],['ou','ㄡ'],['an','ㄢ'],['en','ㄣ'],
  ['ang','ㄤ'],['eng','ㄥ'],['er','ㄦ'],
  ['ü','ㄩ'],['i','ㄧ'],['u','ㄨ'],['a','ㄚ'],['o','ㄛ'],['e','ㄜ'],
]

/** zh/ch/sh/r/z/c/s 后的空韵：ㄓㄔㄕㄖㄗㄘㄙ 不写 ㄧ（知蚩诗日资雌思）。 */
const ZHUYIN_EMPTY_RIME = new Set(['zh', 'ch', 'sh', 'r', 'z', 'c', 's'])

/**
 * 带调拼音 → 注音符号。纯函数：声调取自韵母变音符，zh/ch/sh 合声母，
 * j/q/x 后 u 读 ü，iu/ui/un 展开为 iou/uei/uen，y/w 归位（y+u→ü，余 y→i、
 * w→u），ong→ㄨㄥ、iong→ㄩㄥ。坏输入返回空串。
 */
function pinyinToZhuyin(py) {
  if (typeof py !== 'string' || py === '') return ''
  let tone = 1
  for (const v of py) {
    if (PINYIN_TONE_OF[v] !== undefined) { tone = PINYIN_TONE_OF[v]; break }
  }
  // 去变音符：先把 ü 家族护成哨兵（NFD 会把 ü 拆成 u+分音符被误剥），再剥声调符
  let s = py.replace(/[üǖǘǚǜ]/g, 'V')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/V/g, 'ü').toLowerCase()
  // y/w 归位：y+u → ü；y+i → 去 y（yi/yin/ying）；余 y → i（ya/ye/yao/you/yan/yang/yong）；
  // w+u → 去 w（wu）；余 w → u（wo/wai/wei/wan/wen/wang/weng）
  if (s[0] === 'y') {
    if (s[1] === 'u') s = 'ü' + s.slice(2)
    else if (s[1] === 'i') s = s.slice(1)
    else s = 'i' + s.slice(1)
  } else if (s[0] === 'w') {
    s = (s[1] === 'u' ? s.slice(1) : 'u' + s.slice(1))
  }
  // 声母（记拉丁串用于空韵判定）
  let initial = ''
  let initialLatin = ''
  for (const [p, sym] of ZHUYIN_INITIALS) {
    if (s.startsWith(p)) { initial = sym; initialLatin = p; s = s.slice(p.length); break }
  }
  // j/q/x 后韵母开头的 u 读 ü（ju=ㄐㄩ jun=ㄐㄩㄣ jue=ㄐㄩㄝ juan=ㄑㄩㄢ）；
  // 仅替换韵母首位的 u——jiǔ/jiū 里的 u 是 iou 的一部分，不转
  if (initial === 'ㄐ' || initial === 'ㄑ' || initial === 'ㄒ') {
    s = s.replace(/^u/, 'ü')
  }
  // 韵母（最长匹配）
  let final = ''
  for (const [f, sym] of ZHUYIN_FINALS) {
    if (s === f) { final = sym; break }
  }
  if (!final) return ''
  // 空韵：zhi/chi/shi/ri/zi/ci/si 不写 ㄧ（知蚩诗日资雌思）
  if (final === 'ㄧ' && ZHUYIN_EMPTY_RIME.has(initialLatin)) final = ''
  return initial + final + (ZHUYIN_TONE_MARK[tone] || '')
}

/** 字 → 注音（带缓存）。缺拼音表的字返回空串（上方不标注，优雅降级）。 */
const zhuyinCache = new Map()
function zhuyinOf(ch) {
  if (zhuyinCache.has(ch)) return zhuyinCache.get(ch)
  const out = pinyinToZhuyin(PINYIN[ch] || '')
  zhuyinCache.set(ch, out)
  return out
}

/** 注音字体栈：注音符号 ㄅ-ㄩ（U+3105..）与声调符（ˊˇˋ）各 CJK 系统字体广覆盖。 */
const ZHUYIN_STACK = '"PingFang TC","PingFang SC","Microsoft JhengHei","Microsoft YaHei","Heiti TC","STHeiti","Songti SC","Noto Sans CJK TC","Noto Sans TC",sans-serif'

/**
 * 注音标注：雨字上方一行小注音（旧字典的注法）。主题色暗一档（alpha 0.85），
 * 弱发光——是标注不是主角。zf 取 0.30 字号，置于字头上方 0.70 字号处，与字身留缝。
 */
function drawZhuyinGlyph(ac, ch, cx, cy, fs, isHead, t) {
  const zy = zhuyinOf(ch)
  if (!zy) return
  const zf = Math.max(7, fs * 0.3)
  ac.save()
  ac.font = zf + 'px ' + ZHUYIN_STACK
  ac.textAlign = 'center'
  ac.textBaseline = 'middle'
  ac.globalAlpha = 0.85
  ac.shadowColor = t.glow
  ac.shadowBlur = fs * 0.25
  ac.fillStyle = isHead ? t.head : t.body
  ac.fillText(zy, cx, cy - fs * 0.7)
  ac.restore()
}

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

function randGlyphIdx(len) {
  return (Math.random() * len) | 0
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
    mode: 'oracle',        // 显示内容：matrix 英文数字 | xian 篆体汉字 | oracle 甲骨折线（0.7 起默认甲骨）
    speed: 1,
    density: 1.3,
    fontSize: 16,
    theme: 'rainbow-cycle', // 颜色：classic | amber | cyan | magenta | gold | 七彩（0.7 起默认七彩轮转）
    glow: true,            // 金边发光：描边 + 外发光晕（0.7 起默认开，新默认观感的组成部分）
    zhuyin: true,          // 汉字模式（xian/oracle）雨字上方标注音符号（旧字典注法）
  }
  if (options && typeof options === 'object') {
    for (const k of Object.keys(cfg)) {
      if (options[k] !== undefined) cfg[k] = options[k]
    }
  }

  // 当前模式字符集与索引：matrix→GLYPHS，xian→GLYPHS_XIAN，oracle→GLYPHS_ORACLE。setMode 时切换。
  let activeGlyphs = cfg.mode === 'xian' ? GLYPHS_XIAN : (cfg.mode === 'oracle' ? GLYPHS_ORACLE : GLYPHS)
  let glyphIndex = buildGlyphIndex(activeGlyphs)
  // 甲骨文字形 path 表（oracle 模式异步加载，载前 atlas 暂留空，载妥后重建）
  let oracleMap = null

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
  // activeGlyphs.length 列 × 2 行（上 body 下 head）的离屏画布；tile 边长随
  // 字号 × 渲染分辨率。字号/主题/分辨率/模式变化时重建，运行期只 drawImage。
  // 矩阵模式：双色 fillText（body 主题色 + head 白炽）；修仙模式：金光描边 +
  // 金色实心 + 外发光晕（drawGlowGlyph），pad 留足发光溢出。
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
    const oracle = cfg.mode === 'oracle'
    const t = theme()
    const glow = cfg.glow
    // 七彩主题：7 色 × body/head = 14 行图集（step 按行位置轮转/随机取行）；
    // 单色主题：1 色 × body/head = 2 行（原布局）
    const variantN = t.rainbow ? RAINBOW.length : 1
    // 发光晕需要更大 pad 容纳光晕溢出；纯双色用原紧凑留白（与模式无关）
    const pad = Math.ceil(fs * (glow ? 0.6 : 0.25))
    tile = fs + pad * 2
    tileCss = tile / scale
    atlas = document.createElement('canvas')
    atlas.width = tile * activeGlyphs.length
    atlas.height = tile * variantN * 2
    const ac = atlas.getContext('2d')
    if (!ac) { atlas = null; return }
    // 塑形字体随模式：修仙走篆体栈、矩阵走等宽栈、甲骨走 Path2D（font 仅兜底）
    ac.font = fs + 'px ' + (cfg.mode === 'xian' ? FONT_STACK_XIAN : (oracle ? FONT_STACK_ORACLE : FONT_STACK_MATRIX))
    ac.textAlign = 'center'
    ac.textBaseline = 'middle'
    const drawCell = (ch, cx, cy, isHead, vt) => {
      if (oracle) drawOracleGlyph(ac, ch, cx, cy, fs, isHead, oracleMap, vt, glow)
      else if (glow) drawGlowGlyph(ac, ch, cx, cy, fs, isHead, vt)
      else {
        ac.fillStyle = isHead ? vt.head : vt.body
        ac.fillText(ch, cx, cy)
      }
    }
    for (let i = 0; i < activeGlyphs.length; i += 1) {
      const ch = activeGlyphs[i]
      const cx = i * tile + tile / 2
      for (let v = 0; v < variantN; v += 1) {
        const vt = t.rainbow ? RAINBOW[v] : t
        drawCell(ch, cx, v * tile + tile / 2, false, vt)                    // body 行 v
        drawCell(ch, cx, (variantN + v) * tile + tile / 2, true, vt)        // head 行 variantN+v
        if (cfg.zhuyin) {
          drawZhuyinGlyph(ac, ch, cx, v * tile + tile / 2, fs, false, vt)
          drawZhuyinGlyph(ac, ch, cx, (variantN + v) * tile + tile / 2, fs, true, vt)
        }
      }
    }
  }

  // ── 对话原文进雨（feed）：宿主 SSE 推来 agent 流式输出的 token 文本，
  //    矩阵模式只留字符池里的拉丁字符（大写化后进池）；修仙模式只留汉字
  //    （非汉字一律丢弃——此模式不用字母不用数字），环形缓冲循环取用 ────
  const feed = []
  let feedHead = 0
  let feedOn = true

  function pushText(text) {
    if (!text) return
    // 修仙/甲骨模式只放行汉字（非汉字一律丢弃——不用字母不用数字）；矩阵模式走拉丁大写
    const cjkMode = cfg.mode === 'xian' || cfg.mode === 'oracle'
    for (const ch of String(text)) {
      if (cjkMode) {
        if (isCJK(ch) && glyphIndex.has(ch)) feed.push(ch)
      } else {
        const up = upperLatin(ch)
        if (glyphIndex.has(up)) feed.push(up)
      }
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
        const gi = glyphIndex.get(feed[feedHead])
        feedHead += 1
        if (gi !== undefined && gi !== cur) return gi
      }
    }
    return nextIndex(cur, activeGlyphs.length)
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
        glyph: randGlyphIdx(activeGlyphs.length),
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

  /**
   * 图集源行：单色主题 body=0 / head=1（原布局）；七彩主题 14 行图集——
   * cycle 按行位置轮转取色（雨柱自上而下逐字换色，与落笔时机无关、拖尾
   * 颜色稳定），random 每格独立随机取色（每个字符实例一个随机颜色）。
   */
  function atlasSourceY(isHead, r) {
    const t = THEMES[cfg.theme]
    if (!t || !t.rainbow) return isHead ? tile : 0
    const v = t.rainbow === 'cycle'
      ? (((r % RAINBOW.length) + RAINBOW.length) % RAINBOW.length)
      : (Math.random() * RAINBOW.length) | 0
    return (isHead ? RAINBOW.length : 0) * tile + v * tile
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
          ctx.drawImage(atlas, col.glyph * tile, atlasSourceY(false, r), tile, tile,
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
            ctx.drawImage(atlas, nextGlyphIdx(col.glyph) * tile, atlasSourceY(false, fr), tile, tile,
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
      ctx.drawImage(atlas, col.glyph * tile, atlasSourceY(true, col.lastRow), tile, tile,
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
  // 初始即古文字模式：异步载字体/字形表，载妥后重建图集让篆形生效（载前用 CJK 衬线兜底）
  if (cfg.mode === 'xian') loadSealFont().then(() => { buildAtlas() })
  // oracle 载前 atlas 全空，故载妥后要重布 + 预滚动，让满屏稳态即时呈现（而非从顶渐显）
  if (cfg.mode === 'oracle') loadOracleGlyphs().then((m) => { oracleMap = m; buildAtlas(); layout() })

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
      // 配色与模式正交：任何模式（英文数字/篆体/甲骨）配任何色
      if (!THEMES[name] || cfg.theme === name) return
      cfg.theme = name
      buildAtlas()
    },
    /** 金边发光开关：描边 + 外发光晕，与模式/配色正交，重建图集生效。 */
    setGlow(v) {
      const next = v === true
      if (cfg.glow === next) return
      cfg.glow = next
      buildAtlas()
    },
    /** 注音标注开关：汉字模式（xian/oracle）雨字上方标注音符号，重建图集生效。 */
    setZhuyin(v) {
      const next = v !== false
      if (cfg.zhuyin === next) return
      cfg.zhuyin = next
      buildAtlas()
    },
    /**
     * 渲染模式：matrix 经典英文数字雨 | xian 道法修仙金篆雨 | oracle 甲骨卜辞雨。
     * 切换时换字符集、换字体栈/字形表、换图集塑形（双色 fillText ↔ 金光描边发光
     * ↔ 折线 Path2D）；xian 懒载嵌入篆体、oracle 懒载字形 path 表，载妥后重建图集。
     */
    setMode(name) {
      const next = MODES.includes(name) ? name : 'matrix'
      if (cfg.mode === next) return
      cfg.mode = next
      activeGlyphs = next === 'xian' ? GLYPHS_XIAN : (next === 'oracle' ? GLYPHS_ORACLE : GLYPHS)
      glyphIndex = buildGlyphIndex(activeGlyphs)
      // 字符池换了，feed 环形缓冲里的旧字符对新池已无意义——清空重来
      feed.length = 0
      feedHead = 0
      buildAtlas()
      layout()
      if (next === 'xian') {
        // 系统装了篆体字体则立即可用；否则异步载嵌入篆体，载妥后重建图集
        loadSealFont().then(() => { buildAtlas() })
      } else if (next === 'oracle') {
        // 异步载甲骨字形 path 表，载妥后重建图集 + 重布预滚动（载前 atlas 空，需重滚到满屏）
        loadOracleGlyphs().then((m) => { oracleMap = m; buildAtlas(); layout() })
      }
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

if (typeof module !== 'undefined' && module.exports) module.exports = { createRain, GLYPHS, GLYPHS_XIAN, GLYPHS_ORACLE, MODES, THEMES, RAINBOW, columnCount, nextIndex, isCJK, buildGlyphIndex, drawGlowGlyph, drawOracleGlyph, PINYIN, pinyinToZhuyin, zhuyinOf, TRAIL_MS, MAX_DPR, LONG_EDGE_CAP }
