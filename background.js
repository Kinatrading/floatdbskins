chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

const rateLimitByTabId = new Map();
let latestRateLimit = null;

function parseHeaderValue(responseHeaders, headerName) {
  const header = responseHeaders?.find((item) => item.name?.toLowerCase() === headerName.toLowerCase());
  return header?.value || '';
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!details.url.includes('/api/v1/floatdb/search')) return;

    const limit = Number.parseInt(parseHeaderValue(details.responseHeaders, 'x-ratelimit-limit'), 10);
    const remaining = Number.parseInt(parseHeaderValue(details.responseHeaders, 'x-ratelimit-remaining'), 10);
    const reset = Number.parseInt(parseHeaderValue(details.responseHeaders, 'x-ratelimit-reset'), 10);

    if (Number.isNaN(limit) || Number.isNaN(remaining) || Number.isNaN(reset)) return;

    const value = { limit, remaining, reset };

    latestRateLimit = value;
    if (details.tabId >= 0) {
      rateLimitByTabId.set(details.tabId, value);
    }
  },
  {
    urls: ['https://csfloat.com/api/v1/floatdb/search*']
  },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  rateLimitByTabId.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_RATE_LIMIT') return;

  const tabId = Number.isInteger(message.tabId) ? message.tabId : null;
  sendResponse({
    rateLimit: tabId !== null
      ? (rateLimitByTabId.get(tabId) || latestRateLimit)
      : latestRateLimit
  });
});
