# Silverbed

一个自托管的图床，围绕**联系表工作流**构建：上传一卷照片，以带编号的帧联系表形式审阅，然后分享、打标签并分发链接 —— 也可以在共享的公开联系表 `/gallery` 浏览全站公开图片。

全栈 TypeScript —— 一个运行时，一个进程同时服务 API 和 UI。

```
Bun + Elysia            API、认证、图像处理管线
Drizzle + Postgres      生产环境用 Supabase，本地用嵌入式 PGlite
sharp                   缩略图、WebP 预览、水印
Vue 3 + Vite + Tailwind UI
```

---

## 快速开始

```bash
bun install
cp .env.example server/.env   # API 脚本以 server/ 为工作目录
bun run seed                  # 演示管理员、文件夹、10 个示例帧、一个 API 密钥
bun run build                 # 将 UI 构建到 web/dist
bun run --cwd server start
```

打开 <http://127.0.0.1:8787>，以 **admin / silverbed123** 登录。公开联系表 <http://127.0.0.1:8787/gallery> 无需账号即可访问。

`DATABASE_URL` 留空时（`.env.example` 的默认值）API 使用内嵌在 `data/pglite` 的 PGlite 数据库，全新克隆无需任何 Postgres。想重来一遍就删掉 `data/`。

开发时如需热重载，在两个终端中分别运行 `bun run dev:api` 和 `bun run dev:web` —— Vite 会将 `/api`、`/i`、`/s` 和 `/image` 代理到 `:8787` 上的 API。

> **嵌入式数据库是单进程的。** 运行 `bun run seed` 前请先停止服务器，否则 PGlite 会拒绝打开服务器已占用的目录。生产环境使用 Postgres，不受此限制。

---

## 功能特性

**上传**
- 拖拽或文件选择器，多文件，带逐文件进度的即时上传队列
- JPEG、PNG、WebP、GIF、AVIF、TIFF、BMP、SVG
- 服务端缩略图（WebP）和预览图；支持 EXIF 方向感知
- 每张图保留相机 EXIF —— 机身、镜头、快门、光圈、ISO、焦距与拍摄时间显示在详情面板
- 内容哈希去重 —— 相同字节只存储一次
- 可选水印、按用户存储配额、最大上传大小
- 访客上传端点（默认关闭）

**组织管理**
- 嵌套文件夹、颜色编码标签、对名称和描述的全文本式搜索
- 按文件设置访问权限：公开或私有（`/i/...` 对匿名访问者返回 404）
- 回收站，支持恢复和永久删除
- 三种布局：联系表、紧凑网格、列表

**公开联系表**
- `/gallery` 对所有人开放：全站公开图片汇成一张联系表，可搜索、排序，三种布局和灯箱
- 私有图不会出现在这里 —— 仍留在所有者自己的「图库」中
- 登录用户只在自己上传的图上看到勾选框，批量栏提供移动、标签、权限、回收站
- 管理员可勾选任意图片、按上传者筛选，并可切换到共享回收站恢复或彻底删除；管理控制台提供「管理全部图片」入口

**分享**
- 对一组文件或整个文件夹创建分享链接
- 密码保护、过期日期、下载开关、撤销
- 一键打包下载整个分享的 ZIP
- 按分享的查看和下载计数、最近访问日志

**API**
- 个人 API 密钥（`X-Access-Key`），限定作用域，仅显示一次
- 上传、列表、修改、删除、批量操作
- 开放端点：`/api/v1/open/random` 和 `/api/v1/open/list`，用于外链和画廊

**运维**
- 管理控制台：概览、用户、站点设置、活动日志、邮件发件箱
- 防盗链，支持域名白名单
- 通过 SMTP 发送注册和分享访问邮件（开发环境使用控制台 + 发件箱回退）
- 亮色和暗色主题，英文和中文

---

## 配置

所有设置均为环境变量，读取的是**进程工作目录下的 `.env`** —— 用仓库自带脚本时即 **`server/.env`**（根目录那份 `.env` 只是镜像，没有任何脚本会加载它）。带注释的模板在仓库根目录：

```bash
cp .env.example server/.env
```

文件里的相对路径按**项目根目录**解析，而不是 `server/`，所以 `DATA_DIR=./data` 仍然指 `<repo>/data`。

### 数据库

| 变量 | 含义 |
| --- | --- |
| `DATABASE_URL` | 任意 Postgres 连接字符串。留空 → 使用内嵌 PGlite（本地开发）。 |
| `PGLITE_DIR` | 覆盖嵌入式数据库的存放位置（默认 `<DATA_DIR>/pglite`）。 |

