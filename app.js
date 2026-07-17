/* =========================================================
   美团津贴 · 极简收藏（移动端工具站风格）
   - 本地存储（localStorage）：搜索/领取自动保存
   - 粘贴店铺链接自动识别 poi_id_str → 自动收藏
   - 店名从分享文字智能提取；logo 用首字色块（支持自定义图）
   - 领取地址可复制；支持备注；分段筛选（全部/待领/已领）
   - 后端 /resolve 兼容本地 server.js 与 Cloudflare Pages Function
   ========================================================= */

const STORE_KEY = 'mt_coupon_collection_v2';
const THEME_KEY = 'mt_coupon_theme';
const STAT_KEY = 'mt_coupon_stats_v1';
const VERSION = '1.59'; // 版本号：每次布局更新推送 +0.01

/* 全站领券统计（次数，按 v8/v6 分别计） */
let stats = loadStats();
function loadStats() {
  try { const r = localStorage.getItem(STAT_KEY); if (r) { const o = JSON.parse(r); return { claims: o.claims || 0, v8: o.v8 || 0, v6: o.v6 || 0 }; } } catch (e) {}
  return { claims: 0, v8: 0, v6: 0 };
}
function saveStats() { try { localStorage.setItem(STAT_KEY, JSON.stringify(stats)); } catch (e) {} }
function bumpStat(which) { stats.claims++; if (which === 1) stats.v8++; else if (which === 2) stats.v6++; saveStats(); updateStatbar(); }
function updateStatbar() {
  const t = '已领 ' + stats.claims + ' 次';
  const a = document.getElementById('statClaims'); if (a) a.textContent = t;
  const b = document.getElementById('claimCount'); if (b) b.textContent = t;
}

/* 由 poi_id_str 生成真实美团领取链接（v8 主 / v6 第二张） */
function buildUrl(poi, ver) {
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
function urlV8(poi) { return buildUrl(poi, 'v8'); }
function urlV6(poi) { return buildUrl(poi, 'v6'); }

/* 美团 App / 美团外卖 App 的 scheme 与中文名（剪贴板自动跳转时区分唤起哪个 App） */
const APP_SCHEME = { main: 'imeituan://', waimai: 'imeituanwaimai://' };
const APP_LABEL = { main: '美团', waimai: '美团外卖' };
function appScheme(appType) { return APP_SCHEME[appType === 'main' ? 'main' : 'waimai']; }
function appLabel(appType) { return APP_LABEL[appType === 'main' ? 'main' : 'waimai']; }

/* 从分享文本/链接判断该商家属于「美团」(到店/团购) 还是「美团外卖」，从而唤起对应 App */
function detectApp(text, url) {
  const u = String(url || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  // 外卖特征（链接域名 / 关键词）
  if (/waimai\.meituan\.com|h5\.waimai\.meituan\.com|meituanwaimai/.test(u)
    || /\bwaimai\b|外卖|美团外卖|闪购|配送/.test(t)) return 'waimai';
  // 主 App 特征（到店/团购 / 点评）
  if (/www\.meituan\.com|meituan\.com\/(?!waimai)|dianping\.com/.test(u)
    || /\bmeituan\b|美团|大众点评|到店|团购/.test(t)) return 'main';
  // 兜底：商家津贴以美团外卖为主
  return 'waimai';
}

function ts(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi, s).getTime(); }

/* 种子数据（首次打开无本地数据时） */
const seed = [
  { id: '395505', name: '旺角大排档（粤菜小炒、啫啫煲）', poi: '7FATrlwYZgjK0Wo13H0zOAI', amount: '', logo: '', note: '', tags: [], pinned: true,  claimed: false, updatedAt: ts(2026, 7, 11, 11, 17, 26) },
  { id: '395165', name: '川味轩（南新五路店）',           poi: 'e1G07VLcvSyapClYCnYeYQI', amount: '', logo: '', note: '', tags: [], pinned: false, claimed: false, updatedAt: ts(2026, 7, 11, 10, 54, 45) }
];

let data = load();
let curPage = 'shop'; // shop=商家津贴 / claim=领券 / loc=分享膨胀定位
let curTag = null; // 当前选中标签，null = 显示全部
const LIST = $('#list');
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return seed.slice();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
function uid() { return 'local_' + Math.random().toString(36).slice(2, 9); }

/* ---------- 工具 ---------- */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.classList.add('hidden'), 250); }, 1800);
}
function $(s) { return document.querySelector(s); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return esc(s); }

/* ---------- 统一确认 / 输入弹窗（替代原生 confirm / prompt，风格统一） ---------- */
let _confirmResolve = null;
function showConfirmModal(opts) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = opts.title || '确认';
    document.getElementById('confirmMsg').textContent = opts.msg || '';
    const wrap = document.getElementById('confirmInputWrap');
    const input = document.getElementById('confirmInput');
    if (opts.input) { wrap.classList.remove('hidden'); input.value = opts.value || ''; setTimeout(() => input.focus(), 50); }
    else { wrap.classList.add('hidden'); input.value = ''; }
    modal.classList.remove('hidden');
  });
}
function closeConfirmModal(result) {
  const modal = document.getElementById('confirmModal');
  modal.classList.add('hidden');
  if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(result); }
}
document.getElementById('confirmOk').addEventListener('click', () => {
  const wrap = document.getElementById('confirmInputWrap');
  closeConfirmModal(wrap.classList.contains('hidden') ? true : document.getElementById('confirmInput').value);
});
document.getElementById('confirmCancel').addEventListener('click', () => closeConfirmModal(false));
document.getElementById('confirmBackdrop').addEventListener('click', () => closeConfirmModal(false));
function uiConfirm(msg, title) { return showConfirmModal({ msg, title }); }
function uiPrompt(msg, def, title) { return showConfirmModal({ msg, title, input: true, value: def }); }

