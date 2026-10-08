const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require('@aws-sdk/client-s3');
const pool = require('./db');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error(
    '❌ BOT_TOKEN не задан в переменных окружения Render'
  );
  process.exit(1);
}

const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID
  ? Number(process.env.OWNER_CHAT_ID)
  : null;

if (!OWNER_CHAT_ID) {
  console.log('⚠️ OWNER_CHAT_ID не задан — preset отключён');
} else {
  console.log('✅ OWNER_CHAT_ID: ' + OWNER_CHAT_ID);
}

const YC_BUCKET = process.env.YC_BUCKET_NAME;
const YC_ACCESS_KEY_ID = process.env.YC_ACCESS_KEY_ID;
const YC_SECRET_ACCESS_KEY = process.env.YC_SECRET_ACCESS_KEY;
const S3_ENABLED = !!(
  YC_BUCKET &&
  YC_ACCESS_KEY_ID &&
  YC_SECRET_ACCESS_KEY
);

let s3 = null;
if (S3_ENABLED) {
  s3 = new S3Client({
    region: 'ru-central1',
    endpoint: 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId: YC_ACCESS_KEY_ID,
      secretAccessKey: YC_SECRET_ACCESS_KEY
    }
  });
  console.log(
    '✅ S3-клиент инициализирован (bucket: ' + YC_BUCKET + ')'
  );
} else {
  console.log('⚠️ Yandex S3 не настроен — фото через Telegram');
}

process.on('unhandledRejection', (e) => {
  console.error('⚠️ Unhandled rejection:', e?.message || e);
});
process.on('uncaughtException', (e) => {
  console.error('⚠️ Uncaught exception:', e?.message || e);
});

app.use(express.json());

const bot = new TelegramBot(token);

bot.on('error', (e) => {
  console.error('⚠️ Bot error:', e?.message || e);
});
bot.on('webhook_error', (e) => {
  console.error('⚠️ Webhook error:', e?.message || e);
});

const WEBHOOK_PATH = `/bot${token}`;
app.post(WEBHOOK_PATH, (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error('⚠️ Ошибка обработки апдейта:', e?.message || e);
  }
  res.sendStatus(200);
});

const BOT_USERNAME = 'flowind_rus_bot';
const SITE_URL = 'https://flowind.ru';

// 🧪 BETA-доступ к новым функциям
const BETA_SHOPS = ['kupidon'];

function isBetaShop(shopId) {
  if (BETA_SHOPS.length === 0) return true;
  return BETA_SHOPS.includes(shopId);
}

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

// ========== ОНБОРДИНГ ==========
const OWNER_STEPS = [
  'add_bouquet',
  'view_shop',
  'edit_price',
  'hide_bouquet',
  'restore_bouquet',
  'check_stock',
  'settings_tour',
  'done'
];

const FLORIST_STEPS = [
  'add_bouquet',
  'check_stock',
  'on_shift'
];

const PRESET_SHOP = {
  shopId: 'kupidon',
  displayName: '🌸 Kupidon - для цветов не нужен повод',
  address: 'Ставрополь, Краснофлотская 157/1',
  hours: 'Пн-Вс 10:30-21:00',
  phone: '+7 962 402-51-75',
  telegramUsername: 'KupidonAdm',
  whatsappPhone: '+7 962 402-51-75',
  maxLink:
    'https://max.ru/u/f9LHodD0cOJlhEYownGN37InfSoqm2WiY7c7F38Yd1UEtSvBWADCLBqRny8',
  markupPercent: 20,
  trialMonths: 3
};

const userToShop = {};
const registrationState = {};
const lastBouquetByUser = {};
const awaitingInput = {};
const awaitingUpload = {};
const awaitingPrice = {};
const awaitingName = {};
const awaitingMarkup = {};
const awaitingSearch = {};
const awaitingOnboarding = {};
const photoUrlCache = {};
const checkSessions = {};
const archiveSessions = {};
const searchSessions = {};
const notifiedClicks = {};
const awaitingAdminMessage = {};
const awaitingAdminBlockReason = {};
const morningReminderSent = {};
const morningLaterSent = {};
const visualReminderSent = {};
const lastNavByChat = {};

const NAV_TTL = 10 * 60 * 1000;

async function sendNav(chatId, text, opts) {
  try {
    const prev = lastNavByChat[chatId];
    if (prev && (Date.now() - prev.ts) < NAV_TTL) {
      await bot.deleteMessage(chatId, prev.id)
        .catch(function(){});
    }
  } catch (e) { /* ignore */ }
  const sent = await bot.sendMessage(chatId, text, opts);
  lastNavByChat[chatId] = {
    id: sent.message_id,
    ts: Date.now()
  };
  return sent;
}

const TWO_COLUMNS_THRESHOLD = 12;

const MENU_BUTTONS = [
  '📷 Добавить букет',
  '✅ Что в наличии?',
  '✏️ Мои букеты',
  '🔗 Витрина',
  '⚙️ Настройки',
  '⚙️ Меню'
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

function esc(s) {
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

// ========== ОНБОРДИНГ — функции ==========
async function getOwnerOnboardingState(shopId) {
  const res = await pool.query(
    'SELECT settings FROM shops WHERE shop_id = $1',
    [shopId]
  );
  if (res.rows.length === 0) return null;
  const settings = res.rows[0].settings || {};
  return {
    step: settings.onboardingStep || null,
    passed: settings.onboardingPassed === true
  };
}

async function setOwnerOnboardingStep(shopId, step) {
  await pool.query(
    `UPDATE shops SET settings = jsonb_set(` +
    `COALESCE(settings, '{}'::jsonb), ` +
    `'{onboardingStep}', to_jsonb($2::text)) ` +
    `WHERE shop_id = $1`,
    [shopId, step]
  );
}

async function setOwnerOnboardingPassed(shopId) {
  await pool.query(
    `UPDATE shops SET settings = jsonb_set(` +
    `COALESCE(settings, '{}'::jsonb), ` +
    `'{onboardingPassed}', 'true'::jsonb) ` +
    `WHERE shop_id = $1`,
    [shopId]
  );
}

async function getFloristOnboardingState(chatId, shopId) {
  const res = await pool.query(
    `SELECT id, onboarding_step, onboarding_passed ` +
    `FROM admins WHERE chat_id = $1 AND shop_id = $2`,
    [chatId, shopId]
  );
  if (res.rows.length === 0) return null;
  return {
    id: res.rows[0].id,
    step: res.rows[0].onboarding_step || null,
    passed: res.rows[0].onboarding_passed === true
  };
}

async function setFloristOnboardingStep(chatId, shopId, step) {
  await pool.query(
    `UPDATE admins SET onboarding_step = $3 ` +
    `WHERE chat_id = $1 AND shop_id = $2`,
    [chatId, shopId, step]
  );
}

async function setFloristOnboardingPassed(chatId, shopId) {
  await pool.query(
    `UPDATE admins SET onboarding_passed = TRUE ` +
    `WHERE chat_id = $1 AND shop_id = $2`,
    [chatId, shopId]
  );
}

function nextOwnerStep(current) {
  const idx = OWNER_STEPS.indexOf(current);
  if (idx === -1 || idx >= OWNER_STEPS.length - 1) {
    return OWNER_STEPS[OWNER_STEPS.length - 1];
  }
  return OWNER_STEPS[idx + 1];
}

function nextFloristStep(current) {
  const idx = FLORIST_STEPS.indexOf(current);
  if (idx === -1 || idx >= FLORIST_STEPS.length - 1) {
    return FLORIST_STEPS[FLORIST_STEPS.length - 1];
  }
  return FLORIST_STEPS[idx + 1];
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

function formatConfirmedAt(confirmedAt) {
  if (!confirmedAt) return null;
  const ageMs = Date.now() - new Date(confirmedAt).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) return null;
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) {
    return `${mins} ${plural(mins, 'минуту', 'минуты', 'минут')} назад`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return 'час назад';
  return `${hrs} ${plural(hrs, 'час', 'часа', 'часов')} назад`;
}

// ========== ЧАСЫ РАБОТЫ ==========
function getNowMoscow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 3 * 60 * 60000);
}

function parseShopHours(hoursStr) {
  if (!hoursStr || typeof hoursStr !== 'string') return null;
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
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const parsed = parseShopHours(hoursStr);

  if (!parsed) {
    return nowMinutes >= 8 * 60 && nowMinutes < 21 * 60;
  }

  const openMinutes = parsed.openH * 60 + parsed.openM;
  let closeMinutes = parsed.closeH * 60 + parsed.closeM;
  if (closeMinutes === 0) closeMinutes = 24 * 60;

  if (parsed.openH === 0 && parsed.closeH >= 24) return true;
  if (openMinutes === 0 && closeMinutes >= 24 * 60) return true;

  if (closeMinutes < openMinutes) {
    return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
  }

  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}// ========== УВЕДОМЛЕНИЯ О КЛИКАХ ==========
const CLICK_NOTIFY_TTL = 10 * 60 * 1000;

const CLICK_TYPE_NAMES = {
  tg: '📩 Telegram',
  wa: '💬 WhatsApp',
  max: '🅼 MAX',
  call: '📞 Звонок'
};

function sendClickNotification(shop, bouquet, type) {
  if (!shop || !shop.admins || shop.admins.length === 0) return;
  const channelName = CLICK_TYPE_NAMES[type] || 'Мессенджер';
  const isCall = type === 'call';
  const priceStr = formatPrice(bouquet.price, shop);

  const onShiftAdmins = shop.admins.filter(a => a.onShift);

  if (onShiftAdmins.length > 0) {
    const action = isCall ? 'Позвонить' : 'Связаться';
    let text = `🔔 <b>Клиент нажал «${action}»</b>\n\n`;
    text += `Букет <b>№${bouquet.shopNumber}</b> `;
    text += `«${esc(bouquet.name)}» — <b>${priceStr}</b>\n`;
    text += `Канал: ${channelName}\n\n`;
    text += isCall
      ? `<i>Ожидайте звонка.</i>`
      : `<i>Возможно, он уже пишет вам — проверьте.</i>`;

    for (const admin of onShiftAdmins) {
      bot.sendMessage(admin.chatId, text, { parse_mode: 'HTML' })
        .catch(function(){});
    }
    return;
  }

  const owner = shop.admins.find(a => a.role === 'owner');
  if (!owner) return;

  const action = isCall ? 'Позвонить' : 'Связаться';
  let warnText = `⚠️ <b>На смене никого</b>\n\n`;
  warnText += `Клиент нажал «${action}»\n\n`;
  warnText += `Букет <b>№${bouquet.shopNumber}</b> `;
  warnText += `«${esc(bouquet.name)}» — <b>${priceStr}</b>\n`;
  warnText += `Канал: ${channelName}\n\n`;
  warnText += `<i>Напомните флористам отметиться: `;
  warnText += `«✅ Я сегодня работаю».</i>`;

  bot.sendMessage(owner.chatId, warnText, { parse_mode: 'HTML' })
    .catch(function(){});
}

function cleanupNotifiedClicks() {
  const now = Date.now();
  for (const k of Object.keys(notifiedClicks)) {
    if (now - notifiedClicks[k] > CLICK_NOTIFY_TTL) {
      delete notifiedClicks[k];
    }
  }
}

async function setUserOnShift(chatId, shopId, on) {
  if (on) {
    await pool.query(
      `UPDATE admins SET on_shift_until = ` +
      `NOW() + INTERVAL '14 hours' ` +
      `WHERE chat_id = $1 AND shop_id = $2`,
      [chatId, shopId]
    );
  } else {
    await pool.query(
      `UPDATE admins SET on_shift_until = NULL ` +
      `WHERE chat_id = $1 AND shop_id = $2`,
      [chatId, shopId]
    );
  }
}

// ========== РАБОТА С ФОТО ==========
function isValidFileId(fileId) {
  if (!fileId || typeof fileId !== 'string') return false;
  return /^[A-Za-z0-9_\-]{20,}$/.test(fileId);
}

function isValidS3Url(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  return url.includes('.storage.yandexcloud.net/');
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await bot.getFile(fileId);
  const url =
    `https://api.telegram.org/file/bot${token}/` +
    `${fileInfo.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function uploadToS3(buffer, key) {
  if (!s3) throw new Error('S3 disabled');
  const cmd = new PutObjectCommand({
    Bucket: YC_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg'
  });
  await s3.send(cmd);
  return (
    `https://${YC_BUCKET}.storage.yandexcloud.net/${key}`
  );
}

async function savePhotoToStorage(telegramFileId, shopId) {
  if (!S3_ENABLED) {
    return { tg: telegramFileId };
  }
  try {
    const buffer = await downloadTelegramFile(telegramFileId);
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `${shopId}/${Date.now()}_${rand}.jpg`;
    const url = await uploadToS3(buffer, key);
    console.log('📤 Фото в S3:', key);
    return { s3: url, tg: telegramFileId };
  } catch (e) {
    console.error('⚠️ Ошибка загрузки в S3:', e?.message || e);
    return { tg: telegramFileId };
  }
}

function getPhotoRefs(photo) {
  if (!photo) return { primary: null, fallback: null };
  if (typeof photo === 'string') {
    if (photo.startsWith('http://') ||
        photo.startsWith('https://')) {
      return { primary: photo, fallback: null };
    }
    if (isValidFileId(photo)) {
      return { primary: '/photo/tg/' + photo, fallback: null };
    }
    return { primary: null, fallback: null };
  }
  if (typeof photo === 'object') {
    if (photo.s3 && photo.tg) {
      return {
        primary: photo.s3,
        fallback: '/photo/tg/' + photo.tg
      };
    }
    if (photo.s3) {
      return { primary: photo.s3, fallback: null };
    }
    if (photo.tg) {
      return {
        primary: '/photo/tg/' + photo.tg,
        fallback: null
      };
    }
  }
  return { primary: null, fallback: null };
}

function getTelegramPhotoRef(photo) {
  if (!photo) return null;
  if (typeof photo === 'string') {
    if (isValidFileId(photo)) return photo;
    if (photo.startsWith('http')) return photo;
    return null;
  }
  if (typeof photo === 'object') {
    if (photo.s3) return photo.s3;
    if (photo.tg) return photo.tg;
  }
  return null;
}

function renderImgTag(refs, style) {
  if (!refs.primary) return null;
  const p = escAttr(refs.primary);
  const st = style || '';
  if (refs.fallback) {
    const f = escAttr(refs.fallback);
    const errHandler =
      `this.onerror=null;this.src='${f}'`;
    let html = `<img src="${p}"`;
    if (st) html += ` style="${st}"`;
    html += ` onerror="${errHandler}">`;
    return html;
  }
  let html = `<img src="${p}"`;
  if (st) html += ` style="${st}"`;
  html += `>`;
  return html;
}

function absoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') ||
      url.startsWith('https://')) {
    return url;
  }
  return SITE_URL + url;
}

async function migratePhotosToS3(shopId) {
  const result = { migrated: 0, skipped: 0, failed: 0 };
  if (!S3_ENABLED) return result;

  const bouquets = await getBouquetsFromDb(shopId, true);
  for (const b of bouquets) {
    if (!b.photos || b.photos.length === 0) continue;
    let changed = false;
    const newPhotos = [];
    for (const ref of b.photos) {
      if (ref && typeof ref === 'string' &&
          (ref.startsWith('http://') ||
           ref.startsWith('https://'))) {
        newPhotos.push(ref);
        result.skipped++;
        continue;
      }
      if (!isValidFileId(ref)) {
        newPhotos.push(ref);
        result.skipped++;
        continue;
      }
      try {
        const buf = await downloadTelegramFile(ref);
        const rand = Math.random().toString(36).slice(2, 8);
        const key =
          `${shopId}/${Date.now()}_${b.id}_${rand}.jpg`;
        const url = await uploadToS3(buf, key);
        newPhotos.push({ s3: url, tg: ref });
        result.migrated++;
        changed = true;
      } catch (e) {
        console.error(
          '⚠️ Миграция фото не удалась (id=' +
          b.id + '):', e?.message || e
        );
        newPhotos.push(ref);
        result.failed++;
      }
    }
    if (changed) {
      await updateBouquetField(
        b.id, 'photos', JSON.stringify(newPhotos)
      );
    }
  }

  const shop = await getShopFromDb(shopId);
  if (shop) {
    const settings = { ...shop.settings };
    let settingsChanged = false;
    for (const field of ['logo', 'background']) {
      const ref = settings[field];
      if (!ref) continue;
      if (typeof ref === 'object') {
        result.skipped++;
        continue;
      }
      if (typeof ref === 'string' &&
          (ref.startsWith('http://') ||
           ref.startsWith('https://'))) {
        result.skipped++;
        continue;
      }
      if (!isValidFileId(ref)) continue;
      try {
        const buf = await downloadTelegramFile(ref);
        const rand = Math.random().toString(36).slice(2, 8);
        const key =
          `${shopId}/_${field}_${Date.now()}_${rand}.jpg`;
        const url = await uploadToS3(buf, key);
        settings[field] = { s3: url, tg: ref };
        settingsChanged = true;
        result.migrated++;
      } catch (e) {
        console.error(
          '⚠️ Миграция ' + field + ' не удалась:',
          e?.message || e
        );
        result.failed++;
      }
    }
    if (settingsChanged) {
      await saveShopSettings(shopId, settings);
    }
  }

  return result;
}

async function getPhotoUrl(fileRef) {
  if (!fileRef) return null;
  if (typeof fileRef === 'object') {
    if (fileRef.s3) return fileRef.s3;
    if (fileRef.tg) fileRef = fileRef.tg;
    else return null;
  }
  if (typeof fileRef !== 'string') return null;
  if (fileRef.startsWith('https://') ||
      fileRef.startsWith('http://')) {
    return fileRef;
  }
  if (!isValidFileId(fileRef)) return null;
  const cached = photoUrlCache[fileRef];
  if (cached && cached.expires > Date.now()) {
    return cached.url;
  }
  try {
    const fileInfo = await bot.getFile(fileRef);
    const url =
      `https://api.telegram.org/file/bot${token}/` +
      `${fileInfo.file_path}`;
    photoUrlCache[fileRef] = {
      url,
      expires: Date.now() + 50 * 60 * 1000
    };
    return url;
  } catch (e) {
    return null;
  }
}// ========== ПРЕСЕТЫ ФОНОВ ==========
const PRESET_BACKGROUNDS = [
  {
    id: 1,
    name: 'Тёплый крем',
    emoji: '🍦',
    gradient:
      'linear-gradient(180deg,' +
      '#fdf9f3 0%,#fafaf8 40%,#f7f5f1 100%)'
  },
  {
    id: 2,
    name: 'Чистый белый',
    emoji: '⚪',
    gradient:
      'linear-gradient(180deg,' +
      '#ffffff 0%,#fafafa 60%,#f5f5f5 100%)'
  },
  {
    id: 3,
    name: 'Нежный розовый',
    emoji: '🌸',
    gradient:
      'linear-gradient(180deg,' +
      '#fdf2f5 0%,#fbe8ef 50%,#f7dae5 100%)'
  },
  {
    id: 4,
    name: 'Ботанический',
    emoji: '🌿',
    gradient:
      'linear-gradient(180deg,' +
      '#f2f7f0 0%,#e8f0e5 50%,#dfe8db 100%)'
  },
  {
    id: 5,
    name: 'Серо-голубой',
    emoji: '💎',
    gradient:
      'linear-gradient(180deg,' +
      '#f5f7fa 0%,#eaeef3 50%,#dee5ec 100%)'
  },
  {
    id: 6,
    name: 'Акварель',
    emoji: '🎨',
    gradient:
      'linear-gradient(180deg,' +
      '#fdf5f0 0%,#f9e8de 50%,#f4dcd0 100%)'
  },
  {
    id: 7,
    name: 'Мрамор',
    emoji: '🏛',
    gradient:
      'linear-gradient(180deg,' +
      '#fbfaf8 0%,#f2eeea 50%,#e8e3dc 100%)'
  },
  {
    id: 8,
    name: 'Новогодний',
    emoji: '❄️',
    gradient:
      'linear-gradient(180deg,' +
      '#f5f7fa 0%,#e8edf3 50%,#dce3ea 100%)'
  },
  {
    id: 9,
    name: 'Весенний',
    emoji: '🌷',
    gradient:
      'linear-gradient(180deg,' +
      '#fff5f7 0%,#fce4ea 50%,#f8d5de 100%)'
  },
  {
    id: 10,
    name: 'Осенний',
    emoji: '🍂',
    gradient:
      'linear-gradient(180deg,' +
      '#fdf4ea 0%,#f8e4cf 50%,#f2d4b6 100%)'
  }
];

// ========== ПАСТЕЛЬНЫЕ ЗАГЛУШКИ (ПРАВКА 69) ==========
const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg,#fbe8ef 0%,#f7dae5 100%)',
  'linear-gradient(135deg,#e8f0e5 0%,#dfe8db 100%)',
  'linear-gradient(135deg,#eaeef3 0%,#dee5ec 100%)',
  'linear-gradient(135deg,#f9e8de 0%,#f4dcd0 100%)',
  'linear-gradient(135deg,#f2eeea 0%,#e8e3dc 100%)'
];

function getPlaceholderGradient(seed) {
  const n = parseInt(seed, 10) || 0;
  const idx = n % PLACEHOLDER_GRADIENTS.length;
  return PLACEHOLDER_GRADIENTS[idx];
}

// ========== ЦВЕТА КНОПКИ ==========
const BUTTON_COLORS = [
  {
    id: 'red',
    name: 'Красный',
    emoji: '🔴',
    color: '#e74c3c',
    dark: '#c0392b'
  },
  {
    id: 'pink',
    name: 'Розовый',
    emoji: '🌸',
    color: '#e91e63',
    dark: '#ad1457'
  },
  {
    id: 'green',
    name: 'Зелёный',
    emoji: '💚',
    color: '#27ae60',
    dark: '#1e8449'
  },
  {
    id: 'graphite',
    name: 'Графит',
    emoji: '🖤',
    color: '#2c3e50',
    dark: '#1a252f'
  },
  {
    id: 'blue',
    name: 'Синий',
    emoji: '🔵',
    color: '#3498db',
    dark: '#21618c'
  },
  {
    id: 'lavender',
    name: 'Лаванда',
    emoji: '🟣',
    color: '#9b59b6',
    dark: '#71368a'
  }
];

function findColorById(id) {
  if (!id) return null;
  return BUTTON_COLORS.find(c => c.id === id) || null;
}

function getButtonColors(shop) {
  if (!shop || !shop.settings) {
    return { color: '#e74c3c', dark: '#c0392b' };
  }
  const id = shop.settings.buttonColor;
  if (!id) return { color: '#e74c3c', dark: '#c0392b' };
  const found = findColorById(id);
  if (!found) return { color: '#e74c3c', dark: '#c0392b' };
  return { color: found.color, dark: found.dark };
}

function findPresetById(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  return PRESET_BACKGROUNDS.find(b => b.id === n) || null;
}

function getBackgroundStyle(bgSetting) {
  if (!bgSetting) {
    return 'background:linear-gradient(180deg,' +
      '#fdf9f3 0%,#fafaf8 40%,#f7f5f1 100%);' +
      'background-attachment:fixed;';
  }
  if (typeof bgSetting === 'object' &&
      bgSetting.type === 'preset') {
    const preset = findPresetById(bgSetting.id);
    if (preset) {
      return 'background:' + preset.gradient + ';' +
        'background-attachment:fixed;';
    }
    return 'background:linear-gradient(180deg,' +
      '#fdf9f3 0%,#fafaf8 40%,#f7f5f1 100%);' +
      'background-attachment:fixed;';
  }
  const refs = getPhotoRefs(bgSetting);
  if (refs && refs.primary) {
    return "background-image:url('" + refs.primary + "');" +
      'background-size:cover;' +
      'background-attachment:fixed;';
  }
  return 'background:linear-gradient(180deg,' +
    '#fdf9f3 0%,#fafaf8 40%,#f7f5f1 100%);' +
    'background-attachment:fixed;';
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
  if (typeof bg === 'object' &&
      (bg.s3 || bg.tg)) return true;
  return false;
}

function hasAnyLogo(shop) {
  if (!shop || !shop.settings) return false;
  return !!shop.settings.logo;
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
  if (!caption) {
    return { ok: false, reason: 'empty' };
  }
  const words = caption
    .split(/\s+/)
    .filter(w => w.length > 0);
  if (words.length < 2) {
    return { ok: false, reason: 'too_short' };
  }
  const lastWord = words[words.length - 1];
  const price = cleanPriceWord(lastWord);
  if (price === null) {
    const digitsOnly = lastWord.replace(/[^\d]/g, '');
    if (digitsOnly.length > 0) {
      return {
        ok: false,
        reason: 'price_with_extra',
        lastWord
      };
    }
    return {
      ok: false,
      reason: 'price_not_number',
      lastWord
    };
  }
  const name = words.slice(0, -1).join(' ').trim();
  if (name.length < 2) {
    return { ok: false, reason: 'name_too_short' };
  }
  return { ok: true, name, price };
}

function buildParseErrorText(parseResult, rawCaption) {
  const reason = parseResult && parseResult.reason
    ? parseResult.reason
    : 'unknown';

  if (reason === 'price_with_extra') {
    const lw = parseResult.lastWord || '';
    let t = '❌ <b>Не могу разобрать цену.</b>\n\n';
    t += 'Последнее слово: <code>' + esc(lw) + '</code>\n\n';
    t += 'Цена должна быть <b>только цифрами</b>.\n\n';
    t += '✅ <b>Правильно:</b>\n';
    t += '  <code>31 роза 3500</code>\n';
    t += '  <code>51 хризантема 10000</code>\n\n';
    t += '❌ <b>Неправильно:</b>\n';
    t += '  <code>31 роза 3500₽</code>\n';
    t += '  <code>31 роза 3500р</code>\n';
    t += '  <code>31 роза 3500 руб</code>\n';
    t += '  <code>31 роза 3500.50</code>\n\n';
    t += '💡 Просто уберите символы —\n';
    t += 'оставьте только цифры.';
    return t;
  }

  if (reason === 'price_not_number') {
    let t = '❌ <b>Не могу найти цену.</b>\n\n';
    t += 'Последнее слово должно быть <b>ценой</b> —\n';
    t += 'одним числом.\n\n';
    t += '✅ <b>Правильно:</b>\n';
    t += '  <code>31 роза 3500</code>\n';
    t += '  <code>Пионы 4500</code>\n';
    t += '  <code>Микс 2800</code>\n\n';
    t += '❌ <b>Неправильно:</b>\n';
    t += '  <code>31 роза 3500 сорт Аваланж</code>\n';
    t += '     (цена не последняя)\n';
    t += '  <code>31 роза — цена 3500</code>\n';
    t += '     (после цены ещё слова)\n\n';
    t += '💡 Формат: <b>название + цена последним словом</b>';
    return t;
  }

  if (reason === 'too_short' || reason === 'empty') {
    let t = '❌ <b>Слишком короткая подпись.</b>\n\n';
    t += 'В подписи должно быть <b>название и цена</b>.\n\n';
    t += '✅ <b>Пример:</b>\n';
    t += '  <code>31 роза 3500</code>\n';
    t += '  <code>Пионы 4500</code>\n\n';
    t += '💡 Или нажмите /cancel, чтобы отменить.';
    return t;
  }

  if (reason === 'name_too_short') {
    let t = '❌ <b>Название слишком короткое.</b>\n\n';
    t += 'Перед ценой напишите название букета —\n';
    t += 'минимум 2 символа.\n\n';
    t += '✅ <b>Пример:</b>\n';
    t += '  <code>31 роза 3500</code>\n';
    t += '  <code>Пионы 4500</code>';
    return t;
  }

  let t = '❌ <b>Не могу разобрать подпись.</b>\n\n';
  t += 'Правильно: <b>31 роза 3500</b>\n';
  t += '(название, потом цена — последним словом)\n\n';
  t += 'Попробуйте ещё раз или нажмите /cancel';
  return t;
}// ========== СПРАВКА / HELP ==========
function buildHelpMenu() {
  let t = '📖 <b>Помощь</b>\n\n';
  t += 'Что вы хотите узнать?\n\n';
  t += '🎓 <b>Как пользоваться</b> — пошаговый гайд\n';
  t += '❓ <b>Частые вопросы</b> — короткие ответы\n';
  t += '💬 <b>Написать в поддержку</b> — если что-то сломалось';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🎓 Как пользоваться ботом',
            callback_data: 'help_guide'
          }],
          [{
            text: '❓ Частые вопросы',
            callback_data: 'help_faq'
          }],
          [{
            text: '💬 Написать в поддержку',
            callback_data: 'help_support'
          }],
          [{
            text: '❌ Закрыть',
            callback_data: 'help_close'
          }]
        ]
      }
    }
  };
}

function buildHelpGuide() {
  let t = '🎓 <b>Как пользоваться Flowind</b>\n\n';
  t += '1️⃣ <b>Добавить букет</b>\n';
  t += 'Нажмите «📷 Добавить букет» и отправьте ' +
       'фото с подписью.\n';
  t += 'В подписи: название + цена последним словом.\n';
  t += '<code>31 роза 3500</code>\n\n';
  t += '2️⃣ <b>Проверить наличие</b>\n';
  t += 'Раз в 3 дня бот напомнит. Открывайте ' +
       '«✅ Что в наличии?» и отмечайте — есть или нет.\n\n';
  t += '3️⃣ <b>Найти букет</b>\n';
  t += '«✏️ Мои букеты» → «🔍 Найти букет».\n';
  t += 'Ищет по слову из названия или по номеру.\n\n';
  t += '4️⃣ <b>Изменить букет</b>\n';
  t += 'Из карточки букета: цена, переименовать, ' +
       'убрать с витрины, удалить.\n\n';
  t += '5️⃣ <b>Ссылка для клиентов</b>\n';
  t += '«🔗 Витрина» — она показывается на кнопке. ' +
       'Отправляйте клиентам, открывается в любом ' +
       'браузере.\n\n';
  t += '6️⃣ <b>Пригласить флориста</b>\n';
  t += '«⚙️ Настройки → 🔑 Пригласить флориста».\n';
  t += 'Он кликнет по ссылке и сразу попадёт в команду.\n\n';
  t += '<i>Если что-то непонятно — /help снова.</i>';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '⬅️ К помощи',
          callback_data: 'help_back'
        }]]
      }
    }
  };
}

function buildHelpFAQ() {
  let t = '❓ <b>Частые вопросы</b>\n\n';
  t += 'Выберите вопрос:';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🤔 Почему бот не принимает цену?',
            callback_data: 'faq_price'
          }],
          [{
            text: '⏰ Что будет, если не подтверждать?',
            callback_data: 'faq_expire'
          }],
          [{
            text: '📥 Как убрать букет с витрины?',
            callback_data: 'faq_hide'
          }],
          [{
            text: '🖼 Как поменять фон витрины?',
            callback_data: 'faq_bg'
          }],
          [{
            text: '👥 Как добавить флориста?',
            callback_data: 'faq_team'
          }],
          [{
            text: '🔗 Где ссылка для клиентов?',
            callback_data: 'faq_link'
          }],
          [{
            text: '🔔 Почему не приходят уведомления?',
            callback_data: 'faq_notify'
          }],
          [{
            text: '💱 Как поменять валюту?',
            callback_data: 'faq_currency'
          }],
          [{
            text: '⬅️ К помощи',
            callback_data: 'help_back'
          }]
        ]
      }
    }
  };
}

