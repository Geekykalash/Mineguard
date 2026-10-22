// MineGuard AI - tiny backend (no npm packages needed)
// Run:  node server.js     then open  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
let latest = null; // { device_id, value, received_at }

const STATIC = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/style.css': 'style.css',
  '/script.js': 'script.js'
};
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // Dashboard asks for the latest real reading
  if (req.method === 'GET' && url === '/api/latest') {
    return sendJson(res, 200, latest
      ? { ...latest, server_time: Date.now() }
      : { value: null, server_time: Date.now() });
  }

  // ESP8266 posts a reading: { "device_id": "HLM-001", "value": 412 }
  if (req.method === 'POST' && url === '/api/sensor-data') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2048) req.destroy(); // ignore oversized payloads
    });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const value = Number(d.value);
        const id = String(d.device_id || '').slice(0, 32);
        if (!id || !Number.isFinite(value)) return sendJson(res, 400, { ok: false, error: 'device_id and numeric value required' });
        latest = { device_id: id, value, received_at: Date.now() };
        console.log(new Date().toLocaleTimeString(), id, value);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: 'invalid JSON' });
      }
    });
    return;
  }

  // Serve the three frontend files (whitelist only)
  if (req.method === 'GET' && STATIC[url]) {
    const file = path.join(__dirname, STATIC[url]);
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
      res.end(data);
    });
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('MineGuard server running on port ' + PORT);
  console.log('Dashboard: http://localhost:' + PORT);
  console.log('ESP8266 should POST to: http://<YOUR-LAPTOP-IP>:' + PORT + '/api/sensor-data');
});
