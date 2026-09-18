# Group Chat — Plain HTML/CSS/JS + WebSocket

No frameworks. No Socket.IO. Just vanilla `WebSocket` + Node `ws`.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 — open it in 2 tabs/browsers, enter different names, chat.

- `GET /health` → `{ ok: true, clients: N }`

## How it works

- `server.js` — static file server + WebSocket server on the **same port** (works behind Render/Railway/nginx).
  - `join` → validates name, makes it unique, sends `joined` + user list + last 100 messages.
  - `chat` → broadcasts `{ from, text, at }` to everyone, stores history.
  - `typing` → broadcasts typing indicator to everyone except sender.
  - `user-joined` / `user-left` → system messages + live online list.
  - 30s ping/pong heartbeat so dead tabs don't linger.
- `public/` — plain frontend, no build step.

## Deploy (any Node host)

Needs: Node 18+, `npm start`, port from `process.env.PORT` (already supported).

**Render.com (free):**
1. Push this folder to GitHub.
2. New → Web Service → select repo.
3. Build: `npm install`, Start: `npm start`. Deploy.
4. Share the `https://xxx.onrender.com` URL — anyone opening it can join.

**Railway / Fly.io / VPS:** same — just `npm install && npm start`.
For nginx, proxy websockets:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```
