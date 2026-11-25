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
PROMPTS.push(
  "Худшее, что можно услышать от стоматолога", "Название реалити-шоу про соседей по подъезду", "Что на самом деле делает лифт между этажами",
  "Самая странная реклама ночью", "Что бы вы забрали с необитаемого острова, кроме здравого смысла", "Название блюда, которое страшно заказывать",
  "Худшее прозвище для начальника", "Секретный пароль от клуба любителей носков", "Самая неубедительная отмазка от физкультуры",
  "Лучшее название для кота-бизнесмена", "Что говорит навигатор, когда вы окончательно заблудились", "Плохое название для спа-салона",
  "Что нельзя класть в микроволновку, но очень хочется", "Реклама самого бесполезного гаджета", "Худшее время для танца",
  "Что показывает рентген у вашего друга-геймера", "Тайная миссия обычного голубя", "Название ролика, после которого вас забанят на YouTube",
  "Самая дурацкая причина для звонка в техподдержку", "Необычная примета, которая работает только у вас", "Что кричат болельщики на турнире по шахматам",
  "Худший совет по выживанию в лесу", "Название духов с запахом понедельника", "Чем на самом деле занимается ваш холодильник в отпуске",
  "Слоган для зубочисток класса люкс", "Самое неловкое объявление в метро", "Что надо сказать Деду Морозу в июле", "Название альбома группы из чайников",
  "Самый странный повод для праздника", "Худшая работа для супергероя", "Что стример прячет за камерой", "Самая смешная надпись на надгробии пирата",
  "Что у кота в голове в 3 часа ночи", "Худший вопрос для первого свидания", "Лучшее название для школы волшебников-неудачников", "Идеальная фраза для рекламы лапши быстрого приготовления",
  "Что скрывается в самом дальнем углу шкафа", "Неожиданный ингредиент борща", "Название квеста, в который не хочется идти", "Что говорит робот-пылесос, возвращаясь на базу",
  "Самый нелепый талант на шоу «Минута славы»", "Подсказка, которая только всё усложняет", "Худший сюрприз на день рождения", "Название книги, которую никто не дочитал",
  "Что должно быть на гербе вашей кухни", "Странное правило в клубе любителей кактусов", "Самая странная находка в старом рюкзаке", "Как чат отреагирует, если вы скажете «я сейчас вернусь»",
  "Название мобильной игры для бабушек-хакеров", "Лучшая реплика для злодея в мультфильме про овощи"
);
const FIBS = [
  ["У осьминога ___ сердца.", "три"], ["Мёд не портится: в египетских гробницах нашли съедобный мёд возрастом около ___ лет.", "3000"],
  ["С точки зрения ботаники, банан — это ___.", "ягода"], ["Самая большая пустыня на Земле — не Сахара, а ___.", "Антарктическая"],
  ["Летом Эйфелева башня «вырастает» из-за жары примерно на ___ сантиметров.", "15"], ["Вомбаты — единственные животные, чей помёт имеет форму ___.", "кубиков"],
  ["Кошки не чувствуют вкус ___.", "сладкого"], ["Столица Австралии — не Сидней и не Мельбурн, а ___.", "Канберра"],
  ["«Чёрные ящики» самолётов на самом деле ___ цвета.", "оранжевого"], ["Молния нагревает воздух вокруг себя примерно до ___ градусов.", "30 000"],
  ["Первая в мире веб-страница появилась в ___ году.", "1991"], ["Фламинго розовые из-за ___.", "еды"],
  ["Улитка может проспать подряд до ___ лет.", "трёх"], ["Самая высокая гора Солнечной системы, вулкан Олимп, находится на ___.", "Марсе"],
  ["В Исландии нет ___.", "комаров"], ["У жирафа ___ шейных позвонков — столько же, сколько у человека.", "семь"],
  ["Рыба-клоун рождается самцом, а потом может стать ___.", "самкой"], ["Сапсан при пикировании разгоняется быстрее ___ км/ч.", "300"],
  ["Самая прочная кость человека — ___.", "бедренная"], ["Кофейные «зёрна» на самом деле ___ ягоды.", "семена"],
  ["Глубина Марианской впадины — около ___ километров.", "11"], ["Первый искусственный спутник Земли назывался ___.", "Спутник-1"],
  ["В Мёртвом море невозможно ___.", "утонуть"], ["Самое маленькое государство мира — ___.", "Ватикан"],
  ["Самая длинная река Европы — ___.", "Волга"], ["Жгучесть перца чили создаёт вещество ___.", "капсаицин"]
].map(([q, a]) => ({ q, a }));
const DRAWS = ["Кот-программист", "Робот на пляже", "Дракон, который боится огня", "Пингвин в сауне", "Единорог на работе", "Привидение в лифте", "Космонавт в метро",
  "Слон на самокате", "Динозавр с зонтиком", "Пицца с глазами", "Сумасшедший учёный", "Утка-супергерой", "Бабушка на мотоцикле", "Волк и семеро козлят", "Снеговик летом",
  "Холодильник мечтает", "Акула на велосипеде", "Король пельменей", "Лягушка-принцесса в суде", "Осьминог за компьютером", "Жираф в тесной комнате", "Ёжик в тумане с телефоном",
  "Тыква на свидании", "Кактус-массажист", "Совы-детективы", "Медведь на льду", "Крокодил чистит зубы", "Чайник-путешественник", "Рыцарь против пылесоса", "Стример на необитаемом острове",
  "Корова в космосе", "Мышь-тяжелоатлет", "Улитка на гонках", "Банан-пират", "Зомби на диете", "Верблюд в аэропорту", "Кролик-фокусник", "Борщ-монстр", "Паук-программист", "Лама на концерте"];
