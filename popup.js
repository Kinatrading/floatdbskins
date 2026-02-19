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
const includeStattrak = document.getElementById('includeStattrak');
const excludeCrafted = document.getElementById('excludeCrafted');
const statusEl = document.getElementById('status');
const scanResult = document.getElementById('scanResult');
const rangeFill = document.getElementById('rangeFill');

const STEP = 0.01;
const RATE_LIMIT_PAUSE_THRESHOLD = 10;
const rarityMetaByCollection = new Map();

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

function buildLink({ rarity, category, paintSeed } = {}) {
  const params = new URLSearchParams();
  const selectedCategory = category ?? getSelectedSpecialCategory();
  const selectedRarity = rarity ?? raritySelect.value;

  if (selectedCategory) params.set('category', selectedCategory);
  if (selectedRarity) params.set('rarity', selectedRarity);
  if (paintSeed) params.set('paintSeed', paintSeed);

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
          hasStattrakSkins: false,
          hasAnyCrates: false
        });
      }

      const entry = map.get(normalizedId);
      entry.rarityIds.add(rarityId);
      entry.hasStattrakSkins = entry.hasStattrakSkins || Boolean(skin.stattrak);
      entry.hasAnyCrates = entry.hasAnyCrates || (skin.crates || []).length > 0;
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

async function loadCollections() {
  const [collectionsResponse, skinsResponse] = await Promise.all([
    fetch(chrome.runtime.getURL('collections.json')),
    fetch(chrome.runtime.getURL('skins.json'))
  ]);

  const [collections, skins] = await Promise.all([
    collectionsResponse.json(),
    skinsResponse.json()
  ]);

  const metadata = buildCollectionMetadata(skins);
  rarityMetaByCollection.clear();
  metadata.forEach((value, key) => rarityMetaByCollection.set(key, value));

  const fragment = document.createDocumentFragment();
  for (const col of collections) {
    const option = document.createElement('option');
    option.value = col.id;

    const meta = rarityMetaByCollection.get(col.id);
    if (meta?.kind === 'crate') {
      option.textContent = `${col.name} [crate]`;
    } else if (meta?.kind === 'collection') {
      option.textContent = `${col.name} [collection]`;
    } else {
      option.textContent = col.name;
    }

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
        count: Number.parseInt(numeric, 10)
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

function getRateLimitForTab(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_RATE_LIMIT', tabId }, (response) => {
      resolve(response?.rateLimit || null);
    });
  });
}

async function scanSingleRarity({ rarityId, category }) {
  const tab = await chrome.tabs.create({
    url: buildLink({ rarity: String(rarityId), category }),
    active: false
  });

  try {
    await waitForTabComplete(tab.id);
    const result = await waitForDbResult(tab.id);
    const rateLimit = await getRateLimitForTab(tab.id);
    return {
      ...result,
      rateLimit
    };
  } finally {
    await chrome.tabs.remove(tab.id);
  }
}

async function scanPaintSeed1000({ rarityId, category }) {
  const tab = await chrome.tabs.create({
    url: buildLink({ rarity: String(rarityId), category, paintSeed: '1000' }),
    active: false
  });

  try {
    await waitForTabComplete(tab.id);
    const result = await waitForDbResult(tab.id);
    const rateLimit = await getRateLimitForTab(tab.id);
    return {
      ...result,
      rateLimit
    };
  } finally {
    await chrome.tabs.remove(tab.id);
  }
}

function formatPercent(value) {
  return `${value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}%`;
}

function formatScanReport(lines, summary, coverageLines = []) {
  if (!coverageLines.length) {
    return `${lines.join('\n')}\n\n${summary}`;
  }

  return `${lines.join('\n')}\n\n${coverageLines.join('\n')}\n\n${summary}`;
}

