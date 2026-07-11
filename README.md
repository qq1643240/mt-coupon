# 美团津贴 · 领券助手

复刻自 `ffgd.ssss66.xyz` 商家券收藏页，并做优化。纯前端 + Cloudflare Worker（边缘函数 + 静态资源托管），**零后端依赖**，数据存浏览器 `localStorage`。

## 功能

- 🔍 粘贴**美团链接**自动识别 `poi_id_str` 并收藏
- 🎟️ 领取商家券 / 二次领取（打开真实美团 v8 / v6 链接，可切号）
- 📊 全站领券统计次数（头部胶囊 + 统计条实时累加）
- 📌 置顶、🗑️ 删除、➕ 新增/编辑（填 `poi_id_str` 即可生成领取链接）
- 🌗 深色模式、💾 导入/导出 JSON、🗑️ 清空
- 🔗 **深度链接 / JSON API**（配合 iOS 快捷指令一键领取，见下）

## 深度链接（iOS 快捷指令一键领券）

部署后，把下面 `你的域名` 换成实际地址，在「快捷指令」App 里用「打开 URL」动作即可：

| 链接 | 效果 |
|------|------|
| `https://你的域名/?url=<美团链接>` | 自动识别并弹出店铺详情 |
| `https://你的域名/?claim=<poi_id_str>` | 直接打开 v8 领券链接（iOS 上自动提示跳转美团 App） |
| `https://你的域名/?claim=<poi_id_str>&v=6` | 直接打开 v6 第二张领券链接 |
| `https://你的域名/?open=<任意url>` | 直接打开该链接 |
| `https://你的域名/?poi=<poi_id_str>` | 打开本机已收藏的该商家详情 |

**推荐用法：`?jk` 一键直跳美团 App（最快路径）**
把整段美团分享话术（含 `dpurl.cn` 短链）拼进 `?jk=v8=`，Worker 解析出 `poi_id_str` 后**直接 302 跳 `imeituan://`** 唤起 App 进领券页；`v6` 为领第二张。无需打开本站页面，最适合做快捷指令。

**典型快捷指令（方案 A：手动运行，最省事）**
1. 快捷指令 App → 右上角「+」→ 新建，改名「美团领券」。
2. 添加动作 **「获取剪贴板」**（变量名默认「剪贴板」）。
3. 添加动作 **「URL」**：输入框先输入固定前缀 `https://你的域名/?jk=v8=`，再把「剪贴板」变量拖进来拼在后面（「URL」动作会自动对拼接内容做 URL 编码，含中文、空格、`&` 等特殊符号，正常无需手动「URL 编码」；若个别字符仍异常，可在前面加一步「URL 编码」动作）。
4. 添加动作 **「打开 URL」**，把上一步的 URL 变量接进去。
5. 保存。用法：复制美团分享话术 → 运行「美团领券」→ Safari 弹出「是否打开美团」→ 确认即跳 App 领券。领第二张把前缀里的 `v8` 改成 `v6`。

**进阶方案 B：共享表单（最顺手，推荐）**
不用先复制，在微信/美团里直接「分享」触发：
1. 新建快捷指令，进入编辑后点顶部「⋯」→ 打开 **「在共享表单中显示」** → 共享类型只勾 **文本** 和 **URL**（避免污染照片等）。
2. 此时会得到输入变量 **「快捷指令输入」**。
3. 添加 **「URL」**：前缀 `https://你的域名/?jk=v8=` + 拼上「快捷指令输入」。
4. 添加 **「打开 URL」** 接上该 URL。
5. 用法：在微信里长按美团分享消息 → 转发/分享 → 选「美团领券」→ 直接跳 App。

**方案 C：本站一键按钮（无需快捷指令）**
站点顶部新增「📋 读剪贴板 · 直跳美团 App 领券」按钮：复制美团分享链接后点一下，自动
读取剪贴板 → `/resolve` 解析 `poi_id_str` → `location.href` 跳 `imeituan://www.meituan.com/web?url=<领券页>` 唤起 App。
按钮右侧可切 **v8 主券 / v6 第二张**；领券成功会自动标记已领并累加统计。

