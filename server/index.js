/**
 * 钟于钢琴工作室 - 登录与备份服务
 *
 * 环境变量：
 * - WECHAT_APPID: 小程序 AppID
 * - WECHAT_SECRET: 小程序 AppSecret
 * - AUTH_SECRET: 服务端签名密钥（必须设置）
 * - PORT: 端口（默认 3000）
 *
 * 接口：
 * - POST /api/wx/login            body: { code }
 * - POST /api/auth/wechat-login   body: { code } (兼容旧版本)
 * - GET  /api/user/profile        header: Authorization: Bearer <token>
 * - POST /api/user/profile        header: Authorization: Bearer <token>
 * - POST /api/user/background/upload  header: Authorization: Bearer <token>
 * - POST /api/backup              header: Authorization: Bearer <token>
 * - POST /api/backup/target-studio-expenses  老板认证账号代写「指定老师」备份中的 studioExpenses（需对方已有备份）
 * - GET  /api/backup/latest       header: Authorization: Bearer <token>
 * - GET  /api/user/boss-view      header: Authorization: Bearer <token>  老板上次查看的老师 openid
 * - POST /api/user/boss-view      header: Authorization: Bearer <token>  body: { bossLastViewOwnerKey }
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const app = express()
const PORT = Number(process.env.PORT || 3000)
const WECHAT_APPID = process.env.WECHAT_APPID || ''
const WECHAT_SECRET = process.env.WECHAT_SECRET || ''
const AUTH_SECRET = process.env.AUTH_SECRET || ''
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
// 兼容老前端：expiresAt 需为正整数；这里给 100 年，等效“长期有效”
const TOKEN_EXPIRES_MS = 100 * 365 * 24 * 60 * 60 * 1000
const BACKUP_DIR = path.resolve(__dirname, 'backups')
const PROFILE_DIR = path.resolve(__dirname, 'profiles')
const UPLOADS_DIR = path.resolve(__dirname, 'uploads')
const AVATAR_DIR = path.join(UPLOADS_DIR, 'avatars')
const BACKGROUND_DIR = path.join(UPLOADS_DIR, 'backgrounds')

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}
if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
}
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true })
}
if (!fs.existsSync(BACKGROUND_DIR)) {
  fs.mkdirSync(BACKGROUND_DIR, { recursive: true })
}

app.use(express.json({ limit: '8mb' }))
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d' }))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'piano-backup',
    hasWechatConfig: !!(WECHAT_APPID && WECHAT_SECRET),
    hasAuthSecret: !!AUTH_SECRET,
  })
})

function hmac(content) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(content).digest('hex')
}

/**
 * token 结构：openid.expiresAt.signature
 * - signature = HMAC_SHA256(`${openid}.${expiresAt}`)
 * - expiresAt 为毫秒时间戳（当前配置为超长期有效）
 */
function signAuthToken(openid, expiresAt) {
  const payload = `${openid}.${expiresAt}`
  const signature = hmac(payload)
  return `${payload}.${signature}`
}

/**
 * 校验业务 token 并解析 openid。
 * 关键兼容点：
 * - openid 可能包含 "."，因此从右侧解析 expiresAt/signature。
 * - expiresAt=0 视为永久有效；>0 才进行过期判断。
 */
function verifyAuthToken(token) {
  const parts = token.split('.')
  if (parts.length < 3) return null
  const openid = parts.slice(0, parts.length - 2).join('.')
  const expiresAtRaw = parts[parts.length - 2]
  const signature = parts[parts.length - 1]
  const expiresAt = Number(expiresAtRaw)
  if (!openid || !Number.isFinite(expiresAt)) return null
  // 0 表示永久有效；仅对 >0 的时间戳做过期判断
  if (expiresAt > 0 && Date.now() > expiresAt) return null
  const expected = hmac(`${openid}.${expiresAt}`)
  if (signature !== expected) return null
  return { openid, expiresAt }
}