function buildFaqAnswer(key) {
  const answers = {
    faq_price: {
      title: '🤔 Почему бот не принимает цену?',
      body:
        'Цена должна быть <b>последним словом</b> ' +
        'в подписи и только <b>цифрами</b>.\n\n' +
        '✅ <b>Правильно:</b>\n' +
        '<code>31 роза 3500</code>\n' +
        '<code>51 хризантема 10000</code>\n\n' +
        '❌ <b>Неправильно:</b>\n' +
        '<code>31 роза 3500 сорт Аваланж</code>\n' +
        '   (после цены ещё слова)\n' +
        '<code>3500 31 роза</code>\n' +
        '   (цена в начале)\n\n' +
        '💡 Если запутались — /cancel и заново.'
    },
    faq_expire: {
      title: '⏰ Что будет, если не подтверждать?',
      body:
        'Через 3 дня после добавления букет ' +
        '<b>уйдёт в архив</b> — исчезнет с витрины.\n\n' +
        'Перед этим за 12 часов бот напомнит.\n\n' +
        'Вернуть из архива можно в любой момент:\n' +
        '«✏️ Мои букеты → 📦 Архив» → «✅ Вернуть».'
    },
    faq_hide: {
      title: '📥 Как убрать букет с витрины?',
      body:
        'Откройте карточку букета и нажмите ' +
        '«📥 Убрать с витрины».\n\n' +
        'Клиенты его больше не увидят, а вернуть ' +
        'можно из архива.\n\n' +
        'Не путайте с «🗑 Удалить» — там букет ' +
        'исчезает совсем.'
    },
    faq_bg: {
      title: '🖼 Как поменять фон витрины?',
      body:
        '«⚙️ Настройки → 🖼 Фон».\n\n' +
        'Можно выбрать один из 10 готовых фонов ' +
        'или загрузить свою картинку.\n\n' +
        'Готовые фоны — CSS-градиенты: ' +
        'безопасные, не мешают карточкам ' +
        'и грузятся мгновенно.'
    },
    faq_team: {
      title: '👥 Как добавить флориста?',
      body:
        '«⚙️ Настройки → 🔑 Пригласить флориста».\n\n' +
        'Бот выдаст ссылку. Отправьте её флористу — ' +
        'он кликнет, и сразу попадёт в вашу команду.\n\n' +
        'Управлять составом: ' +
        '«⚙️ Настройки → 👥 Команда».'
    },
    faq_link: {
      title: '🔗 Где ссылка для клиентов?',
      body:
        'Кнопка «🔗 Витрина» в главном меню.\n\n' +
        'Ссылка кликабельная — можно переслать ' +
        'клиенту. Он откроет в любом браузере ' +
        'без VPN.'
    },
    faq_notify: {
      title: '🔔 Почему не приходят уведомления?',
      body:
        'Уведомления приходят только тем, кто ' +
        '«на смене».\n\n' +
        'Нажмите в главном меню ' +
        '«✅ Я сегодня работаю» — и всё заработает.\n\n' +
        'Статус сбрасывается через 14 часов, ' +
        'поэтому каждое утро его нужно включать.'
    },
    faq_currency: {
      title: '💱 Как поменять валюту?',
      body:
        '«⚙️ Настройки → 🏪 Данные магазина → ' +
        '💱 Валюта».\n\n' +
        'Доступные валюты:\n' +
        '₽ рубль · ₸ тенге · Br рубль · сўм сум\n\n' +
        'Цены <b>не пересчитываются</b> — просто ' +
        'меняется символ. Если хотите новые цены — ' +
        'поменяйте их вручную.'
    }
  };
  const a = answers[key];
  if (!a) return null;
  return {
    text: '<b>' + a.title + '</b>\n\n' + a.body,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '❓ К вопросам',
            callback_data: 'help_faq'
          }],
          [{
            text: '💬 Поддержка',
            callback_data: 'help_support'
          }]
        ]
      }
    }
  };
}

function buildHelpSupport() {
  let t = '💬 <b>Поддержка Flowind</b>\n\n';
  t += 'Если что-то не работает или непонятно — ' +
       'напишите напрямую:\n\n';
  t += '👤 @floop10\n\n';
  t += '<i>Постараемся ответить в течение дня.</i>';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '⬅️ К помощи',
          callback_data: 'help_back'
        }]]
      }
    }
  };
}

// ========== ПРОВЕРКА НАЛИЧИЯ ==========
const CHECK_PER_PAGE = 25;
const CHECK_SESSION_TTL = 60 * 60 * 1000;
const LIST_PER_PAGE = 25;
const ADMIN_SHOP_PER_PAGE = 25;
const SEARCH_PER_PAGE = 25;

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

async function getCheckableBouquets(shopId) {
  const all = await getBouquetsFromDb(shopId);
  return all.filter(b => {
    const s = getBouquetStatus(b);
    return s === 'fresh' || s === 'stale' || s === 'pinned';
  });
}

async function buildCheckStartScreen(shopId) {
  const bouquets = await getCheckableBouquets(shopId);
  const count = bouquets.length;
  if (count === 0) {
    return {
      text: '🌿 На витрине нет букетов — проверять нечего.',
      options: { parse_mode: 'HTML' }
    };
  }
  const pages = Math.ceil(count / CHECK_PER_PAGE);
  const cntWord = plural(count, 'букет', 'букета', 'букетов');
  const pgWord = plural(pages, 'страницу', 'страницы', 'страниц');
  let txt = `✅ <b>Проверка наличия</b>\n\n`;
  txt += `В списке <b>${count}</b> ${cntWord}.\n`;
  txt += `Мы разбили их на <b>${pages}</b> ${pgWord} `;
  txt += `по ${CHECK_PER_PAGE}.\n\n`;
  txt += `<i>💾 Если отвлечётесь — не страшно. `;
  txt += `Проверка сохранится, и вы сможете продолжить `;
  txt += `с того же места в течение часа.</i>`;
  return {
    text: txt,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🚀 Начать проверку',
            callback_data: 'check_start'
          }],
          [{
            text: '❌ Отмена',
            callback_data: 'check_cancel'
          }]
        ]
      }
    }
  };
}

function buildCheckListText(session) {
  const total = session.bouquets.length;
  const done = Object.keys(session.checked).length;
  const totalPages = Math.max(
    1, Math.ceil(total / CHECK_PER_PAGE)
  );
  const page = (session.currentPage || 0) + 1;
  let txt = `✅ <b>Проверка наличия</b>\n`;
  txt += `Страница <b>${page}</b> из <b>${totalPages}</b> · `;
  txt += `Проверено <b>${done}</b> из <b>${total}</b>\n\n`;
  txt += `<i>Работайте снизу списка, так удобнее.</i>`;
  return txt;
}

function buildCheckListKeyboard(session) {
  const rows = [];
  const total = session.bouquets.length;
  const totalPages = Math.max(
    1, Math.ceil(total / CHECK_PER_PAGE)
  );
  const page = Math.max(
    0,
    Math.min(session.currentPage || 0, totalPages - 1)
  );
  const start = page * CHECK_PER_PAGE;
  const end = Math.min(start + CHECK_PER_PAGE, total);
  const slice = session.bouquets.slice(start, end);

  const checked = slice.filter(b => session.checked[b.id]);
  const unchecked = slice.filter(b => !session.checked[b.id]);

  for (const b of checked) {
    const st = session.checked[b.id];
    const prefix = st === 'yes' ? '✓ ' : '🚫 ';
    const label =
      `${prefix}№${b.shopNumber} ${shortName(b.name, 16)}`;
    rows.push([{
      text: label,
      callback_data: `check_show_${b.id}`
    }]);
  }

  for (const b of unchecked) {
    const label = `№${b.shopNumber} ${shortName(b.name, 16)}`;
    rows.push([{
      text: label,
      callback_data: `check_show_${b.id}`
    }]);
  }

  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) {
      navRow.push({
        text: '⬅️ Назад',
        callback_data: `check_page_${page - 1}`
      });
    }
    navRow.push({
      text: `${page + 1} / ${totalPages}`,
      callback_data: 'noop'
    });
    if (page < totalPages - 1) {
      navRow.push({
        text: 'Дальше ➡️',
        callback_data: `check_page_${page + 1}`
      });
    }
    rows.push(navRow);
  }

  rows.push([{
    text: '⏹ Завершить проверку',
    callback_data: 'check_finish'
  }]);
  return rows;
}// ========== АРХИВ ==========
async function getArchivedBouquets(shopId) {
  const all = await getBouquetsFromDb(shopId);
  const arch = all.filter(b => {
    const s = getBouquetStatus(b);
    return s === 'hidden' || s === 'expired';
  });
  arch.sort((a, b) => {
    const da = new Date(a.confirmedAt || a.createdAt);
    const db = new Date(b.confirmedAt || b.createdAt);
    return db - da;
  });
  return arch;
}

async function buildArchiveModeSelection(chatId, shopId) {
  const arch = await getArchivedBouquets(shopId);
  if (arch.length === 0) {
    return sendNav(
      chatId,
      '📦 Архив пуст — все букеты на витрине.'
    );
  }
  const total = arch.length;
  const word = plural(total, 'букет', 'букета', 'букетов');
  let txt = `📦 <b>Архив</b> · ${total} ${word}\n\n`;
  txt += `<i>Как удобнее смотреть?</i>`;
  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{
          text: '📋 Списком',
          callback_data: 'arch_mode_list'
        }],
        [{
          text: '🖼 По одному (с фото)',
          callback_data: 'arch_mode_card'
        }],
        [{
          text: '❌ Отмена',
          callback_data: 'arch_close'
        }]
      ]
    }
  });
}

async function showArchiveList(chatId, session, editMessageId) {
  const shop = await getShopFromDb(session.shopId);
  const total = session.bouquets.length;
  const totalPages = Math.max(
    1, Math.ceil(total / LIST_PER_PAGE)
  );
  const page = Math.max(
    0,
    Math.min(session.page || 0, totalPages - 1)
  );
  session.page = page;
  const start = page * LIST_PER_PAGE;
  const end = Math.min(start + LIST_PER_PAGE, total);
  const slice = session.bouquets.slice(start, end);

  const word = plural(total, 'букет', 'букета', 'букетов');
  let txt = `📦 <b>Архив</b> · ${total} ${word}\n`;
  if (totalPages > 1) {
    txt += `Страница <b>${page + 1}</b> `;
    txt += `из <b>${totalPages}</b>\n`;
  }
  txt += `\n<i>Тапните на букет — откроется карточка.</i>`;

  const rows = [];
  for (const b of slice) {
    const s = getBouquetStatus(b);
    const emoji = s === 'hidden' ? '📥' : '❌';
    const nm = shortName(b.name, 22);
    const priceStr = shop
      ? formatPrice(b.price, shop)
      : formatNumber(b.price) + ' ₽';
    rows.push([{
      text: `${emoji} №${b.shopNumber} ${nm} — ${priceStr}`,
      callback_data: `arch_item_${b.id}`
    }]);
  }

  if (totalPages > 1) {
    const nav = [];
    if (page > 0) {
      nav.push({
        text: '⬅️ Назад',
        callback_data: `arch_list_page_${page - 1}`
      });
    }
    nav.push({
      text: `${page + 1} / ${totalPages}`,
      callback_data: 'noop'
    });
    if (page < totalPages - 1) {
      nav.push({
        text: 'Дальше ➡️',
        callback_data: `arch_list_page_${page + 1}`
      });
    }
    rows.push(nav);
  }
  rows.push([{
    text: '⏹ Закрыть архив',
    callback_data: 'arch_close'
  }]);

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  };
  if (editMessageId) {
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: editMessageId,
        ...opts
      });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return sendNav(chatId, txt, opts);
}

async function showArchiveItemCard(chatId, session, itemId) {
  const b = session.bouquets.find(x => x.id === itemId);
  if (!b) {
    return sendNav(chatId, '⚠️ Букет не найден в архиве.');
  }
  const shop = await getShopFromDb(session.shopId);
  const s = getBouquetStatus(b);
  const statusEmoji = s === 'hidden' ? '📥' : '❌';
  let dateStr = '';
  if (b.confirmedAt) {
    const d = new Date(b.confirmedAt);
    dateStr = d.toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit'
    });
  }
  const reason = s === 'hidden'
    ? 'убран вручную'
    : 'срок истёк';
  const priceStr = shop
    ? formatPrice(b.price, shop)
    : formatNumber(b.price) + ' ₽';
  let caption = `📦 <b>№${b.shopNumber}</b>\n`;
  caption += `${esc(b.name)} — <b>${priceStr}</b>\n`;
  caption += `<i>${statusEmoji} `;
  if (dateStr) caption += `${dateStr} · `;
  caption += `${reason}</i>`;

  const buttons = [
    [
      {
        text: '✅ Вернуть на витрину',
        callback_data: `arch_restore_${b.id}`
      },
      {
        text: '📋 К списку',
        callback_data: 'arch_list_back'
      }
    ],
    [
      {
        text: '📸 Скачать фото',
        callback_data: `dlphoto_${b.id}`
      },
      {
        text: '🗑 Удалить',
        callback_data: `arch_del_${b.id}`
      }
    ]
  ];
  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  };
  const firstPhoto = (b.photos && b.photos.length > 0)
    ? b.photos[0] : null;
  const tgRef = getTelegramPhotoRef(firstPhoto);
  if (tgRef) {
    try {
      await bot.sendPhoto(chatId, tgRef, { caption, ...opts });
      return;
    } catch (e) { /* фолбэк */ }
  }
  try {
    await sendNav(chatId, caption, opts);
  } catch (e) { /* ignore */ }
}async function showArchiveCard(chatId, session) {
  if (session.currentIndex >= session.bouquets.length) {
    const shopId = session.shopId;
    delete archiveSessions[chatId];
    const shop = shopId ? await getShopFromDb(shopId) : null;
    const opts = shop
      ? { reply_markup: getMainKeyboard(shop, chatId) }
      : {};
    try {
      await bot.sendMessage(chatId, '📦 Архив просмотрен.', opts);
    } catch (e) { /* ignore */ }
    return;
  }

  if (session.currentIndex === 0 && !session.keyboardHidden) {
    session.keyboardHidden = true;
    try {
      await bot.sendMessage(
        chatId,
        '📦 <i>Открываю архив — меню вернётся ' +
        'после закрытия.</i>',
        {
          parse_mode: 'HTML',
          reply_markup: { remove_keyboard: true }
        }
      );
    } catch (e) { /* ignore */ }
  }

  const b = session.bouquets[session.currentIndex];
  const shop = await getShopFromDb(session.shopId);
  const s = getBouquetStatus(b);
  const statusEmoji = s === 'hidden' ? '📥' : '❌';
  let dateStr = '';
  if (b.confirmedAt) {
    const d = new Date(b.confirmedAt);
    dateStr = d.toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit'
    });
  }
  const reason = s === 'hidden'
    ? 'убран вручную'
    : 'срок истёк';
  const idx = session.currentIndex + 1;
  const tot = session.bouquets.length;
  const priceStr = shop
    ? formatPrice(b.price, shop)
    : formatNumber(b.price) + ' ₽';
  let caption = `📦 <b>${idx}/${tot}</b> · `;
  caption += `<b>№${b.shopNumber}</b>\n`;
  caption += `${esc(b.name)} — <b>${priceStr}</b>\n`;
  caption += `<i>${statusEmoji} `;
  if (dateStr) caption += `${dateStr} · `;
  caption += `${reason}</i>`;

  const buttons = [
    [
      {
        text: '✅ Вернуть',
        callback_data: `arch_restore_${b.id}`
      },
      {
        text: '⏭ Дальше',
        callback_data: 'arch_next'
      },
      {
        text: '⏹ Закрыть',
        callback_data: 'arch_close'
      }
    ],
    [
      {
        text: '📸 Скачать фото',
        callback_data: `dlphoto_${b.id}`
      },
      {
        text: '🗑 Удалить',
        callback_data: `arch_del_${b.id}`
      }
    ]
  ];
  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  };

  const firstPhoto = (b.photos && b.photos.length > 0)
    ? b.photos[0] : null;
  const tgRef = getTelegramPhotoRef(firstPhoto);
  if (tgRef) {
    try {
      await bot.sendPhoto(chatId, tgRef, { caption, ...opts });
      return;
    } catch (e) { /* фолбэк */ }
  }
  try {
    await bot.sendMessage(chatId, caption, opts);
  } catch (e) { /* ignore */ }
}

// ========== СКАЧАТЬ ФОТО ==========
async function sendBouquetPhotoAsFile(chatId, b) {
  if (!b.photos || b.photos.length === 0) {
    return sendNav(chatId, '❌ У букета нет фото.');
  }
  const firstPhoto = b.photos[0];
  const num = b.shopNumber || b.id;
  const rawName = String(b.name || 'buket');
  const safeName = rawName
    .replace(/[^\wа-яА-ЯёЁ\- ]/g, '')
    .trim()
    .slice(0, 40) || 'buket';
  const fileName = `buket_${num}_${safeName}.jpg`;
  const caption = `📸 Оригинал — №${num} «${b.name}»`;

  try {
    let docRef = null;

    if (typeof firstPhoto === 'object' && firstPhoto.s3) {
      const key = s3UrlToKey(firstPhoto.s3);
      if (key) {
        docRef = SITE_URL + '/photo/s3/' + key;
      } else if (isValidS3Url(firstPhoto.s3)) {
        docRef = firstPhoto.s3;
      }
    }
    if (!docRef &&
        typeof firstPhoto === 'object' &&
        firstPhoto.tg &&
        isValidFileId(firstPhoto.tg)) {
      docRef = firstPhoto.tg;
    }
    if (!docRef &&
        typeof firstPhoto === 'string' &&
        isValidFileId(firstPhoto)) {
      docRef = firstPhoto;
    }
    if (!docRef &&
        typeof firstPhoto === 'string' &&
        firstPhoto.startsWith('http')) {
      docRef = firstPhoto;
    }

    if (!docRef) {
      return sendNav(chatId, '❌ Фото недоступно.');
    }

    await bot.sendDocument(chatId, docRef, { caption }, {
      filename: fileName,
      contentType: 'image/jpeg'
    });
  } catch (e) {
    console.error('Ошибка отправки фото файлом:', e?.message || e);
    return sendNav(chatId, '❌ Не удалось отправить фото.');
  }
}

// ========== КНОПКИ КАРТОЧКИ БУКЕТА ==========
function buildBouquetActionButtons(b, okText, okAction, noAction) {
  const rows = [];
  rows.push([
    { text: okText, callback_data: okAction },
    { text: '↩️ Нет, к списку', callback_data: noAction }
  ]);
  if (b.hidden) {
    rows.push([{
      text: '✅ Вернуть на витрину',
      callback_data: `unhide_${b.id}`
    }]);
  } else {
    rows.push([{
      text: '📥 Убрать с витрины',
      callback_data: `hideit_${b.id}`
    }]);
  }
  rows.push([{
    text: '📸 Скачать фото',
    callback_data: `dlphoto_${b.id}`
  }]);
  return rows;
}

// ========== МОИ БУКЕТЫ ==========
async function buildMyBouquetsMenu(chatId, shopId) {
  const all = await getBouquetsFromDb(shopId);
  const active = all.filter(isConfirmedRecently);
  const arch = await getArchivedBouquets(shopId);
  const cntWord = plural(
    active.length, 'активный', 'активных', 'активных'
  );
  const archWord = plural(
    arch.length, 'букет', 'букета', 'букетов'
  );
  let txt = `✏️ <b>Мои букеты</b>\n\n`;
  txt += `🟢 На витрине: <b>${active.length}</b> ${cntWord}\n`;
  txt += `📦 В архиве: <b>${arch.length}</b> ${archWord}\n\n`;
  txt += `<i>Что делаем?</i>`;
  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{
          text: '🔍 Найти букет',
          callback_data: 'mb_search'
        }],
        [{
          text: '📋 Все активные',
          callback_data: 'mb_active_0'
        }],
        [{
          text: '📦 Архив',
          callback_data: 'mb_archive'
        }],
        [{
          text: '⬅️ Назад',
          callback_data: 'mb_close'
        }]
      ]
    }
  });
}

async function buildSearchPrompt(chatId) {
  let txt = `🔍 <b>Что ищем?</b>\n\n`;
  txt += `Напишите любое слово из названия `;
  txt += `или номер букета.\n\n`;
  txt += `Например:\n`;
  txt += `• <code>роза</code>\n`;
  txt += `• <code>Pink Avalanche</code>\n`;
  txt += `• <code>гортензия</code>\n`;
  txt += `• <code>58</code>\n\n`;
  txt += `<i>Ищем и на витрине, и в архиве.</i>`;
  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: '❌ Отмена',
        callback_data: 'mb_close'
      }]]
    }
  });
}

async function searchBouquets(shopId, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { all: [], results: [] };

  const all = await getBouquetsFromDb(shopId, true);

  if (/^\d+$/.test(q)) {
    const num = parseInt(q, 10);
    const results = all.filter(b => b.shopNumber === num);
    return { all, results };
  }

  const results = all.filter(b => {
    const nm = String(b.name || '').toLowerCase();
    if (nm.includes(q)) return true;
    const tags = b.tags || [];
    for (const t of tags) {
      if (String(t).toLowerCase().includes(q)) return true;
    }
    return false;
  });

  results.sort((a, b) => {
    const aActive = isConfirmedRecently(a) ? 0 : 1;
    const bActive = isConfirmedRecently(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (a.shopNumber || 0) - (b.shopNumber || 0);
  });

  return { all, results };
}function statusMark(b) {
  if (isConfirmedRecently(b)) return '✅';
  if (b.hidden) return '📥';
  return '❌';
}

async function renderSearchResults(chatId, shopId, query, results) {
  const shop = await getShopFromDb(shopId);
  const qEsc = esc(query);
  if (results.length === 0) {
    return sendNav(chatId,
      `🔍 «${qEsc}»\n\n` +
      `Ничего не найдено.\n\n` +
      `Попробуйте другое слово или номер.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🔍 Искать снова',
              callback_data: 'mb_search'
            }],
            [{
              text: '⬅️ К моим букетам',
              callback_data: 'mb_back'
            }]
          ]
        }
      }
    );
  }

  const total = results.length;
  const activeCount = results.filter(
    b => isConfirmedRecently(b)
  ).length;
  const hiddenCount = results.filter(
    b => b.hidden
  ).length;
  const expiredCount = total - activeCount - hiddenCount;

  const word = plural(total, 'букет', 'букета', 'букетов');
  let txt = `🔍 <b>«${qEsc}»</b>\n\n`;
  txt += `Найдено: <b>${total}</b> ${word}\n`;

  if (activeCount === total) {
    txt += `✅ Все на витрине\n\n`;
  } else {
    if (activeCount > 0) {
      txt += `✅ На витрине: <b>${activeCount}</b>\n`;
    }
    if (hiddenCount > 0) {
      txt += `📥 В архиве: <b>${hiddenCount}</b>\n`;
    }
    if (expiredCount > 0) {
      txt += `❌ Устарели: <b>${expiredCount}</b>\n`;
    }
    txt += `\n`;
  }

  const maxShow = Math.min(total, SEARCH_PER_PAGE);
  for (let i = 0; i < maxShow; i++) {
    const b = results[i];
    const mark = statusMark(b);
    const priceStr = shop
      ? formatPrice(b.price, shop)
      : formatNumber(b.price) + ' ₽';
    txt += `${mark} <b>№${b.shopNumber}</b> `;
    txt += `${esc(shortName(b.name, 28))} — `;
    txt += `<b>${priceStr}</b>\n`;
  }
  if (total > SEARCH_PER_PAGE) {
    txt += `\n<i>Показаны первые ${SEARCH_PER_PAGE} `;
    txt += `из ${total}.</i>\n`;
  }

  const hasNonActive = (total - activeCount) > 0;
  if (hasNonActive) {
    txt += `\n<i>✅ на витрине · 📥 в архиве · ❌ устарел</i>`;
  }

  const rows = [];
  for (let i = 0; i < maxShow; i += 4) {
    const chunk = results.slice(i, i + 4);
    rows.push(chunk.map(b => ({
      text: `№${b.shopNumber}`,
      callback_data: `sres_${b.id}`
    })));
  }

  if (hiddenCount > 0) {
    rows.push([{
      text: `✅ Вернуть все из архива (${hiddenCount})`,
      callback_data: 'sres_restore_all'
    }]);
  }

  rows.push([
    {
      text: '🔍 Искать снова',
      callback_data: 'mb_search'
    },
    {
      text: '⬅️ К моим букетам',
      callback_data: 'mb_back'
    }
  ]);

  searchSessions[chatId] = {
    shopId,
    query,
    results
  };

  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  });
}

async function showActiveBouquetsList(chatId, shopId, page, editMessageId) {
  const currentPage = page || 0;
  const all = await getBouquetsFromDb(shopId);
  const active = all.filter(isConfirmedRecently);
  if (active.length === 0) {
    return sendNav(chatId, '🌿 На витрине сейчас пусто.');
  }
  active.sort((a, b) => a.shopNumber - b.shopNumber);

  const totalPages = Math.max(
    1, Math.ceil(active.length / LIST_PER_PAGE)
  );
  const safePage = Math.max(
    0, Math.min(currentPage, totalPages - 1)
  );
  const start = safePage * LIST_PER_PAGE;
  const end = Math.min(start + LIST_PER_PAGE, active.length);
  const slice = active.slice(start, end);

  let txt = `📋 <b>Все активные</b> · ${active.length}\n`;
  if (totalPages > 1) {
    txt += `Страница ${safePage + 1} из ${totalPages}\n`;
  }
  txt += `\n<i>Тапните на номер — откроется карточка.</i>`;

  const rows = [];
  for (let i = 0; i < slice.length; i += 4) {
    const chunk = slice.slice(i, i + 4);
    rows.push(chunk.map(b => ({
      text: `№${b.shopNumber}`,
      callback_data: `sres_${b.id}`
    })));
  }

  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) {
      nav.push({
        text: '⬅️ Назад',
        callback_data: `mb_active_${safePage - 1}`
      });
    }
    nav.push({
      text: `${safePage + 1} / ${totalPages}`,
      callback_data: 'noop'
    });
    if (safePage < totalPages - 1) {
      nav.push({
        text: 'Дальше ➡️',
        callback_data: `mb_active_${safePage + 1}`
      });
    }
    rows.push(nav);
  }

  rows.push([{
    text: '⬅️ К моим букетам',
    callback_data: 'mb_back'
  }]);

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: editMessageId,
        ...opts
      });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return sendNav(chatId, txt, opts);
}

async function showBouquetList(chatId, shopId, action, headerText, page) {
  const shop = await getShopFromDb(shopId);
  const currentPage = page || 0;
  const active = await getBouquetsFromDb(shopId);
  if (active.length === 0) {
    return sendNav(chatId, '🌿 Нет букетов.');
  }
  active.sort((a, b) => a.shopNumber - b.shopNumber);

  const totalPages = Math.max(
    1, Math.ceil(active.length / LIST_PER_PAGE)
  );
  const safePage = Math.max(
    0, Math.min(currentPage, totalPages - 1)
  );
  const start = safePage * LIST_PER_PAGE;
  const shown = active.slice(start, start + LIST_PER_PAGE);

  let listTxt = `${headerText}\n\n`;
  for (const b of shown) {
    const priceStr = shop
      ? formatPrice(b.price, shop)
      : formatNumber(b.price) + ' ₽';
    listTxt += `<b>№${b.shopNumber}</b> — `;
    listTxt += `${esc(b.name)} — <b>${priceStr}</b>\n\n`;
  }
  if (totalPages > 1) {
    listTxt += `<i>Страница ${safePage + 1} `;
    listTxt += `из ${totalPages}</i>`;
  }

  const kb = [];
  for (let i = 0; i < shown.length; i += 4) {
    const row = shown.slice(i, i + 4).map(b => ({
      text: `№${b.shopNumber}`,
      callback_data: `${action}_${b.id}`
    }));
    kb.push(row);
  }

  if (totalPages > 1) {
    const navRow = [];
    if (safePage > 0) {
      navRow.push({
        text: '⬅️ Назад',
        callback_data: `bqlist_${action}_${safePage - 1}`
      });
    }
    navRow.push({
      text: `${safePage + 1} / ${totalPages}`,
      callback_data: 'noop'
    });
    if (safePage < totalPages - 1) {
      navRow.push({
        text: 'Дальше ➡️',
        callback_data: `bqlist_${action}_${safePage + 1}`
      });
    }
    kb.push(navRow);
  }

  kb.push([{
    text: '⬅️ К моим букетам',
    callback_data: 'mb_back'
  }]);

  return sendNav(chatId, listTxt, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb }
  });
}

async function sendBouquetPreview(chatId, b, headerText, buttons) {
  const shop = await getShopFromDb(b.shopId);
  let caption = `${headerText}\n\n`;
  caption += `<b>№${b.shopNumber}</b> ${esc(b.name)}\n`;
  caption += `💰 ${formatNumber(b.price)} ₽`;
  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  };
  const firstPhoto = (b.photos && b.photos.length > 0)
    ? b.photos[0] : null;
  const tgRef = getTelegramPhotoRef(firstPhoto);
  if (tgRef) {
    try {
      await bot.sendPhoto(chatId, tgRef, {
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: opts.reply_markup
      });
      return;
    } catch (e) { /* фолбэк */ }
  }
  try {
    await bot.sendMessage(chatId, caption, opts);
  } catch (e) { /* ignore */ }
}

function validatePhotoSaved(photoResult) {
  if (!photoResult) return false;
  if (typeof photoResult === 'object') {
    if (isValidS3Url(photoResult.s3)) return true;
    if (photoResult.tg && isValidFileId(photoResult.tg)) {
      return true;
    }
  }
  if (typeof photoResult === 'string') {
    if (isValidS3Url(photoResult)) return true;
    if (isValidFileId(photoResult)) return true;
  }
  return false;
}// ========== ИНИЦИАЛИЗАЦИЯ БД ==========
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      shop_id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      display_name VARCHAR(200),
      address VARCHAR(200),
      hours VARCHAR(100),
      phone VARCHAR(50),
      telegram_username VARCHAR(100),
      invite_code VARCHAR(10),
      trial_start TIMESTAMPTZ,
      trial_end TIMESTAMPTZ,
      settings JSONB DEFAULT '{"logo":null,"background":null,"markupPercent":20,"aiEnabled":false}'::jsonb,
      stats JSONB DEFAULT '{"views":0,"orders":0,"calls":0,"startedAt":null}'::jsonb
    );
  `);
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50)`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS max_username VARCHAR(500)`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS blocked_reason TEXT`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS country VARCHAR(10)`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      shop_id VARCHAR(50) REFERENCES shops(shop_id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      name VARCHAR(100),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(chat_id, shop_id)
    );
  `);
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS on_shift_until TIMESTAMPTZ`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(40)`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS onboarding_passed BOOLEAN ` +
    `DEFAULT FALSE`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bouquets (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) REFERENCES shops(shop_id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      photos JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ DEFAULT NOW(),
      hidden BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      is_pinned BOOLEAN DEFAULT FALSE,
      chat_id BIGINT,
      reminded BOOLEAN DEFAULT FALSE,
      clicks INTEGER DEFAULT 0
    );
  `);
  await pool.query(
    `ALTER TABLE bouquets ` +
    `ADD COLUMN IF NOT EXISTS shop_number INTEGER`
  );
  await pool.query(
    `ALTER TABLE bouquets ` +
    `ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`
  );

  await pool.query(`
    UPDATE bouquets SET shop_number = sub.rn
    FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY shop_id ORDER BY id
        ) AS rn
      FROM bouquets WHERE shop_number IS NULL
    ) sub
    WHERE bouquets.id = sub.id
  `);

  try {
    const existing = await pool.query(
      `SELECT id, name FROM bouquets ` +
      `WHERE tags IS NULL OR tags = '[]'::jsonb`
    );
    for (const row of existing.rows) {
      const tags = extractTagsFromName(row.name);
      if (tags.length > 0) {
        await pool.query(
          `UPDATE bouquets SET tags = $2 WHERE id = $1`,
          [row.id, JSON.stringify(tags)]
        );
      }
    }
    if (existing.rows.length > 0) {
      console.log(
        `🏷 Проставлены теги у ${existing.rows.length} букетов`
      );
    }
  } catch (e) {
    console.error('⚠️ Ошибка миграции тегов:', e?.message || e);
  }

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_bouquets_shop_active ` +
    `ON bouquets(shop_id, deleted, is_pinned, confirmed_at DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_bouquets_shop_number ` +
    `ON bouquets(shop_id, shop_number)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_admins_chat_id ` +
    `ON admins(chat_id)`
  );

  console.log('✅ Таблицы БД готовы');
}

