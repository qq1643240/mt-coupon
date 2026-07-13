// 宝塔 / 自托管版 Node 服务（server.js）—— 与 worker.js 功能对齐：
// 提供静态文件 + /resolve + /api/claim + /api/shop + ?jk= 深链 + /api/deeplink(含 format=page 中转页)
// 端口 8123，本地运行：node server.js
const http = require('http'), https = require('https');
const fs = require('fs'), path = require('path');
const { URL } = require('url');
const root = __dirname;
const port = process.env.PORT || 8123;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const crypto = require('crypto');

/* ---- SSRF 防护：服务端只跟随白名单域名（防止被用作内网/外网 SSRF 跳板）---- */
const ALLOWED_HOSTS = ['meituan.com', 'dianping.com', 'dpurl.cn', 'meishi.com'];
function hostAllowed(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  return ALLOWED_HOSTS.some(d => h === d || h.endsWith('.' + d));
}
/* 同步接口签名（HMAC-SHA256）；HTTPS 环境下客户端用 Web Crypto 计算，服务端校验 */
function hmacSync(key, data) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }

/* ---- 后台管理：活动链接 / 定位点（JSON 文件存储）---- */
const dataDir = path.join(root, 'data');
try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
function loadJson(fp, def) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return def; } }
function saveJson(fp, v) { try { fs.writeFileSync(fp, JSON.stringify(v, null, 2)); } catch (e) {} }
function str(v, n) { return String(v == null ? '' : v).slice(0, n); }

/* ---- 后台登录令牌（内存，重启失效；带过期时间，个人自用足够）---- */
const adminTokens = new Map(); // token -> 过期时间戳(ms)
const TOKEN_TTL = 24 * 3600 * 1000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'mt6866admin';
const adminFile = path.join(dataDir, 'admin.json');
function readAdminPass() {
  try { const o = JSON.parse(fs.readFileSync(adminFile, 'utf8')); if (o && o.pass) return o.pass; } catch (e) {}
  return ADMIN_PASS;
}
function writeAdminPass(p) { try { fs.writeFileSync(adminFile, JSON.stringify({ pass: p })); } catch (e) {} }
function genToken() { return crypto.randomBytes(24).toString('hex'); }
function readBody(req) {
  return new Promise(resolve => {
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}
function authOk(req) {
  // 清理过期令牌
  const now = Date.now();
  for (const [t, exp] of adminTokens) if (exp <= now) adminTokens.delete(t);
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m && adminTokens.has(m[1])) return true;
  const ck = (req.headers['cookie'] || '').match(/admin_token=([^;]+)/);
  if (ck && adminTokens.has(ck[1])) return true;
  return false;
}
function handleCrud(req, res, u, name, file, build) {
  const fp = path.join(dataDir, file);
  const idm = u.pathname.match(new RegExp('/api/' + name + '/(.+)$'));
  const id = idm ? decodeURIComponent(idm[1]) : null;
  if (req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': types['.json'] });
    res.end(JSON.stringify({ ok: true, data: loadJson(fp, []) }));
    return;
  }
  if (!authOk(req)) {
    res.writeHead(401, { 'Content-Type': types['.json'] });
    res.end(JSON.stringify({ ok: false, error: '未授权：请先在后台登录' }));
    return;
  }
  readBody(req).then(body => {
    let obj; try { obj = JSON.parse(body || '{}'); } catch (e) {
      res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'invalid json' })); return;
    }
    let arr = loadJson(fp, []);
    if (req.method === 'POST') {
      const item = build(obj); item.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); item.updatedAt = Date.now();
      arr.unshift(item); saveJson(fp, arr);
      res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, item }));
    } else if (req.method === 'PUT' && id) {
      const i = arr.findIndex(x => x.id === id);
      if (i < 0) { res.writeHead(404, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'not found' })); return; }
      arr[i] = Object.assign({}, arr[i], build(obj), { id, updatedAt: Date.now() });
      saveJson(fp, arr);
      res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, item: arr[i] }));
    } else if (req.method === 'DELETE' && id) {
      arr = arr.filter(x => x.id !== id); saveJson(fp, arr);
      res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, count: arr.length }));
    } else {
      res.writeHead(405, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    }
  });
}