/* 同步接口签名（HMAC-SHA256）：HTTPS 下用 Web Crypto 计算；http 环境无 crypto.subtle 则返回 null（服务端仅以 key 放行） */
async function syncMac(key, data) {
  try {
    if (crypto && crypto.subtle) {
      const enc = new TextEncoder();
      const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
      return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  return null;
}

/* 统一 SVG 图标：等高、currentColor 描边、居中一致，解决 emoji 不对称 */
const ICON = {
  ticket: '<svg class="ic" viewBox="0 0 24 24"><path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8z"/><path d="M12 6v12" stroke-dasharray="2 2.2"/></svg>',
  dots: '<svg class="ic" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>',
  search: '<svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24"><path d="M9 3h6l-1 6 3 3H7l3-3-1-6z"/><path d="M12 17v4"/></svg>',
  copy: '<svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 012-2h8"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>',
  edit: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  bolt: '<svg class="ic" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  moon: '<svg class="ic" viewBox="0 0 24 24"><path d="M20 14a8 8 0 11-9-9 7 7 0 009 9z"/></svg>',
  save: '<svg class="ic" viewBox="0 0 24 24"><path d="M5 3h12l4 4v14H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>',
  import: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>',
  trashAll: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  open: '<svg class="ic" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H6a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>'
};
/* 注入静态占位图标 */
function injectIcons() {
  const set = (id, svg) => { const el = document.getElementById(id); if (el) el.innerHTML = svg; };
  set('brandLogo', ICON.ticket);
  set('menuBtn', ICON.dots);
  set('searchIc', ICON.search);
  set('paletteIc', ICON.search);
  set('emptyIco', ICON.ticket);
  set('modalClose', ICON.close);
  set('addBtn', ICON.plus);
  set('searchClear', ICON.close);
  set('claimIc', ICON.ticket);
}
function extractPoi(url) {
  const m = String(url || '').match(/poi_id_str=([^&\s"'<>\\]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
// 从任意文本提取第一个链接（支持「文字+链接」混排）
function extractUrl(text) {
  const s = String(text || '');
  // 更宽松的 URL 字符集：涵盖美团链接中所有可能的字符
  const safeChars = /[A-Za-z0-9._~:/?#@!$&'()*+,;=%\[\]-]+/;
  let m = s.match(new RegExp('https?://' + safeChars.source, 'i'));
  let url = m ? m[0] : null;
  if (!url) {
    m = s.match(new RegExp('\\b(?:[a-z0-9-]+\\.)+(?:cn|com|net|me|link|url|cc|xyz)\\b' + safeChars.source, 'i'));
    url = m ? m[0] : null;
  }
  if (!url) return null;
  // 清理尾部非 URL 字符（中文标点、引号等），但保留 & = 等 URL 参数
  return url.replace(/[。，、）)\]】」』"'.,;:!?\s\u2018-\u203a\u3000-\u303f\uff00-\uffef]+$/, '');
}

// 从任意文本提取所有 http(s) 链接（用于批量识别）
function extractAllUrls(text) {
  const s = String(text || '');
  const safeChars = /[A-Za-z0-9._~:/?#@!$&'()*+,;=%\[\]-]+/;
  const re = new RegExp('https?://' + safeChars.source, 'gi');
  const urls = [];
  let m;
  while ((m = re.exec(s))) {
    let u = m[0].replace(/[。，、）)\]】」』"'.,;:!?\s\u2018-\u203a\u3000-\u303f\uff00-\uffef]+$/, '');
    urls.push(u);
  }
  return [...new Set(urls)];
}
// 从分享文字智能提取店名（优先 「」 【】 「」 "" 包裹；允许内含中文括号（））
function extractName(text) {
  const clean = n => (n || '').replace(/\s*(?:快来领券|领券|领取|优惠券|团购|满减|立减|秒杀).*$/i, '').replace(/^\s+|\s+$/g, '');
  const s = String(text || '');
  // 外层书名号/方括号/引号内的完整店名（不把中文括号（）当分隔符，避免「旺角大排档（粤菜小炒）」被截断）
  let m = s.match(/[「【『“"']([\s\S]*?)[\]」】』”"']/);
  if (m && clean(m[1])) return clean(m[1]);
  // 退而求其次：匹配「店/馆/楼/铺/坊/档/餐厅…」等词及其前后文（含中文括号）
  const before = s.split(/https?:\/\//)[0];
  m = before.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·\-·\s]{2,30}?(?:店|馆|楼|铺|坊|档|餐厅|美食|小吃|超市|便利店)[^，。,\n]{0,16})/);
  if (m && clean(m[1])) return clean(m[1]);
  return '';
}
// 判断店铺名是否有效（过滤纯平台名/无意义名称）
function isValidShopName(name) {
  if (!name || !name.trim()) return false;
  const s = name.trim();
  // 纯平台名、过短、无意义名称
  if (/^(美团|大众点评|美团外卖|Meituan|Dianping)$/.test(s)) return false;
  if (s.length < 2) return false;
  // 只有平台关键词没有实际店名
  if (/^(美团|大众点评)[·\-–|:\s]/.test(s) || /[·\-–|:\s](美团|大众点评)$/.test(s)) return false;
  return true;
}

// 美团黄色平台 logo（拿不到真实商家头像时的降级兜底）
const MEITUAN_FALLBACK_LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#FFD100"/><text x="50" y="68" text-anchor="middle" font-size="42" font-weight="bold" fill="#333">美团</text></svg>');

// 判断 URL 是否为无效/二维码类图片（需要降级处理）
function isInvalidLogoUrl(url) {
  if (!url) return true;
  const u = String(url).toLowerCase();
  // 二维码、占位图、1x1像素、data:text、about: 等
  return /^data:image\/svg/.test(url)
    || /qrcode|qr_code|qr-code|barcode|二維碼|二维码/i.test(u)
    || /placeholder|empty|loading|gray|grey|spacer|default.*avatar/i.test(u);
}

// logo 优先级：base64缓存 → 外链URL(非无效) → 美团黄色降级logo
function logoHtml(it) {
  const ch = (it.name || '?').trim().charAt(0) || '?';
  const src = it.logoData || it.logo;
  // 有资源但识别为无效（二维码/SVG占位等）→ 直接降级
  if (src && !isInvalidLogoUrl(src)) return `<img class="logo-img" src="${esc(src)}" alt="" onerror="this.src='${MEITUAN_FALLBACK_LOGO}'">`;
  // 无有效资源 → 用美团黄色logo降级（不再用首字色块）
  return `<img class="logo-img" src="${MEITUAN_FALLBACK_LOGO}" alt="">`;
}
// 把头像图片下载转 base64 缓存进本机（离线/换网络也能显示）。
// 跨域或过大（>3MB）则失败，降级为外链 URL（仍由浏览器 HTTP 缓存兜底）。
function cacheImage(url) {
  return new Promise(resolve => {
    if (!url || !/^https?:\/\//i.test(url)) return resolve(null);
    try {
      fetch(url).then(r => { if (!r.ok) throw 0; return r.blob(); }).then(b => {
        if (b.size > 3 * 1024 * 1024) return resolve(null);
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(b);
      }).catch(() => resolve(null));
    } catch (e) { resolve(null); }
  });
}

/* 格式化领取时间：YYYY-MM-DD HH:mm:ss */
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------- 标签栏渲染 ---------- */
function renderTagBar(allTags) {
  const bar = $('#tagBar');
  if (!bar) return;
  // 没有标签且没选中任何标签 → 隐藏
  if (allTags.length === 0 && !curTag) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = ''
    + '<button class="tag-btn' + (!curTag ? ' active' : '') + '" data-tag="">全部</button>'
    + allTags.map(t => '<button class="tag-btn' + (curTag === t ? ' active' : '') + '" data-tag="' + escAttr(t) + '">' + esc(t) + '</button>').join('');
  bar.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      curTag = btn.dataset.tag || null;
      render();
    });
  });
}

/* ---------- 渲染 ---------- */
function render() {
  if (curPage === 'claim') return drawClaim();
  if (curPage === 'loc') return drawLoc();
  return renderShop();
}

function setEmpty(html) { const e = $('#empty'); e.innerHTML = html; const ei = e.querySelector('#emptyIco'); if (ei) ei.innerHTML = ICON.ticket; }

/* 商家津贴页：原有商家收藏卡片，去掉领取状态筛选，统一按更新时间排序 */
function renderShop() {
  const q = ($('#search').value || '').trim().toLowerCase();
  let list_data = data.filter(it =>
    (!q || it.name.toLowerCase().includes(q) || (it.note || '').toLowerCase().includes(q))
  );
  // 标签筛选
  if (curTag) list_data = list_data.filter(i => (i.tags || []).includes(curTag));

  list_data.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));

  // 收集所有标签（用于标签栏显示）
  const allTags = [...new Set(data.flatMap(it => it.tags || []))].sort();

  const list = $('#list'); list.innerHTML = '';
  $('#statCount').textContent = `共 ${data.length} 个`;
  $('#statPinned').textContent = `置顶 ${data.filter(i => i.pinned).length}`;
  updateStatbar();
  setEmpty('<div class="empty-emoji" id="emptyIco"></div><p>粘贴美团店铺链接即可自动识别并收藏</p>');
  $('#empty').classList.toggle('hidden', list_data.length > 0);

  // 渲染标签栏
  renderTagBar(allTags);

  list_data.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card' + (it.pinned ? ' pinned' : '');
    card.style.animationDelay = (idx * 0.025) + 's';
    card.dataset.id = it.id;
    const v8 = it.poi ? urlV8(it.poi) : '';
    card.innerHTML = `
      <div class="card-top">
        ${logoHtml(it)}
        <div class="shop-meta">
          <div class="card-name" title="${esc(it.name)}">${esc(it.name)}</div>
          <div class="card-sub"><span>${esc(it.amount || '')}</span></div>
          ${it.updatedAt ? `<div class="card-time${it.claimed ? ' claimed' : ''}">最新领取：${fmtTime(it.updatedAt)}</div>` : ''}
        </div>
        <div class="card-pin">${it.pinned ? ICON.pin : ''}</div>
      </div>
      ${it.poi ? `<div class="card-addr" data-addr="${it.id}" title="点击复制领取地址"><span class="ca-label">领取地址 · ${esc(v8.length > 40 ? v8.slice(0, 40) + '…' : v8)}</span><span class="copy">${ICON.copy}</span></div>` : ''}
      ${((it.note || '') || (it.tags && it.tags.length)) ? '<div class="card-tags">'
        + (it.tags && it.tags.length ? it.tags.map(t => `<span class="tag-pill" data-tag="${escAttr(t)}">${esc(t)}</span>`).join('') : '')
        + (it.note ? '<span class="note-pill">' + esc(it.note) + '</span>' : '')
        + '</div>' : ''}
      <div class="card-actions">
        <div class="act-row">
          ${it.poi
            ? '<button class="btn btn-ok" data-act="claim"><span class="bi">' + ICON.ticket + '</span>领取 v8</button><button class="btn" data-act="claim2"><span class="bi">' + ICON.ticket + '</span>领取 v6</button>'
            : '<button class="btn btn-ok" data-act="edit"><span class="bi">' + ICON.edit + '</span>填 poi</button>'}
        </div>
        <div class="act-row">
          <button class="btn" data-act="pin"><span class="bi">${it.pinned ? ICON.pin : ICON.pin}</span>${it.pinned ? '取消置顶' : '置顶'}</button>
          <button class="btn" data-act="edit"><span class="bi">${ICON.edit}</span>编辑</button>
          <button class="btn btn-danger" data-act="del"><span class="bi">${ICON.trash}</span>删除</button>
        </div>
      </div>`;
    list.appendChild(card);
  });
}

/* ---------- 领券页 / 分享膨胀定位页：从后端读取并展示 ---------- */
let actsData = null, locsData = null;
async function loadActs() { try { const r = await fetch('/api/acts', { cache: 'no-store' }); const j = await r.json(); actsData = (j && j.ok) ? (j.data || []) : []; } catch (e) { actsData = []; } }
async function loadLocs() { try { const r = await fetch('/api/locs', { cache: 'no-store' }); const j = await r.json(); locsData = (j && j.ok) ? (j.data || []) : []; } catch (e) { locsData = []; } }

/* 领取链接智能打开：微信小程序链接 → 微信打开；其余（美团 App / 普通链接）→ 浏览器打开 */
function isWeixin() { return /micromessenger/i.test(navigator.userAgent); }
function isMiniProgramLink(u) { return /^#小程序:\/\//i.test(u || '') || /^weixin:\/\//i.test(u || '') || /小程序/.test(u || ''); }
function smartOpen(u) {
  if (!u) return;
  if (isMiniProgramLink(u)) {
    // 微信小程序链接：微信内直接唤起；外部则复制并提示去微信打开
    if (isWeixin()) { location.href = u; }
    else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(u).then(() => toast('已复制微信小程序链接，请在微信中打开'), () => toast('请在微信中打开：' + u));
    } else toast('请在微信中打开：' + u);
    return;
  }
  // 普通链接：跳转美团 App / 浏览器
  window.open(u, '_blank');
}

/* 领券页：活动链接卡片，点击直接跳转领取 */
function drawClaim() {
  $('#tagBar').classList.add('hidden');
  const q = ($('#search').value || '').trim().toLowerCase();
  const arr = (actsData || []).filter(it => !q || (it.title || '').toLowerCase().includes(q) || (it.url || '').toLowerCase().includes(q) || (it.note || '').toLowerCase().includes(q));
  LIST.innerHTML = '';
  setEmpty(actsData === null
    ? '<div class="empty-emoji" id="emptyIco"></div><p>加载中…</p>'
    : '<div class="empty-emoji" id="emptyIco"></div><p>还没有活动链接，命令面板 Ctrl+K → 后台管理 添加</p>');
  $('#empty').classList.toggle('hidden', arr.length > 0);
  arr.forEach(it => {
    const isMini = isMiniProgramLink(it.url);
    const url = it.url || '';
    const addrLabel = isMini ? '微领券地址' : '领取地址';
    const card = document.createElement('div');
    card.className = 'card act-card' + (isMini ? ' act-mini' : '');
    card.innerHTML = `
      <div class="card-top" data-act="open">
        <div class="shop-meta">
          <div class="card-name" title="${esc(it.title || '')}">${esc(it.title || '未命名活动')}</div>
          <div class="card-sub"><span>${isMini ? '<b style="color:#07c160">微信小程序</b> · 点击唤起微信领取' : '点击跳转领取'}</span></div>
          ${it.note ? `<div class="card-sub"><span>${esc(it.note)}</span></div>` : ''}
        </div>
        <div class="card-pin">${ICON.open}</div>
      </div>
      <div class="card-addr" data-act="copy" title="点击复制${addrLabel}"><span class="ca-label">${esc(addrLabel)} · ${esc(url)}</span><span class="copy">${ICON.copy}</span></div>`;
    // 顶部区域：打开链接（小程序链接自动唤起微信 App）
    const openEl = card.querySelector('[data-act="open"]');
    if (openEl) openEl.addEventListener('click', () => { if (url) smartOpen(url); });
    // 地址小横条：点击自动复制（不触发打开）
    const copyEl = card.querySelector('[data-act="copy"]');
    if (copyEl) copyEl.addEventListener('click', e => {
      e.stopPropagation();
      if (!url) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          toast('已复制' + addrLabel);
          copyEl.classList.add('copied');
          const c = copyEl.querySelector('.copy'); if (c) c.innerHTML = ICON.check;
          setTimeout(() => { copyEl.classList.remove('copied'); if (c) c.innerHTML = ICON.copy; }, 1200);
        }, () => toast('复制失败'));
      } else toast(url);
    });
    LIST.appendChild(card);
  });
}

