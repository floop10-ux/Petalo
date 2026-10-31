const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID
  ? Number(process.env.OWNER_CHAT_ID)
  : null;

const SITE_URL = 'https://flowind.ru';
const BOT_USERNAME = 'flowind_rus_bot';

// ========== ВАЛЮТЫ ==========
const CURRENCY_SYMBOLS = {
  RUB: '₽', KZT: '₸', BYN: 'Br', UZS: 'сўм'
};

const CURRENCY_LIST = [
  { code: 'RUB', label: 'Российский рубль', sym: '₽' },
  { code: 'KZT', label: 'Казахстанский тенге', sym: '₸' },
  { code: 'BYN', label: 'Белорусский рубль', sym: 'Br' },
  { code: 'UZS', label: 'Узбекский сум', sym: 'сўм' }
];

function findCurrencyByCode(code) {
  if (!code) return null;
  return CURRENCY_LIST.find(c => c.code === code) || null;
}

function getShopCurrency(shop) {
  if (!shop || !shop.settings) return 'RUB';
  const code = shop.settings.currency;
  if (!code) return 'RUB';
  if (!CURRENCY_SYMBOLS[code]) return 'RUB';
  return code;
}

function formatNumber(n) {
  const num = parseInt(n, 10);
  if (isNaN(num)) return '0';
  const s = String(num);
  let out = '';
  let cnt = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    out = s[i] + out;
    cnt++;
    if (cnt === 3 && i > 0) {
      out = ' ' + out;
      cnt = 0;
    }
  }
  return out;
}

function getPriceRanges(shop) {
  const cur = getShopCurrency(shop);
  if (cur === 'UZS') return [300000, 600000, 1000000, 2000000];
  if (cur === 'KZT') return [15000, 30000, 50000, 100000];
  if (cur === 'BYN') return [100, 200, 350, 700];
  return [3000, 6000, 10000, 20000];
}

function formatPricePill(n, shop) {
  const cur = getShopCurrency(shop);
  if (cur === 'UZS' && n >= 1000000) {
    return (n / 1000000) + ' млн';
  }
  return formatNumber(n);
}

function formatPrice(price, shop) {
  const code = getShopCurrency(shop);
  const sym = CURRENCY_SYMBOLS[code] || '₽';
  return formatNumber(price) + ' ' + sym;
}

// ========== СТРАНЫ ==========
const COUNTRIES = [
  { code: 'RU', label: '🇷🇺 Россия' },
  { code: 'KZ', label: '🇰🇿 Казахстан' },
  { code: 'BY', label: '🇧🇾 Беларусь' },
  { code: 'UZ', label: '🇺🇿 Узбекистан' },
  { code: 'OTHER', label: '🌍 Другое' }
];

function findCountryByCode(code) {
  if (!code) return null;
  return COUNTRIES.find(c => c.code === code) || null;
}

const PRESET_SHOP = {
  shopId: 'kupidon',
  displayName: '🌸 Kupidon - для цветов не нужен повод',
  address: 'Ставрополь, Краснофлотская 157/1',
  hours: 'Пн-Вс 10:30-21:00',
  phone: '+7 962 402-51-75',
  telegramUsername: 'KupidonAdm',
  whatsappPhone: '+7 962 402-51-75',
  maxLink: 'https://max.ru/u/f9LHodD0cOJlhEYownGN' +
    '37InfSoqm2WiY7c7F38Yd1UEtSvBWADCLBqRny8',
  markupPercent: 20,
  trialMonths: 3
};

// ========== УТИЛИТЫ ==========
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

function normalizeName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function calculateOldPrice(price, percent) {
  const pct = (typeof percent === 'number' && percent >= 0) ? percent : 20;
  return Math.ceil(price * (1 + pct / 100) / 100) * 100;
}

function shortName(name, maxEach) {
  const n = maxEach || 12;
  const s = String(name || '');
  if (s.length <= n * 2 + 1) return s;
  return s.slice(0, n) + '…' + s.slice(-n);
}

function s3UrlToKey(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = '.storage.yandexcloud.net/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

function isConfirmedRecently(b) {
  if (!b) return false;
  if (b.deleted || b.hidden) return false;
  if (b.isPinned) return true;
  if (!b.confirmedAt) return false;
  return Date.now() - new Date(b.confirmedAt).getTime() < 3 * 24 * 60 * 60 * 1000;
}

function getBouquetStatus(b) {
  if (b.deleted) return 'deleted';
  if (b.isPinned) return 'pinned';
  if (b.hidden) return 'hidden';
  if (!b.confirmedAt) return 'expired';
  const age = Date.now() - new Date(b.confirmedAt).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (age < oneDay) return 'fresh';
  if (age < 3 * oneDay) return 'stale';
  return 'expired';
}

function hoursLeft(b) {
  if (!b.confirmedAt) return 0;
  const rem = 3 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(b.confirmedAt).getTime());
  return rem <= 0 ? 0 : Math.round(rem / 3600000);
}

