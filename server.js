const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));

  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server });

// ---- chat state ----
const clients = new Map(); // ws -> { id, name, color }
const history = []; // last 100 chat messages
const MAX_HISTORY = 100;

const COLORS = [
  '#2563eb', '#dc2626', '#059669', '#d97706',
  '#7c3aed', '#db2777', '#0891b2', '#65a30d',
];

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function safeName(raw) {
  let n = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  return n;
}

function uniqueName(wanted) {
  const taken = new Set([...clients.values()].map((c) => c.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  let i = 2;
  while (taken.has(`${wanted} ${i}`.toLowerCase())) i++;
  return `${wanted} ${i}`;
}

function userList() {
  return [...clients.values()].map((c) => ({ id: c.id, name: c.name, color: c.color }));
}

function broadcast(obj, except = null) {
  const data = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws !== except) ws.send(data);
  }
}

let nextId = 1;

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  let joined = false;

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', text: 'Invalid message format' }));
      return;
    }

    // ---- JOIN ----
    if (msg.type === 'join') {
      if (joined) return;
      const clean = safeName(msg.name);
      if (clean.length < 2) {
        ws.send(JSON.stringify({ type: 'error', text: 'Name must be at least 2 characters.' }));
        return;
      }
      const name = uniqueName(clean);
      const user = { id: nextId++, name, color: colorFor(name) };
      clients.set(ws, user);
      joined = true;

      ws.send(JSON.stringify({ type: 'joined', you: user, users: userList(), history }));
      broadcast({ type: 'user-joined', user, users: userList(), at: Date.now() }, ws);
      return;
    }

    // must join first
    if (!clients.has(ws)) {
      ws.send(JSON.stringify({ type: 'error', text: 'Join first with your name.' }));
      return;
    }
    const me = clients.get(ws);

    // ---- CHAT ----
    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 500);
      if (!text) return;
      const chatMsg = { type: 'chat', id: Date.now() + '-' + me.id, from: me, text, at: Date.now() };
      history.push(chatMsg);
      if (history.length > MAX_HISTORY) history.shift();
      broadcast(chatMsg);
      return;
    }

    // ---- TYPING ----
    if (msg.type === 'typing') {
      broadcast({ type: 'typing', user: me, isTyping: !!msg.isTyping }, ws);
      return;
    }
  });

  ws.on('close', () => {
    const me = clients.get(ws);
    clients.delete(ws);
    if (me) broadcast({ type: 'user-left', user: me, users: userList(), at: Date.now() });
  });

  ws.on('error', () => {
    try { ws.close(); } catch {}
  });
});

// heartbeat (kill dead connections, important for deploy)
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      const me = clients.get(ws);
      clients.delete(ws);
      try { ws.terminate(); } catch {}
      if (me) broadcast({ type: 'user-left', user: me, users: userList(), at: Date.now() });
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
