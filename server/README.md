# 钟于钢琴工作室 · 备份与认证服务（服务端）

> **定位**：本项目配套微信小程序「钢琴工作室」教学管理场景，服务端采用 **Node.js + Express** 实现微信登录、本地优先数据的云端备份、老板跨账号聚合视图，以及用户资料与静态资源托管。本文档面向 **国赛/创业路演级** 的技术阐述与运维交付，覆盖架构、接口契约、落盘模型、安全策略与排障路径。

---

## 目录

1. [系统架构与技术选型](#1-系统架构与技术选型)
2. [目录结构与运行时模型](#2-目录结构与运行时模型)
3. [环境变量与部署](#3-环境变量与部署)
4. [认证体系（Token 结构、校验、兼容策略）](#4-认证体系token-结构校验兼容策略)
5. [核心模块与函数级说明（index.js）](#5-核心模块与函数级说明indexjs)
6. [HTTP 接口规范](#6-http-接口规范)
7. [数据模型与文件布局](#7-数据模型与文件布局)
8. [老板模式与权限边界](#8-老板模式与权限边界)
9. [安全、稳定性与边界条件](#9-安全稳定性与边界条件)
10. [设计思路（约 3000 字）](#10-设计思路约-3000-字)
11. [设计重点与难点（约 1000 字）](#11-设计重点与难点约-1000-字)
12. [项目研究进度与计划（500 字内）](#12-项目研究进度与计划500-字内)
13. [常见问题与运维排查](#13-常见问题与运维排查)

---

## 1. 系统架构与技术选型

### 1.1 总体架构

- **客户端**：微信小程序，业务数据以 **本地存储为权威来源（Local-first）**，网络可用时异步上传备份；弱网/离线仍可排课。
- **服务端**：轻量级 **无数据库（Database-less）文件存储** 模型，将每位用户的备份序列化为 **JSON 文件 append-only 写入**，降低运维复杂度与冷启动成本，适合工作室规模与快速迭代。
- **身份**：依赖微信 `jscode2session` 换取 `openid`，服务端自签 **HMAC-SHA256** 业务 Token，后续请求通过 `Authorization: Bearer` 鉴权。

### 1.2 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js 18+ | 内置 `fetch`、`crypto`，适配现代语法 |
| Web 框架 | Express 4.x | 轻量、中间件清晰，`express.json` 限制 body 体积 |
| 存储 | 本地文件系统 | `backups/`、`profiles/`、`uploads/` 分层目录 |
| 密码学 | Node `crypto` | HMAC-SHA256 签名 Token |
| 外部依赖 | 微信开放平台 HTTPS API | `api.weixin.qq.com/sns/jscode2session` |

### 1.3 设计取舍

- **不引入关系型数据库**：备份形态天然是「整机快照」，JSON 落盘与版本追溯（按文件名时间戳）一致；代价是跨用户复杂查询需遍历目录（已在老板聚合接口中封装）。
- **追加写入而非覆盖单文件**：每次备份生成新文件，便于事故回溯与人工比对。
- **头像/背景通过 Base64 上传**：简化小程序端临时文件与域名配置心智负担；服务端控制体积上限。

---

## 2. 目录结构与运行时模型

```
server/
├── index.js          # 唯一服务入口：路由 + 业务函数
├── package.json
├── README.md
├── backups/          # 运行时创建：按 openid 分子目录
├── profiles/         # 用户资料 JSON、老板上次查看偏好
└── uploads/          # 静态资源（avatars / backgrounds），通过 /uploads 暴露
```

服务监听 `0.0.0.0:PORT`，适配容器与云主机；生产环境前置 **Nginx 反向代理 + HTTPS**，由 `X-Forwarded-Proto` 与 `PUBLIC_BASE_URL` 协同生成正确的公网资源 URL。

---

## 3. 环境变量与部署

### 3.1 必填环境变量

| 变量 | 含义 |
|------|------|
| `WECHAT_APPID` | 小程序 AppID |
| `WECHAT_SECRET` | 小程序 AppSecret |
| `AUTH_SECRET` | Token 签名密钥，**务必高强度随机（建议 32 字节以上）**，泄露等同于会话伪造 |

### 3.2 可选环境变量

| 变量 | 默认 | 含义 |
|------|------|------|
| `PORT` | `3000` | 监听端口 |
| `PUBLIC_BASE_URL` | 空 | 若设置，如 `https://backup.example.com`，用于拼接头像/背景 **绝对 URL**；避免历史 `http` 或错误 Host 导致小程序域名校验失败 |

### 3.3 安装与启动

```bash
cd /path/to/server
npm install
export WECHAT_APPID="你的小程序appid"
export WECHAT_SECRET="你的小程序secret"
export AUTH_SECRET="超长随机密钥(建议32位+)"
export PUBLIC_BASE_URL="https://your-domain.com"
export PORT=3000
npm start
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

返回字段：`ok`、`hasWechatConfig`、`hasAuthSecret`，用于部署探活与配置巡检。

### 3.4 PM2 常驻（生产推荐）

```bash
cd /opt/piano-backup/server
cat > ecosystem.config.js <<'EOF'
module.exports = {
  apps: [
    {
      name: 'piano-backup',
      script: './index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        WECHAT_APPID: '你的小程序appid',
        WECHAT_SECRET: '你的小程序secret',
        AUTH_SECRET: '超长随机密钥',
        PUBLIC_BASE_URL: 'https://your-domain.com'
      }
    }
  ]
}
EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

重启与日志：

```bash
pm2 restart piano-backup
pm2 logs piano-backup --lines 200
```

---

## 4. 认证体系（Token 结构、校验、兼容策略）

### 4.1 Token 格式

采用 **自定义三段式**（注意 openid 本身可能包含 `.`，因此解析时取 **倒数两段** 为 `expiresAt` 与 `signature`）：

```
token = <openid...>.<expiresAt>.<signature>
signature = HMAC_SHA256(AUTH_SECRET, `${openid}.${expiresAt}`)
```

### 4.2 有效期策略（与客户端协同）

- 服务端常量 `TOKEN_EXPIRES_MS = 100 * 365 * 24 * 60 * 60 * 1000`（约 100 年），登录时 `expiresAt = Date.now() + TOKEN_EXPIRES_MS`。
- **原因**：早期小程序端对 `expiresAt` 有「必须为正」等校验；若服务端返回 `0` 表示永久，旧版本可能拒绝登录。采用 **很大的正数时间戳** 兼顾「长期可用」与「老客户端兼容」。
- `verifyAuthToken` 规则：`expiresAt === 0` 视为永久有效；`expiresAt > 0` 时若当前时间超过则过期。

### 4.3 请求鉴权

- 请求头：`Authorization: Bearer <token>`
- `verifyRequestToken(req)` 解析 Header，调用 `verifyAuthToken`，失败返回 `401` 与统一文案「登录态失效，请重新登录」。

---

## 5. 核心模块与函数级说明（index.js）

下列说明对应 `server/index.js` 内职责划分，便于代码评审与二次开发时快速定位。

### 5.1 全局配置与目录初始化

- **`PORT`**：自环境变量解析，默认 3000。
- **`BACKUP_DIR` / `PROFILE_DIR` / `UPLOADS_DIR`**：`path.resolve` 到进程工作目录下的相对路径，启动时 `fs.mkdirSync(..., { recursive: true })` 保证存在。
- **`express.json({ limit: '8mb' })`**：限制 JSON body，防止异常大包拖垮进程；备份 JSON 一般远小于该值。
- **`app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d' }))`**：头像与背景图可被公网 URL 直接访问；配合 `PUBLIC_BASE_URL` 生成稳定域名。

### 5.2 密码学与 Token

| 函数 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `hmac(content)` | 字符串 | hex 摘要 | `crypto.createHmac('sha256', AUTH_SECRET)` |
| `signAuthToken(openid, expiresAt)` | openid、毫秒时间戳 | token 字符串 | 拼接 payload 后 HMAC |
| `verifyAuthToken(token)` | 完整 token | `{ openid, expiresAt }` 或 `null` | 校验签名与可选过期时间 |

### 5.3 微信登录

| 函数 | 说明 |
|------|------|
| `fetchOpenidByCode(code)` | GET `jscode2session`，失败抛出带微信 `errmsg` 的异常 |
| `handleWechatLogin(req, res)` | 校验 `AUTH_SECRET`、`body.code`，成功返回 `openid`、`token`、`authToken`（兼容字段）、`expiresAt` |

路由：**`POST /api/wx/login`**、**`POST /api/auth/wechat-login`** 共用一个 handler，避免旧客户端路径失效。

### 5.4 请求解析与 URL 规范化

| 函数 | 说明 |
|------|------|
| `verifyRequestToken(req)` | 从 `Authorization` 提取 Bearer Token |
| `normalizeText(value, maxLen)` | 字符串 trim + 最大长度截断，抵御超长恶意输入 |
| `resolvePublicBaseUrl(req)` | 优先 `PUBLIC_BASE_URL`；否则根据 `X-Forwarded-Proto`、`Host` 推断；非 localhost 默认 `https`，避免反代场景下生成 `http` 链接 |
| `normalizeAvatarUrl(url, req)` | 将相对 `/uploads/` 或历史完整 URL 中的路径部分重写为当前站点公网绝对地址 |

### 5.5 图片上传解析

| 函数 | 说明 |
|------|------|
| `parseImageBase64(input)` | 解析 `data:image/<ext>;base64,...`，允许 `jpg/png/webp/gif`，`jpeg` 映射为 `jpg` |

头像接口限制 **2MB**，背景图限制 **4MB**（解码后 buffer 长度）。

### 5.6 备份读写核心

| 函数 | 说明 |
|------|------|
| `listBackupFilesByOpenid(openid)` | 列出 `backups/<openid>/*.json`，按 **mtime 倒序**，第一个即为最新 |
| `readLatestBackupByOpenid(openid)` | 读取最新文件，`JSON.parse`，对 `courses`/`students` 做数组兜底，`settings` 对象兜底；**仅当原始 JSON 存在 `studioExpenses` 键时才挂载该字段**，避免旧备份「缺字段」被解读为空数组覆盖的新语义 |

### 5.7 用户资料与老板偏好

| 函数/路径 | 说明 |
|-----------|------|
| `readProfileByOpenid(openid, req)` | 读取 `profiles/<openid>.json`，昵称截断、头像 URL 规范化 |
| `bossViewPrefsPath(openid)` | `profiles/<openid>.boss_view.json` |
| `GET/POST /api/user/boss-view` | 存取老板跨设备「上次查看的老师」键（如目标 openid 或业务 key），字段 `bossLastViewOwnerKey` |

### 5.8 代码阅读导航（先读这些函数）

- 鉴权链路：`signAuthToken()` -> `verifyAuthToken()` -> `verifyRequestToken()`
- 登录链路：`fetchOpenidByCode()` -> `handleWechatLogin()`
- 备份读写：`listBackupFilesByOpenid()` -> `readLatestBackupByOpenid()` -> `POST /api/backup` / `GET /api/backup/latest`
- 老板能力：`POST /api/backup/target-studio-expenses`、`GET/POST /api/user/boss-view`
- 资源与 URL：`parseImageBase64()`、`resolvePublicBaseUrl()`、`normalizeAvatarUrl()`

---

## 6. HTTP 接口规范

### 6.1 登录

- **`POST /api/wx/login`**、**`POST /api/auth/wechat-login`**
- **Body**：`{ "code": "<wx.login 返回的 code>" }`
- **成功 200**：`{ code: 0, success: true, openid, token, authToken, expiresAt }`
- **失败 400/500**：`{ success: false, message }`

### 6.2 用户资料

- **`GET /api/user/profile`**：需 Bearer；无文件时 `profile: null`。
- **`POST /api/user/profile`**：需 Bearer；Body 含 `nickName`、`avatarUrl` 等；**资料不完整返回 400**。写入后会附带 `updatedAt`。

### 6.3 上传资源

- **`POST /api/user/avatar/upload`**：Body `avatarBase64`；成功返回 `avatarUrl`、`avatarPath`。
- **`POST /api/user/background/upload`**：Body `imageBase64`；成功返回 `imageUrl`、`imagePath`。

### 6.4 备份写入（全量快照）

- **`POST /api/backup`**
- **Body**：
  - `courses`: `array`（必填类型校验）
  - `students`: `array`
  - `settings`: `object`
  - `studioExpenses`: 可选；若非数组则视为 `[]` 写入
- **行为**：在 `backups/<openid>/` 下写入新文件 `backup_<ISO 时间>.json`（时间戳中 `:` `.` 替换为 `-`），**永不覆盖旧文件**。

### 6.5 读取最新备份

- **`GET /api/backup/latest`**
- **普通用户**：返回本人最新 `courses/students/settings`，若存在则含 `studioExpenses`。
- **老板用户**（`settings.bossCertified === true`）：额外返回 `boss: true` 与 **`teachers` 数组**：遍历 `backups/` 下所有 openid 子目录，每位老师取最新备份，合并 `profiles` 内昵称头像；按 `backupAt` 降序、昵称拼音排序。每位老师的 `studioExpenses` 同样仅在有键时返回。

### 6.6 老板代写目标老师「工作室支出」

- **`POST /api/backup/target-studio-expenses`**
- **Body**：`{ targetOpenid, studioExpenses }`
- **权限**：调用者最新备份中 `bossCertified === true`；目标必须已存在至少一份备份。
- **行为**：读取目标最新课表/学生/设置，**仅替换** `studioExpenses`，写入目标目录新快照文件；用于老板维护公用成本而不篡改老师课程数据。

---

## 7. 数据模型与文件布局

### 7.1 备份 JSON（示意）

```json
{
  "openid": "用户唯一标识",
  "courses": [],
  "students": [],
  "settings": {},
  "studioExpenses": [],
  "backupAt": "ISO8601 时间戳"
}
```

`settings` 中含业务开关（如 `bossCertified`）由客户端定义，服务端仅透传与用于分支逻辑。

### 7.2 落盘路径一览

| 类型 | 路径模式 |
|------|----------|
| 备份 | `backups/<openid>/backup_<YYYY-MM-DDTHH-mm-ss>.json` |
| 用户资料 | `profiles/<openid>.json` |
| 老板查看偏好 | `profiles/<openid>.boss_view.json` |
| 头像 | `uploads/avatars/<openid>_<time>_<rand>.<ext>` |
| 背景 | `uploads/backgrounds/<openid>_<time>_<rand>.<ext>` |

---

## 8. 老板模式与权限边界

1. **认证来源**：老板身份不由服务端独立账号系统维护，而是依赖用户备份内 **`settings.bossCertified === true`**（由业务流程认证页写入）。服务端在 `/api/backup/latest` 与 `/api/backup/target-studio-expenses` 检查该标志。
2. **读扩散**：老板拉取 `latest` 时返回全量老师列表，属于 **O(n) 目录扫描**；n 为工作室老师数量，在可控规模内可接受。
3. **写隔离**：老板对用户课程数据无直接 PATCH；仅 **工作室支出** 可通过专用接口合并写入目标用户备份链。

---

## 9. 安全、稳定性与边界条件

- **密钥**：`AUTH_SECRET` 与微信 Secret 不得入库代码仓库；生产使用环境注入或保密配置中心。
- **Token 泄露**：Bearer 无状态，泄露后可被重放；小程序侧应配合 HTTPS 与存储最小化；更高级方案可引入短期 Token + 刷新（当前未实现）。
- **JSON 注入**：备份内容为业务数据，服务端不做深度校验；依赖客户端与运营信任模型。
- **磁盘满**：`writeFileSync` 失败返回 500；需主机层监控磁盘。
- **openid 安全**：所有写路径经 Token 解出 openid，用户只能写入自身目录（老板代写接口除外且额外校验老板标志）。

---

## 10. 设计思路（约 3000 字）

本服务端承载的真实业务，并不是「高并发互联网通用平台」，而是一个 **典型小微企业工作室的教学管理场景**：老师分散排课、负责人需要汇总收支、设备与场租等成本需要与课酬拆分统计，同时团队 IT 能力有限，无法接受复杂数据库运维与频繁迁移。基于这一现实约束，整体设计的底层逻辑是：**把复杂度留给可控的单进程服务与清晰的文件结构，把「灵活查询」交给客户端侧本地 SQLite 式的体验（实际为小程序 Storage + 页面聚合），把「权威与追溯」交给不可变备份文件链**。换言之，这是一个刻意选择的 **Local-first + 文件快照云备份** 架构，而不是传统以服务端为中心、所有读写都走实时数据库的 CRUD 模型。

这种选择在创业与国赛语境下可以用一句话解释：**我们优先解决「老师能不能稳定用起来」和「数据丢了能不能找回来」**，而不是优先解决「千万级用户下的 SQL 优化」。教学场景的数据特征是多写少查、强个人归属、弱协同冲突；冲突往往发生在「负责人要看汇总」与「老师本地还没上传」之间，而不是发生在「两个老师同时改同一行记录」这种典型并发写场景。因此，把「汇总视角」实现为 **老板端聚合读取 + 定期快照**，比强行上分布式事务更符合真实频率与成本结构。

在身份与信任模型上，微信生态提供了天然的用户主键 **openid**，服务端无需自建注册登录表单，也无需存储密码哈希；代价是业务账号体系完全绑定微信，但这是小程序场景的常态。服务端在 openid 之上构造 **HMAC 签名 Token**，避免在传输与日志中暴露微信 session_key，同时让无会话状态的 Node 进程可以用纯密码学完成鉴权——这与「JWT 思路」相似，但实现刻意保持极简：无额外依赖库、无复杂 claims，只绑定 **谁能写哪个目录**。Token 设计采用「openid + 过期时间 + 签名」三段式，并对 openid 中可能出现的点号做了 **从右侧解析** 的容错：若错误地按第一个点分割，会把 openid 截断，造成签名永远对不上。这是在工程实践中容易被忽略的细节，却是线上鉴权稳定性的关键之一。

关于 **有效期与兼容性**：早期客户端普遍假设 `expiresAt` 为正整数才能登录成功，若简单地用「0 表示永久」会在老版本形成大面积登录失败。项目的折中方案是采用 **跨越业务生命周期的正数过期时间戳**，在语义上等价于长期有效，同时满足旧代码的路径分支。进一步地，服务端校验允许 `expiresAt === 0` 表示永久，是为了给新版本客户端预留演进空间；而签发侧采用正数大偏移，是为了照顾旧版本。**同一字段新老语义并存** 在教科书上常被批评为「技术债」，但在真实交付里往往是「可用性」的必要成本。这一决策体现了 **后端演进必须以客户端分布为前提** 的系统观——真实世界的软件极少「全员瞬间升级」，尤其是小程序存在审核周期与用户更新惰性。

数据层采用 **append-only 备份文件** 而非单文件覆盖，原因有三：第一，教学纠纷或误操作时，管理员可直接对比两份 JSON 或在服务器保留的历史文件中找回；第二，写入失败时不会破坏上一份已知良好快照；第三，实现简单，无需事务日志，排障路径短——运维可以直接 `ls -lt` 看最新文件时间是否符合预期。代价是磁盘占用随时间增长，因此在运维层面建议定期归档冷备份或压缩历史目录；这一职责放在运维而非应用内，以保持应用代码简洁，并避免在应用里误删用户历史。换言之，**可追溯性**被当作一等需求，而不是事后补救。

**老板模式** 的设计反映了线下组织的权力结构：负责人需要看到所有老师的授课与营收概况，但不应随意篡改老师的课表记录以免引发责任归属争议。因此服务端将老板的「写权限」压缩到 **工作室支出** 这一单独维度：支出通常由负责人掌握发票与对公账户信息，老师端主要关心课时与学生；通过专用接口把支出写入目标老师的备份快照中，可在会计逻辑上保持「老师数据只读、成本项可协同维护」。与此同时，`bossCertified` 放在用户 settings 中由备份携带，而不是单独建「角色表」，是为了延续 **「一切以备份快照为真相」** 的原则：服务器不必维护第二套用户体系，减少不一致源。聚合接口在老板身份下返回 `teachers` 全列表，是在 **小规模 n** 前提下用 **目录扫描** 换取实现速度与可维护性；若未来老师数量级上升，可渐进引入索引文件或嵌入式 KV，而不必推翻现有 JSON 契约。

资源上传采用 **Base64 直传**，是为降低小程序端文件路径、域名白名单与临时路径处理的组合复杂度；服务端限制图片大小并在磁盘随机命名，避免同名覆盖与缓存混淆。头像 URL 通过 `PUBLIC_BASE_URL` 与 **反代头** 协同修正，是为了解决「Express 在 Nginx 后看到 http 协议从而生成错误链接」的经典部署坑，保证小程序端 **HTTPS 与合法 downloadFile 域名** 一致。这里体现的思路是：**把部署层面的不确定性（域名、TLS、反代）收敛为少量环境变量与头部约定**，而不是让每个前端版本硬编码绝对地址。

从接口风格看，本项目服务端刻意保持 **「薄后端」**：尽量只做鉴权、落盘、聚合与静态托管，不对课程字段做深校验。深层原因是教学业务规则迭代快（计费比例、年度汇总、工作室支出口径），若规则强绑定在服务端，会变成频繁发版与数据迁移；当前策略是把计算与校验放在 TypeScript 工具层（小程序侧），服务器保存 **已达成共识的快照**。这与「领域模型应该在服务端」的经典教条冲突，但在垂直小团队的现实中，**迭代效率与可验证性**往往优先——前提是团队清楚边界：服务端不负责帮你「算对」，负责帮你「存住」。

最后在可靠性与用户心智层面，Local-first 必然带来「同步滞后」问题：老板看到的是上次成功备份的世界，而不是老师屏幕上的即时状态。产品与技术必须同事协作把这句话讲清楚，否则会出现误判为「服务器坏了」。本项目的工程对策包括：登录刷新时的明确二选一、上传前本地快照、失败自动重试等；而这些能力的根基，仍然是 **append-only 快照 + 可核对的时间戳文件名**。综上，本服务端的哲学可以概括为：**用最少活动部件完成可信备份与身份闭环，用文件不可变性与清晰接口边界换取可运维性，用渐进兼容策略换取真实用户环境下的平滑升级**。它不追求通用性，而追求在垂直场景下的 **可靠、可解释、可排障**——这也是创业与国赛技术文档中值得强调的「问题驱动设计」而非「技术驱动堆砌」。

在此基础上，还可以从「科研与工程方法论」角度补充一条：**可证伪的故障假设**。当出现「老板看不到新课」时，一线排查顺序应当是「目标老师目录是否有新备份文件 → token 是否有效 → 网络是否成功 → 客户端是否触发上传」，而不是首先怀疑聚合排序或前端渲染。服务端提供的文件名时间戳与 `backupAt` 字段，本质上就是把分布式系统中的「因果顺序」简化成运维可读的证据。反过来，这也要求团队在演示或路演时诚实交代：**这不是实时协同编辑系统**，而是「强本地 + 弱同步」工具链；把边界说清楚，反而更容易获得评委对「真实落地」的认可。

面向未来演进，本架构预留了几条 **非破坏式升级路径**：其一，在不大改接口的前提下，把 `listBackupFilesByOpenid` 的扫描结果缓存为侧车索引文件，以降低老板聚合成本；其二，把 `uploads` 逐步迁移到对象存储，只在数据库或索引里保存 URL；其三，若合规升级要求加密，可在客户端加密后再走现有备份管道，服务端仍然只存 blob。换言之，**当前的「薄后端」不是偷懒，而是刻意保留替换零件的空间**：文件目录是最通用的持久化抽象之一。

最后从「比赛文档叙事」角度归纳：**创新性**并不体现在堆砌新技术名词，而体现在把工作室的真实业务流程抽象成可落地的数据流——登录换取身份、快照承载真相、老板聚合承载管理视角、专用写入承载成本科目。**可持续性**则体现在部署成本低、依赖少、恢复路径短：哪怕只剩磁盘备份文件，也能重建运营连续性。对于评委追问「为何不上 MySQL」，标准回答是：**在团队规模与场景边界明确时，正确的问题是 TCO（总拥有成本）与恢复时间，而不是默认选型**；当业务复杂度跨过阈值再引入数据库，反而是对客户与自己的负责。

再把接口分层翻译成赛场语言：**认证层**解决「你是谁」；**备份写入层**解决「你把可信快照交给服务器保管」；**latest 读取层**解决「换机恢复」与「老板聚合视图」两类读者；**资料与上传层**解决「品牌形象与个人主页展示」。四层彼此独立，却又共用同一套 Token 与目录隔离策略，使得单人开发者也能维护代码心智模型。与此同时，服务端刻意避免引入「隐式后台任务」（定时清理、定时合并），是为了让行为完全由 HTTP 请求触发，日志与复现路径更简单——这在答辩演示「现场抓包就能看到备份落地」时尤其友好。

补充一句实施层面的自我约束：`index.js` 单文件承载路由与逻辑，并不是鼓励「巨石」，而是在当前规模下减少模块边界带来的上下文切换成本；当测试用例与路由数量继续增长，再拆分为 `routes/` 与 `services/` 也不破坏对外契约。文档与代码一齐强调：**先证明价值，再抽象框架**，符合创新创业项目的迭代纪律。至此，设计思路条目的目标，是把「为什么这样写」讲透，使评委即使不熟悉小程序细节，也能判断方案的合理性与可维护性。

---

## 11. 设计重点与难点（约 1000 字）

**重点一：Local-first 与云端一致性语义。** 客户端以本地为权威，服务端备份是快照而非实时数据库；因此会出现「老师本地持续新增课程但长期未上传」的漂移。项目通过 Token 长期有效、静默续登上传、失败队列重试、手动刷新登录时的二选一（上传本地 / 恢复云端）等手段缓解。**难点**在于：不能用统一强一致模型欺骗用户，必须在产品层明确「备份成功时刻」与「老板看到的滞后」之间的关系；一旦出现纠纷，服务器目录里的时间戳反而能成为客观证据链。

**重点二：老板全量列表的性能与隐私权衡。** `GET /api/backup/latest` 在老板场景需扫描 `backups/` 下所有 openid 子目录并读取各自最新文件；在数十人规模内可接受，且实现极简、排障直观。**难点**在于组织扩张后 CPU 与 IO 线性增长；需要引入索引或分页聚合，同时注意「老师列表」涉及敏感经营数据，必须在账号体系与认证流程上防止老板权限被冒用。

**重点三：字段演进与向后兼容。** `studioExpenses` 从无到有，若服务端在读取最新备份时无条件构造空数组，可能对旧备份产生「误清空」语义，进而污染下游恢复逻辑。实现上在 `readLatestBackupByOpenid` 中采用 **`Object.prototype.hasOwnProperty.call(parsed, 'studioExpenses')`** 判断键是否存在，再决定是否挂载字段。**难点**是 JSON 无 Schema 约束时，必须在读写两端统一契约，并在文档中明确「缺键不等于空数组」。

**重点四：部署环境与 URL 一致性。** 小程序对图片域名、HTTPS、`downloadFile` 合法域名要求严格；服务端必须在多种部署拓扑下生成正确的绝对 URL。**难点**集中在反向代理、`Host`、`X-Forwarded-Proto` 与显式 `PUBLIC_BASE_URL` 的优先级设计：既要兼容本地调试，又要避免线上生成 `http://内网` 或错误主机名。

**重点五：权限边界最小化。** 老板仅能写入「工作室支出」专用接口，其余仍走老师本人 Token；服务端双轨校验 **调用者最新备份 `bossCertified === true` + 目标存在可用备份**，避免对从未同步的用户写入悬空数据。**难点**在于业务侧仍需线下流程保证老板账号不被滥用（认证页与人为信任），服务端只能做到「技术上的最小权限」，无法替代组织治理。

**重点六：运维可观测性与成本控制。** append-only 带来磁盘增长；缺少数据库也意味着缺少开箱即用的慢查询分析。**难点**是把监控焦点放在「备份文件是否持续增长」「老板聚合耗时是否异常」这类贴近业务的信号上，而不是照搬互联网大盘的 QPS 指标。

**重点七：异常路径下的用户体验。** 登录失败、上传失败、读取失败在小团队中会造成「全员停摆」的心理感受。**难点**在于服务端错误码与文案必须稳定可区分（401 与 400、404），客户端才能给出「去重新登录」还是「稍后重试」；同时又要避免把内部路径泄露给终端用户。

**重点八：Express JSON 体积与恶意大包。** `express.json({ limit: '8mb' })` 为备份预留空间，但也可能被滥用。**难点**是在不设数据库审计的前提下，靠主机防火墙、反向代理限流与日志轮转降低风险；必要时应在网关层再加一层 body 大小与速率限制。

**重点九：`POST /api/backup/target-studio-expenses` 的一致性。** 该接口读取目标最新快照后替换 `studioExpenses` 再写入新文件，若并发发生可能被覆盖。**难点**是小工作室并发极低，但仍需在客户端侧提示「保存后立即刷新」；若未来并发升高，应在服务端引入基于 `backupAt` 的乐观锁或序列号。

---

## 12. 项目研究进度与计划（500 字内）

**已完成**：微信登录与 HMAC Token、全量备份追加写入、最新备份读取、老板老师聚合列表、老板偏好同步、工作室支出代写接口、用户资料与头像/背景上传、健康检查与静态资源托管；与小程序协同完成登录冲突选择、上传前本地快照、失败重试与 Token 兼容策略。

**进行中/短期**：磁盘与备份目录的运维规范（归档策略、告警）、可选的管理员工具脚本（按 openid 导出/校验 JSON）、接口响应时间与目录规模的基准测试。

**中期**：若用户规模上升，引入轻量索引（如每个 openid 最新 `backupAt` 的 sidecar 文件）以降低老板聚合成本；可选迁移对象存储承载图片与大备份。

**长期**：探索端到端加密备份（密钥仅用户设备持有）以满足更高合规需求；多租户后台与审计日志。

---

## 13. 常见问题与运维排查

### 13.1 老师本地有课，老板看不到新课

在服务器检查该老师目录是否有新备份：

```bash
cd /opt/piano-backup/server/backups/<teacher_openid>
ls -lt | head
```

若无新文件，多为老师端 Token 失效、弱网未重试成功或旧版本客户端。建议老师：**个人 → 刷新登录 → 以上传本地为准 → 数据备份页手动上传**。

### 13.2 老版本「登录失败」

多见于服务端返回字段与老前端校验不兼容。当前采用 **正数超长 `expiresAt`** 兼容旧客户端；部署后务必 **重启进程**。

### 13.3 代码发布后不生效

```bash
pm2 restart piano-backup
pm2 logs piano-backup --lines 200
```

---

## 附录：与小程序端的契约提示

- 备份 Body 须与控制端 `Course`/`Student`/`AppSettings`/`StudioExpense` 类型一致；服务端主要做类型兜底与文件写入。
- 客户端应在成功登录后尽早触发一次备份上传，使服务器侧存在可用快照，便于老板模式与他人恢复。

---

*文档版本随 `server/index.js` 演进维护；部署变更请以实际环境变量与 Nginx 配置为准。*