/* 分享膨胀定位页：定位点卡片，点击复制「地名 纬度,经度」 */
function drawLoc() {
  $('#tagBar').classList.add('hidden');
  const q = ($('#search').value || '').trim().toLowerCase();
  const arr = (locsData || []).filter(it => !q || (it.place || '').toLowerCase().includes(q) || (it.lat || '').includes(q) || (it.lng || '').includes(q) || (it.note || '').toLowerCase().includes(q));
  LIST.innerHTML = '';
  setEmpty(locsData === null
    ? '<div class="empty-emoji" id="emptyIco"></div><p>加载中…</p>'
    : '<div class="empty-emoji" id="emptyIco"></div><p>还没有定位点，命令面板 Ctrl+K → 后台管理 添加</p>');
  $('#empty').classList.toggle('hidden', arr.length > 0);
  arr.forEach(it => {
    const coord = (it.lat || '') + ', ' + (it.lng || '');
    const card = document.createElement('div');
    card.className = 'card loc-card';
    card.innerHTML = `
      <div class="card-top">
        <div class="shop-meta">
          <div class="card-name" title="${esc(it.place || '')}">${esc(it.place || '未命名地点')}</div>
          <div class="card-sub"><span>${esc(coord)}</span></div>
          ${it.note ? `<div class="card-sub"><span>${esc(it.note)}</span></div>` : ''}
        </div>
      </div>
      <div class="card-addr" data-act="copy"><span class="ca-label">点击复制：${esc(it.place || '')} ${esc(coord)}</span><span class="copy">${ICON.copy}</span></div>`;
    card.addEventListener('click', () => {
      const text = ((it.place || '') + ' ' + coord).trim();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('已复制：' + text), () => toast(text));
      else toast(text);
    });
    LIST.appendChild(card);
  });
}

/* ---------- 列表事件 ---------- */
$('#list').addEventListener('click', async e => {
  if (curPage !== 'shop') return; // 领券/定位页的卡片点击由各自渲染时绑定，不走商家逻辑
  const addrEl = e.target.closest('[data-addr]');
  if (addrEl) {
    const it = data.find(x => x.id === addrEl.dataset.addr);
    if (it && it.poi) {
      navigator.clipboard?.writeText(urlV8(it.poi)).then(() => {
        toast('已复制领取地址');
        addrEl.classList.add('copied');
        const c = addrEl.querySelector('.copy'); if (c) c.innerHTML = ICON.check;
        setTimeout(() => { addrEl.classList.remove('copied'); if (c) c.innerHTML = ICON.copy; }, 1200);
      }, () => toast('复制失败'));
    }
    return;
  }
  // 标签点击 → 筛选该标签
  const tagEl = e.target.closest('.tag-pill');
  if (tagEl) {
    const tag = tagEl.dataset.tag;
    curTag = (curTag === tag) ? null : tag; // 再次点击取消筛选
    render();
    toast(curTag ? '筛选标签：' + curTag : '已清除标签筛选');
    return;
  }
  const btn = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!card) return;
  const it = data.find(x => x.id === card.dataset.id);
  if (!it) return;
  if (btn) {
    e.stopPropagation();
    const a = btn.dataset.act;
    if (a === 'claim') return claim(it, 1);
    if (a === 'claim2') return claim(it, 2);
    if (a === 'pin') { it.pinned = !it.pinned; it.updatedAt = Date.now(); save(); render(); toast(it.pinned ? '已置顶' : '已取消置顶'); return; }
    if (a === 'del') { if (await uiConfirm(`确认删除「${it.name}」？`)) { data = data.filter(x => x.id !== it.id); save(); render(); toast('已删除'); } return; }
    if (a === 'edit') return openEditor(it);
  }
  openDetail(it);
});

/* ---------- 领取（标记已领取并打开链接） ---------- */
function claim(it, which) {
  if (!it.poi) { toast('该条目未配置商家，已打开编辑'); return openEditor(it); }
  const url = which === 1 ? urlV8(it.poi) : urlV6(it.poi);
  it.claimed = true; it.updatedAt = Date.now(); bumpStat(which); save(); render();
  window.open(url, '_blank');
  toast(which === 2 ? '已打开额外第2张（v6）' : '已打开领取通道（v8）');
}

/* ---------- 新增 / 编辑 ---------- */
$('#addBtn').addEventListener('click', () => openEditor(null));
function openEditor(it) {
  const editing = !!it;
  const item = it || { id: uid(), name: '', poi: '', amount: '', logo: '', note: '', tags: [], pinned: false, claimed: false, updatedAt: Date.now() };
  const tagsStr = (item.tags || []).join('，');
  $('#modalTitle').textContent = editing ? '编辑收藏' : '新增收藏';
  $('#modalBody').innerHTML = `
    <div class="field"><label>店铺名称</label><input id="f_name" value="${esc(item.name)}" placeholder="例如：木桶饭湘菜馆（南海店）"></div>
    <div class="field"><label>logo 图片地址（选填，留空用首字色块）</label><input id="f_logo" value="${esc(item.logo)}" placeholder="https://.../logo.png"></div>
    <div class="row">
      <div class="field"><label>券面额（选填）</label><input id="f_amount" value="${esc(item.amount)}" placeholder="例如：3元商家券"></div>
      <div class="field"><label>置顶</label>
        <select id="f_pinned">
          <option value="0" ${!item.pinned ? 'selected' : ''}>否</option>
          <option value="1" ${item.pinned ? 'selected' : ''}>是（置顶）</option>
        </select>
      </div>
    </div>
    <div class="field"><label>poi_id_str（商家ID）</label><input id="f_poi" value="${esc(item.poi)}" placeholder="例如：7FATrlwYZgjK0Wo13H0zOAI"></div>
    <div class="field"><label>标签（选填，逗号分隔多标签）</label><input id="f_tags" value="${esc(tagsStr)}" placeholder="例如：早餐,夜宵,奶茶"></div>
    <div class="field"><label>备注</label><textarea id="f_note" rows="2" placeholder="选填，例如：周三可用 / 满20减3">${esc(item.note)}</textarea></div>
    <div class="modal-foot">
      ${editing ? '<button class="btn btn-danger" id="delBtn">删除</button>' : ''}
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="saveBtn">保存</button>
    </div>`;
  openModal();
  $('#saveBtn').addEventListener('click', () => {
    item.name = $('#f_name').value.trim() || '未命名商家';
    const logoUrl = $('#f_logo').value.trim();
    item.logo = logoUrl;
    item.amount = $('#f_amount').value.trim();
    item.poi = $('#f_poi').value.trim();
    item.note = $('#f_note').value.trim();
    // 解析标签（支持中英文逗号分隔）
    const rawTags = ($('#f_tags') && $('#f_tags').value) || '';
    item.tags = rawTags.split(/[,，]/).map(t => t.trim()).filter(t => t.length > 0);
    item.pinned = $('#f_pinned').value === '1';
    item.updatedAt = Date.now();
    if (!editing) data.push(item);
    save(); render(); closeModal(); toast('已保存');
    // 头像转为 base64 缓存在本机：离线/换网络也能显示，不依赖外链
    if (!logoUrl) { delete item.logoData; delete item.logoSrc; save(); }
    else if (logoUrl !== item.logoSrc) {
      cacheImage(logoUrl).then(b64 => {
        item.logoSrc = logoUrl;
        if (b64) item.logoData = b64; else delete item.logoData;
        save(); render();
      });
    }
  });
  if (editing) $('#delBtn').addEventListener('click', async () => { if (await uiConfirm(`确认删除「${item.name}」？`)) { data = data.filter(x => x.id !== it.id); save(); render(); closeModal(); toast('已删除'); } });
}

