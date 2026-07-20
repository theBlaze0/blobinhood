'use strict';
// Wallet-safety invariant: the ONLY wallet methods in this file are
// eth_requestAccounts and personal_sign. Nothing here can move funds.
const $ = (id) => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
addEventListener('resize', resize); resize();

const state = {
  ws: null, wsUrl: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws',
  playing: false, myId: null, worldSize: 4000,
  prev: null, cur: null, curAt: 0, prevAt: 0,
  wallet: null, backoff: 1000,
};

fetch('/commit').then((r) => r.text()).then((c) => { $('commit').textContent = 'commit ' + c; }).catch(() => {});

function toast(msg, ms = 4000) {
  $('toast').textContent = msg; $('toast').style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => { $('toast').style.display = 'none'; }, ms);
}

function connect() {
  const ws = new WebSocket(state.wsUrl);
  state.ws = ws;
  ws.onopen = () => { state.backoff = 1000; $('badge').style.display = 'none'; ws.send(JSON.stringify({ t: 'hello' })); };
  ws.onclose = () => {
    $('badge').style.display = 'block';
    state.playing = false; state.myId = null;
    setTimeout(connect, state.backoff);
    state.backoff = Math.min(state.backoff * 2, 10000);
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'snap') {
      state.prev = state.cur; state.prevAt = state.curAt;
      state.cur = m; state.curAt = performance.now();
      renderBoard(m.board);
      if (m.me) $('mass').textContent = Math.round(m.me.m);
    } else if (m.t === 'joined') {
      state.playing = true; state.myId = m.id; state.worldSize = m.world;
      $('landing').style.display = 'none'; $('dead').style.display = 'none';
      if (m.note) toast(m.note);
    } else if (m.t === 'dead') {
      $('dead').style.display = 'flex';
      let left = m.respawnIn;
      const cd = setInterval(() => {
        left -= 100;
        $('respawn').textContent = 'respawning in ' + Math.max(0, left / 1000).toFixed(1) + 's';
        if (left <= 0) { clearInterval(cd); $('dead').style.display = 'none'; }
      }, 100);
    } else if (m.t === 'err') { toast(m.msg); }
  };
}
connect();

const sendWhenReady = (msg, tries = 20) => {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
  else if (tries > 0) setTimeout(() => sendWhenReady(msg, tries - 1), 250);
};

$('play').onclick = () => sendWhenReady({ t: 'join', name: $('name').value });

$('connect').onclick = async () => {
  if (!window.ethereum) return toast('no wallet detected — you can still play anonymously');
  try {
    const [addr] = await ethereum.request({ method: 'eth_requestAccounts' });
    state.wallet = addr;
    const onNonce = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t !== 'nonce') return;
      state.ws.removeEventListener('message', onNonce);
      ethereum.request({ method: 'personal_sign', params: [m.msg, addr] })
        .then((sig) => sendWhenReady({ t: 'join', name: $('name').value, addr, sig, msg: m.msg }))
        .catch(() => toast('signature declined — nothing was sent'));
    };
    state.ws.addEventListener('message', onNonce);
    sendWhenReady({ t: 'nonce', addr });
  } catch { toast('wallet connection declined'); }
};

// aim: mouse position relative to screen center, throttled to 20/s
let lastAim = 0;
const aim = (cx, cy) => {
  const now = performance.now();
  if (!state.playing || now - lastAim < 50) return;
  lastAim = now;
  sendWhenReady({ t: 'aim', x: cx - canvas.width / 2, y: cy - canvas.height / 2 });
};
addEventListener('mousemove', (e) => aim(e.clientX, e.clientY));
addEventListener('touchmove', (e) => { const t = e.touches[0]; aim(t.clientX, t.clientY); }, { passive: true });

function renderBoard(board) {
  $('rows').innerHTML = board.map((r, i) =>
    `<div${state.cur?.me && r.name === nameOf(state.myId) ? ' class="me"' : ''}><span>${i + 1}. ${esc(r.name)}</span><span>${r.m} · ${r.eats}🍴</span></div>`
  ).join('');
}
const nameOf = (id) => state.cur?.cells.find((c) => c.id === id)?.name;
const esc = (s) => String(s).replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));

