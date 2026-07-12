// 宝塔 / 自托管版 Node 服务（server.js）—— 与 worker.js 功能对齐：
// 提供静态文件 + /resolve + /api/claim + /api/shop + ?jk= 深链 + /api/deeplink(含 format=page 中转页)
// 端口 8123，本地运行：node server.js
const http = require('http'), https = require('https');
const fs = require('fs'), path = require('path');
const { URL } = require('url');
const root = __dirname;
const port = 8123;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

/* 服务端跟随重定向，取出最终 URL（Node 无跨域限制，可解析任意短链） */
function follow(u, depth, cb) {
  if (depth > 8) return cb(null, u);
  let urlObj;
  try { urlObj = new URL(u); } catch (e) { return cb(e); }
  const mod = urlObj.protocol === 'https:' ? https : http;
  const opts = {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      'Accept': 'text/html,application/xhtml+xml,*/*'
    }
  };
  let done = false;
  const finish = (e, url, body) => { if (done) return; done = true; cb(e, url, body); };
  const rq = mod.request(u, opts, r => {
    // 3xx 重定向 → 继续跟随
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      const next = new URL(r.headers.location, u).href;
      r.resume();
      return follow(next, depth + 1, cb);
    }
    // 200：读取正文（utf8），兼容 meta refresh / JS 跳转 / JSON 里的 poi
    let buf = [];
    r.on('data', c => buf.push(c));
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
  rq.setTimeout(15000, () => { rq.destroy(); finish(new Error('timeout')); });
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
  // og:image 作为兜底
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

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + port);

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
      res.writeHead(200, { 'Content-Type': types['.json'] });
      res.end(JSON.stringify({ ok: !!poi, poi: poi || null, poiNum: poiNum || null, finalUrl: finalUrl || null }));
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
    (function tryNext(i) {
      if (i >= candidates.length) { res.writeHead(200, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ ok: true, poi, logo: null, name: null })); return; }
      follow(candidates[i], 0, (err, finalUrl, body) => {
        if (err || !body) return tryNext(i + 1);
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
        if (logo || name) {
          let logoUrl = null;
          if (logo) try { logoUrl = new URL(logo, finalUrl).href; } catch (e) {}
          res.writeHead(200, { 'Content-Type': types['.json'] });
          res.end(JSON.stringify({ ok: true, poi, logo: logoUrl || null, name: name || null }));
        } else {
          tryNext(i + 1);
        }
      });
    })(0);
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

  /* ---- 静态文件 ---- */
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const fp = path.join(root, p);
  if (!fp.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'text/plain; charset=utf-8' });
    res.end(d);
  });
}).listen(port, () => console.log('本地服务已启动: http://localhost:' + port + '  (含 /resolve 短链解析)'));