/* ---------- 详情（logo / 名称 / 地址 / 备注 / 领取） ---------- */
function openDetail(it) {
  $('#modalTitle').textContent = '店铺详情';
  const v8 = it.poi ? urlV8(it.poi) : '';
  $('#modalBody').innerHTML = `
    <div class="shop-head">
      ${logoHtml(it)}
      <div>
        <div class="h-name">${esc(it.name)}</div>
        <div class="h-sub">${esc(it.amount || '')} ${it.claimed ? '' : '<span class="pill">待领取</span>'}</div>
      </div>
    </div>
    ${it.claimed && it.updatedAt ? `<div class="modal-time claimed">最新领取：${fmtTime(it.updatedAt)}</div>` : ''}
    ${it.poi ? `
      <div class="channel"><div class="ch-left"><span class="ch-ic">${ICON.ticket}</span><div><div class="ch-label">领取通道（可切号）</div><div class="ch-sub">主领取 v8</div></div></div><button class="btn btn-ok" id="ch1"><span class="bi">${ICON.open}</span>打开</button></div>
      <div class="channel"><div class="ch-left"><span class="ch-ic">${ICON.ticket}</span><div><div class="ch-label">领取通道（额外第2张）</div><div class="ch-sub">第二张 v6</div></div></div><button class="btn" id="ch2"><span class="bi">${ICON.open}</span>打开</button></div>
      <div class="addr-line">领取地址：<br>${esc(v8)}</div>` : `<div class="warn-box">未配置 poi_id_str，无法生成领取链接。点「编辑」填写。</div>`}
    ${it.note ? `<div class="warn-box">${esc(it.note)}</div>` : ''}
    <div class="modal-foot">
      <button class="btn" id="copyBtn" ${it.poi ? '' : 'disabled'}>复制地址</button>
      <button class="btn" id="editBtn">编辑</button>
      <button class="btn btn-primary" id="claimAllBtn" ${it.poi ? '' : 'disabled'}>一键领取本店</button>
    </div>`;
  openModal();
  // ====== 商家券实时更新：每次打开详情都查询后端最新数据 ======
  if (it.poi) {
    fetch('/api/shop?poi=' + encodeURIComponent(it.poi), { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then(j => {
        if (!(j && j.ok)) return;
        const logoUrl = j.logo;
        const shopName = j.name;
        let changed = false;

        // 更新名称（如果后端返回了更完整且有效的名字）
        if (isValidShopName(shopName) && shopName !== it.name && it.name !== '该店铺') {
          it.name = shopName; changed = true;
          const hName = document.querySelector('.h-name');
          if (hName) hName.textContent = esc(shopName);
        }

        // 更新/缓存头像（无条件更新：即使已有旧logo也替换为最新的）
        if (logoUrl && logoUrl !== it.logoSrc) {
          cacheImage(logoUrl).then(b64 => {
            it.logoSrc = logoUrl;
            if (b64) { it.logoData = b64; delete it.logo; }
            else { it.logo = logoUrl; delete it.logoData; }
            save(); render();
          });
          changed = true;
        } else if (!it.logoData && !it.logo || isInvalidLogoUrl(it.logo)) {
          // 当前无有效头像 → 清除无效logo，让渲染时自动降级为美团黄logo
          if (it.logo) { delete it.logo; delete it.logoData; delete it.logoSrc; changed = true; }
        }

        if (changed) save();
      })
      .catch(() => {});
  }
  if (it.poi) {
    $('#ch1').onclick = () => claim(it, 1);
    $('#ch2').onclick = () => claim(it, 2);
    $('#copyBtn').onclick = () => navigator.clipboard?.writeText(v8).then(() => toast('已复制领取地址'), () => toast('复制失败'));
    $('#claimAllBtn').onclick = () => {
      closeModal();
      window.open(urlV8(it.poi), '_blank');
      setTimeout(() => window.open(urlV6(it.poi), '_blank'), 600);
      it.claimed = true; it.updatedAt = Date.now(); bumpStat(1); bumpStat(2); save(); render();
      toast('已打开本店全部通道 · 已标记领取');
    };
  }
  $('#editBtn').onclick = () => { closeModal(); openEditor(it); };
}

/* ---------- 弹窗 ---------- */
function openModal() { $('#modal').classList.remove('hidden'); }
function closeModal() {
  $('#modal').classList.add('hidden');
  // 关闭详情弹窗时自动清空搜索框（搜索链接识别后打开的详情）
  const searchEl = $('#search');
  if (searchEl && searchEl.value) {
    searchEl.value = '';
    toggleSearchClear();
    render();
  }
}
$('#modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

/* ---------- 分段筛选 ---------- */
const segBtns = [...document.querySelectorAll('.seg-btn')];
function moveSegInd() {
  const i = segBtns.findIndex(b => b.classList.contains('active'));
  $('#segInd').style.transform = `translateX(${i * 100}%)`;
}
function applyPageChrome() {
  // 剪贴板识别区域只在津贴（商家）页有意义，领券/定位页隐藏
  const ca = document.getElementById('clipArea');
  if (ca) ca.classList.toggle('hidden', curPage !== 'shop');
}
segBtns.forEach((b, i) => b.addEventListener('click', async () => {
  segBtns.forEach(x => x.classList.remove('active'));
  b.classList.add('active'); curPage = b.dataset.page; moveSegInd();
  if (curPage === 'claim') await loadActs();
  else if (curPage === 'loc') await loadLocs();
  applyPageChrome();
  render();
}));
moveSegInd();
applyPageChrome();

/* ---------- 使用说明折叠 ---------- */
$('#helpToggle').addEventListener('click', () => {
  const h = $('#help'); const hidden = h.classList.toggle('hidden');
  $('#helpToggle').textContent = hidden ? '使用说明 ▾' : '收起说明 ▴';
});

/* ---------- 更多菜单（命令面板） ---------- */
$('#menuBtn').addEventListener('click', () => paletteOpen(COMMANDS.slice(), '输入指令…'));
function exportData() { const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `coupon-collection-${Date.now()}.json`; a.click(); toast('已导出'); }
function importData() { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json'; inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const arr = JSON.parse(r.result); if (Array.isArray(arr)) { data = arr; save(); render(); toast('导入成功'); } else toast('格式不正确'); } catch { toast('解析失败'); } }; r.readAsText(f); }; inp.click(); }
async function clearAll() { if (await uiConfirm('确认清空全部收藏？')) { data = []; save(); render(); toast('已清空'); } }

/* ---------- 跨设备同步（需宝塔版后端 /sync；云端 worker 暂不支持） ---------- */
const SYNC_KEY = 'mt_coupon_sync_key';
function getSyncKey() {
  let k = '';
  try { k = localStorage.getItem(SYNC_KEY) || ''; } catch (e) {}
  if (!k) { k = uid().slice(0, 12); try { localStorage.setItem(SYNC_KEY, k); } catch (e) {} }
  return k;
}
async function syncUpload() {
  const key = getSyncKey();
  if (!await uiConfirm('将把本机 ' + data.length + ' 个收藏上传并覆盖云端（同步码：' + key + '）。继续？')) return;
  try {
    const body = JSON.stringify(data);
    const mac = await syncMac(key, 'POST|/sync|' + body);
    const url = '/sync?key=' + encodeURIComponent(key) + (mac ? '&mac=' + mac : '');
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok) toast('已上传同步（' + data.length + ' 个）');
    else toast('上传失败：' + (j && j.error || '未知'));
  } catch (e) { toast('同步失败：当前后端可能不支持（请用宝塔版）'); }
}
async function syncDownload() {
  const key = getSyncKey();
  try {
    const mac = await syncMac(key, 'GET|/sync|');
    const url = '/sync?key=' + encodeURIComponent(key) + (mac ? '&mac=' + mac : '');
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok && Array.isArray(j.data)) {
      if (!await uiConfirm('将用云端 ' + j.data.length + ' 个收藏覆盖本机。继续？')) return;
      data = j.data; save(); render(); toast('已下载同步（' + data.length + ' 个）');
    } else if (j && j.ok && !j.data) {
      toast('云端暂无数据，请先上传');
    } else {
      toast('下载失败：' + (j && j.error || '未知'));
    }
  } catch (e) { toast('同步失败：当前后端可能不支持（请用宝塔版）'); }
}
async function setSyncKey() {
  const cur = getSyncKey();
  const v = await uiPrompt('设置同步码（跨设备保持一致即可共享数据）：', cur);
  if (v && v.trim()) { try { localStorage.setItem(SYNC_KEY, v.trim()); } catch (e) {} toast('同步码已设为：' + v.trim()); }
}

/* ---------- 深色模式 ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  // 同步浏览器地址栏/状态栏颜色，避免切换主题后顶部仍显示旧色（移动端“颜色卡住”现象）
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', t === 'dark' ? '#171719' : '#e9ebef');
}
function toggleTheme() { const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; applyTheme(cur); toast(cur === 'dark' ? '已切换深色' : '已切换浅色'); }
applyTheme(localStorage.getItem(THEME_KEY) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

/* ---------- 搜索：粘贴店铺链接自动识别并保存 ---------- */
async function resolveLink(url) {
  if (location.protocol === 'file:') return { poi: null, needLocalhost: true };
  try {
    const r = await fetch('/resolve?url=' + encodeURIComponent(url));
    const j = await r.json().catch(() => ({}));
    return { poi: (j && j.poi) || null, poiNum: (j && j.poiNum) || null, finalUrl: (j && j.finalUrl) || null, logo: (j && j.logo) || null, name: (j && j.name) || null, ok: !!(j && j.ok) };
  } catch (e) { return { poi: null, error: e.message }; }
}

function autoSave(poi, opts) {
  let it = data.find(d => d.poi === poi);
  if (it) {
    it.updatedAt = Date.now();
    if (opts.name && (!it.name || it.name === '该店铺')) it.name = opts.name;
    if (opts.app) it.app = opts.app;
  } else {
    it = { id: uid(), name: opts.name || '该店铺', poi, amount: '', logo: '', note: '', tags: [], pinned: false, claimed: false, updatedAt: Date.now(), app: opts.app || 'waimai' };
    data.push(it);
  }
  save(); render();
  // 后端返回的美团店铺头像：自动下载转 base64 缓存到本机（离线/换网络也能显示）
  if (opts.logo && opts.logo !== it.logoSrc) {
    cacheImage(opts.logo).then(b64 => {
      it.logoSrc = opts.logo;
      if (b64) it.logoData = b64;            // 成功：存成本机 base64
      else { it.logo = opts.logo; delete it.logoData; } // 跨域失败：降级为外链 URL
      save(); render();
    });
  }
  return it;
}

function setSearching(on) {
  $('#searchSpinner').classList.toggle('hidden', !on);
  $('#search').style.opacity = on ? '.6' : '1';
}
async function handleLinkSearch(v) {
  // 检测是否包含多条链接 → 批量识别
  const allUrls = extractAllUrls(v);
  if (allUrls.length > 1) {
    const ok = await uiConfirm(`检测到 ${allUrls.length} 个商家链接，是否全部识别并添加到收藏？`);
    if (!ok) { setSearching(false); return; }
    setSearching(true);
    let added = 0;
    for (const u of allUrls) {
      try {
        let poi = extractPoi(u);
        let info = null;
        if (!poi) info = await resolveLink(u);
        const resolved = poi || (info && info.poi);
        if (resolved) {
          const name = extractName(v) || (info && info.name) || ('商家' + (added + 1));
          autoSave(resolved, { name: name + (added > 0 ? ` (${added+1})` : ''), logo: (info && info.logo) || null });
          added++;
        }
      } catch (e) { /* 单条失败继续下一条 */ }
    }
    setSearching(false);
    if (added > 0) toast('批量识别完成：' + added + ' 家店铺已添加');
    else toast('未能识别出任何有效店铺');
    return;
  }

  // 单条链接：原有逻辑
  const url = extractUrl(v) || v;
  setSearching(true);
  try {
    let poi = extractPoi(url);
    let info = null;
    if (!poi) info = await resolveLink(url);
    const resolved = poi || (info && info.poi);
    if (resolved) {
      const name = extractName(v) || (info && info.name);
      const it = autoSave(resolved, { name, logo: (info && info.logo) || null });
      toast('已识别并保存：' + it.name);
      openDetail(it);
      return;
    }
    if (info && info.needLocalhost) toast('请用 http://localhost:8123/ 打开本页（file:// 受限）');
    else if (info && info.error) toast('服务连接失败，请确认已部署 / 启动服务');
    else if (info && info.poiNum) toast(`该链接只有数字店铺ID(${info.poiNum})，不含 poi_id_str，无法直接领券`);
    else if (info && info.finalUrl) toast('已跟随跳转，但链接里没有 poi_id_str，请确认是「美团店铺分享」链接');
    else toast('未能解析出店铺，请粘贴美团链接（含 poi_id_str）');
  } finally {
    setSearching(false);
  }
}

/* ---------- 批量领取全部（生成一页，逐张点开，绕过弹窗拦截） ---------- */
async function batchClaimAll() {
  const items = data.filter(i => i.poi);
  if (!items.length) { toast('暂无收藏商家，请先搜索添加'); return; }
  if (!await uiConfirm(`生成批量领券页？共 ${items.length} 个商家（v8 主券 + v6 第二张，逐张点开）`)) return;
  let html = '<!doctype html><meta charset="utf-8"><title>批量领券</title>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:-apple-system,Segoe UI,PingFang SC,sans-serif;background:#f3f4f7;color:#111;padding:18px;max-width:560px;margin:0 auto}'
    + 'h3{margin:0 0 4px;font-size:17px}.tip{color:#888;font-size:12px;margin:0 0 14px}'
    + '.c{display:block;padding:13px 14px;margin:8px 0;background:#fff;border:1px solid #e6e6e6;border-radius:13px;text-decoration:none;color:#111;box-shadow:0 2px 8px rgba(0,0,0,.04)}'
    + '.c b{font-size:14px}.sub{color:#888;font-size:12px;margin-top:3px}</style>'
    + '<h3>批量领券 · ' + items.length + ' 个商家</h3>'
    + '<p class="tip">点击每张卡片在新标签打开领取页（每条均可切 v8 / v6）</p>';
  items.forEach(it => {
    html += '<a class="c" href="' + escAttr(urlV8(it.poi)) + '" target="_blank" rel="noopener"><b>' + esc(it.name) + '</b><div class="sub">v8 主券 · 点开领取</div></a>';
    html += '<a class="c" href="' + escAttr(urlV6(it.poi)) + '" target="_blank" rel="noopener"><b>' + esc(it.name) + '</b><div class="sub">v6 第二张 · 点开领取</div></a>';
  });
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  items.forEach(it => { it.claimed = true; it.updatedAt = Date.now(); bumpStat(1); bumpStat(2); });
  save(); render();
  toast('已生成批量领券页（' + items.length + ' 个商家）');
}

let searchTimer = null;
function toggleSearchClear() { $('#searchClear').classList.toggle('hidden', !$('#search').value); }
$('#searchClear').addEventListener('click', () => {
  $('#search').value = '';
  toggleSearchClear();
  render();
  $('#search').focus();
});
$('#search').addEventListener('input', e => {
  const v = e.target.value.trim();
  toggleSearchClear();
  // 非商家页面：仅做客户端过滤（活动链接 / 定位点），不触发链接识别
  if (curPage !== 'shop') { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); return; }
  if (extractUrl(v)) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => handleLinkSearch(v), 500);
    return;
  }
  // 普通文字搜索：防抖，避免逐字符重渲染
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
});
$('#search').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (extractUrl(v)) { clearTimeout(searchTimer); handleLinkSearch(v); }
  }
});

