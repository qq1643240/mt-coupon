// 自动部署 Webhook 接收服务（配合 GitHub Webhook 实现 push 即同步到宝塔）
// 常驻运行：pm2 start webhook.js --name deploy-hook
// GitHub 仓库 Settings → Webhooks → Add webhook：
//   Payload URL : http://<服务器公网IP>:9000/webhook  （或反代后的 https 地址，见下）
//   Content type: application/json
//   Secret      : 与下方 WEBHOOK_SECRET 一致（强烈建议用环境变量传入，勿写死在文件里）
//   Events      : Just the push event
// 收到 push 后自动执行：git pull + 重启 Node 项目（PM2）

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

// ===== 按需修改以下常量（或用环境变量覆盖）=====
const PORT = process.env.DEPLOY_PORT || 9000;
const WEBHOOK_SECRET = process.env.DEPLOY_SECRET || 'CHANGE_ME_TO_A_RANDOM_STRING';
const REPO_DIR = process.env.DEPLOY_REPO || '/www/wwwroot/mt'; // clone 出来的仓库目录
const RESTART_CMD = process.env.DEPLOY_RESTART || 'pm2 restart mt-coupon'; // 重启宝塔 Node 项目的 pm2 进程名

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: REPO_DIR }, (err, stdout, stderr) => {
      if (err) { console.error('[deploy] FAIL:', cmd, '\n', stderr); return reject(stderr); }
      console.log('[deploy] OK:', cmd, '\n', stdout);
      resolve(stdout);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('deploy hook ready');
    return;
  }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
  req.on('end', async () => {
    // 校验 GitHub 签名（防伪造请求）
    const sig = req.headers['x-hub-signature-256'];
    const hmac = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    let ok = false;
    try { ok = !!sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac)); } catch (e) { ok = false; }
    if (!ok) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      console.warn('[deploy] 签名校验失败，拒绝此次请求');
      return;
    }
    // 先响应 GitHub（避免超时），再异步执行部署
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('accepted');
    console.log('[deploy] 收到 push 事件，开始更新…');
    try {
      await run('git pull');
      await run(RESTART_CMD);
      console.log('[deploy] 更新完成 ✅');
    } catch (e) {
      console.error('[deploy] 更新出错（可能服务器连不上 GitHub 或 pm2 进程名不对）：', e);
    }
  });
});

server.listen(PORT, () => {
  console.log('[deploy] webhook 监听 :' + PORT + '  仓库目录: ' + REPO_DIR);
  if (WEBHOOK_SECRET === 'CHANGE_ME_TO_A_RANDOM_STRING') {
    console.warn('[deploy] ⚠️ 警告：WEBHOOK_SECRET 仍是默认值，请通过环境变量 DEPLOY_SECRET 设置随机字符串！');
  }
});
