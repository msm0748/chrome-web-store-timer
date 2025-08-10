(function () {
  if (window.__overlayTimerInjected__) return;
  window.__overlayTimerInjected__ = true;

  const STORAGE_KEY = 'overlay_timer_state_v1';

  const defaultState = {
    x: 24,
    y: 24,
    width: 340,
    height: 180,
    isRunning: false,
    elapsedMs: 0,
    lastStartAt: null,
  };

  let state = { ...defaultState };
  let rafId = null;
  let overlayEnabled = false; // hidden by default; toggled via extension action

  function clampToViewport(x, y, width, height) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampedX = Math.max(0, Math.min(x, vw - Math.max(340, width)));
    const clampedY = Math.max(0, Math.min(y, vh - Math.max(180, height)));
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
  host.style.left = defaultState.x + 'px';
  host.style.top = defaultState.y + 'px';
  host.style.width = defaultState.width + 'px';
  host.style.height = defaultState.height + 'px';
  // Allow pointer interactions for drag/resize/buttons
  host.style.pointerEvents = 'auto';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host, * { box-sizing: border-box; }
    
    @keyframes glow {
      0%, 100% { box-shadow: 0 12px 32px rgba(0,0,0,0.45), 0 0 20px rgba(59,130,246,0.1); }
      50% { box-shadow: 0 16px 40px rgba(0,0,0,0.5), 0 0 30px rgba(59,130,246,0.15); }
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.8; }
    }
    
    @keyframes shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    
    .timer-wrap {
      position: absolute;
      left: 0; top: 0; right: 0; bottom: 0;
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      background: linear-gradient(135deg, 
        rgba(17, 24, 39, 0.95) 0%, 
        rgba(30, 41, 59, 0.92) 50%, 
        rgba(17, 24, 39, 0.95) 100%);
      border: 1px solid rgba(255,255,255,0.12);
      backdrop-filter: saturate(180%) blur(16px);
      -webkit-backdrop-filter: saturate(180%) blur(16px);
      color: #F9FAFB;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      overflow: hidden;
      pointer-events: auto;
      animation: glow 3s ease-in-out infinite;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .timer-wrap::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(135deg, 
        rgba(59, 130, 246, 0.05) 0%, 
        rgba(16, 185, 129, 0.03) 50%, 
        rgba(139, 92, 246, 0.05) 100%);
      border-radius: inherit;
      pointer-events: none;
    }

    .title-bar {
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      cursor: move;
      user-select: none;
      background: linear-gradient(135deg, 
        rgba(255,255,255,0.08) 0%, 
        rgba(255,255,255,0.04) 50%, 
        rgba(255,255,255,0.02) 100%);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      border-top-left-radius: 18px;
      border-top-right-radius: 18px;
      pointer-events: auto;
      position: relative;
      z-index: 10;
    }
    
    .title-bar::before {
      content: '';
      position: absolute;
      top: 0; left: -100%; right: -100%; bottom: 0;
      background: linear-gradient(90deg, 
        transparent, 
        rgba(255,255,255,0.1), 
        transparent);
      animation: shimmer 3s ease-in-out infinite;
    }
    
    .title {
      font-weight: 600;
      letter-spacing: 0.3px;
      font-size: 13px;
      opacity: 0.95;
      background: linear-gradient(135deg, #3B82F6, #06B6D4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .time {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-variant-numeric: tabular-nums;
      font-weight: 800;
      font-size: 36px;
      letter-spacing: 1px;
      background: linear-gradient(135deg, #FFFFFF 0%, #E5E7EB 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-shadow: 0 2px 12px rgba(0,0,0,0.3);
      position: relative;
      padding: 20px 0;
    }
    
    .time::before {
      content: '';
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 120%; height: 120%;
      background: radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      animation: pulse 2s ease-in-out infinite;
    }

    .controls {
      display: flex;
      gap: 12px;
      padding: 16px;
      justify-content: center;
      background: linear-gradient(180deg, 
        rgba(255,255,255,0.02) 0%, 
        rgba(255,255,255,0.05) 100%);
      border-bottom-left-radius: 18px;
      border-bottom-right-radius: 18px;
    }

    .btn {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.15);
      outline: none;
      padding: 11px 16px;
      min-width: 85px;
      border-radius: 12px;
      color: #F9FAFB;
      font-weight: 700;
      font-size: 13px;
      background: linear-gradient(135deg, #374151 0%, #1F2937 100%);
      box-shadow: 0 8px 20px rgba(0,0,0,0.3), 
                  inset 0 1px 0 rgba(255,255,255,0.1);
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: auto;
      position: relative;
      z-index: 5;
      overflow: hidden;
    }
    
    .btn::before {
      content: '';
      position: absolute;
      top: 0; left: -100%; right: -100%; bottom: 0;
      background: linear-gradient(90deg, 
        transparent, 
        rgba(255,255,255,0.15), 
        transparent);
      transition: left 0.5s ease;
    }
    
    .btn:hover::before {
      left: 100%;
    }
    
    .btn:hover { 
      transform: translateY(-2px); 
      box-shadow: 0 12px 28px rgba(0,0,0,0.4), 
                  inset 0 1px 0 rgba(255,255,255,0.2);
    }
    
    .btn:active { 
      transform: translateY(-1px); 
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
    }

    .btn.primary {
      background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
      border-color: rgba(59,130,246,0.8);
      color: #FFFFFF;
      box-shadow: 0 8px 20px rgba(59,130,246,0.3), 
                  inset 0 1px 0 rgba(255,255,255,0.2);
    }
    
    .btn.primary:hover {
      box-shadow: 0 12px 28px rgba(59,130,246,0.4), 
                  inset 0 1px 0 rgba(255,255,255,0.3);
    }
    
    .btn.warn {
      background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
      border-color: rgba(239,68,68,0.8);
      color: #FFFFFF;
      box-shadow: 0 8px 20px rgba(239,68,68,0.3), 
                  inset 0 1px 0 rgba(255,255,255,0.2);
    }
    
    .btn.warn:hover {
      box-shadow: 0 12px 28px rgba(239,68,68,0.4), 
                  inset 0 1px 0 rgba(255,255,255,0.3);
    }

    .resize {
      position: absolute;
      width: 16px; height: 16px;
      right: 6px; bottom: 6px;
      border-radius: 4px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, 
        rgba(255,255,255,0.8) 0%, 
        rgba(255,255,255,0.4) 100%);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2), 
                  inset -1px -1px 0 rgba(0,0,0,0.1);
      pointer-events: auto;
      z-index: 5;
      transition: all 0.2s ease;
    }
    
    .resize:hover {
      background: linear-gradient(135deg, 
        rgba(255,255,255,0.9) 0%, 
        rgba(255,255,255,0.6) 100%);
      transform: scale(1.1);
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
    host.style.pointerEvents = overlayEnabled ? 'auto' : 'none';
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

  function updateButtonStates() {
    if (state.isRunning) {
      // 실행 중: 시작 버튼 비활성화, 멈춤 버튼 활성화, 초기화 버튼 숨김
      if (startBtn) startBtn.disabled = true;
      if (pauseBtn) pauseBtn.disabled = false;
      if (resetBtn) resetBtn.style.visibility = 'hidden';
    } else {
      // 멈춤 상태: 시작 버튼 활성화, 멈춤 버튼 비활성화, 초기화 버튼 보임
      if (startBtn) startBtn.disabled = false;
      if (pauseBtn) pauseBtn.disabled = true;
      if (resetBtn) resetBtn.style.visibility = 'visible';
    }
  }

  function tick() {
    renderTime();
    rafId = window.requestAnimationFrame(tick);
  }

  function start() {
    if (state.isRunning) return;
    saveState({ isRunning: true, lastStartAt: Date.now() });
    updateButtonStates();
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
    updateButtonStates();
    if (rafId != null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    renderTime();
  }

  function reset() {
    const running = state.isRunning;
    saveState({ elapsedMs: 0, lastStartAt: running ? Date.now() : null });
    updateButtonStates();
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
      e.preventDefault();
      e.stopPropagation();
      const nx = baseX + (e.clientX - startX);
      const ny = baseY + (e.clientY - startY);
      const clamped = clampToViewport(nx, ny, state.width, state.height);
      state.x = clamped.x;
      state.y = clamped.y;
      updatePositionAndSize();
    }
    function onMouseUp(e) {
      if (!dragging) return;
      dragging = false;
      saveState({ x: state.x, y: state.y });
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    if (titleBar) {
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
    }
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
      e.preventDefault();
      e.stopPropagation();
      const dw = e.clientX - startX;
      const dh = e.clientY - startY;
      // 최소 크기: 버튼들이 잘리지 않도록 충분한 공간 확보
      // 너비: 버튼 3개(85px each) + 간격(12px * 2) + 패딩(16px * 2) = 340px
      // 높이: 제목바(40px) + 시간표시(60px) + 버튼영역(60px) = 180px
      const minW = 340,
        minH = 180;
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

    if (resizeHandle) {
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
    }
  })();

  // Controls - Multiple event types for better compatibility
  if (startBtn) {
    const startHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      start();
    };
    startBtn.addEventListener('click', startHandler);
    startBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  if (pauseBtn) {
    const pauseHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      pause();
    };
    pauseBtn.addEventListener('click', pauseHandler);
    pauseBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  if (resetBtn) {
    const resetHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      reset();
    };
    resetBtn.addEventListener('click', resetHandler);
    resetBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // Note: Avoid globally stopping propagation here to keep internal handlers working reliably

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

      if (message.type === 'GET_OVERLAY_STATE') {
        try {
          sendResponse?.({
            state: { ...state },
            overlayEnabled,
          });
        } catch {}
        return true;
      }

      if (message.type === 'TIMER_ACTION') {
        const { action, state: newState } = message;

        // Sync state from popup - but preserve position/size
        if (newState) {
          const { x, y, width, height } = state;
          state = { ...state, ...newState, x, y, width, height };
          renderTime();
          updateButtonStates();
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
      updateButtonStates();
      rafId = window.requestAnimationFrame(tick);
    } else {
      updateButtonStates();
      renderTime();
    }
  });
})();