/* ---------- 命令面板 ---------- */
const paletteEl = $('#palette'), paletteInput = $('#paletteInput'), paletteList = $('#paletteList');
let paletteItems = [], paletteActive = 0;

const COMMANDS = [
  { icon: ICON.search, label: '搜索商家', desc: '聚焦搜索框', keys: '/', run: () => $('#search').focus() },
  { icon: ICON.plus, label: '新增收藏', desc: '添加新商家券', keys: 'N', run: () => openEditor(null) },
  { icon: ICON.bolt, label: '批量领取', desc: '打开全部 v8+v6', keys: 'B', run: batchClaimAll },
  { icon: ICON.moon, label: '切换深色', desc: '浅色/深色切换', keys: 'T', run: toggleTheme },
  { icon: ICON.open, label: '接口说明', desc: '查看接口与用法', run: showApiDocs },
  { icon: ICON.save, label: '导出数据', desc: '下载 JSON 备份', run: exportData },
  { icon: ICON.import, label: '导入数据', desc: '从 JSON 恢复', run: importData },
  { icon: ICON.bolt, label: '上传同步', desc: '本机推送到云端', run: syncUpload },
  { icon: ICON.open, label: '下载同步', desc: '云端拉取到本机', run: syncDownload },
  { icon: ICON.edit, label: '设置同步', desc: '跨设备共用标识', run: setSyncKey },
  { icon: ICON.trashAll, label: '清空全部', desc: '删除所有收藏', run: clearAll },
  { icon: ICON.open, label: '后台管理', desc: '添加活动/定位', run: () => window.open('/admin', '_blank') }
];

