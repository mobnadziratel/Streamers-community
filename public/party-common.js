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
  const dot = (p, size) => h("span", { class: "dot" + (p.online === false ? " off" : ""), style: "background:" + p.color + (size ? ";width:" + size + "px;height:" + size + "px" : "") }, Array.from(p.name)[0].toUpperCase());
  return { h, api, clock, connect, dot };
})();
