// Cloudflare Worker —— 边缘端 /resolve 与 /api/claim，其余请求托管静态资源
// 部署（Git 连接）：构建/部署命令填 `npx wrangler deploy`，路径填 `.`
// 本地预览：`npx wrangler dev`（或 `node server.js`）

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

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

async function follow(u, ua, depth) {
  if (depth > 8) return { url: u, body: '' };
  let r;
  try {
    r = await fetch(u, {
      headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml,*/*' },
      redirect: 'manual'
    });
  } catch (e) {
    if (u.startsWith('http://')) {
      try {
        r = await fetch(u.replace('http://', 'https://'), {
          headers: { 'User-Agent': ua, 'Accept': '*/*' }, redirect: 'manual'
        });
      } catch { throw e; }
    } else throw e;
  }

  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location');
    if (loc) {
      const next = new URL(loc, r.url || u).href;
      return follow(next, ua, depth + 1);
    }
  }

  const body = await r.text().catch(() => '');
  const meta = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
  const js = body.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i)
    || body.match(/href\s*=\s*["']([^"']*(?:poi_id_str|waimai\.meituan)[^"']*)["']/i);
  const jump = meta ? meta[1] : (js ? js[1] : null);
  if (jump && depth < 8) {
    try { const next = new URL(jump, r.url || u).href; return follow(next, ua, depth + 1); } catch {}
  }
  return { url: r.url || u, body };
}