async function fetchOpenidByCode(code) {
  if (!WECHAT_APPID || !WECHAT_SECRET) {
    throw new Error('服务端未配置 WECHAT_APPID / WECHAT_SECRET')
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', WECHAT_APPID)
  url.searchParams.set('secret', WECHAT_SECRET)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')

  const response = await fetch(url)
  const data = await response.json()
  if (!data.openid) {
    throw new Error(data.errmsg || '微信登录失败')
  }
  return data.openid
}

/** 微信 code 换 openid，并签发业务 token */
async function handleWechatLogin(req, res) {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  if (!code) {
    return res.status(400).json({ success: false, message: '缺少 code' })
  }
  try {
    const openid = await fetchOpenidByCode(code)
    const expiresAt = Date.now() + TOKEN_EXPIRES_MS
    const token = signAuthToken(openid, expiresAt)
    return res.json({
      code: 0,
      success: true,
      openid,
      token,
      authToken: token, // 兼容旧前端字段
      expiresAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '登录失败'
    return res.status(400).json({ code: -1, success: false, message })
  }
}

app.post('/api/wx/login', handleWechatLogin)
app.post('/api/auth/wechat-login', handleWechatLogin)

/**
 * 统一从 Authorization 头提取 Bearer token 并校验。
 * 返回 null 代表未登录或登录态无效。
 */
function verifyRequestToken(req) {
  const auth = req.headers.authorization
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return token ? verifyAuthToken(token) : null
}

/** 文本字段统一做 trim + 截断，防止异常超长输入 */
function normalizeText(value, maxLen) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLen)
}

/**
 * 解析外网可访问的基础 URL。
 * 优先级：
 * 1) PUBLIC_BASE_URL（部署显式配置）
 * 2) x-forwarded-proto + host（反向代理）
 * 3) localhost 开发环境回退 req.protocol
 */
function resolvePublicBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim()
    : ''
  const host = req.headers.host || ''
  const isLocalHost = host.startsWith('127.0.0.1') || host.startsWith('localhost')
  // 线上环境大多在 Nginx 反代后，Express 看到的 req.protocol 往往是 http；
  // 若未配置 x-forwarded-proto，这里对公网域名默认使用 https，避免生成 http 头像地址被小程序拦截。
  const proto = forwardedProto || (isLocalHost ? (req.protocol || 'http') : 'https')
  return `${proto}://${host}`
}

function normalizeAvatarUrl(url, req) {
  const raw = normalizeText(url, 1000)
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) return `${resolvePublicBaseUrl(req)}${raw}`
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const marker = '/uploads/'
    const idx = raw.indexOf(marker)
    if (idx !== -1) {
      const pathPart = raw.slice(idx)
      return `${resolvePublicBaseUrl(req)}${pathPart}`
    }
  }
  return raw
}

/**
 * 解析 dataURL 形式的图片 base64。
 * 仅允许 jpg/png/webp/gif，返回 null 表示格式或解码失败。
 */
function parseImageBase64(input) {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  const match = trimmed.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/)
  if (!match) return null
  const rawExt = match[1].toLowerCase()
  const dataPart = match[2]
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
  if (!['jpg', 'png', 'webp', 'gif'].includes(ext)) return null
  try {
    const buffer = Buffer.from(dataPart, 'base64')
    if (!buffer.length) return null
    return { buffer, ext }
  } catch {
    return null
  }
}

