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

    /* ?jk=v8|v6=<美团分享链接/整段话术> → 解析短链 → 提取 Deep Link → 302 直跳美团 App
       例：?jk=v8=我最近很喜欢「肯德基宅急送」… http://dpurl.cn/MRSvOKiz
       效果：iOS Safari 打开后立即唤起美团 App 进入对应商家津贴页 */
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

      // ====== 模拟 iPhone UA 跟随所有 302 跳转，收集每一步的 URL 和 body 中可能出现的 Deep Link ======
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
      let deepLink = null;
      let finalH5Url = null;

      async function followAndExtract(u, depth) {
        if (depth > 12) return;
        try {
          const r = await fetch(u, {
            headers: { 'User-Agent': ua, 'Accept': '*/*' },
            redirect: 'manual'
          });

          // ---- 检查当前响应的 Location 头是否是 Deep Link ----
          if (r.status >= 300 && r.status < 400) {
            const loc = r.headers.get('location');
            if (loc) {
              const absLoc = new URL(loc, u).href;
              // 优先匹配：Location 就是 App Scheme
              deepLink = extractDeepLink(absLoc) || deepLink;
              if (deepLink) return; // 找到了就停止
              finalH5Url = absLoc;
              await followAndExtract(absLoc, depth + 1);
              return;
            }
          }

          // ---- 检查 body 中是否有 Deep Link（JS 跳转、meta refresh、scheme href 等）----
          const body = await r.text().catch(() => '');

          // 1) body 内的 JS location 赋值
          for (const jm of [
            body.match(/location\.href\s*=\s*"([^"]+)"/i),
            body.match(/location\.href\s*=\s*'([^']+)/i),
            body.match(/window\.open\s*\(\s*"([^"]+)"/i),
            body.match(/window\.open\s*\(\s*'([^']+)/i),
          ]) {
            if (jm && jm[1]) {
              const jTarget = new URL(jm[1], r.url || u).href;
              deepLink = extractDeepLink(jTarget) || deepLink;
              if (deepLink) return;
              await followAndExtract(jTarget, depth + 1);
              return;
            }
          }

          // 2) meta refresh
          const metaM = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
          if (metaM) {
            const mTarget = new URL(metaM[1], r.url || u).href;
            deepLink = extractDeepLink(mTarget) || deepLink;
            if (deepLink) return;
            await followAndExtract(mTarget, depth + 1);
            return;
          }

          // 3) <a> 标签中的 scheme href（有些页面用 <a href="imeituan://...">打开App</a>）
          const aSchemes = body.matchAll(/<a[^>]+href=["'](imeituan[^"']*|meituanwaimai[^"']*|com.meituan[^"']*)/gi);
          for (const a of aSchemes) { deepLink = a[1]; return; }

          // 4) 任意包含 scheme 的字符串
          const anyScheme = body.match(/(imeituan:\/\/[^\s"<>'\)]+|meituanwaimai:\/\/[^\s"<>'\)]+)/i);
          if (anyScheme) { deepLink = anyScheme[1]; return; }

          // 5) body 中的通用跳转链接（非 scheme 的继续跟）
          const jsJump = body.match(/(?:location|window\.open)\s*[=(]\s*(?:['"])(https?:\/\/[^'"]+\1)/i)
            || body.match(/href\s*=\s*["'](https?:\/\/[^"']+poi_id[^"']*)["']/i);
          if (jsJump && !deepLink) {
            await followAndExtract(new URL(jsJump[1] || jsJump[2], r.url).href, depth + 1);
            return;
          }

          // 记录最终 H5 URL 作为兜底
          if (!finalH5Url) finalH5Url = r.url || u;

        } catch (e) { /* 跟踪中断 */ }
      }

      await followAndExtract(linkMatch[0], 0);

      // ====== 决定跳转目标 ======
      if (deepLink) {
        // ✅ 找到 Deep Link：302 直跳，iOS Safari 收到后立即唤起美团 App
        return Response.redirect(deepLink, 302);
      }

      // ❌ 未找到 Deep Link：尝试从最终 URL/body 提取 poi_id_str，生成领券页作为兜底
      if (finalH5Url) {
        let fallbackPoi = extractPoi(finalH5Url);
        if (!fallbackPoi) {
          // 最后一次尝试：请求最终 URL 的 body
          try {
            const fr = await fetch(finalH5Url, {
              headers: { 'User-Agent': ua }, redirect: 'manual'
            });
            const fb = await fr.text().catch(() => '');
            fallbackPoi = extractPoi(fb) || extractDeepLink(fb); // extractDeepLink 也可能从 body 抓到 scheme
            if (extractDeepLink(fb)) return Response.redirect(extractDeepLink(fb), 302);
          } catch (e) {}
        }
        if (fallbackPoi) {
          return Response.redirect(buildClaim(fallbackPoi, ver), 302);
        }
        // 最终兜底：302 到 H5 店铺页本身
        return Response.redirect(finalH5Url, 302);
      }

      // 完全失败
      return json({ ok: false, error: '无法解析出店铺或 Deep Link，请确认是有效的美团店铺分享链接' }, 422);
    }

    /* 领券链接生成接口（供脚本 / 快捷指令快速调用） */
    if (path === '/api/claim') {
      const poi = url.searchParams.get('poi');
      if (!poi) return json({ ok: false, error: 'missing poi' }, 400);
      return json({ ok: true, poi, v8: buildClaim(poi, 'v8'), v6: buildClaim(poi, 'v6') });
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
