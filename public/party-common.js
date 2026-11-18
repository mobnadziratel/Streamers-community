// Общие помощники для «Подкола»: создание узлов, запросы, подключение к SSE и таймер с поправкой на часы сервера.
window.Party = (() => {
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, ""); else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const api = async (route, body) => {
    const r = await fetch("/api/party/" + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "Ошибка запроса"), { status: r.status });
    return data;
  };
  let offset = 0, deadline = 0, tick = null;
  const clock = el => { // el.textContent = секунды до дедлайна
    clearInterval(tick);
    const draw = () => { el.textContent = deadline ? Math.max(0, Math.ceil((deadline - Date.now() - offset) / 1000)) : ""; };
    draw(); tick = setInterval(draw, 250);
  };
  const connect = (code, token, onState, onDead) => {
    let es;
    const open = () => {
      es = new EventSource("/api/party/events?code=" + encodeURIComponent(code) + "&token=" + encodeURIComponent(token));
      es.onmessage = e => { const v = JSON.parse(e.data); offset = v.now - Date.now(); deadline = v.deadline; onState(v); };
      es.onerror = () => { if (es.readyState === EventSource.CLOSED) { fetch("/api/party/room?code=" + code).then(r => { if (r.ok) setTimeout(open, 2000); else onDead(); }).catch(() => setTimeout(open, 3000)); } };
    };
    open();
    return () => es && es.close();
  };
  const dot = (p, size) => h("span", { class: "dot" + (p.online === false ? " off" : ""), style: "background:" + p.color + (size ? ";width:" + size + "px;height:" + size + "px" : "") }, p.avatar || Array.from(p.name)[0].toUpperCase());
  // Рисунки: штрихи {c: цвет, w: толщина, p: [x,y,…]} в координатах 0–400. Один формат и для холста игрока, и для экрана хоста.
  const PALETTE = ["#1b1b1f", "#ffffff", "#ff5c5c", "#ff9f43", "#ffd93d", "#4cd97b", "#4dabf7", "#9775fa", "#f783ac", "#8d6e63"], WIDTHS = [3, 8, 16];
  const paper = canvas => { const x = canvas.getContext("2d"); x.fillStyle = "#fdfcf7"; x.fillRect(0, 0, canvas.width, canvas.height); return x; };
  const segment = (x, st, scale, a, b) => {
    x.strokeStyle = x.fillStyle = PALETTE[st.c]; x.lineWidth = WIDTHS[st.w] * scale; x.lineCap = x.lineJoin = "round";
    if (a === b) { x.beginPath(); x.arc(st.p[a] * scale, st.p[a + 1] * scale, x.lineWidth / 2, 0, 7); x.fill(); return; }
    x.beginPath(); x.moveTo(st.p[a] * scale, st.p[a + 1] * scale); x.lineTo(st.p[b] * scale, st.p[b + 1] * scale); x.stroke();
  };
  const paint = (canvas, strokes) => {
    const x = paper(canvas), scale = canvas.width / 400;
    for (const st of strokes) { if (st.p.length === 2) segment(x, st, scale, 0, 0); for (let i = 0; i + 3 < st.p.length; i += 2) segment(x, st, scale, i, i + 2); }
  };
  const artCache = new Map();
  const loadArt = (code, k) => {
    const key = code + ":" + k;
    if (!artCache.has(key)) artCache.set(key, fetch("/api/party/art?code=" + encodeURIComponent(code) + "&k=" + k).then(r => r.ok ? r.json() : []).catch(() => []));
    return artCache.get(key);
  };
  const artCanvas = (code, k, cls) => { const c = h("canvas", { class: cls || "art", width: 400, height: 400 }); paper(c); loadArt(code, k).then(st => paint(c, st)); return c; };
  // Фон: слой с плавающими значками, набор зависит от режима (сцена / расследование / мастерская).
  const GLYPHS = { quip: ["💬", "🎤", "😂", "✨", "🎭"], fib: ["❓", "🔎", "🕵️", "📎", "🗝️"], draw: ["🎨", "✏️", "🖍️", "⭐", "🌈"], none: ["✦", "✧", "❄"] };
  let bgMode = null;
  const bg = mode => {
    mode = GLYPHS[mode] ? mode : "none";
    document.body.dataset.mode = mode === "none" ? "" : mode;
    if (bgMode === mode) return; bgMode = mode;
    let layer = document.querySelector(".pbg"); if (!layer) { layer = h("div", { class: "pbg", "aria-hidden": "true" }); document.body.prepend(layer); }
    layer.replaceChildren(...Array.from({ length: 16 }, (_, i) => h("span", { class: "pp", style: "left:" + (Math.random() * 96).toFixed(1) + "%;font-size:" + (18 + Math.random() * 30).toFixed(0) + "px;--d:" + (20 + Math.random() * 18).toFixed(1) + "s;--w:-" + (Math.random() * 30).toFixed(1) + "s;--r:" + (Math.random() * 120 - 60).toFixed(0) + "deg" }, GLYPHS[mode][i % GLYPHS[mode].length])));
  };
  const confetti = () => {
    const box = h("div", { class: "confetti", "aria-hidden": "true" }), cols = ["#ffd43b", "#ff6b6b", "#69db7c", "#4dabf7", "#f783ac", "#9775fa"];
    for (let i = 0; i < 70; i++) box.append(h("i", { style: "left:" + (Math.random() * 100).toFixed(1) + "%;background:" + cols[i % 6] + ";--d:" + (3.5 + Math.random() * 3).toFixed(1) + "s;--w:" + (Math.random() * 1.6).toFixed(2) + "s;--x:" + (Math.random() * 160 - 80).toFixed(0) + "px;--r:" + (360 + Math.random() * 720).toFixed(0) + "deg" }));
    document.body.append(box); setTimeout(() => box.remove(), 9000);
  };
  return { h, api, clock, connect, dot, PALETTE, WIDTHS, paper, segment, paint, artCanvas, bg, confetti };
})();
