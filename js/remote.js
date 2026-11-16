// Телефон: копия окна поверх игры. Компьютер шлёт готовую разметку сетки по WebRTC (PeerJS),
// телефон рисует её и отправляет назад нажатия. Адрес компьютера — в части после «#» (из QR-кода).
(() => {
  const GAP = 2;
  const peerId = decodeURIComponent(location.hash.slice(1));
  const root = document.getElementById("root");
  const statusEl = document.getElementById("rstatus");
  const spriteEl = document.getElementById("rsprite");

  const status = (text, kind = "") => {
    statusEl.className = `rstatus ${kind}`;
    statusEl.innerHTML = `<span></span>`;
    statusEl.firstChild.textContent = text;
  };
  if (!peerId) {
    status("Нет адреса компьютера", "bad");
    root.innerHTML = `<p class="rhelp">Откройте эту страницу по QR-коду: на компьютере нажмите <b>«Телефон»</b>.</p>`;
    return;
  }
  if (typeof Peer !== "function") {
    status("Не загрузилась библиотека связи — обновите страницу", "bad");
    return;
  }

  let peer = null, conn = null, version = 0, sentCell = 0, cur = null, retryTimer = null, wait = 2000, wake = null;

  // Размер клетки под ширину телефона (как fitMiniGrid в окне поверх игры, только по ширине:
  // страница прокручивается, высоту не подгоняем).
  const wantCell = () => {
    const w = Math.min(document.documentElement.clientWidth, 720) - 16;
    return Math.max(16, Math.floor((w - 8 * GAP) / 9));
  };
  const sendSize = (force = false) => {
    const cell = wantCell();
    if (!conn?.open || !force && cell === sentCell) return;
    sentCell = cell;
    conn.send({ t: "size", cell });
  };

  const later = (fn) => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(fn, wait);
    wait = Math.min(wait * 1.6, 15000);
  };

  function start() {
    peer?.destroy();
    peer = new Peer(undefined, { debug: 0 });
    peer.on("open", connect);
    peer.on("disconnected", () => {
      if (!peer.destroyed) later(() => {
        try {
          peer.reconnect();
        } catch {
          start();
        }
      });
    });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        status("Компьютер не отвечает. Откройте сайт на компьютере — подключусь сам", "bad");
        later(connect);
      } else if (["network", "server-error", "socket-error", "socket-closed", "disconnected"].includes(err.type)) {
        status("Нет связи с сервером, повторяю…", "bad");
        later(start);
      } else {
        status(`Ошибка связи: ${err.type ?? err.message ?? err}`, "bad");
        later(start);
      }
    });
  }

  function connect() {
    if (!peer || peer.destroyed || peer.disconnected) return later(start);
    try {
      conn?.close();
    } catch {
    }
    status("Подключаюсь к компьютеру…");
    const c = conn = peer.connect(peerId, { reliable: true });
    c.on("open", () => {
      if (c !== conn) return;
      wait = 2000;
      status("Подключено", "ok");
      sentCell = 0;
      sendSize(true);
      keepAwake();
    });
    c.on("data", (m) => c === conn && onData(m));
    c.on("close", () => {
      if (c !== conn) return;
      status("Связь с компьютером потеряна, переподключаюсь…", "bad");
      later(connect);
    });
    c.on("error", () => {
      if (c !== conn) return;
      later(connect);
    });
  }

  function onData(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "sprite") {
      spriteEl.innerHTML = m.svg ?? "";
      return;
    }
    if (m.t !== "html") return;
    version = m.v;
    const keep = window.scrollY;
    root.innerHTML = m.html;
    const grid = root.querySelector(".mgrid");
    if (grid && m.cell) grid.style.setProperty("--cell", `${m.cell}px`);
    window.scrollTo(0, keep);
    const now = root.querySelector(".g-cargo.cur");
    const key = now?.dataset.cargo ?? null;
    if (key && key !== cur) now.scrollIntoView({ block: "nearest" });
    cur = key;
  }

  // Нажатие: номер элемента в разметке той версии, на которую нажали. Компьютер находит тот же
  // элемент у себя и выполняет то же, что при нажатии в окне поверх игры.
  root.addEventListener("click", (e) => {
    if (!conn?.open) return;
    const all = root.querySelectorAll("*");
    const i = Array.prototype.indexOf.call(all, e.target);
    if (i < 0) return;
    e.preventDefault();
    conn.send({ t: "click", v: version, i });
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => sendSize(), 200);
  });

  // Экран телефона не гаснет, пока страница открыта (где браузер это умеет).
  async function keepAwake() {
    try {
      if (!wake && document.visibilityState === "visible" && navigator.wakeLock) {
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", () => {
          wake = null;
        });
      }
    } catch {
      wake = null;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    keepAwake();
    if (!conn?.open) {
      wait = 2000;
      if (!peer || peer.destroyed || peer.disconnected) start();
      else connect();
    }
  });

  start();
})();
