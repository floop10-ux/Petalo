const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID
  ? Number(process.env.OWNER_CHAT_ID)
  : null;

const SITE_URL = 'https://flowind.ru';
const BOT_USERNAME = 'flowind_rus_bot';

// ========== ВАЛЮТЫ ==========
const CURRENCY_SYMBOLS = {
  RUB: '₽',
  KZT: '₸',
  BYN: 'Br',
  UZS: 'сўм'
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
  if (cur === 'UZS') {
    return [300000, 600000, 1000000, 2000000];
  }
  if (cur === 'KZT') {
    return [15000, 30000, 50000, 100000];
  }
  if (cur === 'BYN') {
    return [100, 200, 350, 700];
  }
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

// ========== ПРЕСЕТ ==========
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
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function calculateOldPrice(price, percent) {
  const pct = (typeof percent === 'number' && percent >= 0)
    ? percent
    : 20;
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
  return Date.now() - new Date(b.confirmedAt).getTime()
    < 3 * 24 * 60 * 60 * 1000;
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
  const rem = 3 * 24 * 60 * 60 * 1000 -
    (Date.now() - new Date(b.confirmedAt).getTime());
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
  return shop.admins.some(
    a => a.chatId === chatId && a.role === 'owner'
  );
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
    return '+7 ' +
      digits.slice(1, 4) + ' ' +
      digits.slice(4, 7) + '-' +
      digits.slice(7, 9) + '-' +
      digits.slice(9, 11);
  }
  return normalized;
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
        if (!found.includes(entry.tag)) {
          found.push(entry.tag);
        }
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
  const utcMs = now.getTime() +
    now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 3 * 60 * 60000);
}

function parseShopHours(hoursStr) {
  if (!hoursStr || typeof hoursStr !== 'string') {
    return null;
  }
  const match = hoursStr.match(
    /(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/
  );
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
  const nowMinutes = now.getHours() * 60 +
    now.getMinutes();
  const parsed = parseShopHours(hoursStr);

  if (!parsed) {
    return nowMinutes >= 8 * 60 && nowMinutes < 21 * 60;
  }

  const openMinutes = parsed.openH * 60 + parsed.openM;
  let closeMinutes = parsed.closeH * 60 + parsed.closeM;
  if (closeMinutes === 0) closeMinutes = 24 * 60;

  if (parsed.openH === 0 && parsed.closeH >= 24) {
    return true;
  }
  if (openMinutes === 0 && closeMinutes >= 24 * 60) {
    return true;
  }

  if (closeMinutes < openMinutes) {
    return nowMinutes >= openMinutes ||
      nowMinutes < closeMinutes;
  }

  return nowMinutes >= openMinutes &&
    nowMinutes < closeMinutes;
}