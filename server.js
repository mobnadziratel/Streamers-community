const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { handleParty } = require("./party");
const WebSocket = require("ws");

const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const PUBLIC_DIR = path.join(__dirname, "public");
const jackboxTickets = new Map();
function createMutex() {
  let tail = Promise.resolve();
  return { acquire() { let release; const next = new Promise(resolve => { release = resolve; }); const previous = tail; tail = tail.then(() => next); return previous.then(() => release); } };
}
const communityMutex = createMutex();
const jackboxRoomChecks = new Map();

const LOGINS = [
  "kolplayyyyy",
  "kyper0kk",
  "alma3uk7",
  "niavii_",
  "tanggens",
  "naktri",
  "artemillen",
  "refferency",
  "milseechka",
  "naomio404",
  "prosto_debzik",
  "q1yuqva",
  "shatlman_",
  "gileness",
  "bambaleila45",
  "arollelay",
  "maestroveniamin",
  "kinaroff",
  "skybinka",
  "artempencil",
  "yatomal",
  "omchaaa",
  "nef0rb0y",
  "so0olnce",
  "yura_reilly",
  "hak1den",
  "reppka_",
  "tostik_ilya",
  "vanaya_sigma",
  "tanaka_mangaca",
  "knaz_52",
  "mob_nadziratel",
  "d1unizi",
  "plovecmolodec",
  "charakoi",
  "kerik232tv",
  "ribafyga",
  "mrbatosh",
  "roman16rus",
  "rueumur",
  "cherrys_fox",
  "hdr_straiker",
  "kostyan_321r",
  "say_valyush",
  "sayjos",
  "lo4kalove",
  "slavabraze",
  "zavryz1el",
  "ilyuhalakee",
  "brill1antt",
  "helgard_simbirskiy",
  "pickachu2281",
  "zane5k5",
  "dima26rx1",
  "ishak_kodolov",
  "mandarin555q",
  "z3kat",
  "ssh1nxx",
  "homka20_",
  "medverina",
  "ne_twig",
  "screada67",
  "alicefagg",
  "uman_kind",
  "ugucyugaha",
  "ivi_owl"
];

let token = null;
let tokenExpiresAt = 0;
let cachedStreams = {};
let cacheExpiresAt = 0;
let refreshInFlight = null;
let twitchDiagnosticsCache = null;
let twitchDiagnosticsExpiresAt = 0;
let twitchDiagnosticsInFlight = null;
const chatColorsCache = new Map();
const chatColorsInFlight = new Map();

