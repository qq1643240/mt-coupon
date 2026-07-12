// 服务端测试：验证动态接口 no-store 与 /sync 跨设备同步往返
// 启动 node server.js（PORT=8124），用 http 直接打接口断言。
import { spawn } from 'child_process';
import http from 'http';

const PORT = 8124;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path, method, headers },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(900); // 等 server 起来
  let fail = 0;

  // 1) /resolve 必须 no-store（防 ?jk 缓存错位）
  const r1 = await req('GET', '/resolve?url=https://example.com/x');
  const cc = (r1.headers['cache-control'] || '').toLowerCase();
  if (!cc.includes('no-store')) { console.log('[FAIL] /resolve 缺少 no-store:', cc); fail++; }
  else console.log('[PASS] /resolve 返回 Cache-Control: no-store');

  // 2) / 入口页也应 no-store
  const r0 = await req('GET', '/');
  const cc0 = (r0.headers['cache-control'] || '').toLowerCase();
  if (!cc0.includes('no-store')) { console.log('[FAIL] / 入口页缺少 no-store:', cc0); fail++; }
  else console.log('[PASS] / 入口页返回 no-store');

  // 3) /sync 往返一致
  const sample = JSON.stringify([{ id: '1', name: '店A', poi: 'P1', claimed: true }]);
  const up = await req('POST', '/sync?key=testkey123', sample);
  const upj = JSON.parse(up.body);
  if (!upj.ok) { console.log('[FAIL] /sync POST:', up.body); fail++; }
  else console.log('[PASS] /sync POST 上传成功');

  const down = await req('GET', '/sync?key=testkey123');
  const downj = JSON.parse(down.body);
  if (!(downj.ok && Array.isArray(downj.data) && downj.data.length === 1 && downj.data[0].poi === 'P1')) {
    console.log('[FAIL] /sync GET 往返不一致:', down.body); fail++;
  } else console.log('[PASS] /sync GET 往返一致（' + downj.data.length + ' 条）');

  // 4) 含 ../ 的 key 必须被安全清洗（防路径穿越，不能读到 /etc/passwd）
  const bad = await req('GET', '/sync?key=../../etc/passwd');
  if (bad.status === 500 || /root:/.test(bad.body)) {
    console.log('[FAIL] 路径穿越未防护，status=', bad.status, bad.body); fail++;
  } else {
    console.log('[PASS] 非法 key 被安全清洗（无穿越，status=' + bad.status + '）');
  }

  // 5) 后台：未登录不能写，登录后可增删查
  const noAuth = await req('POST', '/api/acts', JSON.stringify({ title: 't', url: 'https://x.com' }));
  if (noAuth.status !== 401) { console.log('[FAIL] 未登录可写活动：', noAuth.status); fail++; }
  else console.log('[PASS] 未登录写入被拒（401）');

  const login = await req('POST', '/admin/login', JSON.stringify({ pass: 'mt6866admin' }));
  const lj = JSON.parse(login.body);
  let token = '';
  if (!lj.ok || !lj.token) { console.log('[FAIL] 后台登录失败：', login.body); fail++; }
  else {
    token = lj.token;
    const add = await req('POST', '/api/acts', JSON.stringify({ title: '周三外卖节', url: 'https://activity.example.com/a', note: '满30减12' }), token);
    const aj = JSON.parse(add.body);
    if (!aj.ok || !aj.item || !aj.item.id) { console.log('[FAIL] 添加活动失败：', add.body); fail++; }
    else {
      console.log('[PASS] 登录后添加活动成功');
      const get = await req('GET', '/api/acts');
      const gj = JSON.parse(get.body);
      if (!(gj.ok && Array.isArray(gj.data) && gj.data.length >= 1)) { console.log('[FAIL] 读取活动列表失败：', get.body); fail++; }
      else console.log('[PASS] /api/acts 读取成功（' + gj.data.length + ' 条，公开可读）');
      // no-store 校验
      const ccA = (get.headers['cache-control'] || '').toLowerCase();
      if (!ccA.includes('no-store')) { console.log('[FAIL] /api/acts 缺少 no-store'); fail++; }
      else console.log('[PASS] /api/acts 返回 no-store');
      const del = await req('DELETE', '/api/acts/' + aj.item.id, '', token);
      const dj = JSON.parse(del.body);
      if (!dj.ok) { console.log('[FAIL] 删除活动失败：', del.body); fail++; }
      else console.log('[PASS] 删除活动成功');
    }
  }

  // 6) 修改管理员密码：改密后新密码可登录、旧密码失效，最后还原默认避免影响本地数据
  const chg = await req('POST', '/admin/changepass', JSON.stringify({ current: 'mt6866admin', next: 'newpass123' }), token);
  const chgj = JSON.parse(chg.body);
  if (!chgj.ok) { console.log('[FAIL] 修改密码失败：', chg.body); fail++; }
  else {
    console.log('[PASS] 修改密码成功');
    const loginNew = await req('POST', '/admin/login', JSON.stringify({ pass: 'newpass123' }));
    const lnj = JSON.parse(loginNew.body);
    if (!lnj.ok) { console.log('[FAIL] 新密码登录失败'); fail++; } else console.log('[PASS] 新密码可登录');
    const loginOld = await req('POST', '/admin/login', JSON.stringify({ pass: 'mt6866admin' }));
    if (JSON.parse(loginOld.body).ok) { console.log('[FAIL] 旧密码仍可登录'); fail++; } else console.log('[PASS] 旧密码已失效');
    await req('POST', '/admin/changepass', JSON.stringify({ current: 'newpass123', next: 'mt6866admin' }), lnj.token);
  }

  // 7) 链接导入：不可达地址应优雅返回 JSON 而非崩溃
  const imp = await req('GET', '/api/import?url=' + encodeURIComponent('http://127.0.0.1:1/x'));
  const impj = JSON.parse(imp.body || '{}');
  if (typeof impj.ok === 'undefined') { console.log('[FAIL] /api/import 返回异常：', imp.body); fail++; }
  else console.log('[PASS] /api/import 容错返回（ok=' + impj.ok + '）');

  // 8) 智能识别 /api/analyze：纯文字解析坐标/地名/满减/内嵌链接（无需联网）
  const az = await req('POST', '/api/analyze', JSON.stringify({ text: '深圳南山科技园 纬度22.5312 经度113.9456' }));
  const azj = JSON.parse(az.body || '{}');
  if (!(azj.ok && azj.lat === '22.5312' && azj.lng === '113.9456' && /科技园/.test(azj.place || ''))) {
    console.log('[FAIL] /api/analyze 坐标解析异常：', az.body); fail++;
  } else console.log('[PASS] /api/analyze 识别出 地名/纬度/经度（' + azj.place + ' ' + azj.lat + ',' + azj.lng + '）');

  const az2 = await req('GET', '/api/analyze?text=' + encodeURIComponent('「肯德基宅急送」满30减12 https://dpurl.cn/abc123'));
  const azj2 = JSON.parse(az2.body || '{}');
  if (!(azj2.ok && azj2.title === '肯德基宅急送' && /满30减12/.test(azj2.note || '') && Array.isArray(azj2.urls) && azj2.urls[0].indexOf('https://dpurl.cn') === 0)) {
    console.log('[FAIL] /api/analyze 活动话术解析异常：', az2.body); fail++;
  } else console.log('[PASS] /api/analyze 识别出 标题/满减/链接（' + azj2.title + ' ' + azj2.note + '）');

  srv.kill();
  console.log(fail ? '\n=== 服务端测试有失败 ===' : '\n=== 服务端测试全部通过 ===');
  process.exit(fail ? 1 : 0);
})();
