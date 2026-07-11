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

    /* 一键领券跳转：?jk=v8=<美团分享链接/整段分享话术> → 自动解析 poi 并 302 跳转到美团 App 领券页
       例：?jk=v8=我最近很喜欢美团外卖的「肯德基宅急送（南海大道北店）」… http://dpurl.cn/MRSvOKiz */
    if (url.searchParams.has('jk')) {
      const raw = decodeURIComponent(url.searchParams.get('jk') || '');
      let ver = 'v8', text = raw;
      const m = raw.match(/^v?([68])=/);
      if (m) { ver = 'v' + m[1]; text = raw.slice(m[0].length); }
      // 1) 分享文字里直接带 poi_id_str
      let poi = extractPoi(text);
      // 2) 否则从文字里提取链接，跟随跳转解析出 poi
      if (!poi) {
        const um = text.match(/https?:\/\/[^\s"'<>）)]+/);
        if (um) {
          const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
          try {
            const final = await follow(um[0], ua, 0);
            poi = extractPoi(final.url) || extractPoi(final.body);
            if (!poi) {
              const sm = final.body && (final.body.match(/["']poiIdStr["']\s*:\s*["']([^"']+)["']/) || final.body.match(/shopId["']?\s*[:=]\s*["']?(\d+)/));
              if (sm) poi = sm[1];
            }
          } catch (e) {}
        }
      }
      if (poi) return Response.redirect(buildClaim(poi, ver), 302);
      const errHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>解析失败</title>
<style>body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.box{text-align:center;padding:24px;max-width:340px;line-height:1.7}.e{color:#ff6b6b;font-size:16px;margin-bottom:10px}.s{color:#aaa;font-size:13px}</style>
</head><body><div class="box"><div class="e">⚠️ 未能从分享内容中解析出店铺</div>
<div class="s">请确认粘贴的是「美团外卖店铺分享」链接（含 poi_id_str），或带可跳转的店铺短链。</div></div></body></html>`;
      return new Response(errHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
