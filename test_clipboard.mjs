// 端到端逻辑测试：验证「读剪贴板领券 → 自动保存商家到 localStorage 卡片」
// 用 jsdom 真实加载 index.html + app.js，mock 剪贴板 / fetch / 非安全上下文。
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('index.html', 'utf8');
const appJs = fs.readFileSync('app.js', 'utf8');

function makeDom({ secure, clipboardText, resolveJson, promptReturns }) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://test.example.com/',
    virtualConsole: new VirtualConsole().on('jsdomError', () => {}) // 吞掉 navigation 未实现报错
  });
  const w = dom.window;

  // ---- 基础浏览器 API mock ----
  w.requestAnimationFrame = (cb) => cb();
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.open = () => ({});
  w.confirm = () => true;
  w.alert = () => {};
  Object.defineProperty(w, 'isSecureContext', { configurable: true, value: secure });

  // fetch -> 返回 mock 的 /resolve 结果
  w.fetch = async (url) => {
    if (String(url).includes('/resolve')) {
      return { json: async () => resolveJson };
    }
    return { json: async () => ({}) };
  };

  if (secure) {
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { readText: async () => clipboardText } });
  } else {
    // 非安全上下文：剪贴板 API 不可用，依赖 prompt 手动粘贴
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: undefined });
    w.prompt = () => promptReturns;
  }

  // 注入并执行 app.js（在 window 全局作用域）
  const s = w.document.createElement('script');
  s.textContent = appJs;
  w.document.body.appendChild(s);
  return w;
}

const RESOLVE_OK = { ok: true, poi: 'TESTPOI_abc123', name: '测试餐厅（南山分店）', logo: 'https://img.example.com/logo.png', finalUrl: 'x' };
const CLIPBOARD = '我最近很喜欢「测试餐厅（南山分店）」https://waimai.meituan.com/restaurant/TESTPOI_abc123?foo=bar';

async function runCase(name, opts) {
  const w = makeDom(opts);
  // 清空 localStorage 起点
  w.localStorage.removeItem('mt_coupon_collection_v2');
  const p = w.eval('quickJumpFromClipboard()'); // 不立即 await（非安全上下文会等弹窗输入）
  if (!opts.secure) {
    await new Promise(r => setTimeout(r, 30)); // 等弹窗渲染 + 绑定事件
    const ta = w.document.getElementById('clipInput');
    if (ta) ta.value = opts.promptReturns;
    const okBtn = w.document.getElementById('clipOk');
    if (okBtn) okBtn.click();
  }
  try { await p; } catch (e) { /* 忽略 imeituan:// 跳转报错 */ }
  await new Promise(r => setTimeout(r, 50));
  const raw = w.localStorage.getItem('mt_coupon_collection_v2');
  const arr = raw ? JSON.parse(raw) : [];
  const found = arr.find(x => x.poi === 'TESTPOI_abc123');
  const ok = !!found && found.claimed === true && /测试餐厅/.test(found.name || '');
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log('   saved cards:', arr.length, '| matched poi card:', found ? JSON.stringify({ name: found.name, claimed: found.claimed, poi: found.poi }) : 'NONE');
  if (!ok) process.exitCode = 1;
  return ok;
}

(async () => {
  console.log('=== 测试：读剪贴板领券自动保存商家卡片 ===\n');
  // 用例1：HTTPS 安全上下文（云端 workers.dev），自动读剪贴板
  await runCase('HTTPS 安全上下文（云端）', {
    secure: true,
    clipboardText: CLIPBOARD,
    resolveJson: RESOLVE_OK,
    promptReturns: ''
  });
  // 用例2：HTTP 非安全上下文（宝塔 IP:端口），prompt 手动粘贴
  await runCase('HTTP 非安全上下文（宝塔）', {
    secure: false,
    clipboardText: '',
    resolveJson: RESOLVE_OK,
    promptReturns: CLIPBOARD
  });
  console.log('\n=== 测试结束 ===');
})();
