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
const VERSION = '1.25'; // 版本号：每次布局更新推送 +0.01

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

function ts(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi, s).getTime(); }

/* 种子数据（首次打开无本地数据时） */
const seed = [
  { id: '395505', name: '旺角大排档（粤菜小炒、啫啫煲）', poi: '7FATrlwYZgjK0Wo13H0zOAI', amount: '', logo: '', note: '', pinned: true,  claimed: false, updatedAt: ts(2026, 7, 11, 11, 17, 26) },
  { id: '395165', name: '川味轩（南新五路店）',           poi: 'e1G07VLcvSyapClYCnYeYQI', amount: '', logo: '', note: '', pinned: false, claimed: false, updatedAt: ts(2026, 7, 11, 10, 54, 45) }
];

let data = load();
let curSeg = 'all';
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
  set('qjIc', ICON.bolt);
}
function extractPoi(url) {
  const m = String(url || '').match(/poi_id_str=([^&\s"'<>\\]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
// 从任意文本提取第一个链接（支持「文字+链接」混排）
function extractUrl(text) {
  const s = String(text || '');
  const safe = /[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/;
  let m = s.match(new RegExp('https?://' + safe.source, 'i'));
  let url = m ? m[0] : null;
  if (!url) {
    m = s.match(new RegExp('\\b(?:[a-z0-9-]+\\.)+(?:cn|com|net|me|link|url|cc|xyz)\\b' + safe.source, 'i'));
    url = m ? m[0] : null;
  }
  if (!url) return null;
  return url.replace(/[。，、）)】」』"'.,;:!?\s]+$/, '');
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

/* ---------- 渲染 ---------- */
function render() {
  const q = ($('#search').value || '').trim().toLowerCase();
  let list_data = data.filter(it =>
    (!q || it.name.toLowerCase().includes(q) || (it.note || '').toLowerCase().includes(q))
  );
  if (curSeg === 'todo') list_data = list_data.filter(i => !i.claimed);
  else if (curSeg === 'done') list_data = list_data.filter(i => i.claimed);

  list_data.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));

  const list = $('#list'); list.innerHTML = '';
  $('#statCount').textContent = `共 ${data.length} 个`;
  $('#statPinned').textContent = `置顶 ${data.filter(i => i.pinned).length}`;
  updateStatbar();
  $('#empty').classList.toggle('hidden', list_data.length > 0);

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
      ${it.note ? `<div class="card-note">${esc(it.note)}</div>` : ''}
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

/* ---------- 列表事件 ---------- */
$('#list').addEventListener('click', e => {
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
    if (a === 'del') { if (confirm(`确认删除「${it.name}」？`)) { data = data.filter(x => x.id !== it.id); save(); render(); toast('已删除'); } return; }
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
  const item = it || { id: uid(), name: '', poi: '', amount: '', logo: '', note: '', pinned: false, claimed: false, updatedAt: Date.now() };
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
  if (editing) $('#delBtn').addEventListener('click', () => { if (confirm(`确认删除「${item.name}」？`)) { data = data.filter(x => x.id !== item.id); save(); render(); closeModal(); toast('已删除'); } });
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
    fetch('/api/shop?poi=' + encodeURIComponent(it.poi))
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
segBtns.forEach((b, i) => b.addEventListener('click', () => {
  segBtns.forEach(x => x.classList.remove('active'));
  b.classList.add('active'); curSeg = b.dataset.seg; moveSegInd(); render();
}));
moveSegInd();

/* ---------- 使用说明折叠 ---------- */
$('#helpToggle').addEventListener('click', () => {
  const h = $('#help'); const hidden = h.classList.toggle('hidden');
  $('#helpToggle').textContent = hidden ? '使用说明 ▾' : '收起说明 ▴';
});

/* ---------- 更多菜单（命令面板） ---------- */
$('#menuBtn').addEventListener('click', () => paletteOpen(COMMANDS.slice(), '输入指令…'));
function exportData() { const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `coupon-collection-${Date.now()}.json`; a.click(); toast('已导出'); }
function importData() { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json'; inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const arr = JSON.parse(r.result); if (Array.isArray(arr)) { data = arr; save(); render(); toast('导入成功'); } else toast('格式不正确'); } catch { toast('解析失败'); } }; r.readAsText(f); }; inp.click(); }
function clearAll() { if (confirm('确认清空全部收藏？')) { data = []; save(); render(); toast('已清空'); } }

/* ---------- 深色模式 ---------- */
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem(THEME_KEY, t); }
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
  } else {
    it = { id: uid(), name: opts.name || '该店铺', poi, amount: '', logo: '', note: '', pinned: false, claimed: false, updatedAt: Date.now() };
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
function batchClaimAll() {
  const items = data.filter(i => i.poi);
  if (!items.length) { toast('暂无收藏商家，请先搜索添加'); return; }
  if (!confirm(`生成批量领券页？共 ${items.length} 个商家（v8 主券 + v6 第二张，逐张点开）`)) return;
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
  { icon: ICON.bolt, label: '批量领取全部券', desc: '打开全部收藏 v8+v6', keys: 'B', run: batchClaimAll },
  { icon: ICON.moon, label: '切换深色模式', desc: '浅色/深色', keys: 'T', run: toggleTheme },
  { icon: ICON.open, label: 'API 调用说明', desc: '接口地址与用途', run: showApiDocs },
  { icon: ICON.save, label: '导出数据', desc: '下载 JSON 备份', run: exportData },
  { icon: ICON.import, label: '导入数据', desc: '从 JSON 恢复', run: importData },
  { icon: ICON.trashAll, label: '清空全部', desc: '删除所有收藏', run: clearAll }
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
    li.innerHTML = `<span class="pi">${it.icon || '•'}</span><span>${esc(it.label)}</span>${it.desc ? `<span class="desc">${esc(it.desc)}</span>` : ''}${it.keys ? `<kbd class="pk">${it.keys}</kbd>` : ''}`;
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
    { p: '?claim=<poi>&v=8', d: '【跳 App 领券】已知 poi_id_str 时直接跳转美团 App/H5 领取（v8 主券，v=6 为第二张）。' },
    { p: '?url=<美团分享链接>', d: '自动识别店铺 poi_id_str 并打开详情（识别即收藏）。iOS 快捷指令最常用：复制链接后用「打开 URL」跳到这里即可。' },
    { p: '?open=<任意网址>', d: '中转直接打开任意网址（用于需要统一入口的场景）。' },
    { p: '?poi=<poi>', d: '打开本机已收藏的该商家详情（需本机先识别收藏过）。' },
    { p: '/api/shop?poi=<poi>', d: '返回该商家真实店名与头像，JSON：{ok,logo,name}，供详情页实时刷新头像用。' },
    { p: '/api/claim?poi=<poi>', d: '返回该商家 v8 / v6 领券链接，JSON：{ok,poi,v8,v6}。' },
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

  if (openUrl) { window.location.href = openUrl; return; }

  /* ?jk=v8=<分享话术/链接>：客户端兜底解析 poi 并跳转到美团领券页（worker 301 未生效时生效） */
  if (jk) {
    const raw = decodeURIComponent(jk);
    let ver = 'v8', text = raw;
    const mm = raw.match(/^v?([68])=/);
    if (mm) { ver = 'v' + mm[1]; text = raw.slice(mm[0].length); }
    const um = text.match(/https?:\/\/[^\s"'<>）)]+/);
    if (um) {
      toast('正在解析店铺…');
      fetch('/resolve?url=' + encodeURIComponent(um[0]))
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

/* ---------- 一键读剪贴板直跳 imeituan:// 美团 App 领券 ---------- */
let qjVer = 'v8';
function imeituanDeepLink(poi, ver) {
  const activityUrl = buildUrl(poi, ver); // offsiteact.meituan.com H5 领券页
  return 'imeituan://www.meituan.com/web?url=' + encodeURIComponent(activityUrl);
}
async function quickJumpFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) {}
  if (!text) { toast('剪贴板为空或无法读取，请先复制美团分享链接'); return; }
  const um = text.match(/https?:\/\/[^\s"'<>）)]+/);
  if (!um) { toast('剪贴板里没有美团链接'); return; }
  toast('正在解析店铺…');
  try {
    const r = await fetch('/resolve?url=' + encodeURIComponent(um[0]));
    const info = await r.json().catch(() => ({}));
    if (info && info.poi) {
      const it = data.find(d => d.poi === info.poi);
      if (it) { it.claimed = true; it.updatedAt = Date.now(); }
      bumpStat(qjVer === 'v6' ? 2 : 1);
      save(); render();
      location.href = imeituanDeepLink(info.poi, qjVer); // 直接唤起美团 App（iOS 弹确认框）
      toast('已唤起美团 App（' + (qjVer === 'v6' ? 'v6' : 'v8') + '）');
    } else if (info && info.poiNum) {
      toast('该链接只含数字店铺ID，无 poi_id_str，无法直跳');
    } else {
      toast('解析失败，请确认是美团店铺分享链接');
    }
  } catch (e) { toast('解析请求失败'); }
}
$('#qjClip').addEventListener('click', quickJumpFromClipboard);
document.querySelectorAll('.qj-ver-btn').forEach(b => b.addEventListener('click', () => {
  qjVer = b.dataset.ver;
  document.querySelectorAll('.qj-ver-btn').forEach(x => x.classList.toggle('active', x === b));
}));

injectIcons();
const _fv = document.getElementById('footVer'); if (_fv) _fv.textContent = 'v' + VERSION;
render();
handleDeepLink();