/** 统一备份文件扫描：按 mtime 倒序，files[0] 即最新 */
function listBackupFilesByOpenid(openid) {
  const userDir = path.join(BACKUP_DIR, openid)
  if (!fs.existsSync(userDir)) return []
  return fs
    .readdirSync(userDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filepath = path.join(userDir, name)
      const stat = fs.statSync(filepath)
      return { name, filepath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 读取某 openid 的最新备份并做结构兜底 */
/**
 * 读取某账号最新备份，并做结构兜底。
 * 注意 studioExpenses 语义：
 * - 仅当源 JSON 含该键时才返回，避免旧备份“缺键”被误解释为空数组。
 */
function readLatestBackupByOpenid(openid) {
  const files = listBackupFilesByOpenid(openid)
  if (!files.length) return null
  try {
    const latest = files[0]
    const raw = fs.readFileSync(latest.filepath, 'utf8')
    const parsed = JSON.parse(raw)
    const courses = Array.isArray(parsed.courses) ? parsed.courses : []
    const students = Array.isArray(parsed.students) ? parsed.students : []
    const settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    const backupAt = typeof parsed.backupAt === 'string' ? parsed.backupAt : ''
    const base = {
      openid,
      file: latest.name,
      backupAt,
      courses,
      students,
      settings,
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'studioExpenses')) {
      base.studioExpenses = Array.isArray(parsed.studioExpenses) ? parsed.studioExpenses : []
    }
    return base
  } catch {
    return null
  }
}

/**
 * 从历史备份中找出「最近一份非空的 studioExpenses」。
 * 用途：老师端全量备份常带空 studioExpenses（本机不维护工作室支出），
 *       若直接写入会把老板代填的支出覆盖成空。此处按 mtime 由新到旧扫描，
 *       返回第一份含非空支出的数组；都为空/缺键则返回 null（交由调用方决定兜底）。
 */
function findLatestNonEmptyStudioExpensesByOpenid(openid) {
  const files = listBackupFilesByOpenid(openid)
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f.filepath, 'utf8'))
      if (Array.isArray(parsed.studioExpenses) && parsed.studioExpenses.length > 0) {
        return parsed.studioExpenses
      }
    } catch {
      // 跳过损坏文件，继续向更旧的备份回溯
    }
  }
  return null
}

function readProfileByOpenid(openid, req) {
  const filepath = path.join(PROFILE_DIR, `${openid}.json`)
  if (!fs.existsSync(filepath)) return null
  try {
    const raw = fs.readFileSync(filepath, 'utf8')
    const profile = JSON.parse(raw)
    return {
      nickName: normalizeText(profile.nickName, 64),
      avatarUrl: normalizeAvatarUrl(profile.avatarUrl, req),
    }
  } catch {
    return null
  }
}

app.get('/api/user/profile', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const filepath = path.join(PROFILE_DIR, `${verified.openid}.json`)
  if (!fs.existsSync(filepath)) {
    return res.json({ success: true, profile: null })
  }
  try {
    const raw = fs.readFileSync(filepath, 'utf8')
    const profile = JSON.parse(raw)
    profile.avatarUrl = normalizeAvatarUrl(profile.avatarUrl, req)
    // 自动修正历史 http/ip 头像地址，避免跨设备加载失败
    fs.writeFileSync(filepath, JSON.stringify(profile, null, 2), 'utf8')
    return res.json({ success: true, profile })
  } catch {
    return res.status(500).json({ success: false, message: '读取用户资料失败' })
  }
})

function bossViewPrefsPath(openid) {
  return path.join(PROFILE_DIR, `${openid}.boss_view.json`)
}

app.get('/api/user/boss-view', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const fp = bossViewPrefsPath(verified.openid)
  if (!fs.existsSync(fp)) {
    return res.json({ success: true, bossLastViewOwnerKey: '' })
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'))
    const key = normalizeText(raw.bossLastViewOwnerKey, 128)
    return res.json({ success: true, bossLastViewOwnerKey: key })
  } catch {
    return res.json({ success: true, bossLastViewOwnerKey: '' })
  }
})

app.post('/api/user/boss-view', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const key = normalizeText(req.body?.bossLastViewOwnerKey, 128)
  try {
    fs.writeFileSync(bossViewPrefsPath(verified.openid), JSON.stringify({ bossLastViewOwnerKey: key }, null, 2), 'utf8')
    return res.json({ success: true })
  } catch {
    return res.status(500).json({ success: false, message: '保存失败' })
  }
})

app.post('/api/user/profile', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const body = req.body || {}
  const profile = {
    openid: verified.openid,
    nickName: normalizeText(body.nickName, 64),
    avatarUrl: normalizeAvatarUrl(body.avatarUrl, req),
    gender: Number.isFinite(body.gender) ? Number(body.gender) : 0,
    country: normalizeText(body.country, 32),
    province: normalizeText(body.province, 32),
    city: normalizeText(body.city, 32),
    language: normalizeText(body.language, 16),
    updatedAt: new Date().toISOString(),
  }
  if (!profile.nickName || !profile.avatarUrl) {
    return res.status(400).json({ success: false, message: '资料不完整，缺少昵称或头像' })
  }
  const filepath = path.join(PROFILE_DIR, `${verified.openid}.json`)
  try {
    fs.writeFileSync(filepath, JSON.stringify(profile, null, 2), 'utf8')
    return res.json({ success: true, profile })
  } catch {
    return res.status(500).json({ success: false, message: '保存用户资料失败' })
  }
})