// ========== ФУНКЦИИ БД ==========
async function getShopFromDb(shopId) {
  const res = await pool.query(
    'SELECT * FROM shops WHERE shop_id = $1',
    [shopId]
  );
  if (res.rows.length === 0) return null;
  const s = res.rows[0];
  const admins = await pool.query(
    'SELECT * FROM admins WHERE shop_id = $1',
    [shopId]
  );
  return {
    shopId: s.shop_id,
    name: s.name,
    displayName: s.display_name,
    address: s.address,
    hours: s.hours,
    phone: s.phone,
    telegramUsername: s.telegram_username,
    whatsappPhone: s.whatsapp_phone,
    maxLink: s.max_username,
    inviteCode: s.invite_code,
    trialStart: s.trial_start,
    trialEnd: s.trial_end,
    country: s.country || null,
    blocked: !!s.blocked,
    blockedReason: s.blocked_reason || null,
    settings: s.settings || {
      logo: null, background: null,
      markupPercent: 20, aiEnabled: false
    },
    stats: s.stats || {
      views: 0, orders: 0, calls: 0,
      startedAt: new Date().toISOString()
    },
    admins: admins.rows.map(a => ({
      chatId: parseInt(a.chat_id),
      role: a.role,
      name: a.name,
      joinedAt: a.joined_at,
      onShift: !!(
        a.on_shift_until &&
        new Date(a.on_shift_until) > new Date()
      )
    }))
  };
}

