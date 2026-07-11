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

    /* 短链/直链解析接口（跟随重定向取出 poi_id_str） */
    if (path === '/resolve') {
      const target = url.searchParams.get('url');
      if (!target) return json({ ok: false, error: 'missing url' }, 400);
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
      try {
        const final = await follow(target, ua, 0);
        const poi = extractPoi(final.url) || extractPoi(final.body);
        const poiNum = poi ? null : extractPoiNum(final.url) || extractPoiNum(final.body);
        return json({ ok: !!poi, poi: poi || null, poiNum: poiNum || null, finalUrl: final.url || null });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) });
      }
    }

    /* 其余请求交给静态资源（index.html / app.js / styles.css ...） */
    return env.ASSETS.fetch(request);
  }
};
