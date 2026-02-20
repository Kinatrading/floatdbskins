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
const RATE_LIMIT_POLL_MS = 1000;

const rarityMetaByCollection = new Map();
const collectionInfoById = new Map();
let rateLimitPollInterval = null;

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

function explainRuntimeError(error) {
  if (!error) return 'Невідома помилка.';

  if (error instanceof ReferenceError) {
    return `ReferenceError: змінна або функція використана до оголошення (або є опечатка в назві). Деталі: ${error.message}`;
  }

  return `${error.name || 'Error'}: ${error.message || String(error)}`;
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
        map.set(normalizedId, {
          name: collection.name || normalizedId,
          image: collection.image || ''
        });
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

function fetchRateLimit(tabId = null) {
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

async function refreshRateLimitInfo() {
  const rateLimit = await fetchRateLimit(null);
  updateRateLimitInfo(rateLimit);
}

function startRateLimitPolling() {
  if (rateLimitPollInterval) window.clearInterval(rateLimitPollInterval);

  refreshRateLimitInfo().catch(() => {});
  rateLimitPollInterval = window.setInterval(() => {
    refreshRateLimitInfo().catch(() => {});
  }, RATE_LIMIT_POLL_MS);
}

async function scanSingleRarity({ rarityId, category, collectionId, paintSeed }) {
  const tab = await chrome.tabs.create({
    url: buildLink({ rarity: String(rarityId), category, collectionId, paintSeed }),
    active: false
  });

  try {
    await waitForTabComplete(tab.id);
    const result = await waitForDbResult(tab.id);
    const rateLimit = await fetchRateLimit(tab.id);
    updateRateLimitInfo(rateLimit);

    return {
      ...result,
      rateLimit
    };
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
  if (!eligible.length) return { fullLines: [], cardLines: [] };

  const reference = [...eligible]
    .sort((a, b) => b.rarityId - a.rarityId)
    .find((entry) => entry.visibleCount > 0);

  if (!reference) return { fullLines: [], cardLines: [] };

  const referenceChanceFraction = reference.chancePercent / 100;
  const estimatedOpenings = reference.visibleCount / referenceChanceFraction;

  const fullLines = [
    `Видимість (еталон ${reference.rarityName} = 100%):`,
    `Оцінка відкриттів: ${Math.round(estimatedOpenings).toLocaleString('en-US')}`
  ];

  for (const entry of eligible) {
    const chanceFraction = entry.chancePercent / 100;
    const expectedVisible = estimatedOpenings * chanceFraction;
    const hiddenCount = Math.max(0, Math.round(expectedVisible - entry.visibleCount));
    const visiblePercent = expectedVisible > 0 ? Math.min(100, (entry.visibleCount / expectedVisible) * 100) : 0;
    const hiddenPercent = Math.max(0, 100 - visiblePercent);

    fullLines.push(
      `${entry.rarityName}: visible=${formatPercent(visiblePercent)} (${entry.visibleCount.toLocaleString('en-US')}), ` +
      `hidden=${formatPercent(hiddenPercent)} (${hiddenCount.toLocaleString('en-US')}), expected=${Math.round(expectedVisible).toLocaleString('en-US')}`
    );
  }

  if (!shouldScanStattrak) {
    fullLines.push('Примітка: розрахунок по normal. StatTrak вимкнено.');
  }

  const theoreticalLines = eligible.map((entry) => {
    const expected = estimatedOpenings * (entry.chancePercent / 100);
    const formattedExpected = Math.round(expected).toLocaleString('en-US');
    return `Теоретично ${entry.rarityName}: expected=${formattedExpected}-${formattedExpected}`;
  });

  theoreticalLines.push(
    `Теоретично: оцінка відкриттів ≈ ${Math.round(estimatedOpenings).toLocaleString('en-US')}–${Math.round(estimatedOpenings).toLocaleString('en-US')}.`
  );

  return {
    fullLines: [...fullLines, '', ...theoreticalLines],
    cardLines: theoreticalLines
  };
}

function formatScanReport(lines, summary, coverageLines = []) {
  if (!coverageLines.length) {
    return `${lines.join('\n')}\n\n${summary}`;
  }

  return `${lines.join('\n')}\n\n${coverageLines.join('\n')}\n\n${summary}`;
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
      cardLines: []
    };
  }

  const shouldScanStatTrakEnabled = includeStattrak.checked;
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
    const stattrakChance = shouldScanStatTrakEnabled ? baseChance * 0.1 : 0;

    statusEl.textContent = `Перевіряю ${rarityName}...`;

    const normalResult = await scanSingleRarity({ rarityId, category: normalCategory, collectionId });
    const normalCount = normalResult.state === 'ready' ? normalResult.count : 0;
    await pauseForRateLimit(normalResult.rateLimit);

    let normalAdjustedCount = normalCount;
    let normalCraftedEstimate = 0;

    if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
      statusEl.textContent = `Перевіряю ${rarityName} (normal, paintSeed=1000)...`;
      const normalPatternResult = await scanSingleRarity({
        rarityId,
        category: normalCategory,
        collectionId,
        paintSeed: '1000'
      });
      const patternCount = normalPatternResult.state === 'ready' ? normalPatternResult.count : 0;
      normalCraftedEstimate = patternCount * 1000;
      normalAdjustedCount = Math.max(0, normalCount - normalCraftedEstimate);
      await pauseForRateLimit(normalPatternResult.rateLimit);
    }

    let stattrakCount = 0;
    let stattrakAdjustedCount = 0;
    let stattrakCraftedEstimate = 0;

    if (shouldScanStatTrakEnabled) {
      statusEl.textContent = `Перевіряю ${rarityName} (StatTrak)...`;
      const stattrakResult = await scanSingleRarity({ rarityId, category: '2', collectionId });
      stattrakCount = stattrakResult.state === 'ready' ? stattrakResult.count : 0;
      stattrakAdjustedCount = stattrakCount;
      await pauseForRateLimit(stattrakResult.rateLimit);

      if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
        statusEl.textContent = `Перевіряю ${rarityName} (StatTrak, paintSeed=1000)...`;
        const stattrakPatternResult = await scanSingleRarity({
          rarityId,
          category: '2',
          collectionId,
          paintSeed: '1000'
        });
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

    const perRarityLines = [
      `${rarityName} (${rarityId}):`,
      `  normal raw=${normalCount.toLocaleString('en-US')} adjusted=${normalAdjustedCount.toLocaleString('en-US')} chance=${formatPercent(baseChance)}`
    ];

    if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
      perRarityLines.push(`  normal crafted-estimate=${normalCraftedEstimate.toLocaleString('en-US')} (paintSeed=1000 × 1000)`);
    }

    if (shouldScanStatTrakEnabled) {
      perRarityLines.push(`  stattrak raw=${stattrakCount.toLocaleString('en-US')} adjusted=${stattrakAdjustedCount.toLocaleString('en-US')} chance=${formatPercent(stattrakChance)}`);

      if (shouldExcludeCrafted && rarityId !== lowestRarityId) {
        perRarityLines.push(`  stattrak crafted-estimate=${stattrakCraftedEstimate.toLocaleString('en-US')} (paintSeed=1000 × 1000)`);
      }

      const expectedNormalFromSt = stattrakAdjustedCount * 10;
      const expectedStFromNormal = normalAdjustedCount / 10;
      const missingNormalByRatio = Math.max(0, Math.round(expectedNormalFromSt - normalAdjustedCount));
      const missingStattrakByRatio = Math.max(0, Math.round(expectedStFromNormal - stattrakAdjustedCount));
      const ratio = stattrakAdjustedCount > 0
        ? normalAdjustedCount / stattrakAdjustedCount
        : null;

      perRarityLines.push(
        `  ratio-check 10:1 -> normal/stattrak=${ratio ? ratio.toFixed(2) : '∞'}; ` +
        `expected normal from ST=${Math.round(expectedNormalFromSt).toLocaleString('en-US')}, expected ST from normal=${Math.round(expectedStFromNormal).toLocaleString('en-US')}`
      );
      perRarityLines.push(
        `  potential hidden: normal≈${missingNormalByRatio.toLocaleString('en-US')}, stattrak≈${missingStattrakByRatio.toLocaleString('en-US')}`
      );

      if (baseChance > 0 && stattrakChance > 0) {
        const openingsByNormal = normalAdjustedCount / (baseChance / 100);
        const openingsByStattrak = stattrakAdjustedCount / (stattrakChance / 100);
        perRarityLines.push(
          `  openings estimate: normal-based≈${Math.round(openingsByNormal).toLocaleString('en-US')}, ` +
          `stattrak-based≈${Math.round(openingsByStattrak).toLocaleString('en-US')}`
        );
      }
    }

    perRarityLines.push(`  total=${rarityTotal.toLocaleString('en-US')} effectiveChance=${formatPercent(effectiveChance)}`);
    lines.push(perRarityLines.join('\n'));
  }

  const coverage = buildCoverageReport(coverageEntries, shouldScanStatTrakEnabled);

  return {
    report: formatScanReport(
      lines,
      `Тип: ${meta.kind}. Загальна кількість скінів: ${total.toLocaleString('en-US')}`,
      coverage.fullLines
    ),
    cardLines: coverage.cardLines
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

      const { report, cardLines } = await scanCollection(collectionId);
      blocks.push(`=== ${info.name} ===\n${report}`);
      renderCollectionCard({ collectionName: info.name, imageUrl: info.image, theoreticalLines: cardLines });
    }

    scanResult.value = blocks.join('\n\n');
    statusEl.textContent = 'Готово. Черга автозбору завершена.';
  } catch (error) {
    const reason = explainRuntimeError(error);
    statusEl.textContent = `Помилка під час автоматичного обходу: ${reason}`;
    scanResult.value = `Помилка сканування.\nПричина: ${reason}`;
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
  statusEl.textContent = 'Відкрито сторінку DB. Чекаю оновлення rate limit...';
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

startRateLimitPolling();
syncFromRange('min');
