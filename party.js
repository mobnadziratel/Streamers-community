"use strict";
// «Подкол» — игра в стиле Quiplash. Состояние хранится в памяти (комнаты живут до перезапуска сервера).
// Транспорт: Server-Sent Events (сервер → экраны) + обычные POST (действия). Новых зависимостей нет.
const crypto = require("node:crypto");

const PROMPTS = [
  "Худшее название для кафе", "Что на самом деле думает ваш кот, когда смотрит на вас", "Неожиданное применение сковородки",
  "Худший подарок на день рождения", "Тайное хобби вашего учителя", "Самая неудачная фраза на первом свидании",
  "Чего нельзя говорить на собеседовании", "Название группы из трёх бабушек", "О чём холодильник молчит по ночам",
  "Худшее имя для домашней черепахи", "Плохой слоган для зубной пасты", "Что лежит в вашем рюкзаке, но вы об этом не знаете",
  "Самое странное правило в офисе", "Худшее место для будильника", "Как на самом деле выглядит Wi-Fi",
  "Название фильма ужасов про понедельник", "Лучшая отмазка, чтобы не идти на свадьбу", "Что кричит стример, проиграв на последней секунде",
  "Худшая суперсила", "Слоган для пожарной сигнализации, который не взяли", "Что шепчет лифт, когда в нём никого нет",
  "Самый странный вкус мороженого", "Первая строчка плохого рэпа про кастрюлю", "Что обычно прячут в носке",
  "Худшее название для боевого робота", "О чём думает курица, переходя дорогу", "Самый бесполезный навык в резюме",
  "Что должно быть написано на тапках супергероя", "Худшая тема школьного сочинения", "Идеальная отговорка, когда опоздал на стрим",
  "Что скрывает ваш браузер в истории", "Название спортивной команды из программистов", "Слоган магазина, где всё стоит один рубль",
  "Самая странная причина разбудить соседей", "Нелепое название для духов", "Что вы скажете динозавру, встретив его утром на кухне",
  "Совет, который никому не нужен", "Худшее название для автобиографии", "Что на самом деле входит в «секретный ингредиент»",
  "Чего не хватает идеальной пицце", "Самое неудачное имя для космического корабля", "Что говорит пингвин, когда ему жарко",
  "Худшая идея для стартапа", "Как на самом деле зовут дворецкого из мема", "Самый вредный совет для новичка в играх",
  "Что написано на последней странице инструкции к тостеру", "Название песни, которую поёт будильник", "Что прячет под кроватью монстр, когда ему стыдно",
  "Худший сюжет для мультфильма", "Самая неловкая надпись на футболке", "Что чат пишет, когда стример молчит"
];
const ROUNDS = 2, MIN_PLAYERS = 3, MAX_PLAYERS = 8, MAX_AUDIENCE = 100, MAX_ROOMS = 300;
const ANSWER_MS = Number(process.env.PARTY_ANSWER_MS) || 75000;
const VOTE_MS = Number(process.env.PARTY_VOTE_MS) || 20000;
const REVEAL_MS = Number(process.env.PARTY_REVEAL_MS) || 6500;
const SCORES_MS = Number(process.env.PARTY_SCORES_MS) || 8000;
const COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#38d9a9", "#4dabf7", "#9775fa", "#f783ac"];

const rooms = new Map();
const rates = new Map();
const uid = n => crypto.randomBytes(n).toString("hex");
const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ipOf = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
function limited(key, max, windowMs) {
  const now = Date.now(), list = (rates.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { rates.set(key, list); return true; }
  list.push(now); rates.set(key, list); return false;
}
function makeCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[crypto.randomInt(24)]).join("");
    if (!rooms.has(code)) return code;
  }
}

