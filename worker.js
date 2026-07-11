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
// 从美团页面提取店铺头像（多策略：meta 标签 → JSON 字段 → img 标签）
function extractLogo(s) {
  if (!s) return null;
  // 1) 标准 Open Graph meta 标签
  let v = extractMeta(s, 'og:image');
  if (v) return v;
  v = extractMeta(s, 'twitter:image');
  if (v) return v;
  // 2) JSON 数据中常见的店铺图片字段（覆盖美团/点评各种命名）
  const jsonFields = [
    'picUrl', 'logoUrl', 'headImg', 'shopLogo', 'shopLogoUrl',
    'brandLogo', 'brandLogoUrl', 'avatar', 'photo', 'imageUrl',
    'logo', 'coverImg', 'frontImg', 'shopIcon', 'poiPic'
  ];
  for (const f of jsonFields) {
    const m = s.match(new RegExp('["\']' + f + '"\\s*:\\s*["\']([^"\']+(?:\\.jpg|\\.jpeg|\\.png|\\.webp|\\.gif|\\/)[^"\']*)["\']', 'i'));
    if (m && m[1]) return m[1];
    const m2 = s.match(new RegExp('["\']' + f + '"\\s*:\\s*["\'](https?://[^"\']+)["\']', 'i'));
    if (m2 && m2[1] && /\.(jpg|jpeg|png|webp|gif)/i.test(m2[1])) return m2[1];
  }
  // 3) 从 <img> 标签中找看起来像 logo 的图（class/id 含 logo/brand/shop/head，或来自美团 CDN）
  const imgPatterns = [
    /<img[^>]+(?:class|id)=["'][^"']*(?:logo|brand|shop|head|avatar|poi)[^"']*["'][^>]+src=["']([^"']+)["']/gi,
    /<img[^>]+src=["'](https?:\/\/(?:img|p\d|s3)\.meituan\.net[^"']+)["']/gi,
    /<img[^>]+src=["'](https?:\/\/[a-z0-9.-]*\.dianping\.com[^"']+(?:\.jpg|\.jpeg|\.png|\.webp))["']/gi,
    /<img[^>]+src=["'](https?:\/\/[a-z0-9.-]*\.meituan\.com[^"']+(?:\.jpg|\.jpeg|\.png|\.webp))["']/gi
  ];
  for (const p of imgPatterns) {
    p.lastIndex = 0;
    const m = p.exec(s);
    if (m && m[1]) return m[1];
  }
  // 4) 兜底：取第一个非空、非图标、非追踪的图片（尺寸合理）
  const anyImg = /<img[^>]+src=["']((?!data:|about:|javascript:|1x1|pixel|beacon|tracker)[^"']+\.(jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi;
  while ((v = anyImg.exec(s))) {
    const src = v[1];
    if (!/(spacer|empty|default|placeholder|loading|gray|grey)/i.test(src)) return src;
  }
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