**自托管 Supabase。** 将 `DATABASE_URL` 指向你自己技术栈的 Postgres。使用官方 Docker Compose 配置时，即 `supabase-db` 容器，或 Supavisor 的连接池端口：

```bash
# Supavisor 事务池（端口 6543）—— 浏览器/API 应使用此地址
DATABASE_URL=postgresql://postgres.<tenant>:<password>@127.0.0.1:6543/postgres
# 直连 Postgres（端口 5432），单 API 实例更简单
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/postgres
```

只使用 Postgres 连接 —— API 通过 Drizzle 使用纯 SQL，不依赖 PostgREST 或 Storage。Schema 在启动时创建，因此空数据库即可满足需求。

> **连接池注意事项。** 端口 6543 以事务模式运行，无法使用预处理语句。客户端已配置 `prepare: false`；如果你指向 6543 并看到 `prepared statement "s1" already exists`，说明某个自定义分支在某处重新启用了预处理。

**本地。** 当 `DATABASE_URL` 为空时，服务器在 `DATA_DIR/pglite` 下运行嵌入式 PGlite 数据库。无需 Docker，无需安装 Postgres。

### 认证

通过 `AUTH_MODE` 选择三种模式：

| 模式 | 行为 |
| --- | --- |
| `local`（默认） | 本应用自行签发 HS256 JWT，并存储 scrypt 密码哈希。 |
| `supabase` | 仅接受 Supabase 访问令牌。 |
| `both` | 本地账户**和** Supabase 令牌 —— 推荐用于自托管迁移。 |

在 `supabase` 和 `both` 模式下，令牌会被验证，未知账户在首次出现时以 `provider="supabase"` 在本地自动创建。管理员权限始终来自本地 `users.role` 列，绝不来自令牌，因此 Supabase 的 `role: "authenticated"` 用户永远无法提权。

支持两种令牌形式：

```bash
# 1. HS256 共享密钥 —— 你 Supabase 技术栈的 JWT_SECRET
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long

# 2. 通过 JWKS 的 RS256/ES256 —— 较新的技术栈使用非对称签名
SUPABASE_URL=http://127.0.0.1:8000
# 可选，默认为 <SUPABASE_URL>/auth/v1/.well-known/jwks.json
SUPABASE_JWKS_URL=
```

密钥缓存 10 分钟，当出现未知 `kid` 时自动重新获取，因此轮换签名密钥无需重启。

**让 GoTrue 管理密码。** 设置 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`，然后：

```bash
SUPABASE_PASSWORD_LOGIN=true
```

登录时会将密码授权代理到 GoTrue，注册则在 Supabase 中创建账户。在启用前有两点后果值得了解：

- 登录使用**邮箱地址**，因为这是 GoTrue 的标识符。仅本地的现有账户将无法再通过密码登录。
- 如果你的项目要求邮箱确认，注册会返回 `pendingConfirmation`，用户必须先确认才能登录。

保持 `false` 可将密码保留在本应用中，同时仍接受来自其他客户端的 Supabase 令牌 —— 这是 `both` 模式的默认行为。

GitHub 和 Google 登录在两种模式下均可工作（需提供客户端 ID）—— 否则按钮保持隐藏：

```bash
GITHUB_CLIENT_ID=...      # 回调：<PUBLIC_BASE_URL>/api/v1/oauth/github/callback
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...      # 回调：<PUBLIC_BASE_URL>/api/v1/oauth/google/callback
GOOGLE_CLIENT_SECRET=...
```

### 存储

`STORAGE_DRIVER=local` 写入 `<DATA_DIR>/uploads` 并通过 `/i/:key` 提供访问。

`STORAGE_DRIVER=s3` 可与任何 S3 兼容服务通信 —— AWS、Cloudflare R2、MinIO、OSS：

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=http://127.0.0.1:9000     # AWS 可省略
S3_REGION=auto
S3_BUCKET=silverbed
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PUBLIC_URL=                        # 可选的 CDN 源，用于公开链接
```

### 邮件