// ── Снимок состояния для конкретного зрителя (секретные ответы наружу не уходят) ──
function view(room, who) {
  const v = {
    code: room.code, phase: room.phase, round: room.round, rounds: ROUNDS, now: Date.now(), deadline: room.deadline,
    role: who.role, audience: room.audience.size, min: MIN_PLAYERS,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, online: p.online > 0, done: room.phase === "answering" ? p.done : undefined }))
  };
  const me = who.p;
  if (me) v.me = { id: me.id, name: me.name, color: me.color, score: me.score };
  if (room.phase === "answering" && me && who.role === "player") {
    v.tasks = room.matchups.map((m, mi) => ({ m, mi })).filter(x => x.m.opts.some(o => o.pid === me.id))
      .map(x => ({ mi: x.mi, prompt: x.m.prompt, answer: x.m.opts.find(o => o.pid === me.id).text }));
  }
  const m = room.matchups[room.cur];
  if ((room.phase === "voting" || room.phase === "reveal") && m) {
    v.match = { i: room.cur + 1, n: room.matchups.length, prompt: m.prompt, answers: m.opts.map(o => o.text) };
    const authors = m.opts.map(o => o.pid);
    if (room.phase === "voting") {
      v.votes = m.votes.size;
      v.canVote = who.role !== "host" && who.role !== "screen" && !authors.includes(who.id);
      v.isAuthor = authors.includes(who.id);
      v.myVote = m.votes.has(who.id) ? m.votes.get(who.id) : null;
    } else {
      v.reveal = m.opts.map((o, k) => {
        const p = room.players.find(x => x.id === o.pid) || {};
        return { text: o.text, name: p.name, color: p.color, votes: m.result.counts[k], points: m.result.points[k] };
      });
      v.bonus = m.result.bonus; v.auto = m.result.auto;
      v.myVote = m.votes.has(who.id) ? m.votes.get(who.id) : null;
    }
  }
  return v;
}
function push(room) {
  room.lastActive = Date.now();
  for (const sub of room.subs) { try { sub.res.write("data: " + JSON.stringify(view(room, sub)) + "\n\n"); } catch (_) {} }
}

// ── Игровой цикл ──
function setPhase(room, phase, ms) {
  room.phase = phase; clearTimeout(room.timer);
  room.deadline = ms ? Date.now() + ms : 0;
  if (ms) room.timer = setTimeout(() => { if (room.phase === phase) advance(room); }, ms);
  push(room);
}
function advance(room) {
  if (room.phase === "answering") startVoting(room, 0);
  else if (room.phase === "voting") reveal(room);
  else if (room.phase === "reveal") (room.cur + 1 < room.matchups.length ? startVoting(room, room.cur + 1) : setPhase(room, "roundScores", SCORES_MS));
  else if (room.phase === "roundScores") (room.round < ROUNDS ? startRound(room) : setPhase(room, "final", 0));
}
function startRound(room) {
  room.round++;
  if (room.deck.length < room.players.length) room.deck = shuffle(PROMPTS.slice());
  const order = shuffle(room.players.slice()), n = order.length;
  room.matchups = order.map((p, i) => ({
    prompt: room.deck.pop(), votes: new Map(), result: null,
    opts: shuffle([{ pid: p.id, text: null }, { pid: order[(i + 1) % n].id, text: null }])
  }));
  room.cur = -1; room.players.forEach(p => { p.done = false; });
  setPhase(room, "answering", ANSWER_MS);
}
function startVoting(room, i) {
  room.cur = i;
  const m = room.matchups[i];
  if (m.opts.some(o => o.text === null)) return reveal(room); // не ответил — голосовать не за что
  setPhase(room, "voting", VOTE_MS);
}
function reveal(room) {
  const m = room.matchups[room.cur], unit = 100 * room.round;
  const counts = [0, 0]; for (const side of m.votes.values()) counts[side]++;
  const total = counts[0] + counts[1], missing = m.opts.map(o => o.text === null);
  let points = counts.map(c => c * unit), bonus = false, auto = missing[0] || missing[1];
  if (auto) points = missing.map(x => (x || (missing[0] && missing[1])) ? 0 : unit * 2);
  else if (total >= 2 && (counts[0] === total || counts[1] === total)) { bonus = true; points[counts[0] === total ? 0 : 1] += 200 * room.round; }
  m.opts.forEach((o, k) => { const p = room.players.find(x => x.id === o.pid); if (p) p.score += points[k]; });
  m.result = { counts, points, bonus, auto };
  if (auto) m.opts.forEach(o => { if (o.text === null) o.text = "— не успел(а) —"; });
  setPhase(room, "reveal", REVEAL_MS);
}

