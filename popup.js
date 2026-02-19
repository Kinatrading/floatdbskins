const collectionSelect = document.getElementById('collectionSelect');
const raritySelect = document.getElementById('raritySelect');
const specialRadios = document.querySelectorAll('input[name="special"]');
const minRange = document.getElementById('minRange');
const maxRange = document.getElementById('maxRange');
const minInput = document.getElementById('minInput');
const maxInput = document.getElementById('maxInput');
const resultUrl = document.getElementById('resultUrl');
const openBtn = document.getElementById('openBtn');
const copyBtn = document.getElementById('copyBtn');
const runScanBtn = document.getElementById('runScanBtn');
const statusEl = document.getElementById('status');
const scanResult = document.getElementById('scanResult');
const rangeFill = document.getElementById('rangeFill');

const STEP = 0.01;
const RARITIES_TO_SCAN = [
  { id: '1', name: 'Consumer' },
  { id: '2', name: 'Industrial' },
  { id: '3', name: 'Mil-Spec' },
  { id: '4', name: 'Restricted' },
  { id: '5', name: 'Classified' },
  { id: '6', name: 'Covert' }
];

function roundToStep(value) {
  return Math.round(value / STEP) * STEP;
}

function normalizeFloat(value, fallback) {
  const parsed = Number.parseFloat(String(value));
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(1, Math.max(0, roundToStep(parsed)));
}

function formatFloat(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

function getSelectedSpecialCategory() {
  const checked = document.querySelector('input[name="special"]:checked');
  return checked ? checked.value : '';
}

function updateRangeFill() {
  const min = Number(minRange.value);
  const max = Number(maxRange.value);
  rangeFill.style.left = `${min * 100}%`;
  rangeFill.style.width = `${(max - min) * 100}%`;
}

function buildLink({ rarity } = {}) {
  const params = new URLSearchParams();
  const category = getSelectedSpecialCategory();
  const selectedRarity = rarity ?? raritySelect.value;

  if (category) params.set('category', category);
  if (selectedRarity) params.set('rarity', selectedRarity);

  params.set('min', formatFloat(minRange.value));
  params.set('max', formatFloat(maxRange.value));
  params.set('collection', collectionSelect.value);

  return `https://csfloat.com/db?${params.toString()}`;
}

function getLink() {
  return buildLink();
}

function renderLink() {
  resultUrl.value = getLink();
  updateRangeFill();
}

function syncFromRange(changed) {
  let min = normalizeFloat(minRange.value, 0);
  let max = normalizeFloat(maxRange.value, 1);

  if (changed === 'min' && min > max) max = min;
  if (changed === 'max' && max < min) min = max;

  minRange.value = min.toFixed(2);
  maxRange.value = max.toFixed(2);
  minInput.value = formatFloat(min);
  maxInput.value = formatFloat(max);
  renderLink();
}

function syncFromInput(changed) {
  let min = normalizeFloat(minInput.value, 0);
  let max = normalizeFloat(maxInput.value, 1);

  if (changed === 'min' && min > max) max = min;
  if (changed === 'max' && max < min) min = max;

  minInput.value = formatFloat(min);
  maxInput.value = formatFloat(max);
  minRange.value = min.toFixed(2);
  maxRange.value = max.toFixed(2);
  renderLink();
}

async function loadCollections() {
  const response = await fetch(chrome.runtime.getURL('collections.json'));
  const collections = await response.json();

  const fragment = document.createDocumentFragment();
  for (const col of collections) {
    const option = document.createElement('option');
    option.value = col.id;
    option.textContent = col.name;
    fragment.appendChild(option);
  }

  collectionSelect.appendChild(fragment);
  renderLink();
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      window.clearTimeout(timeoutId);
    };

    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      cleanup();
      resolve();
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timeout while waiting for tab load.'));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function readDbState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const text = document.body?.innerText || '';
      const errorText = "We've encountered an error, there are no items of that rarity in the selected collection - 4";

      if (text.includes(errorText)) {
        return { state: 'empty' };
      }

      const countNode = document.querySelector('div.count.ng-star-inserted');
      if (!countNode) {
        return { state: 'loading' };
      }

      const countText = countNode.textContent || '';
      if (!/Items Found/i.test(countText)) {
        return { state: 'loading' };
      }

      const numeric = countText.replace(/[^\d]/g, '');
      if (!numeric) {
        return { state: 'loading' };
      }

      return {
        state: 'ready',
        count: Number.parseInt(numeric, 10),
        rawText: countText.trim()
      };
    }
  });

  return result;
}

async function waitForDbResult(tabId, timeoutMs = 45000) {
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const state = await readDbState(tabId);
    if (state.state === 'ready' || state.state === 'empty') {
      return state;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  return { state: 'timeout' };
}

function formatScanReport(scanResults) {
  const lines = scanResults.map((entry) => {
    if (entry.state === 'ready') {
      return `${entry.name} (${entry.id}): ${entry.count.toLocaleString('en-US')}`;
    }

    if (entry.state === 'empty') {
      return `${entry.name} (${entry.id}): немає предметів`;
    }

    return `${entry.name} (${entry.id}): не вдалося зчитати (timeout)`;
  });

  return lines.join('\n');
}

async function runRarityScan() {
  runScanBtn.disabled = true;
  scanResult.value = '';
  statusEl.textContent = 'Запускаю автоматичний обхід rarity 1-6...';

  const scanResults = [];

  try {
    for (const rarity of RARITIES_TO_SCAN) {
      statusEl.textContent = `Перевіряю ${rarity.name} (${rarity.id})...`;

      const tab = await chrome.tabs.create({
        url: buildLink({ rarity: rarity.id }),
        active: false
      });

      try {
        await waitForTabComplete(tab.id);
        const state = await waitForDbResult(tab.id);
        scanResults.push({ ...rarity, ...state });
      } finally {
        await chrome.tabs.remove(tab.id);
      }
    }

    scanResult.value = formatScanReport(scanResults);
    statusEl.textContent = 'Готово. Результати зібрані.';
  } catch (error) {
    statusEl.textContent = 'Помилка під час автоматичного обходу.';
    console.error(error);
  } finally {
    runScanBtn.disabled = false;
  }
}

minRange.addEventListener('input', () => syncFromRange('min'));
maxRange.addEventListener('input', () => syncFromRange('max'));
minInput.addEventListener('change', () => syncFromInput('min'));
maxInput.addEventListener('change', () => syncFromInput('max'));
collectionSelect.addEventListener('change', renderLink);
raritySelect.addEventListener('change', renderLink);
specialRadios.forEach((radio) => {
  radio.addEventListener('change', renderLink);
});

openBtn.addEventListener('click', async () => {
  await chrome.tabs.create({ url: getLink() });
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(getLink());
    statusEl.textContent = 'Посилання скопійовано.';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 1500);
  } catch {
    statusEl.textContent = 'Не вдалося скопіювати посилання.';
  }
});

runScanBtn.addEventListener('click', () => {
  runRarityScan();
});

loadCollections().catch((error) => {
  statusEl.textContent = 'Помилка завантаження колекцій.';
  console.error(error);
});

syncFromRange('min');