async function createShopInDb(shop) {
  await pool.query(`
    INSERT INTO shops (
      shop_id, name, display_name, address, hours, phone,
      telegram_username, whatsapp_phone, max_username,
      invite_code, trial_start, trial_end, settings, stats,
      country
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [
    shop.shopId, shop.name, shop.displayName,
    shop.address, shop.hours, shop.phone,
    shop.telegramUsername,
    shop.whatsappPhone || null,
    shop.maxLink || null,
    shop.inviteCode, shop.trialStart, shop.trialEnd,
    JSON.stringify(shop.settings),
    JSON.stringify(shop.stats),
    shop.country || null
  ]);
}

async function updateShopField(shopId, field, value) {
  const allowed = [
    'display_name', 'address', 'hours', 'phone',
    'telegram_username', 'whatsapp_phone', 'max_username',
    'country'
  ];
  if (!allowed.includes(field)) return;
  await pool.query(
    `UPDATE shops SET ${field} = $2 WHERE shop_id = $1`,
    [shopId, value]
  );
}

async function saveShopSettings(shopId, settings) {
  await pool.query(
    'UPDATE shops SET settings = $2 WHERE shop_id = $1',
    [shopId, JSON.stringify(settings)]
  );
}

async function incrementShopStat(shopId, field) {
  await pool.query(
    `UPDATE shops SET stats = stats || ` +
    `jsonb_build_object('${field}', ` +
    `COALESCE((stats->>'${field}')::int, 0) + 1) ` +
    `WHERE shop_id = $1`,
    [shopId]
  );
}

async function addAdminToDb(chatId, shopId, role, name) {
  await pool.query(
    `INSERT INTO admins (chat_id, shop_id, role, name) ` +
    `VALUES ($1,$2,$3,$4) ` +
    `ON CONFLICT (chat_id, shop_id) DO NOTHING`,
    [chatId, shopId, role, name]
  );
}

async function removeAdminFromDb(chatId, shopId) {
  await pool.query(
    'DELETE FROM admins WHERE chat_id = $1 AND shop_id = $2',
    [chatId, shopId]
  );
}

async function getBouquetsFromDb(shopId, includeDeleted) {
  let query = 'SELECT * FROM bouquets WHERE shop_id = $1';
  if (!includeDeleted) query += ' AND deleted = FALSE';
  query += ' ORDER BY is_pinned DESC, ';
  query += 'confirmed_at DESC NULLS LAST, created_at DESC';
  const res = await pool.query(query, [shopId]);
  return res.rows.map(mapBouquet);
}

async function getBouquetById(shopId, bouquetId) {
  const res = await pool.query(
    'SELECT * FROM bouquets ' +
    'WHERE id = $1 AND shop_id = $2 AND deleted = FALSE',
    [bouquetId, shopId]
  );
  if (res.rows.length === 0) return null;
  return mapBouquet(res.rows[0]);
}

function mapBouquet(b) {
  return {
    id: b.id,
    shopId: b.shop_id,
    shopNumber: b.shop_number,
    name: b.name,
    price: b.price,
    description: b.description,
    photos: b.photos || [],
    createdAt: b.created_at,
    confirmedAt: b.confirmed_at,
    hidden: b.hidden,
    deleted: b.deleted,
    isPinned: b.is_pinned,
    chatId: parseInt(b.chat_id),
    reminded: b.reminded,
    clicks: b.clicks,
    tags: b.tags || []
  };
}

async function addBouquetToDb(shopId, bouquet) {
  const r = await pool.query(
    `SELECT COALESCE(MAX(shop_number), 0) + 1 AS next ` +
    `FROM bouquets WHERE shop_id = $1`,
    [shopId]
  );
  const shopNumber = r.rows[0].next;
  const res = await pool.query(`
    INSERT INTO bouquets (
      shop_id, shop_number, name, price, description,
      photos, confirmed_at, is_pinned, chat_id, clicks, tags
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id, shop_number
  `, [
    shopId, shopNumber, bouquet.name, bouquet.price,
    bouquet.description,
    JSON.stringify(bouquet.photos),
    new Date().toISOString(),
    bouquet.isPinned, bouquet.chatId,
    bouquet.clicks || 0,
    JSON.stringify(bouquet.tags || [])
  ]);
  return {
    id: res.rows[0].id,
    shopNumber: res.rows[0].shop_number
  };
}

async function updateBouquetField(id, field, value) {
  await pool.query(
    `UPDATE bouquets SET ${field} = $2 WHERE id = $1`,
    [id, value]
  );
}

async function updateBouquetFields(id, updates) {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setStr = keys
    .map((k, i) => `${k} = $${i + 2}`)
    .join(', ');
  await pool.query(
    `UPDATE bouquets SET ${setStr} WHERE id = $1`,
    [id, ...values]
  );
}

async function getShopByInvite(inviteCode) {
  const res = await pool.query(
    'SELECT shop_id FROM shops WHERE invite_code = $1',
    [inviteCode]
  );
  return res.rows.length > 0 ? res.rows[0].shop_id : null;
}

async function findUserShop(chatId) {
  const res = await pool.query(
    'SELECT shop_id FROM admins WHERE chat_id = $1 LIMIT 1',
    [chatId]
  );
  return res.rows.length > 0 ? res.rows[0].shop_id : null;
}

async function getAllShopsAdmin() {
  const res = await pool.query(`
    SELECT
      s.shop_id, s.display_name, s.trial_end,
      s.stats, s.blocked, s.country,
      (SELECT COUNT(*) FROM bouquets b
        WHERE b.shop_id = s.shop_id
        AND b.deleted = FALSE) AS bouquets_count,
      (SELECT COUNT(*) FROM admins a
        WHERE a.shop_id = s.shop_id) AS team_count
    FROM shops s
    ORDER BY s.trial_end DESC NULLS LAST
  `);
  return res.rows.map(r => {
    const stats = r.stats || {};
    return {
      shopId: r.shop_id,
      displayName: r.display_name,
      trialEnd: r.trial_end,
      country: r.country || null,
      blocked: !!r.blocked,
      bouquetsCount: parseInt(r.bouquets_count) || 0,
      teamCount: parseInt(r.team_count) || 0,
      orders: stats.orders || 0,
      calls: stats.calls || 0
    };
  });
}

async function extendShopTrial(shopId, days) {
  await pool.query(
    `UPDATE shops SET trial_end = ` +
    `GREATEST(COALESCE(trial_end, NOW()), NOW()) ` +
    `+ ($2 || ' days')::INTERVAL ` +
    `WHERE shop_id = $1`,
    [shopId, String(days)]
  );
}

async function blockShop(shopId, reason) {
  await pool.query(
    `UPDATE shops SET blocked = TRUE, ` +
    `blocked_reason = $2 WHERE shop_id = $1`,
    [shopId, reason]
  );
}

async function unblockShop(shopId) {
  await pool.query(
    `UPDATE shops SET blocked = FALSE, ` +
    `blocked_reason = NULL WHERE shop_id = $1`,
    [shopId]
  );
}

// ========== UI-КОНСТРУКТОРЫ ==========
function getMainKeyboard(shop, chatId) {
  const me = shop && shop.admins
    ? shop.admins.find(a => a.chatId === chatId)
    : null;
  const onShift = !!(me && me.onShift);

  const rows = [
    [
      { text: '📷 Добавить букет' },
      { text: '✅ Что в наличии?' }
    ],
    [
      { text: '✏️ Мои букеты' },
      { text: '🔗 Витрина' }
    ]
  ];

  if (onShift) {
    rows.push([{ text: '🚪 Закончить работу' }]);
  } else {
    rows.push([{ text: '✅ Я сегодня работаю' }]);
  }

  rows.push([{ text: '⚙️ Настройки' }]);

  return {
    keyboard: rows,
    resize_keyboard: true
  };
}

function getSettingsMenu(shop, chatId) {
  if (isOwner(shop, chatId)) {
    return { reply_markup: { inline_keyboard: [
      [{
        text: '🔑 Пригласить флориста',
        callback_data: 'menu_invite'
      }],
      [{
        text: '👥 Команда магазина',
        callback_data: 'menu_team'
      }],
      [{
        text: '🏪 Данные магазина',
        callback_data: 'menu_shopdata'
      }],
      [{
        text: '📊 Статистика',
        callback_data: 'menu_stats'
      }],
      [{
        text: '💰 Наценка',
        callback_data: 'menu_markup'
      }],
      [
        { text: '🎨 Логотип', callback_data: 'menu_logo' },
        { text: '🖼 Фон', callback_data: 'menu_background' }
      ],
      [{
        text: '🖼 Обложка',
        callback_data: 'menu_cover'
      }],
      [{
        text: '🔘 Цвет кнопки',
        callback_data: 'menu_buttoncolor'
      }],
      [{
        text: '💱 Валюта',
        callback_data: 'menu_currency'
      }],
      [{
        text: '📋 Статус магазина',
        callback_data: 'menu_status'
      }],
      [{
        text: '💳 Продлить подписку',
        callback_data: 'menu_renew'
      }],
      [{
        text: '📖 Помощь',
        callback_data: 'help_menu'
      }],
      [{
        text: '❌ Закрыть',
        callback_data: 'menu_close'
      }]
    ] } };
  }
  return { reply_markup: { inline_keyboard: [
    [{
      text: '📋 Статус магазина',
      callback_data: 'menu_status'
    }],
    [{
      text: '📖 Помощь',
      callback_data: 'help_menu'
    }],
    [{
      text: '❌ Закрыть',
      callback_data: 'menu_close'
    }]
  ] } };
}

function buildShopDataMessage(shop) {
  let txt = `🏪 <b>Данные магазина</b>\n\n`;
  txt += `📝 Название: ${esc(shop.displayName)}\n`;
  const addr = shop.address
    ? esc(shop.address)
    : '<i>не указан</i>';
  txt += `📍 Адрес: ${addr}\n`;
  const hrs = shop.hours
    ? esc(shop.hours)
    : '<i>не указаны</i>';
  txt += `🕐 Часы: ${hrs}\n`;
  const ph = shop.phone
    ? esc(formatPhone(shop.phone))
    : '<i>не указан</i>';
  txt += `📞 Телефон: ${ph}\n\n`;
  const tg = shop.telegramUsername
    ? '@' + esc(shop.telegramUsername)
    : '<i>не указан</i>';
  txt += `📱 Telegram: ${tg}\n`;
  const wa = shop.whatsappPhone
    ? esc(formatPhone(shop.whatsappPhone))
    : '<i>не указан</i>';
  txt += `💬 WhatsApp: ${wa}\n`;
  const mx = shop.maxLink
    ? '✅ установлена'
    : '<i>не указана</i>';
  txt += `🅼 MAX: ${mx}\n`;
  const country = findCountryByCode(shop.country);
  const cLabel = country
    ? country.label
    : '<i>не указана</i>';
  txt += `🌍 Страна: ${cLabel}\n`;
  const curCode = getShopCurrency(shop);
  const curObj = findCurrencyByCode(curCode);
  const curLabel = curObj
    ? curObj.label + ' (' + curObj.sym + ')'
    : '₽';
  txt += `💱 Валюта: ${curLabel}\n\n`;
  txt += `<i>Что изменить?</i>`;
  return {
    text: txt,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📝 Название',
            callback_data: 'edit_shop_displayname'
          }],
          [{
            text: '📍 Адрес',
            callback_data: 'edit_shop_address'
          }],
          [{
            text: '🕐 Часы работы',
            callback_data: 'edit_shop_hours'
          }],
          [{
            text: '📞 Телефон',
            callback_data: 'edit_shop_phone'
          }],
          [{
            text: '📱 Telegram',
            callback_data: 'edit_shop_telegram'
          }],
          [{
            text: '💬 WhatsApp',
            callback_data: 'edit_shop_whatsapp'
          }],
          [{
            text: '🅼 MAX',
            callback_data: 'edit_shop_max'
          }],
          [{
            text: '💱 Валюта',
            callback_data: 'edit_shop_currency'
          }],
          [{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]
        ]
      }
    }
  };
}// ========== HTML-СТРАНИЦЫ ==========
const MANROPE_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?' +
  'family=Manrope:wght@400;600;700;800&display=swap" ' +
  'rel="stylesheet">';

function buildMessengerOrderPage({ shop, bouquet, orderText, messenger }) {
  const isMax = messenger === 'max';
  const messengerName = isMax ? 'MAX' : 'Telegram';
  const messengerEmoji = isMax ? '🅼' : '📩';
  const buttonColor = isMax ? '#7B68EE' : '#229ED9';
  const externalLink = isMax
    ? esc(shop.maxLink)
    : 'https://t.me/' + esc(shop.telegramUsername);
  const orderTextJs = JSON.stringify(orderText);
  const orderTextEsc = esc(orderText);
  const shopNameEsc = esc(shop.displayName);
  const shopIdEsc = esc(shop.shopId);
  const bouquetNameEsc = esc(bouquet.name);
  const priceStr = formatPrice(bouquet.price, shop);

  let html = '';
  html += '<!DOCTYPE html>\n<html lang="ru">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" ';
  html += 'content="width=device-width, initial-scale=1.0">\n';
  html += '<title>Перейти в ' + messengerName;
  html += ' — ' + shopNameEsc + '</title>\n';
  html += MANROPE_LINK + '\n';
  html += '<style>\n';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;';
  html += 'margin:0;padding:20px;background:#fafaf8;';
  html += 'text-align:center;color:#2c3e50;}\n';
  html += '.container{max-width:500px;margin:0 auto;';
  html += 'padding:12px 0;}\n';
  html += 'h1{font-size:22px;margin:8px 0 4px;';
  html += 'font-weight:800;}\n';
  html += '.sub{color:#666;font-size:14px;';
  html += 'margin-bottom:16px;}\n';
  html += '.card{background:#fff;border-radius:20px;';
  html += 'padding:20px;margin:16px 0;';
  html += 'box-shadow:0 4px 20px rgba(0,0,0,0.08);}\n';
  html += '.quote{background:#f5f5f5;border-radius:12px;';
  html += 'padding:16px;text-align:left;font-size:16px;';
  html += 'line-height:1.5;margin:16px 0;color:#333;';
  html += 'white-space:pre-wrap;word-break:break-word;}\n';
  html += '.btn{display:block;width:100%;padding:16px;';
  html += 'border-radius:30px;font-size:17px;';
  html += 'font-weight:700;text-decoration:none;';
  html += 'border:none;cursor:pointer;margin-top:12px;';
  html += 'box-sizing:border-box;font-family:inherit;}\n';
  html += '.btn-copy{background:#3498db;color:#fff;}\n';
  html += '.btn-copy.copied{background:#27ae60;}\n';
  html += '.btn-open{background:' + buttonColor;
  html += ';color:#fff;}\n';
  html += '.steps{text-align:left;color:#555;';
  html += 'font-size:14px;line-height:1.6;margin:12px 0;}\n';
  html += '.steps b{color:#2c3e50;}\n';
  html += '.back{display:inline-block;margin-top:20px;';
  html += 'color:#888;text-decoration:none;font-size:14px;}\n';
  html += '</style>\n</head>\n<body>\n';
  html += '<div class="container">\n';
  html += '<h1>' + messengerEmoji + ' Перейти в ';
  html += messengerName + '</h1>\n';
  html += '<div class="sub">Букет №';
  html += bouquet.shopNumber + ' — ' + bouquetNameEsc;
  html += ' — ' + priceStr + '</div>\n';
  html += '<div class="card">\n';
  html += '<div class="steps">\n';
  html += '<b>1.</b> Скопируйте текст ниже<br>\n';
  html += '<b>2.</b> Нажмите «Открыть ';
  html += messengerName + '»<br>\n';
  html += '<b>3.</b> Вставьте текст в чат и отправьте\n';
  html += '</div>\n';
  html += '<div class="quote">' + orderTextEsc + '</div>\n';
  html += '<button class="btn btn-copy" id="copyBtn" ';
  html += 'onclick="copyOrder()">';
  html += '📋 Скопировать текст</button>\n';
  html += '<a class="btn btn-open" href="' + externalLink + '" ';
  html += 'target="_blank" rel="noopener">';
  html += messengerEmoji + ' Открыть ';
  html += messengerName + '</a>\n';
  html += '</div>\n';
  html += '<a class="back" href="/shop/' + shopIdEsc + '">';
  html += '← Вернуться на витрину</a>\n';
  html += '</div>\n<script>\n';
  html += 'function copyOrder() {\n';
  html += '  var text = ' + orderTextJs + ';\n';
  html += '  var btn = document.getElementById("copyBtn");\n';
  html += '  function done() {\n';
  html += '    btn.textContent = "✅ Скопировано!";\n';
  html += '    btn.classList.add("copied");\n';
  html += '    setTimeout(function(){ ';
  html += 'btn.textContent = "📋 Скопировать текст"; ';
  html += 'btn.classList.remove("copied"); }, 2500);\n';
  html += '  }\n';
  html += '  if (navigator.clipboard && ';
  html += 'navigator.clipboard.writeText) {\n';
  html += '    navigator.clipboard.writeText(text)';
  html += '.then(done).catch(function(){ ';
  html += 'fallbackCopy(text, done); });\n';
  html += '  } else { fallbackCopy(text, done); }\n';
  html += '}\n';
  html += 'function fallbackCopy(text, cb) {\n';
  html += '  var ta = document.createElement("textarea");\n';
  html += '  ta.value = text; ta.style.position = "fixed"; ';
  html += 'ta.style.left = "-9999px";\n';
  html += '  document.body.appendChild(ta); ';
  html += 'ta.focus(); ta.select();\n';
  html += '  try { document.execCommand("copy"); cb(); } ';
  html += 'catch(e) {}\n';
  html += '  document.body.removeChild(ta);\n';
  html += '}\n';
  html += '</script>\n</body>\n</html>';
  return html;
}

function buildBouquetPage({ shop, bouquet, photoRefs, otherPhotoRefs }) {
  const bouquetNameEsc = esc(bouquet.name);
  const shopIdEsc = esc(shop.shopId);
  const oldPrice = calculateOldPrice(
    bouquet.price, shop.settings.markupPercent
  );
  const bouquetUrl = SITE_URL + '/shop/' +
    esc(shop.shopId) + '/b/' + bouquet.id;
  const title = bouquetNameEsc + ' — ' + esc(shop.displayName);
  const priceStr = formatPrice(bouquet.price, shop);
  const oldPriceStr = formatPrice(oldPrice, shop);
  const description = priceStr + ' · ' +
    esc(shop.displayName);
  const primaryPhotoUrl = (photoRefs && photoRefs.primary)
    ? absoluteUrl(photoRefs.primary)
    : null;
  const btnColors = getButtonColors(shop);

  let ogTags = '';
  if (primaryPhotoUrl) {
    ogTags += '\n<meta property="og:image" content="';
    ogTags += escAttr(primaryPhotoUrl) + '">\n';
    ogTags += '<meta property="og:image:width" content="800">\n';
    ogTags += '<meta property="og:image:height" content="800">\n';
    ogTags += '<meta name="twitter:image" content="';
    ogTags += escAttr(primaryPhotoUrl) + '">';
  }

  const imgStyle = 'width:100%;max-width:500px;' +
    'border-radius:20px;box-shadow:0 6px 24px ' +
    'rgba(0,0,0,0.12);';
  let mainPhotoHtml = '';
  if (photoRefs && photoRefs.primary) {
    mainPhotoHtml = renderImgTag(photoRefs, imgStyle);
  } else {
    const grad = getPlaceholderGradient(bouquet.id);
    mainPhotoHtml = '<div style="width:100%;';
    mainPhotoHtml += 'max-width:500px;aspect-ratio:1/1;';
    mainPhotoHtml += 'background:' + grad + ';';
    mainPhotoHtml += 'border-radius:20px;display:flex;';
    mainPhotoHtml += 'align-items:center;justify-content:center;';
    mainPhotoHtml += 'color:#fff;font-size:60px;margin:0 auto;';
    mainPhotoHtml += 'opacity:0.7;">📷</div>';
  }

  let thumbsHtml = '';
  if (otherPhotoRefs && otherPhotoRefs.length > 0) {
    const thumbStyle = 'width:70px;height:70px;';
    const thumbStyle2 = 'object-fit:cover;border-radius:12px;';
    const thumbStyle3 = 'border:2px solid #fff;';
    const thumbStyle4 = 'box-shadow:0 2px 8px rgba(0,0,0,0.12);';
    const fullThumb = thumbStyle + thumbStyle2 +
      thumbStyle3 + thumbStyle4;
    thumbsHtml = '<div style="display:flex;gap:8px;';
    thumbsHtml += 'justify-content:center;margin-top:12px;';
    thumbsHtml += 'flex-wrap:wrap;">';
    for (const r of otherPhotoRefs) {
      thumbsHtml += renderImgTag(r, fullThumb);
    }
    thumbsHtml += '</div>';
  }

  const btnBase = 'display:block;margin-top:8px;';
  const btnBase2 = 'color:#fff;padding:14px 20px;';
  const btnBase3 = 'border-radius:30px;text-decoration:none;';
  const btnBase4 = 'font-weight:700;text-align:center;';
  const btnBase5 = 'font-size:16px;';
  const btnCommon = btnBase + btnBase2 + btnBase3 +
    btnBase4 + btnBase5;
  const btnTg = btnCommon + 'background:#229ED9;';
  const btnWa = btnCommon + 'background:#25D366;';
  const btnMax = btnCommon + 'background:#7B68EE;';
  const btnCall = btnCommon + 'background:' +
    btnColors.color + ';';

  const hrefBase = '/go/' + esc(shop.shopId) +
    '/' + bouquet.id + '/';

  let buttonsHTML = '';
  if (shop.telegramUsername) {
    buttonsHTML += '<a href="' + hrefBase + 'tg" style="';
    buttonsHTML += btnTg + '">📩 Написать в Telegram</a>';
  }
  if (shop.whatsappPhone) {
    buttonsHTML += '<a href="' + hrefBase + 'wa" style="';
    buttonsHTML += btnWa + '">💬 Написать в WhatsApp</a>';
  }
  if (shop.maxLink) {
    buttonsHTML += '<a href="' + hrefBase + 'max" style="';
    buttonsHTML += btnMax + '">🅼 Написать в MAX</a>';
  }
  if (shop.phone) {
    buttonsHTML += '<a href="' + hrefBase + 'call" style="';
    buttonsHTML += btnCall + '">📞 Позвонить</a>';
  }

  let priceHtml = '';
  if (oldPrice > bouquet.price) {
    priceHtml += '<span style="text-decoration:line-through;';
    priceHtml += 'color:#999;font-weight:400;';
    priceHtml += 'font-size:20px;">';
    priceHtml += oldPriceStr + '</span>&nbsp; ';
    priceHtml += priceStr;
  } else {
    priceHtml = priceStr;
  }

  const bouquetNameJs = JSON.stringify(bouquet.name);
  const bouquetUrlJs = JSON.stringify(bouquetUrl);
  const noContacts = '<div style="color:#888;padding:10px;">';
  const noContacts2 = 'Контакты временно недоступны</div>';
  const bodyBg = getBackgroundStyle(shop.settings.background);

  let html = '';
  html += '<!DOCTYPE html>\n<html lang="ru">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" ';
  html += 'content="width=device-width, initial-scale=1.0">\n';
  html += '<title>' + title + '</title>\n';
  html += '<meta property="og:type" content="product">\n';
  html += '<meta property="og:title" content="';
  html += escAttr(title) + '">\n';
  html += '<meta property="og:description" content="';
  html += escAttr(description) + '">\n';
  html += '<meta property="og:url" content="';
  html += escAttr(bouquetUrl) + '">\n';
  html += '<meta property="og:site_name" content="Flowind">\n';
  html += '<meta name="twitter:card" ';
  html += 'content="summary_large_image">\n';
  html += '<meta name="twitter:title" content="';
  html += escAttr(title) + '">\n';
  html += '<meta name="twitter:description" content="';
  html += escAttr(description) + '">';
  html += ogTags + '\n';
  html += MANROPE_LINK + '\n<style>\n';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;';
  html += 'margin:0;padding:20px;';
  html += bodyBg;
  html += 'text-align:center;color:#2c3e50;}\n';
  html += '.container{max-width:560px;margin:0 auto;';
  html += 'padding:12px 0;}\n';
  html += '.back{display:inline-block;margin-bottom:16px;';
  html += 'color:#888;text-decoration:none;font-size:14px;}\n';
  html += 'h1{font-size:26px;margin:16px 0 8px;';
  html += 'line-height:1.3;font-weight:800;}\n';
  html += '.price{font-size:30px;font-weight:800;';
  html += 'margin:8px 0 20px;color:' + btnColors.color + ';}\n';
  html += '.card{background:#fff;border-radius:22px;';
  html += 'padding:20px;box-shadow:0 6px 24px ';
  html += 'rgba(0,0,0,0.07);margin:20px 0;}\n';
  html += '.share{display:inline-block;margin-top:20px;';
  html += 'color:#888;text-decoration:none;font-size:14px;';
  html += 'padding:10px 16px;border-radius:20px;';
  html += 'background:#f0f0f0;}\n';
  html += '</style>\n</head>\n<body>\n';
  html += '<div class="container">\n';
  html += '<a class="back" href="/shop/' + shopIdEsc +
    '">← К витрине</a>\n';
  html += '<div>' + mainPhotoHtml + '</div>\n';
  html += thumbsHtml + '\n';
  html += '<h1>' + bouquetNameEsc + '</h1>\n';
  html += '<div class="price">' + priceHtml + '</div>\n';
  html += '<div class="card">';
  html += buttonsHTML || (noContacts + noContacts2);
  html += '</div>\n';
  html += '<a class="share" href="#" ';
  html += 'onclick="shareBouquet(); return false;">';
  html += '📤 Поделиться с близкими</a>\n';
  html += '</div>\n<script>\n';
  html += 'function shareBouquet() {\n';
  html += '  var url = ' + bouquetUrlJs + ';\n';
  html += '  var name = ' + bouquetNameJs + ';\n';
  html += '  var price = ' + JSON.stringify(priceStr) + ';\n';
  html += '  var text = name + " — " + price;\n';
  html += '  if (navigator.share) {\n';
  html += '    navigator.share({ title: name, text: text,';
  html += ' url: url }).catch(function(){});\n';
  html += '  } else if (navigator.clipboard && ';
  html += 'navigator.clipboard.writeText) {\n';
  html += '    navigator.clipboard.writeText(url)';
  html += '.then(function(){ ';
  html += 'alert("Ссылка скопирована"); })';
  html += '.catch(function(){ ';
  html += 'prompt("Скопируйте ссылку:", url); });\n';
  html += '  } else { prompt("Скопируйте ссылку:", url); }\n';
  html += '}\n';
  html += '</script>\n</body>\n</html>';
  return html;
}

function buildContactPage({ shop, bouquet, photoRefs }) {
  const bouquetNameEsc = esc(bouquet.name);
  const shopIdEsc = esc(shop.shopId);
  const oldPrice = calculateOldPrice(
    bouquet.price, shop.settings.markupPercent
  );
  const priceStr = formatPrice(bouquet.price, shop);
  const oldPriceStr = formatPrice(oldPrice, shop);
  const orderText = 'Здравствуйте! Пишу с вашей витрины. ' +
    'Хочу заказать букет №' + bouquet.shopNumber +
    ' «' + bouquet.name + '» — ' + priceStr + '.';
  const orderTextJs = JSON.stringify(orderText);
  const orderTextEsc = esc(orderText);
  const btnColors = getButtonColors(shop);

  const imgStyle = 'width:100%;max-width:420px;' +
    'border-radius:20px;box-shadow:0 6px 24px ' +
    'rgba(0,0,0,0.12);';
  let mainPhotoHtml = '';
  if (photoRefs && photoRefs.primary) {
    mainPhotoHtml = renderImgTag(photoRefs, imgStyle);
  } else {
    const grad = getPlaceholderGradient(bouquet.id);
    mainPhotoHtml = '<div style="width:100%;';
    mainPhotoHtml += 'max-width:420px;aspect-ratio:1/1;';
    mainPhotoHtml += 'background:' + grad + ';';
    mainPhotoHtml += 'border-radius:20px;display:flex;';
    mainPhotoHtml += 'align-items:center;justify-content:center;';
    mainPhotoHtml += 'color:#fff;font-size:60px;margin:0 auto;';
    mainPhotoHtml += 'opacity:0.7;">📷</div>';
  }

  let priceHtml = '';
  if (oldPrice > bouquet.price) {
    priceHtml += '<span style="text-decoration:line-through;';
    priceHtml += 'color:#999;font-weight:400;';
    priceHtml += 'font-size:20px;">';
    priceHtml += oldPriceStr + '</span>&nbsp; ';
    priceHtml += priceStr;
  } else {
    priceHtml = priceStr;
  }

  const btnBase = 'display:flex;align-items:center;';
  const btnBase2 = 'justify-content:center;gap:8px;width:100%;';
  const btnBase3 = 'padding:16px;border-radius:30px;';
  const btnBase4 = 'font-size:17px;font-weight:700;';
  const btnBase5 = 'text-decoration:none;border:none;';
  const btnBase6 = 'cursor:pointer;margin-top:10px;';
  const btnBase7 = 'box-sizing:border-box;font-family:inherit;';
  const btnBase8 = 'color:#fff;';
  const btnCommon = btnBase + btnBase2 + btnBase3 + btnBase4 +
    btnBase5 + btnBase6 + btnBase7 + btnBase8;
  const btnWa = btnCommon + 'background:#25D366;';
  const btnTg = btnCommon + 'background:#229ED9;';
  const btnMax = btnCommon + 'background:#7B68EE;';
  const btnCall = btnCommon + 'background:' +
    btnColors.color + ';';

  const hrefBase = '/go/' + esc(shop.shopId) +
    '/' + bouquet.id + '/';

  let contactsHTML = '';
  if (shop.whatsappPhone) {
    contactsHTML += '<a href="' + hrefBase + 'wa" style="';
    contactsHTML += btnWa + '">💬 WhatsApp</a>';
  }
  if (shop.telegramUsername) {
    contactsHTML += '<a href="' + hrefBase + 'tg" style="';
    contactsHTML += btnTg + '">📩 Telegram</a>';
  }
  if (shop.maxLink) {
    contactsHTML += '<a href="' + hrefBase + 'max" style="';
    contactsHTML += btnMax + '">🅼 MAX</a>';
  }
  if (shop.phone) {
    contactsHTML += '<a href="' + hrefBase + 'call" style="';
    contactsHTML += btnCall + '">📞 Позвонить</a>';
  }

  const noContacts = '<div style="color:#888;padding:10px;">';
  const noContacts2 = 'Контакты временно недоступны</div>';
  const bodyBg = getBackgroundStyle(shop.settings.background);

  let html = '';
  html += '<!DOCTYPE html>\n<html lang="ru">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" ';
  html += 'content="width=device-width, initial-scale=1.0">\n';
  html += '<title>Связаться — ' + bouquetNameEsc + '</title>\n';
  html += MANROPE_LINK + '\n<style>\n';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;';
  html += 'margin:0;padding:20px;';
  html += bodyBg;
  html += 'text-align:center;color:#2c3e50;}\n';
  html += '.container{max-width:500px;margin:0 auto;';
  html += 'padding:12px 0;}\n';
  html += '.back{display:inline-block;margin-bottom:16px;';
  html += 'color:#888;text-decoration:none;font-size:14px;}\n';
  html += 'h1{font-size:22px;margin:14px 0 6px;';
  html += 'line-height:1.3;font-weight:800;}\n';
  html += '.price{font-size:26px;font-weight:800;';
  html += 'margin:6px 0 16px;color:' + btnColors.color + ';}\n';
  html += '.card{background:#fff;border-radius:22px;';
  html += 'padding:20px;box-shadow:0 6px 24px ';
  html += 'rgba(0,0,0,0.07);margin:16px 0;}\n';
  html += '.quote{background:#f5f5f5;border-radius:12px;';
  html += 'padding:14px;text-align:left;font-size:15px;';
  html += 'line-height:1.5;margin:0 0 12px;color:#333;';
  html += 'white-space:pre-wrap;word-break:break-word;}\n';
  html += '.copy{display:block;width:100%;padding:12px;';
  html += 'border-radius:24px;font-size:15px;';
  html += 'font-weight:700;background:#e8e8e8;color:#333;';
  html += 'border:none;cursor:pointer;font-family:inherit;}\n';
  html += '.copy.copied{background:#27ae60;color:#fff;}\n';
  html += '</style>\n</head>\n<body>\n';
  html += '<div class="container">\n';
  html += '<a class="back" href="/shop/' + shopIdEsc +
    '">← К витрине</a>\n\n';
  html += '<div>' + mainPhotoHtml + '</div>\n';
  html += '<h1>' + bouquetNameEsc + '</h1>\n';
  html += '<div class="price">' + priceHtml + '</div>\n\n';
  html += '<div class="card">\n';
  html += '<div style="font-size:16px;font-weight:700;';
  html += 'color:#2c3e50;margin-bottom:12px;">';
  html += 'Как связаться с флористом?</div>\n';
  html += contactsHTML || (noContacts + noContacts2);
  html += '\n</div>\n\n';
  html += '<div class="card" style="text-align:left;">\n';
  html += '<div style="font-size:14px;color:#555;';
  html += 'margin-bottom:10px;">\n';
  html += '💡 Можно скопировать готовый текст заказа ';
  html += 'и вставить в чат:\n</div>\n';
  html += '<div class="quote">' + orderTextEsc + '</div>\n';
  html += '<button class="copy" id="copyBtn" ';
  html += 'onclick="copyOrder()">';
  html += '📋 Скопировать текст</button>\n</div>\n</div>\n';
  html += '<script>\n';
  html += 'function copyOrder() {\n';
  html += '  var text = ' + orderTextJs + ';\n';
  html += '  var btn = document.getElementById("copyBtn");\n';
  html += '  function done() {\n';
  html += '    btn.textContent = "✅ Скопировано!";\n';
  html += '    btn.classList.add("copied");\n';
  html += '    setTimeout(function(){ ';
  html += 'btn.textContent = "📋 Скопировать текст"; ';
  html += 'btn.classList.remove("copied"); }, 2500);\n';
  html += '  }\n';
  html += '  if (navigator.clipboard && ';
  html += 'navigator.clipboard.writeText) {\n';
  html += '    navigator.clipboard.writeText(text)';
  html += '.then(done).catch(function(){ ';
  html += 'fallbackCopy(text, done); });\n';
  html += '  } else { fallbackCopy(text, done); }\n';
  html += '}\n';
  html += 'function fallbackCopy(text, cb) {\n';
  html += '  var ta = document.createElement("textarea");\n';
  html += '  ta.value = text; ta.style.position = "fixed"; ';
  html += 'ta.style.left = "-9999px";\n';
  html += '  document.body.appendChild(ta); ';
  html += 'ta.focus(); ta.select();\n';
  html += '  try { document.execCommand("copy"); cb(); } ';
  html += 'catch(e) {}\n';
  html += '  document.body.removeChild(ta);\n';
  html += '}\n';
  html += '</script>\n</body>\n</html>';
  return html;
}// ========== ПРОКСИ S3 ==========
app.get('/photo/s3/*', async (req, res) => {
  try {
    const key = req.params[0];
    if (!key || key.includes('..')) {
      return res.status(400).send('bad');
    }
    if (!s3) return res.status(503).send('s3 disabled');

    const cmd = new GetObjectCommand({
      Bucket: YC_BUCKET, Key: key
    });
    const data = await s3.send(cmd);

    res.setHeader(
      'Content-Type', data.ContentType || 'image/jpeg'
    );
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const stream = data.Body;
    if (stream.pipe) {
      stream.pipe(res);
    } else {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      res.send(Buffer.concat(chunks));
    }
  } catch (e) {
    console.error('Ошибка /photo/s3:', e?.message || e);
    return res.status(404).send('not found');
  }
});

app.get('/photo/tg/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    if (!isValidFileId(fileId)) {
      return res.status(400).send('bad');
    }
    const fileInfo = await bot.getFile(fileId);
    if (!fileInfo || !fileInfo.file_path) {
      return res.status(404).send('not found');
    }
    const url = 'https://api.telegram.org/file/bot' +
      token + '/' + fileInfo.file_path;
    res.setHeader('Cache-Control', 'public, max-age=2400');
    return res.redirect(302, url);
  } catch (e) {
    console.error('Ошибка /photo/tg:', e?.message || e);
    return res.status(404).send('not found');
  }
});

// ========== EXPRESS-РОУТЫ ==========
app.get('/contact/:shopId/:bouquetId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) return res.status(404).send('Магазин не найден');
    const bouquetId = parseInt(req.params.bouquetId);
    if (!bouquetId || isNaN(bouquetId)) {
      return res.status(404).send('Букет не найден');
    }
    const b = await getBouquetById(req.params.shopId, bouquetId);
    if (!b) return res.status(404).send('Букет не найден');
    const firstPhoto = (b.photos && b.photos.length > 0)
      ? b.photos[0] : null;
    const photoRefs = getPhotoRefs(firstPhoto);
    res.send(buildContactPage({ shop, bouquet: b, photoRefs }));
  } catch (e) {
    console.error('Ошибка страницы контактов:', e?.message || e);
    res.status(500).send('Ошибка');
  }
});

app.get('/go/:shopId/:bouquetId/:type', async (req, res) => {
  try {
    const { shopId, type } = req.params;
    const bouquetId = parseInt(req.params.bouquetId);
    if (!bouquetId || isNaN(bouquetId)) {
      return res.status(404).send('Не найдено');
    }
    const shop = await getShopFromDb(shopId);
    if (!shop) return res.status(404).send('Не найдено');
    const b = await getBouquetById(shopId, bouquetId);
    if (!b) return res.status(404).send('Букет не найден');

    const priceStr = formatPrice(b.price, shop);
    const orderText = 'Здравствуйте! Пишу с вашей витрины. ' +
      'Хочу заказать букет №' + b.shopNumber +
      ' «' + b.name + '» — ' + priceStr + '.';

    const xff = req.headers['x-forwarded-for'] || '';
    const clientIp = xff.split(',')[0].trim() ||
      req.ip || 'unknown';
    const clickKey = shopId + ':' + bouquetId + ':' +
      type + ':' + clientIp;
    const now = Date.now();
    const lastNotified = notifiedClicks[clickKey];
    if (!lastNotified || now - lastNotified > CLICK_NOTIFY_TTL) {
      notifiedClicks[clickKey] = now;
      sendClickNotification(shop, b, type);
    }

    if (type === 'max' && shop.maxLink) {
      await incrementShopStat(shopId, 'orders');
      await pool.query(
        'UPDATE bouquets SET clicks = ' +
        'COALESCE(clicks, 0) + 1 WHERE id = $1',
        [b.id]
      );
      return res.send(buildMessengerOrderPage({
        shop, bouquet: b, orderText, messenger: 'max'
      }));
    }
    if (type === 'tg' && shop.telegramUsername) {
      await incrementShopStat(shopId, 'orders');
      await pool.query(
        'UPDATE bouquets SET clicks = ' +
        'COALESCE(clicks, 0) + 1 WHERE id = $1',
        [b.id]
      );
      return res.send(buildMessengerOrderPage({
        shop, bouquet: b, orderText, messenger: 'tg'
      }));
    }
    let redirectUrl = null;
    if (type === 'wa' && shop.whatsappPhone) {
      const waPhone = shop.whatsappPhone.replace(/\D/g, '');
      redirectUrl = 'https://wa.me/' + waPhone +
        '?text=' + encodeURIComponent(orderText);
      await incrementShopStat(shopId, 'orders');
    } else if (type === 'call' && shop.phone) {
      redirectUrl = 'tel:' + shop.phone.replace(/\D/g, '');
      await incrementShopStat(shopId, 'calls');
    }
    if (!redirectUrl) {
      return res.status(404).send('Контакт не настроен');
    }
    await pool.query(
      'UPDATE bouquets SET clicks = ' +
      'COALESCE(clicks, 0) + 1 WHERE id = $1',
      [b.id]
    );
    let redirectHtml = '<!DOCTYPE html><html><head>';
    redirectHtml += '<meta charset="UTF-8">';
    redirectHtml += '<meta http-equiv="refresh" content="0; url=';
    redirectHtml += redirectUrl + '">';
    redirectHtml += '<title>Переход…</title></head>';
    redirectHtml += '<body style="font-family:-apple-system,';
    redirectHtml += 'sans-serif;text-align:center;padding:50px;';
    redirectHtml += 'color:#555;">';
    redirectHtml += '<p>Переходим к продавцу…</p>';
    redirectHtml += '<p><a href="' + redirectUrl + '">';
    redirectHtml += 'Нажмите, если не переходит автоматически';
    redirectHtml += '</a></p></body></html>';
    res.send(redirectHtml);
  } catch (e) {
    console.error('Ошибка /go:', e?.message || e);
    res.status(500).send('Ошибка');
  }
});

app.get('/shop/:shopId/b/:bouquetId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) return res.status(404).send('Магазин не найден');
    const bouquetId = parseInt(req.params.bouquetId);
    if (!bouquetId || isNaN(bouquetId)) {
      return res.status(404).send('Букет не найден');
    }
    const b = await getBouquetById(
      req.params.shopId, bouquetId
    );
    if (!b) return res.status(404).send('Букет не найден');
    const photoRefsList = [];
    for (const p of b.photos) {
      const r = getPhotoRefs(p);
      if (r.primary) photoRefsList.push(r);
    }
    const mainRef = photoRefsList[0] || null;
    const otherRefs = photoRefsList.slice(1);
    res.send(buildBouquetPage({
      shop, bouquet: b,
      photoRefs: mainRef, otherPhotoRefs: otherRefs
    }));
  } catch (e) {
    console.error('Ошибка страницы букета:', e?.message || e);
    res.status(500).send('Ошибка');
  }
});

// ========== РЕГИСТРАЦИЯ ==========
const REG_STEPS = {
  shopId: {
    text: '📝 <b>Шаг 1 из 9. Короткое название для ссылки</b>\n\n' +
          'Только латинские буквы, цифры и _, без пробелов.\n' +
          'Например: <code>cveti_msk</code>\n\n' +
          'Это будет адрес витрины:\n' +
          '<code>flowind.ru/shop/cveti_msk</code>\n\n' +
          '<i>Если не знаете — нажмите «Пропустить», ' +
          'я сгенерирую сам.</i>',
    skip: true, mandatory: true
  },
  displayName: {
    text: '✅ <b>Шаг 2 из 9. Красивое название</b>\n\n' +
          'Как назвать магазин для клиентов?\n' +
          'Оно появится на витрине. Можно с эмодзи.\n\n' +
          'Например: <i>🌸 Цветы на Фрунзе</i>',
    skip: false, mandatory: true
  },
  country: {
    text: '🌍 <b>Шаг 3 из 9. В какой стране магазин?</b>\n\n' +
          'Нужно, чтобы правильно работали цены и валюта.\n\n' +
          '<i>Выберите кнопкой ниже.</i>',
    skip: true, mandatory: false
  },
  address: {
    text: '✅ <b>Шаг 4 из 9. Адрес</b>\n\n' +
          'Клиенты увидят адрес на витрине.\n' +
          'Например: <i>Москва, ул. Фрунзе, 15</i>\n\n' +
          '<i>Можно пропустить и добавить позже.</i>',
    skip: true, mandatory: false
  },
  hours: {
    text: '✅ <b>Шаг 5 из 9. Часы работы</b>\n\n' +
          'Например: <i>Пн-Вс 10:30-21:00</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true, mandatory: false
  },
  phone: {
    text: '✅ <b>Шаг 6 из 9. Телефон</b>\n\n' +
          'Для кнопки «Позвонить» на витрине.\n' +
          'Например: <i>+7 962 402-51-75</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true, mandatory: false
  },
  telegram: {
    text: '✅ <b>Шаг 7 из 9. Ваш юзернейм в Telegram</b>' +
          '\n\n' +
          'Клиенты будут писать вам, нажав кнопку ' +
          'на витрине.\nПришлите без @.\n\n' +
          'Например: если ваш юзернейм @KupidonAdm — ' +
          'напишите <code>KupidonAdm</code>\n\n' +
          '<i>Если у вас нет юзернейма — можно ' +
          'пропустить, и клиенты смогут только ' +
          'позвонить или написать в WhatsApp.</i>',
    skip: true, mandatory: false
  },
  whatsapp: {
    text: '✅ <b>Шаг 8 из 9. Номер WhatsApp</b>\n\n' +
          'Клиенты смогут написать вам одним ' +
          'нажатием.\n' +
          'Например: <i>+7 962 402-51-75</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true, mandatory: false
  },
  max: {
    text: '✅ <b>Шаг 9 из 9. Ссылка на профиль в MAX</b>' +
          '\n\n' +
          '<i>Можно пропустить и добавить позже — ' +
          '«Меню» → «🏪 Данные магазина».</i>\n\n' +
          'Она начинается с ' +
          '<code>https://max.ru/u/...</code>\n\n' +
          'Пришлите её сюда или нажмите «Пропустить».',
    skip: true, mandatory: false
  }
};

const REG_ORDER = [
  'shopId', 'displayName', 'country', 'address', 'hours',
  'phone', 'telegram', 'whatsapp', 'max'
];

function buildRegFinalText(shopId, displayName) {
  const link = SITE_URL + '/shop/' + shopId;
  let t = '🎉 <b>Готово! Ваша витрина создана.</b>\n\n';
  t += '🏪 Магазин: «' + esc(displayName) + '»\n\n';
  t += '🔗 <b>Ссылка для клиентов:</b>\n' + link + '\n\n';
  t += '━━━━━━━━━━━━━━━\n\n';
  t += '📷 <b>Что делать дальше:</b>\n\n';
  t += '1. Нажмите «📷 Добавить букет» и отправьте ' +
       'фото с подписью.\n\n';
  t += '2. В подписи: название + пробел + цена.\n';
  t += '   ✅ <code>31 роза 3500</code>\n';
  t += '   ✅ <code>Пионы 4500</code>\n';
  t += '   ❌ <code>31 роза 3500 сорт Аваланж цена</code>\n';
  t += '      (цена должна быть последней)\n\n';
  t += '3. Букет сразу появится на витрине.\n\n';
  t += '4. Через 3 дня бот напомнит — надо будет ' +
       'подтвердить, что он ещё есть.\n\n';
  t += '━━━━━━━━━━━━━━━\n\n';
  t += '⚙️ Чтобы заполнить адрес, телефон и другое — ' +
       '«Меню» → «🏪 Данные магазина»\n\n';
  t += '💡 Если что-то непонятно — напишите ' +
       '<code>/help</code>.\n\n';
  t += '<b>Попробуйте прямо сейчас — отправьте ' +
       'первый букет.</b>';
  return t;
}

function buildCountrySelect() {
  const rows = [];
  for (let i = 0; i < COUNTRIES.length; i += 2) {
    const row = [];
    row.push({
      text: COUNTRIES[i].label,
      callback_data: 'reg_country_' + COUNTRIES[i].code
    });
    if (i + 1 < COUNTRIES.length) {
      row.push({
        text: COUNTRIES[i + 1].label,
        callback_data: 'reg_country_' + COUNTRIES[i + 1].code
      });
    }
    rows.push(row);
  }
  rows.push([{
    text: '⏭ Пропустить',
    callback_data: 'reg_skip'
  }]);
  return {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  };
}async function generateUniqueShopId() {
  for (let i = 0; i < 20; i++) {
    const id = generateShopId();
    if (!(await getShopFromDb(id))) return id;
  }
  return generateShopId() +
    Date.now().toString(36).slice(-4);
}

async function sendRegistrationStep(chatId, state) {
  const cfg = REG_STEPS[state.step];
  if (!cfg) {
    delete registrationState[chatId];
    return;
  }
  if (state.step === 'country') {
    const msg = await bot.sendMessage(
      chatId, cfg.text, buildCountrySelect()
    );
    state.messageId = msg.message_id;
    return;
  }
  const opts = { parse_mode: 'HTML' };
  if (cfg.skip) {
    opts.reply_markup = {
      inline_keyboard: [[{
        text: '⏭ Пропустить',
        callback_data: 'reg_skip'
      }]]
    };
  }
  const msg = await bot.sendMessage(chatId, cfg.text, opts);
  state.messageId = msg.message_id;
}

async function startRegistration(chatId, userName, userUsername) {
  const existing = userToShop[chatId] ||
    await findUserShop(chatId);
  if (existing) {
    return sendNav(
      chatId, '❌ Уже привязаны к магазину.'
    );
  }
  registrationState[chatId] = {
    step: 'shopId',
    data: {},
    messageId: null,
    userName: userName || null,
    userUsername: userUsername || null
  };
  await sendRegistrationStep(
    chatId, registrationState[chatId]
  );
}

async function regGoToNextStep(chatId, state) {
  const idx = REG_ORDER.indexOf(state.step);
  if (idx === -1 || idx >= REG_ORDER.length - 1) {
    return regFinish(chatId, state);
  }
  state.step = REG_ORDER[idx + 1];
  await sendRegistrationStep(chatId, state);
}

async function regSkipCurrentStep(chatId, state) {
  if (state.step === 'shopId') {
    state.data.shopId = await generateUniqueShopId();
  }
  await regGoToNextStep(chatId, state);
}

async function regSaveValue(chatId, state, text) {
  const step = state.step;
  const value = text.trim();

  if (step === 'shopId') {
    const clean = value.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    if (!clean || clean.length < 2) {
      return bot.sendMessage(chatId,
        '❌ Только латинские буквы, цифры и _ ' +
        '(минимум 2 символа). Попробуйте ещё раз ' +
        'или нажмите «Пропустить».',
        { parse_mode: 'HTML' }
      );
    }
    if (await getShopFromDb(clean)) {
      return bot.sendMessage(chatId,
        '❌ Это имя уже занято. Попробуйте другое ' +
        'или нажмите «Пропустить».',
        { parse_mode: 'HTML' }
      );
    }
    state.data.shopId = clean;
  } else if (step === 'displayName') {
    if (value.length < 2 || value.length > 60) {
      return bot.sendMessage(chatId,
        '❌ Название должно быть от 2 до 60 символов. ' +
        'Попробуйте ещё раз.'
      );
    }
    state.data.displayName = value;
  } else if (step === 'country') {
    return;
  } else if (step === 'address') {
    state.data.address = value;
  } else if (step === 'hours') {
    state.data.hours = value;
  } else if (step === 'phone') {
    const norm = normalizePhone(value);
    if (!norm) {
      return bot.sendMessage(chatId,
        '❌ Похоже на опечатку. Пришлите номер ' +
        'целиком.\nНапример: <i>+7 962 402-51-75</i>' +
        '\n\nИли нажмите «Пропустить».',
        { parse_mode: 'HTML' }
      );
    }
    state.data.phone = norm;
  } else if (step === 'telegram') {
    const clean = value.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      return bot.sendMessage(chatId,
        '❌ Юзернейм — только латиница, цифры, _ ' +
        '(от 3 до 32 символов). Попробуйте ещё ' +
        'раз или нажмите «Пропустить».',
        { parse_mode: 'HTML' }
      );
    }
    state.data.telegramUsername = clean;
  } else if (step === 'whatsapp') {
    const norm = normalizePhone(value);
    if (!norm) {
      return bot.sendMessage(chatId,
        '❌ Похоже на опечатку. Пришлите номер ' +
        'целиком.\nНапример: <i>+7 962 402-51-75</i>' +
        '\n\nИли нажмите «Пропустить».',
        { parse_mode: 'HTML' }
      );
    }
    state.data.whatsappPhone = norm;
  } else if (step === 'max') {
    if (!/^https?:\/\/max\.ru\//.test(value)) {
      return bot.sendMessage(chatId,
        '❌ Ссылка должна начинаться с ' +
        '<code>https://max.ru/u/...</code>\n\n' +
        'Попробуйте ещё раз или нажмите «Пропустить».',
        { parse_mode: 'HTML' }
      );
    }
    state.data.maxLink = value;
  }

  await regGoToNextStep(chatId, state);
}

async function regFinish(chatId, state) {
  const d = state.data;
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setMonth(
    trialEnd.getMonth() + PRESET_SHOP.trialMonths
  );
  const inviteCode = generateInviteCode();
  const userName = state.userName || 'Владелец';

  // Определяем валюту по стране
  let defaultCurrency = 'RUB';
  if (d.country === 'KZ') defaultCurrency = 'KZT';
  else if (d.country === 'BY') defaultCurrency = 'BYN';
  else if (d.country === 'UZ') defaultCurrency = 'UZS';

  try {
    await createShopInDb({
      shopId: d.shopId,
      name: d.shopId,
      displayName: d.displayName,
      address: d.address || null,
      hours: d.hours || null,
      phone: d.phone || null,
      telegramUsername: d.telegramUsername || null,
      whatsappPhone: d.whatsappPhone || null,
      maxLink: d.maxLink || null,
      inviteCode,
      trialStart: now.toISOString(),
      trialEnd: trialEnd.toISOString(),
      country: d.country || null,
      settings: {
        logo: null,
        cover: null,
        background: { type: 'preset', id: 1 },
        buttonColor: 'red',
        currency: defaultCurrency,
        markupPercent: 20,
        aiEnabled: false
      },
      stats: {
        views: 0, orders: 0, calls: 0,
        startedAt: now.toISOString()
      }
    });
    await addAdminToDb(chatId, d.shopId, 'owner', userName);
    await setUserOnShift(chatId, d.shopId, true);
    userToShop[chatId] = d.shopId;

    // Запускаем онбординг владельца
    await setOwnerOnboardingStep(d.shopId, 'add_bouquet');

    delete registrationState[chatId];
    const shop = await getShopFromDb(d.shopId);
    await bot.sendMessage(
      chatId,
      buildRegFinalText(d.shopId, d.displayName),
      { parse_mode: 'HTML' }
    );

    setTimeout(function() {
      sendVisualReminder(chatId, d.shopId);
    }, 2500);

    if (OWNER_CHAT_ID && OWNER_CHAT_ID !== chatId) {
      const tgRef = state.userUsername
        ? '@' + state.userUsername
        : 'chat_id ' + chatId;
      const link = SITE_URL + '/shop/' + d.shopId;
      const countryLabel = findCountryByCode(d.country);
      const cLabel = countryLabel
        ? countryLabel.label
        : '—';
      let adminTxt = '';
      adminTxt += '🎉 <b>Новый магазин зарегистрирован!</b>';
      adminTxt += '\n\n';
      adminTxt += '🏪 «' + esc(d.displayName) + '»\n';
      adminTxt += '🆔 <code>' + esc(d.shopId) + '</code>\n';
      adminTxt += '🌍 ' + esc(cLabel) + '\n';
      adminTxt += '👤 ' + esc(userName) + ' ';
      adminTxt += '(' + esc(tgRef) + ')\n\n';
      adminTxt += '🔗 ' + link + '\n\n';
      adminTxt += '<i>Открыть админ-панель — /admin</i>';
      bot.sendMessage(
        OWNER_CHAT_ID, adminTxt, { parse_mode: 'HTML' }
      ).catch(function(){});
    }
    return;
  } catch (e) {
    console.error(
      'Ошибка создания магазина:', e?.message || e
    );
    delete registrationState[chatId];
    return bot.sendMessage(chatId,
      '❌ Ошибка при создании магазина. ' +
      'Попробуйте ещё раз /register.'
    );
  }
}

// ========== НАПОМИНАНИЕ ПРО ЛОГО+ФОН+ЦВЕТ ==========
async function sendVisualReminder(chatId, shopId) {
  try {
    const shop = await getShopFromDb(shopId);
    if (!shop) return;
    const hasCover = !!shop.settings.cover;
    if (hasAnyLogo(shop) && hasAnyBackground(shop) && hasCover) {
      return;
    }

    let missing = [];
    if (!hasAnyBackground(shop)) missing.push('фон');
    if (!hasAnyLogo(shop)) missing.push('логотип');
    if (!hasCover) missing.push('обложку');

    let txt = '🎨 <b>Последний штрих</b>\n\n';
    txt += 'Витрина работает, но пока выглядит ';
    txt += 'просто.\n\n';
    txt += 'Чтобы она стала похожа на фирменный ';
    txt += 'магазин:\n\n';
    txt += '1. 🖼 Фон — 10 готовых, в 1 тап\n';
    txt += '2. 🎨 Логотип — ваша вывеска\n';
    txt += '3. 🖼 Обложка — картинка над названием\n';
    txt += '4. 🔘 Цвет кнопки «Связаться»\n\n';
    if (missing.length > 0) {
      txt += '<i>Сейчас не хватает: ' +
        missing.join(', ') + '.</i>\n\n';
    }
    txt += '<i>Можно сделать позже — витрина уже работает.</i>';

    await bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🖼 Настроить витрину',
            callback_data: 'menu_background'
          }],
          [{
            text: '⏭ Позже',
            callback_data: 'visual_later'
          }]
        ]
      }
    });
    visualReminderSent[shopId] = Date.now();
  } catch (e) {
    console.error(
      'Ошибка sendVisualReminder:', e?.message || e
    );
  }
}

// ========== АДМИН-ПАНЕЛЬ ==========
async function showAdminPanel(chatId, editMessageId) {
  const shops = await getAllShopsAdmin();
  const total = shops.length;
  const now = Date.now();
  const activeTrials = shops.filter(
    s => s.trialEnd &&
      new Date(s.trialEnd).getTime() > now
  ).length;
  const expired = total - activeTrials;
  const blocked = shops.filter(s => s.blocked).length;
  const totalBouquets = shops.reduce(
    (sum, s) => sum + s.bouquetsCount, 0
  );
  const totalOrders = shops.reduce(
    (sum, s) => sum + s.orders, 0
  );
  const totalCalls = shops.reduce(
    (sum, s) => sum + s.calls, 0
  );

  let txt = '🛡 <b>Админ-панель Flowind</b>\n\n';
  txt += '🏪 Всего магазинов: <b>' + total + '</b>\n';
  txt += '🟢 Активный триал: <b>' + activeTrials + '</b>\n';
  txt += '🔴 Истёк триал: <b>' + expired + '</b>\n';
  if (blocked > 0) {
    txt += '🚫 Заблокировано: <b>' + blocked + '</b>\n';
  }
  txt += '\n📦 Букетов на витринах: <b>' +
    totalBouquets + '</b>\n';
  txt += '📩 Заявок (сообщения): <b>' +
    totalOrders + '</b>\n';
  txt += '📞 Заявок (звонки): <b>' +
    totalCalls + '</b>';

  const buttons = [
    [{
      text: '🏪 Список магазинов',
      callback_data: 'admin_shops_0'
    }],
    [{
      text: '🔄 Обновить',
      callback_data: 'admin_refresh'
    }]
  ];

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: editMessageId,
        ...opts
      });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return bot.sendMessage(chatId, txt, opts);
}

async function showAdminShopsList(chatId, page, editMessageId) {
  const currentPage = page || 0;
  const shops = await getAllShopsAdmin();
  const totalPages = Math.max(
    1,
    Math.ceil(shops.length / ADMIN_SHOP_PER_PAGE)
  );
  const safePage = Math.max(
    0, Math.min(currentPage, totalPages - 1)
  );
  const start = safePage * ADMIN_SHOP_PER_PAGE;
  const slice = shops.slice(
    start, start + ADMIN_SHOP_PER_PAGE
  );

  let txt = '🏪 <b>Магазины</b> (' + shops.length + ')\n';
  if (totalPages > 1) {
    txt += 'Страница ' + (safePage + 1) +
      ' из ' + totalPages + '\n';
  }
  txt += '\n<i>Тапните на магазин для подробностей.</i>';

  const rows = [];
  const now = Date.now();
  for (const s of slice) {
    let emoji = '⚪';
    if (s.blocked) emoji = '🚫';
    else if (s.trialEnd) {
      const daysLeft = Math.ceil(
        (new Date(s.trialEnd).getTime() - now) /
        (24 * 60 * 60 * 1000)
      );
      if (daysLeft <= 0) emoji = '🔴';
      else if (daysLeft <= 7) emoji = '🟡';
      else emoji = '🟢';
    }
    const country = findCountryByCode(s.country);
    const flag = country
      ? country.label.split(' ')[0]
      : '';
    const name = shortName(
      s.displayName || s.shopId, 20
    );
    const label = flag
      ? flag + ' ' + emoji + ' ' + name
      : emoji + ' ' + name;
    rows.push([{
      text: label,
      callback_data: 'admin_shop_' + s.shopId
    }]);
  }

  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) {
      nav.push({
        text: '⬅️ Назад',
        callback_data: 'admin_shops_' + (safePage - 1)
      });
    }
    nav.push({
      text: (safePage + 1) + ' / ' + totalPages,
      callback_data: 'noop'
    });
    if (safePage < totalPages - 1) {
      nav.push({
        text: 'Дальше ➡️',
        callback_data: 'admin_shops_' + (safePage + 1)
      });
    }
    rows.push(nav);
  }

  rows.push([{
    text: '⬅️ Назад',
    callback_data: 'admin_main'
  }]);

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: editMessageId,
        ...opts
      });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return bot.sendMessage(chatId, txt, opts);
}

async function showAdminShopCard(chatId, shopId, editMessageId) {
  const shop = await getShopFromDb(shopId);
  if (!shop) {
    try {
      await bot.editMessageText(
        '❌ Магазин не найден.',
        { chat_id: chatId, message_id: editMessageId }
      );
    } catch (e) { /* ignore */ }
    return;
  }

  const all = await getBouquetsFromDb(shopId, false);
  const active = all.filter(isConfirmedRecently);
  const stats = shop.stats || {};
  const orders = stats.orders || 0;
  const calls = stats.calls || 0;
  const owner = shop.admins.find(a => a.role === 'owner');
  const florists = shop.admins.filter(
    a => a.role !== 'owner'
  );

  const days = getRemainingDays(shop);
  let trialStatus = days > 0
    ? '🟢 ' + days + ' дней'
    : '🔴 истёк';
  if (shop.blocked) trialStatus = '🚫 ЗАБЛОКИРОВАН';

  let txt = '🏪 <b>' + esc(shop.displayName) + '</b>\n';
  txt += '<code>' + esc(shop.shopId) + '</code>\n\n';

  const country = findCountryByCode(shop.country);
  if (country) {
    txt += '🌍 ' + country.label + '\n\n';
  }

  if (shop.blocked && shop.blockedReason) {
    txt += '🚫 <b>Причина блокировки:</b>\n';
    txt += '<i>' + esc(shop.blockedReason) + '</i>\n\n';
  }

  if (owner) {
    txt += '👑 Владелец: <b>';
    txt += esc(owner.name || 'Флорист') + '</b>\n';
    txt += '🆔 <code>' + owner.chatId + '</code>\n';
    if (shop.telegramUsername) {
      txt += '💬 @' + esc(shop.telegramUsername) + '\n';
    }
    if (shop.phone) {
      txt += '📞 ' + esc(formatPhone(shop.phone)) + '\n';
    }
  } else {
    txt += '⚠️ Владелец не найден\n';
  }

  if (florists.length > 0) {
    const names = florists
      .map(f => esc(f.name || 'без имени'))
      .join(', ');
    txt += '\n👥 Флористы (' + florists.length + '): ';
    txt += names + '\n';
  } else {
    txt += '\n👥 Флористы: <i>нет</i>\n';
  }

  txt += '\n📦 На витрине: <b>' + active.length + '</b>';
  txt += ' из ' + all.length + '\n';
  txt += '📅 Триал: ' + trialStatus + '\n\n';
  txt += '📊 <b>Заявки:</b>\n';
  txt += '📩 Сообщения: ' + orders + '\n';
  txt += '📞 Звонки: ' + calls + '\n';

  const buttons = [
    [{
      text: '⏱ Продлить на 7 дней',
      callback_data: 'admin_extend_7_' + shop.shopId
    }],
    [{
      text: '⏱ Продлить на 30 дней',
      callback_data: 'admin_extend_30_' + shop.shopId
    }],
    [{
      text: '⏱ Продлить на 90 дней',
      callback_data: 'admin_extend_90_' + shop.shopId
    }],
    [{
      text: '💬 Написать владельцу',
      callback_data: 'admin_msg_' + shop.shopId
    }],
    [shop.blocked
      ? {
          text: '✅ Разблокировать',
          callback_data: 'admin_unblock_' + shop.shopId
        }
      : {
          text: '🚫 Заблокировать',
          callback_data: 'admin_block_' + shop.shopId
        }],
    [{
      text: '🛒 Открыть витрину',
      url: SITE_URL + '/shop/' + shop.shopId
    }],
    [{
      text: '⬅️ К списку',
      callback_data: 'admin_shops_0'
    }]
  ];

  try {
    await bot.editMessageText(txt, {
      chat_id: chatId,
      message_id: editMessageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (e) { /* ignore */ }
}

// ========== /start ==========
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match && match[1]
    ? match[1].trim() : null;
  const userName = msg.from.first_name || 'Флорист';

  delete archiveSessions[chatId];

  if (param && param.startsWith('inv_')) {
    const inviteCode = param.replace('inv_', '').toUpperCase();
    const shopId = await getShopByInvite(inviteCode);
    if (shopId) {
      const shop = await getShopFromDb(shopId);
      if (shop && shop.blocked) {
        return bot.sendMessage(chatId,
          '🚫 Этот магазин заблокирован. ' +
          'Напишите @floop10.'
        );
      }
      const currentShop = await findUserShop(chatId);
      if (currentShop && currentShop !== shopId) {
        return bot.sendMessage(chatId,
          '❌ Вы уже привязаны к другому магазину.'
        );
      }

      const existing = await getFloristOnboardingState(
        chatId, shopId
      );

      await addAdminToDb(
        chatId, shopId, 'florist', userName
      );
      userToShop[chatId] = shopId;

      if (!existing || !existing.passed) {
        await setFloristOnboardingStep(
          chatId, shopId, 'add_bouquet'
        );
      }

      const updatedShop = await getShopFromDb(shopId);
      let invText = '🎉 Добро пожаловать в команду «';
      invText += esc(shop.displayName) + '»!\n\n';
      invText += '📷 Добавляйте букеты: фото с подписью ';
      invText += '«Название цена».\n';
      invText += '✅ Подтверждайте наличие через ';
      invText += '«Что в наличии?».\n\n';
      invText += '<i>💡 Чтобы получать уведомления ';
      invText += 'о клиентах, нажмите ';
      invText += '«✅ Я сегодня работаю» в меню.</i>';
      await bot.sendMessage(chatId, invText, {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(updatedShop, chatId)
      });

      // Запускаем онбординг флориста
      if (!existing || !existing.passed) {
        setTimeout(function() {
          sendFloristOnboardingStep(chatId, shopId);
        }, 1500);
      }
      return;
    }
    return bot.sendMessage(
      chatId, '❌ Приглашение недействительно.'
    );
  }

  let shopId = userToShop[chatId] ||
    await findUserShop(chatId);

  if (!shopId) {
    if (OWNER_CHAT_ID && chatId === OWNER_CHAT_ID) {
      const presetShop = await getShopFromDb(
        PRESET_SHOP.shopId
      );
      if (presetShop && presetShop.admins.length === 0) {
        await addAdminToDb(
          chatId, PRESET_SHOP.shopId, 'owner', userName
        );
        await setUserOnShift(
          chatId, PRESET_SHOP.shopId, true
        );
        userToShop[chatId] = PRESET_SHOP.shopId;
        shopId = PRESET_SHOP.shopId;
      }
    }
  }

  if (shopId) {
    const shop = await getShopFromDb(shopId);
    if (!shop) {
      return bot.sendMessage(chatId, '❌ Магазин не найден.');
    }
    userToShop[chatId] = shopId;

    if (shop.blocked) {
      let blockText = '🚫 <b>Магазин заблокирован</b>\n\n';
      if (shop.blockedReason) {
        blockText += 'Причина: <i>' +
          esc(shop.blockedReason) + '</i>\n\n';
      }
      blockText += 'Для разблокировки напишите: @floop10';
      return bot.sendMessage(chatId, blockText, {
        parse_mode: 'HTML'
      });
    }

    if (!isSubscriptionActive(shop)) {
      let subText = '⏳ <b>Подписка истекла</b>\n\n';
      subText += 'Магазин «' + esc(shop.displayName) + '» ';
      subText += 'приостановлен. Витрина не показывается ';
      subText += 'клиентам, букеты не добавляются.\n\n';
      subText += 'Для продления напишите: @floop10';
      return bot.sendMessage(chatId, subText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '💳 Продлить',
            callback_data: 'menu_renew'
          }]]
        }
      });
    }

    const owner = isOwner(shop, chatId);
    const me = shop.admins.find(a => a.chatId === chatId);
    const onShift = !!(me && me.onShift);

    let txt = '🌸 «' + esc(shop.displayName) + '»\n\n';
    if (owner) txt += '👑 Вы — владелец.\n';
    else txt += '🌸 Вы — флорист.\n';
    if (onShift) {
      txt += '🟢 Вы <b>на смене</b>.\n\n';
    } else {
      txt += '⚪ Вы <b>не на смене</b>. Нажмите ';
      txt += '«✅ Я сегодня работаю», чтобы получать ';
      txt += 'уведомления о клиентах.\n\n';
    }
    txt += 'Меню — внизу под полем ввода.';
    return bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }

  let welcome = '🌸 <b>Добро пожаловать в Flowind!</b>';
  welcome += '\n\n';
  welcome += 'Это витрина для цветочных магазинов.\n';
  welcome += 'Флорист добавляет букет через бота — ';
  welcome += 'он сразу появляется на витрине.\n';
  welcome += 'Клиент видит витрину и пишет вам ';
  welcome += 'в мессенджер.\n\n';
  welcome += 'Если вы флорист — нажмите ';
  welcome += '«Создать магазин», и через минуту ';
  welcome += 'у вас будет своя витрина.\n\n';
  welcome += 'Если вас пригласил владелец магазина — ';
  welcome += 'просто откройте ссылку, которую ';
  welcome += 'он прислал.';
  return bot.sendMessage(chatId, welcome, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: '➕ Создать магазин',
        callback_data: 'welcome_create'
      }]]
    }
  });
});

// ========== /admin ==========
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isServiceAdmin(chatId)) return;
  return showAdminPanel(chatId);
});

// ========== /help ==========
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const menu = buildHelpMenu();
  return bot.sendMessage(chatId, menu.text, menu.options);
});

// ========== ОБНОВЛЕНИЕ СПИСКА ПРОВЕРКИ ==========
async function refreshCheckList(chatId, session) {
  const total = session.bouquets.length;
  const done = Object.keys(session.checked).length;
  if (done >= total) {
    delete checkSessions[chatId];
    const word = plural(total, 'букет', 'букета', 'букетов');
    try {
      await bot.editMessageText(
        '🎉 <b>Проверка завершена!</b>\n\n' +
        'Все ' + total + ' ' + word + ' проверены.',
        {
          chat_id: chatId,
          message_id: session.listMessageId,
          parse_mode: 'HTML'
        }
      );
    } catch (e) {
      bot.sendMessage(
        chatId,
        '🎉 Проверка завершена! Все ' + total +
        ' букетов проверены.',
        { parse_mode: 'HTML' }
      ).catch(function(){});
    }
    return;
  }
  const txt = buildCheckListText(session);
  const kb = {
    inline_keyboard: buildCheckListKeyboard(session)
  };
  try {
    await bot.editMessageText(txt, {
      chat_id: chatId,
      message_id: session.listMessageId,
      parse_mode: 'HTML',
      reply_markup: kb
    });
  } catch (e) {
    try {
      const msg = await bot.sendMessage(chatId, txt, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
      session.listMessageId = msg.message_id;
    } catch (e2) { /* ignore */ }
  }
}

// ========== CALLBACK (начало) ==========
bot.on('callback_query', async (q) => {
  const chatId = q.from.id;
  const data = q.data;
  bot.answerCallbackQuery(q.id).catch(function(){});

  if (checkSessions[chatId]) {
    checkSessions[chatId].lastActivity = Date.now();
  }

  if (data === 'welcome_create') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return startRegistration(
      chatId, q.from.first_name, q.from.username
    );
  }

  if (data === 'reg_skip') {
    const state = registrationState[chatId];
    if (!state) {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return regSkipCurrentStep(chatId, state);
  }

  if (data.startsWith('reg_country_')) {
    const code = data.replace('reg_country_', '');
    const state = registrationState[chatId];
    if (!state) {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    state.data.country = code;
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return regGoToNextStep(chatId, state);
  }

  if (data === 'visual_later') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return;
  }

  // ========== HELP ==========
  if (data === 'help_menu' || data === 'help_back') {
    const menu = buildHelpMenu();
    try {
      await bot.editMessageText(menu.text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        ...menu.options
      });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data === 'help_close') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return;
  }
  if (data === 'help_guide') {
    const g = buildHelpGuide();
    try {
      await bot.editMessageText(g.text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        ...g.options
      });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data === 'help_faq') {
    const f = buildHelpFAQ();
    try {
      await bot.editMessageText(f.text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        ...f.options
      });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data === 'help_support') {
    const s = buildHelpSupport();
    try {
      await bot.editMessageText(s.text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        ...s.options
      });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data.startsWith('faq_')) {
    const ans = buildFaqAnswer(data);
    if (!ans) return;
    try {
      await bot.editMessageText(ans.text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        ...ans.options
      });
    } catch (e) { /* ignore */ }
    return;
  }

  // ========== АДМИН-ПАНЕЛЬ ==========
  if (data.startsWith('admin_') && isServiceAdmin(chatId)) {
    if (data === 'admin_main' || data === 'admin_refresh') {
      return showAdminPanel(chatId, q.message.message_id);
    }
    if (data.startsWith('admin_shops_')) {
      const page = parseInt(
        data.replace('admin_shops_', '')
      ) || 0;
      return showAdminShopsList(
        chatId, page, q.message.message_id
      );
    }
    if (data.startsWith('admin_shop_')) {
      const targetShopId = data.replace('admin_shop_', '');
      return showAdminShopCard(
        chatId, targetShopId, q.message.message_id
      );
    }
    if (data.startsWith('admin_extend_')) {
      const rest = data.replace('admin_extend_', '');
      const firstUnderscore = rest.indexOf('_');
      const days = parseInt(
        rest.slice(0, firstUnderscore)
      );
      const targetShopId = rest.slice(firstUnderscore + 1);
      if (!days || !targetShopId) return;
      await extendShopTrial(targetShopId, days);
      await bot.answerCallbackQuery(q.id, {
        text: '✅ Продлено на ' + days + ' дней',
        show_alert: false
      }).catch(function(){});
      return showAdminShopCard(
        chatId, targetShopId, q.message.message_id
      );
    }
    if (data.startsWith('admin_msg_')) {
      const targetShopId = data.replace('admin_msg_', '');
      const targetShop = await getShopFromDb(targetShopId);
      if (!targetShop) return;
      const targetOwner = targetShop.admins.find(
        a => a.role === 'owner'
      );
      if (!targetOwner) {
        return bot.sendMessage(chatId,
          '❌ У этого магазина нет владельца.'
        );
      }
      awaitingAdminMessage[chatId] = {
        targetChatId: targetOwner.chatId,
        targetName: targetOwner.name || 'Флорист',
        shopId: targetShopId
      };
      let askTxt = '💬 Напишите сообщение для <b>';
      askTxt += esc(targetOwner.name || 'Флориста');
      askTxt += '</b> (магазин «';
      askTxt += esc(targetShop.displayName) + '»).\n\n';
      askTxt += 'Он получит его от бота Flowind.\n\n';
      askTxt += '<i>Отмена — /cancel</i>';
      return bot.sendMessage(chatId, askTxt, {
        parse_mode: 'HTML'
      });
    }
    if (data.startsWith('admin_block_')) {
      const targetShopId = data.replace('admin_block_', '');
      const targetShop = await getShopFromDb(targetShopId);
      if (!targetShop) return;
      awaitingAdminBlockReason[chatId] = {
        shopId: targetShopId
      };
      let bTxt = '🚫 <b>Блокировка магазина</b>\n\n';
      bTxt += 'Магазин «' + esc(targetShop.displayName);
      bTxt += '»\n\n';
      bTxt += 'Напишите <b>причину блокировки</b> — ';
      bTxt += 'она будет показана владельцу, когда ';
      bTxt += 'он напишет в бот.\n\n';
      bTxt += '<i>Отмена — /cancel</i>';
      return bot.sendMessage(chatId, bTxt, {
        parse_mode: 'HTML'
      });
    }
    if (data.startsWith('admin_unblock_')) {
      const targetShopId = data.replace(
        'admin_unblock_', ''
      );
      await unblockShop(targetShopId);
      const shop = await getShopFromDb(targetShopId);
      const owner = shop.admins.find(
        a => a.role === 'owner'
      );
      if (owner) {
        let okTxt = '✅ <b>Магазин разблокирован</b>\n\n';
        okTxt += '«' + esc(shop.displayName) + '» ';
        okTxt += 'снова работает.';
        bot.sendMessage(owner.chatId, okTxt, {
          parse_mode: 'HTML'
        }).catch(function(){});
      }
      return showAdminShopCard(
        chatId, targetShopId, q.message.message_id
      );
    }
  }

  const shopId = userToShop[chatId] ||
    await findUserShop(chatId);
  if (!shopId) return;
  const shop = await getShopFromDb(shopId);
  if (!shop) return;
  const owner = isOwner(shop, chatId);// ========== МОИ БУКЕТЫ ==========
  if (data === 'mb_close') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return bot.sendMessage(chatId, '🏠 Главное меню', {
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }
  if (data === 'mb_back') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return buildMyBouquetsMenu(chatId, shopId);
  }
  if (data === 'mb_search') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    awaitingSearch[chatId] = true;
    return buildSearchPrompt(chatId);
  }
  if (data === 'mb_archive') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return buildArchiveModeSelection(chatId, shopId);
  }
  if (data.startsWith('mb_active_')) {
    const page = parseInt(
      data.replace('mb_active_', '')
    ) || 0;
    return showActiveBouquetsList(
      chatId, shopId, page, q.message.message_id
    );
  }

  // ========== РЕЗУЛЬТАТЫ ПОИСКА ==========
  if (data === 'sres_restore_all') {
    const session = searchSessions[chatId];
    if (!session) {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return sendNav(chatId,
        '⚠️ Поиск устарел. Откройте «✏️ Мои букеты» заново.'
      );
    }
    const hidden = session.results.filter(
      b => b.hidden || !isConfirmedRecently(b)
    );
    if (hidden.length === 0) {
      return bot.answerCallbackQuery(q.id, {
        text: 'Уже всё на витрине',
        show_alert: false
      }).catch(function(){});
    }
    const nowIso = new Date().toISOString();
    for (const b of hidden) {
      await updateBouquetFields(b.id, {
        hidden: false,
        confirmed_at: nowIso,
        reminded: false
      });
    }
    for (const b of session.results) {
      b.hidden = false;
      b.confirmedAt = nowIso;
      b.reminded = false;
    }
    await bot.answerCallbackQuery(q.id, {
      text: '✅ Вернули ' + hidden.length + ' шт.',
      show_alert: false
    }).catch(function(){});
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return renderSearchResults(
      chatId, shopId, session.query, session.results
    );
  }

  if (data.startsWith('sres_')) {
    const id = parseInt(data.replace('sres_', ''));
    if (!id || isNaN(id)) return;
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    return showBouquetCard(chatId, b, shopId);
  }

  // ========== СКАЧАТЬ ФОТО ==========
  if (data.startsWith('dlphoto_')) {
    const id = parseInt(data.replace('dlphoto_', ''));
    if (!id || isNaN(id)) return;
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    return sendBouquetPhotoAsFile(chatId, b);
  }

  // ========== УБРАТЬ / ВЕРНУТЬ ==========
  if (data.startsWith('hideit_')) {
    const id = parseInt(data.replace('hideit_', ''));
    if (!id || isNaN(id)) return;
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    await updateBouquetField(id, 'hidden', true);
    let t = '📥 Букет <b>№' + b.shopNumber + '</b> «';
    t += esc(b.name) + '» убран с витрины.\n\n';
    t += '<i>Клиенты его не видят. Вернуть можно ';
    t += 'из «📦 Архив».</i>';
    return bot.sendMessage(chatId, t, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }

  if (data.startsWith('unhide_')) {
    const id = parseInt(data.replace('unhide_', ''));
    if (!id || isNaN(id)) return;
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    await updateBouquetFields(id, {
      hidden: false,
      confirmed_at: new Date().toISOString(),
      reminded: false
    });
    let t = '✅ Букет <b>№' + b.shopNumber + '</b> «';
    t += esc(b.name) + '» снова на витрине.\n\n';
    t += '<i>Обновлён на 3 дня вперёд.</i>';
    return bot.sendMessage(chatId, t, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }

  // ========== АРХИВ ==========
  if (data === 'arch_mode_list') {
    const arch = await getArchivedBouquets(shopId);
    if (arch.length === 0) {
      bot.editMessageText('📦 Архив пуст.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      return;
    }
    archiveSessions[chatId] = {
      mode: 'list',
      bouquets: arch,
      page: 0,
      shopId,
      keyboardHidden: false
    };
    const sess = archiveSessions[chatId];
    if (!sess.keyboardHidden) {
      sess.keyboardHidden = true;
      bot.sendMessage(chatId,
        '📦 <i>Открываю архив — меню вернётся ' +
        'после закрытия.</i>',
        {
          parse_mode: 'HTML',
          reply_markup: { remove_keyboard: true }
        }
      ).catch(function(){});
    }
    return showArchiveList(
      chatId, sess, q.message.message_id
    );
  }

  if (data === 'arch_mode_card') {
    const arch = await getArchivedBouquets(shopId);
    if (arch.length === 0) {
      bot.editMessageText('📦 Архив пуст.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      return;
    }
    archiveSessions[chatId] = {
      mode: 'card',
      bouquets: arch,
      currentIndex: 0,
      shopId,
      keyboardHidden: false
    };
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showArchiveCard(
      chatId, archiveSessions[chatId]
    );
  }

  if (data.startsWith('arch_list_page_')) {
    const session = archiveSessions[chatId];
    if (!session || session.mode !== 'list') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    const newPage = parseInt(
      data.replace('arch_list_page_', '')
    ) || 0;
    session.page = newPage;
    return showArchiveList(
      chatId, session, q.message.message_id
    );
  }

  if (data.startsWith('arch_item_')) {
    const session = archiveSessions[chatId];
    if (!session || session.mode !== 'list') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    const itemId = parseInt(data.replace('arch_item_', ''));
    if (!itemId || isNaN(itemId)) return;
    return showArchiveItemCard(chatId, session, itemId);
  }

  if (data === 'arch_list_back') {
    const session = archiveSessions[chatId];
    if (!session || session.mode !== 'list') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showArchiveList(chatId, session);
  }

  if (data.startsWith('arch_del_')) {
    if (!owner) return;
    const id = parseInt(data.replace('arch_del_', ''));
    if (!id || isNaN(id)) return;
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    const session = archiveSessions[chatId];
    if (session) {
      session.bouquets = session.bouquets.filter(
        x => x.id !== id
      );
    }
    await updateBouquetField(id, 'deleted', true);
    bot.answerCallbackQuery(q.id, {
      text: '🗑 Удалён: №' + b.shopNumber,
      show_alert: false
    }).catch(function(){});
    if (session && session.mode === 'list') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      if (session.bouquets.length === 0) {
        delete archiveSessions[chatId];
        bot.sendMessage(chatId, '📦 Архив пуст.', {
          reply_markup: getMainKeyboard(shop, chatId)
        }).catch(function(){});
        return;
      }
      const totalPages = Math.max(
        1,
        Math.ceil(session.bouquets.length / LIST_PER_PAGE)
      );
      if (session.page >= totalPages) {
        session.page = totalPages - 1;
      }
      return showArchiveList(chatId, session);
    }
    if (session && session.mode === 'card') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      if (session.bouquets.length === 0) {
        delete archiveSessions[chatId];
        bot.sendMessage(chatId, '📦 Архив пуст.', {
          reply_markup: getMainKeyboard(shop, chatId)
        }).catch(function(){});
        return;
      }
      if (session.currentIndex >= session.bouquets.length) {
        session.currentIndex = session.bouquets.length - 1;
      }
      return showArchiveCard(chatId, session);
    }
    return;
  }

  if (data.startsWith('arch_restore_')) {
    const session = archiveSessions[chatId];
    const itemId = parseInt(data.replace('arch_restore_', ''));
    const b = session
      ? session.bouquets.find(x => x.id === itemId)
      : null;
    if (b) {
      await updateBouquetFields(b.id, {
        confirmed_at: new Date().toISOString(),
        hidden: false,
        reminded: false
      });
      session.bouquets = session.bouquets.filter(
        x => x.id !== itemId
      );
    }
    if (session && session.mode === 'list') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      if (session.bouquets.length === 0) {
        delete archiveSessions[chatId];
        bot.sendMessage(chatId, '📦 Архив пуст.', {
          reply_markup: getMainKeyboard(shop, chatId)
        }).catch(function(){});
        return;
      }
      const totalPages = Math.max(
        1,
        Math.ceil(session.bouquets.length / LIST_PER_PAGE)
      );
      if (session.page >= totalPages) {
        session.page = totalPages - 1;
      }
      return showArchiveList(chatId, session);
    }
    if (session && session.mode === 'card') {
      session.currentIndex++;
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return showArchiveCard(chatId, session);
    }
    return;
  }

  if (data === 'arch_next') {
    const session = archiveSessions[chatId];
    if (!session || session.mode !== 'card') {
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    session.currentIndex++;
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showArchiveCard(chatId, session);
  }

  if (data === 'arch_close') {
    delete archiveSessions[chatId];
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return bot.sendMessage(chatId, '📦 Архив закрыт.', {
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }

  // ========== ПАГИНАЦИЯ СПИСКОВ ==========
  if (data === 'bqlist_close') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return bot.sendMessage(chatId, '🏠 Главное меню', {
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }
  if (data.startsWith('bqlist_')) {
    const rest = data.replace('bqlist_', '');
    const lastUnderscore = rest.lastIndexOf('_');
    const action = rest.slice(0, lastUnderscore);
    const page = parseInt(
      rest.slice(lastUnderscore + 1)
    ) || 0;
    const headers = {
      editprice: '✏️ <b>Какой букет изменить цену?</b>\n' +
        'Нажмите на кнопку с номером.',
      rename: '📝 <b>Какой букет переименовать?</b>\n' +
        'Нажмите на кнопку с номером.',
      askdel: '🗑 <b>Какой букет удалить?</b>\n' +
        'Нажмите на кнопку с номером.'
    };
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showBouquetList(
      chatId, shopId, action, headers[action] || '', page
    );
  }// ========== МЕНЮ / НАСТРОЙКИ ==========
  if (data === 'noop') return;
  if (data === 'menu_close') {
    delete checkSessions[chatId];
    delete archiveSessions[chatId];
    delete searchSessions[chatId];
    return bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
  }
  if (data === 'menu_back') {
    if (!owner) return;
    delete archiveSessions[chatId];
    try {
      await bot.editMessageText(
        '⚙️ Настройки магазина:',
        {
          chat_id: chatId,
          message_id: q.message.message_id,
          ...getSettingsMenu(shop, chatId)
        }
      );
    } catch (e) { /* ignore */ }
    return;
  }
  if (data === 'menu_shopdata') {
    if (!owner) return;
    const { text, options } = buildShopDataMessage(shop);
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: q.message.message_id,
        ...options
      });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data.startsWith('edit_shop_')) {
    if (!owner) return;
    const field = data.replace('edit Ск_shop_', '');
опи    const prompts = {
      displaynameру: {
        q: '📝 Введите новое <йтеb> ссыназвание</b> ' +
           'магазина (как показывать клиентам).\n' +
           'Пример: <i>Цветы на Фрунзе</i>',
        field: 'display_name'
      },
      address: {
        q: '📍 Введите новый <b>адрес</b>.\n' +
           'Пример: <i>г. Москва, ул. Фрунзе, 15</i>\n' +
           '(или "нет", чтобы убрать)',
        field: 'address'
      },
      hours: {
        q: '🕐 Введите новые <b>часы работы</b>.\n' +
           'Пример: <i>Пн-Вс 10:30-21:00</i>\n' +
           '(или "нет", чтобы 
          убрать)',
        field: 'hours'
      },
      phone: {
        q: '📞 Введите новый <b>телефон</b> ' +
           'для кнопки «Позвонить».\n' +
           'Пример: <i>+7 962 402-51-75</i>\n' +
           '(или "нет", чтобы убрать)',
        field: 'phone'
      },
      telegram: {
        q: '📱 Введите <b>Telegram-юзернейм</b> ' +
           '(без @).\nПример: <i>KupidonAdm</i>\n' +
           '(или "нет", чтобы убрать)',
        field: 'telegram_username'
      },
      whatsapp: {
        q: '💬 Введите <b>номер WhatsApp</b>.\n' +
           'Пример: <i>+7 962 402-51-75</i>\n' +
           '(или "нет", чтобы убрать)',
        field: 'whatsapp_phone'
      },
      max: {
        q: '🅼 <b>Ссылка на профиль в MAX</b>\n\n' +
           '<b>Как получить:</b>\n' +
           '1. Откройте приложение MAX\n' +
           '2. Зайдите в свой профиль\n' +
           '3. Нажмите «Пригласить друзей»\n' +
           '4лку\n\n' +
           'Она начинается с ' +
           '<code>https://max.ru/u/...</code>\n\n' +
           'Пришлите её сюда целиком.\n' +
           '(или "нет", чтобы убрать)',
        field: 'max_username'
      }
    };
    const p = prompts[field];
    if (!p) return;
    awaitingInput[chatId] = {
      field: p.field,
      from: 'shopdata'
    };
    return bot.sendMessage(
      chatId,
      p.q + '\n\n<i>Отмена — /cancel</i>',
      { parse_mode: 'HTML' }
    );
  }

  // ========== ВАЛЮТА ==========
  if (data === 'menu_currency' ||
      data === 'edit_shop_currency') {
    if (!owner) return;
    const curCode = getShopCurrency(shop);
    const curObj = findCurrencyByCode(curCode);
    let txt = '💱 <b>Валюта магазина</b>\n\n';
    txt += 'Сейчас: <b>';
    txt += curObj
      ? curObj.label + ' (' + curObj.sym + ')'
      : '₽';
    txt += '</b>\n\n';
    txt += 'Цены на витрине будут показываться ';
    txt += 'с этим символом.\n\n';
    txt += '<i>Цены не пересчитываются — просто ';
    txt += 'меняется символ.</i>';
    const rows = [];
    for (let i = 0; i < CURRENCY_LIST.length; i += 2) {
      const row = [];
      const c1 = CURRENCY_LIST[i];
      row.push({
        text: c1.sym + ' ' + c1.label,
        callback_data: 'cur_set_' + c1.code
      });
      if (i + 1 < CURRENCY_LIST.length) {
        const c2 = CURRENCY_LIST[i + 1];
        row.push({
          text: c2.sym + ' ' + c2.label,
          callback_data: 'cur_set_' + c2.code
        });
      }
      rows.push(row);
    }
    rows.push([{
      text: '↩️ Назад',
      callback_data: 'menu_shopdata'
    }]);
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows }
      });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data.startsWith('cur_set_')) {
    if (!owner) return;
    const code = data.replace('cur_set_', '');
    const cur = findCurrencyByCode(code);
    if (!cur) return;
    shop.settings.currency = code;
    await saveShopSettings(shopId, shop.settings);
    let txt = '✅ Валюта обновлена!\n\n';
    txt += cur.sym + ' ' + cur.label + '\n\n';
    txt += 'Цены на витрине теперь показываются ';
    txt += 'с этим символом.';
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '🏠 Готово',
            callback_data: 'menu_close'
          }]]
        }
      });
    } catch (e) { /* ignore */ }
    return;
  }

  // ========== КОМАНДА ==========
  if (data === 'menu_invite') {
    if (!owner) return;
    const link = 'https://t.me/' + BOT_USERNAME +
      '?start=inv_' + shop.inviteCode;
    return bot.sendMessage(chatId,
      '🔑 Ссылка-приглашение:\n\n' + link + '\n\n' +
      'Отправьте её флористу — он кликнет ' +
      'и сразу попадёт в вашу команду.'
    );
  }
  if (data === 'menu_team') {
    if (!owner) return;
    const others = shop.admins.filter(
      a => a.chatId !== chatId
    );
    if (others.length === 0) {
      return bot.sendMessage(chatId,
        '👥 <b>Команда магазина</b>\n\nПока только вы.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{
              text: '↩️ Назад',
              callback_data: 'menu_back'
            }]]
          }
        }
      );
    }
    const keyboard = others.map(a => {
      const dot = a.onShift ? '🟢' : '⚪';
      return [{
        text: dot + ' ' + (a.name || 'Флорист'),
        callback_data: 'team_user_' + a.chatId
      }];
    });
    keyboard.push([{
      text: '↩️ Назад',
      callback_data: 'menu_back'
    }]);
    return bot.sendMessage(
      chatId,
      '👥 <b>Команда магазина</b> (' + others.length + ')',
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );
  }
  if (data.startsWith('team_user_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[2]);
    const target = shop.admins.find(
      a => a.chatId === targetChatId
    );
    if (!target) return;
    const statusText = target.onShift
      ? '🟢 На смене'
      : '⚪ Выходной';
    let info = '🌸 <b>';
    info += esc(target.name || 'Флорист') + '</b>\n\n';
    info += 'Статус: ' + statusText + '\n';
    info += 'Присоединился: ';
    info += new Date(target.joinedAt).toLocaleDateString();
    return bot.sendMessage(chatId, info, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🗑 Удалить доступ',
            callback_data: 'kick_' + targetChatId
          }],
          [{
            text: '↩️ Назад',
            callback_data: 'menu_team'
          }]
        ]
      }
    });
  }
  if (data.startsWith('kick_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[1]);
    return bot.sendMessage(chatId, '⚠️ Удалить доступ?', {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🗑 Да',
            callback_data: 'confirmkick_' + targetChatId
          }],
          [{
            text: '↩️ Отмена',
            callback_data: 'menu_team'
          }]
        ]
      }
    });
  }
  if (data.startsWith('confirmkick_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[1]);
    const target = shop.admins.find(
      a => a.chatId === targetChatId
    );
    const name = target
      ? (target.name || 'Флорист')
      : 'Флорист';
    await removeAdminFromDb(targetChatId, shopId);
    delete userToShop[targetChatId];
    bot.editMessageText(
      '✅ Доступ для «' + name + '» удалён.',
      {
        chat_id: chatId,
        message_id: q.message.message_id
      }
    ).catch(function(){});
    bot.sendMessage(targetChatId,
      '🚫 Ваш доступ к витрине «' +
      shop.displayName + '» удалён.'
    ).catch(function(){});
    return;
  }

  // ========== СТАТИСТИКА ==========
  if (data === 'menu_stats') {
    if (!owner) return;
    const all = await getBouquetsFromDb(shopId, true);
    const clickMap = {};
    for (const b of all) {
      const key = normalizeName(b.name);
      if (!key) continue;
      if (!clickMap[key]) {
        clickMap[key] = {
          name: b.name, clicks: 0, hasActive: false
        };
      }
      clickMap[key].clicks += (b.clicks || 0);
      if (!b.deleted) {
        clickMap[key].name = b.name;
        clickMap[key].hasActive = true;
      }
    }
    const top = Object.values(clickMap)
      .filter(x => x.clicks > 0)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5);
    const stats = shop.stats;
    const orders = stats.orders || 0;
    const calls = stats.calls || 0;
    const total = orders + calls;
    let txt = '📊 <b>Статистика</b>\n\n';
    txt += '📩 Хотели написать: <b>' + orders + '</b>\n';
    txt += '📞 Хотели позвонить: <b>' + calls + '</b>\n';
    txt += '📈 Всего заявок: <b>' + total + '</b>\n';
    txt += '\n<i>Здесь только реальные клики ' +
      'клиентов. Ваши собственные заходы ' +
      'не считаются.</i>\n';
    if (top.length > 0) {
      txt += '\n🔥 <b>Топ-5 по заявкам:</b>\n';
      for (let i = 0; i < top.length; i++) {
        const x = top[i];
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
        const mark = x.hasActive ? '' : ' (архив)';
        txt += medal + ' ' + esc(x.name) + ' — ';
        txt += x.clicks + mark + '\n';
      }
    } else {
      txt += '\n<i>Пока ни одной заявки. ' +
        'Поделитесь ссылкой с клиентами!</i>';
    }
    return bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '↩️ Назад',
          callback_data: 'menu_back'
        }]]
      }
    });
  }

  // ========== НАЦЕНКА ==========
  if (data === 'menu_markup') {
    if (!owner) return;
    const current = shop.settings.markupPercent || 0;
    let txt = '💰 <b>Наценка</b>\n\nСейчас: <b>';
    txt += current + '%</b>\n\n';
    if (current === 0) {
      txt += 'При 0% витрина показывает одну цену.';
    } else {
      txt += 'Пример: 1000 → <s>';
      txt += calculateOldPrice(1000, current) + '</s> ';
      txt += '<b>1000</b>';
    }
    return bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '0%', callback_data: 'markup_set_0' },
            { text: '10%', callback_data: 'markup_set_10' },
            { text: '15%', callback_data: 'markup_set_15' }
          ],
          [
            { text: '20%', callback_data: 'markup_set_20' },
            { text: '30%', callback_data: 'markup_set_30' },
            { text: '50%', callback_data: 'markup_set_50' }
          ],
          [{
            text: '✏️ Своё',
            callback_data: 'markup_custom'
          }],
          [{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]
        ]
      }
    });
  }
  if (data.startsWith('markup_set_')) {
    if (!owner) return;
    const percent = parseInt(data.replace('markup_set_', ''));
    shop.settings.markupPercent = percent;
    await saveShopSettings(shopId, shop.settings);
    bot.editMessageText(
      '✅ <b>Наценка: ' + percent + '%</b>',
      {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]]
        }
      }
    ).catch(function(){});
    return;
  }
  if (data === 'markup_custom') {
    if (!owner) return;
    awaitingMarkup[chatId] = true;
    return bot.sendMessage(chatId,
      '💰 Напишите процент числом (0–200).\n' +
      '<i>Отмена — /cancel</i>',
      {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(shop, chatId)
      }
    );
  }

  // ========== СТАТУС ==========
  if (data === 'menu_status') {
    const active = (await getBouquetsFromDb(shopId)).length;
    const days = getRemainingDays(shop);
    const myRole = owner ? '👑 Владелец' : '🌸 Флорист';
    const me = shop.admins.find(a => a.chatId === chatId);
    const myShift = me && me.onShift
      ? '🟢 На смене'
      : '⚪ Не на смене';
    let txt = '📋 <b>' + esc(shop.displayName) + '</b>\n\n';
    txt += '👤 ' + myRole + ' · ' + myShift + '\n';
    txt += '👥 Команда: ' + shop.admins.length + '\n';
    txt += '📦 Букетов: ' + active + '\n';
    txt += '💰 Наценка: ' + shop.settings.markupPercent + '%\n';
    txt += '📅 Триал: ' + days + ' дней';
    const kb = owner
      ? {
          inline_keyboard: [[{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]]
        }
      : {
          inline_keyboard: [[{
            text: '❌ Закрыть',
            callback_data: 'menu_close'
          }]]
        };
    return bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  }
  if (data === 'menu_renew') {
    return bot.sendMessage(chatId,
      '💳 Продление: @floop10',
      {
        reply_markup: {
          inline_keyboard: [[{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]]
        }
      }
    );
  }

  // ========== ЛОГОТИП ==========
  if (data === 'menu_logo') {
    if (!owner) return;
    const cur = shop.settings.logo
      ? '🎨 Логотип установлен.'
      : '🎨 Логотип не установлен.';
    return bot.sendMessage(chatId, cur, {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📷 Загрузить',
            callback_data: 'setlogo_now'
          }],
          [{
            text: '🗑 Убрать',
            callback_data: 'resetlogo_now'
          }],
          [{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]
        ]
      }
    });
  }

  // ========== ОБЛОЖКА ==========
  if (data === 'menu_cover') {
    if (!owner) return;
    const cur = shop.settings.cover
      ? '🖼 Обложка установлена.'
      : '🖼 Обложка не установлена.';
    return bot.sendMessage(chatId, cur, {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📷 Загрузить',
            callback_data: 'setcover_now'
          }],
          [{
            text: '🗑 Убрать',
            callback_data: 'resetcover_now'
          }],
          [{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]
        ]
      }
    });
  }
  if (data === 'setcover_now') {
    if (!owner) return;
    awaitingUpload[chatId] = 'cover';
    return bot.sendMessage(chatId,
      '📷 Отправьте картинку для обложки.\n\n' +
      '<i>Рекомендуем горизонтальное фото ' +
      'или баннер. Ширина от 800 px.</i>',
      { parse_mode: 'HTML' }
    );
  }
  if (data === 'resetcover_now') {
    if (!owner) return;
    shop.settings.cover = null;
    await saveShopSettings(shopId, shop.settings);
    bot.editMessageText('✅ Обложка убрана.', {
      chat_id: chatId,
      message_id: q.message.message_id
    }).catch(function(){});
    return;
  }

  // ========== ФОН ==========
  if (data === 'menu_background') {
    if (!owner) return;
    let curText = '🖼 Фон не установлен.';
    if (isPresetBackground(shop.settings.background)) {
      const p = findPresetById(shop.settings.background.id);
      if (p) {
        curText = '🖼 Сейчас: ' + p.emoji + ' ' + p.name;
      }
    } else if (hasAnyBackground(shop)) {
      curText = '🖼 Свой фон установлен.';
    }
    return bot.sendMessage(chatId, curText, {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🎨 Выбрать из готовых',
            callback_data: 'bg_presets'
          }],
          [{
            text: '📷 Загрузить свой',
            callback_data: 'setbg_now'
          }],
          [{
            text: '🗑 Убрать фон',
            callback_data: 'resetbg_now'
          }],
          [{
            text: '↩️ Назад',
            callback_data: 'menu_back'
          }]
        ]
      }
    });
  }

  if (data === 'bg_presets') {
    if (!owner) return;
    let txt = '🎨 <b>Готовые фоны</b>\n\n';
    txt += 'Тапните на номер — увидите превью, ';
    txt += 'потом примените.';
    const rows = [];
    for (let i = 0; i < PRESET_BACKGROUNDS.length; i += 2) {
      const row = [];
      const b1 = PRESET_BACKGROUNDS[i];
      row.push({
        text: b1.emoji + ' ' + b1.id + '. ' + b1.name,
        callback_data: 'bg_view_' + b1.id
      });
      if (i + 1 < PRESET_BACKGROUNDS.length) {
        const b2 = PRESET_BACKGROUNDS[i + 1];
        row.push({
          text: b2.emoji + ' ' + b2.id + '. ' + b2.name,
          callback_data: 'bg_view_' + b2.id
        });
      }
      rows.push(row);
    }
    rows.push([{
      text: '⬅️ Назад',
      callback_data: 'menu_background'
    }]);
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows }
      });
    } catch (e) { /* ignore */ }
    return;
  }

  if (data.startsWith('bg_view_')) {
    if (!owner) return;
    const pid = parseInt(data.replace('bg_view_', ''));
    const preset = findPresetById(pid);
    if (!preset) return;
    let txt = preset.emoji + ' <b>' + preset.name + '</b>\n\n';
    txt += 'Применить этот фон к витрине?';
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '✅ Применить',
              callback_data: 'bg_apply_' + pid
            }],
            [{
              text: '⬅️ Выбрать другой',
              callback_data: 'bg_presets'
            }]
          ]
        }
      });
    } catch (e) { /* ignore */ }
    return;
  }

  if (data.startsWith('bg_apply_')) {
    if (!owner) return;
    const pid = parseInt(data.replace('bg_apply_', ''));
    const preset = findPresetById(pid);
    if (!preset) return;
    shop.settings.background = {
      type: 'preset',
      id: pid
    };
    await saveShopSettings(shopId, shop.settings);
    let txt = '✅ Фон применён!\n\n';
    txt += preset.emoji + ' ' + preset.name + '\n\n';
    txt += 'Откройте витрину — изменения уже там.';
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '🏠 Готово',
            callback_data: 'menu_close'
          }]]
        }
      });
    } catch (e) { /* ignore */ }
    return;
  }

  if (data === 'setbg_now') {
    if (!owner) return;
    awaitingUpload[chatId] = 'background';
    return bot.sendMessage(chatId, '📷 Отправьте фото фона.');
  }
  if (data === 'setlogo_now') {
    if (!owner) return;
    awaitingUpload[chatId] = 'logo';
    return bot.sendMessage(chatId, '📷 Отправьте фото логотипа.');
  }
  if (data === 'resetlogo_now') {
    if (!owner) return;
    shop.settings.logo = null;
    await saveShopSettings(shopId, shop.settings);
    bot.editMessageText('✅ Логотип убран.', {
      chat_id: chatId,
      message_id: q.message.message_id
    }).catch(function(){});
    return;
  }
  if (data === 'resetbg_now') {
    if (!owner) return;
    shop.settings.background = null;
    await saveShopSettings(shopId, shop.settings);
    bot.editMessageText('✅ Фон убран.', {
      chat_id: chatId,
      message_id: q.message.message_id
    }).catch(function(){});
    return;
  }

  // ========== ЦВЕТ КНОПКИ ==========
  if (data === 'menu_buttoncolor') {
    if (!owner) return;
    const current = shop.settings.buttonColor || 'red';
    const curObj = findColorById(current) ||
      findColorById('red');
    let txt = '🔘 <b>Цвет кнопки «Связаться»</b>\n\n';
    txt += 'Сейчас: ' + curObj.emoji + ' ' +
      curObj.name + '\n\n';
    txt += 'Выберите под фирменный стиль магазина.';
    const rows = [];
    for (let i = 0; i < BUTTON_COLORS.length; i += 2) {
      const row = [];
      const c1 = BUTTON_COLORS[i];
      row.push({
        text: c1.emoji + ' ' + c1.name,
        callback_data: 'btncol_view_' + c1.id
      });
      if (i + 1 < BUTTON_COLORS.length) {
        const c2 = BUTTON_COLORS[i + 1];
        row.push({
          text: c2.emoji + ' ' + c2.name,
          callback_data: 'btncol_view_' + c2.id
        });
      }
      rows.push(row);
    }
    rows.push([{
      text: '↩️ Назад',
      callback_data: 'menu_back'
    }]);
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows }
      });
    } catch (e) { /* ignore */ }
    return;
  }

  if (data.startsWith('btncol_view_')) {
    if (!owner) return;
    const cid = data.replace('btncol_view_', '');
    const col = findColorById(cid);
    if (!col) return;
    let txt = col.emoji + ' <b>' + col.name + '</b>\n\n';
    txt += 'Нажмите «Применить» — и цвет ';
    txt += 'появится на витрине.';
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '✅ Применить',
              callback_data: 'btncol_apply_' + cid
            }],
            [{
              text: '⬅️ Выбрать другой',
              callback_data: 'menu_buttoncolor'
            }]
          ]
        }
      });
    } catch (e) { /* ignore */ }
    return;
  }

  if (data.startsWith('btncol_apply_')) {
    if (!owner) return;
    const cid = data.replace('btncol_apply_', '');
    const col = findColorById(cid);
    if (!col) return;
    shop.settings.buttonColor = cid;
    await saveShopSettings(shopId, shop.settings);
    let txt = '✅ Цвет кнопки обновлён!\n\n';
    txt += col.emoji + ' ' + col.name + '\n\n';
    txt += 'Откройте витрину — на карточках ';
    txt += 'кнопка теперь этого цвета.';
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '🏠 Готово',
            callback_data: 'menu_close'
          }]]
        }
      });
    } catch (e) { /* ignore */ }
    return;
  }// ========== ПРОВЕРКА НАЛИЧИЯ ==========
  if (data === 'check_start') {
    const bouquets = await getCheckableBouquets(shopId);
    if (bouquets.length === 0) {
      bot.editMessageText(
        '🌿 На витрине нет букетов — проверять нечего.',
        {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML'
        }
      ).catch(function(){});
      return;
    }
    checkSessions[chatId] = {
      shopId,
      bouquets,
      checked: {},
      order: [],
      listMessageId: q.message.message_id,
      currentPage: 0,
      lastActivity: Date.now()
    };
    const session = checkSessions[chatId];
    const txt = buildCheckListText(session);
    const kb = {
      inline_keyboard: buildCheckListKeyboard(session)
    };
    bot.editMessageText(txt, {
      chat_id: chatId,
      message_id: q.message.message_id,
      parse_mode: 'HTML',
      reply_markup: kb
    }).catch(function(){});
    // Онбординг: переход к следующему шагу
    await advanceOnboardingAfter(
      chatId, shopId, 'check_stock'
    );
    return;
  }

  if (data === 'check_cancel') {
    delete checkSessions[chatId];
    bot.editMessageText('❌ Проверка отменена.', {
      chat_id: chatId,
      message_id: q.message.message_id
    }).catch(function(){});
    return;
  }

  if (data === 'check_finish') {
    delete checkSessions[chatId];
    try {
      await bot.editMessageText('✅ Проверка завершена.', {
        chat_id: chatId,
        message_id: q.message.message_id,
        reply_markup: getMainKeyboard(shop, chatId)
      });
    } catch (e) {
      bot.sendMessage(chatId, '✅ Проверка завершена.', {
        reply_markup: getMainKeyboard(shop, chatId)
      }).catch(function(){});
    }
    await advanceOnboardingAfter(
      chatId, shopId, 'check_stock'
    );
    return;
  }

  if (data.startsWith('check_page_')) {
    const session = checkSessions[chatId];
    if (!session) {
      bot.editMessageText(
        '⚠️ Сессия проверки истекла. Начните заново.',
        {
          chat_id: chatId,
          message_id: q.message.message_id
        }
      ).catch(function(){});
      return;
    }
    const newPage = parseInt(
      data.replace('check_page_', '')
    );
    if (!isNaN(newPage)) session.currentPage = newPage;
    session.lastActivity = Date.now();
    const txt = buildCheckListText(session);
    const kb = {
      inline_keyboard: buildCheckListKeyboard(session)
    };
    bot.editMessageText(txt, {
      chat_id: chatId,
      message_id: q.message.message_id,
      parse_mode: 'HTML',
      reply_markup: kb
    }).catch(function(){});
    return;
  }

  if (data.startsWith('check_show_')) {
    const session = checkSessions[chatId];
    if (!session) {
      return sendNav(chatId,
        '⚠️ Сессия проверки прервана. Начните заново.'
      );
    }
    const id = parseInt(data.split('_')[2]);
    const b = session.bouquets.find(x => x.id === id);
    if (!b) {
      return sendNav(chatId,
        '⚠️ Букет больше не в списке.'
      );
    }
    session.currentBouquetId = id;
    session.lastActivity = Date.now();
    const already = session.checked[id];
    const headerText = already
      ? '📷 <b>Проверка (уже отмечен)</b>'
      : '📷 <b>Проверка наличия</b>';
    return sendBouquetPreview(chatId, b, headerText, [
      [{
        text: '✅ Есть',
        callback_data: 'check_yes_' + b.id
      }],
      [{
        text: '📥 Убрать',
        callback_data: 'check_no_' + b.id
      }],
      [{
        text: '📸 Скачать фото',
        callback_data: 'dlphoto_' + b.id
      }],
      [{
        text: '↩️ К списку',
        callback_data: 'check_back'
      }]
    ]);
  }

  if (data === 'check_back') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return sendNav(chatId,
      '👆 Вернуться к списку — выше. ' +
      'Нажмите на любой букет.'
    );
  }

  if (data.startsWith('check_yes_')) {
    const session = checkSessions[chatId];
    if (!session) {
      return sendNav(chatId,
        '⚠️ Сессия проверки прервана. Начните заново.'
      );
    }
    const id = parseInt(data.split('_')[2]);
    if (!session.bouquets.find(x => x.id === id)) return;
    await updateBouquetFields(id, {
      confirmed_at: new Date().toISOString(),
      hidden: false,
      reminded: false
    });
    session.checked[id] = 'yes';
    session.order = [
      id, ...session.order.filter(x => x !== id)
    ];
    session.currentBouquetId = null;
    session.lastActivity = Date.now();
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return refreshCheckList(chatId, session);
  }

  if (data.startsWith('check_no_')) {
    const session = checkSessions[chatId];
    if (!session) {
      return sendNav(chatId,
        '⚠️ Сессия проверки прервана. Начните заново.'
      );
    }
    const id = parseInt(data.split('_')[2]);
    if (!session.bouquets.find(x => x.id === id)) return;
    await updateBouquetField(id, 'hidden', true);
    session.checked[id] = 'no';
    session.order = [
      id, ...session.order.filter(x => x !== id)
    ];
    session.currentBouquetId = null;
    session.lastActivity = Date.now();
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return refreshCheckList(chatId, session);
  }

  // ========== ИЗМЕНИТЬ ЦЕНУ ==========
  if (data.startsWith('editprice_ok_')) {
    const id = parseInt(data.split('_')[2]);
    const b = await getBouquetById(shopId, id);
    if (!b) return;
    awaitingPrice[chatId] = b.id;
    let t = '✏️ Напишите новую цену для букета ';
    t += '<b>№' + b.shopNumber + '</b> (' +
      esc(b.name) + ').\n';
    t += 'Текущая: <b>' + formatPrice(b.price, shop) + '</b>\n';
    t += '<i>Отмена — /cancel</i>';
    return bot.sendMessage(chatId, t, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }
  if (data.startsWith('editprice_no_')) {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showBouquetList(
      chatId, shopId, 'editprice',
      '✏️ <b>Какой букет изменить цену?</b>\n' +
      'Нажмите на кнопку с номером.',
      0
    );
  }
  if (data.startsWith('editprice_')) {
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    const btns = buildBouquetActionButtons(
      b,
      '✅ Да, менять цену',
      'editprice_ok_' + b.id,
      'editprice_no_' + b.id
    );
    return sendBouquetPreview(
      chatId, b, '✏️ <b>Изменить цену?</b>', btns
    );
  }

  // ========== ПЕРЕИМЕНОВАТЬ ==========
  if (data.startsWith('rename_ok_')) {
    const id = parseInt(data.split('_')[2]);
    const b = await getBouquetById(shopId, id);
    if (!b) return;
    awaitingName[chatId] = b.id;
    let t = '📝 Напишите новое название для ';
    t += 'букета <b>№' + b.shopNumber + '</b>.\n';
    t += 'Текущее: <b>' + esc(b.name) + '</b>\n';
    t += '<i>Точка в начале — закрепить. ' +
      'Отмена — /cancel</i>';
    return bot.sendMessage(chatId, t, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }
  if (data.startsWith('rename_no_')) {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showBouquetList(
      chatId, shopId, 'rename',
      '📝 <b>Какой букет переименовать?</b>\n' +
      'Нажмите на кнопку с номером.',
      0
    );
  }
  if (data.startsWith('rename_')) {
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    if (!b) {
      return sendNav(chatId, '❌ Букет не найден.');
    }
    const btns = buildBouquetActionButtons(
      b,
      '✅ Да, менять название',
      'rename_ok_' + b.id,
      'rename_no_' + b.id
    );
    return sendBouquetPreview(
      chatId, b, '📝 <b>Переименовать этот букет?</b>', btns
    );
  }

  // ========== УДАЛИТЬ ==========
  if (data.startsWith('askdel_')) {
    if (!owner) return;
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    if (!b) return;
    const btns = buildBouquetActionButtons(
      b,
      '🗑 Да, удалить',
      'confirmdel_' + b.id,
      'canceldel'
    );
    return sendBouquetPreview(
      chatId, b, '🗑 <b>Удалить этот букет?</b>', btns
    );
  }
  if (data.startsWith('confirmdel_')) {
    if (!owner) return;
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    const num = b ? b.shopNumber : id;
    await updateBouquetField(id, 'deleted', true);
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showBouquetList(
      chatId, shopId, 'askdel',
      '✅ <b>Букет №' + num + ' удалён с витрины.</b>\n\n' +
      '🗑 Какой удалить ещё?',
      0
    );
  }
  if (data === 'canceldel') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    return showBouquetList(
      chatId, shopId, 'askdel',
      '🗑 <b>Какой букет удалить?</b>\n' +
      'Нажмите на кнопку с номером.',
      0
    );
  }

  // ========== ПРОДЛЕНИЕ ==========
  if (data.startsWith('extend_')) {
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    await updateBouquetFields(id, {
      confirmed_at: new Date().toISOString(),
      hidden: false,
      reminded: false
    });
    if (!b) {
      return sendNav(chatId, '🌿 Продлено.');
    }
    let t = '🌿 <b>Продлено!</b>\n\n';
    t += 'Букет <b>№' + b.shopNumber + '</b> «';
    t += esc(b.name) + '» — <b>';
    t += formatPrice(b.price, shop) + '</b>\n';
    t += 'Будет на витрине ещё 3 дня.';
    return bot.sendMessage(chatId, t, { parse_mode: 'HTML' });
  }

  // ========== УТРЕННЕЕ НАПОМИНАНИЕ — «Позже» ==========
  if (data === 'morning_later') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    const key = shopId + ':' + getNowMoscow()
      .toISOString().slice(0, 10);
    morningLaterSent[key] = Date.now();
    return;
  }

  // ========== СТАРЫЕ ВЕТКИ ==========
  if (data.startsWith('confirm_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, {
      confirmed_at: new Date().toISOString(),
      hidden: false,
      reminded: false
    });
    const b = await getBouquetById(shopId, id);
    return sendNav(chatId,
      '✅ Букет №' + (b ? b.shopNumber : id) +
      ' подтверждён.'
    );
  }
  if (data.startsWith('hide_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetField(id, 'hidden', true);
    const b = await getBouquetById(shopId, id);
    return sendNav(chatId,
      '📥 Букет №' + (b ? b.shopNumber : id) + ' убран.'
    );
  }
  if (data.startsWith('show_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, {
      hidden: false,
      confirmed_at: new Date().toISOString(),
      reminded: false
    });
    const b = await getBouquetById(shopId, id);
    return sendNav(chatId,
      '✅ Букет №' + (b ? b.shopNumber : id) +
      ' возвращён на витрину.'
    );
  }
});

// ========== КАРТОЧКА БУКЕТА (из поиска) ==========
async function showBouquetCard(chatId, b, shopId) {
  const rows = [];
  rows.push([
    {
      text: '✏️ Изменить цену',
      callback_data: 'editprice_' + b.id
    },
    {
      text: '📝 Переименовать',
      callback_data: 'rename_' + b.id
    }
  ]);
  if (b.hidden || !isConfirmedRecently(b)) {
    rows.push([{
      text: '✅ Вернуть на витрину',
      callback_data: 'unhide_' + b.id
    }]);
  } else {
    rows.push([{
      text: '📥 Убрать с витрины',
      callback_data: 'hideit_' + b.id
    }]);
  }
  rows.push([{
    text: '📸 Скачать фото',
    callback_data: 'dlphoto_' + b.id
  }]);
  rows.push([{
    text: '🗑 Удалить',
    callback_data: 'askdel_' + b.id
  }]);
  rows.push([{
    text: '⬅️ Назад',
    callback_data: 'mb_back'
  }]);
  return sendBouquetPreview(
    chatId, b, '📷 <b>Карточка букета</b>', rows
  );
}// ========== ОНБОРДИНГ — ТЕКСТЫ ==========
function buildOwnerStepText(step, shopId) {
  const link = SITE_URL + '/shop/' + shopId;
  const texts = {
    add_bouquet: {
      text: '🎓 <b>Давайте попробуем вместе!</b>\n\n' +
            'Сейчас создадим ваш первый букет.\n' +
            'Это займёт <b>1 минуту</b>.\n\n' +
            'Как это работает:\n' +
            '1. Пришлите фото букета в этот чат\n' +
            '2. В подписи напишите название и цену\n' +
            '3. Букет сразу появится на витрине\n\n' +
            '<b>Попробуем?</b> Просто пришлите фото ' +
            'с подписью.\n\n' +
            'Например: <code>31 роза 3500</code>',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    view_shop: {
      text: '👁 <b>Посмотрите на витрине</b>\n\n' +
            'Ваш букет уже на витрине! ' +
            'Откройте её — увидите, как это ' +
            'выглядит для клиентов.\n\n' +
            link + '\n\n' +
            'Когда посмотрите — вернитесь и ' +
            'нажмите кнопку ниже.',
      kb: [
        [{
          text: '✅ Посмотрел, дальше',
          callback_data: 'onb_next'
        }],
        [{
          text: '⏭ Пропустить обучение',
          callback_data: 'onb_skip'
        }]
      ]
    },
    edit_price: {
      text: '✏️ <b>Попробуем изменить цену?</b>\n\n' +
            'Это самая частая операция. ' +
            'Нажмите «✏️ Изменить цену» внизу — ' +
            'я покажу, что делать дальше.',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    hide_bouquet: {
      text: '📥 <b>Теперь попробуем убрать</b>\n\n' +
            'Если букет закончился — его можно ' +
            'убрать с витрины. Клиенты его больше ' +
            'не увидят, а вернуть можно в любой момент.\n\n' +
            'Нажмите «✏️ Мои букеты», откройте любой ' +
            'букет — там будет кнопка «📥 Убрать ' +
            'с витрины».',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    restore_bouquet: {
      text: '↩️ <b>А теперь — вернуть обратно</b>\n\n' +
            'Откройте «📦 Архив» в меню. Там все ' +
            'убранные букеты. Тапните на него — ' +
            'увидите кнопку «✅ Вернуть на витрину».',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    check_stock: {
      text: '✅ <b>Проверка наличия</b>\n\n' +
            'Это важно. Цветы — живой материал, ' +
            'они расходятся. Если этот букет больше ' +
            'не собрать — лучше убрать его с витрины. ' +
            'Так клиент не напишет впустую.\n\n' +
            'Раз в 3 дня бот напомнит — открывайте ' +
            '«✅ Что в наличии?» и отмечайте: есть ' +
            'или нет.\n\n' +
            'Попробуйте прямо сейчас — нажмите ' +
            '«✅ Что в наличии?» внизу.',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    settings_tour: {
      text: '🎓 <b>Последний шаг. Меню «⚙️ Настройки».</b>\n\n' +
            'Здесь всё, что нужно магазину. Кратко:\n\n' +
            '🔗 Ссылка на витрину\n' +
            '🔑 Пригласить флориста\n' +
            '👥 Команда — кто у вас работает\n' +
            '🏪 Данные магазина — адрес, часы, телефон\n' +
            '📊 Статистика — сколько было заявок\n' +
            '💰 Наценка — надбавка к цене\n' +
            '🎨 Логотип и 🖼 Фон\n' +
            '🖼 Обложка — картинка над названием\n' +
            '🔘 Цвет кнопки\n' +
            '💱 Валюта\n' +
            '📋 Статус и 💳 Продление\n' +
            '📖 Помощь — если что-то забыли\n\n' +
            'Запомнить всё сразу не нужно. Кнопки ' +
            'всегда будут в «⚙️ Настройки».',
      kb: [
        [{
          text: '✅ Понятно, дальше',
          callback_data: 'onb_next'
        }],
        [{
          text: '⏭ Пропустить обучение',
          callback_data: 'onb_skip'
        }]
      ]
    },
    done: {
      text: '🎉 <b>Поздравляю, вы всему научились!</b>\n\n' +
            'Теперь вы умеете:\n' +
            '✅ Добавлять букеты\n' +
            '✅ Менять цену\n' +
            '✅ Убирать и возвращать\n' +
            '✅ Проверять наличие\n\n' +
            'Остальное — в меню «⚙️ Настройки».\n' +
            'Если что-то непонятно — /help.\n\n' +
            '🔗 <b>Ссылка на витрину:</b>\n' + link + '\n\n' +
            'Можете отправлять её клиентам ' +
            'прямо сейчас!',
      kb: [[{
        text: '🏠 В главное меню',
        callback_data: 'onb_finish'
      }]]
    }
  };
  return texts[step] || null;
}

function buildFloristStepText(step, shopId, shopName) {
  const link = SITE_URL + '/shop/' + shopId;
  const texts = {
    add_bouquet: {
      text: '🎓 <b>Добро пожаловать в команду «' +
            esc(shopName) + '»!</b>\n\n' +
            'Сейчас покажу за <b>3 минуты</b>, как ' +
            'работать в боте.\n\n' +
            'Первое — добавление букета.\n\n' +
            'Как это работает:\n' +
            '1. Пришлите фото букета в этот чат\n' +
            '2. В подписи: название + цена\n' +
            '3. Букет сразу появится на витрине\n\n' +
            'Например: <code>31 роза 3500</code>\n\n' +
            '<b>Попробуйте</b> — пришлите фото ' +
            'с подписью.',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    check_stock: {
      text: '✅ <b>Проверка наличия</b>\n\n' +
            'Цветы — живой материал, они ' +
            'расходятся. Если букет больше нельзя ' +
            'собрать — его лучше убрать с витрины. ' +
            'Так клиент не напишет впустую.\n\n' +
            'Раз в 3 дня бот напомнит. Открывайте ' +
            '«✅ Что в наличии?» и отмечайте: есть ' +
            'или нет.\n\n' +
            'Попробуйте сейчас — нажмите ' +
            '«✅ Что в наличии?» внизу.',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    },
    on_shift: {
      text: '🟢 <b>Последний шаг — смена</b>\n\n' +
            'Когда вы на работе — нажмите ' +
            '«✅ Я сегодня работаю». Тогда все ' +
            'уведомления о клиентах будут ' +
            'приходить именно вам.\n\n' +
            'Вечером бот сам сбросит статус ' +
            'через 14 часов.\n\n' +
            'Нажмите «✅ Я сегодня работаю» внизу.',
      kb: [[{
        text: '⏭ Пропустить обучение',
        callback_data: 'onb_skip'
      }]]
    }
  };
  return texts[step] || null;
}

// ========== ОНБОРДИНГ — отправка шага ==========
async function sendOwnerOnboardingStep(chatId, shopId) {
  const state = await getOwnerOnboardingState(shopId);
  if (!state) return;
  if (state.passed) return;
  if (!state.step) return;
  if (state.step === 'done') {
    // финальный шаг — отправляем и завершаем после подтверждения
  }
  const stepText = buildOwnerStepText(state.step, shopId);
  if (!stepText) return;
  try {
    await bot.sendMessage(chatId, stepText.text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: stepText.kb }
    });
  } catch (e) {
    console.error(
      'Ошибка sendOwnerOnboardingStep:', e?.message || e
    );
  }
}

async function sendFloristOnboardingStep(chatId, shopId) {
  const shop = await getShopFromDb(shopId);
  const state = await getFloristOnboardingState(chatId, shopId);
  if (!state) return;
  if (state.passed) return;
  if (!state.step) return;
  const stepText = buildFloristStepText(
    state.step, shopId,
    shop ? shop.displayName : 'магазин'
  );
  if (!stepText) return;
  try {
    await bot.sendMessage(chatId, stepText.text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: stepText.kb }
    });
  } catch (e) {
    console.error(
      'Ошибка sendFloristOnboardingStep:', e?.message || e
    );
  }
}

// ========== ОНБОРДИНГ — переход к следующему шагу ==========
async function advanceOwnerOnboarding(chatId, shopId) {
  const state = await getOwnerOnboardingState(shopId);
  if (!state || state.passed) return;
  const next = nextOwnerStep(state.step);
  await setOwnerOnboardingStep(shopId, next);
  if (next === 'done') {
    // done показываем, но не блокируем
    await sendOwnerOnboardingStep(chatId, shopId);
    return;
  }
  await sendOwnerOnboardingStep(chatId, shopId);
}

async function advanceFloristOnboarding(chatId, shopId) {
  const state = await getFloristOnboardingState(
    chatId, shopId
  );
  if (!state || state.passed) return;
  const next = nextFloristStep(state.step);
  await setFloristOnboardingStep(chatId, shopId, next);
  if (next === 'done') {
    await setFloristOnboardingPassed(chatId, shopId);
    await bot.sendMessage(chatId,
      '🎉 <b>Готово!</b>\n\n' +
      'Теперь вы знаете всё, что нужно.\n' +
      'Остальное — в меню «⚙️ Настройки».\n' +
      'Если что-то непонятно — /help.',
      {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(
          await getShopFromDb(shopId), chatId
        )
      }
    );
    return;
  }
  await sendFloristOnboardingStep(chatId, shopId);
}

// ========== ОНБОРДИНГ — после конкретного действия ==========
async function advanceOnboardingAfter(chatId, shopId, action) {
  // Проверяем владельца
  const ownerState = await getOwnerOnboardingState(shopId);
  if (ownerState && !ownerState.passed &&
      ownerState.step === action) {
    await advanceOwnerOnboarding(chatId, shopId);
    return true;
  }
  // Проверяем флориста
  const floristState = await getFloristOnboardingState(
    chatId, shopId
  );
  if (floristState && !floristState.passed &&
      floristState.step === action) {
    await advanceFloristOnboarding(chatId, shopId);
    return true;
  }
  return false;
}

// ========== ОНБОРДИНГ — пропустить ==========
async function skipOwnerOnboarding(chatId, shopId) {
  await setOwnerOnboardingPassed(shopId);
  await bot.sendMessage(chatId,
    '👌 Хорошо, обучение пропущено.\n\n' +
    'Если что-то понадобится — «📖 Помощь» ' +
    'в настройках или /help.',
    { parse_mode: 'HTML' }
  );
}

async function skipFloristOnboarding(chatId, shopId) {
  await setFloristOnboardingPassed(chatId, shopId);
  await bot.sendMessage(chatId,
    '👌 Хорошо, обучение пропущено.\n\n' +
    'Если что-то понадобится — «📖 Помощь» ' +
    'в настройках или /help.',
    { parse_mode: 'HTML' }
  );
}// ========== ОНБОРДИНГ — КНОПКИ ==========
  if (data === 'onb_next') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    // Проверяем, чей онбординг — владельца или флориста
    const ownerState = await getOwnerOnboardingState(shopId);
    if (ownerState && !ownerState.passed &&
        ownerState.step &&
        ownerState.step !== 'done') {
      return advanceOwnerOnboarding(chatId, shopId);
    }
    const floristState = await getFloristOnboardingState(
      chatId, shopId
    );
    if (floristState && !floristState.passed &&
        floristState.step &&
        floristState.step !== 'done') {
      return advanceFloristOnboarding(chatId, shopId);
    }
    return;
  }

  if (data === 'onb_skip') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    const ownerState = await getOwnerOnboardingState(shopId);
    if (ownerState && !ownerState.passed) {
      const isThisOwner = isOwner(shop, chatId);
      if (isThisOwner) {
        return skipOwnerOnboarding(chatId, shopId);
      }
    }
    const floristState = await getFloristOnboardingState(
      chatId, shopId
    );
    if (floristState && !floristState.passed) {
      return skipFloristOnboarding(chatId, shopId);
    }
    return;
  }

  if (data === 'onb_finish') {
    bot.deleteMessage(chatId, q.message.message_id)
      .catch(function(){});
    await setOwnerOnboardingPassed(shopId);
    await bot.sendMessage(chatId,
      '👇 Возвращаемся в меню.',
      { reply_markup: getMainKeyboard(shop, chatId) }
    );
    return;
  }// ========== PHOTO ==========
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const shopId = userToShop[chatId] ||
    await findUserShop(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ /start');
  const shop = await getShopFromDb(shopId);

  if (shop.blocked) {
    return bot.sendMessage(chatId,
      '🚫 Магазин заблокирован. Напишите @floop10.'
    );
  }

  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;

  if (awaitingUpload[chatId]) {
    const which = awaitingUpload[chatId];
    if (which === 'logo' || which === 'background' ||
        which === 'cover') {
      bot.sendMessage(chatId, '⏳ Загружаю фото...')
        .catch(function(){});
      const result = await savePhotoToStorage(
        fileId, shopId
      );
      if (!validatePhotoSaved(result)) {
        delete awaitingUpload[chatId];
        return bot.sendMessage(chatId,
          '❌ Фото не удалось сохранить. ' +
          'Попробуйте ещё раз.'
        );
      }
      shop.settings[which] = result;
      await saveShopSettings(shopId, shop.settings);
      delete awaitingUpload[chatId];
      let label = 'Логотип';
      if (which === 'background') label = 'Фон';
      if (which === 'cover') label = 'Обложка';
      return bot.sendMessage(chatId,
        '✅ ' + label + ' установлен!',
        { reply_markup: getMainKeyboard(shop, chatId) }
      );
    }
  }

  if (!isSubscriptionActive(shop)) {
    return bot.sendMessage(chatId, '❌ Подписка истекла.');
  }

  const caption = (msg.caption || '').trim();

  if (caption) {
    const parsed = parseCaption(caption);
    if (!parsed.ok) {
      return bot.sendMessage(
        chatId,
        buildParseErrorText(parsed, caption),
        { parse_mode: 'HTML' }
      );
    }

    const finalName = parsed.name;
    const price = parsed.price;
    const tags = computeAllTags(finalName, caption);

    bot.sendMessage(chatId, '⏳ Загружаю фото...')
      .catch(function(){});
    const result = await savePhotoToStorage(
      fileId, shopId
    );

    if (!validatePhotoSaved(result)) {
      return bot.sendMessage(chatId,
        '❌ Фото не удалось сохранить. ' +
        'Попробуйте отправить ещё раз — ' +
        'возможно, проблемы с интернетом.'
      );
    }

    const norm = normalizeName(finalName);
    const all = await getBouquetsFromDb(shopId, true);
    let archivedClicks = 0;
    for (const old of all) {
      if (old.deleted &&
          normalizeName(old.name) === norm) {
        archivedClicks += (old.clicks || 0);
      }
    }

    const addResult = await addBouquetToDb(shopId, {
      name: finalName,
      price: price,
      description: null,
      photos: [result],
      isPinned: finalName.startsWith('.'),
      chatId,
      clicks: archivedClicks,
      tags
    });
    lastBouquetByUser[chatId] = addResult.id;

    let reply = '✅ Букет <b>№' +
      addResult.shopNumber + '</b> «' +
      esc(finalName) + '» добавлен! ';
    reply += formatPrice(price, shop);
    if (tags.length > 0) {
      reply += '\n🏷 Теги: ' +
        tags.map(t => '#' + t).join(' ');
    }
    if (archivedClicks > 0) {
      reply += '\n\n📊 Учтено прошлых кликов: ' +
        archivedClicks;
    }
    reply += '\n\n💡 Ещё фото? Отправьте без подписи.';
    await bot.sendMessage(chatId, reply, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard(shop, chatId)
    });
    // Онбординг: переход после добавления букета
    await advanceOnboardingAfter(
      chatId, shopId, 'add_bouquet'
    );
    return;
  }

  const lastId = lastBouquetByUser[chatId];
  if (!lastId) {
    return bot.sendMessage(chatId,
      '❌ Отправьте фото с подписью.\n\n' +
      ADD_BOUQUET_HINT,
      { parse_mode: 'HTML' }
    );
  }
  const b = await getBouquetById(shopId, lastId);
  if (!b) {
    return bot.sendMessage(chatId, '❌ Букет не найден.');
  }

  bot.sendMessage(chatId, '⏳ Загружаю фото...')
    .catch(function(){});
  const result = await savePhotoToStorage(fileId, shopId);

  if (!validatePhotoSaved(result)) {
    return bot.sendMessage(chatId,
      '❌ Фото не удалось сохранить. ' +
      'Попробуйте ещё раз.'
    );
  }

  const photos = b.photos || [];
  photos.push(result);
  await updateBouquetField(
    lastId, 'photos', JSON.stringify(photos)
  );
  return bot.sendMessage(chatId,
    '📸 Фото добавлено. Всего: ' + photos.length,
    { reply_markup: getMainKeyboard(shop, chatId) }
  );
});

// ========== /cancel ==========
bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  delete awaitingUpload[chatId];
  delete awaitingInput[chatId];
  delete awaitingPrice[chatId];
  delete awaitingName[chatId];
  delete awaitingMarkup[chatId];
  delete awaitingSearch[chatId];
  delete awaitingAdminMessage[chatId];
  delete awaitingAdminBlockReason[chatId];
  delete checkSessions[chatId];
  delete archiveSessions[chatId];
  delete searchSessions[chatId];
  delete registrationState[chatId];
  const shopId = userToShop[chatId] ||
    await findUserShop(chatId);
  if (shopId) {
    const shop = await getShopFromDb(shopId);
    return bot.sendMessage(chatId, '❌ Отменено.', {
      reply_markup: getMainKeyboard(shop, chatId)
    });
  }
  bot.sendMessage(chatId, '❌ Отменено.');
});

// ========== /migrate ==========
bot.onText(/\/migrate/, async (msg) => {
  const chatId = msg.chat.id;
  const shopId = userToShop[chatId] ||
    await findUserShop(chatId);
  if (!shopId) {
    return bot.sendMessage(chatId, '❌ Сначала /start');
  }
  const shop = await getShopFromDb(shopId);
  if (!shop) return;
  if (!isOwner(shop, chatId)) {
    return bot.sendMessage(chatId, '🚫 Только владелец.');
  }
  if (!S3_ENABLED) {
    return bot.sendMessage(chatId,
      '❌ Yandex S3 не настроен. Проверьте ' +
      'переменные YC_* на Render.'
    );
  }

  await bot.sendMessage(chatId,
    '⏳ Начинаю миграцию фото в Yandex S3.\n' +
    'Это может занять 1–2 минуты. Не выключайте.'
  );
  try {
    const r = await migratePhotosToS3(shopId);
    let txt = '✅ <b>Миграция завершена</b>\n\n';
    txt += '📤 Перенесено: <b>' + r.migrated + '</b>\n';
    txt += '⏭ Уже было в S3: <b>' + r.skipped + '</b>\n';
    txt += '❌ Ошибок: <b>' + r.failed + '</b>\n\n';
    if (r.failed > 0) {
      txt += '<i>Часть фото не удалось перенести — ' +
        'они останутся через Telegram, будут ' +
        'грузиться медленнее.</i>\n\n';
    }
    txt += 'Откройте витрину — старые фото теперь ' +
      'тоже должны грузиться быстро.';
    return bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML'
    });
  } catch (e) {
    console.error('Ошибка миграции:', e?.message || e);
    return bot.sendMessage(chatId,
      '❌ Ошибка во время миграции. ' +
      'Проверьте логи Render.'
    );
  }
});

// ========== /register ==========
bot.onText(/\/register/, async (msg) => {
  await startRegistration(
    msg.chat.id, msg.from.first_name, msg.from.username
  );
});

// ========== ВТОРОЙ MESSAGE (регистрация) ==========
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  const state = registrationState[chatId];
  if (!state) return;

  if (!state.userName && msg.from && msg.from.first_name) {
    state.userName = msg.from.first_name;
  }
  if (!state.userUsername && msg.from && msg.from.username) {
    state.userUsername = msg.from.username;
  }

  const cfg = REG_STEPS[state.step];
  if (!cfg) {
    delete registrationState[chatId];
    return;
  }

  if (state.step === 'country') {
    // На шаге «страна» ждём только кнопку. Текстом — подскажем.
    return bot.sendMessage(chatId,
      'Пожалуйста, выберите страну кнопкой ниже. ' +
      'Или нажмите «Пропустить».'
    );
  }

  if (text.trim().toLowerCase() === 'нет' &&
      !cfg.mandatory) {
    return regSkipCurrentStep(chatId, state);
  }
  return regSaveValue(chatId, state, text);
});// ========== ВИТРИНА ==========
app.get('/shop/:shopId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) {
      return res.status(404).send('Магазин не найден');
    }
    if (shop.blocked) {
      let h = '<html><body style="font-family:';
      h += '-apple-system,sans-serif;text-align:center;';
      h += 'padding:50px;">';
      h += '<h1>🚫 Магазин временно недоступен</h1>';
      h += '<p style="color:#666;">Приносим извинения ';
      h += 'за неудобства.</p></body></html>';
      return res.send(h);
    }
    if (!isSubscriptionActive(shop)) {
      let h = '<html><body style="font-family:';
      h += '-apple-system,sans-serif;text-align:center;';
      h += 'padding:50px;">';
      h += '<h1>🌸 ' + esc(shop.displayName) + '</h1>';
      h += '<p>Витрина приостановлена.</p>';
      h += '</body></html>';
      return res.send(h);
    }

    const priceFilter = req.query.price || 'all';
    const sortParam = req.query.sort || 'default';
    const tagFilter = req.query.tag || 'all';

    const all = await getBouquetsFromDb(shop.shopId);
    let active = all.filter(isConfirmedRecently);

    const tagCounts = {};
    for (const b of active) {
      for (const t of (b.tags || [])) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }

    const activeBeforePrice = [...active];

    if (priceFilter === 'low') {
      active = active.filter(b => b.price < 3000);
    } else if (priceFilter === 'mid') {
      active = active.filter(
        b => b.price >= 3000 && b.price <= 6000
      );
    } else if (priceFilter === 'mid2') {
      active = active.filter(
        b => b.price > 6000 && b.price <= 10000
      );
    } else if (priceFilter === 'high1') {
      active = active.filter(
        b => b.price > 10000 && b.price <= 20000
      );
    } else if (priceFilter === 'high2') {
      active = active.filter(b => b.price > 20000);
    }

    if (tagFilter !== 'all') {
      active = active.filter(
        b => (b.tags || []).includes(tagFilter)
      );
    }

    if (sortParam === 'asc') {
      active.sort((a, b) => a.price - b.price);
    } else if (sortParam === 'desc') {
      active.sort((a, b) => b.price - a.price);
    } else if (sortParam === 'fresh') {
      active.sort((a, b) => {
        const da = new Date(a.confirmedAt || a.createdAt);
        const db = new Date(b.confirmedAt || b.createdAt);
        return db - da;
      });
    } else if (sortParam === 'popular') {
      active.sort(
        (a, b) => (b.clicks || 0) - (a.clicks || 0)
      );
    } else {
      active.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        const da = new Date(b.confirmedAt || b.createdAt);
        const db = new Date(a.confirmedAt || a.createdAt);
        return da - db;
      });
    }

    const buildUrl = (newPrice, newSort, newTag) => {
      const p = (newPrice !== undefined &&
                 newPrice !== null)
        ? newPrice : priceFilter;
      const s = (newSort !== undefined &&
                 newSort !== null)
        ? newSort : sortParam;
      const t = (newTag !== undefined &&
                 newTag !== null)
        ? newTag : tagFilter;
      const parts = [];
      if (p && p !== 'all') parts.push('price=' + p);
      if (s && s !== 'default') parts.push('sort=' + s);
      if (t && t !== 'all') {
        parts.push('tag=' + encodeURIComponent(t));
      }
      return '/shop/' + shop.shopId +
        (parts.length ? '?' + parts.join('&') : '');
    };

    const pillBase = 'display:inline-block;';
    const pillBase2 = 'padding:8px 16px;margin:4px;';
    const pillBase3 = 'border-radius:20px;';
    const pillBase4 = 'text-decoration:none;';
    const pillBase5 = 'font-size:14px;font-weight:700;';
    const pillCommon = pillBase + pillBase2 + pillBase3 +
      pillBase4 + pillBase5;

    const sortBase = 'display:inline-block;';
    const sortBase2 = 'padding:6px 12px;margin:4px;';
    const sortBase3 = 'border-radius:16px;';
    const sortBase4 = 'text-decoration:none;font-size:13px;';
    const sortCommon = sortBase + sortBase2 +
      sortBase3 + sortBase4;
    const sortIdle = 'background:#f5f5f5;color:#666;';

    const btnColors = getButtonColors(shop);

    const pillActive = 'background:' +
      btnColors.color + ';color:#fff;';
    const pillIdle = 'background:#f0f0f0;color:#555;';

    const pill = (label, filterValue) => {
      const isActive = priceFilter === filterValue;
      const style = pillCommon +
        (isActive ? pillActive : pillIdle);
      const href = buildUrl(filterValue, null, null);
      return '<a href="' + href + '" style="' +
        style + '">' + label + '</a>';
    };

    const sortActive = 'background:' +
      btnColors.color + ';color:#fff;';

    const sortPill = (label, sortValue) => {
      const isActive = sortParam === sortValue;
      const style = sortCommon +
        (isActive ? sortActive : sortIdle);
      const href = buildUrl(null, sortValue, null);
      return '<a href="' + href + '" style="' +
        style + '">' + label + '</a>';
    };

    let tagPillsHTML = '';
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1]);
    if (sortedTags.length > 0) {
      const tagBase = 'display:inline-block;';
      const tagBase2 = 'padding:6px 12px;margin:4px;';
      const tagBase3 = 'border-radius:16px;';
      const tagBase4 = 'text-decoration:none;';
      const tagBase5 = 'font-size:13px;font-weight:700;';
      const tagCommon = tagBase + tagBase2 +
        tagBase3 + tagBase4 + tagBase5;
      const tagActive = 'background:' +
        btnColors.color + ';color:#fff;';
      const tagIdle = 'background:#f0f0f0;color:#555;';
      const allActive = tagFilter === 'all';
      let tagsHTML = '<a href="' +
        buildUrl(null, null, 'all') +
        '" style="' + tagCommon +
        (allActive ? tagActive : tagIdle) +
        '">Все</a>';
      for (const [tag, count] of sortedTags) {
        const isActive = tagFilter === tag;
        const style = tagCommon +
          (isActive ? tagActive : tagIdle);
        tagsHTML += '<a href="' +
          buildUrl(null, null, tag) +
          '" style="' + style + '">#' +
          esc(tag) + ' ' + count + '</a>';
      }
      tagPillsHTML = '<div style="margin:10px 0 6px;">' +
        tagsHTML + '</div>';
    }

    const pricesAll = activeBeforePrice.map(b => b.price);
    const hasLow = pricesAll.some(p => p < 3000);
    const hasMid = pricesAll.some(
      p => p >= 3000 && p <= 6000
    );
    const hasMid2 = pricesAll.some(
      p => p > 6000 && p <= 10000
    );
    const hasHigh1 = pricesAll.some(
      p => p > 10000 && p <= 20000
    );
    const hasHigh2 = pricesAll.some(p => p > 20000);

    let filtersHTML = tagPillsHTML;
    filtersHTML += '<div style="margin:10px 0 6px;">';
    filtersHTML += pill('Все', 'all');
    if (hasLow) {
      filtersHTML += pill('До 3000', 'low');
    }
    if (hasMid) {
      filtersHTML += pill('3000–6000', 'mid');
    }
    if (hasMid2) {
      filtersHTML += pill('6000–10000', 'mid2');
    }
    if (hasHigh1) {
      filtersHTML += pill('10000–20000', 'high1');
    }
    if (hasHigh2) {
      filtersHTML += pill('От 20000', 'high2');
    }
    filtersHTML += '</div>';
    filtersHTML += '<div style="margin-bottom:20px;">';
    filtersHTML += sortPill('↓ Дешевле', 'asc');
    filtersHTML += sortPill('↑ Дороже', 'desc');
    filtersHTML += sortPill('🔥 Свежие', 'fresh');
    filtersHTML += sortPill('⭐ Популярные', 'popular');
    filtersHTML += '</div>';

    const useTwoColumns =
      active.length > TWO_COLUMNS_THRESHOLD;
    const gridStyle = useTwoColumns
      ? 'display:grid;grid-template-columns:' +
        'minmax(0,1fr) minmax(0,1fr);gap:8px;' +
        'max-width:760px;margin:0 auto;' +
        'align-items:stretch;'
      : 'display:flex;flex-wrap:wrap;' +
        'justify-content:center;gap:8px;';
    const cardExtra = useTwoColumns
      ? 'width:100%;box-sizing:border-box;min-width:0;'
      : 'max-width:320px;';

    let cards = '';
    if (active.length === 0) {
      cards = '<div style="text-align:center;' +
        'padding:50px;font-size:20px;color:#888;' +
        'grid-column:1/-1;">' +
        '🌿 По этому фильтру букетов нет.</div>';
    } else {
      for (const b of active) {
        const photoRefsList = [];
        for (const p of b.photos) {
          const r = getPhotoRefs(p);
          if (r.primary) photoRefsList.push(r);
        }
        let gallery = '';
        if (photoRefsList.length === 0) {
          const grad = getPlaceholderGradient(b.id);
          gallery = '<div class="card-photo" style="';
          gallery += 'width:100%;aspect-ratio:4/5;';
          gallery += 'background:' + grad + ';';
          gallery += 'display:flex;align-items:center;';
          gallery += 'justify-content:center;color:#fff;';
          gallery += 'font-size:44px;opacity:0.65;">📷</div>';
        } else if (photoRefsList.length === 1) {
          gallery = renderImgTag(
            photoRefsList[0],
            'width:100%;aspect-ratio:4/5;' +
            'object-fit:cover;display:block;'
          );
        } else {
          const slideStyle = 'height:100%;width:auto;' +
            'flex-shrink:0;display:block;';
          let slides = '';
          for (const r of photoRefsList) {
            slides += renderImgTag(r, slideStyle);
          }
          const dots = photoRefsList
            .map((_, i) => {
              const op = i === 0 ? '1' : '0.4';
              return '<span style="display:inline-block;';
            })
            .join('');
          gallery = '<div class="card-gallery-wrap" ';
          gallery += 'style="position:relative;width:100%;';
          gallery += 'aspect-ratio:4/5;overflow:hidden;">';
          gallery += '<div class="card-gallery" style="';
          gallery += 'display:flex;overflow-x:auto;gap:0;';
          gallery += 'width:100%;height:100%;';
          gallery += 'scroll-snap-type:x mandatory;';
          gallery += '-webkit-overflow-scrolling:touch;';
          gallery += 'scrollbar-width:none;">';
          gallery += slides + '</div>';
          gallery += '<div class="card-dots" data-count="' +
            photoRefsList.length + '" style="';
          gallery += 'position:absolute;bottom:8px;left:50%;';
          gallery += 'transform:translateX(-50%);';
          gallery += 'display:flex;gap:4px;z-index:5;">';
          for (let i = 0; i < photoRefsList.length; i++) {
            const op = i === 0 ? '0.95' : '0.45';
            gallery += '<span data-i="' + i + '" style="';
            gallery += 'display:inline-block;width:14px;';
            gallery += 'height:2px;border-radius:2px;';
            gallery += 'background:rgba(255,255,255,' + op + ');';
            gallery += '"></span>';
          }
          gallery += '</div>';
          gallery += '<span style="position:absolute;';
          gallery += 'top:50%;right:8px;';
          gallery += 'transform:translateY(-50%);';
          gallery += 'width:28px;height:28px;';
          gallery += 'background:rgba(255,255,255,0.85);';
          gallery += 'border-radius:50%;display:flex;';
          gallery += 'align-items:center;justify-content:center;';
          gallery += 'font-size:14px;color:#333;';
          gallery += 'pointer-events:none;">›</span>';
          gallery += '</div>';
        }

        const oldPrice = calculateOldPrice(
          b.price, shop.settings.markupPercent
        );
        const bouquetUrl = SITE_URL + '/shop/' +
          shop.shopId + '/b/' + b.id;
        const contactUrl = '/contact/' +
          shop.shopId + '/' + b.id;
        const bouquetUrlJs = JSON.stringify(bouquetUrl);
        const bouquetNameJs = JSON.stringify(b.name);
        const bouquetPriceJs = b.price;

        const titleFS = useTwoColumns ? '14px' : '17px';
        const priceFS = useTwoColumns ? '20px' : '26px';
        const oldFS = useTwoColumns ? '13px' : '16px';

        const confirmedLine =
          formatConfirmedAt(b.confirmedAt);
        const confirmedHTML = confirmedLine
          ? '<div style="font-size:11px;' +
            'color:#27ae60;margin:2px 0 6px;' +
            'font-weight:600;">' +
            '✓ Обновлено ' +
            esc(confirmedLine) + '</div>'
          : '';

        const btnGrad = 'linear-gradient(135deg,' +
          btnColors.color + ',' + btnColors.dark + ')';
        const btnShadow = '0 4px 14px ' +
          btnColors.color + '55';

        let card = '<div class="card" style="border:none;';
        card += 'border-radius:6px;padding:0;';
        card += 'margin:0;' + cardExtra;
        card += 'background:#fff;';
        card += 'box-shadow:0 2px 12px rgba(0,0,0,0.06);';
        card += 'text-align:center;position:relative;';
        card += 'display:flex;flex-direction:column;';
        card += 'overflow:hidden;';
        card += 'transition:transform 0.25s ease,';
        card += 'box-shadow 0.25s ease,';
        card += 'opacity 0.4s ease;';
        card += 'will-change:transform;">';
        const numTop = '10px';
        const numRight = '10px';
        card += '<div style="position:absolute;top:' +
          numTop + ';right:' + numRight + ';';
        card += 'background:rgba(44,62,80,0.85);';
        card += 'color:#fff;padding:3px 10px;';
        card += 'border-radius:12px;font-size:11px;';
        card += 'font-weight:700;z-index:10;';
        card += 'backdrop-filter:blur(4px);">';
        card += '№' + b.shopNumber + '</div>';
        card += gallery;
        card += '<div style="padding:10px 12px 12px;">';
        card += '<h3 class="card-title" style="margin:0 0 4px;';
        card += 'font-size:' + titleFS + ';';
        card += 'line-height:1.3;';
        card += 'display:-webkit-box;';
        card += '-webkit-line-clamp:2;';
        card += '-webkit-box-orient:vertical;';
        card += 'overflow:hidden;';
        card += 'font-weight:600;color:#2c3e50;">';
        card += esc(b.name) + '</h3>';
        card += '<p style="font-size:' + priceFS + ';';
        card += 'font-weight:800;color:#2c3e50;';
        card += 'margin:4px 0 4px;letter-spacing:-0.5px;">';
        if (oldPrice > b.price) {
          card += '<span style="';
          card += 'text-decoration:line-through;';
          card += 'color:#b0b0b0;font-weight:400;';
          card += 'font-size:' + oldFS + ';';
          card += 'margin-right:6px;">';
          card += formatPrice(oldPrice, shop) + '</span>';
        }
        card += formatPrice(b.price, shop) + '</p>';
        card += confirmedHTML;
        card += '<div style="margin-top:auto;padding-top:8px;">';
        card += '<a href="' + contactUrl + '" style="';
        card += 'display:block;';
        card += 'margin:8px auto 0;';
        card += 'background:' + btnGrad + ';color:#fff;';
        card += 'padding:12px 16px;';
        card += 'border-radius:24px;text-decoration:none;';
        card += 'font-weight:700;text-align:center;';
        card += 'font-size:14px;';
        card += 'box-shadow:' + btnShadow + ';">';
        card += '📞 Связаться</a>';
        card += '<div style="margin-top:6px;">';
        card += '<a href="#" onclick=\'shareBouquet' +
          '(event, ' + bouquetUrlJs + ', ' +
          bouquetNameJs + ', ' + bouquetPriceJs +
          '); return false;\' style="';
        card += 'display:inline-block;color:#999;';
        card += 'font-size:11px;text-decoration:none;';
        card += 'padding:5px 10px;border-radius:14px;';
        card += 'background:#f7f3ee;">📤 Поделиться</a>';
        card += '</div></div></div></div>';
        cards += card;
      }
    }

    const coverUrl = shop.settings.cover
      ? await getPhotoUrl(shop.settings.cover)
      : null;
    const logoUrl = shop.settings.logo
      ? await getPhotoUrl(shop.settings.logo)
      : null;
    const bodyBg = getBackgroundStyle(shop.settings.background);

    let coverHTML = '';
    if (coverUrl) {
      coverHTML = '<div style="max-width:760px;';
      coverHTML += 'margin:0 auto 16px;';
      coverHTML += 'border-radius:14px;overflow:hidden;';
      coverHTML += 'box-shadow:0 4px 20px rgba(0,0,0,0.08);">';
      coverHTML += '<img src="' + escAttr(coverUrl) + '" ';
      coverHTML += 'style="width:100%;display:block;';
      coverHTML += 'max-height:280px;object-fit:cover;">';
      coverHTML += '</div>';
    }

    const headerHTML = logoUrl
      ? '<img src="' + escAttr(logoUrl) +
        '" style="max-height:80px;display:block;' +
        'margin:0 auto 12px;">'
      : '';

    const totalActiveCount =
      all.filter(isConfirmedRecently).length;
    const cntWord = plural(
      totalActiveCount, 'букет', 'букета', 'букетов'
    );
    const countLine = totalActiveCount > 0
      ? '<div style="font-size:13px;color:#27ae60;' +
        'margin-top:6px;font-weight:700;">🌸 ' +
        totalActiveCount + ' ' + cntWord +
        ' в наличии</div>'
      : '';

    let titleHTML = '<div style="';
    titleHTML += 'background:rgba(255,255,255,0.92);';
    titleHTML += 'border-radius:14px;padding:16px 22px;';
    titleHTML += 'max-width:560px;margin:0 auto 20px;';
    titleHTML += 'box-shadow:0 4px 20px rgba(0,0,0,0.06);';
    titleHTML += 'backdrop-filter:blur(8px);">';
    titleHTML += '<h1 style="color:#2c3e50;';
    titleHTML += 'margin:0 0 8px;font-size:26px;';
    titleHTML += 'font-weight:800;letter-spacing:-0.5px;">';
    titleHTML += esc(shop.displayName) + '</h1>';
    if (shop.address || shop.hours) {
      titleHTML += '<div style="color:#666;';
      titleHTML += 'font-size:14px;line-height:1.5;">';
      if (shop.address) {
        titleHTML += '📍 ' + esc(shop.address);
      }
      if (shop.hours) {
        if (shop.address) titleHTML += '<br>';
        titleHTML += '🕐 ' + esc(shop.hours);
      }
      titleHTML += '</div>';
    }
    titleHTML += countLine + '</div>';

    let html = '';
    html += '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<title>' + esc(shop.displayName) +
      ' — Flowind</title>';
    html += MANROPE_LINK;
    html += '<style>';
    html += 'body{font-family:Manrope,';
    html += '-apple-system,sans-serif;';
    html += 'margin:0;padding:20px 14px;';
    html += 'text-align:center;' + bodyBg + '}\n';
    html += 'h1{color:#2c3e50;}\n';
    html += '.container{max-width:1200px;margin:0 auto;}\n';
    html += '.shop-grid img{cursor:zoom-in;}\n';
    html += '.card{opacity:0;';
    html += 'transform:translateY(14px);}\n';
    html += '.card.visible{opacity:1;';
    html += 'transform:translateY(0);}\n';
    html += '.card-gallery::-webkit-scrollbar{display:none;}\n';
    html += '@media (hover: hover){';
    html += '.card:hover{';
    html += 'transform:translateY(-3px);';
    html += 'box-shadow:0 10px 32px rgba(0,0,0,0.12) !important;';
    html += '}}\n';
    html += '.card:active{';
    html += 'transform:translateY(-2px);}\n';
    html += '@media (prefers-reduced-motion: reduce){';
    html += '.card{opacity:1;';
    html += 'transform:none;';
    html += 'transition:none !important;';
    html += '}\n';
    html += '.card:active,.card:hover{';
    html += 'transform:none;}\n';
    html += '}\n';
    html += '</style></head><body>';
    html += '<div class="container">';
    html += coverHTML + headerHTML + titleHTML + filtersHTML;
    html += '<div class="shop-grid" style="' +
      gridStyle + '">' + cards + '</div></div>';
    html += '<div id="lightbox" onclick="closeLightbox()" ';
    html += 'style="display:none;position:fixed;inset:0;';
    html += 'background:rgba(0,0,0,0.92);z-index:9999;';
    html += 'align-items:center;justify-content:center;';
    html += 'padding:20px;box-sizing:border-box;';
    html += 'touch-action:none;">';
    html += '<img id="lightbox-img" src="" alt="" style="';
    html += 'max-width:100%;max-height:100%;';
    html += 'border-radius:10px;';
    html += 'box-shadow:0 8px 40px rgba(0,0,0,0.6);">';
    html += '<button onclick="closeLightbox()" style="';
    html += 'position:fixed;top:20px;right:20px;';
    html += 'background:rgba(255,255,255,0.95);border:none;';
    html += 'width:44px;height:44px;border-radius:50%;';
    html += 'font-size:22px;cursor:pointer;';
    html += 'font-weight:bold;color:#333;';
    html += 'box-shadow:0 2px 8px rgba(0,0,0,0.4);">';
    html += '✕</button></div>';
    html += '<script>\n';
    html += 'var lbImages = [];\n';
    html += 'var lbIndex = 0;\n';
    html += 'var touchStartX = 0;\n';
    html += 'var touchStartY = 0;\n';
    html += 'function shareBouquet(e, url, name, price) {\n';
    html += '  if (e) { e.preventDefault(); }\n';
    html += '  var text = name + " — " + price + " ₽";\n';
    html += '  if (navigator.share) {\n';
    html += '    navigator.share({ title: name, ';
    html += 'text: text, url: url })';
    html += '.catch(function(){});\n';
    html += '  } else if (navigator.clipboard && ';
    html += 'navigator.clipboard.writeText) {\n';
    html += '    navigator.clipboard.writeText(url)';
    html += '.then(function(){ ';
    html += 'alert("Ссылка скопирована"); ';
    html += '}).catch(function(){ ';
    html += 'prompt("Скопируйте ссылку:", url); });\n';
    html += '  } else { ';
    html += 'prompt("Скопируйте ссылку:", url); }\n';
    html += '}\n';
    html += 'function openLightbox(images, index) {\n';
    html += '  lbImages = images;\n';
    html += '  lbIndex = index;\n';
    html += '  var lb = document.getElementById("lightbox");\n';
    html += '  var img = ';
    html += 'document.getElementById("lightbox-img");\n';
    html += '  img.src = lbImages[lbIndex];\n';
    html += '  lb.style.display = "flex";\n';
    html += '  document.body.style.overflow = "hidden";\n';
    html += '}\n';
    html += 'function closeLightbox() {\n';
    html += '  document.getElementById("lightbox")';
    html += '.style.display = "none";\n';
    html += '  document.getElementById("lightbox-img")';
    html += '.src = "";\n';
    html += '  document.body.style.overflow = "";\n';
    html += '}\n';
    html += 'function lbNext() {\n';
    html += '  if (lbImages.length < 2) return;\n';
    html += '  lbIndex = (lbIndex + 1) % lbImages.length;\n';
    html += '  var img = ';
    html += 'document.getElementById("lightbox-img");\n';
    html += '  img.src = lbImages[lbIndex];\n';
    html += '}\n';
    html += 'function lbPrev() {\n';
    html += '  if (lbImages.length < 2) return;\n';
    html += '  lbIndex = (lbIndex - 1 + lbImages.length) ';
    html += '% lbImages.length;\n';
    html += '  var img = ';
    html += 'document.getElementById("lightbox-img");\n';
    html += '  img.src = lbImages[lbIndex];\n';
    html += '}\n';
    html += 'document.addEventListener("click", ';
    html += 'function(e) {\n';
    html += '  var img = ';
    html += 'e.target.closest(".shop-grid img");\n';
    html += '  if (!img) return;\n';
    html += '  e.preventDefault();\n';
    html += '  e.stopPropagation();\n';
    html += '  var card = img.closest(".card");\n';
    html += '  if (!card) { openLightbox([img.src], 0); ';
    html += 'return; }\n';
    html += '  var imgs = card.querySelectorAll("img");\n';
    html += '  var arr = [];\n';
    html += '  var idx = 0;\n';
    html += '  for (var i = 0; i < imgs.length; i++) {\n';
    html += '    arr.push(imgs[i].src);\n';
    html += '    if (imgs[i] === img) idx = i;\n';
    html += '  }\n';
    html += '  if (arr.length === 0) { arr = [img.src]; idx = 0; }\n';
    html += '  openLightbox(arr, idx);\n';
    html += '});\n';
    html += 'document.addEventListener("keydown", ';
    html += 'function(e) {\n';
    html += '  var lb = document.getElementById("lightbox");\n';
    html += '  if (!lb || lb.style.display !== "flex") return;\n';
    html += '  if (e.key === "Escape") closeLightbox();\n';
    html += '  if (e.key === "ArrowRight") lbNext();\n';
    html += '  if (e.key === "ArrowLeft") lbPrev();\n';
    html += '});\n';
    html += 'var lbEl = document.getElementById("lightbox");\n';
    html += 'lbEl.addEventListener("touchstart", ';
    html += 'function(e) {\n';
    html += '  if (!e.touches || e.touches.length === 0) return;\n';
    html += '  touchStartX = e.touches[0].clientX;\n';
    html += '  touchStartY = e.touches[0].clientY;\n';
    html += '}, { passive: true });\n';
    html += 'lbEl.addEventListener("touchend", ';
    html += 'function(e) {\n';
    html += '  if (!e.changedTouches || ';
    html += 'e.changedTouches.length === 0) return;\n';
    html += '  var dx = e.changedTouches[0].clientX - touchStartX;\n';
    html += '  var dy = e.changedTouches[0].clientY - touchStartY;\n';
    html += '  if (Math.abs(dx) < 40) return;\n';
    html += '  if (Math.abs(dx) < Math.abs(dy)) return;\n';
    html += '  if (dx < 0) lbNext(); else lbPrev();\n';
    html += '}, { passive: true });\n';
    // Обновление точек на карточке при скролле галереи
    html += 'document.querySelectorAll(".card-gallery-wrap")';
    html += '.forEach(function(wrap) {\n';
    html += '  var gal = wrap.querySelector(".card-gallery");\n';
    html += '  var dots = wrap.querySelectorAll(".card-dots span");\n';
    html += '  if (!gal || !dots || !dots.length) return;\n';
    html += '  gal.addEventListener("scroll", function() {\n';
    html += '    var w = gal.clientWidth;\n';
    html += '    if (!w) return;\n';
    html += '    var i = Math.round(gal.scrollLeft / w);\n';
    html += '    dots.forEach(function(d, j) {\n';
    html += '      d.style.background = ';
    html += 'j === i ? "rgba(255,255,255,0.95)" : ';
    html += '"rgba(255,255,255,0.45)";\n';
    html += '    });\n';
    html += '  }, { passive: true });\n';
    html += '});\n';
    html += 'if ("IntersectionObserver" in window) {\n';
    html += '  var obs = new IntersectionObserver(';
    html += 'function(entries){\n';
    html += '    entries.forEach(function(en){\n';
    html += '      if (en.isIntersecting) {\n';
    html += '        en.target.classList.add("visible");\n';
    html += '        obs.unobserve(en.target);\n';
    html += '      }\n';
    html += '    });\n';
    html += '  }, { threshold: 0.1 });\n';
    html += '  document.querySelectorAll(".card")';
    html += '.forEach(function(c){ obs.observe(c); });\n';
    html += '} else {\n';
    html += '  document.querySelectorAll(".card")';
    html += '.forEach(function(c){ ';
    html += 'c.classList.add("visible"); });\n';
    html += '}\n';
    html += '</script></body></html>';
    res.send(html);
  } catch (e) {
    console.error('Ошибка витрины:', e?.message || e);
    res.status(500).send('Ошибка');
  }
});

app.get('/', (req, res) => {
  let h = '<html><body style="font-family:sans-serif;';
  h += 'text-align:center;padding:50px;">';
  h += '<h1>🌸 Flowind</h1></body></html>';
  res.send(h);
});// ========== ФОНОВЫЕ ЗАДАЧИ ==========
async function checkAndNotify() {
  try {
    const shops = await pool.query(
      'SELECT shop_id, hours FROM shops ' +
      'WHERE blocked = FALSE'
    );
    for (const s of shops.rows) {
      if (!isWithinWorkingHours(s.hours)) continue;

      const active = await getBouquetsFromDb(s.shop_id);
      for (const b of active) {
        if (b.isPinned || b.hidden ||
            b.reminded || !b.confirmedAt) continue;
        const rem = 3 * 24 * 60 * 60 * 1000 -
          (Date.now() - new Date(b.confirmedAt).getTime());
        if (rem > 0 && rem <= 12 * 60 * 60 * 1000) {
          let n = '⚠️ Букет №' + b.shopNumber + ' «';
          n += esc(b.name) + '» скоро скроется. ';
          n += 'Продлить?';
          bot.sendMessage(b.chatId, n, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{
                text: '🌿 Продлить',
                callback_data: 'extend_' + b.id
              }]]
            }
          }).catch(function(){});
          await updateBouquetField(b.id, 'reminded', true);
        }
      }
    }
  } catch (e) {
    console.error('Notify error:', e?.message || e);
  }
}

// ========== УТРЕННЕЕ НАПОМИНАНИЕ (ПРАВКА 59) ==========
async function morningReminder() {
  try {
    const now = getNowMoscow();
    const todayKey = now.toISOString().slice(0, 10);

    const shops = await pool.query(
      'SELECT shop_id, hours FROM shops ' +
      'WHERE blocked = FALSE'
    );

    for (const s of shops.rows) {
      const parsed = parseShopHours(s.hours);
      let openH = 8;
      let openM = 0;
      if (parsed) {
        openH = parsed.openH;
        openM = parsed.openM;
      }
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const openMinutes = openH * 60 + openM;
      const diffMin = nowMinutes - openMinutes;

      if (diffMin < 0 || diffMin > 15) continue;

      const sentKey = s.shop_id + ':' + todayKey;
      if (morningReminderSent[sentKey]) continue;

      // ПРАВКА 68: если флорист нажал «Позже» —
      // напоминаем через час, потом молчим до конца дня
      const laterKey = s.shop_id + ':' + todayKey;
      const laterTime = morningLaterSent[laterKey];
      if (laterTime) {
        const diffHr = (Date.now() - laterTime) / 3600000;
        if (diffHr < 1) continue;
        if (diffHr >= 1 && diffHr < 1.5) {
          // отправляем финальное напоминание
        } else if (diffHr >= 1.5) {
          // уже отправляли второй раз — молчим
          morningReminderSent[sentKey] = Date.now();
          continue;
        }
      }

      const shop = await getShopFromDb(s.shop_id);
      if (!shop) continue;
      if (!isSubscriptionActive(shop)) continue;

      const all = await getBouquetsFromDb(s.shop_id);
      const active = all.filter(isConfirmedRecently);
      if (active.length < 3) continue;

      // ПРАВКА 59: не напоминать, если проверяли <12ч
      let lastConfirmMs = 0;
      for (const b of all) {
        if (b.confirmedAt) {
          const t = new Date(b.confirmedAt).getTime();
          if (t > lastConfirmMs) lastConfirmMs = t;
        }
      }
      if (lastConfirmMs > 0) {
        const hoursSince =
          (Date.now() - lastConfirmMs) / 3600000;
        if (hoursSince < 12) {
          morningReminderSent[sentKey] = Date.now();
          continue;
        }
      }

      const targets = shop.admins.filter(
        a => a.role === 'owner' || a.onShift
      );
      const unique = new Set();
      const text =
        '🌸 <b>Доброе утро!</b>\n\n' +
        'Магазин открылся. Проверьте, что на ' +
        'витрине — всё актуально?\n\n' +
        '<i>Это займёт минуту.</i>';
      const kb = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '✅ Проверить наличие',
              callback_data: 'check_start'
            }],
            [{
              text: '⏰ Позже',
              callback_data: 'morning_later'
            }]
          ]
        }
      };
      for (const admin of targets) {
        if (unique.has(admin.chatId)) continue;
        unique.add(admin.chatId);
        bot.sendMessage(admin.chatId, text, kb)
          .catch(function(){});
      }
      morningReminderSent[sentKey] = Date.now();
      console.log('🌅 Утреннее напоминание: ' + s.shop_id);
    }
  } catch (e) {
    console.error(
      'Ошибка morningReminder:', e?.message || e
    );
  }
}

// ========== НАПОМИНАНИЕ ЧЕРЕЗ 3 ДНЯ О ПЕРВОМ БУКЕТЕ ==========
async function checkFirstBouquetReminder() {
  try {
    const shops = await pool.query(
      'SELECT shop_id, trial_start, settings ' +
      'FROM shops WHERE blocked = FALSE'
    );
    for (const s of shops.rows) {
      const settings = s.settings || {};
      if (settings.onboardingPassed) continue;
      if (settings.firstBouquetReminded) continue;
      if (!s.trial_start) continue;

      const daysSince = (
        Date.now() - new Date(s.trial_start).getTime()
      ) / (24 * 60 * 60 * 1000);
      if (daysSince < 3) continue;

      const bouquets = await getBouquetsFromDb(s.shop_id);
      if (bouquets.length > 0) {
        // букеты уже есть — отмечаем и не напоминаем
        settings.firstBouquetReminded = true;
        await saveShopSettings(s.shop_id, settings);
        continue;
      }

      const shop = await getShopFromDb(s.shop_id);
      const owner = shop.admins.find(
        a => a.role === 'owner'
      );
      if (!owner) continue;

      let txt = '👋 Привет!\n\n';
      txt += 'Хотите попробовать добавить первый ';
      txt += 'букет на витрину? Это <b>1 минута</b>.\n\n';
      txt += 'Просто пришлите фото букета с подписью:\n';
      txt += '<code>31 роза 3500</code>\n\n';
      txt += 'Если что-то непонятно — /help';

      bot.sendMessage(owner.chatId, txt, {
        parse_mode: 'HTML'
      }).catch(function(){});

      settings.firstBouquetReminded = true;
      await saveShopSettings(s.shop_id, settings);
      console.log(
        '📨 Напоминание о первом букете: ' + s.shop_id
      );
    }
  } catch (e) {
    console.error(
      'Ошибка checkFirstBouquetReminder:', e?.message || e
    );
  }
}

// ========== ОТЧЁТ ЗА НЕДЕЛЮ ==========
const weeklyReportSent = {};

async function weeklyReport() {
  try {
    const now = getNowMoscow();
    if (now.getDay() !== 0) return;
    if (now.getHours() !== 19) return;

    const weekAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const shops = await pool.query(
      'SELECT shop_id FROM shops WHERE blocked = FALSE'
    );

    for (const s of shops.rows) {
      const shop = await getShopFromDb(s.shop_id);
      if (!shop) continue;
      if (!isSubscriptionActive(shop)) continue;

      const lastSent = weeklyReportSent[s.shop_id];
      if (lastSent &&
          (Date.now() - lastSent) < 6 * 24 * 60 * 60 * 1000) {
        continue;
      }

      const addedRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM bouquets ` +
        `WHERE shop_id = $1 AND created_at >= $2 ` +
        `AND deleted = FALSE`,
        [s.shop_id, weekAgo]
      );
      const addedCount = parseInt(addedRes.rows[0].cnt) || 0;

      const clicksRes = await pool.query(
        `SELECT COALESCE(SUM(clicks), 0) AS total ` +
        `FROM bouquets ` +
        `WHERE shop_id = $1 AND deleted = FALSE`,
        [s.shop_id]
      );
      const totalClicks =
        parseInt(clicksRes.rows[0].total) || 0;

      const topRes = await pool.query(
        `SELECT shop_number, name, clicks ` +
        `FROM bouquets ` +
        `WHERE shop_id = $1 AND deleted = FALSE ` +
        `AND clicks > 0 ` +
        `ORDER BY clicks DESC LIMIT 3`,
        [s.shop_id]
      );

      const archRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM bouquets ` +
        `WHERE shop_id = $1 AND deleted = FALSE ` +
        `AND (hidden = TRUE OR confirmed_at < $2)`,
        [s.shop_id, weekAgo]
      );
      const archCount = parseInt(archRes.rows[0].cnt) || 0;

      const all = await getBouquetsFromDb(s.shop_id);
      const activeNow =
        all.filter(isConfirmedRecently).length;

      let txt = '📊 <b>Итоги недели «';
      txt += esc(shop.displayName) + '»</b>\n\n';
      txt += '📷 Добавлено букетов: <b>' +
        addedCount + '</b>\n';
      txt += '🟢 Сейчас на витрине: <b>' +
        activeNow + '</b>\n';
      txt += '📦 В архиве: <b>' + archCount + '</b>\n';
      txt += '👀 Всего кликов: <b>' +
        totalClicks + '</b>\n';

      if (topRes.rows.length > 0) {
        txt += '\n🔥 <b>Топ-3 по кликам:</b>\n';
        for (let i = 0; i < topRes.rows.length; i++) {
          const r = topRes.rows[i];
          const medal = ['🥇', '🥈', '🥉'][i];
          txt += medal + ' №' + r.shop_number + ' ';
          txt += esc(shortName(r.name, 24)) + ' — ';
          txt += r.clicks + '\n';
        }
      }

      txt += '\n━━━━━━━━━━━━━━━\n';
      txt += '🌿 Продолжайте — витрина работает!\n';
      txt += SITE_URL + '/shop/' + s.shop_id;

      const targetAdmins = shop.admins.filter(
        a => a.role === 'owner' || a.onShift
      );
      const uniqueChats = new Set();
      for (const admin of targetAdmins) {
        if (uniqueChats.has(admin.chatId)) continue;
        uniqueChats.add(admin.chatId);
        bot.sendMessage(admin.chatId, txt, {
          parse_mode: 'HTML'
        }).catch(function(){});
      }

      weeklyReportSent[s.shop_id] = Date.now();
      console.log(
        '📊 Отчёт за неделю отправлен: ' + s.shop_id
      );
    }
  } catch (e) {
    console.error(
      'Ошибка weeklyReport:', e?.message || e
    );
  }
}

// ========== ОЧИСТКА ==========
function cleanupExpiredCheckSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const chatId of Object.keys(checkSessions)) {
    const s = checkSessions[chatId];
    if (!s || !s.lastActivity ||
        now - s.lastActivity > CHECK_SESSION_TTL) {
      delete checkSessions[chatId];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(
      '🧹 Очищено сессий проверки: ' + cleaned
    );
  }
}

function cleanupMorningLater() {
  const now = Date.now();
  const nowMoscow = getNowMoscow();
  const todayKey = nowMoscow.toISOString().slice(0, 10);
  for (const key of Object.keys(morningLaterSent)) {
    const parts = key.split(':');
    if (parts.length < 2) {
      delete morningLaterSent[key];
      continue;
    }
    const datePart = parts[parts.length - 1];
    if (datePart !== todayKey) {
      // очищаем записи прошлых дней
      if (now - morningLaterSent[key] >
          25 * 60 * 60 * 1000) {
        delete morningLaterSent[key];
      }
    }
  }
}// ========== ЗАПУСК ==========
initDb().then(async () => {
  const existing = await getShopFromDb(PRESET_SHOP.shopId);
  if (!existing) {
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setMonth(
      trialEnd.getMonth() + PRESET_SHOP.trialMonths
    );
    const inviteCode = generateInviteCode();
    await createShopInDb({
      shopId: PRESET_SHOP.shopId,
      name: PRESET_SHOP.shopId,
      displayName: PRESET_SHOP.displayName,
      address: PRESET_SHOP.address,
      hours: PRESET_SHOP.hours,
      phone: normalizePhone(PRESET_SHOP.phone),
      telegramUsername: PRESET_SHOP.telegramUsername,
      whatsappPhone: normalizePhone(
        PRESET_SHOP.whatsappPhone
      ),
      maxLink: PRESET_SHOP.maxLink,
      inviteCode,
      trialStart: now.toISOString(),
      trialEnd: trialEnd.toISOString(),
      country: 'RU',
      settings: {
        logo: null,
        cover: null,
        background: { type: 'preset', id: 1 },
        buttonColor: 'red',
        currency: 'RUB',
        markupPercent: PRESET_SHOP.markupPercent,
        aiEnabled: false
      },
      stats: {
        views: 0, orders: 0, calls: 0,
        startedAt: now.toISOString()
      }
    });
    console.log(
      '✅ Preset-магазин ' + PRESET_SHOP.shopId + ' создан'
    );
  } else {
    console.log(
      '✅ Preset-магазин ' + PRESET_SHOP.shopId + ' найден'
    );
    if (!existing.maxLink) {
      await updateShopField(
        PRESET_SHOP.shopId, 'max_username',
        PRESET_SHOP.maxLink
      );
      console.log(
        '✅ MAX-ссылка для ' + PRESET_SHOP.shopId +
        ' установлена'
      );
    }
  }

  try {
    await bot.setMyCommands([
      {
        command: 'start',
        description: 'Открыть главное меню'
      },
      {
        command: 'help',
        description: 'Помощь и вопросы'
      },
      {
        command: 'cancel',
        description: 'Отменить действие'
      }
    ]);
    console.log('✅ Меню команд установлено');
  } catch (e) {
    console.error(
      '⚠️ setMyCommands не удалось:', e?.message || e
    );
  }

  const WEBHOOK_URL = SITE_URL + WEBHOOK_PATH;
  console.log('🔗 Устанавливаем webhook...');
  try {
    await bot.deleteWebHook();
    await bot.setWebHook(WEBHOOK_URL);
    console.log('✅ Webhook установлен');
  } catch (e) {
    console.error(
      '❌ Ошибка установки webhook:', e?.message || e
    );
  }

  setInterval(checkAndNotify, 10 * 60 * 1000);
  setInterval(morningReminder, 5 * 60 * 1000);
  setInterval(checkFirstBouquetReminder, 60 * 60 * 1000);
  setInterval(cleanupExpiredCheckSessions, 5 * 60 * 1000);
  setInterval(cleanupNotifiedClicks, 5 * 60 * 1000);
  setInterval(cleanupMorningLater, 60 * 60 * 1000);
  setInterval(weeklyReport, 30 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(
      '🚀 Flowind на порту ' + PORT + ' (webhook)'
    );
  });
}).catch(err => {
  console.error(
    '❌ Ошибка инициализации:', err.message
  );
  process.exit(1);
});
