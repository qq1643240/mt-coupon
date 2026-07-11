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
          if (nv) name = nv.replace(/\s*[-–|—|·]\s*(美团|大众点评|外卖|优惠券|领券).*$/i, '').replace(/^\s+|\s+$/g, '');
          if (name) name = name.replace(/\s*[-–|]\s*(在线点餐|配送中|正在营业|已打烊|美团外卖|外卖).*/i, '').trim();
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