未设置 `SMTP_HOST` 时，每条消息都会打印到控制台**并**记录到管理发件箱，因此开发环境中不会丢失任何内容。设置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS` 和 `SMTP_FROM` 以进行真实投递。

### 其他

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | 监听地址 |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | 构建绝对 URL 时使用的源 |
| `DATA_DIR` | `./data` | 上传文件和嵌入式数据库（相对于项目根目录解析） |
| `WEB_DIST` | `../web/dist` | 由 API 提供的已构建 UI |
| `JWT_SECRET` | 开发值 | **生产环境请更改** |
| `MAX_UPLOAD_MB` | `32` | 单文件限制 |
| `GUEST_UPLOAD` | `false` | 允许匿名上传 |
| `RATE_LIMIT` | `true` | 对认证和上传的按 IP 限流；自动化测试运行设为 `false` |
| `ALLOW_ORIGIN` | `*` | CORS 源 |

---

## 部署

### Docker

```bash
docker compose up -d --build
```

卷 `silverbed-data` 存放上传文件和数据库。要针对本地 MinIO 试用 S3 存储：

```bash
docker compose --profile s3 up -d
# 然后设置 STORAGE_DRIVER=s3 和 S3_ENDPOINT=http://minio:9000
```

### 裸机

```bash
bun install
bun run build
cd server && NODE_ENV=production PORT=8080 bun src/index.ts
```

将其置于反向代理之后。该进程对未知路径提供 `index.html`，因此客户端路由可以正常工作；无需单独的静态服务器。

### Vercel（不需要自己的服务器）

| 组成 | 运行在 |
| --- | --- |
| 前端 | `web/dist`，由 Vercel CDN 托管 |
| 接口 | 一个 Node 函数（`api/handler.ts`），承接 `/api/v1`、`/i`、`/image`、`/s`、`/open` |
| 数据库 | Neon Postgres，通过 `DATABASE_URL` |
| 图片 | Cloudflare R2 存储桶，走 S3 驱动 |

1. **存储桶**：建 R2 桶并绑定公开域名（如 `https://cdn.example.com`）。然后在 *Settings → CORS Policy* 加规则 —— 没有它浏览器预检会失败，直传会报 "CORS Missing Allow Origin"：

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:8787", "http://127.0.0.1:8787"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`S3_ENDPOINT` 填账号级地址（`https://<account>.r2.cloudflarestorage.com`），不带桶名、不带结尾斜杠；误写成 `…/<bucket>` 会被自动去掉。
2. **数据库**：建 Neon 项目，把连接池字符串（带 `?sslmode=require`）填进 `DATABASE_URL`。
3. **项目**：在 Vercel 导入仓库 —— `vercel.json` 已配好构建命令、静态输出目录与重写规则。
4. **环境变量**：

```bash
DATABASE_URL=postgresql://…neon.tech/silverbed?sslmode=require
JWT_SECRET=<32 位以上随机串>
PUBLIC_BASE_URL=https://your-app.vercel.app
AUTH_MODE=local
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=silverbed
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_PUBLIC_URL=https://cdn.example.com
```

5. 部署后打开 `/setup` 创建第一个管理员。

**上传**：函数请求体上限 4.5MB，所以浏览器先调 `POST /api/v1/uploads/sign` 拿预签名 PUT，直传 R2，再调 `POST /api/v1/files/import`；函数只把对象下载回来生成缩略图和预览图。

**出图**：`/i/<id>.<ext>` 直接 302 到存储桶 —— 公开图跳公开 CDN 地址，私有图跳 5 分钟有效的签名地址，图片字节不经过函数。

**已知限制**：分享 ZIP 在函数内打包，Vercel 上受 4.5MB 响应上限约束，大分享请逐张下载；内嵌 PGlite 无法在 serverless 里持久化，因此必须提供 `DATABASE_URL`。想在本机验证 Node 路径：

```bash
bun run build:node
DATABASE_URL= DATA_DIR=$PWD/.tmp-node/data node server/test/node-runner.mjs ./.tmp-node/handler.cjs
```

---

## API

基础路径 `/api/v1`。响应为 `{ "code": 0, "data": … }`；错误为 `{ "code": "…", "message": "…" }`，并带有匹配的 HTTP 状态码。