app.post('/api/user/background/upload', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const parsed = parseImageBase64(req.body?.imageBase64)
  if (!parsed) {
    return res.status(400).json({ success: false, message: '图片数据格式无效' })
  }
  if (parsed.buffer.length > 1024 * 1024 * 4) {
    return res.status(400).json({ success: false, message: '图片过大，请选择 4MB 以内' })
  }
  const filename = `${verified.openid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${parsed.ext}`
  const filepath = path.join(BACKGROUND_DIR, filename)
  try {
    fs.writeFileSync(filepath, parsed.buffer)
    const bgPath = `/uploads/backgrounds/${filename}`
    const imageUrl = `${resolvePublicBaseUrl(req)}${bgPath}`
    return res.json({ success: true, imageUrl, imagePath: bgPath })
  } catch {
    return res.status(500).json({ success: false, message: '背景图上传失败' })
  }
})

app.post('/api/user/avatar/upload', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const parsed = parseImageBase64(req.body?.avatarBase64)
  if (!parsed) {
    return res.status(400).json({ success: false, message: '头像数据格式无效' })
  }
  if (parsed.buffer.length > 1024 * 1024 * 2) {
    return res.status(400).json({ success: false, message: '头像文件过大，请选择更小图片' })
  }
  const filename = `${verified.openid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${parsed.ext}`
  const filepath = path.join(AVATAR_DIR, filename)
  try {
    fs.writeFileSync(filepath, parsed.buffer)
    const avatarPath = `/uploads/avatars/${filename}`
    const avatarUrl = `${resolvePublicBaseUrl(req)}${avatarPath}`
    return res.json({ success: true, avatarUrl, avatarPath })
  } catch {
    return res.status(500).json({ success: false, message: '头像上传失败' })
  }
})

/**
 * 全量备份写入接口。
 * 设计：append-only，每次写新文件，便于审计与回滚。
 */
app.post('/api/backup', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const { courses = [], students = [], settings = {}, studioExpenses } = req.body
  if (!Array.isArray(courses)) {
    return res.status(400).json({ success: false, message: 'courses 需为数组' })
  }
  if (!Array.isArray(students)) {
    return res.status(400).json({ success: false, message: 'students 需为数组' })
  }

  const userDir = path.join(BACKUP_DIR, verified.openid)
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })

  // studioExpenses 防覆盖：老师端日常全量备份通常带空数组（本机不维护工作室支出），
  // 而该字段可能由「老板代管」写入。若本次为空，则从历史备份回溯保留最近一份非空支出，
  // 避免把老板填好的工作室支出覆盖丢失。
  const incomingExpenses = Array.isArray(studioExpenses) ? studioExpenses : []
  let resolvedExpenses = incomingExpenses
  if (incomingExpenses.length === 0) {
    const preserved = findLatestNonEmptyStudioExpensesByOpenid(verified.openid)
    if (preserved) resolvedExpenses = preserved
  }

  // 每次备份都写新文件（append-only），方便追溯历史版本
  const payload = {
    openid: verified.openid,
    courses,
    students,
    settings,
    studioExpenses: resolvedExpenses,
    backupAt: new Date().toISOString(),
  }
  const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
  const filepath = path.join(userDir, filename)
  try {
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8')
    return res.json({ success: true, message: '备份已保存', file: filename })
  } catch (err) {
    return res.status(500).json({ success: false, message: '写入备份文件失败' })
  }
})

