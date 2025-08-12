/* Background service worker: injects content script on demand (activeTab) and toggles overlay */

async function ensureContentInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js'],
    });
  } catch {}
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id) return;
    // Skip restricted schemes
    if (
      tab.url &&
      /^(chrome|edge|about|file|chrome-extension):/i.test(tab.url)
    ) {
      return;
    }

    await ensureContentInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
  } catch (err) {
    // Ignore if cannot inject/send on this page
  }
});