使用 `Authorization: Bearer <jwt>` 认证，或对于无头上传使用 `X-Access-Key: <key>`。`/gallery` 和 `/open/*` 无需令牌即可读取；其余端点都需要认证。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 存活检查 |
| `GET` | `/meta` | 站点名称、总数、已启用的提供商 |
| `GET` | `/setup/status` · `POST` `/install` | 首次运行向导 |
| `POST` | `/auth/login` · `/auth/register` | 凭据 → JWT |
| `GET` | `/auth/me` · `PATCH` `/auth/profile` · `POST` `/auth/password` | 账户 |
| `GET` | `/files` | 列表；`page`、`pageSize`、`scope`、`folderId`、`access`、`q`、`tag`、`sort` |
| `POST` | `/files/upload` | 多部分上传（`files`，可选 `folderId`、`tags`、`access`） |
| `GET` `PATCH` `DELETE` | `/files/:id` | 读取、重命名/重新打标签/移动、移入回收站 |
| `POST` | `/files/:id/restore` | 从回收站恢复 |
| `POST` | `/files/batch` | 对 `ids` 执行 `move`、`delete`、`restore`、`access`、`tag` |
| `GET` | `/files/stats` · `/stats/overview` | 按用户和仪表盘数字 |
| `GET` | `/gallery` | 共享公开联系表；`page`、`pageSize`、`q`、`sort`、`owner`、`mine`、`scope=trash`（管理员） |
| `POST` | `/gallery/batch` | 对 `ids` 执行同样动作；仅限自己上传的图，管理员可操作全部 |
| `GET` | `/gallery/owners` · `/gallery/owners/:id/folders` | 有公开图的上传者及其文件夹（管理员/本人） |
| `GET` `POST` | `/folders` | 文件夹树和创建 |
| `GET` `POST` | `/tags` | 标签 |
| `GET` `POST` | `/shares` | 分享管理 |
| `GET` | `/public/shares/:token` | 解析分享（支持 `?t=<password>`） |
| `POST` | `/public/shares/:token/unlock` · `/report` | 密码解锁、访问日志 |
| `GET` `POST` `DELETE` | `/keys` | API 密钥 |
| `GET` | `/admin/overview` · `/users` · `/settings` · `/activity` · `/mail` | 管理 |
| `GET` | `/open/random` · `/open/list` | 公开、无需认证的读取 |

公共资源路由位于 `/api` 之外：

```
/i/<id>.<ext>              原图
/i/<id>.thumb.webp         缩略图
/i/<id>.preview.webp       预览图
/image/<id>                带 Open Graph 标签的 HTML 页面
/s/<token>                 分享页面
/s/<token>/download        分享的 ZIP 打包
```

### 从命令行上传

```bash
curl -X POST https://your.host/api/v1/files/upload \
  -H "X-Access-Key: sb_xxx" \
  -F "files=@photo.jpg" \
  -F "tags=landscape,select"
```

---

## 测试

```bash
bun run --cwd server test           # 66 项端到端 HTTP 检查；已播种实例为 53 项（服务器须运行中）
bun run --cwd server test:ui        # 34 项浏览器检查，截图保存到 .ui-shots/
bun run --cwd server test:supabase  # 17 项 Supabase 认证检查，自包含
bun run test:direct             # 13 项直传检查（需要桶存储）
bun run typecheck                # tsc + vue-tsc
```

`test:supabase` 无需 Supabase 实例：它会启动一个最小的 GoTrue 替身，签发真实的 RS256 令牌，然后断言 API 接受这些令牌、拒绝被篡改和伪造的令牌、正确创建用户，并且绝不从令牌声明中授予管理员权限。

浏览器测试套件需要 Playwright Chromium。只装无头 shell 就够，体积也小得多：

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers bunx playwright install chromium --only-shell
export PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers   # 运行套件时指向同一目录，否则会回落到 ~
```

套件默认用 `admin / silverbed123` 登录（可用 `UI_USER` / `UI_PASS` 覆盖），请对已播种的实例运行。

`test:direct` 需要一个存储桶：把 `STORAGE_DRIVER=s3` 指向真实桶（或 `node server/test/fake-s3.mjs` 这个一次性内存端点），它会走一遍 sign → PUT → import → 302 的完整直传链路，并检查私有图与 `?dl=1` 下载。

两套测试均针对运行中的实例。使用以下命令重置到干净状态：

```bash
rm -rf data && bun run seed
```

---

## 目录结构

```
api/
  handler.ts            Vercel 函数入口（web-standard fetch handler）
vercel.json             Vercel 的构建、静态输出与重写配置
server/
  src/
    config.ts            环境变量 → 类型化配置
    db/                  schema、连接、设置、种子数据
    lib/                 ID、JWT、密码哈希、ZIP
    services/            存储驱动、图像管线、认证、邮件、活动
    routes/              每个资源一个模块
    index.ts             应用组装和静态托管
  test/e2e.ts            API 端到端测试套件
  test/ui.ts             浏览器冒烟测试套件
web/
  src/
    components/          FrameTile、Lightbox、InspectorPanel、SideRail……
    views/               library、gallery、upload、stats、shares、keys、settings、admin
    styles/tokens.css    设计令牌

```

## 设计

UI 避免了常见的“AI 仪表盘”外观 —— 没有渐变主视觉、没有悬浮圆角卡片、没有投影。它借鉴了暗房联系表的风格：细线分隔、等宽字体的帧编号、元数据使用 IBM Plex Mono，界面使用 Archivo，以及一个仅用于操作、选中和破坏性控件的安全灯橙色强调色。首页展示的是真实上传的实时联系表，而非营销文案。

设计令牌位于 `web/src/styles/tokens.css`；每种颜色都是带有亮色和暗色值的 CSS 变量。

## 许可证

MIT