function extractPoi(s) {
  if (!s) return null;
  let m = String(s).match(/poi_id_str=([^&\s"'<>\\]+)/);
  if (m) return decodeURIComponent(m[1]);
  m = String(s).match(/["']poiIdStr["']\s*:\s*["']([^"']+)["']/);
  if (m) return m[1];
  return null;
}
function extractPoiNum(s) {
  const m = String(s || '').match(/[?&]poiId=(\d+)/);
  return m ? m[1] : null;
}

// 从 URL 或文本中提取美团 App Deep Link（imeituan:// / meituanwaimai:// 等scheme）
function extractDeepLink(s) {
  if (!s) return null;
  // 直接匹配 scheme URL
  const schemeM = String(s).match(/(imeituan:\/\/[^\s"<>'\)\]]+|meituanwaimai:\/\/[^\s"<>'\)\]]+|com\.meituan\.?[a-z]*:\/\/[^\s"<>'\)\]]+)/i);
  if (schemeM && schemeM[1]) return schemeM[1].trim();
  return null;
}
// 从美团页面提取店铺真实头像（排除平台 logo）
function extractLogo(s) {
  if (!s) return null;
  // 过滤：是否为平台通用 logo（含 meituan/dianping 品牌标识的图不要）
  function isPlatformLogo(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return /(meituan[-_]?logo|dianping[-_]?logo|share.*default|brand.*logo.*platform|appicon|apple-touch-icon|favicon|logo.*meituan\.com|logo.*dianping)/i.test(u)
      || (u.includes('meituan.com') && /\/(logo|icon|brand|app)\./i.test(u))
      || (u.includes('dianping.com') && /\/(logo|icon|brand|app)\./i.test(u));
  }
  // ====== 第一步：JSON 数据中的店铺图片（最可靠）======
  const jsonFields = [
    'picUrl', 'shopLogo', 'shopLogoUrl', 'headImg', 'avatar',
    'frontImg', 'poiPic', 'shopIcon', 'photo', 'imageUrl',
    'coverImg', 'logoUrl', 'brandLogo'
  ];
  for (const f of jsonFields) {
    const m = s.match(new RegExp('["\']' + f + '"\\s*:\\s*["\']([^"\']+?)["\']', 'i'));
    if (m && m[1] && !isPlatformLogo(m[1]) && /\.(jpg|jpeg|png|webp|gif)/i.test(m[1])) return m[1];
    const m2 = s.match(new RegExp('["\']' + f + '"\\s*:\\s*["\'](https?://[^"\']+)["\']', 'i'));
    if (m2 && m2[1] && !isPlatformLogo(m2[1]) && /\.(jpg|jpeg|png|webp|gif)/i.test(m2[1])) return m2[1];
  }
  // ====== 第二步：<img> 中找店铺图（排除平台 logo）======
  const shopImgPatterns = [
    /<img[^>]+(?:class|id)=["'][^"']*(?:shop|poi|store|merchant|biz|restaurant)[^"']*["'][^>]+src=["']([^"'\s]+?)["']/gi,
    /<img[^>]+src=["'](https?:\/\/(?:p\d|img|ms\d)\.(?:meituan|meishi)\.(net|com)[^"']*(?:\.jpg|\.jpeg|\.png|\.webp))["']/gi,
    /<img[^>]+src=["'](https?:\/\/[a-z0-9.-]*\.(?:dpfile|dianping)\.[a-z]+[^"']*(?:\.jpg|\.jpeg|\.png|\.webp))["']/gi,
  ];
  for (const p of shopImgPatterns) {
    p.lastIndex = 0;
    let found; while ((found = p.exec(s))) { if (found[1] && !isPlatformLogo(found[1])) return found[1]; }
  }
  // ====== 第三步：og:image 作为最后兜底（过滤平台 logo）======
  let v = extractMeta(s, 'og:image');
  if (v && !isPlatformLogo(v)) return v;
  v = extractMeta(s, 'twitter:image');
  if (v && !isPlatformLogo(v)) return v;
  // ====== 第四步：任意合理图片 ======
  const anyImg = /<img[^>]+src=["']((?!data:|about:|javascript:|1x1|pixel|beacon|tracker|spacer|empty|placeholder|loading|gray|grey|logo\.|icon\.)[^"']+\.(jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi;
  while ((v = anyImg.exec(s))) { if (v[1] && !isPlatformLogo(v[1])) return v[1]; }
  return null;
}
// 返回一个"唤起 App 中转页"：页面加载即用 JS 触发 scheme（iOS Safari 只认页面内触发，不认服务器 302 跳 scheme）
// app: imeituan:// 深链；h5: 兜底 H5 地址（App 未安装时降级打开），可为空
function appJumpPage(app, h5) {
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
  // 立即尝试唤起 App（iOS 会弹"是否打开美团"确认框）
  location.href = APP;
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* ?jk=v8|v6=<美团分享链接/整段话术> → 解析短链 → 提取 poi_id_str → 构造 Deep Link → 302 直跳美团 App
       例：?jk=v8=我最近很喜欢「肯德基宅急送」… http://dpurl.cn/MRSvOKiz
       效果：iOS Safari 打开此 URL 后立刻收到 302 到 imeituan:// / meituanwaimai:// → 立即唤起美团 App */
    if (url.searchParams.has('jk')) {
      const raw = decodeURIComponent(url.searchParams.get('jk') || '');
      let ver = 'v8', text = raw;
      const vm = raw.match(/^v?([68])=/);
      if (vm) { ver = 'v' + vm[1]; text = raw.slice(vm[0].length); }

      // ====== 从文本中提取第一个 HTTP(S) 链接 ======
      const linkMatch = text.match(/https?:\/\/[^\s"'<>）)\]]+/);
      if (!linkMatch) {
        return json({ ok: false, error: '未检测到有效链接，请确保内容包含 http(s) 开头的地址' }, 400);
      }

      // ====== 跟随短链跳转，提取 poi_id_str ======
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
      let foundPoi = null;
      let h5ShopUrl = null; // 兜底用的 H5 店铺页

      async function chaseForPoi(u, depth) {
        if (depth > 12 || foundPoi) return;
        try {
          const r = await fetch(u, {
            headers: { 'User-Agent': ua, 'Accept': '*/*' },
            redirect: 'manual'
          });

          // 302 重定向：检查 Location 中是否直接带 poi 或 Deep Link
          if (r.status >= 300 && r.status < 400) {
            const loc = r.headers.get('location');
            if (!loc) return;
            const absLoc = new URL(loc, u).href;
            // 检查是否本身就是 Deep Link
            const dl = extractDeepLink(absLoc);
            if (dl) { foundPoi = '__DEEPLINK__:' + dl; return; }
            // 从 Location URL 提取 poi
            const p = extractPoi(absLoc);
            if (p) { foundPoi = p; return; }
            h5ShopUrl = absLoc;
            await chaseForPoi(absLoc, depth + 1);
            return;
          }

          // 200 响应：检查 body
          const body = await r.text().catch(() => '');

          // body 里的 Deep Link（有些 H5 页面会内嵌 scheme）
          const bodyDL = extractDeepLink(body);
          if (bodyDL) { foundPoi = '__DEEPLINK__:' + bodyDL; return; }

          // body 里显式写的 poi_id_str
          const bp = extractPoi(body);
          if (bp) { foundPoi = bp; return; }

          // JS 跳转链接中可能带 poi
          const jsTarget = (
            body.match(/location\.href\s*=\s*["']([^"']+)["']/i) ||
            body.match(/window\.open\s*\(\s*["']([^"']+)["']/i)
          );
          if (jsTarget && jsTarget[1]) {
            const jt = new URL(jsTarget[1], r.url || u).href;
            const jp = extractPoi(jt);
            if (jp) { foundPoi = jp; return; }
            // 也可能是 Deep Link
            const jdl = extractDeepLink(jt);
            if (jdl) { foundPoi = '__DEEPLINK__:' + jdl; return; }
            await chaseForPoi(jt, depth + 1);
            return;
          }

          // meta refresh
          const metaM = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
          if (metaM) {
            const mt = new URL(metaM[1], r.url || u).href;
            const mp = extractPoi(mt);
            if (mp) { foundPoi = mp; return; }
            await chaseForPoi(mt, depth + 1);
            return;
          }

          // 都没找到，记录最终 URL 作为兜底
          if (!h5ShopUrl) h5ShopUrl = r.url || u;

        } catch (e) { /* 静默 */ }
      }

      await chaseForPoi(linkMatch[0], 0);

      // ====== 根据结果构造跳转 ======

      // ① 直接拿到了 Deep Link（极罕见，但保留）→ 用中转页由 JS 触发唤起（服务器 302 跳 scheme 会被 iOS Safari 拦截）
      if (foundPoi && foundPoi.startsWith('__DEEPLINK__:')) {
        return appJumpPage(foundPoi.slice(13), h5ShopUrl);
      }

      // ② 拿到了 poi_id_str → 构造领券页 URL → 用 imeituan:// scheme 包装，返回中转页由页面内 JS 唤起 App
      if (foundPoi) {
        const poi = foundPoi;
        // 构造美团领券活动页 URL（与 Scriptable 脚本一致）
        const activityUrl = buildClaim(poi, ver);
        // imeituan:// 深链：iOS Safari 只认"页面内 JS 触发"，不认服务器 302 直跳 scheme，故走中转页
        const appDeepLink = 'imeituan://www.meituan.com/web?url=' + encodeURIComponent(activityUrl);
        return appJumpPage(appDeepLink, activityUrl); // 兜底降级到 H5 领券页
      }

      // ③ 有 H5 店铺页 URL 但没拿到 poi → 302 到 H5 页面本身（iOS 上该域名可能有 Universal Link）
      if (h5ShopUrl) {
        return Response.redirect(h5ShopUrl, 302);
      }

      // ④ 彻底失败
      return json({ ok: false, error: '无法解析出店铺信息，请确认分享链接有效' }, 422);
    }

    /* 领券链接生成接口（供脚本 / 快捷指令快速调用） */
    if (path === '/api/claim') {
      const poi = url.searchParams.get('poi');
      if (!poi) return json({ ok: false, error: 'missing poi' }, 400);
      return json({ ok: true, poi, v8: buildClaim(poi, 'v8'), v6: buildClaim(poi, 'v6') });
    }

    /* 深链接口：输入分享链接/整段话术 → 解析 poi → 返回可唤起美团 App 的 imeituan:// 深链（JSON）
       供快捷指令调用：「获取 URL 内容」/api/deeplink?ver=v8&url=<剪贴板> → 取 app 字段 →「打开 URL」唤起 App
       例：/api/deeplink?ver=v8&url=http://dpurl.cn/xxxx
       返回：{ ok, poi, ver, app: "imeituan://...", h5: "https://offsiteact..." } */
    if (path === '/api/deeplink') {
      const target = url.searchParams.get('url');
      if (!target) return json({ ok: false, error: 'missing url' }, 400);
      let ver = url.searchParams.get('ver') || 'v8';
      const vm = String(ver).match(/^v?([68])$/);
      ver = vm ? 'v' + vm[1] : 'v8';
      // 从整段文本抽第一个 http(s) 链接（兼容直接传整段分享话术）
      const linkMatch = String(target).match(/https?:\/\/[^\s"'<>）)\]]+/);
      const link = linkMatch ? linkMatch[0] : target;
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
      try {
        const final = await follow(link, ua, 0);
        const poi = extractPoi(final.url) || extractPoi(final.body);
        if (!poi) {
          const poiNum = extractPoiNum(final.url) || extractPoiNum(final.body);
          return json({ ok: false, error: '未解析出 poi_id_str', poiNum: poiNum || null, finalUrl: final.url || null }, 422);
        }
        const h5 = buildClaim(poi, ver);
        const app = 'imeituan://www.meituan.com/web?url=' + encodeURIComponent(h5);
        return json({ ok: true, poi, ver, app, h5 });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }

    /* 店铺信息接口：通过 poi_id_str 提取真实店名和头像 */
    if (path === '/api/shop') {
      const poi = url.searchParams.get('poi');
      if (!poi) return json({ ok: false, error: 'missing poi' }, 400);
      // 尝试多个美团/点评店铺 H5 地址格式
      const candidates = [
        'https://h5.waimai.meituan.com/poi/' + poi,
        'https://www.meituan.com/poi/' + poi,
        'https://m.dianping.com/appshare/shop/' + poi,
        'https://waimai.meituan.com/restaurant/' + poi
      ];
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
      for (const c of candidates) {
        try {
          const final = await follow(c, ua, 0);
          const logo = extractLogo(final.body);
          let name = null;
          try {
            let nv = extractMeta(final.body, 'og:title') || extractMeta(final.body, 'twitter:title');
            if (!nv) { const tm = final.body.match(/<title>([^<]+)<\/title>/i); nv = tm ? tm[1].trim() : null; }
            if (nv) name = nv.replace(/\s*[-–|—|·]\s*(美团|大众点评|外卖|优惠券|领券).*$/i, '').replace(/^\s+|\s+$/g, '');
            if (name) name = name.replace(/\s*[-–|]\s*(在线点餐|配送中|正在营业|已打烊|美团外卖|外卖).*/i, '').trim();
          } catch (e) {}
          if (logo || name) {
            let logoUrl = null;
            if (logo) try { logoUrl = new URL(logo, final.url).href; } catch (e) {}
            return json({ ok: true, poi, logo: logoUrl || null, name: name || null });
          }
        } catch (e) { continue; }
      }
      return json({ ok: true, poi, logo: null, name: null });
    }

    /* 短链/直链解析接口（跟随重定向取出 poi_id_str） */
    if (path === '/resolve') {
      const target = url.searchParams.get('url');
      if (!target) return json({ ok: false, error: 'missing url' }, 400);
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
      try {
        const final = await follow(target, ua, 0);
        const poi = extractPoi(final.url) || extractPoi(final.body);
        const poiNum = poi ? null : extractPoiNum(final.url) || extractPoiNum(final.body);
        let logo = null;
        try { const lv = extractLogo(final.body); if (lv) logo = new URL(lv, final.url).href; } catch (e) {}
        let name = null;
        try {
          let nv = extractMeta(final.body, 'og:title') || extractMeta(final.body, 'twitter:title');
          if (!nv) {
            const tm = final.body.match(/<title>([^<]+)<\/title>/i);
            nv = tm ? tm[1].trim() : null;
          }
          if (nv) name = nv.replace(/\s*[-–|—|·]\s*(美团|大众点评|外卖|优惠券|领券).*$/i, '').replace(/^\s+|\s+$/g, '');
          // 清理掉"在线点餐"、"配送中"等后缀
          if (name) name = name.replace(/\s*[-–|]\s*(在线点餐|配送中|正在营业|已打烊|美团外卖|外卖|优惠|团购).*/i, '').trim();
        } catch (e) {}
        return json({ ok: !!poi, poi: poi || null, poiNum: poiNum || null, finalUrl: final.url || null, logo: logo || null, name: name || null });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) });
      }
    }

    /* 其余请求交给静态资源（index.html / app.js / styles.css ...） */
    return env.ASSETS.fetch(request);
  }
};