/* 服务端跟随重定向，取出最终 URL（Node 无跨域限制，可解析任意短链） */
function follow(u, depth, cb, opts) {
  opts = opts || {};
  const maxBytes = opts.maxBytes || 2 * 1024 * 1024; // 读取正文上限 ~2MB，防内存撑爆
  const timeoutMs = opts.timeout || 15000;
  if (depth > 8) return cb(null, u);
  let urlObj;
  try { urlObj = new URL(u); } catch (e) { return cb(e); }
  if (!hostAllowed(urlObj.hostname)) return cb(new Error('目标域名不在允许列表内'));
  const mod = urlObj.protocol === 'https:' ? https : http;
  const reqOpts = {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      'Accept': 'text/html,application/xhtml+xml,*/*'
    }
  };
  let done = false;
  const finish = (e, url, body) => { if (done) return; done = true; cb(e, url, body); };
  const rq = mod.request(u, reqOpts, r => {
    // 3xx 重定向 → 继续跟随
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      const next = new URL(r.headers.location, u).href;
      r.resume();
      return follow(next, depth + 1, cb);
    }
    // 200：读取正文（utf8），兼容 meta refresh / JS 跳转 / JSON 里的 poi
    let buf = [], size = 0, capped = false;
    r.on('data', c => {
      if (capped) return;
      size += c.length;
      if (size > maxBytes) { capped = true; r.destroy(); return; }
      buf.push(c);
    });
    r.on('end', () => {
      const body = Buffer.concat(buf).toString('utf8');
      // 处理 HTML <meta refresh> 或 JS location 跳转（部分短链不是 302 而是页面跳转）
      const meta = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
      const js = body.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i)
        || body.match(/href\s*=\s*["']([^"']*(?:poi_id_str|waimai\.meituan)[^"']*)["']/i);
      const jump = meta ? meta[1] : (js ? js[1] : null);
      if (jump && depth < 8) {
        try { const next = new URL(jump, urlObj.href).href; r.resume(); return follow(next, depth + 1, cb); } catch (e) {}
      }
      finish(null, urlObj.href, body);
    });
    r.on('close', () => finish(null, urlObj.href, ''));
  });
  rq.on('error', e => finish(e));
  rq.setTimeout(timeoutMs, () => { rq.destroy(); finish(new Error('timeout')); });
  rq.end();
}