function paletteOpen(items, placeholder) {
  paletteItems = items; paletteActive = 0; paletteInput.value = '';
  paletteInput.placeholder = placeholder || '输入指令…';
  renderPalette(''); paletteEl.classList.remove('hidden'); paletteInput.focus();
}
function renderPalette(q) {
  q = (q || '').trim().toLowerCase();
  const list = paletteItems.filter(i => !q || i.label.toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q));
  paletteList.innerHTML = '';
  if (list.length === 0) { paletteList.innerHTML = `<li style="color:var(--muted);cursor:default">无匹配指令</li>`; return; }
  list.forEach((it, idx) => {
    const li = document.createElement('li');
    if (idx === paletteActive) li.className = 'active';
    li.innerHTML = `<span class="pi">${it.icon || '•'}</span><span class="lbl">${esc(it.label)}</span>${it.desc ? `<span class="desc">${esc(it.desc)}</span>` : ''}${it.keys ? `<kbd class="pk">${it.keys}</kbd>` : ''}`;
    li.addEventListener('click', () => runPalette(it));
    li.addEventListener('mousemove', () => { paletteActive = idx; markActive(); });
    paletteList.appendChild(li);
  });
}
function markActive() { [...paletteList.children].forEach((li, i) => li.classList.toggle('active', i === paletteActive)); }
function visibleItems() { const q = paletteInput.value.trim().toLowerCase(); return paletteItems.filter(i => !q || i.label.toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q)); }
function runPalette(it) { closePalette(); setTimeout(() => it.run && it.run(), 0); }
function closePalette() { paletteEl.classList.add('hidden'); }

