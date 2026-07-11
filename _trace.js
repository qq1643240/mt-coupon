// 追踪美团分享短链完整跳转链路，找出 Deep Link
const targetUrl = 'http://dpurl.cn/MRSvOKiz';
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

async function follow(u, depth) {
  if (depth > 15) { console.log(`[MAX DEPTH] ${depth} ${u}`); return; }
  console.log(`\n=== STEP ${depth}: ${u.substring(0, 120)} ===`);
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': ua, 'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      redirect: 'manual'
    });
    console.log(`Status: ${r.status}`);
    
    // 打印所有响应头
    for (const [k, v] of r.headers.entries()) {
      const val = v.length > 200 ? v.substring(0, 200) + '...' : v;
      if (/location|content-type|set-cookie/i.test(k)) {
        console.log(`  [H] ${k}: ${val}`);
        // 检查 Location 是否是 scheme
        if (/imeituan|meituanwaimai|com\.meituan|scheme/i.test(v)) {
          console.log(`  ⚡ SCHEME FOUND IN LOCATION: ${v}`);
        }
      }
    }

    // 处理重定向
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (loc) {
        const absLoc = new URL(loc, u).href;
        console.log(`  → Redirect to: ${absLoc.substring(0, 150)}`);
        return await follow(absLoc, depth + 1);
      }
      console.log('  → No location header!');
      return;
    }

    // 读 body
    const body = await r.text();
    console.log(`Body length: ${body.length}`);

    // 检查 body 中是否有 Deep Link
    const schemes = body.match(/(imeituan:\/\/[^\s"'<>\)]+|meituanwaimai:\/\/[^\s"'<>\)]+)/gi);
    if (schemes) {
      schemes.forEach(s => console.log(`  ⚡ SCHEME IN BODY: ${s}`));
    }

    // 检查 JS 跳转
    const jsJumps = [
      body.match(/location\.href\s*=\s*["']([^"']+)["']/i),
      body.match(/window\.open\s*\(\s*["']([^"']+)["']/i),
      body.match(/window\.location\s*=\s*["']([^"']+)["']/i),
    ];
    for (const j of jsJumps) {
      if (j && j[1]) {
        console.log(`  JS jump: ${j[1].substring(0, 150)}`);
        if (/imeituan|meituanwaimai/i.test(j[1])) {
          console.log(`  ⚌ SCHEME IN JS: ${j[1]}`);
        } else {
          await follow(new URL(j[1], u).href, depth + 1);
        }
        return;
      }
    }

    // meta refresh
    const metaM = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
    if (metaM) {
      console.log(`  Meta refresh: ${metaM[1]}`);
      await follow(new URL(metaM[1], u).href, depth + 1);
      return;
    }

    // 检查 <a href="scheme">
    const aTags = body.matchAll(/<a[^>]+href=["'](imeituan[^"']*|meituanwaimai[^"']*)/gi);
    let foundA = false;
    for (const a of aTags) { console.log(`  ⚡ A-TAG SCHEME: ${a[1]}`); foundA = true; }
    
    // 通用链接检查
    const anyLink = body.match(/href\s*=\s*["']([^"']+["'])/g);
    if (anyLink) {
      const filtered = anyLink.filter(h => /javascript|#/.test(h));
      if (anyLink.length > 0) {
        console.log(`  Links found: ${Math.min(anyLink.length, 10)} total`);
        // 找最像店铺/跳转的链接
        for (const h of anyLink.slice(0, 20)) {
          const href = h.replace(/^href\s*=\s*["']|["']$/g, '');
          if (/(poi|shop|restaurant|waimai|meituan|offsiteact|coupon)/i.test(href)) {
            console.log(`  Relevant: ${href.substring(0, 120)}`);
          }
        }
      }
    }

    // poi_id_str
    const poi = body.match(/poi_id_str=([^&\s"'<>\\]+)/);
    if (poi) console.log(`  📌 poi_id_str: ${poi[1]}`);

    console.log(`\n  ✅ FINAL URL: ${r.url}`);

  } catch (e) {
    console.log(`  ERROR at step ${depth}: ${e.message}`);
  }
}

follow(targetUrl, 0).then(() => console.log('\n=== DONE ==='));