function extractPoi(s) {
  if (!s) return null;
  // 1) query 参数 poi_id_str=
  let m = String(s).match(/poi_id_str=([^&\s"'<>\\]+)/);
  if (m) return decodeURIComponent(m[1]);
  // 2) JSON 里的 poiIdStr / poi_id_str
  m = String(s).match(/["']poiIdStr["']\s*:\s*["']([^"']+)["']/);
  if (m) return m[1];
  return null;
}
// 降级：只拿到数字店铺 ID（poiId），无法生成领券链接，但可用于提示
function extractPoiNum(s) {
  const m = String(s || '').match(/[?&]poiId=(\d+)/);
  return m ? m[1] : null;
}

/* 从文本中提取美团 App Deep Link（imeituan:// 等 scheme） */
function extractDeepLink(s) {
  if (!s) return null;
  const schemeM = String(s).match(/(imeituan:\/\/[^\s"<>'\)\]]+|meituanwaimai:\/\/[^\s"<>'\)\]]+|com\.meituan\.?[a-z]*:\/\/[^\s"<>'\)\]]+)/i);
  if (schemeM && schemeM[1]) return schemeM[1].trim();
  return null;
}

/* 返回"唤起 App 中转页"：页面加载即用 JS 触发 scheme（iOS Safari 只认页面内触发，不认服务器 302 跳 scheme）
   res: http.ServerResponse；app: imeituan:// 深链；h5: 兜底 H5 地址（App 未安装时降级打开），可为空 */
function appJumpPage(res, app, h5) {
  const appJson = JSON.stringify(app);
  const h5Json = JSON.stringify(h5 || '');
  const html = `<!doctype html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>正在打开美团…</title>
<style>
  html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
    background:linear-gradient(160deg,#FFE08A,#FFC93C);color:#1c1c1e}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center}
  .spin{width:34px;height:34px;border:3px solid rgba(28,28,30,.25);border-top-color:#1c1c1e;border-radius:50%;animation:r .8s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  .tip{font-size:15px;font-weight:600;opacity:.85}
  .btn{margin-top:6px;display:inline-block;padding:13px 26px;border-radius:14px;background:#1c1c1e;color:#FFC93C;
    font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.2)}
</style></head><body><div class="wrap">
  <div class="spin"></div>
  <div class="tip">正在唤起美团 App 领券…</div>
  <a class="btn" id="go" href="#">未自动打开？点这里</a>
</div><script>
  var APP=${appJson}, H5=${h5Json};
  document.getElementById('go').setAttribute('href', APP);
  var jumped=false;
  var t=setTimeout(function(){ if(!jumped && H5){ location.href=H5; } }, 2500);
  document.addEventListener('visibilitychange', function(){ if(document.hidden){ jumped=true; clearTimeout(t);} });
  window.addEventListener('pagehide', function(){ jumped=true; clearTimeout(t); });
  location.href = APP;
</script></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/* HTML 转义 */
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* 逐跳跟随美团分享短链，提取 poi_id_str / Deep Link（用于 ?jk= 快捷指令深链）
   回调：cb(err, foundPoi, h5ShopUrl)；foundPoi 为 poi 字符串，或 '__DEEPLINK__:<scheme>' */
function resolveJk(startUrl, cb) {
  let foundPoi = null, h5ShopUrl = null, done = false;
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
  function finish() { if (!done) { done = true; cb(null, foundPoi, h5ShopUrl); } }
  function step(u, depth) {
    if (done || depth > 12) return finish();
    let urlObj;
    try { urlObj = new URL(u); } catch (e) { return finish(); }
    if (!hostAllowed(urlObj.hostname)) return finish();
    const mod = urlObj.protocol === 'https:' ? https : http;
    const opts = { method: 'GET', headers: { 'User-Agent': ua, 'Accept': '*/*' } };
    const rq = mod.request(u, opts, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const absLoc = new URL(r.headers.location, u).href;
        r.resume();
        const dl = extractDeepLink(absLoc);
        if (dl) { foundPoi = '__DEEPLINK__:' + dl; return finish(); }
        const p = extractPoi(absLoc);
        if (p) { foundPoi = p; return finish(); }
        h5ShopUrl = absLoc;
        return step(absLoc, depth + 1);
      }
      let buf = [];
      r.on('data', c => buf.push(c));
      r.on('end', () => {
        const body = Buffer.concat(buf).toString('utf8');
        const bodyDL = extractDeepLink(body);
        if (bodyDL) { foundPoi = '__DEEPLINK__:' + bodyDL; return finish(); }
        const bp = extractPoi(body);
        if (bp) { foundPoi = bp; return finish(); }
        const jsT = (body.match(/location\.href\s*=\s*["']([^"']+)["']/i) || body.match(/window\.open\s*\(\s*["']([^"']+)["']/i));
        if (jsT && jsT[1]) {
          try {
            const jt = new URL(jsT[1], urlObj.href).href;
            const jp = extractPoi(jt);
            if (jp) { foundPoi = jp; return finish(); }
            const jdl = extractDeepLink(jt);
            if (jdl) { foundPoi = '__DEEPLINK__:' + jdl; return finish(); }
            return step(jt, depth + 1);
          } catch (e) {}
        }
        const metaM = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
        if (metaM) {
          try {
            const mt = new URL(metaM[1], urlObj.href).href;
            const mp = extractPoi(mt);
            if (mp) { foundPoi = mp; return finish(); }
            return step(mt, depth + 1);
          } catch (e) {}
        }
        if (!h5ShopUrl) h5ShopUrl = urlObj.href;
        finish();
      });
      r.on('close', () => finish());
    });
    rq.on('error', () => finish());
    rq.setTimeout(15000, () => { rq.destroy(); finish(); });
    rq.end();
  }
  step(startUrl, 0);
}

/* 由 poi_id_str 生成真实美团领取链接（与前端 buildUrl 一致） */
function buildClaim(poi, ver) {
  const base = 'https://offsiteact.meituan.com/web/hoae/collection_waimai_' + ver + '/index.html';
  const params = new URLSearchParams({
    pageSrc2: '0c3bfd35279b4140b3bd8ecbc41301d6',
    pageSrc1: 'CPS_SELF_OUT_SRC_H5_LINK',
    pageSrc3: '2836b030dc324b5fb7d4a0e7c87eefca',
    scene: 'CPS_SELF_SRC',
    rootPvId: '41948d17-fa32-4ba8-a5ab-4bfa74a3f529',
    p: '1017423925082877952',
    activityId: '6',
    poi_id_str: poi,
    mediumSrc1: '0c3bfd35279b4140b3bd8ecbc41301d6',
    outActivityId: '6',
    mediaPvId: 'dafkdsajffjafdfs',
    mediaUserId: '10086',
    bizId: '0c3bfd35279b4140b3bd8ecbc41301d6',
    callback: 'jsonpWXLoader',
    poiId: '-100'
  });
  return base + '?' + params.toString();
}

/* 从美团页面提取店铺真实头像（排除平台 logo） */
function extractLogo(s) {
  if (!s) return null;
  function isPlatformLogo(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return /(meituan[-_]?logo|dianping[-_]?logo|share.*default|brand.*logo.*platform|appicon|apple-touch-icon|favicon|logo.*meituan\.com|logo.*dianping)/i.test(u)
      || (u.includes('meituan.com') && /\/(logo|icon|brand|app)\./i.test(u))
      || (u.includes('dianping.com') && /\/(logo|icon|brand|app)\./i.test(u));
  }
  // JSON 数据中的店铺图片（最可靠）
  const jsonFields = ['picUrl', 'shopLogo', 'shopLogoUrl', 'headImg', 'avatar', 'frontImg', 'poiPic', 'shopIcon', 'photo', 'imageUrl', 'coverImg', 'logoUrl', 'brandLogo'];
  for (const f of jsonFields) {
    const m = s.match(new RegExp('["\']' + f + '"\\s*:\\s*["\']([^"\']+?)["\']', 'i'));
    if (m && m[1] && !isPlatformLogo(m[1]) && /\.(jpg|jpeg|png|webp|gif)/i.test(m[1])) return m[1];
    const m2 = s.match(new RegExp('["\']' + f + '"\\s*:\\s*["\'](https?://[^"\']+)["\']', 'i'));
    if (m2 && m2[1] && !isPlatformLogo(m2[1]) && /\.(jpg|jpeg|png|webp|gif)/i.test(m2[1])) return m2[1];
  }
  // <img> 标签中找店铺图
  const shopImgPatterns = [
    /<img[^>]+(?:class|id)=["'][^"']*(?:shop|poi|store|merchant|biz|restaurant)[^"']*["'][^>]+src=["']([^"'\s]+?)["']/gi,
    /<img[^>]+src=["'](https?:\/\/(?:p\d|img|ms\d)\.(?:meituan|meishi)\.(net|com)[^"']*(?:\.jpg|\.jpeg|\.png|\.webp))["']/gi,
    /<img[^>]+src=["'](https?:\/\/[a-z0-9.-]*\.(?:dpfile|dianping)\.[a-z]+[^"']*(?:\.jpg|\.jpeg|\.png|\.webp))["']/gi,
  ];
  for (const p of shopImgPatterns) { p.lastIndex = 0; let found; while ((found = p.exec(s))) { if (found[1] && !isPlatformLogo(found[1])) return found[1]; } }
  // og:image 作为兜底（extractMeta 见文件底部全局定义）
  let v = extractMeta(s, 'og:image');
  if (v && !isPlatformLogo(v)) return v;
  v = extractMeta(s, 'twitter:image');
  if (v && !isPlatformLogo(v)) return v;
  // 任意合理图片
  const anyImg = /<img[^>]+src=["']((?!data:|about:|javascript:|1x1|pixel|beacon|tracker|spacer|empty|placeholder|loading|gray|grey|logo\.|icon\.)[^"']+\.(jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi;
  while ((v = anyImg.exec(s))) { if (v[1] && !isPlatformLogo(v[1])) return v[1]; }
  return null;
}

function extractMeta(s, prop) {
  if (!s) return null;
  let m = s.match(new RegExp('<meta[^>]+property=["\']?' + prop + '["\']?[^>]+content=["\']([^"\']+)', 'i'));
  if (m) return m[1];
  m = s.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']?' + prop, 'i'));
  if (m) return m[1];
  m = s.match(new RegExp('<meta[^>]+name=["\']?' + prop + '["\']?[^>]+content=["\']([^"\']+)', 'i'));
  if (m) return m[1];
  return null;
}

/* 从纯文字中识别坐标/地名/活动信息（图片识别也先 OCR 成文字再走这里） */
function analyzeText(text) {
  const s = String(text || '');
  const out = { title: null, note: null, place: null, lat: null, lng: null, poi: null, urls: [] };
  // 支持 http(s) / 微信小程序(#小程序://) / weixin / 美团 scheme
  const urlRe = /(?:https?:\/\/|#小程序:\/\/|weixin:\/\/|imeituan:\/\/|meituanwaimai:\/\/)[^\s"'<>）)\]]+/gi;
  let m; const urls = [];
  while ((m = urlRe.exec(s))) urls.push(m[0]);
  out.urls = urls;
  const poiM = s.match(/poi_id_str=([^&\s"'<>\\]+)/);
  if (poiM) out.poi = decodeURIComponent(poiM[1]);
  let lat = null, lng = null;
  const latM = s.match(/(?:纬度|latitude|lat)\s*[:：=]?\s*([-\d.]+)/i);
  const lngM = s.match(/(?:经度|longitude|lng)\s*[:：=]?\s*([-\d.]+)/i);
  if (latM) lat = latM[1];
  if (lngM) lng = lngM[1];
  if (lat == null && lng == null) {
    const pair = s.match(/([\d.]{1,3}\.\d+)\s*[°,，]\s*([\d.]{1,3}\.\d+)/);
    if (pair) { lat = pair[1]; lng = pair[2]; }
  }
  // 智能判别经纬度：纬度∈[-90,90]，经度∈[-180,180]；超出纬度范围者判为经度（自动纠正顺序/单位）
  if (lat != null && lng != null) {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if ((la > 90 || la < -90) && ln >= -90 && ln <= 90) { const t = lat; lat = lng; lng = t; }
  } else if (lat != null) {
    const la = parseFloat(lat);
    if (la > 90 || la < -90) { lng = lat; lat = null; } // 单值且超出纬度范围 → 当作经度
  }
  out.lat = lat; out.lng = lng;
  // 地名：贪婪匹配到最后一个行政区划后缀（覆盖「抚州市南城县」），并去掉「我在/在/于」等前缀
  const placeM = s.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·\-—]{2,30}(?:路|区|县|市|店|商场|广场|大厦|园区|镇|村|大道|街|中心|公寓|小区|馆|城|园|站|湾|港|苑|寓))/);
  if (placeM) {
    let p = placeM[1].trim().replace(/^(?:我在|在|于|到|从)\s*/, '');
    out.place = p;
  }
  const qM = s.match(/[「『"']([^」』"']{2,40})[」』"']/);
  if (qM) out.title = qM[1].trim();
  const mj = s.match(/满\s*(\d+)\s*减\s*(\d+)/);
  if (mj) out.note = (out.note ? out.note + ' ' : '') + ('满' + mj[1] + '减' + mj[2]);
  if (!out.title) {
    const lines = s.split(/[\n\r]+/).map(x => x.trim()).filter(Boolean);
    if (lines[0]) {
      // 首行兜底：去掉坐标 / 链接 / 满减等干扰，保留纯活动名
      let t = lines[0]
        .replace(/纬度\s*[:：=]?\s*[-\d.]+/gi, '')
        .replace(/经度\s*[:：=]?\s*[-\d.]+/gi, '')
        .replace(/https?:\/\/[^\s]+/gi, '').replace(/#小程序:\/\/[^\s]+/gi, '')
        .replace(/\s{2,}/g, ' ').trim();
      if (t) out.title = t.slice(0, 200);
    }
  }
  return out;
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + port);

  /* 所有动态接口/深链响应禁止缓存：避免 Cloudflare/CDN 缓存导致「?jk 返回上一个商家」的错位 bug */
  const _dyn = u.pathname.startsWith('/api') || u.pathname === '/resolve'
    || u.pathname === '/' || u.pathname === '/index.html'
    || u.pathname === '/admin' || u.pathname.startsWith('/admin/')
    || u.searchParams.has('jk') || u.searchParams.has('jkclip');
  if (_dyn) {
    res.setHeader('Cache-Control', 'no-store, private, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }

  /* ---- 后台登录 ---- */
  if (u.pathname === '/admin/login' && req.method === 'POST') {
    readBody(req).then(body => {
      let obj; try { obj = JSON.parse(body || '{}'); } catch (e) { obj = {}; }
      if (obj.pass === readAdminPass()) {
        const tk = genToken(); adminTokens.set(tk, Date.now() + TOKEN_TTL);
        res.setHeader('Set-Cookie', 'admin_token=' + tk + '; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax');
        res.writeHead(200, { 'Content-Type': types['.json'] });
        res.end(JSON.stringify({ ok: true, token: tk }));
      } else {
        res.writeHead(403, { 'Content-Type': types['.json'] });
        res.end(JSON.stringify({ ok: false, error: '密码错误' }));
      }
    });
    return;
  }

  /* ---- 修改管理员密码（需登录）---- */
  if (u.pathname === '/admin/changepass' && req.method === 'POST') {
    if (!authOk(req)) { res.writeHead(401, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: '未授权：请先登录' })); return; }
    readBody(req).then(body => {
      let obj; try { obj = JSON.parse(body || '{}'); } catch (e) { obj = {}; }
      if (obj.current !== readAdminPass()) { res.writeHead(403, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: '当前密码错误' })); return; }
      if (!obj.next || String(obj.next).length < 4) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: '新密码至少 4 位' })); return; }
      writeAdminPass(String(obj.next));
      res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  /* ---- 链接导入：分析链接内容，返回标题/描述/地名/经纬度，供后台自动填充 ---- */
  if (u.pathname === '/api/import') {
    const target = u.searchParams.get('url');
    if (!target) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'missing url' })); return; }
    follow(target, 0, (err, finalUrl, body) => {
      if (err) { res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
      let title = extractMeta(body, 'og:title') || extractMeta(body, 'twitter:title');
      if (!title) { const tm = body.match(/<title>([^<]+)<\/title>/i); title = tm ? tm[1].trim() : null; }
      let desc = extractMeta(body, 'og:description') || extractMeta(body, 'description') || '';
      let lat = null, lng = null, place = null;
      try {
        const u2 = new URL(finalUrl);
        const q = u2.searchParams;
        lat = q.get('lat') || q.get('latitude') || q.get('y');
        lng = q.get('lng') || q.get('longitude') || q.get('x');
        place = q.get('name') || q.get('title') || q.get('poiName') || q.get('place') || q.get('addr');
      } catch (e) {}
      if (!lat || !lng) {
        const m = (body || '').match(/(?:lat|latitude|y)\s*[:=]\s*([-\d.]+)/i);
        const m2 = (body || '').match(/(?:lng|longitude|x)\s*[:=]\s*([-\d.]+)/i);
        if (m) lat = lat || m[1];
        if (m2) lng = lng || m2[1];
      }
      res.writeHead(200, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({
        ok: true,
        title: title || null,
        note: desc ? String(desc).slice(0, 500) : null,
        place: place || title || null,
        lat: lat || null, lng: lng || null,
        finalUrl: finalUrl || null
      }));
    });
    return;
  }

  /* ---- 智能识别：文字 / 图片OCR结果 → 解析坐标/地名/活动/内嵌链接（纯本地，无需联网）---- */
  if (u.pathname === '/api/analyze') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'GET') {
      const text = u.searchParams.get('text') || '';
      const r = analyzeText(text);
      res.writeHead(200, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: true, ...r }));
      return;
    }
    if (req.method === 'POST') {
      readBody(req).then(body => {
        let obj; try { obj = JSON.parse(body || '{}'); } catch (e) { obj = {}; }
        const r = analyzeText(obj.text || '');
        res.writeHead(200, { 'Content-Type': types['.json'] });
        res.end(JSON.stringify({ ok: true, ...r }));
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': types['.json'] });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }

  /* ---- 活动链接 / 定位点 CRUD（GET 公开；POST/PUT/DELETE 需登录）---- */
  if (u.pathname.startsWith('/api/acts')) {
    return handleCrud(req, res, u, 'acts', 'acts.json', o => ({ title: str(o.title, 200), url: str(o.url, 2000), note: str(o.note, 500) }));
  }
  if (u.pathname.startsWith('/api/locs')) {
    return handleCrud(req, res, u, 'locs', 'locs.json', o => ({ place: str(o.place, 200), lat: str(o.lat, 30), lng: str(o.lng, 30), note: str(o.note, 500) }));
  }

  /* ---- 后台管理页面 ---- */
  if (u.pathname === '/admin') {
    const af = path.join(root, 'admin.html');
    if (fs.existsSync(af)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(af, 'utf8')); }
    else { res.writeHead(404); res.end('admin.html missing'); }
    return;
  }

  /* ---- ?jk=v8|v6=<美团分享链接/整段话术> → 解析短链 → 唤起美团 App（快捷指令用）---- */
  if (u.searchParams.has('jk')) {
    const raw = decodeURIComponent(u.searchParams.get('jk') || '');
    let ver = 'v8', text = raw;
    const vmm = raw.match(/^v?([68])=/);
    if (vmm) { ver = 'v' + vmm[1]; text = raw.slice(vmm[0].length); }
    const linkMatch = text.match(/https?:\/\/[^\s"'<>）)\]]+/);
    if (!linkMatch) {
      res.writeHead(400, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: false, error: '未检测到有效链接，请确保内容包含 http(s) 开头的地址' }));
      return;
    }
    resolveJk(linkMatch[0], (err, foundPoi, h5ShopUrl) => {
      if (foundPoi && foundPoi.indexOf('__DEEPLINK__:') === 0) {
        return appJumpPage(res, foundPoi.slice(13), h5ShopUrl);
      }
      if (foundPoi) {
        const activityUrl = buildClaim(foundPoi, ver);
        const appDeepLink = 'imeituan://www.meituan.com/web?url=' + encodeURIComponent(activityUrl);
        return appJumpPage(res, appDeepLink, activityUrl);
      }
      if (h5ShopUrl) {
        res.writeHead(302, { 'Location': h5ShopUrl });
        res.end();
        return;
      }
      res.writeHead(422, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: false, error: '无法解析出店铺信息，请确认分享链接有效' }));
    });
    return;
  }

  /* ---- 短链/直链解析接口 ---- */
  if (u.pathname === '/resolve') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const target = u.searchParams.get('url');
    if (!target) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'missing url' })); return; }
    follow(target, 0, (err, finalUrl, body) => {
      if (err) { res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
      const poi = extractPoi(finalUrl) || extractPoi(body);
      const poiNum = poi ? null : extractPoiNum(finalUrl) || extractPoiNum(body);
      // 解析店铺头像与店名（供前端「读剪贴板领券」时自动保存商家信息到卡片）
      let logo = null;
      try { const lv = extractLogo(body); if (lv) logo = new URL(lv, finalUrl).href; } catch (e) {}
      let name = null;
      try {
        let nv = extractMeta(body, 'og:title') || extractMeta(body, 'twitter:title');
        if (!nv) { const tm = body.match(/<title>([^<]+)<\/title>/i); nv = tm ? tm[1].trim() : null; }
        if (nv) name = nv.replace(/\s*[-–|—|·]\s*(美团|大众点评|外卖|优惠券|领券|美团网).*$/i, '').replace(/^\s+|\s+$/g, '');
        if (name) name = name.replace(/\s*[-–|]\s*(在线点餐|配送中|正在营业|已打烊|美团外卖|外卖|优惠|团购).*/i, '').trim();
        if (name && (/^(美团|大众点评|美团外卖|Meituan|Dianping)$/.test(name) || name.length < 2)) name = null;
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: !!poi, poi: poi || null, poiNum: poiNum || null, finalUrl: finalUrl || null, logo: logo || null, name: name || null }));
    });
    return;
  }

  /* ---- 领券链接生成接口（供脚本 / 快捷指令快速调用） ---- */
  if (u.pathname === '/api/claim') {
    const poi = u.searchParams.get('poi');
    if (!poi) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'missing poi' })); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': types['.json'] });
    res.end(JSON.stringify({ ok: true, poi, v8: buildClaim(poi, 'v8'), v6: buildClaim(poi, 'v6') }));
    return;
  }

  /* ---- 店铺信息接口：通过 poi_id_str 提取真实店名和头像 ---- */
  if (u.pathname === '/api/shop') {
    const poi = u.searchParams.get('poi');
    if (!poi) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'missing poi' })); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    const candidates = [
      'https://h5.waimai.meituan.com/poi/' + poi,
      'https://www.meituan.com/poi/' + poi,
      'https://m.dianping.com/appshare/shop/' + poi,
      'https://waimai.meituan.com/restaurant/' + poi
    ];
    // 并发请求多个候选地址，取第一个拿到头像/店名的（单条超时 7s，整体更快）
    Promise.all(candidates.map(c => new Promise(resolve => {
      follow(c, 0, (err, finalUrl, body) => {
        if (err || !body) return resolve(null);
        const logo = extractLogo(body);
        let name = null;
        try {
          let nv = extractMeta(body, 'og:title') || extractMeta(body, 'twitter:title');
          if (!nv) { const tm = body.match(/<title>([^<]+)<\/title>/i); nv = tm ? tm[1].trim() : null; }
          if (nv) name = nv.replace(/\s*[-–|—|·]\s*(美团|大众点评|外卖|优惠券|领券|美团网).*$|^[^\u4e00-\u9fa5]*(美团|大众点评)[^\u4e00-\u9fa5]*$/i, '').replace(/^\s+|\s+$/g, '');
          if (name) name = name.replace(/\s*[-–|]\s*(在线点餐|配送中|正在营业|已打烊|美团外卖|外卖).*/i, '').trim();
          // 最终校验：纯平台名/过短/无意义 → 视为无效
          if (name && (/^(美团|大众点评|美团外卖|Meituan|Dianping)$/.test(name) || name.length < 2)) name = null;
        } catch (e) {}
        let logoUrl = null;
        if (logo) try { logoUrl = new URL(logo, finalUrl).href; } catch (e) {}
        resolve((logoUrl || name) ? { poi, logo: logoUrl || null, name: name || null } : null);
      }, { timeout: 7000, maxBytes: 2 * 1024 * 1024 });
    }))).then(results => {
      const ok = results.find(r => r);
      if (ok) { res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, ...ok })); }
      else { res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, poi, logo: null, name: null })); }
    });
    return;
  }

  /* ---- 深链接口：解析分享链接 → 返回 imeituan:// 深链 JSON，或 format=page 返回中转页 ---- */
  if (u.pathname === '/api/deeplink') {
    const target = u.searchParams.get('url');
    if (!target) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'missing url' })); return; }
    let ver = u.searchParams.get('ver') || 'v8';
    const vm2 = String(ver).match(/^v?([68])$/);
    ver = vm2 ? 'v' + vm2[1] : 'v8';
    const format = u.searchParams.get('format'); // 'page' = 返回中转页 HTML，其他/缺省 = 返回 JSON
    const linkMatch = String(target).match(/https?:\/\/[^\s"'<>）)\]]+/);
    const link = linkMatch ? linkMatch[0] : target;
    if (!linkMatch || !/^https?:\/\//i.test(link)) {
      if (format === 'page') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><meta charset=utf-8><title>错误</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif;color:#c00;background:#fff"><div style="text-align:center;padding:24px"><h2 style="margin:0 0 12px">未检测到有效链接</h2><p style="color:#666;margin:0">请复制含 dpurl.cn / meituan.com 链接的分享内容后重试</p></div></body></html>');
        return;
      }
      res.writeHead(400, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: false, error: '剪贴板内容未包含有效链接，请复制含 dpurl.cn / meituan.com 链接的分享内容后重试。' }));
      return;
    }
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    follow(link, 0, (err, finalUrl, body) => {
      if (err) {
        if (format === 'page') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><html><head><meta charset=utf-8><title>错误</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif;color:#c00;background:#fff"><div style="text-align:center;padding:24px"><h2 style="margin:0 0 12px">请求失败</h2><p style="color:#666;margin:0">' + escHtml(String(err && err.message || err)) + '</p></div></body></html>');
          return;
        }
        res.writeHead(500, { 'Content-Type': types['.json'] });
        res.end(JSON.stringify({ ok: false, error: String(err && err.message || err), _debug: { rawInput: target.substring(0, 200), extractedLink: link } }));
        return;
      }
      const poi = extractPoi(finalUrl) || extractPoi(body);
      if (!poi) {
        const poiNum = extractPoiNum(finalUrl) || extractPoiNum(body);
        if (format === 'page') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><html><head><meta charset=utf-8><title>解析失败</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif;color:#c00;background:#fff"><div style="text-align:center;padding:24px"><h2 style="margin:0 0 12px">无法解析店铺</h2><p style="color:#666;margin:0">该链接不含 poi_id_str，无法生成领券入口</p></div></body></html>');
          return;
        }
        res.writeHead(422, { 'Content-Type': types['.json'] });
        res.end(JSON.stringify({ ok: false, error: '未解析出 poi_id_str', _debug: { rawInput: target, extractedLink: link, finalUrl: finalUrl || null }, poiNum: poiNum || null }));
        return;
      }
      const h5 = buildClaim(poi, ver);
      const app = 'imeituan://www.meituan.com/web?url=' + encodeURIComponent(h5);
      if (format === 'page') { return appJumpPage(res, app, h5); }
      res.writeHead(200, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: true, poi, ver, app, h5, _debug: { rawInput: target.substring(0, 200), extractedLink: link, finalUrl: finalUrl || null } }));
    });
    return;
  }

  /* ---- 跨设备同步：以 sync code 为 key 存储/读取收藏（个人自用，明文文件）---- */
  const syncDir = path.join(root, 'sync');
  try { fs.mkdirSync(syncDir, { recursive: true }); } catch (e) {}
  function safeSyncKey(k) { return String(k || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); }

  if (u.pathname === '/sync' && (req.method === 'GET' || req.method === 'POST')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, private, must-revalidate');
    const key = safeSyncKey(u.searchParams.get('key'));
    if (!key || key.length < 6) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'missing/invalid key' })); return; }
    const fp = path.join(syncDir, key + '.json');
    // 防篡改：HTTPS 环境下客户端用 Web Crypto 计算 mac=HMAC(key, method|/sync|body)，服务端校验；
    // 若客户端未传 mac（如 http 宝塔环境无 crypto.subtle），仅以 key 作为共享密钥放行。
    const verifyMac = (body) => {
      const provided = u.searchParams.get('mac') || '';
      if (!provided) return true;
      return provided === hmacSync(key, req.method + '|/sync|' + body);
    };
    if (req.method === 'GET') {
      if (!verifyMac('')) { res.writeHead(403, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: '签名校验失败' })); return; }
      if (fs.existsSync(fp)) {
        try { const arr = JSON.parse(fs.readFileSync(fp, 'utf8')); res.end(JSON.stringify({ ok: true, data: arr })); }
        catch (e) { res.end(JSON.stringify({ ok: true, data: null })); }
      } else {
        res.end(JSON.stringify({ ok: true, data: null }));
      }
      return;
    }
    // POST：上传覆盖
    const sChunks = []; let sSize = 0;
    req.on('data', c => { sChunks.push(c); sSize += c.length; if (sSize > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      const body = Buffer.concat(sChunks).toString('utf8');
      if (!verifyMac(body)) { res.writeHead(403, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: '签名校验失败' })); return; }
      let arr; try { arr = JSON.parse(body); } catch (e) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'invalid json' })); return; }
      if (!Array.isArray(arr)) { res.writeHead(400, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'data must be array' })); return; }
      try { fs.writeFileSync(fp, JSON.stringify(arr)); } catch (e) { res.writeHead(500, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: false, error: 'write failed' })); return; }
      res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, count: arr.length }));
    });
    return;
  }

  /* ---- 静态文件 ---- */
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const fp = path.join(root, p);
  if (!fp.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(fp);
    const headers = { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' };
    // 指纹化静态资源（app.js?v=、styles.css?v=）长缓存，HTML 不缓存（已在上方设置 no-store）
    if ((ext === '.js' || ext === '.css') && !fp.endsWith('index.html')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    res.end(d);
  });
}).listen(port, () => console.log('本地服务已启动: http://localhost:' + port + '  (含 /resolve 短链解析)'));