async function pauseForRateLimit(rateLimit) {
  if (!rateLimit || rateLimit.remaining >= RATE_LIMIT_PAUSE_THRESHOLD) return;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const waitMs = Math.max((rateLimit.reset - nowSeconds) * 1000, 1000);
  statusEl.textContent = `Rate limit: лишилось ${rateLimit.remaining}/${rateLimit.limit}. Пауза ${Math.ceil(waitMs / 1000)}с до reset...`;
  await new Promise((resolve) => window.setTimeout(resolve, waitMs + 250));
}

function buildCoverageReport(entries, shouldScanStattrak) {
  const eligible = entries.filter((entry) => entry.chancePercent > 0);
  if (!eligible.length) return [];

  const reference = [...eligible]
    .sort((a, b) => b.rarityId - a.rarityId)
    .find((entry) => entry.visibleCount > 0);

  if (!reference) return [];

  const referenceChanceFraction = reference.chancePercent / 100;
  const estimatedOpenings = reference.visibleCount / referenceChanceFraction;

  const coverageLines = [
    `Видимість (еталон ${reference.rarityName} = 100%):`,
    `Оцінка відкриттів: ${Math.round(estimatedOpenings).toLocaleString('en-US')}`
  ];

  for (const entry of eligible) {
    const chanceFraction = entry.chancePercent / 100;
    const expectedVisible = estimatedOpenings * chanceFraction;
    const hiddenCount = Math.max(0, Math.round(expectedVisible - entry.visibleCount));
    const visiblePercent = expectedVisible > 0
      ? Math.min(100, (entry.visibleCount / expectedVisible) * 100)
      : 0;
    const hiddenPercent = Math.max(0, 100 - visiblePercent);

    coverageLines.push(
      `${entry.rarityName}: visible=${formatPercent(visiblePercent)} (${entry.visibleCount.toLocaleString('en-US')}), ` +
      `hidden=${formatPercent(hiddenPercent)} (${hiddenCount.toLocaleString('en-US')}), expected=${Math.round(expectedVisible).toLocaleString('en-US')}`
    );
  }

  if (!shouldScanStattrak) {
    coverageLines.push('Примітка: розрахунок виконано лише по normal (StatTrak вимкнено).');
  }

  return coverageLines;
}

