/* Background service worker: toggles overlay in the active tab when the action is clicked */

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
  } catch (err) {
    // Content script may not be injected on restricted pages (chrome://, Web Store, etc.)
    // or the tab might need a refresh after install. We silently ignore.
  }
});