function isSubscriptionActive(shop) {
  if (!shop || !shop.trialEnd) return false;
  return Date.now() < new Date(shop.trialEnd).getTime();
}

function getRemainingDays(shop) {
  if (!shop || !shop.trialEnd) return 0;
  const diff = new Date(shop.trialEnd).getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function isOwner(shop, chatId) {
  if (!shop || !shop.admins) return false;
  return shop.admins.some(a => a.chatId === chatId && a.role === 'owner');
}

function isServiceAdmin(chatId) {
  return OWNER_CHAT_ID && chatId === OWNER_CHAT_ID;
}

function getOwner(shop) {
  if (!shop || !shop.admins) return null;
  return shop.admins.find(a => a.role === 'owner');
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateShopId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'shop_' + s;
}

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 10) return null;
  if (digits.length === 10) return '+7' + digits;
  if (digits.length === 11) {
    if (digits[0] === '8') return '+7' + digits.slice(1);
    return '+' + digits;
  }
  return '+' + digits;
}

function formatPhone(normalized) {
  if (!normalized || typeof normalized !== 'string') return '';
  if (!normalized.startsWith('+')) return normalized;
  const digits = normalized.slice(1);
  if (digits.length === 11 && digits[0] === '7') {
    return '+7 ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9, 11);
  }
  return normalized;
}

// ========== ФОТО ==========
function isValidFileId(fileId) {
  if (!fileId || typeof fileId !== 'string') return false;
  return /^[A-Za-z0-9_\-]{20,}$/.test(fileId);
}

function isValidS3Url(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  return url.includes('.storage.yandexcloud.net/') || url.includes('timeweb');
}

// ========== ТЕГИ ==========
const TAG_DICTIONARY = [
  { tag: 'розы', stems: ['роз'] },
  { tag: 'пионы', stems: ['пион'] },
  { tag: 'тюльпаны', stems: ['тюльпан'] },
  { tag: 'лилии', stems: ['лили'] },
  { tag: 'хризантемы', stems: ['хризантем'] },
  { tag: 'герберы', stems: ['гербер'] },
  { tag: 'гвоздики', stems: ['гвоздик'] },
  { tag: 'ирисы', stems: ['ирис'] },
  { tag: 'орхидеи', stems: ['орхиде'] },
  { tag: 'ромашки', stems: ['ромашк'] },
  { tag: 'корзины', stems: ['корзин'] },
  { tag: 'сборные', stems: ['сборн', 'микс'] },
  { tag: 'букет_невесты', stems: ['невест'] },
  { tag: 'свадебные', stems: ['свадеб'] },
  { tag: 'на_выписку', stems: ['выписк'] },
  { tag: 'монобукет', stems: ['монобукет'] }
];

function extractTagsFromName(name) {
  if (!name) return [];
  const lower = String(name).toLowerCase();
  const found = [];
  for (const entry of TAG_DICTIONARY) {
    for (const stem of entry.stems) {
      if (lower.includes(stem)) {
        if (!found.includes(entry.tag)) found.push(entry.tag);
        break;
      }
    }
  }
  return found;
}

function extractCustomTags(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/#[а-яёa-z0-9_]+/gi) || [];
  return matches.map(t => t.slice(1).toLowerCase());
}

function computeAllTags(name, caption) {
  const auto = extractTagsFromName(name);
  const custom = extractCustomTags(caption || '');
  const all = [...auto];
  for (const t of custom) {
    if (!all.includes(t)) all.push(t);
  }
  return all;
}

// ========== ЧАСЫ РАБОТЫ ==========
function getNowMoscow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 3 * 60 * 60000);
}