const radius = (m) => 4 * Math.sqrt(m);
const lerp = (a, b, t) => a + (b - a) * t;

function draw() {
  requestAnimationFrame(draw);
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cur = state.cur;
  if (!cur) return;
  const t = Math.min(1, (performance.now() - state.curAt) / 100);
  const prevOf = (id) => state.prev?.cells.find((c) => c.id === id);

  const meCur = cur.me, mePrev = state.prev?.me;
  const camX = meCur ? lerp(mePrev?.x ?? meCur.x, meCur.x, t) : state.worldSize / 2;
  const camY = meCur ? lerp(mePrev?.y ?? meCur.y, meCur.y, t) : state.worldSize / 2;
  const zoom = meCur ? Math.max(0.4, Math.min(1.4, 1.6 - Math.log10(meCur.m) / 2)) : Math.min(canvas.width, canvas.height) / 2600;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // world border + grid
  ctx.strokeStyle = '#1a2340'; ctx.lineWidth = 1;
  for (let g = 0; g <= state.worldSize; g += 200) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, state.worldSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(state.worldSize, g); ctx.stroke();
  }
  ctx.strokeStyle = '#2a3355'; ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, state.worldSize, state.worldSize);

  for (const p of cur.pellets) {
    ctx.fillStyle = '#2f9e63';
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill();
  }
  for (const g of cur.gold) {
    ctx.save();
    ctx.shadowColor = '#ffd257'; ctx.shadowBlur = 25;
    ctx.fillStyle = '#ffd257';
    ctx.beginPath(); ctx.arc(g.x, g.y, Math.max(8, radius(g.m) / 2), 0, 7); ctx.fill();
    ctx.restore();
  }
  const cells = [...cur.cells].sort((a, b) => a.m - b.m);
  for (const c of cells) {
    const pv = prevOf(c.id);
    const x = lerp(pv?.x ?? c.x, c.x, t), y = lerp(pv?.y ?? c.y, c.y, t);
    const r = radius(lerp(pv?.m ?? c.m, c.m, t));
    const mine = c.id === state.myId;
    const grad = ctx.createRadialGradient(x - r / 3, y - r / 3, r / 5, x, y, r);
    grad.addColorStop(0, mine ? '#b7ffda' : '#7ce8ae');
    grad.addColorStop(1, mine ? '#3ddc84' : '#1f8f52');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    if (mine) { ctx.strokeStyle = '#e8ecf8'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = '#05220f';
    ctx.font = `bold ${Math.max(11, r / 3)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.name, x, y);
  }
  ctx.restore();
  drawMinimap(cur);
}

function drawMinimap(cur) {
  if (!cur.map) return;
  const size = Math.min(180, canvas.width * 0.22);
  const pad = 12;
  const x0 = canvas.width - size - pad, y0 = canvas.height - size - pad;
  const k = size / state.worldSize;

  ctx.fillStyle = 'rgba(20,26,48,0.85)';
  ctx.strokeStyle = '#2a3355'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 8); ctx.fill(); ctx.stroke();

  ctx.save();
  ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 8); ctx.clip();
  for (const g of cur.map.gold) {
    ctx.fillStyle = '#ffd257';
    ctx.beginPath(); ctx.arc(x0 + g.x * k, y0 + g.y * k, 3, 0, 7); ctx.fill();
  }
  for (const c of cur.map.cells) {
    const mine = c.id === state.myId;
    const r = Math.max(2, Math.min(6, Math.sqrt(c.m) / 4));
    ctx.fillStyle = mine ? '#b7ffda' : '#3ddc84aa';
    ctx.beginPath(); ctx.arc(x0 + c.x * k, y0 + c.y * k, mine ? Math.max(r, 3) : r, 0, 7); ctx.fill();
    if (mine) { ctx.strokeStyle = '#e8ecf8'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  ctx.restore();
}
draw();

// dev convenience: ?autoplay=<name> joins anonymously on load
const auto = new URLSearchParams(location.search).get('autoplay');
if (auto) setTimeout(() => sendWhenReady({ t: 'join', name: auto }), 500);
