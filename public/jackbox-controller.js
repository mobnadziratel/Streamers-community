(() => {
  const form = document.getElementById("joinForm");
  const roomInput = document.getElementById("room");
  const nicknameInput = document.getElementById("nickname");
  const status = document.getElementById("status");
  const button = document.getElementById("joinButton");
  const gameScreen = document.getElementById("gameScreen");
  const gameTitle = document.getElementById("gameTitle");
  const gamePrompt = document.getElementById("gamePrompt");
  const gameChoices = document.getElementById("gameChoices");
  const gameHint = document.getElementById("gameHint");
  if (!form || !roomInput || !nicknameInput || !status || !button) return;

  const show = (message, error = false) => {
    status.className = "status show" + (error ? " error" : "");
    status.textContent = message;
  };
  const parseValue = value => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch (_) { return value; }
  };
  const state = {
    room: {}, player: {}, playerId: null, hostId: null,
    textKey: null, seq: 0, connected: false
  };

  // Pure Ecast packet reducer. It deliberately sends nothing while offline.
  const reduce = packet => {
    if (!packet || typeof packet !== "object") return state;
    if (packet.opcode === "client/welcome") {
      const result = packet.result || {};
      state.playerId = result.id ?? result.playerId ?? state.playerId;
      state.hostId = result.here ?? result.hostId ?? state.hostId;
      const entities = result.objects || result.entities || [];
      if (Array.isArray(entities)) entities.forEach(entity => {
        if (!entity || !entity.key) return;
        applyEntity(entity.key, entity.val);
      });
      state.connected = true;
    } else if (["object", "text", "number"].includes(packet.opcode)) {
      const result = packet.result || {};
      if (result.key) applyEntity(result.key, result.val);
    }
    return state;
  };
  const applyEntity = (key, raw) => {
    const value = parseValue(raw);
    if (key === "room" && value && typeof value === "object") {
      Object.assign(state.room, value);
    } else if (state.playerId != null && key === "player:" + state.playerId && value && typeof value === "object") {
      Object.assign(state.player, value);
      if (typeof value.textKey === "string") state.textKey = value.textKey;
    } else if (key === "player" && value && typeof value === "object") {
      Object.assign(state.player, value);
      if (typeof value.textKey === "string") state.textKey = value.textKey;
    }
    render();
  };
  const sendFrame = (opcode, params) => {
    if (!state.connected || state.playerId == null || state.hostId == null) {
      throw new Error("Нет подтверждённого состояния игрока от сервера.");
    }
    return { seq: ++state.seq, opcode, params };
  };
  const avatarFrame = characterName => sendFrame("client/send", {
    from: state.playerId, to: state.hostId,
    body: { action: "avatar", name: characterName }
  });
  const startFrame = () => sendFrame("client/send", {
    from: state.playerId, to: state.hostId, body: { action: "start" }
  });
  const answerFrame = answer => {
    if (!state.textKey) throw new Error("Игра ещё не прислала ключ поля ответа.");
    return sendFrame("text/update", { key: state.textKey, val: answer });
  };
  const render = () => {
    if (!gameScreen) return;
    const merged = { ...state.room, ...state.player };
    const phase = merged.state || "Подключение";
    gameScreen.hidden = !state.connected;
    if (!state.connected) return;
    gameTitle.textContent = phase === "Lobby" ? "Ожидание игроков" :
      phase === "EnterSingleText" ? "Твой ответ" :
      phase === "MakeSingleChoice" ? "Выбери ответ" : "Quiplash 3";
    gamePrompt.textContent = typeof merged.prompt === "string" ? merged.prompt :
      (merged.prompt && (merged.prompt.text || merged.prompt.html)) || "Ожидаем следующий экран игры…";
    gameHint.textContent = "Состояние игры: " + phase;
    gameChoices.replaceChildren();
    if (phase === "Lobby" && Array.isArray(merged.characters)) {
      merged.characters.filter(item => item && item.available).forEach(item => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "choice";
        b.textContent = item.name;
        b.addEventListener("click", () => show("Персонаж выбран локально. Отправка будет доступна после проверки соединения."));
        gameChoices.appendChild(b);
      });
    } else if (phase === "EnterSingleText") {
      const input = document.createElement("textarea");
      input.maxLength = Number(merged.maxLength) || 45;
      input.placeholder = "Напиши смешной ответ…";
      input.className = "answer";
      const send = document.createElement("button");
      send.type = "button"; send.className = "btn"; send.textContent = "ОТПРАВИТЬ ОТВЕТ";
      send.addEventListener("click", () => show("Ответ подготовлен. Отправка будет включена после проверки Ecast-соединения."));
      gameChoices.append(input, send);
    } else if (Array.isArray(merged.choices)) {
      merged.choices.forEach((choice, index) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "choice";
        b.textContent = typeof choice === "string" ? choice : choice.text || choice.value || ("Вариант " + (index + 1));
        gameChoices.appendChild(b);
      });
    }
  };

  // Exposed only for deterministic local protocol fixtures and future socket wiring.
  window.JackboxQuiplash3Adapter = Object.freeze({
    receive: raw => { let packet = raw; if (typeof raw === "string") packet = JSON.parse(raw); return reduce(packet); },
    getState: () => JSON.parse(JSON.stringify(state)),
    buildAvatarFrame: avatarFrame,
    buildStartFrame: startFrame,
    buildAnswerFrame: answerFrame
  });

  roomInput.addEventListener("input", () => {
    roomInput.value = roomInput.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4);
  });
  try {
    const saved = localStorage.getItem("ss-jackbox-nickname");
    if (saved && !nicknameInput.value) nicknameInput.value = saved;
  } catch (_) {}

  form.addEventListener("submit", event => {
    event.preventDefault();
    const code = roomInput.value.trim().toUpperCase();
    const name = nicknameInput.value.trim();
    if (!/^[A-Z]{4}$/.test(code) || !name) {
      show("Введи четырёхбуквенный код комнаты и никнейм.", true);
      return;
    }
    try { localStorage.setItem("ss-jackbox-nickname", name); } catch (_) {}
    show("Данные сохранены: комната " + code + ", игрок " + name +
      ". Локальный адаптер Quiplash 3 подготовлен; реальное подключение пока выключено до проверки полного обмена Ecast-пакетами.");
    button.disabled = true;
    button.textContent = "АДАПТЕР НА ПРОВЕРКЕ";
  });
})();