// Plain vanilla-JS WebSocket group chat client. No libraries.
(function () {
  const $ = (id) => document.getElementById(id);

  const joinScreen = $('join-screen');
  const chatScreen = $('chat-screen');
  const joinForm = $('join-form');
  const nameInput = $('name-input');
  const joinError = $('join-error');

  const messagesEl = $('messages');
  const usersEl = $('users');
  const onlineCount = $('online-count');
  const chatForm = $('chat-form');
  const msgInput = $('msg-input');
  const typingEl = $('typing');
  const statusEl = $('status');
  const meName = $('me-name');

  let ws = null;
  let myName = localStorage.getItem('chat-name') || '';
  let myId = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let typingTimeout = null;
  const typingUsers = new Map(); // id -> {name, color, timer}

  if (myName) nameInput.value = myName;

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function setStatus(online, text) {
    statusEl.textContent = text;
    statusEl.className = 'status ' + (online ? 'online' : 'offline');
  }

  // escape HTML to prevent XSS — we render with textContent, but keep helper
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addSystem(text) {
    const div = document.createElement('div');
    div.className = 'system';
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollBottom();
  }

  function addChat({ from, text, at, mine }) {
    const wrap = document.createElement('div');
    wrap.className = 'msg' + (mine ? ' mine' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = mine ? 'You' : from.name;
    if (!mine) name.style.color = from.color;

    const time = document.createElement('span');
    time.textContent = fmtTime(at);

    meta.appendChild(name);
    meta.appendChild(time);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text; // textContent = XSS safe

    wrap.appendChild(meta);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollBottom();
  }

  function renderUsers(users) {
    usersEl.innerHTML = '';
    onlineCount.textContent = users.length;
    users.forEach((u) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = u.color;
      const label = document.createElement('span');
      label.textContent = u.id === myId ? u.name + ' (you)' : u.name;
      li.appendChild(dot);
      li.appendChild(label);
      usersEl.appendChild(li);
    });
  }

  function renderTyping() {
    const names = [...typingUsers.values()].map((u) => u.name);
    typingEl.textContent = names.length
      ? names.length === 1
        ? `${names[0]} is typing…`
        : `${names.join(', ')} are typing…`
      : '';
  }

  function handleTyping({ user, isTyping }) {
    if (user.id === myId) return;
    if (typingUsers.has(user.id)) clearTimeout(typingUsers.get(user.id).timer);
    if (!isTyping) {
      typingUsers.delete(user.id);
    } else {
      const timer = setTimeout(() => {
        typingUsers.delete(user.id);
        renderTyping();
      }, 3000);
      typingUsers.set(user.id, { ...user, timer });
    }
    renderTyping();
  }

  function connect(name) {
    clearTimeout(reconnectTimer);
    try { if (ws) ws.close(); } catch {}

    ws = new WebSocket(wsUrl());
    setStatus(false, 'connecting…');

    ws.onopen = () => {
      reconnectAttempts = 0;
      setStatus(true, 'connected');
      ws.send(JSON.stringify({ type: 'join', name }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'joined':
          myId = msg.you.id;
          myName = msg.you.name;
          localStorage.setItem('chat-name', myName);
          meName.textContent = myName;
          joinScreen.hidden = true;
          chatScreen.hidden = false;
          messagesEl.innerHTML = '';
          msg.history.forEach((h) => addChat({ ...h, mine: h.from.id === myId }));
          renderUsers(msg.users);
          if (!msg.history.length) addSystem(`Welcome, ${myName}! You're in the group chat.`);
          msgInput.focus();
          break;

        case 'chat':
          addChat({ ...msg, mine: msg.from.id === myId });
          break;

        case 'user-joined':
          renderUsers(msg.users);
          addSystem(`👋 ${msg.user.name} joined`);
          break;

        case 'user-left':
          renderUsers(msg.users);
          addSystem(`👋 ${msg.user.name} left`);
          typingUsers.delete(msg.user.id);
          renderTyping();
          break;

        case 'typing':
          handleTyping(msg);
          break;

        case 'error':
          joinError.textContent = msg.text;
          joinError.hidden = false;
          break;
      }
    };

    ws.onclose = () => {
      setStatus(false, 'disconnected — retrying…');
      // auto-reconnect with backoff (max 10s), re-join with same name
      reconnectAttempts++;
      const delay = Math.min(1000 * reconnectAttempts, 10000);
      reconnectTimer = setTimeout(() => {
        if (!chatScreen.hidden || myName) connect(myName || name);
      }, delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  // ---- events ----
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (name.length < 2) {
      joinError.textContent = 'Please enter a name (min 2 characters).';
      joinError.hidden = false;
      return;
    }
    joinError.hidden = true;
    myName = name;
    connect(name);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'chat', text }));
    msgInput.value = '';
    ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
  });

  msgInput.addEventListener('input', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'typing', isTyping: true }));
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
    }, 1500);
  });

  function leave() {
    clearTimeout(reconnectTimer);
    try { if (ws) ws.close(); } catch {}
    ws = null;
    myId = null;
    typingUsers.clear();
    chatScreen.hidden = true;
    joinScreen.hidden = false;
    setStatus(false, 'connecting…');
  }
  $('leave-btn').addEventListener('click', leave);
  $('leave-btn-mobile').addEventListener('click', leave);
})();