async function getTwitchDiagnostics() {
  if (twitchDiagnosticsCache && Date.now() < twitchDiagnosticsExpiresAt) return twitchDiagnosticsCache;
  if (twitchDiagnosticsInFlight) return twitchDiagnosticsInFlight;
  twitchDiagnosticsInFlight = (async () => {
    const report = {
      checkedAt: new Date().toISOString(),
      environment: {
        clientIdConfigured: Boolean(CLIENT_ID),
        clientSecretConfigured: Boolean(CLIENT_SECRET)
      },
      authentication: { ok: false },
      userLookup: { ok: false, found: false },
      streamByLogin: { ok: false, isLive: false },
      streamByUserId: { ok: false, isLive: false }
    };
    if (!CLIENT_ID || !CLIENT_SECRET) {
      report.authentication.error = "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in Render Environment.";
      return report;
    }
    let accessToken;
    try {
      accessToken = await getAppToken();
      report.authentication = { ok: true };
    } catch (error) {
      report.authentication = { ok: false, error: error.message };
      return report;
    }

    async function queryHelix(endpoint, params) {
      try {
        const response = await fetch(`https://api.twitch.tv/helix/${endpoint}?${params}`, {
          headers: { "Client-Id": CLIENT_ID, "Authorization": `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) return { ok: false, status: response.status };
        return { ok: true, data: await response.json() };
      } catch (error) {
        return { ok: false, error: error.name === "TimeoutError" ? "Request timed out" : error.message };
      }
    }

    const userResult = await queryHelix("users", new URLSearchParams({ login: "z3kat" }));
    report.userLookup.ok = userResult.ok;
    if (!userResult.ok) {
      Object.assign(report.userLookup, { status: userResult.status, error: userResult.error });
      return report;
    }
    const user = (userResult.data.data || [])[0];
    report.userLookup.found = Boolean(user);
    if (!user) return report;
    report.userLookup.login = user.login;
    report.userLookup.displayName = user.display_name;
    report.userLookup.userId = user.id;

    const byLogin = await queryHelix("streams", new URLSearchParams({ user_login: String(user.login || "z3kat").toLowerCase() }));
    report.streamByLogin.ok = byLogin.ok;
    if (!byLogin.ok) Object.assign(report.streamByLogin, { status: byLogin.status, error: byLogin.error });
    else {
      const stream = (byLogin.data.data || [])[0];
      report.streamByLogin.isLive = Boolean(stream);
      if (stream) Object.assign(report.streamByLogin, { title: stream.title, viewerCount: Number(stream.viewer_count || 0) });
    }

    const byId = await queryHelix("streams", new URLSearchParams({ user_id: String(user.id) }));
    report.streamByUserId.ok = byId.ok;
    if (!byId.ok) Object.assign(report.streamByUserId, { status: byId.status, error: byId.error });
    else {
      const stream = (byId.data.data || [])[0];
      report.streamByUserId.isLive = Boolean(stream);
      if (stream) Object.assign(report.streamByUserId, { title: stream.title, viewerCount: Number(stream.viewer_count || 0) });
    }
    return report;
  })().then(report => {
    twitchDiagnosticsCache = report;
    twitchDiagnosticsExpiresAt = Date.now() + 30_000;
    return report;
  }).finally(() => { twitchDiagnosticsInFlight = null; });
  return twitchDiagnosticsInFlight;
}

async function getAppToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials"
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Twitch token request failed (${response.status})`);
  const data = await response.json();
  token = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return token;
}

async function fetchStreams() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment.");
  }
  const accessToken = await getAppToken();
  const params = new URLSearchParams();
  LOGINS.forEach(login => params.append("user_login", login));
  const response = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
    headers: {
      "Client-Id": CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    if (response.status === 401) {
      token = null;
      tokenExpiresAt = 0;
    }
    throw new Error(`Twitch streams request failed (${response.status})`);
  }
  const data = await response.json();
  const result = {};
  LOGINS.forEach(login => {
    result[login] = { isLive: false, viewerCount: null, title: null };
  });
  (data.data || []).forEach(stream => {
    const login = String(stream.user_login || "").toLowerCase();
    if (result[login]) {
      result[login] = {
        isLive: true,
        viewerCount: Number(stream.viewer_count || 0),
        title: String(stream.title || ""),
        startedAt: String(stream.started_at || "")
      };
    }
  });

  // Focused fallback for Z3KAT. Resolve the canonical Twitch user first, then
  // verify the stream by both login and stable user ID. A missing stream entry
  // in Helix means offline; a failed lookup is logged and never treated as proof.
  if (!result.z3kat?.isLive) {
    try {
      const userParams = new URLSearchParams({ login: "z3kat" });
      const userResponse = await fetch(`https://api.twitch.tv/helix/users?${userParams}`, {
        headers: { "Client-Id": CLIENT_ID, "Authorization": `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!userResponse.ok) throw new Error(`users lookup HTTP ${userResponse.status}`);
      const userData = await userResponse.json();
      const twitchUser = (userData.data || [])[0];

      if (!twitchUser) {
        console.warn("Twitch users lookup did not resolve login z3kat; check whether the channel username changed.");
      } else {
        const canonicalLogin = String(twitchUser.login || "z3kat").toLowerCase();
        const singleQueries = [
          { label: "login", params: new URLSearchParams({ user_login: canonicalLogin }) },
          { label: "user_id", params: new URLSearchParams({ user_id: String(twitchUser.id) }) }
        ];
        for (const query of singleQueries) {
          const singleResponse = await fetch(`https://api.twitch.tv/helix/streams?${query.params}`, {
            headers: { "Client-Id": CLIENT_ID, "Authorization": `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8000)
          });
          if (!singleResponse.ok) {
            console.error(`Focused Z3KAT ${query.label} lookup failed (HTTP ${singleResponse.status})`);
            continue;
          }
          const singleData = await singleResponse.json();
          const stream = (singleData.data || []).find(item =>
            String(item.user_id || "") === String(twitchUser.id) ||
            String(item.user_login || "").toLowerCase() === canonicalLogin
          );
          if (stream) {
            result.z3kat = {
              isLive: true,
              viewerCount: Number(stream.viewer_count || 0),
              title: String(stream.title || ""),
              startedAt: String(stream.started_at || ""),
              userLogin: canonicalLogin
            };
            break;
          }
        }
        if (!result.z3kat?.isLive) {
          console.info(`Twitch confirms no live stream for Z3KAT (${canonicalLogin}, user id ${twitchUser.id}) at ${new Date().toISOString()}.`);
        }
      }
    } catch (error) {
      // Do not silently assume that a failed fallback means the channel is offline.
      console.error(`Focused Z3KAT status lookup failed: ${error.message}`);
    }
  }

  cachedStreams = result;
  cacheExpiresAt = Date.now() + 30_000;
  return result;
}

let collabCache = {};
let collabCacheAt = 0;
async function getCollaborations() {
  if (Date.now() - collabCacheAt < 60000) return collabCache;
  const live = await getStreams();
  const logins = LOGINS.filter(login => live[login] && live[login].isLive);
  if (!logins.length) { collabCache = {}; collabCacheAt = Date.now(); return collabCache; }
  const params = new URLSearchParams();
  LOGINS.forEach(login => params.append("login", login));
  const userData = await helix("users", params);
  const users = userData.data || [];
  const byLogin = new Map(users.map(user => [String(user.login).toLowerCase(), user]));
  const byId = new Map(users.map(user => [String(user.id), user]));
  const result = {};
  await Promise.all(logins.map(async login => {
    const user = byLogin.get(login);
    if (!user) return;
    try {
      const data = await helix("shared_chat/session", new URLSearchParams({ broadcaster_id: String(user.id) }));
      const session = (data.data || [])[0];
      if (!session || !Array.isArray(session.participants) || session.participants.length < 2) return;
      const ids = session.participants.map(p => String(p.broadcaster_id));
      const missing = ids.filter(id => !byId.has(id));
      if (missing.length) {
        const extraParams = new URLSearchParams();
        missing.forEach(id => extraParams.append("id", id));
        const extra = await helix("users", extraParams);
        (extra.data || []).forEach(u => byId.set(String(u.id), u));
      }
      const participants = ids.map(id => byId.get(id)).filter(Boolean).map(u => ({ login: String(u.login).toLowerCase(), displayName: String(u.display_name || u.login) }));
      if (participants.length > 1) result[login] = { participants: participants.filter(p => p.login !== login) };
    } catch (error) {
      console.warn("Twitch shared-chat lookup failed for " + login + ": " + error.message);
    }
  }));
  collabCache = result;
  collabCacheAt = Date.now();
  return result;
}

let streamsFetchedAt = 0, streamsFailUntil = 0, streamsLastError = null;
async function getStreams() {
  if (Date.now() < cacheExpiresAt) return cachedStreams;
  if (Date.now() < streamsFailUntil && !streamsFetchedAt) throw streamsLastError;
  if (!refreshInFlight) {
    refreshInFlight = fetchStreams().then(result => { streamsFetchedAt = Date.now(); streamsFailUntil = 0; return result; }).catch(error => {
      // Сбой Twitch: отдаём последние известные данные и повторяем попытку не чаще раза в 15 секунд.
      console.error("Twitch streams refresh failed:", error.message);
      cacheExpiresAt = Date.now() + 15_000;
      if (streamsFetchedAt) return cachedStreams;
      streamsFailUntil = Date.now() + 10_000; streamsLastError = error;
      throw error;
    }).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}


let clipsCache = new Map();
const avatarCache = new Map();
const followerCountCache = new Map();
const followerCountInFlight = new Map();
async function helix(pathname, params) {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in Render environment.");
  const accessToken = await getAppToken();
  const response = await fetch(`https://api.twitch.tv/helix/${pathname}?${params.toString()}`, {
    headers: { "Client-Id": CLIENT_ID, "Authorization": `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    if (response.status === 401) { token = null; tokenExpiresAt = 0; }
    throw new Error(`Twitch ${pathname} request failed (${response.status})`);
  }
  return response.json();
}
// ── Расписание Twitch и «когда был последний стрим» (кэш 10 минут) ──
let scheduleCache = null, scheduleCacheAt = 0, scheduleInFlight = null, scheduleFailUntil = 0;
const parseTwitchDuration = value => {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(value || ""));
  return m ? (((+m[1] || 0) * 3600) + ((+m[2] || 0) * 60) + (+m[3] || 0)) * 1000 : 0;
};
async function fetchSchedules() {
  const params = new URLSearchParams();
  LOGINS.forEach(login => params.append("login", login));
  const users = (await helix("users", params)).data || [];
  const result = {}, queue = users.map(u => [String(u.login).toLowerCase(), u.id]);
  const worker = async () => {
    while (queue.length) {
      const [login, id] = queue.shift();
      const entry = { lastStreamAt: null, nextStream: null, onVacation: false };
      const [videos, schedule] = await Promise.allSettled([
        helix("videos", new URLSearchParams({ user_id: id, type: "archive", first: "1" })),
        helix("schedule", new URLSearchParams({ broadcaster_id: id, first: "8" }))
      ]);
      if (videos.status === "fulfilled") {
        const video = (videos.value.data || [])[0], started = video && Date.parse(video.created_at);
        if (Number.isFinite(started)) entry.lastStreamAt = new Date(started + parseTwitchDuration(video.duration)).toISOString();
      }
      if (schedule.status === "fulfilled") {
        const data = schedule.value.data || {}, now = Date.now();
        const vacation = data.vacation && Date.parse(data.vacation.start_time) <= now && now < Date.parse(data.vacation.end_time);
        entry.onVacation = Boolean(vacation);
        const upcoming = (data.segments || []).filter(seg => !seg.canceled_until && Date.parse(seg.start_time) > now).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))[0];
        if (upcoming && !vacation) entry.nextStream = { startTime: upcoming.start_time, endTime: upcoming.end_time || null, title: upcoming.title || "", category: upcoming.category ? upcoming.category.name : "" };
      }
      result[login] = entry; // 404 «расписания нет» — обычная ситуация, не ошибка
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return result;
}
async function getSchedules() {
  if (scheduleCache && Date.now() - scheduleCacheAt < 10 * 60_000) return scheduleCache;
  if (Date.now() < scheduleFailUntil && !scheduleCache) throw new Error("schedule temporarily unavailable");
  if (!scheduleInFlight) {
    scheduleInFlight = fetchSchedules().then(result => { scheduleCache = result; scheduleCacheAt = Date.now(); return result; }).catch(error => {
      console.error("Twitch schedules refresh failed:", error.message);
      scheduleFailUntil = Date.now() + 60_000;
      if (scheduleCache) { scheduleCacheAt = Date.now() - 9 * 60_000; return scheduleCache; } // старые данные, повтор через минуту
      throw error;
    }).finally(() => { scheduleInFlight = null; });
  }
  return scheduleInFlight;
}
async function fetchFollowerCount(login) {
  const now = Date.now();
  const cached = followerCountCache.get(login);
  if (cached && now - cached.fetchedAt < 2 * 60_000) return cached.result;
  if (followerCountInFlight.has(login)) return followerCountInFlight.get(login);

  const request = (async () => {
    const response = await fetch(`https://decapi.me/twitch/followcount/${encodeURIComponent(login)}`, {
      headers: { "Accept": "text/plain", "User-Agent": "SmallStreamersDirectory/1.0" },
      signal: AbortSignal.timeout(8000)
    });
    const raw = (await response.text()).trim();
    // DecAPI returns the public follower total as plain text. Reject error messages rather than displaying them as counts.
    const normalized = raw.replace(/[\s,]/g, "");
    if (!response.ok || !/^\d+$/.test(normalized)) {
      throw new Error(`Follower count provider returned an invalid response (${response.status})`);
    }
    const total = Number(normalized);
    const result = { login, total, updatedAt: new Date().toISOString() };
    followerCountCache.set(login, { result, fetchedAt: Date.now() });
    return result;
  })().finally(() => followerCountInFlight.delete(login));

  followerCountInFlight.set(login, request);
  return request;
}
async function fetchClips(period) {
  const now = Date.now();
  const cacheKey = period;
  const cached = clipsCache.get(cacheKey);
  if (cached && now - cached.time < 5 * 60_000) return cached.clips;

  const userParams = new URLSearchParams();
  LOGINS.forEach(login => userParams.append("login", login));
  const usersPayload = await helix("users", userParams);
  const users = usersPayload.data || [];
  if (!users.length) throw new Error("Twitch API не вернул ни одного канала для списка клипов.");

  const hoursByPeriod = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "365d": 24 * 365 };
  const cutoffHours = hoursByPeriod[period] || 0;
  const endedAt = new Date(now).toISOString();
  const startedAt = cutoffHours ? new Date(now - cutoffHours * 60 * 60 * 1000).toISOString() : null;
  const queue = users.slice();
  const all = [];
  let failedChannels = 0;

  // Limit each channel to one page per refresh. The browser renders results in
  // small batches, so returning thousands of cards at once is unnecessary.
  async function worker() {
    while (queue.length) {
      const user = queue.shift();
      let cursor = null;
      for (let page = 0; page < 1; page++) {
        const params = new URLSearchParams({ broadcaster_id: user.id, first: "100" });
        if (startedAt) {
          params.set("started_at", startedAt);
          params.set("ended_at", endedAt);
        }
        if (cursor) params.set("after", cursor);
        try {
          const payload = await helix("clips", params);
          const pageClips = payload.data || [];
          all.push(...pageClips);
          cursor = payload.pagination && payload.pagination.cursor;
          if (!cursor || pageClips.length === 0) break;
        } catch (error) {
          failedChannels++;
          console.error(`Could not load clips for ${user.login}: ${error.message}`);
          break;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  if (!all.length && failedChannels > 0) {
    throw new Error(`Twitch не вернул клипы: запросы к каналам завершились ошибкой (${failedChannels} неудачных запросов).`);
  }
  const clips = all.map(clip => ({
    id: clip.id,
    url: clip.url,
    title: clip.title,
    viewCount: Number(clip.view_count || 0),
    createdAt: clip.created_at,
    thumbnailUrl: clip.thumbnail_url,
    broadcasterName: clip.broadcaster_name,
    broadcasterLogin: clip.broadcaster_login || clip.broadcaster_name,
    creatorName: clip.creator_name || "",
    creatorLogin: clip.creator_name || ""
  }));
  clipsCache.set(cacheKey, { time: now, clips });
  return clips;
}



// ───────────────────────────── Music queue API ─────────────────────────────
// Все операции с очередью выполняются строго по одной (mutex): раньше два одновременных запроса
// (например, «трек закончился» из OBS и «пропустить» из дока) читали одно и то же состояние и
// затирали изменения друг друга.
const MUSIC_DATA_DIR = process.env.WALL_DATA_DIR || path.join(__dirname, "data");
const MUSIC_FILE = path.join(MUSIC_DATA_DIR, "music-queue.json");
const MUSIC_R2_KEY = process.env.MUSIC_R2_OBJECT_KEY || "music-queue.json";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_ENABLED = Boolean(R2_ACCOUNT_ID && R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
const musicR2 = R2_ENABLED ? new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || ("https://" + R2_ACCOUNT_ID + ".r2.cloudflarestorage.com"),
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;

const MUSIC_ACTIVE = ["pending", "playing"];
const MUSIC_QUEUE_LIMIT = 50;
const musicSessions = new Map();     // sessionId -> { channel, expiresAt, via?, displayName? }
// Вход в музыкальный пульт через приложение Twitch (OAuth). Нужны TWITCH_CLIENT_ID/SECRET и адрес возврата
// TWITCH_MUSIC_REDIRECT_URI (по умолчанию <сайт>/api/music/twitch/callback), добавленный в настройках Twitch-приложения.
// MUSIC_TWITCH_ALLOWED — необязательный список каналов через запятую, которым разрешён вход (пусто = любой стример).
const musicTwitchStates = new Map(); // state -> { expiresAt }
const TWITCH_ID_BASE = String(process.env.TWITCH_ID_BASE || "https://id.twitch.tv").replace(/\/$/, "");
const TWITCH_HELIX_BASE = String(process.env.TWITCH_HELIX_BASE || "https://api.twitch.tv/helix").replace(/\/$/, "");
const musicTwitchAvailable = () => Boolean(CLIENT_ID && CLIENT_SECRET);
const musicTwitchAllowed = () => String(process.env.MUSIC_TWITCH_ALLOWED || "").split(",").map(v => v.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
const musicRequestRate = new Map();  // ip -> [timestamps]
const musicChatRequestRate = new Map(); // channel:nickname -> [timestamps]
const musicChatCooldown = new Map(); // channel:nickname -> last request timestamp
const musicLoginRate = new Map();    // ip -> [timestamps]
const communityLoginRate = new Map();
const musicMetaCache = new Map();    // videoId -> { meta, at }
let musicChain = Promise.resolve();
let musicDbCache = null, musicDbCacheAt = 0, musicMigrated = false;

function withMusicLock(task) {
  const run = musicChain.then(task);
  musicChain = run.then(() => {}, () => {});
  return run;
}
const musicClean = (value, max) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const musicChannel = value => {
  const s = musicClean(value, 25).replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(s) ? s : "";
};
const byCreatedAt = (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
const isHttps = req => Boolean(req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const clientIp = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
function takeRateSlot(store, ip, limit, windowMs) {
  const now = Date.now();
  const recent = (store.get(ip) || []).filter(t => now - t < windowMs);
  if (recent.length >= limit) { store.set(ip, recent); return false; }
  recent.push(now); store.set(ip, recent);
  return true;
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && require("node:crypto").timingSafeEqual(ba, bb);
}

async function readJsonBody(req, limit = 20480) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Запрос слишком большой."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
  catch { throw Object.assign(new Error("Некорректный JSON."), { statusCode: 400 }); }
}
async function streamToString(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
const normalizeMusicDb = d => ({
  ...(d && typeof d === "object" ? d : {}),
  items: Array.isArray(d && d.items) ? d.items.filter(x => x && typeof x === "object") : [],
  playback: d && d.playback && typeof d.playback === "object" ? d.playback : {}
});
async function musicReadLocal() {
  await fs.promises.mkdir(MUSIC_DATA_DIR, { recursive: true });
  try { return normalizeMusicDb(JSON.parse(await fs.promises.readFile(MUSIC_FILE, "utf8"))); }
  catch (e) { if (e.code === "ENOENT") return normalizeMusicDb({}); throw e; }
}
async function musicSaveStorage(db) {
  const data = JSON.stringify(db, null, 2);
  if (R2_ENABLED) { await musicR2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: MUSIC_R2_KEY, Body: data, ContentType: "application/json" })); return; }
  await fs.promises.mkdir(MUSIC_DATA_DIR, { recursive: true });
  const tmp = MUSIC_FILE + ".tmp";
  await fs.promises.writeFile(tmp, data, { mode: 0o600 });
  await fs.promises.rename(tmp, MUSIC_FILE);
}
async function musicReadStorage() {
  if (!R2_ENABLED) return musicReadLocal();
  let shared;
  try {
    const object = await musicR2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: MUSIC_R2_KEY }));
    shared = normalizeMusicDb(JSON.parse(await streamToString(object.Body)));
  } catch (e) {
    if (e.name === "NoSuchKey" || e.Code === "NoSuchKey" || (e.$metadata && e.$metadata.httpStatusCode === 404)) shared = normalizeMusicDb({});
    else throw new Error("Не удалось прочитать очередь музыки.");
  }
  // Одноразовая миграция старого локального файла в R2 (раньше выполнялась при КАЖДОМ чтении).
  if (!musicMigrated) {
    const local = await musicReadLocal();
    const known = new Set(shared.items.filter(x => x.id).map(x => String(x.id)));
    const missing = local.items.filter(x => x.id && !known.has(String(x.id)));
    if (missing.length) { shared.items.push(...missing); await musicSaveStorage(shared); }
    musicMigrated = true;
  }
  return shared;
}
async function musicLoad() {
  if (musicDbCache && Date.now() - musicDbCacheAt < 1500) return musicDbCache;
  musicDbCache = await musicReadStorage();
  musicDbCacheAt = Date.now();
  return musicDbCache;
}
async function musicSave(db) {
  musicDbCache = null;            // при ошибке записи кэш не должен хранить несохранённое состояние
  await musicSaveStorage(db);
  musicDbCache = db; musicDbCacheAt = Date.now();
}
const musicActiveItems = (db, ch) => db.items.filter(x => x.channel === ch && MUSIC_ACTIVE.includes(x.status)).sort(byCreatedAt);
function musicSetPlayback(db, ch, patch) {
  db.playback = db.playback && typeof db.playback === "object" ? db.playback : {};
  db.playback[ch] = { ...(db.playback[ch] || {}), ...patch, updatedAt: new Date().toISOString() };
  return db.playback[ch];
}
// Гарантирует: «играет» максимум один трек; при promote — запускает следующий, если ничего не играет.
function musicNormalize(db, ch, promoteIfEmpty = false) {
  let changed = false;
  const active = musicActiveItems(db, ch), playing = active.filter(x => x.status === "playing");
  for (const duplicate of playing.slice(1)) { duplicate.status = "pending"; changed = true; }
  if (promoteIfEmpty && playing.length === 0) {
    const next = active.find(x => x.status === "pending");
    if (next) { next.status = "playing"; changed = true; musicSetPlayback(db, ch, { trackId: next.id, paused: false, visible: true }); }
  }
  return changed;
}
// Состояние плеера привязано к конкретному треку; при смене трека пауза сбрасывается.
function musicPlaybackFor(db, ch, current) {
  db.playback = db.playback && typeof db.playback === "object" ? db.playback : {};
  const state = db.playback[ch], id = current ? current.id : null;
  if (!state || state.trackId !== id) return { state: musicSetPlayback(db, ch, { trackId: id, paused: false, visible: true }), changed: true };
  return { state, changed: false };
}
const musicPublicItem = ({ id, channel, nickname, videoId, url, title, status, createdAt }) => ({ id, channel, nickname, videoId, url, title, status, createdAt });

// ───────────── Фоновая музыка (плейлист, который играет, пока нет заказов) ─────────────
// Хранится рядом с очередью в том же JSON: db.bg[канал]. Проигрывает его сам плеер (оверлей/док):
// заказ прерывает фон, после заказа фон продолжается с того же места — это решает плеер, а сервер
// лишь хранит списки и настройки и отдаёт их вместе с состоянием очереди.
const BG_LIST_LIMIT = 10, BG_VIDEO_LIMIT = 100, BG_ADD_PER_CALL = 15;
const bgDefaults = () => ({ enabled: false, paused: false, shuffle: false, showVideo: false, volume: 60, activeId: "", skipSeq: 0, lists: [] });
function bgNormalize(raw) {
  const b = { ...bgDefaults(), ...(raw && typeof raw === "object" ? raw : {}) };
  b.lists = (Array.isArray(b.lists) ? b.lists : []).filter(l => l && typeof l === "object" && l.id).map(l => ({
    id: String(l.id), name: musicClean(l.name, 60) || "Плейлист", type: l.type === "youtube" ? "youtube" : "custom",
    playlistId: l.type === "youtube" ? String(l.playlistId || "") : "", rev: Number(l.rev) || 1, createdAt: l.createdAt || "",
    videos: l.type === "youtube" ? [] : (Array.isArray(l.videos) ? l.videos : []).filter(v => v && /^[A-Za-z0-9_-]{11}$/.test(String(v.videoId || ""))).map(v => ({ id: String(v.id || v.videoId), videoId: String(v.videoId), title: musicClean(v.title, 120) }))
  }));
  b.volume = Math.max(0, Math.min(100, Math.round(Number(b.volume))));
  if (!Number.isFinite(b.volume)) b.volume = 60;
  b.enabled = Boolean(b.enabled); b.paused = Boolean(b.paused); b.shuffle = Boolean(b.shuffle); b.showVideo = Boolean(b.showVideo);
  b.skipSeq = Number(b.skipSeq) || 0;
  if (!b.lists.some(l => l.id === b.activeId)) b.activeId = b.lists[0] ? b.lists[0].id : "";
  return b;
}
function bgGet(db, ch) {            // для записи: создаёт запись канала
  db.bg = db.bg && typeof db.bg === "object" ? db.bg : {};
  db.bg[ch] = bgNormalize(db.bg[ch]);
  return db.bg[ch];
}
const bgPeek = (db, ch) => bgNormalize(db.bg && db.bg[ch]);   // для чтения: ничего не меняет
const bgActive = b => b.lists.find(l => l.id === b.activeId) || null;
// Компактное состояние, которое уходит оверлею и доку с каждым опросом очереди.
function bgOverlay(db, ch) {
  const b = bgPeek(db, ch), a = bgActive(b);
  const usable = Boolean(a && (a.type === "youtube" ? a.playlistId : a.videos.length));
  return {
    enabled: b.enabled && usable, paused: b.paused, shuffle: b.shuffle, showVideo: b.showVideo, volume: b.volume, skipSeq: b.skipSeq,
    active: usable ? { key: a.id + ":" + a.rev, name: a.name, type: a.type, playlistId: a.playlistId, videoIds: a.videos.map(v => v.videoId) } : null
  };
}
// Полное состояние для панели управления стримера.
function bgFull(db, ch) {
  const b = bgPeek(db, ch);
  return { enabled: b.enabled, paused: b.paused, shuffle: b.shuffle, showVideo: b.showVideo, volume: b.volume, skipSeq: b.skipSeq, activeId: b.activeId,
    limits: { lists: BG_LIST_LIMIT, videos: BG_VIDEO_LIMIT },
    lists: b.lists.map(l => ({ id: l.id, name: l.name, type: l.type, playlistId: l.playlistId, rev: l.rev, count: l.videos.length, videos: l.videos })) };
}
function parseYouTubePlaylistId(raw) {
  try {
    const u = new URL(musicClean(raw, 500));
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    if (!["youtube.com", "music.youtube.com"].includes(host)) return "";
    const id = u.searchParams.get("list") || "";
    return /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : "";
  } catch (_) { return ""; }
}
// Проверка плейлиста через oEmbed (так же, как и для видео): отсекает несуществующие и закрытые.
async function youtubePlaylistLookup(playlistId) {
  const key = "pl:" + playlistId, cached = musicMetaCache.get(key);
  if (cached && Date.now() - cached.at < 3600000) return cached.result;
  let result;
  try {
    const response = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent("https://www.youtube.com/playlist?list=" + playlistId) + "&format=json", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (response.status === 404) result = { status: "missing" };
    else if (response.status === 401 || response.status === 403) result = { status: "blocked" };
    else if (!response.ok) result = { status: "unknown" };
    else { const meta = await response.json(); result = { status: "ok", title: musicClean(meta.title, 60) }; }
  } catch (_) { result = { status: "unknown" }; }
  if (result.status !== "unknown") musicMetaCache.set(key, { result, at: Date.now() });
  return result;
}
async function handleBgAdmin(req, res, json, isAdmin, session) {
  const body = await readJsonBody(req, 30000);
  if (!isAdmin) return json(401, { error: "Войди как стример, чтобы управлять фоновой музыкой." });
  const ch = musicChannel(body.channel), op = musicClean(body.op, 20);
  if (!ch) return json(400, { error: "Укажи корректный Twitch-канал." });
  if (session.channel !== ch) return json(403, { error: "Этот вход разрешён только для канала " + session.channel + "." });
  // Запросы к YouTube делаем ДО блокировки очереди, чтобы медленный ответ не задерживал заказы.
  let prepared = null;
  if (op === "add") {
    const rawUrls = (Array.isArray(body.urls) ? body.urls : [body.url]).map(u => String(u || "")).filter(Boolean).slice(0, 60);
    const ids = [];
    for (const u of rawUrls) { const vid = parseYouTubeId(u); if (vid && !ids.includes(vid)) ids.push(vid); if (ids.length >= BG_ADD_PER_CALL) break; }
    if (!ids.length) return json(400, { error: "Вставь корректные ссылки на видео YouTube." });
    const infos = await Promise.all(ids.map(vid => youtubeLookup(vid)));
    prepared = ids.map((vid, i) => ({ vid, info: infos[i] }));
  } else if (op === "import") {
    const playlistId = parseYouTubePlaylistId(body.url);
    if (!playlistId) return json(400, { error: "Вставь ссылку на плейлист YouTube — в адресе должно быть list=…" });
    if (/^(RD|LL|WL|FL)/.test(playlistId)) return json(422, { error: "Миксы, «Смотреть позже» и «Понравившиеся» встроить нельзя. Используй обычный публичный плейлист." });
    const info = await youtubePlaylistLookup(playlistId);
    if (info.status === "missing") return json(404, { error: "Плейлист не найден или удалён." });
    if (info.status === "blocked") return json(422, { error: "Плейлист закрыт. Сделай его публичным или доступным по ссылке." });
    prepared = { playlistId, info };
  }
  return await withMusicLock(async () => {
    try {
      const db = await musicLoad();
      const b = bgGet(db, ch);
      const list = body.listId ? b.lists.find(l => l.id === musicClean(body.listId, 80)) : null;
      const needList = () => { if (!list) throw Object.assign(new Error("Плейлист не найден."), { statusCode: 404 }); return list; };
      let message = "Сохранено.";
      if (op === "create") {
        const name = musicClean(body.name, 40);
        if (name.length < 2) throw Object.assign(new Error("Название плейлиста — от 2 до 40 символов."), { statusCode: 400 });
        if (b.lists.length >= BG_LIST_LIMIT) throw Object.assign(new Error("Можно создать не больше " + BG_LIST_LIMIT + " плейлистов."), { statusCode: 429 });
        const created = { id: require("node:crypto").randomUUID(), name, type: "custom", playlistId: "", rev: 1, createdAt: new Date().toISOString(), videos: [] };
        b.lists.push(created); if (!b.activeId) b.activeId = created.id;
        message = "Плейлист создан. Добавь в него видео.";
      } else if (op === "import") {
        if (b.lists.length >= BG_LIST_LIMIT) throw Object.assign(new Error("Можно сохранить не больше " + BG_LIST_LIMIT + " плейлистов."), { statusCode: 429 });
        if (b.lists.some(l => l.playlistId === prepared.playlistId)) throw Object.assign(new Error("Этот плейлист уже добавлен."), { statusCode: 409 });
        const name = musicClean(body.name, 40) || musicClean(prepared.info.title, 40) || "Плейлист YouTube";
        const created = { id: require("node:crypto").randomUUID(), name, type: "youtube", playlistId: prepared.playlistId, rev: 1, createdAt: new Date().toISOString(), videos: [] };
        b.lists.push(created); if (!b.activeId) b.activeId = created.id;
        message = "Плейлист YouTube добавлен.";
      } else if (op === "add") {
        const l = needList();
        if (l.type !== "custom") throw Object.assign(new Error("Видео можно добавлять только в свой плейлист, а не в импортированный из YouTube."), { statusCode: 400 });
        let added = 0; const skipped = [];
        for (const { vid, info } of prepared) {
          if (info.status === "missing") { skipped.push("видео не найдено или закрыто"); continue; }
          if (info.status === "blocked") { skipped.push("автор запретил встраивание"); continue; }
          if (l.videos.some(v => v.videoId === vid)) { skipped.push("уже есть в плейлисте"); continue; }
          if (l.videos.length >= BG_VIDEO_LIMIT) { skipped.push("достигнут лимит " + BG_VIDEO_LIMIT + " видео"); break; }
          l.videos.push({ id: require("node:crypto").randomUUID(), videoId: vid, title: info.status === "ok" ? musicClean(info.title, 120) : "" });
          added++;
        }
        if (!added) throw Object.assign(new Error("Ничего не добавлено: " + (skipped[0] || "нет подходящих ссылок") + "."), { statusCode: 422 });
        l.rev++;
        message = "Добавлено: " + added + (skipped.length ? " · пропущено: " + skipped.length : "") + ".";
      } else if (op === "remove") {
        const l = needList(), itemId = musicClean(body.itemId, 80), before = l.videos.length;
        l.videos = l.videos.filter(v => v.id !== itemId);
        if (l.videos.length === before) throw Object.assign(new Error("Трек не найден."), { statusCode: 404 });
        l.rev++; message = "Трек удалён.";
      } else if (op === "clear") {
        const l = needList(); l.videos = []; l.rev++; message = "Плейлист очищен.";
      } else if (op === "rename") {
        const l = needList(), name = musicClean(body.name, 40);
        if (name.length < 2) throw Object.assign(new Error("Название плейлиста — от 2 до 40 символов."), { statusCode: 400 });
        l.name = name; message = "Название изменено.";
      } else if (op === "delete") {
        const l = needList(); b.lists = b.lists.filter(x => x.id !== l.id); message = "Плейлист удалён.";
      } else if (op === "select") {
        const l = needList(); b.activeId = l.id; b.skipSeq++; message = "Выбран плейлист «" + l.name + "».";
      } else if (op === "settings") {
        if (typeof body.enabled === "boolean") b.enabled = body.enabled;
        if (typeof body.paused === "boolean") b.paused = body.paused;
        if (typeof body.shuffle === "boolean") b.shuffle = body.shuffle;
        if (typeof body.showVideo === "boolean") b.showVideo = body.showVideo;
        if (body.volume !== undefined) { const v = Math.round(Number(body.volume)); if (Number.isFinite(v)) b.volume = Math.max(0, Math.min(100, v)); }
      } else if (op === "skip") {
        b.skipSeq++; message = "Переключаю фоновый трек.";
      } else throw Object.assign(new Error("Неизвестное действие."), { statusCode: 400 });
      db.bg[ch] = bgNormalize(b);
      await musicSave(db);
      return json(200, { ok: true, message, bg: bgFull(db, ch) });
    } catch (error) { musicDbCache = null; throw error; }
  });
}

function parseYouTubeId(raw) {
  try {
    const u = new URL(musicClean(raw, 500));
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    let vid = "";
    if (["youtube.com", "music.youtube.com"].includes(host) && u.pathname === "/watch") vid = u.searchParams.get("v") || "";
    else if (host === "youtu.be") vid = u.pathname.split("/").filter(Boolean)[0] || "";
    else if (["youtube.com", "music.youtube.com"].includes(host) && /^\/(?:shorts|embed|live)\/[^/]+/.test(u.pathname)) vid = u.pathname.split("/")[2] || "";
    return /^[A-Za-z0-9_-]{11}$/.test(vid) ? vid : "";
  } catch (_) { return ""; }
}
// Проверка ролика через oEmbed: отсекает удалённые, приватные и запрещённые для встраивания видео
// ещё при заказе — иначе такой трек «зависал» бы в очереди эфира.
async function youtubeLookup(videoId) {
  const cached = musicMetaCache.get(videoId);
  if (cached && Date.now() - cached.at < 3600000) return cached.result;
  let result;
  try {
    const response = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + videoId) + "&format=json", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (response.status === 404) result = { status: "missing" };
    else if (response.status === 401 || response.status === 403) result = { status: "blocked" };
    else if (!response.ok) result = { status: "unknown" };
    else {
      const meta = await response.json();
      result = { status: "ok", title: musicClean(meta.title, 200), author: musicClean(meta.author_name, 120), thumbnail: meta.thumbnail_url || ("https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg") };
    }
  } catch (_) { result = { status: "unknown" }; }
  if (result.status !== "unknown") {
    musicMetaCache.set(videoId, { result, at: Date.now() });
    if (musicMetaCache.size > 500) musicMetaCache.delete(musicMetaCache.keys().next().value);
  }
  return result;
}

async function handleMusicApi(req, res, url) {
  const method = req.method || "GET";
  const json = (status, payload, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(payload));
  };
  const cookieHeader = String(req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith("music_admin_session="));
  const sessionId = cookieHeader ? cookieHeader.slice("music_admin_session=".length) : "";
  const session = musicSessions.get(sessionId);
  const isAdmin = Boolean(session && session.expiresAt > Date.now());
  const cookieFlags = "; HttpOnly; SameSite=Strict; Path=/api/music" + (isHttps(req) ? "; Secure" : "");
  const route = url.pathname;

  try {
    // ── запросы без работы с очередью ──
    if (route === "/api/music/admin/session" && method === "GET") {
      if (!isAdmin) { if (sessionId) musicSessions.delete(sessionId); return json(200, { authenticated: false, twitch: musicTwitchAvailable() }); }
      return json(200, { authenticated: true, channel: session.channel, via: session.via || "password", displayName: session.displayName || session.channel, twitch: musicTwitchAvailable() });
    }
    if (route === "/api/music/metadata" && method === "GET") {
      const vid = String(url.searchParams.get("videoId") || "");
      if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) return json(400, { error: "Некорректный ID видео." });
      const info = await youtubeLookup(vid);
      if (info.status !== "ok") return json(info.status === "unknown" ? 502 : 404, { error: "Не удалось получить данные ролика." });
      return json(200, { videoId: vid, title: info.title, author: info.author, thumbnail: info.thumbnail }, { "Cache-Control": "public, max-age=3600" });
    }
    if (route === "/api/music/admin/login" && method === "POST") {
      if (!takeRateSlot(musicLoginRate, clientIp(req), 10, 10 * 60000)) return json(429, { error: "Слишком много попыток входа. Подожди 10 минут." });
      const body = await readJsonBody(req), ch = musicChannel(body.channel), password = String(body.password || "");
      if (!ch) return json(400, { error: "Укажи Twitch-канал для входа." });
      let credentials = {};
      try { credentials = JSON.parse(process.env.MUSIC_ADMIN_CREDENTIALS || "{}"); } catch (_) {}
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) credentials = {};
      const pair = Object.entries(credentials).find(([login]) => String(login).trim().replace(/^@/, "").toLowerCase() === ch);
      const expected = pair && typeof pair[1] === "string" ? pair[1] : "";
      if (!expected) return json(503, { error: "Для этого канала не настроен отдельный пароль в MUSIC_ADMIN_CREDENTIALS." });
      // Пробелы/переводы строк по краям (частая ошибка при копировании в переменную окружения или на телефоне) не считаются.
      if (!safeEqual(password.trim(), expected.trim())) {
        console.warn("Music login failed for channel " + ch + " (entered length " + password.trim().length + ", configured length " + expected.trim().length + ")");
        return json(401, { error: "Неверный пароль для этого канала. Проверь раскладку, заглавные буквы и пробелы в конце." });
      }
      const id = require("node:crypto").randomBytes(32).toString("hex");
      musicSessions.set(id, { channel: ch, expiresAt: Date.now() + 43200000 });
      return json(200, { ok: true, channel: ch }, { "Set-Cookie": "music_admin_session=" + id + cookieFlags + "; Max-Age=43200" });
    }
    if (route === "/api/music/admin/logout" && method === "POST") {
      if (sessionId) musicSessions.delete(sessionId);
      return json(200, { ok: true }, { "Set-Cookie": "music_admin_session=" + cookieFlags + "; Max-Age=0" });
    }

    // ── Вход через Twitch (OAuth) ──
    if (route === "/api/music/twitch/connect" && method === "GET") {
      const back = code => { res.writeHead(302, { Location: "/music-dock?settings=1&twitch_error=" + code, "Cache-Control": "no-store" }); res.end(); };
      if (!musicTwitchAvailable()) return back("not_configured");
      if (!takeRateSlot(musicLoginRate, clientIp(req), 10, 10 * 60000)) return back("rate");
      const state = require("node:crypto").randomBytes(24).toString("hex");
      musicTwitchStates.set(state, { expiresAt: Date.now() + 10 * 60000 });
      const redirectUri = String(process.env.TWITCH_MUSIC_REDIRECT_URI || ((isHttps(req) ? "https" : "http") + "://" + (req.headers.host || "localhost") + "/api/music/twitch/callback")).trim();
      const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "", state, force_verify: "true" });
      // state дополнительно привязываем к браузеру короткой cookie — защита от подмены входа.
      res.writeHead(302, { Location: TWITCH_ID_BASE + "/oauth2/authorize?" + q.toString(), "Cache-Control": "no-store",
        "Set-Cookie": "music_oauth_state=" + state + "; HttpOnly; SameSite=Lax; Path=/api/music" + (isHttps(req) ? "; Secure" : "") + "; Max-Age=600" });
      return res.end();
    }
    if (route === "/api/music/twitch/callback" && method === "GET") {
      const stateCookie = String(req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith("music_oauth_state="));
      const cookieState = stateCookie ? stateCookie.slice("music_oauth_state=".length) : "";
      const clearState = "music_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/music" + (isHttps(req) ? "; Secure" : "") + "; Max-Age=0";
      const back = code => { res.writeHead(302, { Location: "/music-dock?settings=1&twitch_error=" + code, "Cache-Control": "no-store", "Set-Cookie": clearState }); res.end(); };
      const state = String(url.searchParams.get("state") || ""), code = String(url.searchParams.get("code") || "");
      const saved = musicTwitchStates.get(state); musicTwitchStates.delete(state);
      if (url.searchParams.get("error")) return back("denied");
      if (!musicTwitchAvailable()) return back("not_configured");
      if (!saved || saved.expiresAt < Date.now() || !code || !cookieState || !safeEqual(cookieState, state)) return back("expired");
      const redirectUri = String(process.env.TWITCH_MUSIC_REDIRECT_URI || ((isHttps(req) ? "https" : "http") + "://" + (req.headers.host || "localhost") + "/api/music/twitch/callback")).trim();
      let accessToken = "", user = null;
      try {
        const tokenResponse = await fetch(TWITCH_ID_BASE + "/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: "authorization_code", redirect_uri: redirectUri }), signal: AbortSignal.timeout(12000) });
        const tokenData = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokenData.access_token) throw new Error("token " + tokenResponse.status);
        accessToken = tokenData.access_token;
        const me = await fetch(TWITCH_HELIX_BASE + "/users", { headers: { "Client-Id": CLIENT_ID, Authorization: "Bearer " + accessToken }, signal: AbortSignal.timeout(10000) });
        const meData = await me.json().catch(() => ({}));
        if (!me.ok) throw new Error("users " + me.status);
        user = (meData.data || [])[0] || null;
      } catch (error) {
        console.warn("Music Twitch login failed:", error.message);
        return back("failed");
      } finally {
        // Токен нужен только чтобы узнать, чей это аккаунт, — сразу отзываем и нигде не храним.
        if (accessToken) fetch(TWITCH_ID_BASE + "/oauth2/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, token: accessToken }), signal: AbortSignal.timeout(8000) }).catch(() => {});
      }
      const login = user ? String(user.login || "").toLowerCase() : "";
      if (!/^[a-z0-9_]{1,25}$/.test(login)) return back("failed");
      const allowed = musicTwitchAllowed();
      if (allowed.length && !allowed.includes(login)) return back("not_allowed");
      const id = require("node:crypto").randomBytes(32).toString("hex");
      musicSessions.set(id, { channel: login, expiresAt: Date.now() + 43200000, via: "twitch", displayName: String(user.display_name || login).slice(0, 40) });
      res.writeHead(302, { Location: "/music-dock?channel=" + encodeURIComponent(login), "Cache-Control": "no-store",
        "Set-Cookie": ["music_admin_session=" + id + cookieFlags + "; Max-Age=43200", clearState] });
      return res.end();
    }

    // Управление фоновым плейлистом: сам читает тело и ходит в YouTube до блокировки очереди.
    if (route === "/api/music/admin/bg" && method === "POST") return await handleBgAdmin(req, res, json, isAdmin, session);

    // Тело запроса читаем ДО блокировки, чтобы медленный клиент не держал очередь.
    const body = method === "POST" ? await readJsonBody(req) : {};

    return await withMusicLock(async () => {
      try {
        if (route === "/api/music/overlay/current" && method === "GET") {
          const ch = musicChannel(url.searchParams.get("channel"));
          if (!ch) return json(400, { error: "Укажи корректный логин канала." });
          const db = await musicLoad();
          let changed = musicNormalize(db, ch, true);
          const item = musicActiveItems(db, ch).find(x => x.status === "playing") || null;
          const sync = musicPlaybackFor(db, ch, item);
          if (changed || sync.changed) await musicSave(db);
          return json(200, { item: item ? musicPublicItem(item) : null, paused: Boolean(sync.state.paused), visible: item ? sync.state.visible !== false : false, bg: bgOverlay(db, ch) });
        }
        if (route === "/api/music/bg" && method === "GET") {
          const ch = musicChannel(url.searchParams.get("channel"));
          if (!ch) return json(400, { error: "Укажи корректный логин канала." });
          return json(200, { bg: bgFull(await musicLoad(), ch) });
        }
        if (route === "/api/music/queue" && method === "GET") {
          const ch = musicChannel(url.searchParams.get("channel"));
          if (!ch) return json(400, { error: "Укажи корректный логин канала." });
          if (!isAdmin) return json(401, { error: "Войди с паролем, чтобы просматривать очередь." });
          if (session.channel !== ch) return json(403, { error: "Эта очередь доступна только после входа в канал " + session.channel + "." });
          const db = await musicLoad();
          let changed = musicNormalize(db, ch, false);
          const items = musicActiveItems(db, ch);
          const history = db.items.filter(x => x.channel === ch && !MUSIC_ACTIVE.includes(x.status)).sort((a, b) => byCreatedAt(b, a)).slice(0, 100);
          const current = items.find(x => x.status === "playing") || null;
          const sync = musicPlaybackFor(db, ch, current);
          if (changed || sync.changed) await musicSave(db);
          return json(200, { items: items.map(musicPublicItem), history: history.map(musicPublicItem), paused: Boolean(sync.state.paused), visible: current ? sync.state.visible !== false : false, bg: bgOverlay(db, ch) });
        }
        if (route === "/api/music/request" && method === "POST") {
          const ch = musicChannel(body.channel), nick = musicClean(body.nickname, 32) || "Аноним";
          if (!ch) return json(400, { error: "Укажи корректный Twitch-канал." });
          let chatRequester = "";
          if (body.source === "chat") {
            chatRequester = ch + ":" + nick.toLowerCase();
            const last = musicChatCooldown.get(chatRequester) || 0;
            if (Date.now() - last < 30000) return json(429, { error: "Подожди 30 секунд перед следующим заказом." });
          } else if (!takeRateSlot(musicRequestRate, clientIp(req), 8, 3600000)) {
            return json(429, { error: "Слишком много заявок. Попробуй позже." });
          }
          if (!/^[\p{L}\p{N}_ .-]{2,32}$/u.test(nick)) return json(400, { error: "Ник должен содержать от 2 до 32 символов." });
          const vid = parseYouTubeId(body.url);
          if (!vid) return json(400, { error: "Вставь корректную ссылку на видео YouTube." });
          const info = await youtubeLookup(vid);
          if (info.status === "missing") return json(404, { error: "Это видео не найдено, удалено или закрыто." });
          if (info.status === "blocked") return json(422, { error: "Автор запретил воспроизведение этого видео на других сайтах. Выбери другой ролик." });
          if (chatRequester) {
            if (!takeRateSlot(musicChatRequestRate, chatRequester, 5, 3600000)) return json(429, { error: "Можно заказать не более 5 видео в час." });
            musicChatCooldown.set(chatRequester, Date.now());
            if (musicChatCooldown.size > 5000) for (const [key, at] of musicChatCooldown) if (Date.now() - at > 3600000) musicChatCooldown.delete(key);
          }
          const db = await musicLoad();
          musicNormalize(db, ch, false);
          const active = musicActiveItems(db, ch);
          if (active.length >= MUSIC_QUEUE_LIMIT) return json(429, { error: "Очередь канала заполнена (максимум " + MUSIC_QUEUE_LIMIT + " треков)." });
          if (active.some(x => x.videoId === vid)) return json(409, { error: "Этот трек уже есть в очереди." });
          const first = active.length === 0;
          const item = { id: require("node:crypto").randomUUID(), channel: ch, nickname: nick, videoId: vid, url: "https://www.youtube.com/watch?v=" + vid, title: musicClean(body.title, 100) || (info.status === "ok" ? musicClean(info.title, 100) : ""), status: first ? "playing" : "pending", createdAt: new Date().toISOString() };
          db.items.push(item);
          if (first) musicSetPlayback(db, ch, { trackId: item.id, paused: false, visible: true });
          await musicSave(db);
          return json(201, { ok: true, message: first ? "Трек добавлен и уже играет." : "Трек добавлен в очередь (позиция " + (active.length + 1) + ")." });
        }
        if (route === "/api/music/overlay/ended" && method === "POST") {
          const ch = musicChannel(body.channel), id = musicClean(body.id, 80), resultStatus = body.status === "skipped" ? "skipped" : "done";
          if (!ch || !id) return json(400, { error: "Некорректный запрос." });
          const db = await musicLoad();
          musicNormalize(db, ch, false);
          const item = db.items.find(x => x.id === id && x.channel === ch && x.status === "playing");
          if (item) { item.status = resultStatus; musicNormalize(db, ch, true); await musicSave(db); }
          return json(200, { ok: true });
        }
        if (route.startsWith("/api/music/admin/") && method === "POST") {
          if (!isAdmin) return json(401, { error: "Войди как стример, чтобы управлять очередью." });
          const ch = musicChannel(body.channel), id = musicClean(body.id, 80), action = route.split("/").pop();
          if (!ch) return json(400, { error: "Укажи корректный Twitch-канал." });
          if (session.channel !== ch) return json(403, { error: "Этот вход разрешён только для канала " + session.channel + "." });
          const db = await musicLoad();
          musicNormalize(db, ch, false);
          const active = musicActiveItems(db, ch), current = active.find(x => x.status === "playing") || null;
          const item = db.items.find(x => x.id === id && x.channel === ch);
          if (action === "next") {
            if (current) current.status = "done";
            musicNormalize(db, ch, true);
            const upNext = musicActiveItems(db, ch).find(x => x.status === "playing") || null;
            musicSetPlayback(db, ch, { trackId: upNext ? upNext.id : null, paused: false, visible: true });
            await musicSave(db);
            return json(200, { ok: true });
          }
          if (action === "pause" || action === "resume") {
            if (!current) return json(404, { error: "Сейчас нечего воспроизводить." });
            musicSetPlayback(db, ch, { trackId: current.id, paused: action === "pause" });
            await musicSave(db);
            return json(200, { ok: true, paused: action === "pause" });
          }
          if (action === "show" || action === "hide") {
            if (!current) return json(404, { error: "Сейчас нечего воспроизводить." });
            musicSetPlayback(db, ch, { trackId: current.id, visible: action === "show" });
            await musicSave(db);
            return json(200, { ok: true, visible: action === "show" });
          }
          if (!item) return json(404, { error: "Заявка не найдена." });
          if (action === "play") {
            for (const other of active) if (other.status === "playing") other.status = "pending";
            item.status = "playing";
            musicSetPlayback(db, ch, { trackId: item.id, paused: false, visible: true });
          } else if (action === "skip" || action === "remove") {
            const wasCurrent = item.status === "playing";
            item.status = action === "skip" ? "skipped" : "removed";
            musicNormalize(db, ch, true);
            if (wasCurrent) { const upNext = musicActiveItems(db, ch).find(x => x.status === "playing") || null; musicSetPlayback(db, ch, { trackId: upNext ? upNext.id : null, paused: false, visible: true }); }
          } else return json(400, { error: "Неизвестное действие." });
          musicNormalize(db, ch, false);
          await musicSave(db);
          return json(200, { ok: true });
        }
        return json(404, { error: "Неизвестный маршрут." });
      } catch (error) { musicDbCache = null; throw error; }
    });
  } catch (error) {
    console.error("Music queue API error:", error.message);
    if (!res.headersSent) return json(error.statusCode || 500, { error: error.statusCode ? error.message : "Не удалось обработать музыкальную очередь." });
  }
}

async function handleRequest(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch (_) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  if (url.pathname.startsWith("/api/twitch-widget/")) {
    const json=(status,data)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data))};
    const proto=String(req.headers["x-forwarded-proto"]||(req.socket.encrypted?"https":"http")).split(",")[0].trim(),redirectUri=String(process.env.TWITCH_WIDGET_REDIRECT_URI||(proto+"://"+(req.headers.host||"localhost")+"/api/twitch-widget/callback")).trim();
    const authDir=process.env.WALL_DATA_DIR||path.join(__dirname,"data");
    const authFile=path.join(authDir,"twitch-widget-auth.json");
    const states=globalThis.__twitchWidgetOAuthStates||(globalThis.__twitchWidgetOAuthStates=new Map());
    async function readAuth(){try{const d=JSON.parse(await fs.promises.readFile(authFile,"utf8"));return d&&typeof d==="object"?d:{}}catch(e){if(e.code==="ENOENT")return{};throw e}}
    async function writeAuth(d){await fs.promises.mkdir(authDir,{recursive:true});const tmp=authFile+".tmp";await fs.promises.writeFile(tmp,JSON.stringify(d,null,2),{mode:0o600});await fs.promises.rename(tmp,authFile)}
    async function helixUser(accessToken,endpoint,params){const r=await fetch("https://api.twitch.tv/helix/"+endpoint+"?"+params.toString(),{headers:{"Client-Id":CLIENT_ID,"Authorization":"Bearer "+accessToken},signal:AbortSignal.timeout(10000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||("Twitch API "+r.status));return d}
    if(url.pathname==="/api/twitch-widget/connect"){
      const channel=String(url.searchParams.get("channel")||"").trim().replace(/^@/,"").toLowerCase();
      if(!CLIENT_ID||!CLIENT_SECRET||!redirectUri){json(503,{error:"На сервере не настроены TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET или TWITCH_WIDGET_REDIRECT_URI."});return}
      if(!/^[a-z0-9_]{1,25}$/.test(channel)){json(400,{error:"Укажи корректный логин Twitch-канала."});return}
      const state=require("node:crypto").randomBytes(24).toString("hex");
      states.set(state,{channel,expiresAt:Date.now()+10*60*1000});
      const q=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:redirectUri,response_type:"code",scope:"channel:read:polls channel:read:predictions",state,force_verify:"true"});
      res.writeHead(302,{Location:"https://id.twitch.tv/oauth2/authorize?"+q.toString(),"Cache-Control":"no-store"});res.end();return;
    }
    if(url.pathname==="/api/twitch-widget/callback"){
      const state=String(url.searchParams.get("state")||""),code=String(url.searchParams.get("code")||""),saved=states.get(state);
      states.delete(state);
      if(!saved||saved.expiresAt<Date.now()||!code){res.writeHead(400,{"Content-Type":"text/html; charset=utf-8"});res.end("<h2>Авторизация Twitch не завершена</h2><p>Вернись в раздел «Прогнозы и опросы» и попробуй ещё раз.</p>");return}
      try{
        const body=new URLSearchParams({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,code,grant_type:"authorization_code",redirect_uri:redirectUri});
        const tokenResponse=await fetch("https://id.twitch.tv/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(12000)});
        const tokenData=await tokenResponse.json();if(!tokenResponse.ok)throw Error(tokenData.message||"Не удалось получить токен Twitch.");
        const me=await helixUser(tokenData.access_token,"users",new URLSearchParams());
        const user=(me.data||[])[0];if(!user||String(user.login).toLowerCase()!==saved.channel)throw Error("Авторизованный Twitch-аккаунт не совпадает с каналом "+saved.channel+". Подключи именно аккаунт владельца канала.");
        const db=await readAuth();db[saved.channel]={userId:String(user.id),login:String(user.login),displayName:String(user.display_name||user.login),accessToken:tokenData.access_token,refreshToken:tokenData.refresh_token,expiresAt:Date.now()+Number(tokenData.expires_in||3600)*1000,scopes:tokenData.scope||[]};await writeAuth(db);
        res.writeHead(302,{Location:"/widgets?tab=polls&connected=1&channel="+encodeURIComponent(saved.channel),"Cache-Control":"no-store"});res.end();return;
      }catch(error){console.error("Twitch polls OAuth failed:",error.message);res.writeHead(400,{"Content-Type":"text/html; charset=utf-8"});res.end("<h2>Не удалось подключить Twitch</h2><p>"+String(error.message).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))+"</p><p><a href='/widgets'>Вернуться к виджетам</a></p>");return}
    }
    if(url.pathname==="/api/twitch-widget/data"){
      const channel=String(url.searchParams.get("channel")||"").trim().replace(/^@/,"").toLowerCase();
      if(!/^[a-z0-9_]{1,25}$/.test(channel)){json(400,{error:"Некорректный логин канала."});return}
      try{
        const db=await readAuth(),auth=db[channel];if(!auth){json(401,{connected:false,error:"Канал ещё не подключён. Сначала авторизуй аккаунт владельца канала."});return}
        let accessToken=auth.accessToken;
        if(Date.now()>Number(auth.expiresAt||0)-60000){
          const refreshBody=new URLSearchParams({grant_type:"refresh_token",refresh_token:auth.refreshToken,client_id:CLIENT_ID,client_secret:CLIENT_SECRET});
          const rr=await fetch("https://id.twitch.tv/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:refreshBody,signal:AbortSignal.timeout(12000)});
          const rd=await rr.json();if(!rr.ok)throw Error("Сессия Twitch истекла. Переподключи канал.");
          auth.accessToken=rd.access_token;auth.refreshToken=rd.refresh_token||auth.refreshToken;auth.expiresAt=Date.now()+Number(rd.expires_in||3600)*1000;db[channel]=auth;await writeAuth(db);accessToken=auth.accessToken;
        }
        const params=new URLSearchParams({broadcaster_id:auth.userId,first:"5"});
        const [polls,predictions]=await Promise.all([helixUser(accessToken,"polls",params),helixUser(accessToken,"predictions",params)]);
        json(200,{connected:true,channel:auth.login,displayName:auth.displayName,updatedAt:new Date().toISOString(),polls:(polls.data||[]).slice(0,3),predictions:(predictions.data||[]).slice(0,3)});
      }catch(error){console.error("Twitch poll/prediction fetch failed:",error.message);json(503,{error:error.message||"Не удалось получить опросы и прогнозы Twitch."})}
      return;
    }
    if(url.pathname==="/api/twitch-widget/disconnect"){
      const channel=String(url.searchParams.get("channel")||"").trim().replace(/^@/,"").toLowerCase();
      try{const db=await readAuth();delete db[channel];await writeAuth(db);json(200,{ok:true})}catch(error){json(500,{error:"Не удалось отключить канал."})}
      return;
    }
    json(404,{error:"Неизвестный маршрут Twitch-виджета."});return;
  }

  if (url.pathname === "/api/followers") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const login = String(url.searchParams.get("login") || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(login)) {
      res.writeHead(400); res.end(JSON.stringify({ error: "Invalid Twitch login", total: null })); return;
    }
    try {
      const result = await fetchFollowerCount(login);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (error) {
      console.error(`Could not load follower total for ${login}: ${error.message}`);
      res.writeHead(503); res.end(JSON.stringify({ error: "Twitch follower count is temporarily unavailable", total: null }));
    }
    return;
  }

  if (url.pathname === "/api/chat-colors") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    const logins = [...new Set(String(url.searchParams.get("logins") || "")
      .split(",").map(value => value.trim().toLowerCase()).filter(value => /^[a-z0-9_]{1,25}$/.test(value)))].slice(0, 100);
    if (!logins.length) { res.writeHead(200); res.end(JSON.stringify({ colors: {} })); return; }
    const cacheKey = logins.slice().sort().join(",");
    const cached = chatColorsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) { res.writeHead(200); res.end(JSON.stringify({ colors: cached.colors })); return; }
    try {
      const usersParams = new URLSearchParams();
      for (const login of logins) usersParams.append("login", login);
      const usersPayload = await helix("users", usersParams);
      const users = usersPayload.data || [];
      const colorParams = new URLSearchParams();
      for (const user of users) colorParams.append("user_id", String(user.id));
      const colorsPayload = users.length ? await helix("chat/color", colorParams) : { data: [] };
      // Helix Get User Chat Color returns user_id (not user_login).
      // Resolve the IDs through the users response so every requested login gets its color.
      const loginById = new Map(users.map(user => [String(user.id), String(user.login || "").toLowerCase()]));
      const colors = {};
      for (const item of colorsPayload.data || []) {
        const login = loginById.get(String(item.user_id));
        if (login && item.color) colors[login] = item.color;
      }
      chatColorsCache.set(cacheKey, { colors, expiresAt: Date.now() + 60 * 60 * 1000 });
      if (chatColorsCache.size > 500) chatColorsCache.delete(chatColorsCache.keys().next().value);
      res.writeHead(200); res.end(JSON.stringify({ colors }));
    } catch (error) {
      console.error("Could not load Twitch chat colors: " + error.message);
      res.setHeader("Cache-Control", "no-store"); res.writeHead(503); res.end(JSON.stringify({ error: "Twitch chat colors temporarily unavailable", colors: {} }));
    }
    return;
  }

  if (url.pathname === "/api/chat-badges") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // Never cache a failed Twitch response; only successful badge payloads are cacheable.
    res.setHeader("Cache-Control", "no-store");
    try {
      const channelLogin = String(url.searchParams.get("channel") || "").trim().toLowerCase();
      const globalPromise = helix("chat/badges/global", new URLSearchParams());
      const userPromise = channelLogin && /^[a-z0-9_]{1,25}$/.test(channelLogin)
        ? helix("users", new URLSearchParams({ login: channelLogin }))
        : Promise.resolve({ data: [] });
      const [globalPayload, userPayload] = await Promise.all([globalPromise, userPromise]);
      const sets = [...(globalPayload.data || [])];
      const broadcaster = (userPayload.data || [])[0];
      if (broadcaster) {
        const badgeParams = new URLSearchParams({ broadcaster_id: String(broadcaster.id) });
        const channelPayload = await helix("chat/badges", badgeParams);
        sets.push(...(channelPayload.data || []));
      }
      const badges = {};
      for (const set of sets) {
        const versions = (set.versions || []).map(version => ({
          id: String(version.id),
          title: version.title || set.set_id,
          url: version.image_url_2x || version.image_url_1x || ""
        })).filter(version => version.url);
        if (versions.length) badges[set.set_id] = { title: set.set_id, versions };
      }
      res.setHeader("Cache-Control", "public, max-age=1800, stale-while-revalidate=300");
      res.writeHead(200); res.end(JSON.stringify({ badges }));
    } catch (error) {
      console.error("Could not load official Twitch chat badges: " + error.message);
      res.writeHead(503); res.end(JSON.stringify({ error: "Twitch badges temporarily unavailable", badges: {} }));
    }
    return;
  }

  if (url.pathname === "/api/avatar") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    const login = String(url.searchParams.get("login") || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(login)) {
      res.setHeader("Cache-Control", "no-store"); res.writeHead(400); res.end(JSON.stringify({ error: "Invalid Twitch login", avatarUrl: null })); return;
    }
    const cachedForRefresh = avatarCache.get(login);
    const forceRefresh = url.searchParams.get("refresh") === "1" && (!cachedForRefresh || Date.now() - cachedForRefresh.time > 60_000);
    const cached = avatarCache.get(login);
    if (!forceRefresh && cached && Date.now() - cached.time < 30 * 60_000) {
      res.writeHead(200); res.end(JSON.stringify({ login, avatarUrl: cached.avatarUrl })); return;
    }
    try {
      const params = new URLSearchParams(); params.append("login", login);
      const payload = await helix("users", params);
      const avatarUrl = payload.data && payload.data[0] && payload.data[0].profile_image_url;
      if (!avatarUrl) { res.setHeader("Cache-Control", "no-store"); res.writeHead(404); res.end(JSON.stringify({ error: "Twitch user not found", avatarUrl: null })); return; }
      avatarCache.set(login, { time: Date.now(), avatarUrl });
      res.writeHead(200); res.end(JSON.stringify({ login, avatarUrl }));
    } catch (error) {
      console.error(`Could not load avatar for ${login}: ${error.message}`);
      res.setHeader("Cache-Control", "no-store"); res.writeHead(503); res.end(JSON.stringify({ error: "Avatar temporarily unavailable", avatarUrl: null }));
    }
    return;
  }

  if (url.pathname === "/api/clips") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      const allowed = new Set(["24h", "7d", "30d", "365d", "all"]);
      const period = allowed.has(url.searchParams.get("period")) ? url.searchParams.get("period") : "all";
      const clips = await fetchClips(period);
      res.writeHead(200); res.end(JSON.stringify({ updatedAt: new Date().toISOString(), clips }));
    } catch (error) {
      console.error(error.message);
      res.writeHead(503); res.end(JSON.stringify({ error: error.message || "Twitch clips are temporarily unavailable", clips: [] }));
    }
    return;
  }

  if (url.pathname === "/api/diagnostics/twitch") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      const diagnostics = await getTwitchDiagnostics();
      res.writeHead(200);
      res.end(JSON.stringify(diagnostics));
    } catch (error) {
      console.error(`Twitch diagnostics failed: ${error.message}`);
      res.writeHead(503);
      res.end(JSON.stringify({ checkedAt: new Date().toISOString(), error: "Diagnostic request failed" }));
    }
    return;
  }

  if (url.pathname === "/api/schedules") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const schedules = await getSchedules();
      res.setHeader("Cache-Control", "public, max-age=120");
      res.writeHead(200); res.end(JSON.stringify({ updatedAt: new Date(scheduleCacheAt || Date.now()).toISOString(), schedules }));
    } catch (error) {
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(503); res.end(JSON.stringify({ schedules: {}, error: "unavailable" }));
    }
    return;
  }

  if (url.pathname === "/api/collaborations") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      res.writeHead(200);
      res.end(JSON.stringify({ collaborations: await getCollaborations() }));
    } catch (error) {
      collabCacheAt = Date.now() - 45_000; // повтор через 15 секунд, а не при каждом запросе
      console.error("Twitch collaborations unavailable: " + error.message);
      res.writeHead(503);
      res.end(JSON.stringify({ collaborations: {}, error: "unavailable" }));
    }
    return;
  }

  if (url.pathname === "/api/streams") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      const streams = await getStreams();
      res.writeHead(200);
      res.end(JSON.stringify({ updatedAt: new Date(streamsFetchedAt || Date.now()).toISOString(), streams }));
    } catch (error) {
      console.error(error.message);
      res.writeHead(503);
      res.end(JSON.stringify({ error: "Twitch status is temporarily unavailable", streams: {} }));
    }
    return;
  }





  if (url.pathname.startsWith("/api/music/")) return handleMusicApi(req, res, url);
  if (url.pathname.startsWith("/api/party/")) return handleParty(req, res, url);

  // Community suggestion box: submissions remain private until moderator approval.
  if (url.pathname === "/api/jackbox/room-check") {
    const json = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    if (req.method !== "POST") return json(405, { error: "Используй POST." });
    try {
      const body = await (async () => { const chunks=[]; let size=0; for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Object.assign(new Error("Слишком большой запрос."), {statusCode:413}); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (_) { throw Object.assign(new Error("Некорректный JSON."), {statusCode:400}); } })();
      const code = String(body.room || "").trim().toUpperCase();
      const name = String(body.nickname || "").trim().slice(0, 20);
      const password = String(body.password || "").slice(0, 64);
      if (!/^[A-Z]{4}$/.test(code)) return json(400, { error: "Код комнаты должен состоять из четырёх латинских букв." });
      if (!/^[\p{L}\p{N}_ .-]{1,20}$/u.test(name)) return json(400, { error: "Никнейм: до 20 букв, цифр, пробелов, точек, дефисов или подчёркиваний." });
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
      const now = Date.now();
      const attempts = (jackboxRoomChecks.get(ip) || []).filter(t => now - t < 60000);
      if (attempts.length >= 12) return json(429, { error: "Слишком много проверок комнат. Подожди минуту." });
      attempts.push(now); jackboxRoomChecks.set(ip, attempts);
      const response = await fetch("https://ecast.jackboxgames.com/api/v2/rooms/" + encodeURIComponent(code), { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return json(response.status === 404 ? 404 : 502, { error: response.status === 404 ? "Комната не найдена или уже закрыта." : "Сервер Jackbox временно не ответил." });
      const payload = await response.json();
      if (!payload || payload.ok !== true || !payload.body) return json(404, { error: "Комната не найдена или уже закрыта." });
      const room = payload.body;
      if (room.appTag !== "quiplash3-tjsp") return json(409, { error: "Эта комната запущена не в Quiplash 3.", game: room.appTag || "unknown" });
      if (room.passwordRequired && !password) return json(403, { error: "Для этой комнаты требуется пароль. Поддержка защищённых паролем комнат пока не реализована." });
      if (room.twitchLocked) return json(409, { error: "В настройках этой комнаты включено REQUIRE TWITCH. Авторизация Twitch в контроллере пока не подключена — отключи это требование в настройках игры." });
      if (room.passwordRequired) return json(501, { error: "Проверка пароля для этой версии протокола пока не реализована. Пароль не отправлялся." });
      const role = room.full ? "audience" : "player";
      if (role === "audience" && !room.audienceEnabled) return json(409, { error: "Комната заполнена, а аудитория отключена." });
      const host = role === "audience" ? room.audienceHost : room.host;
      const allowedHost = typeof host === "string" && (host === "ecast.jackboxgames.com" || /^[a-z0-9.-]+\.play\.jackboxgames\.com$/i.test(host));
      if (!allowedHost) return json(502, { error: "Jackbox вернул неизвестный адрес игрового сервера." });
      const ticket = require("node:crypto").randomBytes(24).toString("hex");
      for (const [key, value] of jackboxTickets) if (value.expiresAt < now) jackboxTickets.delete(key);
      jackboxTickets.set(ticket, { code, name, role, host, userId: require("node:crypto").randomUUID(), secret: require("node:crypto").randomUUID(), expiresAt: now + 60000 });
      return json(200, { ok: true, ticket, game: "Quiplash 3", room: code, role, players: Number(room.maxPlayers || 0), expiresIn: 60 });
    } catch (error) {
      console.error("Jackbox room check:", error.message);
      return json(error.statusCode || 502, { error: error.statusCode ? error.message : "Не удалось связаться с сервером Jackbox." });
    }
  }

  if (url.pathname.startsWith("/api/community/")) {
    const sendJson = (status, payload, extraHeaders = {}) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
      res.end(JSON.stringify(payload));
    };
    const dataDir = process.env.WALL_DATA_DIR || path.join(__dirname, "data");
    const dataFile = path.join(dataDir, "community-submissions.json");
    const r2AccountId = process.env.R2_ACCOUNT_ID;
    const r2Bucket = process.env.R2_BUCKET_NAME;
    const r2Enabled = Boolean(r2AccountId && r2Bucket && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
    const r2Client = r2Enabled ? new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT || `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    }) : null;
    const r2ObjectKey = process.env.R2_OBJECT_KEY || "community-submissions.json";

    const maxImageChars = 2 * 1024 * 1024 * 1.38;
    const sessions = globalThis.__communitySessions || (globalThis.__communitySessions = new Map());
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const rateStore = globalThis.__communityRateStore || (globalThis.__communityRateStore = new Map());
    async function readBody(limit = 3 * 1024 * 1024) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw Object.assign(new Error("Размер отправки слишком большой."), { statusCode: 413 });
        chunks.push(chunk);
      }
      try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
      catch { throw Object.assign(new Error("Некорректный JSON."), { statusCode: 400 }); }
    }
    async function bodyToString(body) {
      const chunks = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString("utf8");
    }
    async function readLocalDb() {
      await fs.promises.mkdir(dataDir, { recursive: true });
      try {
        const parsed = JSON.parse(await fs.promises.readFile(dataFile, "utf8"));
        return { submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [] };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return { submissions: [] };
      }
    }
    async function loadDb() {
      if (r2Enabled) {
        try {
          const result = await r2Client.send(new GetObjectCommand({ Bucket: r2Bucket, Key: r2ObjectKey }));
          const parsed = JSON.parse(await bodyToString(result.Body));
          return { submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [] };
        } catch (error) {
          const missing = error.name === "NoSuchKey" || error.Code === "NoSuchKey" || error.$metadata?.httpStatusCode === 404;
          if (!missing) {
            console.error("Community R2 data could not be read:", error.message);
            throw new Error("Не удалось прочитать данные заявок из R2. Изменения остановлены, чтобы не потерять данные.");
          }
          // First R2 run: migrate the existing local JSON once, if present.
          const localDb = await readLocalDb();
          if (localDb.submissions.length) {
            await r2Client.send(new PutObjectCommand({
              Bucket: r2Bucket, Key: r2ObjectKey,
              Body: JSON.stringify(localDb, null, 2), ContentType: "application/json"
            }));
          }
          return localDb;
        }
      }
      return readLocalDb();
    }
    async function loadDbCached() {
      const cached = globalThis.__communityDbCache;
      if (cached && Date.now() - cached.at < 30_000) return cached.db;
      const db = await loadDb();
      globalThis.__communityDbCache = { db, at: Date.now() };
      return db;
    }
    async function saveDb(db) {
      globalThis.__communityDbCache = null;
      const serialized = JSON.stringify(db, null, 2);
      if (r2Enabled) {
        await r2Client.send(new PutObjectCommand({
          Bucket: r2Bucket, Key: r2ObjectKey,
          Body: serialized, ContentType: "application/json"
        }));
        return;
      }
      await fs.promises.mkdir(dataDir, { recursive: true });
      const tmp = dataFile + ".tmp";
      await fs.promises.writeFile(tmp, serialized, { mode: 0o600 });
      await fs.promises.rename(tmp, dataFile);
    }
    function cleanText(value, max) { return String(value || "").replace(/\u0000/g, "").trim().slice(0, max); }
    function getSession() {
      const cookie = String(req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith("community_session="));
      const sessionId = cookie ? cookie.slice("community_session=".length) : "";
      const session = sessions.get(sessionId);
      if (!session || session.expiresAt < Date.now()) { if (sessionId) sessions.delete(sessionId); return null; }
      return { ...session, sessionId };
    }
    function moderatorsConfig() {
      let configured = {};
      try { configured = JSON.parse(process.env.WALL_MODERATORS || "{}"); } catch (_) {}
      return configured && typeof configured === "object" && !Array.isArray(configured) ? configured : {};
    }
    function verifyCredentials(username, password) {
      const normalized = cleanText(username, 40);
      if (normalized.toLowerCase() === "admin" && process.env.WALL_ADMIN_PASSWORD && password === process.env.WALL_ADMIN_PASSWORD) return { username: "admin", role: "admin" };
      const found = Object.entries(moderatorsConfig()).find(([name, secret]) => name.toLowerCase() === normalized.toLowerCase() && typeof secret === "string" && secret && password === secret);
      return found ? { username: found[0], role: "moderator" } : null;
    }
    const method = req.method || "GET";
    // Один запрос за раз: иначе две одновременные заявки затирали друг друга (read-modify-write без блокировки).
    const releaseLock = await communityMutex.acquire();
    let lockReleased = false;
    const release = () => { if (!lockReleased) { lockReleased = true; releaseLock(); } };
    res.once("finish", release); res.once("close", release);
    try {
      if (url.pathname === "/api/community/submissions" && method === "POST") {
        const now = Date.now(), bucket = rateStore.get(ip) || [], recent = bucket.filter(time => now - time < 60 * 60_000);
        if (recent.length >= 5) return sendJson(429, { error: "Слишком много отправок. Попробуйте позже." });
        const body = await readBody();
        const nickname = cleanText(body.nickname, 32);
        const kind = ["streamer", "wall", "site", "moderator"].includes(body.kind) ? body.kind : "";
        const text = cleanText(body.text, 1200);
        if (!/^[\p{L}\p{N}_ .-]{2,32}$/u.test(nickname)) return sendJson(400, { error: "Укажите никнейм длиной от 2 до 32 символов." });
        if (!kind) return sendJson(400, { error: "Выберите тип предложения." });
        let twitchLogin = "";
        if (kind === "streamer") {
          const raw = cleanText(body.twitch, 300);
          try {
            if (/^[a-zA-Z0-9_]{1,25}$/.test(raw)) {
              twitchLogin = raw.toLowerCase();
            } else {
              const candidate = new URL(raw.includes("://") ? raw : "https://" + raw);
              const login = candidate.pathname.split("/").filter(Boolean)[0] || "";
              if (!/^(?:www\.)?twitch\.tv$/i.test(candidate.hostname) || !/^[a-zA-Z0-9_]{1,25}$/.test(login)) throw new Error("invalid");
              twitchLogin = login.toLowerCase();
            }
          } catch (_) { return sendJson(400, { error: "Введите корректную ссылку на Twitch или ник канала." }); }
        }
        let moderatorName = "";
        let moderatorOf = [];
        if (kind === "moderator") {
          moderatorName = cleanText(body.moderatorName || nickname, 32);
          const rawModerates = cleanText(body.moderatorOf, 300);
          moderatorOf = [...new Set(rawModerates.split(/[\s,;]+/).map(value => value.replace(/^@/, "").toLowerCase()).filter(Boolean))];
          if (!/^[\p{L}\p{N}_ .-]{2,32}$/u.test(moderatorName)) return sendJson(400, { error: "Укажите корректный ник модератора." });
          if (!rawModerates || !moderatorOf.length || moderatorOf.some(login => !/^[a-zA-Z0-9_]{1,25}$/.test(login))) return sendJson(400, { error: "Обязательно укажите корректные Twitch-ники стримеров, где человек будет модератором." });
        }
        let imageData = "";
        if (body.image) {
          if (typeof body.image !== "string" || body.image.length > maxImageChars) return sendJson(413, { error: "Изображение слишком большое (максимум 2 МБ)." });
          const match = body.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
          if (!match) return sendJson(400, { error: "Поддерживаются изображения JPG, PNG, WEBP или GIF." });
          const bytes = Buffer.from(match[2], "base64");
          if (!bytes.length || bytes.length > 2 * 1024 * 1024) return sendJson(413, { error: "Изображение должно быть не больше 2 МБ." });
          const signatures = {
            "image/jpeg": bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
            "image/png": bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
            "image/webp": bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
            "image/gif": bytes.toString("ascii", 0, 3) === "GIF"
          };
          if (!signatures[match[1]]) return sendJson(400, { error: "Формат файла не совпадает с содержимым изображения." });
          imageData = body.image;
        }
        if (kind === "wall" && !text && !imageData) return sendJson(400, { error: "Добавьте текст и/или изображение для стены." });
        if (kind === "site" && !text) return sendJson(400, { error: "Опишите предложение по улучшению сайта." });
        if (kind === "moderator" && (!moderatorName || !moderatorOf.length)) return sendJson(400, { error: "Укажите имя модератора и каналы, где он будет модератором." });
        if (kind === "streamer" && !twitchLogin) return sendJson(400, { error: "Нужен Twitch-канал." });
        const db = await loadDb();
        if (kind === "streamer" && db.submissions.some(item => item.kind === "streamer" && item.twitchLogin === twitchLogin && item.status !== "rejected")) return sendJson(409, { error: "Этот канал уже предложен или опубликован." });
        db.submissions.push({
          id: require("node:crypto").randomUUID(), kind, nickname, text, twitchLogin, imageData, moderatorName, moderatorOf,
          status: "pending", createdAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null
        });
        await saveDb(db);
        recent.push(now); rateStore.set(ip, recent);
        return sendJson(201, { ok: true, message: "Отправлено на модерацию. Спасибо!" });
      }
      if (url.pathname === "/api/community/posts" && method === "GET") {
        const db = await loadDbCached();
        // Идеи по улучшению сайта (kind "site") видят только модераторы — наружу не отдаются никогда.
        return sendJson(200, { submissions: db.submissions.filter(item => item.status === "approved" && ["streamer", "moderator", "wall"].includes(item.kind)).map(item => ({
          id: item.id, kind: item.kind, nickname: item.nickname, text: item.text, twitchLogin: item.twitchLogin, imageUrl: item.imageData ? "/api/community/image/" + item.id : "", moderatorName: item.moderatorName, moderatorOf: item.moderatorOf, createdAt: item.createdAt
        })) });
      }
      const imageMatch = url.pathname.match(/^\/api\/community\/image\/([a-f0-9-]+)$/i);
      if (imageMatch && method === "GET") {
        const db = await loadDbCached(), item = db.submissions.find(entry => entry.id === imageMatch[1]);
        const parsed = item && item.imageData && item.imageData.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
        const published = item && item.status === "approved" && ["streamer", "moderator", "wall"].includes(item.kind);
        if (!parsed || (!published && !getSession())) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not found"); }
        const bytes = Buffer.from(parsed[2], "base64");
        res.writeHead(200, { "Content-Type": parsed[1], "Content-Length": bytes.length, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Cache-Control": published ? "public, max-age=86400" : "private, no-store" });
        return res.end(bytes);
      }
      if (url.pathname === "/api/community/login" && method === "POST") {
        if (!process.env.WALL_ADMIN_PASSWORD && !Object.keys(moderatorsConfig()).length) return sendJson(503, { error: "Модерация ещё не настроена владельцем сайта." });
        if (!takeRateSlot(communityLoginRate, ip, 10, 10 * 60_000)) return sendJson(429, { error: "Слишком много попыток входа. Подождите 10 минут." });
        const body = await readBody(20 * 1024);
        const identity = verifyCredentials(body.username, String(body.password || ""));
        if (!identity) return sendJson(401, { error: "Неверный логин или пароль." });
        const sessionId = require("node:crypto").randomBytes(32).toString("hex");
        sessions.set(sessionId, { ...identity, expiresAt: Date.now() + 12 * 60 * 60_000 });
        return sendJson(200, { ok: true, username: identity.username, role: identity.role }, {
          "Set-Cookie": "community_session=" + sessionId + "; HttpOnly" + (isHttps(req) ? "; Secure" : "") + "; SameSite=Strict; Path=/; Max-Age=43200"
        });
      }
      if (url.pathname === "/api/community/logout" && method === "POST") {
        const session = getSession(); if (session) sessions.delete(session.sessionId);
        return sendJson(200, { ok: true }, { "Set-Cookie": "community_session=; HttpOnly" + (isHttps(req) ? "; Secure" : "") + "; SameSite=Strict; Path=/; Max-Age=0" });
      }
      if (url.pathname === "/api/community/moderation" && method === "GET") {
        const session = getSession(); if (!session) return sendJson(401, { error: "Нужен вход модератора." });
        const db = await loadDb();
        return sendJson(200, { submissions: db.submissions.filter(item => item.status === "pending").map(item => ({
          id: item.id, kind: item.kind, nickname: item.nickname, text: item.text, twitchLogin: item.twitchLogin, imageUrl: item.imageData ? "/api/community/image/" + item.id : "", moderatorName: item.moderatorName, moderatorOf: item.moderatorOf, createdAt: item.createdAt
        })), moderator: session.username, role: session.role });
      }
      const actionMatch = url.pathname.match(/^\/api\/community\/moderation\/([a-f0-9-]+)$/i);
      if (actionMatch && method === "POST") {
        const session = getSession(); if (!session) return sendJson(401, { error: "Нужен вход модератора." });
        const body = await readBody(20 * 1024), action = String(body.action || "");
        if (!["approve", "reject", "delete"].includes(action)) return sendJson(400, { error: "Неизвестное действие." });
        const db = await loadDb(), item = db.submissions.find(entry => entry.id === actionMatch[1]);
        if (!item) return sendJson(404, { error: "Заявка не найдена." });
        if (item.status === "approved" && ["wall", "streamer", "moderator"].includes(item.kind) && action !== "approve") {
          const typeLabel = item.kind === "streamer" ? "Одобренных стримеров" : item.kind === "moderator" ? "Одобренных модераторов" : "Одобренных публикаций на стене";
          return sendJson(409, { error: typeLabel + " нельзя отклонить или удалить. Они остаются опубликованными после перезагрузки страницы." });
        }
        if (action === "delete") db.submissions = db.submissions.filter(entry => entry.id !== item.id);
        else { item.status = action === "approve" ? "approved" : "rejected"; item.reviewedAt = new Date().toISOString(); item.reviewedBy = session.username; }
        await saveDb(db); return sendJson(200, { ok: true });
      }
      return sendJson(404, { error: "Неизвестный маршрут." });
    } catch (error) {
      console.error("Community suggestion API error:", error.message);
      return sendJson(error.statusCode || 500, { error: error.statusCode ? error.message : "Не удалось обработать запрос. Попробуйте позже." });
    }
  }

  if (url.pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end("ok"); return; }

  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname.slice(1)); } catch (_) { decodedPath = null; }
  if (decodedPath === null || decodedPath.includes("\0")) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Bad Request"); return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD" }); res.end("Method Not Allowed"); return;
  }

  if (url.pathname.startsWith("/fonts/")) {
    const fontsDir = path.join(__dirname, "fonts");
    const fontPath = path.resolve(__dirname, decodedPath);
    if (!fontPath.startsWith(fontsDir + path.sep)) { res.writeHead(403); res.end("Forbidden"); return; }
    return serveStatic(req, res, fontPath, { fonts: true });
  }

  const pageRoutes = { "": "index.html", "music-dock": "music-dock.html", "jack": "jack.html", "widgets": "widgets.html", "party": "party.html", "party/host": "party-host.html", "ad": "ad/index.html", "ad/widget": "ad/widget/index.html" };
  const trimmedPath = decodedPath.replace(/\/+$/, "");
  const requested = Object.prototype.hasOwnProperty.call(pageRoutes, trimmedPath) ? pageRoutes[trimmedPath] : decodedPath;
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end("Forbidden"); return; }
  return serveStatic(req, res, filePath, {});
}

// ── Static files: in-memory cache, ETag/304, gzip for text assets ──
const staticCache = new Map();
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".svg", ".json", ".xml", ".txt"]);
const MIME_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8", ".otf": "font/otf", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };
async function serveStatic(req, res, filePath, options) {
  let stat;
  try { stat = await fs.promises.stat(filePath); } catch (_) { stat = null; }
  if (!stat || !stat.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
  const ext = path.extname(filePath).toLowerCase();
  let entry = staticCache.get(filePath);
  if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
    const buf = await fs.promises.readFile(filePath);
    entry = { mtimeMs: stat.mtimeMs, size: stat.size, buf, gzip: null, etag: 'W/"' + stat.size.toString(16) + "-" + Math.floor(stat.mtimeMs).toString(16) + '"' };
    if (COMPRESSIBLE.has(ext) && buf.length > 1024) entry.gzip = zlib.gzipSync(buf, { level: 9 });
    if (buf.length < 2 * 1024 * 1024) staticCache.set(filePath, entry); else staticCache.delete(filePath);
  }
  const headers = { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "ETag": entry.etag, "Vary": "Accept-Encoding" };
  if (options.fonts) { headers["Cache-Control"] = "public, max-age=31536000, immutable"; headers["Access-Control-Allow-Origin"] = "*"; }
  else if (ext === ".html" || ext === ".js" || ext === ".css") headers["Cache-Control"] = "no-cache"; // всегда сверяем ETag: после деплоя отдаётся свежая версия
  else headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=86400";
  if (req.headers["if-none-match"] === entry.etag) { res.writeHead(304, headers); res.end(); return; }
  let body = entry.buf;
  if (entry.gzip && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) { body = entry.gzip; headers["Content-Encoding"] = "gzip"; }
  headers["Content-Length"] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error("Unhandled request error:", req.method, req.url, error && error.stack || error);
    try {
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "Внутренняя ошибка сервера." })); }
      else res.end();
    } catch (_) {}
  });
});
// За прокси (Render/Cloudflare) keep-alive сервера должен быть длиннее, чем у прокси — иначе редкие 502.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;

const jackboxWebSocketServer = new WebSocket.Server({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  let requestUrl;
  try { requestUrl = new URL(req.url, "http://" + (req.headers.host || "localhost")); } catch (_) { socket.destroy(); return; }
  if (requestUrl.pathname !== "/api/jackbox/socket") { socket.destroy(); return; }
  const origin = req.headers.origin;
  if (!origin || (() => { try { return new URL(origin).host !== req.headers.host; } catch (_) { return true; } })()) { socket.destroy(); return; }
  const ticket = requestUrl.searchParams.get("ticket") || "";
  const session = jackboxTickets.get(ticket);
  if (!session || session.expiresAt < Date.now()) { jackboxTickets.delete(ticket); socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
  jackboxTickets.delete(ticket);
  jackboxWebSocketServer.handleUpgrade(req, socket, head, client => {
    const endpoint = session.role === "audience" ? "/api/v2/audience/" : "/api/v2/rooms/";
    const upstreamUrl = "wss://" + session.host + endpoint + encodeURIComponent(session.code) + "/play?role=" + session.role + "&name=" + encodeURIComponent(session.name) + "&format=json&user-id=" + encodeURIComponent(session.userId) + "&secret=" + encodeURIComponent(session.secret);
    const upstream = new WebSocket(upstreamUrl, "ecast-v0", { handshakeTimeout: 10000 });
    const pending = [];
    client.on("message", data => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data); else if (upstream.readyState === WebSocket.CONNECTING && pending.length < 20) pending.push(data); });
    client.on("close", () => { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(); });
    client.on("error", () => { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate(); });
    upstream.on("open", () => { for (const data of pending.splice(0)) upstream.send(data); });
    upstream.on("message", data => { if (client.readyState === WebSocket.OPEN) client.send(data); });
    upstream.on("close", (code, reason) => { if (client.readyState === WebSocket.OPEN) client.close(code || 1000, reason.toString().slice(0, 120)); });
    upstream.on("error", () => { if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify({ pc: 0, opcode: "error", result: { msg: "Не удалось установить соединение с сервером игры." } })); client.close(1011, "Upstream connection failed"); } });
  });
});

process.on("unhandledRejection", reason => console.error("Unhandled rejection:", reason && reason.stack || reason));
process.on("uncaughtException", error => console.error("Uncaught exception:", error && error.stack || error));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  console.log(signal + " received, shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
// Чистим просроченные сессии, билеты и счётчики лимитов — раньше эти Map росли бесконечно.
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of musicSessions) if (item.expiresAt <= now) musicSessions.delete(id);
  const communitySessionStore = globalThis.__communitySessions;
  if (communitySessionStore) for (const [id, item] of communitySessionStore) if (item.expiresAt < now) communitySessionStore.delete(id);
  for (const [key, item] of jackboxTickets) if (item.expiresAt < now) jackboxTickets.delete(key);
  const windows = [[musicRequestRate, 3600000], [musicLoginRate, 600000], [communityLoginRate, 600000], [jackboxRoomChecks, 60000], [globalThis.__communityRateStore, 3600000]];
  for (const [store, windowMs] of windows) {
    if (!store) continue;
    for (const [key, list] of store) { const fresh = list.filter(t => now - t < windowMs); if (fresh.length) store.set(key, fresh); else store.delete(key); }
  }
}, 5 * 60_000).unref();

server.listen(PORT, () => {
  console.log(`1°6 Community running at http://localhost:${PORT}`);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn("Missing TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET. Live statuses will not work until configured.");
  }
});