// ── HTTP ──
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 4096) throw Object.assign(new Error("Слишком большой запрос."), { status: 413 }); chunks.push(c); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch (_) { throw Object.assign(new Error("Некорректный JSON."), { status: 400 }); }
}
const codeOf = v => clean(v, 4).toUpperCase();
function identify(room, token) {
  if (!token) return null;
  if (token === room.hostKey) return { role: "host", id: "host" };
  const p = room.players.find(x => x.token === token); if (p) return { role: "player", id: p.id, p };
  for (const a of room.audience.values()) if (a.token === token) return { role: "audience", id: a.id };
  return null;
}

async function handleParty(req, res, url) {
  const route = url.pathname.replace(/^\/api\/party\//, "");
  try {
    if (route === "room" && req.method === "GET") {
      const room = rooms.get(codeOf(url.searchParams.get("code")));
      return room ? json(res, 200, { exists: true, phase: room.phase, players: room.players.length, open: room.phase === "lobby" && room.players.length < MAX_PLAYERS })
                  : json(res, 404, { exists: false, error: "Комната не найдена." });
    }
    if (route === "events" && req.method === "GET") {
      const room = rooms.get(codeOf(url.searchParams.get("code")));
      const who = room && identify(room, String(url.searchParams.get("token") || ""));
      if (!room || !who) return json(res, 404, { error: "Комната или сессия не найдена." });
      if (room.subs.size >= 200) return json(res, 503, { error: "В комнате слишком много подключений." });
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 2000\n\n");
      const sub = { res, role: who.role, id: who.id, p: who.p };
      room.subs.add(sub);
      if (who.p) who.p.online++;
      res.write("data: " + JSON.stringify(view(room, sub)) + "\n\n");
      req.on("close", () => { room.subs.delete(sub); if (who.p) who.p.online = Math.max(0, who.p.online - 1); push(room); });
      if (who.p) push(room);
      return;
    }
    if (req.method !== "POST") return json(res, 404, { error: "Неизвестный маршрут." });
    const body = await readBody(req), ip = ipOf(req);

    if (route === "create") {
      if (limited("c:" + ip, 6, 600000)) return json(res, 429, { error: "Слишком много комнат. Подожди немного." });
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: "Сервер переполнен, попробуй позже." });
      const room = { code: makeCode(), hostKey: uid(16), phase: "lobby", round: 0, cur: -1, deadline: 0, timer: null, players: [], audience: new Map(), matchups: [], deck: shuffle(PROMPTS.slice()), subs: new Set(), lastActive: Date.now() };
      rooms.set(room.code, room);
      return json(res, 201, { code: room.code, key: room.hostKey });
    }

    const room = rooms.get(codeOf(body.code));
    if (!room) return json(res, 404, { error: "Комната не найдена или уже закрыта." });

    if (route === "join") {
      if (limited("j:" + ip, 40, 600000)) return json(res, 429, { error: "Слишком много попыток. Подожди немного." });
      const existing = identify(room, String(body.token || ""));
      if (existing && existing.role !== "host") return json(res, 200, { token: body.token, role: existing.role });
      const name = clean(body.name, 16);
      if (name.length < 2) return json(res, 400, { error: "Ник должен быть от 2 до 16 символов." });
      const asPlayer = !body.audience && room.phase === "lobby" && room.players.length < MAX_PLAYERS;
      if (!asPlayer && room.audience.size >= MAX_AUDIENCE) return json(res, 409, { error: "В комнате нет мест." });
      if (!body.audience && !asPlayer && room.phase === "lobby") body.audience = true;
      let unique = name, n = 2; const taken = x => room.players.some(p => p.name.toLowerCase() === x.toLowerCase());
      while (taken(unique)) unique = name.slice(0, 13) + " " + n++;
      const token = uid(16);
      if (asPlayer) {
        room.players.push({ id: uid(4), token, name: unique, color: COLORS[room.players.length % COLORS.length], score: 0, online: 0, done: false });
        push(room); return json(res, 201, { token, role: "player" });
      }
      room.audience.set(token, { id: uid(4), token, name: unique });
      push(room); return json(res, 201, { token, role: "audience", late: room.phase !== "lobby" });
    }

    const who = identify(room, String(body.token || body.key || ""));
    if (!who) return json(res, 401, { error: "Сессия не найдена." });

    if (route === "answer" && who.role === "player" && room.phase === "answering") {
      const m = room.matchups[Number(body.mi)], opt = m && m.opts.find(o => o.pid === who.id), text = clean(body.text, 70);
      if (!opt || opt.text !== null || !text) return json(res, 400, { error: "Ответ не принят." });
      opt.text = text;
      who.p.done = room.matchups.every(x => x.opts.every(o => o.pid !== who.id || o.text !== null));
      if (room.players.every(p => p.done)) advance(room); else push(room);
      return json(res, 200, { ok: true });
    }
    if (route === "vote" && room.phase === "voting" && (who.role === "player" || who.role === "audience")) {
      const m = room.matchups[room.cur], side = Number(body.side);
      if (!m || (side !== 0 && side !== 1) || m.opts.some(o => o.pid === who.id)) return json(res, 400, { error: "Голос не принят." });
      m.votes.set(who.id, side);
      const eligible = room.players.filter(p => !m.opts.some(o => o.pid === p.id));
      if (room.audience.size === 0 && eligible.every(p => m.votes.has(p.id))) advance(room); else push(room);
      return json(res, 200, { ok: true });
    }
    if (who.role !== "host") return json(res, 403, { error: "Действие недоступно." });
    if (route === "start") {
      if (room.phase !== "lobby" || room.players.length < MIN_PLAYERS) return json(res, 400, { error: "Нужно минимум " + MIN_PLAYERS + " игрока." });
      room.round = 0; startRound(room); return json(res, 200, { ok: true });
    }
    if (route === "skip") { if (["answering", "voting", "reveal", "roundScores"].includes(room.phase)) advance(room); return json(res, 200, { ok: true }); }
    if (route === "kick" && room.phase === "lobby") { room.players = room.players.filter(p => p.id !== body.id); push(room); return json(res, 200, { ok: true }); }
    if (route === "restart" && room.phase === "final") {
      room.players.forEach(p => { p.score = 0; p.done = false; }); room.round = 0; room.matchups = []; room.cur = -1; setPhase(room, "lobby", 0); return json(res, 200, { ok: true });
    }
    if (route === "close") {
      clearTimeout(room.timer); for (const s of room.subs) { try { s.res.end(); } catch (_) {} } rooms.delete(room.code); return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "Неизвестное действие." });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "Ошибка сервера." });
  }
}

// Heartbeat для SSE (иначе прокси рвут «молчащие» соединения) и уборка заброшенных комнат.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const s of room.subs) { try { s.res.write(": ping\n\n"); } catch (_) {} }
    if (now - room.lastActive > 3 * 3600000 && room.subs.size === 0) { clearTimeout(room.timer); rooms.delete(room.code); }
  }
  for (const [k, list] of rates) { const fresh = list.filter(t => now - t < 600000); if (fresh.length) rates.set(k, fresh); else rates.delete(k); }
}, 15000).unref();

module.exports = { handleParty };
