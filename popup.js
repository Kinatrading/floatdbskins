const collectionSelect = document.getElementById('collectionSelect');
const collectionQueueSelect = document.getElementById('collectionQueueSelect');
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
const includeStattrak = document.getElementById('includeStattrak');
const excludeCrafted = document.getElementById('excludeCrafted');
const statusEl = document.getElementById('status');
const scanResult = document.getElementById('scanResult');
const scanCards = document.getElementById('scanCards');
const rateLimitInfo = document.getElementById('rateLimitInfo');
const rangeFill = document.getElementById('rangeFill');

const STEP = 0.01;
const RATE_LIMIT_PAUSE_THRESHOLD = 10;
const rarityMetaByCollection = new Map();
const collectionInfoById = new Map();

const RARITY_LABELS = {
  1: 'Consumer',
  2: 'Industrial',
  3: 'Mil-Spec',
  4: 'Restricted',
  5: 'Classified',
  6: 'Covert'
};

const API_RARITY_TO_ID = {
  'Consumer Grade': 1,
  'Industrial Grade': 2,
  'Mil-Spec Grade': 3,
  Restricted: 4,
  Classified: 5,
  Covert: 6,
  Contraband: 7,
  Extraordinary: 7
};

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

function formatPercent(value) {
  return `${value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}%`;
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

function buildLink({ rarity, category, paintSeed, collectionId } = {}) {
  const params = new URLSearchParams();
  const selectedCategory = category ?? getSelectedSpecialCategory();
  const selectedRarity = rarity ?? raritySelect.value;

  if (selectedCategory) params.set('category', selectedCategory);
  if (selectedRarity) params.set('rarity', selectedRarity);
  if (paintSeed) params.set('paintSeed', paintSeed);

  params.set('min', formatFloat(minRange.value));
  params.set('max', formatFloat(maxRange.value));
  params.set('collection', collectionId || collectionSelect.value);

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

function normalizeCollectionId(apiId) {
  return String(apiId || '').replace(/^collection-/, '').replace(/-/g, '_');
}

function computeCollectionBaseChances(rarityIds) {
  const available = [...rarityIds].filter((r) => r >= 1 && r <= 6).sort((a, b) => a - b);
  const chances = new Map();

  available.forEach((rarityId, index) => {
    chances.set(rarityId, 80 * 0.2 ** index);
  });

  return chances;
}

function computeCrateBaseChances(rarityIds) {
  const crateBase = [79.92, 15.98, 3.2, 0.64, 0.26];
  const available = [...rarityIds].filter((r) => r >= 1 && r <= 6).sort((a, b) => a - b);
  const chances = new Map();

  available.forEach((rarityId, index) => {
    chances.set(rarityId, crateBase[index] ?? 0);
  });

  return chances;
}

function buildCollectionMetadata(skins) {
  const map = new Map();

  for (const skin of skins) {
    const rarityId = API_RARITY_TO_ID[skin?.rarity?.name];
    if (!rarityId || rarityId > 6) continue;

    for (const collection of skin.collections || []) {
      const normalizedId = normalizeCollectionId(collection.id);
      if (!normalizedId) continue;

      if (!map.has(normalizedId)) {
        map.set(normalizedId, {
          rarityIds: new Set(),
          hasStattrakSkins: false
        });
      }

      const entry = map.get(normalizedId);
      entry.rarityIds.add(rarityId);
      entry.hasStattrakSkins = entry.hasStattrakSkins || Boolean(skin.stattrak);
    }
  }

  for (const entry of map.values()) {
    const sortedRarityIds = [...entry.rarityIds].sort((a, b) => a - b);
    entry.sortedRarityIds = sortedRarityIds;
    entry.kind = entry.hasStattrakSkins ? 'crate' : 'collection';
    entry.baseChances = entry.kind === 'crate'
      ? computeCrateBaseChances(sortedRarityIds)
      : computeCollectionBaseChances(sortedRarityIds);
  }

  return map;
}

function buildCollectionInfo(skins, collections) {
  const map = new Map(collections.map((col) => [col.id, { name: col.name, image: '' }]));

  for (const skin of skins) {
    for (const collection of skin.collections || []) {
      const normalizedId = normalizeCollectionId(collection.id);
      if (!normalizedId) continue;

      if (!map.has(normalizedId)) {
        map.set(normalizedId, { name: collection.name || normalizedId, image: collection.image || '' });
      }

      const info = map.get(normalizedId);
      if (!info.name && collection.name) info.name = collection.name;
      if (!info.image && collection.image) info.image = collection.image;
    }
  }

  return map;
}

async function loadCollections() {
  const [collectionsResponse, skinsResponse] = await Promise.all([
    fetch(chrome.runtime.getURL('collections.json')),
    fetch(chrome.runtime.getURL('skins.json'))
  ]);

  const [collections, skins] = await Promise.all([
    collectionsResponse.json(),
    skinsResponse.json()
  ]);

  rarityMetaByCollection.clear();
  buildCollectionMetadata(skins).forEach((value, key) => rarityMetaByCollection.set(key, value));

  collectionInfoById.clear();
  buildCollectionInfo(skins, collections).forEach((value, key) => collectionInfoById.set(key, value));

  const singleFragment = document.createDocumentFragment();
  const queueFragment = document.createDocumentFragment();

  for (const col of collections) {
    const meta = rarityMetaByCollection.get(col.id);
    const suffix = meta?.kind ? ` [${meta.kind}]` : '';

    const option = document.createElement('option');
    option.value = col.id;
    option.textContent = `${col.name}${suffix}`;
    singleFragment.appendChild(option);

    const queueOption = option.cloneNode(true);
    queueFragment.appendChild(queueOption);
  }

  collectionSelect.appendChild(singleFragment);
  collectionQueueSelect.appendChild(queueFragment);

  if (collectionQueueSelect.options.length > 0) {
    collectionQueueSelect.options[0].selected = true;
  }

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

      if (text.includes(errorText)) return { state: 'empty' };

      const countNode = document.querySelector('div.count.ng-star-inserted');
      if (!countNode) return { state: 'loading' };

      const countText = countNode.textContent || '';
      if (!/Items Found/i.test(countText)) return { state: 'loading' };

      const numeric = countText.replace(/[^\d]/g, '');
      if (!numeric) return { state: 'loading' };

      return { state: 'ready', count: Number.parseInt(numeric, 10) };
    }
  });

  return result;
}

