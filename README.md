# 美团券夹 · 领券助手

复刻自 `ffgd.ssss66.xyz` 商家券收藏页，并做优化。纯前端 + Cloudflare Pages 边缘函数，**零后端依赖**，数据存浏览器 `localStorage`。

## 功能

- 🔍 粘贴**美团分享链接**自动识别 `poi_id_str` 并收藏
- 🎟️ 领取商家券 / 二次领取（打开真实美团 v8 / v6 链接，可切号）
- 📊 全站领券统计次数（头部胶囊 + 统计条实时累加）
- 📌 置顶、🗑️ 删除、➕ 新增/编辑（填 `poi_id_str` 即可生成领取链接）
- 🌗 深色模式、💾 导入/导出 JSON、🗑️ 清空
- 🔗 **深度链接 / JSON API**（配合 iOS 快捷指令一键领取，见下）

## 深度链接（iOS 快捷指令一键领券）

部署后，把下面 `你的域名` 换成实际地址，在「快捷指令」App 里用「打开 URL」动作即可：

| 链接 | 效果 |
|------|------|
| `https://你的域名/?url=<美团分享链接>` | 自动识别并弹出店铺详情 |
| `https://你的域名/?claim=<poi_id_str>` | 直接打开 v8 领券链接（iOS 上自动提示跳转美团 App） |
| `https://你的域名/?claim=<poi_id_str>&v=6` | 直接打开 v6 第二张领券链接 |
| `https://你的域名/?open=<任意url>` | 直接打开该链接 |
| `https://你的域名/?poi=<poi_id_str>` | 打开本机已收藏的该商家详情 |

**典型快捷指令**：
1. 新建快捷指令 → 添加「获取剪贴板」→ 添加「打开 URL」→ URL 填 `https://你的域名/?url=剪贴板`
2. 复制美团分享文字后点一下快捷指令 → 自动跳到店铺详情领取页。
3. 想直接领：URL 改为 `https://你的域名/?claim=剪贴板里的poi`（或先用「匹配文本」从分享里抠出 poi_id_str）。

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

## 一键部署到 Cloudflare Pages

**方式一：Git 连接（推荐，自动持续部署）**
1. 把本目录推到 GitHub 仓库。
2. Cloudflare 控制台 → **Workers & Pages → 创建 → Pages → 连接到 Git**。
3. 构建命令：**留空**；**输出目录（Build output directory）：`.`**（点号，根目录）。
4. 部署完成后，`functions/resolve.js` 会自动成为 `/resolve` 与 `/api/claim` 边缘接口。
5. 之后每次 `git push` 自动重新部署。

**方式二：CLI 一条命令**
```bash
npm i -g wrangler
wrangler login
wrangler pages deploy . --project-name meituan-coupon
```
本地预览：`wrangler pages dev .`；本地 Node 服务：`node server.js`（含 `/resolve`，默认 `http://localhost:8123`）。

> `wrangler.toml` 已配置 `pages_build_output_dir = "."`，直接 `wrangler pages deploy .` 即可。

## 使用

1. 卡片上点「领取 v8 / 领取 v6」即可打开对应美团页面；点卡片看详情与提示。
2. 想加新商家：点「＋ 新增」，填商家名 + `poi_id_str`（从美团店铺分享链接里获取）。
3. 数据存浏览器 `localStorage`，建议定期「导出数据」备份。

> 本项目仅用于个人收藏与快速访问领取链接，请遵守相关平台规则。

