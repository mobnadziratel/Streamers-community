// Нижняя строка «Сейчас в эфире»: всегда одна строка; если стримеры не помещаются — лента плавно бежит.
(() => {
  const css = `
#winter-snowdrift{height:36px!important}
#winter-live-ticker{flex-direction:row!important;flex-wrap:nowrap!important;justify-content:flex-start!important;align-items:center!important;gap:10px!important;padding:0 84px 0 92px!important;font-size:11px!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden}
.winter-ticker-label{flex:0 0 auto;position:relative;z-index:2;padding-right:6px}
.winter-ticker-names{flex:1 1 auto!important;min-width:0!important;flex-wrap:nowrap!important;justify-content:center!important;gap:0!important;overflow:hidden;position:relative;-webkit-mask-image:linear-gradient(90deg,transparent,#000 18px,#000 calc(100% - 18px),transparent);mask-image:linear-gradient(90deg,transparent,#000 18px,#000 calc(100% - 18px),transparent)}
.winter-ticker-track{display:inline-flex;align-items:center;gap:9px;white-space:nowrap;will-change:transform}
.winter-ticker-names.is-marquee{justify-content:flex-start!important}
.winter-ticker-names.is-marquee .winter-ticker-track{animation:winter-ticker-scroll var(--ticker-dur,30s) linear infinite}
.winter-ticker-names.is-marquee:hover .winter-ticker-track{animation-play-state:paused}
@keyframes winter-ticker-scroll{to{transform:translateX(-50%)}}
@media(max-width:650px){#winter-live-ticker{padding:0 54px 0 58px!important;font-size:10px!important;gap:7px!important}.winter-ticker-label{font-size:8px!important}}
@media(prefers-reduced-motion:reduce){.winter-ticker-names.is-marquee{overflow-x:auto}.winter-ticker-names.is-marquee .winter-ticker-track{animation:none}}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  let busy = false;
  function fit(names) {
    if (busy) return; busy = true;
    try {
      let track = names.querySelector(":scope > .winter-ticker-track");
      if (!track) { track = document.createElement("span"); track.className = "winter-ticker-track"; while (names.firstChild) track.appendChild(names.firstChild); names.appendChild(track); }
      track.querySelectorAll("[data-clone]").forEach(n => n.remove());
      names.classList.remove("is-marquee"); track.style.removeProperty("transform");
      if (track.scrollWidth > names.clientWidth + 2) {
        const sep = document.createElement("span"); sep.className = "winter-ticker-separator"; sep.textContent = "✦"; sep.dataset.clone = "1"; sep.setAttribute("aria-hidden", "true");
        const originals = [...track.children].filter(n => !n.dataset.clone);
        track.appendChild(sep);
        for (const n of originals) { const c = n.cloneNode(true); c.dataset.clone = "1"; c.setAttribute("aria-hidden", "true"); c.tabIndex = -1; track.appendChild(c); }
        track.appendChild(sep.cloneNode(true));
        names.classList.add("is-marquee");
        track.style.setProperty("--ticker-dur", Math.max(16, track.scrollWidth / 2 / 42).toFixed(1) + "s");
      }
    } finally { busy = false; }
  }
  function boot() {
    const names = document.querySelector(".winter-ticker-names");
    if (!names) return setTimeout(boot, 300);
    const refit = () => fit(names);
    new MutationObserver(muts => { if (!busy && muts.some(m => m.target === names)) refit(); }).observe(names, { childList: true });
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(refit, 150); });
    refit();
  }
  boot();
})();