async function waitForDbResult(tabId, timeoutMs = 45000) {
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const state = await readDbState(tabId);
    if (state.state === 'ready' || state.state === 'empty') return state;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  return { state: 'timeout' };
}

function getRateLimitForTab(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_RATE_LIMIT', tabId }, (response) => {
      resolve(response?.rateLimit || null);
    });
  });
}

function updateRateLimitInfo(rateLimit) {
  if (!rateLimit) return;
  rateLimitInfo.textContent = `Rate limit: ${rateLimit.remaining}/${rateLimit.limit} (reset ${new Date(rateLimit.reset * 1000).toLocaleTimeString('uk-UA')})`;
}

async function scanSingleRarity({ rarityId, category, collectionId, paintSeed }) {
  const tab = await chrome.tabs.create({
    url: buildLink({ rarity: String(rarityId), category, paintSeed, collectionId }),
    active: false
  });

  try {
    await waitForTabComplete(tab.id);
    const result = await waitForDbResult(tab.id);
    const rateLimit = await getRateLimitForTab(tab.id);
    updateRateLimitInfo(rateLimit);
    return { ...result, rateLimit };
  } finally {
    await chrome.tabs.remove(tab.id);
  }
}

async function pauseForRateLimit(rateLimit) {
  if (!rateLimit || rateLimit.remaining >= RATE_LIMIT_PAUSE_THRESHOLD) return;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const waitMs = Math.max((rateLimit.reset - nowSeconds) * 1000, 1000);
  statusEl.textContent = `Rate limit: лишилось ${rateLimit.remaining}/${rateLimit.limit}. Пауза ${Math.ceil(waitMs / 1000)}с до reset...`;
  await new Promise((resolve) => window.setTimeout(resolve, waitMs + 250));
}

function buildCoverageReport(entries) {
  const eligible = entries.filter((entry) => entry.chancePercent > 0);
  if (!eligible.length) return [];

  const reference = [...eligible].sort((a, b) => b.rarityId - a.rarityId).find((entry) => entry.visibleCount > 0);
  if (!reference) return [];

  const estimatedOpenings = reference.visibleCount / (reference.chancePercent / 100);
  const theoreticalLines = [];

  for (const entry of eligible) {
    const expected = estimatedOpenings * (entry.chancePercent / 100);
    const expectedRounded = Math.round(expected).toLocaleString('en-US');
    theoreticalLines.push(`Теоретично ${entry.rarityName}: expected=${expectedRounded}-${expectedRounded}`);
  }

  theoreticalLines.push(`Теоретично: оцінка відкриттів ≈ ${Math.round(estimatedOpenings).toLocaleString('en-US')}–${Math.round(estimatedOpenings).toLocaleString('en-US')}.`);
  return theoreticalLines;
}

function formatScanReport(lines, summary, theoreticalLines = []) {
  if (!theoreticalLines.length) return `${lines.join('\n')}\n\n${summary}`;
  return `${lines.join('\n')}\n\n${theoreticalLines.join('\n')}\n\n${summary}`;
}

function getQueueCollectionIds() {
  const selected = [...collectionQueueSelect.selectedOptions].map((option) => option.value);
  if (selected.length) return selected;
  return collectionSelect.value ? [collectionSelect.value] : [];
}

