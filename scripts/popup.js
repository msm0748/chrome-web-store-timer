/* Popup UI script - works on any page including chrome:// */

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
let overlayEnabled = true;

// DOM elements
const timeEl = document.getElementById('time');
const startBtn = document.getElementById('start');
const pauseBtn = document.getElementById('pause');
const resetBtn = document.getElementById('reset');
const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');

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
        resolve();
      });
    } catch {
      resolve();
    }
  });
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
  updateUI();
  if (rafId == null) rafId = window.requestAnimationFrame(tick);

  // Also start overlay timer if possible
  notifyContentScript('START');
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
  updateUI();
  if (rafId != null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  renderTime();

  // Also pause overlay timer if possible
  notifyContentScript('PAUSE');
}

function reset() {
  const running = state.isRunning;
  saveState({ elapsedMs: 0, lastStartAt: running ? Date.now() : null });
  renderTime();

  // Also reset overlay timer if possible
  notifyContentScript('RESET');
}

function updateUI() {
  startBtn.disabled = state.isRunning;
  pauseBtn.disabled = !state.isRunning;

  toggleBtn.textContent = overlayEnabled ? '오버레이 숨기기' : '오버레이 표시';
  toggleBtn.classList.toggle('active', overlayEnabled);
}

async function notifyContentScript(action) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TIMER_ACTION',
        action,
        state: { ...state },
      });
    }
  } catch {
    // Content script not available (chrome:// pages, etc.)
  }
}

async function toggleOverlay() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_OVERLAY',
      });
      if (response && typeof response.overlayEnabled === 'boolean') {
        overlayEnabled = response.overlayEnabled;
        updateUI();
        statusEl.textContent = overlayEnabled
          ? '오버레이 표시됨'
          : '오버레이 숨겨짐';
      }
    }
  } catch {
    statusEl.textContent = '이 페이지에서는 오버레이를 사용할 수 없습니다';
  }
}

// Event listeners
startBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', pause);
resetBtn.addEventListener('click', reset);
toggleBtn.addEventListener('click', toggleOverlay);

// Initialize
loadState().then(() => {
  updateUI();
  if (state.isRunning) {
    // ensure lastStartAt is present
    const last = state.lastStartAt ?? Date.now();
    saveState({ lastStartAt: last });
    rafId = window.requestAnimationFrame(tick);
  } else {
    renderTime();
  }
});
