const http = require('http');
const https = require('https');
const { URL } = require('url');

// 跟随 HTTP 302 重定向，返回最终 URL
function followRedirect(startUrl, maxDepth = 5) {
  return new Promise((resolve, reject) => {
    let currentUrl = startUrl;
    let depth = 0;

    const next = () => {
      if (depth >= maxDepth) return resolve(currentUrl);
      depth++;
      let parsed;
      try { parsed = new URL(currentUrl); } catch (e) { return reject(e); }
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 8000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          currentUrl = new URL(res.headers.location, currentUrl).href;
          return next();
        }
        resolve(currentUrl);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    };
    next();
  });
}

exports.main = async (event, context) => {
  const url = (event.queryString && event.queryString.url) ||
              (event.queryStringParameters && event.queryStringParameters.url) ||
              '';
  if (!url) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 0, msg: 'missing url' })
    };
  }

  try {
    const final = await followRedirect(url);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 1, url: final })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 0, msg: String(e) })
    };
  }
};
