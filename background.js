chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

const rateLimitByTabId = new Map();

function parseHeaderValue(responseHeaders, headerName) {
  const header = responseHeaders?.find((item) => item.name?.toLowerCase() === headerName.toLowerCase());
  return header?.value || '';
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const limit = Number.parseInt(parseHeaderValue(details.responseHeaders, 'x-ratelimit-limit'), 10);
    const remaining = Number.parseInt(parseHeaderValue(details.responseHeaders, 'x-ratelimit-remaining'), 10);
    const reset = Number.parseInt(parseHeaderValue(details.responseHeaders, 'x-ratelimit-reset'), 10);

    if (Number.isNaN(limit) || Number.isNaN(remaining) || Number.isNaN(reset)) return;

    rateLimitByTabId.set(details.tabId, {
      limit,
      remaining,
      reset
    });
  },
  {
    urls: ['https://csfloat.com/*search*']
  },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  rateLimitByTabId.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_RATE_LIMIT') return;

  sendResponse({
    rateLimit: rateLimitByTabId.get(message.tabId) || null
  });
});
