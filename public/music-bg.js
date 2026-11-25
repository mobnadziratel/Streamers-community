/* Фоновый плейлист для музыкальных плееров (оверлей OBS и музыкальный док).

   Логика: пока в очереди нет заказов — играет фоновый плейлист. Пришёл заказ — фон прерывается
   (запоминаем трек и секунду), заказ играет как обычно. Очередь опустела — фон продолжается с того
   же места. Заказами владеет сам плеер-страница, этот модуль только управляет фоном.

   const bg = MusicBg.create({
     channel:      () => "логин",
     getPlayer:    () => YT.Player | null,
     isReady:      () => boolean,
     applyVolume:  () => void,                 // страница выставляет громкость через bg.volumeFor(base)
     onMode:       (active, cfg) => void,      // фон включился / выключился (для показа/скрытия видео)
     onTrack:      ({title, author, listName}) => void,
     onFail:       () => void                  // ни один трек плейлиста не воспроизводится
   });
   bg.sync(state.bg, orderActive)  — вызывать при каждом опросе очереди; возвращает true, если фон играет
   bg.suspend()                    — вызвать перед запуском заказа
   bg.handleState(event) / bg.handleError() — из обработчиков YouTube-плеера (handleError → true, если ошибку забрал фон) */
(function () {
  "use strict";
  var LS_PREFIX = "ssc-music-bg:";

  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function sameSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    var set = {}, i;
    for (i = 0; i < b.length; i++) set[b[i]] = 1;
    for (i = 0; i < a.length; i++) if (!set[a[i]]) return false;
    return true;
  }

  function create(o) {
    var mode = "";              // "bg" — сейчас играет фон
    var cfg = null;             // последнее состояние фона с сервера
    var resume = readResume();  // { key, type, shuffle, order, index, time }
    var lastSkip = null, errStreak = 0, tick = null, lastShuffle = null, lastPaused = null;

    function player() { return o.getPlayer && o.getPlayer(); }
    function ready() { return Boolean(o.isReady && o.isReady() && player()); }
    function lsKey() { return LS_PREFIX + (o.channel ? o.channel() : ""); }
    function readResume() {
      try { var r = JSON.parse(localStorage.getItem(lsKey()) || "null"); return r && typeof r === "object" ? r : null; } catch (_) { return null; }
    }
    function writeResume() { try { if (resume) localStorage.setItem(lsKey(), JSON.stringify(resume)); } catch (_) {} }
    function state() { try { return player().getPlayerState(); } catch (_) { return -2; } }

    // Запоминаем, где остановились (номер трека и секунда).
    function saveProgress() {
      var pl = player();
      if (!resume || !pl || !ready()) return;
      try {
        var i = pl.getPlaylistIndex(), t = pl.getCurrentTime();
        if (typeof i === "number" && i >= 0) resume.index = i;
        if (typeof t === "number" && isFinite(t) && t >= 0) resume.time = Math.floor(t);
        writeResume();
      } catch (_) {}
    }
    function startTick() { stopTick(); tick = setInterval(function () { if (mode === "bg" && state() === 1) saveProgress(); }, 4000); }
    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

    var lastTrackId = "";
    function reportTrack() {
      if (!o.onTrack || mode !== "bg") return;
      try {
        var d = player().getVideoData() || {};
        if (!d.video_id || d.video_id === lastTrackId) return;   // обновляем страницу только при смене трека
        lastTrackId = d.video_id;
        o.onTrack({ title: d.title || "", author: d.author || "", videoId: d.video_id || "", listName: cfg && cfg.active ? cfg.active.name : "" });
      } catch (_) {}
    }

    // Порядок воспроизведения своего плейлиста: при перемешивании — случайный, но стабильный на время работы.
    function buildOrder(ids, shuffle, firstId) {
      if (!shuffle) return ids.slice();
      var arr = shuffled(ids);
      if (firstId) { var k = arr.indexOf(firstId); if (k > 0) { arr.splice(k, 1); arr.unshift(firstId); } }
      return arr;
    }

    function load(fresh) {
      var a = cfg.active, pl = player();
      if (!a || !pl) return false;
      var r = !fresh && resume && resume.key === a.key ? resume : null;
      var idx = 0, time = 0;
      if (a.type === "custom") {
        var ids = a.videoIds || [];
        if (!ids.length) return false;
        var useOld = r && r.type === "custom" && r.shuffle === Boolean(cfg.shuffle) && sameSet(r.order, ids);
        var order = useOld ? r.order : buildOrder(ids, cfg.shuffle);
        if (useOld) { idx = Math.max(0, Math.min(order.length - 1, r.index || 0)); time = Math.max(0, r.time || 0); }
        resume = { key: a.key, type: "custom", shuffle: Boolean(cfg.shuffle), order: order, index: idx, time: time };
        pl.loadPlaylist({ playlist: order, index: idx, startSeconds: time });
      } else {
        // Плейлист YouTube. При встроенном перемешивании порядок случайный, поэтому продолжаем со следующего трека.
        if (r && r.type === "youtube" && !cfg.shuffle && r.shuffle === false) { idx = Math.max(0, r.index || 0); time = Math.max(0, r.time || 0); }
        resume = { key: a.key, type: "youtube", shuffle: Boolean(cfg.shuffle), index: idx, time: time };
        pl.loadPlaylist({ list: a.playlistId, listType: "playlist", index: idx, startSeconds: time });
        try { pl.setShuffle(Boolean(cfg.shuffle)); } catch (_) {}
      }
      try { pl.setLoop(true); } catch (_) {}
      writeResume();
      lastShuffle = Boolean(cfg.shuffle);
      return true;
    }

    function enter() {
      if (!load(false)) return false;
      mode = "bg"; errStreak = 0;
      lastPaused = null; lastTrackId = "";
      setTimeout(reportTrack, 1200);
      startTick();
      if (o.onMode) o.onMode(true, cfg);
      if (o.applyVolume) o.applyVolume();
      return true;
    }
    function leave(stopVideo) {
      if (mode !== "bg") return;
      saveProgress();
      mode = ""; stopTick();
      var pl = player();
      if (pl) { try { stopVideo ? pl.stopVideo() : pl.pauseVideo(); } catch (_) {} }
      if (o.onMode) o.onMode(false, cfg);
    }

    function applyChanges() {
      var pl = player();
      if (!pl) return;
      // Сменили плейлист — начинаем новый с начала.
      if (!resume || resume.key !== cfg.active.key) { load(true); if (o.applyVolume) o.applyVolume(); return; }
      // Переключили перемешивание.
      if (lastShuffle !== Boolean(cfg.shuffle)) {
        if (cfg.active.type === "custom") {
          var vid = "", time = 0;
          try { vid = (pl.getVideoData() || {}).video_id || ""; time = Math.floor(pl.getCurrentTime() || 0); } catch (_) {}
          var order = buildOrder(cfg.active.videoIds, cfg.shuffle, vid);
          resume = { key: cfg.active.key, type: "custom", shuffle: Boolean(cfg.shuffle), order: order, index: 0, time: order[0] === vid ? time : 0 };
          writeResume();
          pl.loadPlaylist({ playlist: order, index: 0, startSeconds: resume.time });
          try { pl.setLoop(true); } catch (_) {}
        } else {
          resume.shuffle = Boolean(cfg.shuffle); writeResume();
          try { pl.setShuffle(Boolean(cfg.shuffle)); } catch (_) {}
        }
        lastShuffle = Boolean(cfg.shuffle);
      }
      // Команда «следующий фоновый трек».
      if (lastSkip !== null && cfg.skipSeq !== lastSkip) { try { pl.nextVideo(); } catch (_) {} }
      lastSkip = cfg.skipSeq;
      // Пауза фона.
      if (lastPaused !== Boolean(cfg.paused)) {
        lastPaused = Boolean(cfg.paused);
        try { cfg.paused ? pl.pauseVideo() : pl.playVideo(); } catch (_) {}
      } else if (!cfg.paused) {
        var st = state();
        if (st === -1 || st === 5 || st === 2) { try { pl.playVideo(); } catch (_) {} }   // страховка, если автозапуск не сработал
      }
      if (o.onMode) o.onMode(true, cfg);
      if (o.applyVolume) o.applyVolume();
    }

    var api = {
      // Вызывается при каждом опросе. orderActive = true, когда в очереди есть заказ.
      sync: function (bgState, orderActive) {
        cfg = bgState || null;
        if (orderActive) { api.suspend(); return false; }
        var usable = Boolean(cfg && cfg.enabled && cfg.active);
        if (!usable) { if (mode === "bg") leave(true); return false; }
        if (!ready()) return false;
        if (mode === "bg") reportTrack();
        if (lastSkip === null) lastSkip = cfg.skipSeq;
        if (mode !== "bg") { return cfg.paused ? false : enter(); }   // на паузе фон не стартует — продолжится с того же места после снятия паузы
        applyChanges();
        return true;
      },
      // Заказ прерывает фон: запоминаем позицию и освобождаем плеер.
      suspend: function () { if (mode === "bg") leave(false); },
      isActive: function () { return mode === "bg"; },
      volumeFor: function (base) { return mode === "bg" && cfg ? Math.round(base * Math.max(0, Math.min(100, cfg.volume)) / 100) : base; },
      handleState: function (event) {
        if (mode !== "bg" || !event) return;
        if (event.data === 1) { errStreak = 0; reportTrack(); }
      },
      // true — ошибку обработал фон (страница не должна пропускать заказ).
      handleError: function () {
        if (mode !== "bg") return false;
        errStreak++;
        var limit = resume && resume.type === "custom" && resume.order ? resume.order.length : 25;
        if (errStreak >= limit) { leave(true); if (o.onFail) o.onFail(); return true; }
        try { player().nextVideo(); } catch (_) {}
        return true;
      },
      // Браузер может не дать запустить звук без клика: первое нажатие запускает фон.
      nudge: function () {
        if (mode !== "bg" || (cfg && cfg.paused)) return;
        var st = state();
        if (st === -1 || st === 5 || st === 2) { try { player().playVideo(); } catch (_) {} }
      },
      forgetProgress: function () { resume = null; try { localStorage.removeItem(lsKey()); } catch (_) {} }
    };
    document.addEventListener("pointerdown", api.nudge, { passive: true });
    return api;
  }

  window.MusicBg = { create: create };
})();