paletteInput.addEventListener('input', () => { paletteActive = 0; renderPalette(paletteInput.value); });
paletteInput.addEventListener('keydown', e => {
  const v = visibleItems();
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteActive = (paletteActive + 1) % v.length; markActive(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteActive = (paletteActive - 1 + v.length) % v.length; markActive(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(v[paletteActive]); }
  else if (e.key === 'Escape') closePalette();
});
document.querySelectorAll('[data-palette-close]').forEach(el => el.addEventListener('click', closePalette));

/* ---------- API 调用说明（菜单内查看接口与用途） ---------- */
function showApiDocs() {
  const base = location.origin;
  const rows = [
    { p: '?jk=v8=<美团分享链接>', d: '【一键跳 App 领券】把整段分享话术（或带 poi 的链接）直接贴进来，服务端自动解析 poi_id_str 后 302 跳转到美团 App 领券页。v8 主券 / v6 第二张，无需打开本站页面，最适合做 iOS 快捷指令。' },
    { p: '?jkclip=v8', d: '【读剪贴板直跳 App·链接版】打开此链接后页面自动读取剪贴板里的美团分享链接→解析 poi→跳 App，等于把首页「读剪贴板·直跳美团 App 领券」按钮变成一条可分享/可放快捷指令的链接（v8 主券 / v6 第二张）。iOS 若自动读剪贴板被拦截，点一下页面顶部按钮即可。' },
    { p: '?claim=<poi>&v=8', d: '【跳 App 领券】已知 poi_id_str 时直接跳转美团 App/H5 领取（v8 主券，v=6 为第二张）。' },
    { p: '?url=<美团分享链接>', d: '自动识别店铺 poi_id_str 并打开详情（识别即收藏）。iOS 快捷指令最常用：复制链接后用「打开 URL」跳到这里即可。' },
    { p: '?open=<任意网址>', d: '中转直接打开任意网址（用于需要统一入口的场景）。' },
    { p: '?poi=<poi>', d: '打开本机已收藏的该商家详情（需本机先识别收藏过）。' },
    { p: '/api/shop?poi=<poi>', d: '返回该商家真实店名与头像，JSON：{ok,logo,name}，供详情页实时刷新头像用。' },
    { p: '/api/claim?poi=<poi>', d: '返回该商家 v8 / v6 领券链接，JSON：{ok,poi,v8,v6}。' },
    { p: '/api/deeplink?ver=v8&url=<分享链接>', d: '【接口版·跳 App】输入美团分享链接/整段话术，解析 poi 后返回深链 JSON：{ok,poi,ver,app,h5}。加 &format=page 则直接返回中转页 HTML（由页面内 JS 唤起 App），快捷指令「打开 URL」一步到位。ver=v8 主券 / v6 第二张。' },
    { p: '/resolve?url=<链接>', d: '服务端跟随跳转解析任意美团短链/分享链接，返回 poi、店名、头像等 JSON。' }
  ];
  $('#modalTitle').textContent = 'API 调用说明';
  $('#modalBody').innerHTML = `
    <p class="api-base">接口域名：<code>${esc(base)}</code></p>
    <p class="api-tip">把下面路径拼到域名后即可调用，例如：<br><code>${esc(base + '/?url=https://waimai.meituan.com/...')}</code></p>
    <div class="api-list">
      ${rows.map(r => `
        <div class="api-item">
          <div class="api-row"><code>${esc(r.p)}</code><button class="btn btn-sm copy-api" data-copy="${esc(base + '/' + r.p.replace(/^\/+/, ''))}">复制</button></div>
          <div class="api-desc">${esc(r.d)}</div>
        </div>`).join('')}
    </div>`;
  openModal();
  $('#modalBody').querySelectorAll('.copy-api').forEach(btn => {
    btn.addEventListener('click', () => {
      const txt = btn.dataset.copy;
      navigator.clipboard?.writeText(txt).then(() => toast('已复制接口地址'), () => toast('复制失败'));
    });
  });
}

/* ---------- 全局快捷键 ---------- */
document.addEventListener('keydown', e => {
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen(COMMANDS.slice(), '输入指令…'); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (meta) return;
  switch (e.key.toLowerCase()) {
    case '/': e.preventDefault(); $('#search').focus(); break;
    case 'n': e.preventDefault(); openEditor(null); break;
    case 'b': e.preventDefault(); batchClaimAll(); break;
    case 't': toggleTheme(); break;
    case 'k': paletteOpen(COMMANDS.slice(), '输入指令…'); break;
  }
});

/* ---------- 深度链接（iOS 快捷指令 / 外部跳转） ----------
   用法：
   ?jk=v8|v6=<美团分享链接/整段话术>   自动解析 poi 并 302 跳美团 App 领券页（最快路径）
   ?url=<美团链接>      自动识别并打开店铺详情
   ?claim=<poi>&v=8|6       直接打开对应领券链接（跳转美团 App/H5）
   ?open=<任意url>          直接打开该链接
   ?poi=<poi>               打开本机已收藏的该商家详情
----------------------------------------------------------- */
function handleDeepLink() {
  const p = new URLSearchParams(location.search);
  const url = p.get('url');
  const claim = p.get('claim');
  const jk = p.get('jk');
  const openUrl = p.get('open');
  const poi = p.get('poi');
  const jkclip = p.get('jkclip');

  if (openUrl) { window.location.href = openUrl; return; }

  /* ?jkclip=v8|v6：打开本页后自动读剪贴板→解析→跳 App（把首页按钮变成一条可分享/可放快捷指令的链接） */
  if (jkclip) {
    let ver = 'v8';
    const vm = String(jkclip).match(/^v?([68])$/);
    if (vm) ver = 'v' + vm[1];
    quickJumpFromClipboard(ver);
    history.replaceState(null, '', location.pathname);
    return;
  }

  /* ?jk=v8=<分享话术/链接>：客户端兜底解析 poi 并跳转到美团领券页（worker 301 未生效时生效） */
  if (jk) {
    const raw = decodeURIComponent(jk);
    let ver = 'v8', text = raw;
    const mm = raw.match(/^v?([68])=/);
    if (mm) { ver = 'v' + mm[1]; text = raw.slice(mm[0].length); }
    const um = text.match(/https?:\/\/[^\s"'<>）)]+/);
    if (um) {
      toast('正在解析店铺…');
      fetch('/resolve?url=' + encodeURIComponent(um[0]), { cache: 'no-store' })
        .then(r => r.json()).then(info => {
          if (info && info.poi) { window.location.href = (ver === 'v6' ? urlV6(info.poi) : urlV8(info.poi)); }
          else toast('解析失败，请确认是美团店铺分享链接');
        }).catch(() => toast('解析请求失败'));
      return;
    }
    if (text && text.includes('poi_id_str=')) {
      const pm = text.match(/poi_id_str=([^&\s"'<>\\]+)/);
      if (pm) { window.location.href = (ver === 'v6' ? urlV6(pm[1]) : urlV8(pm[1])); return; }
    }
    toast('未能从分享内容解析出店铺链接');
    return;
  }

  if (claim) {
    const v = (p.get('v') === '6') ? 6 : 8;
    const link = (v === 6 ? urlV6(claim) : urlV8(claim));
    const it = data.find(d => d.poi === claim);
    if (it) { it.claimed = true; it.updatedAt = Date.now(); bumpStat(v === 6 ? 2 : 1); save(); render(); }
    window.open(link, '_blank');   // iOS 上该 H5 页会自动提示「打开美团 App」
    toast('已跳转领取：' + (it ? it.name : claim));
    if (it) openDetail(it);
    history.replaceState(null, '', location.pathname);   // 清掉参数避免重复触发
    return;
  }

  if (url) {
    $('#search').value = url;
    if (window.toggleSearchClear) toggleSearchClear();
    handleLinkSearch(url);
    history.replaceState(null, '', location.pathname);
    return;
  }

  if (poi) {
    const it = data.find(d => d.poi === poi);
    if (it) { openDetail(it); history.replaceState(null, '', location.pathname); }
    else toast('本机未收藏该商家，请先识别');
  }
}

/* ---------- 自动读剪贴板 → 津贴领取 ---------- */
let clipInfo = { name: '', poi: null, url: '' };
let clipJumpTimer = null;

function imeituanDeepLink(poi, ver, appType) {
  const activityUrl = buildUrl(poi, ver); // offsiteact.meituan.com 津贴 H5
  const scheme = appScheme(appType);      // 美团外卖 → imeituanwaimai:// / 美团 → imeituan://
  return scheme + 'www.meituan.com/web?url=' + encodeURIComponent(activityUrl);
}

/* 执行跳转：标记已领 + 统计 + 唤起对应 App */
function doJumpClaim(poi, ver, appType) {
  appType = appType === 'main' ? 'main' : 'waimai';
  const it = data.find(d => d.poi === poi);
  if (it) { it.claimed = true; it.updatedAt = Date.now(); if (!it.app) it.app = appType; }
  bumpStat(ver === 'v6' ? 2 : 1);
  save();
  location.href = imeituanDeepLink(poi, ver, appType);
  if (it) toast('已唤起' + appLabel(appType) + '：' + it.name);
}

/* 读取剪贴板文本：安全上下文优先，非安全降级为站内粘贴弹窗 */
function manualPasteClipboard() {
  return new Promise(resolve => {
    const modal = document.getElementById('clipModal');
    const ta = document.getElementById('clipInput');
    const okBtn = document.getElementById('clipOk');
    const cancelBtn = document.getElementById('clipCancel');
    if (!modal || !ta || !okBtn) { resolve(''); return; }
    ta.value = ''; modal.classList.remove('hidden'); ta.focus();
    const finish = val => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel); ta.onkeydown = null;
      resolve((val || '').trim());
    };
    const onOk = () => finish(ta.value);
    const onCancel = () => finish('');
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(ta.value); };
  });
}

async function getClipboardText() {
  if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
    try { const t = await navigator.clipboard.readText(); if (t && t.trim()) return t; } catch (e) {}
  }
  toast('浏览器禁止自动读剪贴板，请手动粘贴');
  return await manualPasteClipboard();
}

/* 解析剪贴板：多策略提取店名 + POI + URL */
function parseClipText(text) {
  if (!text || !text.trim()) return { name: '', poi: null, url: '' };
  const s = text.trim();
  let poi = null, url = '', name = '';

  // 策略0：直接在原始全文中匹配 poi_id_str（分享话术里经常直接带这个）
  const rawM = s.match(/poi_id_str[=:]([^&\s"'<>\\\u4e00-\u9fff]+)/);
  if (rawM) { poi = decodeURIComponent(rawM[1].trim()); }

  // 策略1：通过 extractAllUrls 找所有链接，逐个提取 POI
  if (!poi) {
    const allUrls = extractAllUrls(s);
    for (const u of allUrls) {
      const p = extractPoi(u);
      if (p) { poi = p; url = u; break; }
    }
  }

  // 策略2：extractUrl 兜底获取链接 URL
  if (!url) url = extractUrl(s) || '';

  // 提取店名
  name = url ? (extractName(s) || (poi ? '美团店铺' : '')) : s.substring(0, 50);

  // 判断所属 App（美团 / 美团外卖）
  const app = detectApp(s, url);

  return { name, poi, url, app };
}

/* 短链域名判断（dpurl.cn 等需展开才能拿到 poi_id_str） */
function isShortLink(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  return /\bdpurl\.(cn|com)\b/.test(u)
    || /\bmeishi\.(com|cn)\b/.test(u)
    || /dianping\.com\/(m|shop\/[a-z0-9]+)[\/?]?$/.test(u)
    || /waimai\.meituan\.com\/(channel)?\/?$/.test(u) && !/poi_id_str=/.test(u);
}

/* 纯前端展开短链（不依赖外部服务）：
   策略0: 如果部署了 CloudBase 云函数，优先使用（国内直连，最可靠）
   策略1: XHR 跟随重定向 → xhr.responseURL 拿最终地址（跨域也能读到）
   策略2: fetch no-cors follow → response.url 兜底
   策略3: 公共 API 作为最后手段（3s 快速超时）
 */
async function expandShortLink(shortUrl) {
  const target = shortUrl.replace(/^http:/, 'https:');
  const isValid = url =>
    url && url !== shortUrl && url !== target &&
    /^https?:\/\/[a-z]/i.test(url) && !/dpurl\.(cn|com)/i.test(url);

  // ── 策略0：CloudBase 云函数（国内直连，最可靠）──
  // 部署后把 CLOUDBASE_EXPAND_URL 改成你的函数地址，例如：
  // const CLOUDBASE_EXPAND_URL = 'https://<环境ID>.ap-shanghai.app.tcloudbase.com/expand?url=';
  const CLOUDBASE_EXPAND_URL = '';
  if (CLOUDBASE_EXPAND_URL) {
    try {
      const r = await fetch(CLOUDBASE_EXPAND_URL + encodeURIComponent(target), { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (j && j.code === 1 && j.url && isValid(j.url)) { lastExpandDebug = 'CB:' + j.url.slice(0, 50); return j.url; }
    } catch (e) {}
  }

  // ── 策略1：XHR 跟随重定向（responseURL 在大多数浏览器可读，即使跨域）──
  try {
    const url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(null), 4000); // 4s 超时
      const x = new XMLHttpRequest();
      x.open('GET', target, true);
      x.timeout = 3800;
      x.onload = () => {
        clearTimeout(t);
        const final = x.responseURL || x.getResponseHeader('Location') ||
          (x.getAllResponseHeaders ? '' : '');
        resolve(final && isValid(final) ? final : null);
      };
      x.onerror = () => { clearTimeout(t); resolve(null); };
      x.ontimeout = () => { clearTimeout(t); resolve(null); };
      x.send();
    });
    if (url) { lastExpandDebug = 'XHR:' + url.slice(0, 50); return url; }
  } catch(e) {}

  // ── 策略2：fetch no-cors + redirect follow（部分浏览器暴露最终 URL）──
  try {
    const r = await fetch(target, { mode: 'no-cors', redirect: 'follow', cache: 'no-store' });
    const f = r.url;
    if (f && isValid(f)) { lastExpandDebug = 'FETCH:' + f.slice(0, 50); return f; }
  } catch(e) {}

  // ── 策略3：公共 API（快速超时 3s）──
  const apis = [
    'https://api.uomg.com/api/shorturl_restore?url=',
    'https://api.vvhan.com/api/dpurl?url='
  ];
  for (const base of apis) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(base + encodeURIComponent(target), { signal: ctrl.signal });
      clearTimeout(timer);
      const j = await r.json().catch(() => null);
      if (!j) continue;
      // 尝试各种字段名取真实 URL
      const candidates = [j.data, j.url, j.result?.url, j.short_url, j.long_url,
                         j.contents && typeof j.contents === 'string' ? null : undefined];
      for (const c of candidates) {
        if (c && typeof c === 'string' && isValid(c)) { lastExpandDebug = base.split('/')[2] + ':' + c.slice(0, 50); return c; }
      }
      // 激进：从整个 JSON 文本中提取 URL
      const raw = JSON.stringify(j);
      const m = raw.match(/https?:\/\/waimai\.meituan\.com[^\s"'<>\\]{10,200}/i) ||
                raw.match(/https?:\/\/www\.meituan\.com[^\s"'<>\\]{10,200}/i);
      if (m && m[0] && isValid(m[0])) { lastExpandDebug = base.split('/')[2] + ':raw:' + m[0].slice(0, 50); return m[0]; }
    } catch(e) {}
  }

  lastExpandDebug = 'ALL_FAILED';
  return null;
}

/* 切换剪贴板区域显示 */
function showClipRow(id) {
  ['clipRowIdle', 'clipRowJump', 'clipRowNoPoi', 'clipRowLoading'].forEach(r => {
    const el = document.getElementById(r); if (el) el.classList.add('hidden');
  });
  const el = document.getElementById(id); if (el) el.classList.remove('hidden');
}

/* 页面加载 → 自动读剪贴板 → 有 POI 则自动跳津贴 */
async function initClipBoard() {
  if (curPage !== 'shop') return;
  showClipRow('clipRowLoading');

  let text = '';
  try {
    // iOS Safari: readText() 需要用户手势，页面自动加载可能被拒
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText().catch(() => '');
    }
  } catch (e) { text = ''; }

  // 没读到内容 → 显示空闲 + 延迟用 execCommand('paste') 兜底
  if (!text || !text.trim()) {
    showClipRow('clipRowIdle');
    setTimeout(() => {
      const el = document.getElementById('clipRowIdle');
      if (!el || el.classList.contains('hidden')) return; // 用户已操作过
      const ta = document.createElement('textarea');
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      ta.value = ''; document.body.appendChild(ta); ta.focus();
      try { document.execCommand('paste'); text = ta.value || ''; } catch(e2) {}
      document.body.removeChild(ta);
      if (text && text.trim()) processClipText(text);
    }, 800);
    return;
  }
  await processClipText(text);
}

/* 处理剪贴板文本：解析 → 短链展开(可选) → 跳转/展示 */
async function processClipText(text) {
  try {
    if (!text || !text.trim()) { showClipRow('clipRowIdle'); return; }
    const info = parseClipText(text);
    if (!info.name && !info.url) { showClipRow('clipRowIdle'); return; }
    clipInfo = info;

    // 有 POI → 直接跳转
    if (info.poi) {
      const it = autoSave(info.poi, { name: info.name || '该店铺', logo: null, app: info.app }); save();
      document.getElementById('clipShopName').textContent = info.name;
      showClipRow('clipRowJump');
      startAutoJump(info.poi, info.app);
      render();
      return;
    }

    // 无 POI 但有链接 → 尝试展开短链（6s 总超时，永不卡死）
    if (info.url) {
      document.querySelector('#clipRowLoading .clip-msg').textContent = '展开链接中…';
      showClipRow('clipRowLoading');

      // 优先服务端 /resolve（无跨域限制，可解析 dpurl.cn 等点评短链的 JS/meta 跳转）；失败再前端展开兜底
      if (!info.poi) {
        try {
          const r = await fetch('/resolve?url=' + encodeURIComponent(info.url), { cache: 'no-store' });
          const j = await r.json().catch(() => null);
          if (j && j.poi) {
            info.poi = j.poi;
            if (j.finalUrl) info.url = j.finalUrl;
            if (!info.name && j.name) info.name = j.name;
            if (j.logo) info.logo = j.logo;
            info.app = detectApp(j.finalUrl || info.url, j.finalUrl || info.url);
          }
        } catch (e) {}
      }
      // 服务端没拿到 poi → 再试前端展开短链
      if (!info.poi) {
        const result = await expandShortLink(info.url);
        if (result) {
          const p = extractPoi(result);
          if (p) { info.poi = p; info.url = result; info.app = detectApp(result, result); }
        }
      }

      if (info.poi) {
        clipInfo = info;
        autoSave(info.poi, { name: info.name || '该店铺', logo: info.logo || null, app: info.app }); save();
        document.getElementById('clipShopName').textContent = info.name;
        showClipRow('clipRowJump');
        startAutoJump(info.poi, info.app);
        render();
        return;
      }

      // 展开失败 → 显示 NoPoi（可手动粘贴完整链接）
      const shortUrl = info.url.length > 55 ? info.url.slice(0, 52) + '…' : info.url;
      const el = document.getElementById('clipRowNoPoi');
      if (el) el.querySelector('.clip-msg').innerHTML =
        '无法获取 poi_id_str' +
        (info.name ? '（已识别：' + esc(info.name) + '）' : '') +
        '<br><small style="opacity:.6">' + esc(shortUrl) + '</small>' +
        '<br>请复制「分享店铺」的长链接 <a class="clip-manual" id="clipManual">粘贴</a>';
      showClipRow('clipRowNoPoi');
      return;
    }
    showClipRow('clipRowIdle');
  } catch(e) {
    console.warn('[clipboard] error:', e);
    showClipRow('clipRowIdle');
  }
}

/* 启动倒计时自动跳转 */
function startAutoJump(poi, appType) {
  appType = appType === 'main' ? 'main' : 'waimai';
  const label = appLabel(appType);
  let countdown = 2;
  const tick = () => {
    if (!clipJumpTimer) return;
    if (countdown <= 0) { clipJumpTimer = null; doJumpClaim(poi, 'v8', appType); return; }
    const el = document.getElementById('clipJumpMsg');
    if (el) el.innerHTML = '已识别为「' + label + '」商家，' + countdown + 's 后自动跳津贴… <a class="clip-cancel" id="clipCancelJump">取消</a>';
    countdown--; clipJumpTimer = setTimeout(tick, 1000);
    const c = document.getElementById('clipCancelJump');
    if (c) c.addEventListener('click', () => cancelAutoJump());
  };
  clipJumpTimer = setTimeout(tick, 500);
}

/* 取消自动跳转 */
function cancelAutoJump() {
  if (clipJumpTimer) { clearTimeout(clipJumpTimer); clipJumpTimer = null; }
  document.getElementById('clipJumpMsg').textContent = '已取消自动跳转，请手动选择';
  // 隐藏取消链接
  const c = document.getElementById('clipCancelJump'); if (c) c.style.display = 'none';
}

/* 按钮事件：使用事件代理（DOM 会被动态替换，统一挂载在 #clipArea） */
$('#clipArea').addEventListener('click', async e => {
  // 点击空闲行 → 触发读剪贴板（iOS 需要用户手势）
  if (e.target.closest('#clipRowIdle') || e.target.closest('#clipRetry') || e.target.closest('#clipRetry2')) {
    initClipBoard();
    return;
  }
  if (e.target.closest('#clipManual')) {
    const pasted = await manualPasteClipboard();
    if (pasted && pasted.trim()) {
      const re = parseClipText(pasted);
      if (re.poi) {
        // 直接走跳转流程
        clipInfo = re;
        const it = autoSave(re.poi, { name: re.name || '该店铺', logo: null }); save();
        document.getElementById('clipShopName').textContent = re.name;
        showClipRow('clipRowJump');
        let countdown = 2;
        const tick = () => {
          if (!clipJumpTimer) return;
          if (countdown <= 0) { clipJumpTimer = null; doJumpClaim(re.poi, 'v8', re.app); return; }
          const el = document.getElementById('clipJumpMsg');
          if (el) el.innerHTML = '已识别为「' + appLabel(re.app) + '」商家，' + countdown + 's 后自动跳津贴… <a class="clip-cancel" id="clipCancelJump">取消</a>';
          countdown--; clipJumpTimer = setTimeout(tick, 1000);
          const c = document.getElementById('clipCancelJump');
          if (c) c.addEventListener('click', () => cancelAutoJump());
        };
        clipJumpTimer = setTimeout(tick, 500);
        render();
      } else {
        toast('粘贴的链接仍未含 poi_id_str');
      }
    }
  }
});

$('#clipV8').addEventListener('click', () => {
  cancelAutoJump();
  if (clipInfo.poi) doJumpClaim(clipInfo.poi, 'v8', clipInfo.app);
  else toast('未识别到店铺 POI');
});

$('#clipV6').addEventListener('click', () => {
  cancelAutoJump();
  if (clipInfo.poi) doJumpClaim(clipInfo.poi, 'v6', clipInfo.app);
  else toast('未识别到店铺 POI');
});

/* 兼容旧 ?jkclip 深链（后端 /resolve，保留原逻辑） */
async function quickJumpFromClipboard(ver) {
  ver = (ver === 'v6') ? 'v6' : 'v8';
  const text = await getClipboardText();
  if (!text || !text.trim()) { toast('未获取到链接，请先复制美团分享链接'); return; }
  const um = text.match(/https?:\/\/[^\s"'<>）)]+/);
  if (!um) { toast('剪贴板里没有美团链接'); return; }
  toast('正在解析店铺…');
  try {
    const r = await fetch('/resolve?url=' + encodeURIComponent(um[0]), { cache: 'no-store' });
    const info = await r.json().catch(() => ({}));
    if (info && info.poi) {
      const name = (info.name && isValidShopName(info.name)) ? info.name : extractName(text);
      const appType = detectApp(text, info.finalUrl || (text.match(/https?:\/\/[^\s"'<>）)]+/) || [])[0] || '');
      const it = autoSave(info.poi, { name, logo: info.logo || null, app: appType });
      it.claimed = true; it.updatedAt = Date.now();
      bumpStat(ver === 'v6' ? 2 : 1); save(); render();
      location.href = imeituanDeepLink(info.poi, ver, appType);
      toast('已收藏并唤起' + appLabel(appType) + '（' + ver + '）');
    } else if (info && info.poiNum) {
      toast('该链接只含数字店铺ID，无 poi_id_str，无法直跳');
    } else { toast('解析失败，请确认是美团店铺分享链接'); }
  } catch (e) { toast('解析请求失败'); }
}

injectIcons();
const _fv = document.getElementById('footVer'); if (_fv) _fv.textContent = 'v' + VERSION;
render();
handleDeepLink();
initClipBoard();

/* 版本更新提示：配合 index.html 的 app.js?v= 指纹，解决「部署了但用户看到旧版」 */
(function checkVersionUpdate() {
  const k = 'mt_coupon_version';
  let prev = '';
  try { prev = localStorage.getItem(k) || ''; } catch (e) {}
  if (prev && prev !== VERSION) {
    setTimeout(() => {
      toast('已更新到 v' + VERSION + '，正在刷新…');
      setTimeout(() => location.reload(), 1200);
    }, 700);
  }
  try { localStorage.setItem(k, VERSION); } catch (e) {}
})();