/** 老板认证用户：仅更新「目标老师」最新备份中的工作室支出（不改动课表/学生等） */
app.post('/api/backup/target-studio-expenses', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const mine = readLatestBackupByOpenid(verified.openid)
  if (!mine?.settings || mine.settings.bossCertified !== true) {
    return res.status(403).json({ success: false, message: '仅已通过老板认证的账号可代管他人工作室支出' })
  }
  const targetOpenid = normalizeText(req.body?.targetOpenid, 64)
  if (!targetOpenid) {
    return res.status(400).json({ success: false, message: '缺少 targetOpenid' })
  }
  const studioExpenses = req.body?.studioExpenses
  if (!Array.isArray(studioExpenses)) {
    return res.status(400).json({ success: false, message: 'studioExpenses 需为数组' })
  }
  const targetLatest = readLatestBackupByOpenid(targetOpenid)
  if (!targetLatest) {
    return res.status(404).json({ success: false, message: '该老师暂无云端备份，无法写入工作室支出' })
  }
  const userDir = path.join(BACKUP_DIR, targetOpenid)
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })
  const payload = {
    openid: targetOpenid,
    courses: targetLatest.courses,
    students: targetLatest.students,
    settings: targetLatest.settings,
    studioExpenses,
    backupAt: new Date().toISOString(),
  }
  const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
  const filepath = path.join(userDir, filename)
  try {
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8')
    return res.json({ success: true, message: '已更新该老师的工作室支出备份', file: filename })
  } catch {
    return res.status(500).json({ success: false, message: '写入备份失败' })
  }
})

/**
 * 读取最新备份：
 * - 普通用户：返回本人最新快照
 * - 老板用户：在本人快照基础上，额外聚合全量老师最新快照
 */
app.get('/api/backup/latest', (req, res) => {
  if (!AUTH_SECRET) {
    return res.status(500).json({ success: false, message: '服务端未设置 AUTH_SECRET' })
  }
  const verified = verifyRequestToken(req)
  if (!verified) {
    return res.status(401).json({ success: false, message: '登录态失效，请重新登录' })
  }
  const mine = readLatestBackupByOpenid(verified.openid)
  if (!mine) {
    return res.json({ success: false, message: '该账号暂无云端备份' })
  }

  try {
    const isBoss = mine.settings && mine.settings.bossCertified === true
    if (isBoss) {
      // 老板模式：返回本人顶层数据 + 全量老师列表（每位老师各取最新备份）
      const openids = fs
        .readdirSync(BACKUP_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)

      const teachers = openids
        .map((openid) => {
          const latest = readLatestBackupByOpenid(openid)
          if (!latest) return null
          const profile = readProfileByOpenid(openid, req)
          const shortId = openid.slice(0, 8)
          const row = {
            openid,
            profile: {
              nickName: profile?.nickName || `老师-${shortId || '未命名'}`,
              avatarUrl: profile?.avatarUrl || '',
            },
            courses: latest.courses,
            students: latest.students,
            settings: latest.settings,
            backupAt: latest.backupAt,
          }
          if (Object.prototype.hasOwnProperty.call(latest, 'studioExpenses')) {
            row.studioExpenses = latest.studioExpenses
          }
          return row
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aMs = Number.isFinite(Date.parse(a.backupAt || '')) ? Date.parse(a.backupAt || '') : 0
          const bMs = Number.isFinite(Date.parse(b.backupAt || '')) ? Date.parse(b.backupAt || '') : 0
          if (bMs !== aMs) return bMs - aMs
          return String(a.profile?.nickName || '').localeCompare(
            String(b.profile?.nickName || ''),
            'zh-Hans-CN-u-co-pinyin',
            { sensitivity: 'base' },
          )
        })

      const bossBody = {
        success: true,
        boss: true,
        file: mine.file,
        backupAt: mine.backupAt,
        courses: mine.courses,
        students: mine.students,
        settings: mine.settings,
        teachers,
      }
      if (Object.prototype.hasOwnProperty.call(mine, 'studioExpenses')) {
        bossBody.studioExpenses = mine.studioExpenses
      }
      return res.json(bossBody)
    }

    const userBody = {
      success: true,
      file: mine.file,
      backupAt: mine.backupAt,
      courses: mine.courses,
      students: mine.students,
      settings: mine.settings,
    }
    if (Object.prototype.hasOwnProperty.call(mine, 'studioExpenses')) {
      userBody.studioExpenses = mine.studioExpenses
    }
    return res.json(userBody)
  } catch (err) {
    return res.status(500).json({ success: false, message: '读取备份文件失败' })
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务已启动: http://0.0.0.0:${PORT}`)
})
