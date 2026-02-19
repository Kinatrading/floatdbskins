const collectionSelect = document.getElementById('collectionSelect');
const minRange = document.getElementById('minRange');
const maxRange = document.getElementById('maxRange');
const minInput = document.getElementById('minInput');
const maxInput = document.getElementById('maxInput');
const resultUrl = document.getElementById('resultUrl');
const openBtn = document.getElementById('openBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const rangeFill = document.getElementById('rangeFill');

const STEP = 0.01;

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

function updateRangeFill() {
  const min = Number(minRange.value);
  const max = Number(maxRange.value);
  rangeFill.style.left = `${min * 100}%`;
  rangeFill.style.width = `${(max - min) * 100}%`;
}

function getLink() {
  const collection = collectionSelect.value;
  const min = formatFloat(minRange.value);
  const max = formatFloat(maxRange.value);
  return `https://csfloat.com/db?min=${min}&max=${max}&collection=${collection}`;
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

minRange.addEventListener('input', () => syncFromRange('min'));
maxRange.addEventListener('input', () => syncFromRange('max'));
minInput.addEventListener('change', () => syncFromInput('min'));
maxInput.addEventListener('change', () => syncFromInput('max'));
collectionSelect.addEventListener('change', renderLink);

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

loadCollections().catch((error) => {
  statusEl.textContent = 'Помилка завантаження колекцій.';
  console.error(error);
});

syncFromRange('min');