function parseShopHours(hoursStr) {
  if (!hoursStr || typeof hoursStr !== 'string') return null;
  const match = hoursStr.match(/(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  const openH = parseInt(match[1], 10);
  const openM = match[2] ? parseInt(match[2], 10) : 0;
  const closeH = parseInt(match[3], 10);
  const closeM = match[4] ? parseInt(match[4], 10) : 0;
  if (isNaN(openH) || isNaN(closeH)) return null;
  if (openH < 0 || openH > 23) return null;
  if (closeH < 0 || closeH > 24) return null;
  return { openH, openM, closeH, closeM };
}

function isWithinWorkingHours(hoursStr) {
  const now = getNowMoscow();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const parsed = parseShopHours(hoursStr);
  if (!parsed) return nowMinutes >= 8 * 60 && nowMinutes < 21 * 60;

  const openMinutes = parsed.openH * 60 + parsed.openM;
  let closeMinutes = parsed.closeH * 60 + parsed.closeM;
  if (closeMinutes === 0) closeMinutes = 24 * 60;

  if (parsed.openH === 0 && parsed.closeH >= 24) return true;
  if (openMinutes === 0 && closeMinutes >= 24 * 60) return true;

  if (closeMinutes < openMinutes) {
    return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
  }
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

// ========== ПАРСЕР ЦЕНЫ ==========
const CURRENCY_SUFFIXES = [
  'рублей', 'рубля', 'рубль', 'руб',
  'р', '₽', 'сум', 'сўм', 'тг', '₸',
  'br', 'byn'
];

function cleanPriceWord(word) {
  if (!word) return null;
  let w = String(word).trim().toLowerCase();
  w = w.replace(/\s+/g, '');
  w = w.replace(/[,]/g, '');
  for (const suf of CURRENCY_SUFFIXES) {
    if (w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  w = w.trim();
  if (!w) return null;
  if (!/^\d+$/.test(w)) return null;
  const n = parseInt(w, 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

function parseCaption(rawCaption) {
  const caption = String(rawCaption || '').trim();
  if (!caption) return { ok: false, reason: 'empty' };
  const words = caption.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) return { ok: false, reason: 'too_short' };
  
  const lastWord = words[words.length - 1];
  const price = cleanPriceWord(lastWord);
  
  if (price === null) {
    const digitsOnly = lastWord.replace(/[^\d]/g, '');
    if (digitsOnly.length > 0) return { ok: false, reason: 'price_with_extra', lastWord };
    return { ok: false, reason: 'price_not_number', lastWord };
  }
  
  const name = words.slice(0, -1).join(' ').trim();
  if (name.length < 2) return { ok: false, reason: 'name_too_short' };
  return { ok: true, name, price };
}

function buildParseErrorText(parseResult, rawCaption) {
  const reason = parseResult && parseResult.reason ? parseResult.reason : 'unknown';

  if (reason === 'price_with_extra') {
    const lw = parseResult.lastWord || '';
    let t = '❌ <b>Не могу разобрать цену.</b>\n\n';
    t += 'Последнее слово: <code>' + esc(lw) + '</code>\n\n';
    t += 'Цена должна быть <b>только цифрами</b>.\n\n';
    t += '✅ <b>Правильно:</b>\n  <code>31 роза 3500</code>\n  <code>51 хризантема 10000</code>\n\n';
    t += '❌ <b>Неправильно:</b>\n  <code>31 роза 3500₽</code>\n  <code>31 роза 3500р</code>\n  <code>31 роза 3500.50</code>\n\n';
    t += '💡 Просто уберите символы — оставьте только цифры.';
    return t;
  }

  if (reason === 'price_not_number') {
    let t = '❌ <b>Не могу найти цену.</b>\n\n';
    t += 'Последнее слово должно быть <b>ценой</b> —\nодним числом.\n\n';
    t += '✅ <b>Правильно:</b>\n  <code>31 роза 3500</code>\n  <code>Пионы 4500</code>\n  <code>Микс 2800</code>\n\n';
    t += '❌ <b>Неправильно:</b>\n  <code>31 роза 3500 сорт Аваланж</code>\n     (цена не последняя)\n\n';
    t += '💡 Формат: <b>название + цена последним словом</b>';
    return t;
  }

  if (reason === 'too_short' || reason === 'empty') {
    let t = '❌ <b>Слишком короткая подпись.</b>\n\n';
    t += 'В подписи должно быть <b>название и цена</b>.\n\n';
    t += '✅ <b>Пример:</b>\n  <code>31 роза 3500</code>\n  <code>Пионы 4500</code>\n\n';
    t += '💡 Или нажмите /cancel, чтобы отменить.';
    return t;
  }

  if (reason === 'name_too_short') {
    let t = '❌ <b>Название слишком короткое.</b>\n\n';
    t += 'Перед ценой напишите название букета —\nминимум 2 символа.\n\n';
    t += '✅ <b>Пример:</b>\n  <code>31 роза 3500</code>\n  <code>Пионы 4500</code>';
    return t;
  }

  let t = '❌ <b>Не могу разобрать подпись.</b>\n\n';
  t += 'Правильно: <b>31 роза 3500</b>\n(название, потом цена — последним словом)\n\n';
  t += 'Попробуйте ещё раз или нажмите /cancel';
  return t;
}

// ========== ВИЗУАЛ ==========
const PRESET_BACKGROUNDS = [
  { id: 1, name: 'Тёплый крем', emoji: '🍦', gradient: 'linear-gradient(180deg,#fdf9f3 0%,#fafaf8 40%,#f7f5f1 100%)' },
  { id: 2, name: 'Чистый белый', emoji: '⚪', gradient: 'linear-gradient(180deg,#ffffff 0%,#fafafa 60%,#f5f5f5 100%)' },
  { id: 3, name: 'Нежный розовый', emoji: '🌸', gradient: 'linear-gradient(180deg,#fdf2f5 0%,#fbe8ef 50%,#f7dae5 100%)' },
  { id: 4, name: 'Ботанический', emoji: '🌿', gradient: 'linear-gradient(180deg,#f2f7f0 0%,#e8f0e5 50%,#dfe8db 100%)' },
  { id: 5, name: 'Серо-голубой', emoji: '💎', gradient: 'linear-gradient(180deg,#f5f7fa 0%,#eaeef3 50%,#dee5ec 100%)' },
  { id: 6, name: 'Акварель', emoji: '🎨', gradient: 'linear-gradient(180deg,#fdf5f0 0%,#f9e8de 50%,#f4dcd0 100%)' },
  { id: 7, name: 'Мрамор', emoji: '🏛', gradient: 'linear-gradient(180deg,#fbfaf8 0%,#f2eeea 50%,#e8e3dc 100%)' },
  { id: 8, name: 'Новогодний', emoji: '❄️', gradient: 'linear-gradient(180deg,#f5f7fa 0%,#e8edf3 50%,#dce3ea 100%)' },
  { id: 9, name: 'Весенний', emoji: '🌷', gradient: 'linear-gradient(180deg,#fff5f7 0%,#fce4ea 50%,#f8d5de 100%)' },
  { id: 10, name: 'Осенний', emoji: '🍂', gradient: 'linear-gradient(180deg,#fdf4ea 0%,#f8e4cf 50%,#f2d4b6 100%)' }
];

function findPresetById(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  return PRESET_BACKGROUNDS.find(b => b.id === n) || null;
}

function isPresetBackground(bgSetting) {
  if (!bgSetting) return false;
  if (typeof bgSetting !== 'object') return false;
  return bgSetting.type === 'preset';
}

function hasAnyBackground(shop) {
  if (!shop || !shop.settings) return false;
  const bg = shop.settings.background;
  if (!bg) return false;
  if (isPresetBackground(bg)) return true;
  if (typeof bg === 'object' && (bg.s3 || bg.tg)) return true;
  return false;
}

function hasAnyLogo(shop) {
  if (!shop || !shop.settings) return false;
  return !!shop.settings.logo;
}

const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg,#fbe8ef 0%,#f7dae5 100%)',
  'linear-gradient(135deg,#e8f0e5 0%,#dfe8db 100%)',
  'linear-gradient(135deg,#eaeef3 0%,#dee5ec 100%)',
  'linear-gradient(135deg,#f9e8de 0%,#f4dcd0 100%)',
  'linear-gradient(135deg,#f2eeea 0%,#e8e3dc 100%)'
];

function getPlaceholderGradient(seed) {
  const n = parseInt(seed, 10) || 0;
  return PLACEHOLDER_GRADIENTS[n % PLACEHOLDER_GRADIENTS.length];
}

const BUTTON_COLORS = [
  { id: 'red', name: 'Красный', emoji: '🔴', color: '#e74c3c', dark: '#c0392b' },
  { id: 'pink', name: 'Розовый', emoji: '🌸', color: '#e91e63', dark: '#ad1457' },
  { id: 'green', name: 'Зелёный', emoji: '💚', color: '#27ae60', dark: '#1e8449' },
  { id: 'graphite', name: 'Графит', emoji: '🖤', color: '#2c3e50', dark: '#1a252f' },
  { id: 'blue', name: 'Синий', emoji: '🔵', color: '#3498db', dark: '#21618c' },
  { id: 'lavender', name: 'Лаванда', emoji: '🟣', color: '#9b59b6', dark: '#71368a' }
];

function findColorById(id) {
  if (!id) return null;
  return BUTTON_COLORS.find(c => c.id === id) || null;
}

function getButtonColors(shop) {
  const def = { color: '#e74c3c', dark: '#c0392b' };
  if (!shop || !shop.settings) return def;
  const id = shop.settings.buttonColor;
  if (!id) return def;
  const found = findColorById(id);
  return found || def;
}

// ========== КОНСТАНТЫ UI ==========
const TWO_COLUMNS_THRESHOLD = 12;
const MENU_BUTTONS = [
  '📷 Добавить букет', '✅ Что в наличии?', '✏️ Мои букеты',
  '🔗 Витрина', '📦 Склад', '⚙️ Настройки', '⚙️ Меню'
];

const ADD_BOUQUET_HINT = 
  `📷 <b>Пришлите фото букета с подписью.</b>\n\n` +
  `В подписи: название + цена.\n` +
  `Цена — <b>последнее слово</b>, одно число.\n\n` +
  `✅ <b>Правильно:</b>\n` +
  `  31 роза 3500\n` +
  `  Пионы 4500\n` +
  `  31 роза 50см сорт Аваланж 3500\n` +
  `  Микс 2800\n\n` +
  `❌ <b>Неправильно:</b>\n` +
  `  31 роза 3500 сорт Аваланж цена\n` +
  `     (после цены есть слова)\n` +
  `  3500 31 роза\n` +
  `     (цена в начале)\n\n` +
  `💡 Ещё фото — без подписи.`;

const REG_STEPS = {
  shopId: { text: '📝 <b>Шаг 1 из 9. Короткое название для ссылки</b>\n\nТолько латинские буквы, цифры и _.\nНапример: <code>cveti_msk</code>', skip: true, mandatory: true },
  displayName: { text: '✅ <b>Шаг 2 из 9. Красивое название</b>\n\nКак назвать магазин для клиентов?', skip: false, mandatory: true },
  country: { text: '🌍 <b>Шаг 3 из 9. В какой стране магазин?</b>', skip: true, mandatory: false },
  address: { text: '✅ <b>Шаг 4 из 9. Адрес</b>', skip: true, mandatory: false },
  hours: { text: '✅ <b>Шаг 5 из 9. Часы работы</b>', skip: true, mandatory: false },
  phone: { text: '✅ <b>Шаг 6 из 9. Телефон</b>', skip: true, mandatory: false },
  telegram: { text: '✅ <b>Шаг 7 из 9. Ваш юзернейм в Telegram</b>', skip: true, mandatory: false },
  whatsapp: { text: '✅ <b>Шаг 8 из 9. Номер WhatsApp</b>', skip: true, mandatory: false },
  max: { text: '✅ <b>Шаг 9 из 9. Ссылка на профиль в MAX</b>', skip: true, mandatory: false }
};

const REG_ORDER = ['shopId', 'displayName', 'country', 'address', 'hours', 'phone', 'telegram', 'whatsapp', 'max'];
const CHECK_PER_PAGE = 25;
const LIST_PER_PAGE = 25;
const SEARCH_PER_PAGE = 25;
const CLICK_NOTIFY_TTL = 10 * 60 * 1000;

// ========== ЭКСПОРТ ==========
module.exports = {
  OWNER_CHAT_ID, SITE_URL, BOT_USERNAME,
  CURRENCY_SYMBOLS, CURRENCY_LIST, findCurrencyByCode,
  getShopCurrency, formatNumber, getPriceRanges,
  formatPricePill, formatPrice,
  COUNTRIES, findCountryByCode, PRESET_SHOP,
  esc, escAttr, normalizeName, calculateOldPrice,
  shortName, s3UrlToKey, isConfirmedRecently,
  getBouquetStatus, hoursLeft, isSubscriptionActive,
  getRemainingDays, isOwner, isServiceAdmin,
  getOwner, generateInviteCode, generateShopId,
  normalizePhone, formatPhone,
  isValidFileId, isValidS3Url,
  TAG_DICTIONARY, extractTagsFromName,
  extractCustomTags, computeAllTags,
  getNowMoscow, parseShopHours, isWithinWorkingHours,
  cleanPriceWord, parseCaption, buildParseErrorText,
  PRESET_BACKGROUNDS, PLACEHOLDER_GRADIENTS, getPlaceholderGradient,
  BUTTON_COLORS, findColorById, getButtonColors,
  findPresetById, isPresetBackground, hasAnyBackground, hasAnyLogo,
  TWO_COLUMNS_THRESHOLD, MENU_BUTTONS, ADD_BOUQUET_HINT,
  REG_STEPS, REG_ORDER, CHECK_PER_PAGE,
  LIST_PER_PAGE, SEARCH_PER_PAGE, CLICK_NOTIFY_TTL
};