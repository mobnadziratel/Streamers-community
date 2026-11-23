/* Пасхалка: 5 нажатий на логотип — участники выезжают на маленьких машинках.
   Работает на всех страницах с логотипом. Страница может задать источник данных:
   window.SSC_CARS_SOURCE = () => ({ people: [{name}], loadAvatar(person, index, img) })            */
(function () {
  if (window.__sscCarsInit) return;
  window.__sscCarsInit = true;

  var CAR_COLORS = ['#ff5468', '#ffb020', '#35c47c', '#2d9cff', '#a96bff', '#ff7ac6', '#14c8c8', '#f5f5f0'];
  var PALETTES = [['#c5ff54', '#1c2412'], ['#8b63f5', '#1b1530'], ['#ff78ba', '#2b1220'], ['#53d6ff', '#0f2230'], ['#ffd36b', '#2c2208']];
  var avatarCache = {};
  var run = 0, overlay = null, timers = [], anims = [];

  /* ---------- стили ---------- */
  var css = '' +
    '.sscar-overlay{position:fixed;inset:0;z-index:99999;overflow:hidden;pointer-events:none;contain:layout paint style;animation:sscar-fade .35s ease both}' +
    '@keyframes sscar-fade{from{opacity:0}to{opacity:1}}' +
    '.sscar-road{position:absolute;left:0;right:0;height:4px;border-radius:2px;opacity:.55;' +
    'background:repeating-linear-gradient(90deg,rgba(255,255,255,.55) 0 18px,transparent 18px 38px);box-shadow:0 0 0 1px rgba(0,0,0,.12),0 6px 0 -2px rgba(0,0,0,.18)}' +
    '.sscar{position:absolute;left:0;will-change:transform}' +
    '.sscar-inner{position:relative;width:100%;height:100%;animation:sscar-bob .38s ease-in-out infinite alternate}' +
    '@keyframes sscar-bob{from{transform:translateY(0) rotate(-.4deg)}to{transform:translateY(-2px) rotate(.5deg)}}' +
    '.sscar-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;z-index:2}' +
    '.sscar.rtl .sscar-svg{transform:scaleX(-1)}' +
    '.sscar-avatar{position:absolute;z-index:1;left:33%;top:-16%;width:34%;aspect-ratio:1/1;padding:2px;border-radius:50%;' +
    'background:linear-gradient(140deg,#c5ff54,#8b63f5 58%,#ff78ba);box-shadow:0 4px 12px rgba(0,0,0,.28)}' +
    '.sscar-avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.92);background:#24212f}' +
    '.sscar-name{position:absolute;z-index:3;left:50%;bottom:calc(100% + 4px);transform:translateX(-50%);max-width:170%;padding:2px 8px;border-radius:999px;' +
    'font:800 11px/1.25 Manrope,Inter,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff;background:rgba(10,18,36,.78);border:1px solid rgba(255,255,255,.22)}' +
    '.sscar-wheel{animation:sscar-spin .36s linear infinite;transform-box:fill-box;transform-origin:center}' +
    '@keyframes sscar-spin{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.sscar-inner,.sscar-wheel{animation:none}}';
  var st = document.createElement('style'); st.id = 'sscar-style'; st.textContent = css;
  document.head.appendChild(st);

  /* ---------- вспомогательное ---------- */
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function placeholder(name, i) {
    var pal = PALETTES[(i == null ? hash(name) : i) % PALETTES.length], a = pal[0], b = pal[1];
    var ini = esc(String(name).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase());
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="' + b + '"/><circle cx="80" cy="61" r="27" fill="' + a + '" opacity=".9"/><path d="M31 145c3-30 22-45 49-45s46 15 49 45" fill="' + a + '"/><text x="80" y="154" font-family="Arial,sans-serif" font-size="20" font-weight="900" text-anchor="middle" fill="' + b + '">' + ini + '</text></svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }
  function defaultLoadAvatar(person, index, img) {
    var name = person.name;
    img.src = placeholder(name, index);
    if (avatarCache[name]) { img.src = avatarCache[name]; return; }
    fetch('/api/avatar?login=' + encodeURIComponent(name), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (p) {
        var u = String((p && p.avatarUrl) || '').trim();
        if (!/^https:\/\//i.test(u)) throw 0;
        avatarCache[name] = u; img.onerror = function () { img.onerror = null; img.src = placeholder(name, index); }; img.src = u;
      }).catch(function () { /* остаётся заглушка */ });
  }
  function carSvg(color) {
    return '<svg class="sscar-svg" viewBox="0 0 160 82" aria-hidden="true" style="--car:' + color + '">' +
      '<ellipse cx="80" cy="79" rx="64" ry="3.5" fill="rgba(0,0,0,.28)"/>' +
      '<path d="M6 66C6 52 12 48 26 46L58 44C62 44 64 40 68 40H104C110 40 114 44 120 46L142 49C152 51 156 56 156 64V68C156 70 154 71 152 71H10C7 71 6 69 6 66Z" style="fill:var(--car)"/>' +
      '<path d="M6 61H156" stroke="rgba(255,255,255,.38)" stroke-width="3"/>' +
      '<path d="M64 46V67" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/>' +
      '<path d="M101 40L117 46H101Z" fill="rgba(190,235,255,.85)"/>' +
      '<rect x="8" y="53" width="5" height="6" rx="2" fill="#ff3b4d"/>' +
      '<ellipse cx="153" cy="56" rx="3.5" ry="4" fill="#fff6b0"/><ellipse cx="157" cy="56" rx="8" ry="6" fill="rgba(255,246,176,.3)"/>' +
      '<circle cx="38" cy="69" r="13.5" fill="#15151b"/><circle cx="122" cy="69" r="13.5" fill="#15151b"/>' +
      '<g class="sscar-wheel"><circle cx="38" cy="69" r="11" fill="#22222b"/><circle cx="38" cy="69" r="5.5" fill="#cfd4de"/><path d="M38 63v12M32 69h12" stroke="#6b7280" stroke-width="2"/></g>' +
      '<g class="sscar-wheel"><circle cx="122" cy="69" r="11" fill="#22222b"/><circle cx="122" cy="69" r="5.5" fill="#cfd4de"/><path d="M122 63v12M116 69h12" stroke="#6b7280" stroke-width="2"/></g>' +
      '</svg>';
  }
  function stop() {
    run++;
    timers.forEach(clearTimeout); timers = [];
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); anims = [];
    if (overlay) { overlay.remove(); overlay = null; }
  }

  /* ---------- запуск парада ---------- */
  function launch(people, loadAvatar) {
    stop();
    var runId = run;
    var seen = {}, list = (people || []).filter(function (p) {
      var k = String((p && p.name) || '').trim().toLowerCase();
      if (!k || seen[k]) return false; seen[k] = 1; return true;
    });
    if (!list.length) return;
    for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = list[i]; list[i] = list[j]; list[j] = t; }

    var vw = window.innerWidth, vh = window.innerHeight;
    var carW = Math.max(112, Math.min(170, vw * 0.14)), carH = carW * 82 / 160;
    var laneH = carH + 34;
    var laneCount = Math.max(1, Math.min(Math.floor((vh - 24) / laneH), Math.ceil(list.length / 4)));
    var startY = Math.max(10, (vh - laneCount * laneH) / 2);

    overlay = document.createElement('div'); overlay.className = 'sscar-overlay'; overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
    var lanes = [];
    for (var l = 0; l < laneCount; l++) {
      var road = document.createElement('div'); road.className = 'sscar-road';
      road.style.top = (startY + l * laneH + 34 + carH - 4) + 'px'; overlay.appendChild(road);
      var dur = 3.2 + Math.random() * 1.5;
      lanes.push({ y: startY + l * laneH + 34, rtl: l % 2 === 1, speed: (vw + 2 * carW) / dur, dur: dur * 1000, t: Math.random() * 500, queue: [] });
    }
    list.forEach(function (p, idx) { lanes[idx % laneCount].queue.push({ p: p, idx: idx }); });

    var remaining = list.length;
    function finish() { remaining--; if (remaining <= 0 && runId === run) { var o = overlay; if (o) { o.style.transition = 'opacity .4s'; o.style.opacity = '0'; timers.push(setTimeout(function () { if (runId === run) stop(); }, 450)); } } }

    lanes.forEach(function (lane) {
      lane.queue.forEach(function (item) {
        var startAt = lane.t;
        lane.t += ((carW * (1.5 + Math.random() * 1.3)) / lane.speed) * 1000;
        timers.push(setTimeout(function () {
          if (runId !== run) return;
          var el = document.createElement('div');
          el.className = 'sscar' + (lane.rtl ? ' rtl' : '');
          el.style.cssText = 'top:' + lane.y + 'px;width:' + carW + 'px;height:' + carH + 'px';
          el.innerHTML = '<div class="sscar-inner">' +
            '<div class="sscar-avatar"><img alt="" decoding="async"></div>' +
            '<span class="sscar-name">' + esc(item.p.name) + '</span>' + carSvg(CAR_COLORS[hash(item.p.name + item.idx) % CAR_COLORS.length]) + '</div>';
          overlay.appendChild(el);
          (loadAvatar || defaultLoadAvatar)(item.p, item.idx, el.querySelector('img'));
          var from = lane.rtl ? vw + carW * 0.1 : -carW * 1.1, to = lane.rtl ? -carW * 1.1 : vw + carW * 0.1;
          var a = el.animate([{ transform: 'translate3d(' + from + 'px,0,0)' }, { transform: 'translate3d(' + to + 'px,0,0)' }], { duration: lane.dur, easing: 'linear', fill: 'both' });
          anims.push(a);
          a.onfinish = function () { el.remove(); finish(); };
        }, startAt));
      });
    });
  }

  /* ---------- 5 нажатий на логотип ---------- */
  function init() {
    var logo = document.querySelector('.logo'); if (!logo) return;
    var link = logo.closest('a[href]');
    var taps = 0, resetT = null, navT = null;
    function begin() {
      var src = typeof window.SSC_CARS_SOURCE === 'function' ? window.SSC_CARS_SOURCE() : null;
      var people, loader;
      if (src) { people = src.people; loader = src.loadAvatar; }
      else { var d = window.SSC_PEOPLE || {}; people = (d.streamers || []).concat(d.moderators || []).map(function (n) { return { name: n }; }); }
      launch(people, loader);
    }
    function tap(e) {
      if (link && e) e.preventDefault();               /* на «Рекламе» лого — ссылка на главную */
      taps++;
      logo.classList.remove('logo-tap-pop'); void logo.offsetWidth; logo.classList.add('logo-tap-pop');
      clearTimeout(resetT); resetT = setTimeout(function () { taps = 0; }, 2500);
      clearTimeout(navT);
      if (taps >= 5) { taps = 0; clearTimeout(resetT); begin(); return; }
      if (link) navT = setTimeout(function () { location.href = link.href; }, 650);   /* одиночный клик — обычный переход */
    }
    logo.addEventListener('click', tap);
    logo.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(null); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay) stop(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SSCCars = { launch: launch, stop: stop };
})();