async function runRarityScan() {
  runScanBtn.disabled = true;
  scanResult.value = '';

  const selectedCollectionId = collectionSelect.value;
  const meta = rarityMetaByCollection.get(selectedCollectionId);

  if (!meta || !meta.sortedRarityIds?.length) {
    statusEl.textContent = 'Не вдалося знайти rarity у skins.json для цієї колекції.';
    runScanBtn.disabled = false;
    return;
  }

  const shouldScanStattrak = includeStattrak.checked;
  const shouldExcludeCrafted = excludeCrafted.checked;
  const rarityIds = meta.sortedRarityIds.filter((id) => id <= 6);
  const lowestRarityId = Math.min(...rarityIds);

  statusEl.textContent = `Знайдено ${meta.kind} з rarity: ${rarityIds.map((id) => RARITY_LABELS[id]).join(', ')}`;

  const lines = [];
  const coverageEntries = [];
  let total = 0;

  try {
    for (const rarityId of rarityIds) {
      const rarityName = RARITY_LABELS[rarityId] || `Rarity ${rarityId}`;
      const baseChance = meta.baseChances.get(rarityId) || 0;

      statusEl.textContent = `Перевіряю ${rarityName}...`;
      const normalResult = await scanSingleRarity({ rarityId, category: '' });
      const normalCount = normalResult.state === 'ready' ? normalResult.count : 0;
      await pauseForRateLimit(normalResult.rateLimit);

      let normalAdjustedCount = normalCount;
      let normalCraftedEstimate = 0;

      if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
        statusEl.textContent = `Перевіряю ${rarityName} (paintSeed=1000)...`;
        const normalPatternResult = await scanPaintSeed1000({ rarityId, category: '' });
        const patternCount = normalPatternResult.state === 'ready' ? normalPatternResult.count : 0;
        normalCraftedEstimate = patternCount * 1000;
        normalAdjustedCount = Math.max(0, normalCount - normalCraftedEstimate);
        await pauseForRateLimit(normalPatternResult.rateLimit);
      }

      let stattrakCount = 0;
      let stattrakAdjustedCount = 0;
      let stattrakCraftedEstimate = 0;
      let stattrakChance = 0;

      if (shouldScanStattrak) {
        statusEl.textContent = `Перевіряю ${rarityName} (StatTrak)...`;
        const stattrakResult = await scanSingleRarity({ rarityId, category: '2' });
        stattrakCount = stattrakResult.state === 'ready' ? stattrakResult.count : 0;
        stattrakAdjustedCount = stattrakCount;
        stattrakChance = baseChance * 0.1;
        await pauseForRateLimit(stattrakResult.rateLimit);

        if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
          statusEl.textContent = `Перевіряю ${rarityName} (StatTrak, paintSeed=1000)...`;
          const stattrakPatternResult = await scanPaintSeed1000({ rarityId, category: '2' });
          const patternCount = stattrakPatternResult.state === 'ready' ? stattrakPatternResult.count : 0;
          stattrakCraftedEstimate = patternCount * 1000;
          stattrakAdjustedCount = Math.max(0, stattrakCount - stattrakCraftedEstimate);
          await pauseForRateLimit(stattrakPatternResult.rateLimit);
        }
      }

      const rarityTotal = normalAdjustedCount + stattrakAdjustedCount;
      const effectiveChance = baseChance + stattrakChance;

      total += rarityTotal;
      coverageEntries.push({
        rarityId,
        rarityName,
        visibleCount: rarityTotal,
        chancePercent: effectiveChance
      });

      if (shouldScanStattrak) {
        if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
          lines.push(
            `${rarityName} (${rarityId}): normal=${normalAdjustedCount.toLocaleString('en-US')} (raw ${normalCount.toLocaleString('en-US')} - crafted ${normalCraftedEstimate.toLocaleString('en-US')}) [${formatPercent(baseChance)}], ` +
            `stattrak=${stattrakAdjustedCount.toLocaleString('en-US')} (raw ${stattrakCount.toLocaleString('en-US')} - crafted ${stattrakCraftedEstimate.toLocaleString('en-US')}) [${formatPercent(stattrakChance)}], total=${rarityTotal.toLocaleString('en-US')}`
          );
        } else {
          lines.push(
            `${rarityName} (${rarityId}): normal=${normalAdjustedCount.toLocaleString('en-US')} [${formatPercent(baseChance)}], ` +
            `stattrak=${stattrakAdjustedCount.toLocaleString('en-US')} [${formatPercent(stattrakChance)}], total=${rarityTotal.toLocaleString('en-US')}`
          );
        }
      } else {
        if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
          lines.push(
            `${rarityName} (${rarityId}): normal=${normalAdjustedCount.toLocaleString('en-US')} (raw ${normalCount.toLocaleString('en-US')} - crafted ${normalCraftedEstimate.toLocaleString('en-US')}) [${formatPercent(baseChance)}], total=${rarityTotal.toLocaleString('en-US')}`
          );
        } else {
          lines.push(
            `${rarityName} (${rarityId}): normal=${normalAdjustedCount.toLocaleString('en-US')} [${formatPercent(baseChance)}], total=${rarityTotal.toLocaleString('en-US')}`
          );
        }
      }
    }

    const coverageLines = buildCoverageReport(coverageEntries, shouldScanStattrak);

    scanResult.value = formatScanReport(
      lines,
      `Тип: ${meta.kind}. Загальна кількість скінів: ${total.toLocaleString('en-US')}`,
      coverageLines
    );
    statusEl.textContent = 'Готово. Автозбір завершено.';
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
  statusEl.textContent = 'Помилка завантаження даних.';
  console.error(error);
});

syncFromRange('min');