const DRAW_MS = Number(process.env.PARTY_DRAW_MS) || 90000;
// Аватарки подбираются под режим: комики на сцене, сыщики на допросе, художники в мастерской.
const AVATAR_SETS = {
  quip: ["🎤", "🤡", "🎭", "😎", "🤪", "🥳", "🕺", "💃", "🦸", "🧙", "🎩", "🤓", "🥸", "😜", "🦄", "🐸"],
  fib: ["🕵️", "🥷", "🦊", "🐍", "🦉", "🐺", "🎩", "🧛", "🦹", "🧐", "🐀", "🦅", "🦎", "🕶️", "🗝️", "🔎"],
  draw: ["🎨", "🖌️", "🖍️", "🐙", "🦋", "🐠", "🦜", "🐝", "🌈", "🌻", "🍄", "🦖", "🐼", "🐸", "✏️", "⭐"]
};
const LIE_MS = Number(process.env.PARTY_LIE_MS) || 45000, PICK_MS = Number(process.env.PARTY_PICK_MS) || 25000;
const MODES = ["quip", "fib", "draw"];
const normText = t => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const MIN_PLAYERS = 3, MAX_PLAYERS = 8, MAX_AUDIENCE = 100, MAX_ROOMS = 300;
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
// Рисунок = список штрихов {c: цвет 0-9, w: толщина 0-2, p: [x1,y1,x2,y2,…] в координатах 0–400}.
function cleanStrokes(input) {
  if (!Array.isArray(input) || input.length > 150) return null;
  let points = 0; const out = [];
  for (const st of input) {
    if (!st || !Array.isArray(st.p) || st.p.length < 2 || st.p.length % 2) return null;
    points += st.p.length / 2; if (points > 8000) return null;
    const c = Number(st.c), w = Number(st.w), pts = st.p.map(n => Math.round(Number(n)));
    if (!(c >= 0 && c <= 9) || !(w >= 0 && w <= 2) || pts.some(n => !(n >= 0 && n <= 400))) return null;
    out.push({ c: Math.round(c), w: Math.round(w), p: pts });
  }
  return out.length ? out : null;
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
    code: room.code, mode: room.mode, phase: room.phase, round: room.round, rounds: room.rounds, now: Date.now(), deadline: room.deadline,
    role: who.role, audience: room.audience.size, min: MIN_PLAYERS,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, score: p.score, online: p.online > 0, done: ["answering", "lie", "drawing"].includes(room.phase) ? p.done : undefined }))
  };
  const me = who.p;
  if (me) v.me = { id: me.id, name: me.name, color: me.color, avatar: me.avatar, score: me.score };
  if (room.phase === "drawing" && me && who.role === "player") {
    const t = room.drawTasks.get(me.id); v.myPrompt = t && t.prompt; v.drawn = Boolean(t && t.strokes);
  }
  if (room.phase === "answering" && me && who.role === "player") {
    v.tasks = room.matchups.map((m, mi) => ({ m, mi })).filter(x => x.m.opts.some(o => o.pid === me.id))
      .map(x => ({ mi: x.mi, prompt: x.m.prompt, answer: x.m.opts.find(o => o.pid === me.id).text }));
  }
  const m = room.matchups[room.cur];
  const nameOf = id => (room.players.find(x => x.id === id) || [...room.audience.values()].find(x => x.id === id) || {}).name;
  if (room.phase === "final") {
    const aw = awards(room);
    v.cards = room.players.slice().sort((a, b) => b.score - a.score).map((p, i) => Object.assign({ id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score, place: i + 1 }, aw[p.id]));
  }
  if (m && m.kind === "fib" && ["lie", "pick", "reveal"].includes(room.phase)) {
    v.fib = { i: room.cur + 1, n: room.matchups.length, prompt: m.prompt };
    if (m.artist) { v.fib.prompt = "Что нарисовано?"; v.fib.art = room.cur; v.fib.artist = nameOf(m.artist); v.isArtist = who.id === m.artist; }
    if (room.phase === "lie") v.lied = m.lies.has(who.id);
    if (room.phase === "pick") {
      v.options = m.options.map(o => o.text); v.picks = m.picks.size;
      v.mine = m.options.map((o, k) => o.authors.includes(who.id) ? k : -1).filter(k => k >= 0);
      v.myPick = m.picks.has(who.id) ? m.picks.get(who.id) : null; v.canPick = (who.role === "player" || who.role === "audience") && who.id !== m.artist;
    }
    if (room.phase === "reveal") v.fibReveal = { truth: m.truth, options: m.options.map((o, k) => ({ text: o.text, truth: o.truth, authors: o.authors.map(nameOf),
      pickedBy: [...m.picks].filter(x => x[1] === k).map(x => nameOf(x[0])) })) };
  } else if ((room.phase === "voting" || room.phase === "reveal") && m) {
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
  const next = room.mode === "quip" ? startVoting : startLie;
  if (room.phase === "answering") startVoting(room, 0);
  else if (room.phase === "drawing") startArt(room);
  else if (room.phase === "lie") startPick(room);
  else if (room.phase === "pick") revealFib(room);
  else if (room.phase === "voting") reveal(room);
  else if (room.phase === "reveal") (room.cur + 1 < room.matchups.length ? next(room, room.cur + 1) : setPhase(room, "roundScores", SCORES_MS));
  else if (room.phase === "roundScores") (room.round < room.rounds ? startRound(room) : setPhase(room, "final", 0));
}
// «Враки»: придумай правдоподобную ложь к факту, потом найди правду среди всех вариантов.
function startArt(room) {
  room.matchups = [...room.drawTasks].filter(([, t]) => t.strokes && t.strokes.length).map(([pid, t]) => ({ kind: "fib", artist: pid, art: t.strokes, prompt: "", truth: t.prompt, lies: new Map(), options: [], picks: new Map(), result: null }));
  room.cur = -1;
  if (!room.matchups.length) return setPhase(room, "roundScores", SCORES_MS);
  startLie(room, 0);
}
function startLie(room, i) {
  room.cur = i; room.players.forEach(p => { p.done = room.matchups[i].artist === p.id; });
  setPhase(room, "lie", LIE_MS);
}
function startPick(room) {
  const q = room.matchups[room.cur], byText = new Map();
  for (const [pid, text] of q.lies) { const k = normText(text); if (!byText.has(k)) byText.set(k, { text, truth: false, authors: [] }); byText.get(k).authors.push(pid); }
  q.options = shuffle([{ text: q.truth, truth: true, authors: [] }, ...byText.values()]);
  setPhase(room, "pick", PICK_MS);
}
function revealFib(room) {
  const q = room.matchups[room.cur], unit = 100 * room.round, byId = id => room.players.find(x => x.id === id);
  for (const [voter, k] of q.picks) {
    const o = q.options[k], vp = byId(voter);
    if (o.truth) { if (vp) { vp.score += 5 * unit; vp.st.truths++; } const ar = q.artist && byId(q.artist); if (ar) { ar.score += 3 * unit; ar.st.art++; } }
    else o.authors.forEach(a => { const ap = byId(a); if (ap) { ap.score += 3 * unit; ap.st.fooled++; } });
  }
  q.result = {}; setPhase(room, "reveal", Math.round(REVEAL_MS * 1.6));
}
function awards(room) {
  const cats = [["🤣", "Король шуток", "votes", n => n + " голосов за ответы"], ["🕵️", "Детектив", "truths", n => "нашёл правду " + n + " раз"],
    ["🎭", "Мастер обмана", "fooled", n => "обманул " + n + " раз"], ["💥", "Разгромщик", "crush", n => "разгромов: " + n], ["🎨", "Художник", "art", n => "тебя поняли " + n + " раз"]];
  const res = {};
  for (const [icon, label, key, fmt] of cats) {
    const lead = room.players.filter(p => !res[p.id] && p.st[key] > 0).sort((a, b) => b.st[key] - a.st[key])[0];
    if (lead) res[lead.id] = { icon, label, note: fmt(lead.st[key]) };
  }
  const spare = [["🎉", "Душа компании"], ["🍀", "Везунчик"], ["🌟", "Звезда вечера"], ["🦉", "Тихий наблюдатель"]];
  room.players.forEach((p, i) => { if (!res[p.id]) res[p.id] = { icon: spare[i % 4][0], label: spare[i % 4][1], note: "" }; });
  return res;
}
function startRound(room) {
  room.round++;
  if (room.mode === "draw") {
    if (room.drawDeck.length < room.players.length) room.drawDeck = shuffle(DRAWS.slice());
    room.drawTasks = new Map(room.players.map(p => [p.id, { prompt: room.drawDeck.pop(), strokes: null }]));
    room.players.forEach(p => { p.done = false; });
    return setPhase(room, "drawing", DRAW_MS);
  }
  if (room.mode === "fib") {
    if (room.fibDeck.length < 3) room.fibDeck = shuffle(FIBS.slice());
    room.matchups = Array.from({ length: 3 }, () => { const f = room.fibDeck.pop(); return { kind: "fib", prompt: f.q, truth: f.a, lies: new Map(), options: [], picks: new Map(), result: null }; });
    return startLie(room, 0);
  }
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
  const top = Math.max(counts[0], counts[1]);
  m.opts.forEach((o, k) => { const p = room.players.find(x => x.id === o.pid); if (p) { p.score += points[k]; p.st.votes += counts[k]; if (top > 0 && counts[k] === top && counts[0] !== counts[1]) p.st.wins++; if (bonus && counts[k] === total) p.st.crush++; } });
  m.result = { counts, points, bonus, auto };
  if (auto) m.opts.forEach(o => { if (o.text === null) o.text = "— не успел(а) —"; });
  setPhase(room, "reveal", REVEAL_MS);
}