**方案 E：把按钮变成一条链接 / 快捷指令（`?jkclip`，最懒人）**
不想在快捷指令里拼剪贴板文本？直接用这条链接，打开后**页面自己读剪贴板**并跳 App，等价于点首页按钮：
- `https://你的域名/?jkclip=v8` → 读剪贴板里的美团分享 → 跳 App 领主券
- `https://你的域名/?jkclip=v6` → 第二张

快捷指令做法（最简）：「打开 URL」→ 网址直接填 `https://你的域名/?jkclip=v8`。
之后复制美团分享 → 跑这个快捷指令 → 打开页面自动读剪贴板跳 App（iOS 若自动读剪贴板被系统拦截，点一下页面顶部按钮即可）。

> 说明：`handleDeepLink` 会从整段文字里抠出**第一个链接**，所以哪怕把整段「我最近很喜欢……http://dpurl.cn/…」拼进 `?jk=`，也能正确识别链接。`/resolve` 会用 iPhone UA 跟随 `dpurl.cn` 的 302 跳转解析出 `poi_id_str`。

**方案 D：直接领取（已知 poi 时）**：
- 「打开 URL」直接填 `https://你的域名/?claim=<poi_id_str>`（iOS 上自动提示跳转美团 App）。
- 先用方案 A/C 识别过一次后，在店铺详情页「复制地址」即可拿到该商家的 `poi_id_str`。

**关于 `dpurl.cn` 这类点评系短链**：
- 短链可能带反爬或多层跳转，极少数情况 `/resolve` 跟随失败。此时页面会提示「已跟随跳转但链接里没有 poi_id_str」。
- 兜底方案：手动从美团店铺分享里取 `poi_id_str`，用 `?claim=` 直接领，不影响使用。

## JSON API（脚本 / 程序调用）

`GET /api/claim?poi=<poi_id_str>` 返回：

```json
{ "ok": true, "poi": "7FATrlwYZgjK0Wo13H0zOAI",
  "v8": "https://offsiteact.meituan.com/...v8...",
  "v6": "https://offsiteact.meituan.com/...v6..." }
```

`GET /resolve?url=<分享链接>` 跟随重定向解析出 `poi_id_str`：

```json
{ "ok": true, "poi": "7FATrlwYZgjK0Wo13H0zOAI", "finalUrl": "..." }
```

## 一键部署到 Cloudflare（Worker + 静态资源）

> Cloudflare 现已把 Pages 合并进 Workers，新项目统一建为 **Worker**。`wrangler.toml` 已改为 `main = "worker.js"` + `[assets]` 托管静态文件，`functions/` 已删除。

**方式一：Git 连接（推荐，自动持续部署）**
1. 把本目录推到 GitHub 私有仓库。
2. Cloudflare 控制台 → **Workers & Pages → 创建 → 选择 Worker → 连接到 Git**。
3. 选中仓库后，构建/部署配置填：
   - **路径 / 根目录（Root directory）**：`.`（点号）
   - **部署命令（Deploy command）**：`npx wrangler deploy`
   - **非生产分支部署命令（Preview deploy command）**：`npx wrangler deploy`
   - 构建命令：**留空**
4. 保存并部署。部署完成后：
   - `index.html` 自动成为首页
   - `worker.js`（main 入口）接管 `/resolve` 与 `/api/claim` 边缘接口
   - 其余静态文件由 Worker 的 `assets` 托管
5. 之后每次 `git push` 自动重新部署。

**方式二：CLI 一条命令（不连 Git）**
```bash
npm i -g wrangler
wrangler login
wrangler deploy
```
本地预览：`wrangler dev`；本地 Node 服务：`node server.js`（含 `/resolve`，默认 `http://localhost:8123`）。

> 注意：`.assetsignore` 已排除 `worker.js`/`wrangler.toml`/`server.js` 等，避免它们作为站点静态资源被公开。

## 使用

1. 卡片上点「领取 v8 / 领取 v6」即可打开对应美团页面；点卡片看详情与提示。
2. 想加新商家：按 `N` 键或 `⌘/Ctrl+K` 打开命令面板选「新增」，填商家名 + `poi_id_str`（从美团店铺分享链接里获取）。
3. 数据存浏览器 `localStorage`，建议定期「导出数据」备份。

> 本项目仅用于个人收藏与快速访问领取链接，请遵守相关平台规则。

