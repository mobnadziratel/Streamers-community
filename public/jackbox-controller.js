(() => {
  const form = document.getElementById("joinForm");
  const room = document.getElementById("room");
  const nickname = document.getElementById("nickname");
  const status = document.getElementById("status");
  const button = document.getElementById("joinButton");
  if (!form || !room || !nickname || !status || !button) return;

  const show = (message, error = false) => {
    status.className = "status show" + (error ? " error" : "");
    status.textContent = message;
  };
  room.addEventListener("input", () => {
    room.value = room.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4);
  });
  try {
    const saved = localStorage.getItem("ss-jackbox-nickname");
    if (saved && !nickname.value) nickname.value = saved;
  } catch (_) {}

  form.addEventListener("submit", event => {
    event.preventDefault();
    const code = room.value.trim().toUpperCase();
    const name = nickname.value.trim();
    if (!/^[A-Z]{4}$/.test(code) || !name) {
      show("Введи четырёхбуквенный код комнаты и никнейм.", true);
      return;
    }
    try { localStorage.setItem("ss-jackbox-nickname", name); } catch (_) {}
    show(
      "Данные сохранены: комната " + code + ", игрок " + name +
      ". Подключение к Jackbox пока отключено: сначала завершается локальная реализация и проверка адаптера Quiplash 3. Запросы к оригинальному серверу сейчас не отправляются."
    );
    button.disabled = true;
    button.textContent = "АДАПТЕР ГОТОВИТСЯ";
  });
})();