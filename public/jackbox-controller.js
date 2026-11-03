(() => {
  const form = document.getElementById("joinForm");
  const room = document.getElementById("room");
  const nickname = document.getElementById("nickname");
  const status = document.getElementById("status");
  const button = document.getElementById("joinButton");
  if (!form || !room || !nickname || !status || !button) return;
  let connection = null;

  const show = (message, error = false) => {
    status.className = "status show" + (error ? " error" : "");
    status.textContent = message;
  };
  room.addEventListener("input", () => { room.value = room.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4); });
  try { const saved = localStorage.getItem("ss-jackbox-nickname"); if (saved && !nickname.value) nickname.value = saved; } catch (_) {}

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (connection && connection.readyState <= WebSocket.OPEN) connection.close();
    const code = room.value.trim().toUpperCase();
    const name = nickname.value.trim();
    if (!/^[A-Z]{4}$/.test(code) || !name) { show("Введи четырёхбуквенный код комнаты и никнейм.", true); return; }
    button.disabled = true;
    button.textContent = "ПРОВЕРЯЕМ КОМНАТУ…";
    show("Проверяю комнату на сервере Jackbox…");
    try {
      const response = await fetch("/api/jackbox/room-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: code, nickname: name })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось проверить комнату.");
      try { localStorage.setItem("ss-jackbox-nickname", name); } catch (_) {}
      show("Комната найдена: " + result.room + " · " + result.game + ". Подключаю игрока…");
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      connection = new WebSocket(scheme + "//" + location.host + "/api/jackbox/socket?ticket=" + encodeURIComponent(result.ticket), "ecast-v0");
      connection.addEventListener("open", () => {
        show("WebSocket-соединение установлено с комнатой " + result.room + " (" + result.game + "). Ожидаю состояние игры…");
        button.textContent = "ПОДКЛЮЧЕНО";
      });
      connection.addEventListener("message", event => {
        let packet;
        try { packet = JSON.parse(event.data); } catch (_) { show("Получены данные игры (бинарный пакет)."); return; }
        if (packet.opcode === "error") show("Ошибка Jackbox: " + (packet.result?.msg || "сервер отклонил подключение"), true);
        else if (packet.opcode) show("Подключено к " + result.game + ". Событие сервера: " + packet.opcode + ". Следующий этап — обработчики игровых экранов.");
      });
      connection.addEventListener("close", event => {
        if (button.textContent === "ПОДКЛЮЧЕНО") { show("Соединение закрыто (код " + event.code + "). Проверь, что игра ещё открыта."); button.textContent = "ПОДКЛЮЧИТЬСЯ"; }
        button.disabled = false;
      });
      connection.addEventListener("error", () => { show("Не удалось открыть соединение с комнатой. Проверь код и попробуй ещё раз.", true); button.disabled = false; button.textContent = "ПОДКЛЮЧИТЬСЯ"; });
    } catch (error) {
      show(error.message || "Ошибка подключения.", true);
      button.disabled = false;
      button.textContent = "ПОДКЛЮЧИТЬСЯ";
    }
  });
})();