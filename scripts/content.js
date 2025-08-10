(function () {
  if (window.__overlayTimerInjected__) return;
  window.__overlayTimerInjected__ = true;

  const STORAGE_KEY = 'overlay_timer_state_v1';

  const defaultState = {
    x: 24,
    y: 24,
    width: 260,
    height: 140,
    isRunning: false,
    elapsedMs: 0,
    lastStartAt: null,
  };

  let state = { ...defaultState };
  let rafId = null;
  let overlayEnabled = true; // visible by default; toggled via extension action

  function clampToViewport(x, y, width, height) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampedX = Math.max(0, Math.min(x, vw - Math.max(160, width)));
    const clampedY = Math.max(0, Math.min(y, vh - Math.max(100, height)));
    return { x: clampedX, y: clampedY };
  }

  function formatTime(ms) {
    const totalMs = Math.max(0, Math.floor(ms));
    const totalSeconds = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = hours.toString().padStart(2, '0');
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function saveState(partial = {}) {
    state = { ...state, ...partial };
    try {
      chrome.storage?.local?.set({ [STORAGE_KEY]: state });
    } catch {}
  }

  function loadState() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.get([STORAGE_KEY], (res) => {
          const saved = res?.[STORAGE_KEY];
          if (saved && typeof saved === 'object') {
            state = { ...defaultState, ...saved };
          }
          // Clamp position on load in case viewport is smaller
          const clamped = clampToViewport(
            state.x,
            state.y,
            state.width,
            state.height
          );
          state.x = clamped.x;
          state.y = clamped.y;
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  // DOM
  const host = document.createElement('div');
  host.id = 'overlay-timer-root';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.left = '0px';
  host.style.top = '0px';
  host.style.width = defaultState.width + 'px';
  host.style.height = defaultState.height + 'px';
  // Allow pointer interactions for drag/resize/buttons
  host.style.pointerEvents = 'auto';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .timer-wrap {
      position: absolute;
      left: 0; top: 0; right: 0; bottom: 0;
      display: flex;
      flex-direction: column;
      border-radius: 14px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.25);
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      backdrop-filter: saturate(140%) blur(14px);
      -webkit-backdrop-filter: saturate(140%) blur(14px);
      color: #fff;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      overflow: hidden;
      pointer-events: auto;
    }

    .title-bar {
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      cursor: move;
      user-select: none;
      background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08));
      border-bottom: 1px solid rgba(255,255,255,0.12);
    }
    .title {
      font-weight: 600;
      letter-spacing: 0.2px;
      font-size: 12.5px;
      opacity: 0.9;
    }

    .time {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 28px;
      letter-spacing: 1px;
      text-shadow: 0 1px 0 rgba(0,0,0,0.4);
    }

    .controls {
      display: flex;
      gap: 8px;
      padding: 10px;
      justify-content: center;
    }

    .btn {
      appearance: none;
      border: none;
      outline: none;
      padding: 8px 12px;
      min-width: 70px;
      border-radius: 10px;
      color: #0b1220;
      font-weight: 600;
      font-size: 12.5px;
      background: linear-gradient(180deg, #ffffff, #dfe8ff);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 6px 14px rgba(0,0,0,0.18);
      cursor: pointer;
      transition: transform .06s ease, box-shadow .12s ease, opacity .15s ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); box-shadow: inset 0 1px 0 rgba(0,0,0,0.12); }

    .btn.primary {
      background: linear-gradient(180deg, #7dd3fc, #60a5fa);
      color: #0b1220;
    }
    .btn.warn {
      background: linear-gradient(180deg, #fecaca, #fca5a5);
      color: #3b0d0d;
    }

    .resize {
      position: absolute;
      width: 14px; height: 14px;
      right: 4px; bottom: 4px;
      border-radius: 3px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, rgba(255,255,255,0.6), rgba(255,255,255,0.12));
      box-shadow: inset -1px -1px 0 rgba(0,0,0,0.15);
    }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'timer-wrap';
  wrap.innerHTML = `
    <div class="title-bar">
      <div class="title">Overlay Timer</div>
      <div style="display:flex; gap:6px; align-items:center; opacity:.8; font-size:11px;">
        드래그로 이동 · 모서리로 리사이즈
      </div>
    </div>
    <div class="time" id="time">00:00:00</div>
    <div class="controls">
      <button class="btn primary" id="start">시작</button>
      <button class="btn" id="pause">멈춤</button>
      <button class="btn warn" id="reset">초기화</button>
    </div>
    <div class="resize" id="resize"></div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(wrap);

  const titleBar = wrap.querySelector('.title-bar');
  const timeEl = wrap.querySelector('#time');
  const startBtn = wrap.querySelector('#start');
  const pauseBtn = wrap.querySelector('#pause');
  const resetBtn = wrap.querySelector('#reset');
  const resizeHandle = wrap.querySelector('#resize');

  function updatePositionAndSize() {
    host.style.left = state.x + 'px';
    host.style.top = state.y + 'px';
    host.style.width = state.width + 'px';
    host.style.height = state.height + 'px';
  }

  function updateVisibility() {
    host.style.display = overlayEnabled ? 'block' : 'none';
  }

  function computeNowElapsed() {
    if (!state.isRunning || !state.lastStartAt) return state.elapsedMs;
    const delta = Date.now() - state.lastStartAt;
    return state.elapsedMs + delta;
  }

  function renderTime() {
    const ms = computeNowElapsed();
    timeEl.textContent = formatTime(ms);
  }

  function tick() {
    renderTime();
    rafId = window.requestAnimationFrame(tick);
  }

  function start() {
    if (state.isRunning) return;
    saveState({ isRunning: true, lastStartAt: Date.now() });
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    if (rafId == null) rafId = window.requestAnimationFrame(tick);
  }

  function pause() {
    if (!state.isRunning) return;
    const now = Date.now();
    const added = state.lastStartAt ? now - state.lastStartAt : 0;
    saveState({
      isRunning: false,
      elapsedMs: state.elapsedMs + added,
      lastStartAt: null,
    });
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    if (rafId != null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    renderTime();
  }

  function reset() {
    const running = state.isRunning;
    saveState({ elapsedMs: 0, lastStartAt: running ? Date.now() : null });
    renderTime();
  }

  // Drag move
  (function enableDrag() {
    let dragging = false;
    let startX = 0,
      startY = 0;
    let baseX = 0,
      baseY = 0;

    function onMouseMove(e) {
      if (!dragging) return;
      const nx = baseX + (e.clientX - startX);
      const ny = baseY + (e.clientY - startY);
      const clamped = clampToViewport(nx, ny, state.width, state.height);
      state.x = clamped.x;
      state.y = clamped.y;
      updatePositionAndSize();
    }
    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      saveState({ x: state.x, y: state.y });
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    }

    titleBar.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        baseX = state.x;
        baseY = state.y;
        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('mouseup', onMouseUp, true);
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  })();

  // Resize
  (function enableResize() {
    let resizing = false;
    let startX = 0,
      startY = 0;
    let baseW = 0,
      baseH = 0;

    function onMouseMove(e) {
      if (!resizing) return;
      const dw = e.clientX - startX;
      const dh = e.clientY - startY;
      const minW = 220,
        minH = 120;
      state.width = Math.max(minW, baseW + dw);
      state.height = Math.max(minH, baseH + dh);
      updatePositionAndSize();
    }
    function onMouseUp() {
      if (!resizing) return;
      resizing = false;
      saveState({ width: state.width, height: state.height });
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    }

    resizeHandle.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        baseW = state.width;
        baseH = state.height;
        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('mouseup', onMouseUp, true);
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  })();

  // Controls
  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    start();
  });
  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pause();
  });
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    reset();
  });

  // Prevent clicks from leaking to page
  wrap.addEventListener('mousedown', (e) => e.stopPropagation(), true);
  wrap.addEventListener('click', (e) => e.stopPropagation(), true);

  // Message handling for popup and background
  try {
    chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (!message) return undefined;

      if (message.type === 'TOGGLE_OVERLAY') {
        overlayEnabled = !overlayEnabled;
        updateVisibility();
        try {
          sendResponse?.({ overlayEnabled });
        } catch {}
        return true;
      }

      if (message.type === 'TIMER_ACTION') {
        const { action, state: newState } = message;

        // Sync state from popup
        if (newState) {
          state = { ...state, ...newState };
          updatePositionAndSize();
        }

        switch (action) {
          case 'START':
            start();
            break;
          case 'PAUSE':
            pause();
            break;
          case 'RESET':
            reset();
            break;
        }

        try {
          sendResponse?.({ success: true });
        } catch {}
        return true;
      }

      return undefined;
    });
  } catch {}

  // Initialize
  loadState().then(() => {
    updatePositionAndSize();
    updateVisibility();
    if (state.isRunning) {
      // ensure lastStartAt is present
      const last = state.lastStartAt ?? Date.now();
      saveState({ lastStartAt: last });
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      rafId = window.requestAnimationFrame(tick);
    } else {
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      renderTime();
    }
  });
})();