// ── HTTP ──
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req, limit = 4096) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error("Слишком большой запрос."), { status: 413 }); chunks.push(c); }
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
      return room ? json(res, 200, { exists: true, mode: room.mode, avatars: AVATAR_SETS[room.mode], phase: room.phase, players: room.players.length, open: room.phase === "lobby" && room.players.length < MAX_PLAYERS })
                  : json(res, 404, { exists: false, error: "Комната не найдена." });
    }
    if (route === "art" && req.method === "GET") {
      const room = rooms.get(codeOf(url.searchParams.get("code"))), q = room && room.matchups[Number(url.searchParams.get("k"))];
      if (!q || !q.art || room.phase === "drawing") return json(res, 404, { error: "Рисунок недоступен." });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
      return res.end(JSON.stringify(q.art));
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
    const body = await readBody(req, route === "draw" ? 65536 : 4096), ip = ipOf(req);

    if (route === "create") {
      if (limited("c:" + ip, 6, 600000)) return json(res, 429, { error: "Слишком много комнат. Подожди немного." });
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: "Сервер переполнен, попробуй позже." });
      const room = { code: makeCode(), hostKey: uid(16), mode: MODES.includes(body.mode) ? body.mode : "quip", drawDeck: shuffle(DRAWS.slice()), rounds: Math.min(3, Math.max(1, Math.round(Number(body.rounds)) || 2)), fibDeck: shuffle(FIBS.slice()), phase: "lobby", round: 0, cur: -1, deadline: 0, timer: null, players: [], audience: new Map(), matchups: [], deck: shuffle(PROMPTS.slice()), subs: new Set(), lastActive: Date.now() };
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
        const set = AVATAR_SETS[room.mode], free = set.filter(a => !room.players.some(p => p.avatar === a));
        const avatar = free.includes(body.avatar) ? body.avatar : free[crypto.randomInt(free.length)];
        room.players.push({ id: uid(4), token, name: unique, avatar, color: COLORS[room.players.length % COLORS.length], score: 0, online: 0, done: false, st: { votes: 0, wins: 0, truths: 0, fooled: 0, crush: 0, art: 0 } });
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
    if (route === "draw" && who.role === "player" && room.phase === "drawing") {
      const t = room.drawTasks.get(who.id), strokes = cleanStrokes(body.strokes);
      if (!t || t.strokes || !strokes) return json(res, 400, { error: "Рисунок не принят." });
      t.strokes = strokes; who.p.done = true;
      if (room.players.every(p => p.done)) advance(room); else push(room);
      return json(res, 200, { ok: true });
    }
    if (route === "lie" && who.role === "player" && room.phase === "lie") {
      const q = room.matchups[room.cur], text = clean(body.text, 50);
      if (!text || q.lies.has(who.id) || q.artist === who.id) return json(res, 400, { error: "Ответ не принят." });
      if (normText(text) === normText(q.truth)) return json(res, 400, { error: "Слишком похоже на правду — придумай ложь!" });
      q.lies.set(who.id, text); who.p.done = true;
      if (room.players.every(p => p.done)) advance(room); else push(room);
      return json(res, 200, { ok: true });
    }
    if (route === "pick" && room.phase === "pick" && (who.role === "player" || who.role === "audience")) {
      const q = room.matchups[room.cur], k = Number(body.k);
      if (!q.options[k] || q.options[k].authors.includes(who.id) || q.artist === who.id) return json(res, 400, { error: "Выбор не принят." });
      q.picks.set(who.id, k);
      if (room.audience.size === 0 && room.players.every(p => p.id === q.artist || q.picks.has(p.id))) advance(room); else push(room);
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
    if (route === "skip") { if (["answering", "drawing", "lie", "pick", "voting", "reveal", "roundScores"].includes(room.phase)) advance(room); return json(res, 200, { ok: true }); }
    if (route === "kick" && room.phase === "lobby") { room.players = room.players.filter(p => p.id !== body.id); push(room); return json(res, 200, { ok: true }); }
    if (route === "restart" && room.phase === "final") {
      room.players.forEach(p => { p.score = 0; p.done = false; p.st = { votes: 0, wins: 0, truths: 0, fooled: 0, crush: 0, art: 0 }; }); room.round = 0; room.matchups = []; room.cur = -1; setPhase(room, "lobby", 0); return json(res, 200, { ok: true });
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