function renderCollectionCard({ collectionName, imageUrl, theoreticalLines }) {
  const card = document.createElement('article');
  card.className = 'scan-card';

  const left = document.createElement('div');
  left.className = 'scan-card-text';

  const title = document.createElement('h3');
  title.textContent = collectionName;
  left.appendChild(title);

  for (const line of theoreticalLines) {
    const p = document.createElement('p');
    p.textContent = line;
    left.appendChild(p);
  }

  card.appendChild(left);

  if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = collectionName;
    image.className = 'scan-card-image';
    card.appendChild(image);
  }

  scanCards.appendChild(card);
}

async function scanCollection(collectionId) {
  const meta = rarityMetaByCollection.get(collectionId);
  if (!meta || !meta.sortedRarityIds?.length) {
    return {
      report: 'Не вдалося знайти rarity у skins.json для цієї колекції.',
      theoreticalLines: []
    };
  }

  const shouldScanStattrak = includeStattrak.checked;
  const shouldExcludeCrafted = excludeCrafted.checked;
  const selectedCategory = getSelectedSpecialCategory();
  const normalCategory = selectedCategory || '1';
  const rarityIds = meta.sortedRarityIds.filter((id) => id <= 6);
  const lowestRarityId = Math.min(...rarityIds);

  const lines = [];
  const coverageEntries = [];
  let total = 0;

  for (const rarityId of rarityIds) {
    const rarityName = RARITY_LABELS[rarityId] || `Rarity ${rarityId}`;
    const baseChance = meta.baseChances.get(rarityId) || 0;

    statusEl.textContent = `Перевіряю ${rarityName}...`;
    const normalResult = await scanSingleRarity({ rarityId, category: normalCategory, collectionId });
    const normalCount = normalResult.state === 'ready' ? normalResult.count : 0;
    await pauseForRateLimit(normalResult.rateLimit);

    let normalAdjustedCount = normalCount;
    if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
      const patternResult = await scanSingleRarity({ rarityId, category: normalCategory, collectionId, paintSeed: '1000' });
      const patternCount = patternResult.state === 'ready' ? patternResult.count : 0;
      normalAdjustedCount = Math.max(0, normalCount - (patternCount * 1000));
      await pauseForRateLimit(patternResult.rateLimit);
    }

    let stattrakAdjustedCount = 0;
    let stattrakChance = 0;
    if (shouldScanStattrak) {
      const stattrakResult = await scanSingleRarity({ rarityId, category: '2', collectionId });
      const stattrakCount = stattrakResult.state === 'ready' ? stattrakResult.count : 0;
      stattrakAdjustedCount = stattrakCount;
      stattrakChance = baseChance * 0.1;
      await pauseForRateLimit(stattrakResult.rateLimit);
    }

    const rarityTotal = normalAdjustedCount + stattrakAdjustedCount;
    const effectiveChance = baseChance + stattrakChance;
    total += rarityTotal;

    coverageEntries.push({ rarityId, rarityName, visibleCount: rarityTotal, chancePercent: effectiveChance });
    lines.push(`${rarityName}: total=${rarityTotal.toLocaleString('en-US')} [${formatPercent(effectiveChance)}]`);
  }

  const theoreticalLines = buildCoverageReport(coverageEntries);
  const summary = `Тип: ${meta.kind}. Загальна кількість скінів: ${total.toLocaleString('en-US')}`;
  return {
    report: formatScanReport(lines, summary, theoreticalLines),
    theoreticalLines,
    summary
  };
}

async function runRarityScan() {
  runScanBtn.disabled = true;
  scanResult.value = '';
  scanCards.innerHTML = '';

  const queue = getQueueCollectionIds();
  if (!queue.length) {
    statusEl.textContent = 'Оберіть хоча б одну колекцію для черги.';
    runScanBtn.disabled = false;
    return;
  }

  const blocks = [];

  try {
    for (let index = 0; index < queue.length; index += 1) {
      const collectionId = queue[index];
      collectionSelect.value = collectionId;
      renderLink();

      const info = collectionInfoById.get(collectionId) || { name: collectionId, image: '' };
      statusEl.textContent = `Черга ${index + 1}/${queue.length}: ${info.name}`;

      const { report, theoreticalLines } = await scanCollection(collectionId);
      blocks.push(`=== ${info.name} ===\n${report}`);
      renderCollectionCard({ collectionName: info.name, imageUrl: info.image, theoreticalLines });
    }

    scanResult.value = blocks.join('\n\n');
    statusEl.textContent = 'Готово. Черга автозбору завершена.';
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
specialRadios.forEach((radio) => radio.addEventListener('change', renderLink));

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
  statusEl.textContent = 'Помилка завантаження даних.';
  console.error(error);
});

syncFromRange('min');
