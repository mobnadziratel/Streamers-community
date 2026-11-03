(() => {
  const form = document.getElementById("joinForm");
  const room = document.getElementById("room");
  const nickname = document.getElementById("nickname");
  const status = document.getElementById("status");
  const button = document.getElementById("joinButton");
  if (!form || !room || !nickname || !status || !button) return;

  room.addEventListener("input", () => {
    room.value = room.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
  });

  try {
    const saved = localStorage.getItem("ss-jackbox-nickname");
    if (saved && !nickname.value) nickname.value = saved;
  } catch (_) {}

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = room.value.trim().toUpperCase();
    const name = nickname.value.trim();
    if (code.length < 4 || !name) {
      status.className = "status show error";
      status.textContent = "Проверь код комнаты и никнейм.";
      return;
    }
    try { localStorage.setItem("ss-jackbox-nickname", name); } catch (_) {}
    status.className = "status show";
    status.innerHTML = "<strong>Данные готовы.</strong><br>Комната: " +
      code.replace(/[&<>"]/g, "") + "<br>Игрок: " +
      name.replace(/[&<>"]/g, "") +
      "<br><br>Игровой адаптер пока не подключён. Нужна реализация и проверка протокола выбранной игры, прежде чем отправлять запрос на оригинальный сервер Jackbox.";
  });
})();