const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('./db');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN не задан в переменных окружения Render');
  process.exit(1);
}

const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID ? Number(process.env.OWNER_CHAT_ID) : null;
if (!OWNER_CHAT_ID) {
  console.log('⚠️ OWNER_CHAT_ID не задан — preset kupidon отключён');
} else {
  console.log('✅ OWNER_CHAT_ID: ' + OWNER_CHAT_ID);
}

const YC_BUCKET = process.env.YC_BUCKET_NAME;
const YC_ACCESS_KEY_ID = process.env.YC_ACCESS_KEY_ID;
const YC_SECRET_ACCESS_KEY = process.env.YC_SECRET_ACCESS_KEY;
const S3_ENABLED = !!(YC_BUCKET && YC_ACCESS_KEY_ID && YC_SECRET_ACCESS_KEY);

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
  console.log('✅ S3-клиент инициализирован (bucket: ' + YC_BUCKET + ')');
} else {
  console.log('⚠️ Yandex S3 не настроен — фото пойдут через Telegram');
}

process.on('unhandledRejection', (e) => console.error('⚠️ Unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('⚠️ Uncaught exception:', e?.message || e));

app.use(express.json());

const bot = new TelegramBot(token);

bot.on('error', (e) => console.error('⚠️ Bot error:', e?.message || e));
bot.on('webhook_error', (e) => console.error('⚠️ Webhook error:', e?.message || e));

const WEBHOOK_PATH = `/bot${token}`;
app.post(WEBHOOK_PATH, (req, res) => {
  try { bot.processUpdate(req.body); } catch (e) { console.error('⚠️ Ошибка обработки апдейта:', e?.message || e); }
  res.sendStatus(200);
});

const BOT_USERNAME = 'flowind_rus_bot';
const SITE_URL = 'https://flowind.ru';

const PRESET_SHOP = {
  shopId: 'kupidon',
  displayName: '🌸 Kupidon - для цветов не нужен повод',
  address: 'Ставрополь, Краснофлотская 157/1',
  hours: 'Пн-Вс 10:30-21:00',
  phone: '+7 962 402-51-75',
  telegramUsername: 'KupidonAdm',
  whatsappPhone: '+7 962 402-51-75',
  maxLink: 'https://max.ru/u/f9LHodD0cOJlhEYownGN37InfSoqm2WiY7c7F38Yd1UEtSvBWADCLBqRny8',
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
const photoUrlCache = {};
const checkSessions = {};
const archiveSessions = {};
const notifiedClicks = {};
const awaitingAdminMessage = {};
const awaitingAdminBlockReason = {};

const MAX_BUTTONS_PER_SECTION = 20;
const MAX_LIST_ITEMS = 25;
const TWO_COLUMNS_THRESHOLD = 12;

const MENU_BUTTONS = [
  '📷 Добавить букет',
  '✅ Что в наличии?',
  '✏️ Изменить цену',
  '📝 Переименовать',
  '🗑 Удалить букет',
  '📦 Архив',
  '✅ Я сегодня работаю',
  '🚪 Закончить работу',
  '🔄 Обновить',
  '⚙️ Меню'
];

const PARSE_ERROR_TEXT =
  `❌ <b>Не могу разобрать подпись.</b>\n\n` +
  `Правильно: <b>31 роза 3500</b>\n` +
  `(название, потом цена — последним словом)\n\n` +
  `Неправильно: 31 роза 3500 сорт Аваланж цена\n` +
  `(после цены не должно быть слов)\n\n` +
  `Попробуйте ещё раз или нажмите /cancel`;

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
  `     (цена в начале)\n` +
  `  31 роза 3500₽ за штуку\n` +
  `     (символы и слова после цены)\n\n` +
  `💡 Ещё фото — без подписи.`;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
function normalizeName(name) { return String(name || '').toLowerCase().trim().replace(/\s+/g, ' '); }
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
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
function generateShopId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
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

// ========== ТЕГИ (АВТОРАСПОЗНАВАНИЕ) ==========
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
  for (const t of custom) if (!all.includes(t)) all.push(t);
  return all;
}

function formatConfirmedAt(confirmedAt) {
  if (!confirmedAt) return null;
  const ageMs = Date.now() - new Date(confirmedAt).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) return null;
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} ${plural(mins, 'минуту', 'минуты', 'минут')} назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return 'час назад';
  return `${hrs} ${plural(hrs, 'час', 'часа', 'часов')} назад`;
}

// ========== УВЕДОМЛЕНИЯ О КЛИКАХ ==========
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

  const onShiftAdmins = shop.admins.filter(a => a.onShift);

  if (onShiftAdmins.length > 0) {
    const text = `🔔 <b>Клиент нажал «${isCall ? 'Позвонить' : 'Связаться'}»</b>\n\n` +
      `Букет <b>№${bouquet.shopNumber}</b> «${esc(bouquet.name)}» — <b>${bouquet.price} ₽</b>\n` +
      `Канал: ${channelName}\n\n` +
      (isCall
        ? `<i>Ожидайте звонка.</i>`
        : `<i>Возможно, он уже пишет вам — проверьте.</i>`);
    for (const admin of onShiftAdmins) {
      bot.sendMessage(admin.chatId, text, { parse_mode: 'HTML' }).catch(function(){});
    }
    return;
  }

  const owner = shop.admins.find(a => a.role === 'owner');
  if (!owner) return;

  const warnText = `⚠️ <b>На смене никого</b>\n\n` +
    `Клиент нажал «${isCall ? 'Позвонить' : 'Связаться'}»\n\n` +
    `Букет <b>№${bouquet.shopNumber}</b> «${esc(bouquet.name)}» — <b>${bouquet.price} ₽</b>\n` +
    `Канал: ${channelName}\n\n` +
    `<i>Напомните флористам отметиться в боте — «✅ Я сегодня работаю».</i>`;
  bot.sendMessage(owner.chatId, warnText, { parse_mode: 'HTML' }).catch(function(){});
}

function cleanupNotifiedClicks() {
  const now = Date.now();
  for (const k of Object.keys(notifiedClicks)) {
    if (now - notifiedClicks[k] > CLICK_NOTIFY_TTL) delete notifiedClicks[k];
  }
}

async function setUserOnShift(chatId, shopId, on) {
  if (on) {
    await pool.query(
      `UPDATE admins SET on_shift_until = NOW() + INTERVAL '14 hours' WHERE chat_id = $1 AND shop_id = $2`,
      [chatId, shopId]
    );
  } else {
    await pool.query(
      `UPDATE admins SET on_shift_until = NULL WHERE chat_id = $1 AND shop_id = $2`,
      [chatId, shopId]
    );
  }
}

function isValidFileId(fileId) {
  if (!fileId || typeof fileId !== 'string') return false;
  return /^[A-Za-z0-9_\-]{20,}$/.test(fileId);
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await bot.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
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
  return `https://${YC_BUCKET}.storage.yandexcloud.net/${key}`;
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
    if (photo.startsWith('http://') || photo.startsWith('https://')) {
      return { primary: photo, fallback: null };
    }
    if (isValidFileId(photo)) {
      return { primary: '/photo/tg/' + photo, fallback: null };
    }
    return { primary: null, fallback: null };
  }
  if (typeof photo === 'object') {
    if (photo.s3 && photo.tg) {
      return { primary: photo.s3, fallback: '/photo/tg/' + photo.tg };
    }
    if (photo.s3) {
      return { primary: photo.s3, fallback: null };
    }
    if (photo.tg) return { primary: '/photo/tg/' + photo.tg, fallback: null };
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
    if (photo.tg) return photo.tg;
    if (photo.s3) return photo.s3;
  }
  return null;
}

function renderImgTag(refs, style) {
  if (!refs.primary) return null;
  const p = escAttr(refs.primary);
  const st = style || '';
  if (refs.fallback) {
    const f = escAttr(refs.fallback);
    return `<img src="${p}"${st ? ` style="${st}"` : ''} onerror="this.onerror=null;this.src='${f}'">`;
  }
  return `<img src="${p}"${st ? ` style="${st}"` : ''}>`;
}

function absoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
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
      if (ref && typeof ref === 'string' && (ref.startsWith('http://') || ref.startsWith('https://'))) {
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
        const key = `${shopId}/${Date.now()}_${b.id}_${rand}.jpg`;
        const url = await uploadToS3(buf, key);
        newPhotos.push({ s3: url, tg: ref });
        result.migrated++;
        changed = true;
      } catch (e) {
        console.error('⚠️ Миграция фото не удалась (id=' + b.id + '):', e?.message || e);
        newPhotos.push(ref);
        result.failed++;
      }
    }
    if (changed) {
      await updateBouquetField(b.id, 'photos', JSON.stringify(newPhotos));
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
      if (typeof ref === 'string' && (ref.startsWith('http://') || ref.startsWith('https://'))) {
        result.skipped++;
        continue;
      }
      if (!isValidFileId(ref)) continue;
      try {
        const buf = await downloadTelegramFile(ref);
        const rand = Math.random().toString(36).slice(2, 8);
        const key = `${shopId}/_${field}_${Date.now()}_${rand}.jpg`;
        const url = await uploadToS3(buf, key);
        settings[field] = { s3: url, tg: ref };
        settingsChanged = true;
        result.migrated++;
      } catch (e) {
        console.error('⚠️ Миграция ' + field + ' не удалась:', e?.message || e);
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
  if (fileRef.startsWith('https://') || fileRef.startsWith('http://')) return fileRef;
  if (!isValidFileId(fileRef)) return null;
  const cached = photoUrlCache[fileRef];
  if (cached && cached.expires > Date.now()) return cached.url;
  try {
    const fileInfo = await bot.getFile(fileRef);
    const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    photoUrlCache[fileRef] = { url, expires: Date.now() + 50 * 60 * 1000 };
    return url;
  } catch (e) { return null; }
}const CHECK_PER_PAGE = 25;
const CHECK_SESSION_TTL = 60 * 60 * 1000;
const LIST_PER_PAGE = 25;

function estimateCheckMinutes(count) {
  const sec = count * 15;
  return Math.max(1, Math.ceil(sec / 60));
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
    return { text: '🌿 На витрине нет букетов — проверять нечего.', options: { parse_mode: 'HTML' } };
  }
  const pages = Math.ceil(count / CHECK_PER_PAGE);
  const txt = `✅ <b>Проверка наличия</b>\n\n` +
    `В списке <b>${count}</b> ${plural(count, 'букет', 'букета', 'букетов')}.\n` +
    `Мы разбили их на <b>${pages}</b> ${plural(pages, 'страницу', 'страницы', 'страниц')} по ${CHECK_PER_PAGE}.\n\n` +
    `<i>💾 Если отвлечётесь — не страшно. Проверка сохранится, и вы сможете продолжить с того же места в течение часа.</i>`;
  return {
    text: txt,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Начать проверку', callback_data: 'check_start' }],
          [{ text: '❌ Отмена', callback_data: 'check_cancel' }]
        ]
      }
    }
  };
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function buildCheckListText(session) {
  const total = session.bouquets.length;
  const done = Object.keys(session.checked).length;
  const totalPages = Math.max(1, Math.ceil(total / CHECK_PER_PAGE));
  const page = (session.currentPage || 0) + 1;
  let txt = `✅ <b>Проверка наличия</b>\n`;
  txt += `Страница <b>${page}</b> из <b>${totalPages}</b> · Проверено <b>${done}</b> из <b>${total}</b>\n\n`;
  txt += `<i>Работайте снизу списка, так удобнее.</i>`;
  return txt;
}

function buildCheckListKeyboard(session) {
  const rows = [];
  const total = session.bouquets.length;
  const totalPages = Math.max(1, Math.ceil(total / CHECK_PER_PAGE));
  const page = Math.max(0, Math.min(session.currentPage || 0, totalPages - 1));
  const start = page * CHECK_PER_PAGE;
  const end = Math.min(start + CHECK_PER_PAGE, total);
  const slice = session.bouquets.slice(start, end);

  const checked = slice.filter(b => session.checked[b.id]);
  const unchecked = slice.filter(b => !session.checked[b.id]);

  for (const b of checked) {
    const st = session.checked[b.id];
    const prefix = st === 'yes' ? '✓ ' : '🚫 ';
    rows.push([{ text: `${prefix}№${b.shopNumber} ${shortName(b.name, 16)}`, callback_data: `check_show_${b.id}` }]);
  }

  for (const b of unchecked) {
    rows.push([{ text: `№${b.shopNumber} ${shortName(b.name, 16)}`, callback_data: `check_show_${b.id}` }]);
  }

  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) navRow.push({ text: '⬅️ Назад', callback_data: `check_page_${page - 1}` });
    navRow.push({ text: `${page + 1} / ${totalPages}`, callback_data: 'noop' });
    if (page < totalPages - 1) navRow.push({ text: 'Дальше ➡️', callback_data: `check_page_${page + 1}` });
    rows.push(navRow);
  }

  rows.push([{ text: '⏹ Завершить проверку', callback_data: 'check_finish' }]);
  return rows;
}

async function getArchivedBouquets(shopId) {
  const all = await getBouquetsFromDb(shopId);
  const arch = all.filter(b => {
    const s = getBouquetStatus(b);
    return s === 'hidden' || s === 'expired';
  });
  arch.sort((a, b) => new Date(b.confirmedAt || b.createdAt) - new Date(a.confirmedAt || a.createdAt));
  return arch;
}

async function showArchiveCard(chatId, session) {
  if (session.currentIndex >= session.bouquets.length) {
    const shopId = session.shopId;
    delete archiveSessions[chatId];
    const shop = shopId ? await getShopFromDb(shopId) : null;
    try {
      await bot.sendMessage(chatId, '📦 Архив просмотрен.', shop ? { reply_markup: getMainKeyboard(shop, chatId) } : {});
    } catch (e) { /* ignore */ }
    return;
  }

  if (session.currentIndex === 0 && !session.keyboardHidden) {
    session.keyboardHidden = true;
    try {
      await bot.sendMessage(chatId, '📦 <i>Открываю архив — меню вернётся после закрытия.</i>', {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true }
      });
    } catch (e) { /* ignore */ }
  }

  const b = session.bouquets[session.currentIndex];
  const s = getBouquetStatus(b);
  const statusEmoji = s === 'hidden' ? '🚫' : '❌';
  let dateStr = '';
  if (b.confirmedAt) {
    const d = new Date(b.confirmedAt);
    dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  const caption =
    `📦 <b>${session.currentIndex + 1}/${session.bouquets.length}</b> · <b>№${b.shopNumber}</b>\n` +
    `${esc(b.name)} — <b>${b.price} ₽</b>\n` +
    `<i>${statusEmoji} ${dateStr ? dateStr + ' · ' : ''}${s === 'hidden' ? 'убран вручную' : 'срок истёк'}</i>`;

  const buttons = [
    [
      { text: '↩️ Вернуть', callback_data: 'arch_restore' },
      { text: '⏭ Дальше', callback_data: 'arch_next' },
      { text: '⏹ Закрыть', callback_data: 'arch_close' }
    ]
  ];
  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };

  const firstPhoto = (b.photos && b.photos.length > 0) ? b.photos[0] : null;
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

async function showBouquetList(chatId, shopId, action, headerText, page) {
  const currentPage = page || 0;
  const active = await getBouquetsFromDb(shopId);
  if (active.length === 0) return bot.sendMessage(chatId, '🌿 Нет букетов.');
  active.sort((a, b) => a.shopNumber - b.shopNumber);

  const totalPages = Math.max(1, Math.ceil(active.length / LIST_PER_PAGE));
  const safePage = Math.max(0, Math.min(currentPage, totalPages - 1));
  const start = safePage * LIST_PER_PAGE;
  const shown = active.slice(start, start + LIST_PER_PAGE);

  let listTxt = `${headerText}\n\n`;
  for (const b of shown) {
    listTxt += `<b>№${b.shopNumber}</b> — ${esc(b.name)} — <b>${b.price} ₽</b>\n\n`;
  }
  if (totalPages > 1) {
    listTxt += `<i>Страница ${safePage + 1} из ${totalPages}</i>`;
  }

  const kb = [];
  for (let i = 0; i < shown.length; i += 4) {
    kb.push(shown.slice(i, i + 4).map(b => ({ text: `№${b.shopNumber}`, callback_data: `${action}_${b.id}` })));
  }

  if (totalPages > 1) {
    const navRow = [];
    if (safePage > 0) navRow.push({ text: '⬅️ Назад', callback_data: `bqlist_${action}_${safePage - 1}` });
    navRow.push({ text: `${safePage + 1} / ${totalPages}`, callback_data: 'noop' });
    if (safePage < totalPages - 1) navRow.push({ text: 'Дальше ➡️', callback_data: `bqlist_${action}_${safePage + 1}` });
    kb.push(navRow);
  }

  return bot.sendMessage(chatId, listTxt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function sendBouquetPreview(chatId, b, headerText, buttons) {
  const caption = `${headerText}\n\n<b>№${b.shopNumber}</b> ${esc(b.name)}\n💰 ${b.price} ₽`;
  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };
  const firstPhoto = (b.photos && b.photos.length > 0) ? b.photos[0] : null;
  const tgRef = getTelegramPhotoRef(firstPhoto);
  if (tgRef) {
    try {
      await bot.sendPhoto(chatId, tgRef, { caption: caption, parse_mode: 'HTML', reply_markup: opts.reply_markup });
      return;
    } catch (e) { /* фолбэк */ }
  }
  try {
    await bot.sendMessage(chatId, caption, opts);
  } catch (e) { /* ignore */ }
}

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
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50)`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS max_username VARCHAR(500)`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS blocked_reason TEXT`);

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
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS on_shift_until TIMESTAMPTZ`);

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
  await pool.query(`ALTER TABLE bouquets ADD COLUMN IF NOT EXISTS shop_number INTEGER`);
  await pool.query(`ALTER TABLE bouquets ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`);

  await pool.query(`
    UPDATE bouquets SET shop_number = sub.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY id) AS rn
      FROM bouquets WHERE shop_number IS NULL
    ) sub
    WHERE bouquets.id = sub.id
  `);

  try {
    const existing = await pool.query(`SELECT id, name FROM bouquets WHERE tags IS NULL OR tags = '[]'::jsonb`);
    for (const row of existing.rows) {
      const tags = extractTagsFromName(row.name);
      if (tags.length > 0) {
        await pool.query(`UPDATE bouquets SET tags = $2 WHERE id = $1`, [row.id, JSON.stringify(tags)]);
      }
    }
    if (existing.rows.length > 0) {
      console.log(`🏷 Проставлены теги у ${existing.rows.length} букетов`);
    }
  } catch (e) {
    console.error('⚠️ Ошибка миграции тегов:', e?.message || e);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bouquets_shop_active ON bouquets(shop_id, deleted, is_pinned, confirmed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bouquets_shop_number ON bouquets(shop_id, shop_number)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admins_chat_id ON admins(chat_id)`);

  console.log('✅ Таблицы БД готовы');
}

async function getShopFromDb(shopId) {
  const res = await pool.query('SELECT * FROM shops WHERE shop_id = $1', [shopId]);
  if (res.rows.length === 0) return null;
  const s = res.rows[0];
  const admins = await pool.query('SELECT * FROM admins WHERE shop_id = $1', [shopId]);
  return {
    shopId: s.shop_id, name: s.name, displayName: s.display_name,
    address: s.address, hours: s.hours, phone: s.phone,
    telegramUsername: s.telegram_username,
    whatsappPhone: s.whatsapp_phone, maxLink: s.max_username,
    inviteCode: s.invite_code, trialStart: s.trial_start, trialEnd: s.trial_end,
    blocked: !!s.blocked, blockedReason: s.blocked_reason || null,
    settings: s.settings || { logo: null, background: null, markupPercent: 20, aiEnabled: false },
    stats: s.stats || { views: 0, orders: 0, calls: 0, startedAt: new Date().toISOString() },
    admins: admins.rows.map(a => ({
      chatId: parseInt(a.chat_id),
      role: a.role,
      name: a.name,
      joinedAt: a.joined_at,
      onShift: !!(a.on_shift_until && new Date(a.on_shift_until) > new Date())
    }))
  };
}

async function createShopInDb(shop) {
  await pool.query(`
    INSERT INTO shops (shop_id, name, display_name, address, hours, phone, telegram_username, whatsapp_phone, max_username, invite_code, trial_start, trial_end, settings, stats)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    shop.shopId, shop.name, shop.displayName, shop.address, shop.hours, shop.phone,
    shop.telegramUsername, shop.whatsappPhone || null, shop.maxLink || null,
    shop.inviteCode, shop.trialStart, shop.trialEnd,
    JSON.stringify(shop.settings), JSON.stringify(shop.stats)
  ]);
}

async function updateShopField(shopId, field, value) {
  const allowed = ['display_name','address','hours','phone','telegram_username','whatsapp_phone','max_username'];
  if (!allowed.includes(field)) return;
  await pool.query(`UPDATE shops SET ${field} = $2 WHERE shop_id = $1`, [shopId, value]);
}

async function saveShopSettings(shopId, settings) {
  await pool.query('UPDATE shops SET settings = $2 WHERE shop_id = $1', [shopId, JSON.stringify(settings)]);
}
async function incrementShopStat(shopId, field) {
  await pool.query(`UPDATE shops SET stats = stats || jsonb_build_object('${field}', COALESCE((stats->>'${field}')::int, 0) + 1) WHERE shop_id = $1`, [shopId]);
}
async function addAdminToDb(chatId, shopId, role, name) {
  await pool.query(`INSERT INTO admins (chat_id, shop_id, role, name) VALUES ($1,$2,$3,$4) ON CONFLICT (chat_id, shop_id) DO NOTHING`, [chatId, shopId, role, name]);
}
async function removeAdminFromDb(chatId, shopId) {
  await pool.query('DELETE FROM admins WHERE chat_id = $1 AND shop_id = $2', [chatId, shopId]);
}
async function getBouquetsFromDb(shopId, includeDeleted) {
  let query = 'SELECT * FROM bouquets WHERE shop_id = $1';
  if (!includeDeleted) query += ' AND deleted = FALSE';
  query += ' ORDER BY is_pinned DESC, confirmed_at DESC NULLS LAST, created_at DESC';
  const res = await pool.query(query, [shopId]);
  return res.rows.map(mapBouquet);
}
async function getBouquetById(shopId, bouquetId) {
  const res = await pool.query('SELECT * FROM bouquets WHERE id = $1 AND shop_id = $2 AND deleted = FALSE', [bouquetId, shopId]);
  if (res.rows.length === 0) return null;
  return mapBouquet(res.rows[0]);
}
function mapBouquet(b) {
  return {
    id: b.id,
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
  const r = await pool.query('SELECT COALESCE(MAX(shop_number), 0) + 1 AS next FROM bouquets WHERE shop_id = $1', [shopId]);
  const shopNumber = r.rows[0].next;
  const res = await pool.query(`
    INSERT INTO bouquets (shop_id, shop_number, name, price, description, photos, confirmed_at, is_pinned, chat_id, clicks, tags)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, shop_number
  `, [
    shopId, shopNumber, bouquet.name, bouquet.price, bouquet.description,
    JSON.stringify(bouquet.photos), new Date().toISOString(),
    bouquet.isPinned, bouquet.chatId, bouquet.clicks || 0,
    JSON.stringify(bouquet.tags || [])
  ]);
  return { id: res.rows[0].id, shopNumber: res.rows[0].shop_number };
}
async function updateBouquetField(id, field, value) {
  await pool.query(`UPDATE bouquets SET ${field} = $2 WHERE id = $1`, [id, value]);
}
async function updateBouquetFields(id, updates) {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setStr = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE bouquets SET ${setStr} WHERE id = $1`, [id, ...values]);
}
async function getShopByInvite(inviteCode) {
  const res = await pool.query('SELECT shop_id FROM shops WHERE invite_code = $1', [inviteCode]);
  return res.rows.length > 0 ? res.rows[0].shop_id : null;
}
async function findUserShop(chatId) {
  const res = await pool.query('SELECT shop_id FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]);
  return res.rows.length > 0 ? res.rows[0].shop_id : null;
}

async function getAllShopsAdmin() {
  const res = await pool.query(`
    SELECT
      s.shop_id, s.display_name, s.trial_end, s.stats, s.blocked,
      (SELECT COUNT(*) FROM bouquets b WHERE b.shop_id = s.shop_id AND b.deleted = FALSE) AS bouquets_count,
      (SELECT COUNT(*) FROM admins a WHERE a.shop_id = s.shop_id) AS team_count
    FROM shops s
    ORDER BY s.trial_end DESC NULLS LAST
  `);
  return res.rows.map(r => {
    const stats = r.stats || {};
    return {
      shopId: r.shop_id,
      displayName: r.display_name,
      trialEnd: r.trial_end,
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
    `UPDATE shops SET trial_end = GREATEST(COALESCE(trial_end, NOW()), NOW()) + ($2 || ' days')::INTERVAL WHERE shop_id = $1`,
    [shopId, String(days)]
  );
}

async function blockShop(shopId, reason) {
  await pool.query(`UPDATE shops SET blocked = TRUE, blocked_reason = $2 WHERE shop_id = $1`, [shopId, reason]);
}

async function unblockShop(shopId) {
  await pool.query(`UPDATE shops SET blocked = FALSE, blocked_reason = NULL WHERE shop_id = $1`, [shopId]);
}

function getMainKeyboard(shop, chatId) {
  const owner = isOwner(shop, chatId);
  const me = shop && shop.admins ? shop.admins.find(a => a.chatId === chatId) : null;
  const onShift = !!(me && me.onShift);
  const shiftBtn = onShift
    ? { text: '🚪 Закончить работу' }
    : { text: '✅ Я сегодня работаю' };

  if (owner) {
    return { keyboard: [
      [{ text: '📷 Добавить букет' }, { text: '✅ Что в наличии?' }],
      [{ text: '✏️ Изменить цену' }, { text: '📝 Переименовать' }],
      [{ text: '🗑 Удалить букет' }, { text: '📦 Архив' }],
      [shiftBtn],
      [{ text: '🔄 Обновить' }, { text: '⚙️ Меню' }]
    ], resize_keyboard: true };
  }
  return { keyboard: [
    [{ text: '📷 Добавить букет' }, { text: '✅ Что в наличии?' }],
    [{ text: '✏️ Изменить цену' }, { text: '📝 Переименовать' }],
    [{ text: '📦 Архив' }],
    [shiftBtn],
    [{ text: '🔄 Обновить' }, { text: '⚙️ Меню' }]
  ], resize_keyboard: true };
}

function getSettingsMenu(shop, chatId) {
  if (isOwner(shop, chatId)) {
    return { reply_markup: { inline_keyboard: [
      [{ text: '🔗 Ссылка на витрину', callback_data: 'menu_link' }],
      [{ text: '🔑 Пригласить флориста', callback_data: 'menu_invite' }],
      [{ text: '👥 Управление флористами', callback_data: 'menu_team' }],
      [{ text: '🏪 Данные магазина', callback_data: 'menu_shopdata' }],
      [{ text: '📊 Статистика', callback_data: 'menu_stats' }],
      [{ text: '💰 Наценка', callback_data: 'menu_markup' }],
      [{ text: '🎨 Логотип', callback_data: 'menu_logo' }, { text: '🖼 Фон', callback_data: 'menu_background' }],
      [{ text: '📋 Статус магазина', callback_data: 'menu_status' }],
      [{ text: '💳 Продлить подписку', callback_data: 'menu_renew' }],
      [{ text: '❌ Закрыть', callback_data: 'menu_close' }]
    ] } };
  }
  return { reply_markup: { inline_keyboard: [
    [{ text: '🔗 Ссылка на витрину', callback_data: 'menu_link' }],
    [{ text: '📋 Статус магазина', callback_data: 'menu_status' }],
    [{ text: '❌ Закрыть', callback_data: 'menu_close' }]
  ] } };
}

function buildShopDataMessage(shop) {
  let txt = `🏪 <b>Данные магазина</b>\n\n`;
  txt += `📝 Название: ${esc(shop.displayName)}\n`;
  txt += `📍 Адрес: ${shop.address ? esc(shop.address) : '<i>не указан</i>'}\n`;
  txt += `🕐 Часы: ${shop.hours ? esc(shop.hours) : '<i>не указаны</i>'}\n`;
  txt += `📞 Телефон: ${shop.phone ? esc(formatPhone(shop.phone)) : '<i>не указан</i>'}\n\n`;
  txt += `📱 Telegram: ${shop.telegramUsername ? '@' + esc(shop.telegramUsername) : '<i>не указан</i>'}\n`;
  txt += `💬 WhatsApp: ${shop.whatsappPhone ? esc(formatPhone(shop.whatsappPhone)) : '<i>не указан</i>'}\n`;
  txt += `🅼 MAX: ${shop.maxLink ? '✅ установлена' : '<i>не указана</i>'}\n\n`;
  txt += `<i>Что изменить?</i>`;
  return {
    text: txt,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📝 Название', callback_data: 'edit_shop_displayname' }],
          [{ text: '📍 Адрес', callback_data: 'edit_shop_address' }],
          [{ text: '🕐 Часы работы', callback_data: 'edit_shop_hours' }],
          [{ text: '📞 Телефон', callback_data: 'edit_shop_phone' }],
          [{ text: '📱 Telegram', callback_data: 'edit_shop_telegram' }],
          [{ text: '💬 WhatsApp', callback_data: 'edit_shop_whatsapp' }],
          [{ text: '🅼 MAX', callback_data: 'edit_shop_max' }],
          [{ text: '↩️ Назад', callback_data: 'menu_back' }]
        ]
      }
    }
  };
}

function buildMessengerOrderPage({ shop, bouquet, orderText, messenger }) {
  const isMax = messenger === 'max';
  const messengerName = isMax ? 'MAX' : 'Telegram';
  const messengerEmoji = isMax ? '🅼' : '📩';
  const buttonColor = isMax ? '#7B68EE' : '#229ED9';
  const externalLink = isMax ? esc(shop.maxLink) : `https://t.me/${esc(shop.telegramUsername)}`;
  const orderTextJs = JSON.stringify(orderText);
  const orderTextEsc = esc(orderText);
  const shopNameEsc = esc(shop.displayName);
  const shopIdEsc = esc(shop.shopId);
  const bouquetNameEsc = esc(bouquet.name);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Перейти в ${messengerName} — ${shopNameEsc}</title>
<style>
  body{font-family:-apple-system,sans-serif;margin:0;padding:20px;background:#fafaf8;text-align:center;color:#2c3e50;}
  .container{max-width:500px;margin:0 auto;padding:12px 0;}
  h1{font-size:22px;margin:8px 0 4px;}
  .sub{color:#666;font-size:14px;margin-bottom:16px;}
  .card{background:#fff;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 2px 8px rgba(0,0,0,0.08);}
  .quote{background:#f5f5f5;border-radius:12px;padding:16px;text-align:left;font-size:16px;line-height:1.5;margin:16px 0;color:#333;white-space:pre-wrap;word-break:break-word;}
  .btn{display:block;width:100%;padding:16px;border-radius:30px;font-size:17px;font-weight:bold;text-decoration:none;border:none;cursor:pointer;margin-top:12px;box-sizing:border-box;font-family:inherit;}
  .btn-copy{background:#3498db;color:#fff;}
  .btn-copy.copied{background:#27ae60;}
  .btn-open{background:${buttonColor};color:#fff;}
  .steps{text-align:left;color:#555;font-size:14px;line-height:1.6;margin:12px 0;}
  .steps b{color:#2c3e50;}
  .back{display:inline-block;margin-top:20px;color:#888;text-decoration:none;font-size:14px;}
</style>
</head>
<body>
  <div class="container">
    <h1>${messengerEmoji} Перейти в ${messengerName}</h1>
    <div class="sub">Букет №${bouquet.shopNumber} — ${bouquetNameEsc} — ${bouquet.price} ₽</div>
    <div class="card">
      <div class="steps">
        <b>1.</b> Скопируйте текст ниже<br>
        <b>2.</b> Нажмите «Открыть ${messengerName}»<br>
        <b>3.</b> Вставьте текст в чат и отправьте
      </div>
      <div class="quote" id="orderText">${orderTextEsc}</div>
      <button class="btn btn-copy" id="copyBtn" onclick="copyOrder()">📋 Скопировать текст</button>
      <a class="btn btn-open" href="${externalLink}" target="_blank" rel="noopener">${messengerEmoji} Открыть ${messengerName}</a>
    </div>
    <a class="back" href="/shop/${shopIdEsc}">← Вернуться на витрину</a>
  </div>
  <script>
    function copyOrder() {
      var text = ${orderTextJs};
      var btn = document.getElementById('copyBtn');
      function done() {
        btn.textContent = '✅ Скопировано!';
        btn.classList.add('copied');
        setTimeout(function(){ btn.textContent = '📋 Скопировать текст'; btn.classList.remove('copied'); }, 2500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy(text, done); });
      } else { fallbackCopy(text, done); }
    }
    function fallbackCopy(text, cb) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); cb(); } catch(e) {}
      document.body.removeChild(ta);
    }
  </script>
</body>
</html>`;
}

function buildBouquetPage({ shop, bouquet, photoRefs, otherPhotoRefs }) {
  const bouquetNameEsc = esc(bouquet.name);
  const bouquetIdEsc = esc(shop.shopId);
  const oldPrice = calculateOldPrice(bouquet.price, shop.settings.markupPercent);
  const bouquetUrl = `${SITE_URL}/shop/${esc(shop.shopId)}/b/${bouquet.id}`;
  const title = `${bouquetNameEsc} — ${esc(shop.displayName)}`;
  const description = `${bouquet.price} ₽ · ${esc(shop.displayName)}`;
  const primaryPhotoUrl = (photoRefs && photoRefs.primary) ? absoluteUrl(photoRefs.primary) : null;
  const ogTags = primaryPhotoUrl ? `
<meta property="og:image" content="${escAttr(primaryPhotoUrl)}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="800">
<meta name="twitter:image" content="${escAttr(primaryPhotoUrl)}">` : '';
  const mainPhotoHtml = (photoRefs && photoRefs.primary)
    ? renderImgTag(photoRefs, 'width:100%;max-width:500px;border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,0.1);')
    : `<div style="width:100%;max-width:500px;aspect-ratio:1/1;background:#f0f0f0;border-radius:16px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:60px;margin:0 auto;">📷</div>`;
  let thumbsHtml = '';
  if (otherPhotoRefs && otherPhotoRefs.length > 0) {
    thumbsHtml = `<div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap;">${
      otherPhotoRefs.map(r => renderImgTag(r, 'width:70px;height:70px;object-fit:cover;border-radius:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.1);')).join('')
    }</div>`;
  }
  let buttonsHTML = '';
  if (shop.telegramUsername) buttonsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/tg" style="display:block;margin-top:10px;background:#229ED9;color:#fff;padding:14px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;font-size:16px;">📩 Написать в Telegram</a>`;
  if (shop.whatsappPhone) buttonsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/wa" style="display:block;margin-top:8px;background:#25D366;color:#fff;padding:14px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;font-size:16px;">💬 Написать в WhatsApp</a>`;
  if (shop.maxLink) buttonsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/max" style="display:block;margin-top:8px;background:#7B68EE;color:#fff;padding:14px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;font-size:16px;">🅼 Написать в MAX</a>`;
  if (shop.phone) buttonsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/call" style="display:block;margin-top:8px;background:#3498db;color:#fff;padding:14px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;font-size:16px;">📞 Позвонить</a>`;
  const priceHtml = oldPrice > bouquet.price
    ? `<span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:20px;">${oldPrice} ₽</span>&nbsp; ${bouquet.price} ₽`
    : `${bouquet.price} ₽`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta property="og:type" content="product">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${escAttr(bouquetUrl)}">
<meta property="og:site_name" content="Flowind">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">${ogTags}
<style>
  body{font-family:-apple-system,sans-serif;margin:0;padding:20px;background:#fafaf8;text-align:center;color:#2c3e50;}
  .container{max-width:560px;margin:0 auto;padding:12px 0;}
  .back{display:inline-block;margin-bottom:16px;color:#888;text-decoration:none;font-size:14px;}
  h1{font-size:24px;margin:16px 0 8px;line-height:1.3;}
  .price{font-size:28px;font-weight:bold;margin:8px 0 20px;color:#2c3e50;}
  .card{background:#fff;border-radius:20px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin:20px 0;}
  .share{display:inline-block;margin-top:20px;color:#888;text-decoration:none;font-size:14px;padding:10px 16px;border-radius:20px;background:#f0f0f0;}
</style>
</head>
<body>
  <div class="container">
    <a class="back" href="/shop/${bouquetIdEsc}">← К витрине</a>
    <div>${mainPhotoHtml}</div>
    ${thumbsHtml}
    <h1>${bouquetNameEsc}</h1>
    <div class="price">${priceHtml}</div>
    <div class="card">${buttonsHTML || '<div style="color:#888;padding:10px;">Контакты временно недоступны</div>'}</div>
    <a class="share" href="#" onclick="shareBouquet(); return false;">📤 Поделиться с близкими</a>
  </div>
  <script>
    function shareBouquet() {
      var url = ${JSON.stringify(bouquetUrl)};
      var name = ${JSON.stringify(bouquet.name)};
      var price = ${bouquet.price};
      var text = name + ' — ' + price + ' ₽';
      if (navigator.share) {
        navigator.share({ title: name, text: text, url: url }).catch(function(){});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function(){ alert('Ссылка скопирована — вставьте её в мессенджер'); }).catch(function(){ prompt('Скопируйте ссылку:', url); });
      } else { prompt('Скопируйте ссылку:', url); }
    }
  </script>
</body>
</html>`;
}

function buildContactPage({ shop, bouquet, photoRefs }) {
  const bouquetNameEsc = esc(bouquet.name);
  const bouquetIdEsc = esc(shop.shopId);
  const oldPrice = calculateOldPrice(bouquet.price, shop.settings.markupPercent);
  const orderText = `Здравствуйте! Пишу с вашей витрины. Хочу заказать букет №${bouquet.shopNumber} «${bouquet.name}» — ${bouquet.price} ₽.`;
  const orderTextJs = JSON.stringify(orderText);
  const orderTextEsc = esc(orderText);

  const mainPhotoHtml = (photoRefs && photoRefs.primary)
    ? renderImgTag(photoRefs, 'width:100%;max-width:420px;border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,0.1);')
    : `<div style="width:100%;max-width:420px;aspect-ratio:1/1;background:#f0f0f0;border-radius:16px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:60px;margin:0 auto;">📷</div>`;

  const priceHtml = oldPrice > bouquet.price
    ? `<span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:20px;">${oldPrice} ₽</span>&nbsp; ${bouquet.price} ₽`
    : `${bouquet.price} ₽`;

  const btnBase = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px;border-radius:30px;font-size:17px;font-weight:bold;text-decoration:none;border:none;cursor:pointer;margin-top:10px;box-sizing:border-box;font-family:inherit;color:#fff;';
  let contactsHTML = '';
  if (shop.whatsappPhone) {
    contactsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/wa" style="${btnBase}background:#25D366;">💬 WhatsApp</a>`;
  }
  if (shop.telegramUsername) {
    contactsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/tg" style="${btnBase}background:#229ED9;">📩 Telegram</a>`;
  }
  if (shop.maxLink) {
    contactsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/max" style="${btnBase}background:#7B68EE;">🅼 MAX</a>`;
  }
  if (shop.phone) {
    contactsHTML += `<a href="/go/${esc(shop.shopId)}/${bouquet.id}/call" style="${btnBase}background:#3498db;">📞 Позвонить</a>`;
  }

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Связаться — ${bouquetNameEsc}</title>
<style>
  body{font-family:-apple-system,sans-serif;margin:0;padding:20px;background:#fafaf8;text-align:center;color:#2c3e50;}
  .container{max-width:500px;margin:0 auto;padding:12px 0;}
  .back{display:inline-block;margin-bottom:16px;color:#888;text-decoration:none;font-size:14px;}
  h1{font-size:20px;margin:14px 0 6px;line-height:1.3;}
  .price{font-size:24px;font-weight:bold;margin:6px 0 16px;color:#2c3e50;}
  .card{background:#fff;border-radius:20px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin:16px 0;}
  .quote{background:#f5f5f5;border-radius:12px;padding:14px;text-align:left;font-size:15px;line-height:1.5;margin:0 0 12px;color:#333;white-space:pre-wrap;word-break:break-word;}
  .copy{display:block;width:100%;padding:12px;border-radius:24px;font-size:15px;font-weight:bold;background:#e8e8e8;color:#333;border:none;cursor:pointer;font-family:inherit;}
  .copy.copied{background:#27ae60;color:#fff;}
</style>
</head>
<body>
  <div class="container">
    <a class="back" href="/shop/${bouquetIdEsc}">← К витрине</a>

    <div>${mainPhotoHtml}</div>
    <h1>${bouquetNameEsc}</h1>
    <div class="price">${priceHtml}</div>

    <div class="card">
      <div style="font-size:16px;font-weight:bold;color:#2c3e50;margin-bottom:12px;">Как связаться с флористом?</div>
      ${contactsHTML || '<div style="color:#888;padding:10px;">Контакты временно недоступны</div>'}
    </div>

    <div class="card" style="text-align:left;">
      <div style="font-size:14px;color:#555;margin-bottom:10px;">
        💡 Можно скопировать готовый текст заказа и вставить в чат:
      </div>
      <div class="quote">${orderTextEsc}</div>
      <button class="copy" id="copyBtn" onclick="copyOrder()">📋 Скопировать текст</button>
    </div>
  </div>
  <script>
    function copyOrder() {
      var text = ${orderTextJs};
      var btn = document.getElementById('copyBtn');
      function done() {
        btn.textContent = '✅ Скопировано!';
        btn.classList.add('copied');
        setTimeout(function(){ btn.textContent = '📋 Скопировать текст'; btn.classList.remove('copied'); }, 2500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy(text, done); });
      } else { fallbackCopy(text, done); }
    }
    function fallbackCopy(text, cb) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); cb(); } catch(e) {}
      document.body.removeChild(ta);
    }
  </script>
</body>
</html>`;
}

// === ПРОКСИ S3 ЧЕРЕЗ RENDER ===
app.get('/photo/s3/*', async (req, res) => {
  try {
    const key = req.params[0];
    if (!key || key.includes('..')) return res.status(400).send('bad');
    if (!s3) return res.status(503).send('s3 disabled');

    const cmd = new GetObjectCommand({ Bucket: YC_BUCKET, Key: key });
    const data = await s3.send(cmd);

    res.setHeader('Content-Type', data.ContentType || 'image/jpeg');
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
    if (!isValidFileId(fileId)) return res.status(400).send('bad');
    const fileInfo = await bot.getFile(fileId);
    if (!fileInfo || !fileInfo.file_path) return res.status(404).send('not found');
    const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    res.setHeader('Cache-Control', 'public, max-age=2400');
    return res.redirect(302, url);
  } catch (e) {
    console.error('Ошибка /photo/tg:', e?.message || e);
    return res.status(404).send('not found');
  }
});

app.get('/contact/:shopId/:bouquetId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) return res.status(404).send('❌ Магазин не найден');
    const bouquetId = parseInt(req.params.bouquetId);
    if (!bouquetId || isNaN(bouquetId)) return res.status(404).send('❌ Букет не найден');
    const b = await getBouquetById(req.params.shopId, bouquetId);
    if (!b) return res.status(404).send('❌ Букет не найден');
    const firstPhoto = (b.photos && b.photos.length > 0) ? b.photos[0] : null;
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
    if (!bouquetId || isNaN(bouquetId)) return res.status(404).send('Не найдено');
    const shop = await getShopFromDb(shopId);
    if (!shop) return res.status(404).send('Не найдено');
    const b = await getBouquetById(shopId, bouquetId);
    if (!b) return res.status(404).send('Букет не найден');

    const orderText = `Здравствуйте! Пишу с вашей витрины. Хочу заказать букет №${b.shopNumber} «${b.name}» — ${b.price} ₽.`;

    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    const clickKey = `${shopId}:${bouquetId}:${type}:${clientIp}`;
    const now = Date.now();
    const lastNotified = notifiedClicks[clickKey];
    if (!lastNotified || now - lastNotified > CLICK_NOTIFY_TTL) {
      notifiedClicks[clickKey] = now;
      sendClickNotification(shop, b, type);
    }

    if (type === 'max' && shop.maxLink) {
      await incrementShopStat(shopId, 'orders');
      await pool.query('UPDATE bouquets SET clicks = COALESCE(clicks, 0) + 1 WHERE id = $1', [b.id]);
      return res.send(buildMessengerOrderPage({ shop, bouquet: b, orderText, messenger: 'max' }));
    }
    if (type === 'tg' && shop.telegramUsername) {
      await incrementShopStat(shopId, 'orders');
      await pool.query('UPDATE bouquets SET clicks = COALESCE(clicks, 0) + 1 WHERE id = $1', [b.id]);
      return res.send(buildMessengerOrderPage({ shop, bouquet: b, orderText, messenger: 'tg' }));
    }
    let redirectUrl = null;
    if (type === 'wa' && shop.whatsappPhone) {
      const waPhone = shop.whatsappPhone.replace(/\D/g, '');
      redirectUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(orderText)}`;
      await incrementShopStat(shopId, 'orders');
    } else if (type === 'call' && shop.phone) {
      redirectUrl = `tel:${shop.phone.replace(/\D/g, '')}`;
      await incrementShopStat(shopId, 'calls');
    }
    if (!redirectUrl) return res.status(404).send('Контакт не настроен');
    await pool.query('UPDATE bouquets SET clicks = COALESCE(clicks, 0) + 1 WHERE id = $1', [b.id]);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=${redirectUrl}"><title>Переход…</title></head><body style="font-family:-apple-system,sans-serif;text-align:center;padding:50px;color:#555;"><p>Переходим к продавцу…</p><p><a href="${redirectUrl}">Нажмите здесь, если не переходит автоматически</a></p></body></html>`);
  } catch (e) {
    console.error('Ошибка /go:', e?.message || e);
    res.status(500).send('Ошибка');
  }
});

app.get('/shop/:shopId/b/:bouquetId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) return res.status(404).send('❌ Магазин не найден');
    const bouquetId = parseInt(req.params.bouquetId);
    if (!bouquetId || isNaN(bouquetId)) return res.status(404).send('❌ Букет не найден');
    const b = await getBouquetById(req.params.shopId, bouquetId);
    if (!b) return res.status(404).send('❌ Букет не найден');
    const photoRefsList = [];
    for (const p of b.photos) {
      const r = getPhotoRefs(p);
      if (r.primary) photoRefsList.push(r);
    }
    const mainRef = photoRefsList[0] || null;
    const otherRefs = photoRefsList.slice(1);
    res.send(buildBouquetPage({ shop, bouquet: b, photoRefs: mainRef, otherPhotoRefs: otherRefs }));
  } catch (e) {
    console.error('Ошибка страницы букета:', e?.message || e);
    res.status(500).send('Ошибка');
  }
});// ========= РЕГИСТРАЦИЯ МАГАЗИНА =========
const REG_STEPS = {
  shopId: {
    text: '📝 <b>Шаг 1 из 8. Короткое название для ссылки</b>\n\n' +
          'Только латинские буквы, цифры и _, без пробелов.\n' +
          'Например: <code>cveti_msk</code>\n\n' +
          'Это будет адрес витрины: <code>flowind.ru/shop/cveti_msk</code>\n\n' +
          '<i>Если не знаете — нажмите «Пропустить», я сгенерирую сам.</i>',
    skip: true,
    mandatory: true
  },
  displayName: {
    text: '✅ <b>Шаг 2 из 8. Красивое название</b>\n\n' +
          'Как назвать магазин для клиентов?\n' +
          'Оно появится на витрине. Можно с эмодзи.\n\n' +
          'Например: <i>🌸 Цветы на Фрунзе</i>',
    skip: false,
    mandatory: true
  },
  address: {
    text: '✅ <b>Шаг 3 из 8. Адрес</b>\n\n' +
          'Клиенты увидят адрес на витрине.\n' +
          'Например: <i>Москва, ул. Фрунзе, 15</i>\n\n' +
          '<i>Можно пропустить и добавить позже.</i>',
    skip: true,
    mandatory: false
  },
  hours: {
    text: '✅ <b>Шаг 4 из 8. Часы работы</b>\n\n' +
          'Например: <i>Пн-Вс 10:30-21:00</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true,
    mandatory: false
  },
  phone: {
    text: '✅ <b>Шаг 5 из 8. Телефон</b>\n\n' +
          'Для кнопки «Позвонить» на витрине.\n' +
          'Например: <i>+7 962 402-51-75</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true,
    mandatory: false
  },
  telegram: {
    text: '✅ <b>Шаг 6 из 8. Ваш юзернейм в Telegram</b>\n\n' +
          'Клиенты будут писать вам, нажав кнопку на витрине.\n' +
          'Пришлите без @.\n\n' +
          'Например: если ваш юзернейм @KupidonAdm — напишите <code>KupidonAdm</code>\n\n' +
          '<i>Если у вас нет юзернейма — можно пропустить, и клиенты смогут только позвонить или написать в WhatsApp.</i>',
    skip: true,
    mandatory: false
  },
  whatsapp: {
    text: '✅ <b>Шаг 7 из 8. Номер WhatsApp</b>\n\n' +
          'Клиенты смогут написать вам одним нажатием.\n' +
          'Например: <i>+7 962 402-51-75</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true,
    mandatory: false
  },
  max: {
    text: '✅ <b>Шаг 8 из 8. Ссылка на профиль в MAX</b>\n\n' +
          '<i>Можно пропустить и добавить позже — «Меню» → «🏪 Данные магазина».</i>\n\n' +
          'Она начинается с <code>https://max.ru/u/...</code>\n\n' +
          'Пришлите её сюда или нажмите «Пропустить».',
    skip: true,
    mandatory: false
  }
};

const REG_ORDER = ['shopId', 'displayName', 'address', 'hours', 'phone', 'telegram', 'whatsapp', 'max'];

const REG_FINAL_TEXT = (shopId, displayName) =>
  `🎉 <b>Готово! Ваша витрина создана.</b>\n\n` +
  `🏪 Магазин: «${esc(displayName)}»\n\n` +
  `🔗 <b>Ссылка для клиентов:</b>\n${SITE_URL}/shop/${shopId}\n\n` +
  `━━━━━━━━━━━━━━━\n\n` +
  `📷 <b>Что делать дальше:</b>\n\n` +
  `1. Нажмите «📷 Добавить букет» и отправьте фото с подписью.\n\n` +
  `2. В подписи: название + пробел + цена.\n` +
  `   ✅ <code>31 роза 3500</code>\n` +
  `   ✅ <code>Пионы 4500</code>\n` +
  `   ❌ <code>31 роза 3500 сорт Аваланж цена</code>\n` +
  `      (цена должна быть последней)\n\n` +
  `3. Букет сразу появится на витрине.\n\n` +
  `4. Через 3 дня бот напомнит — надо будет подтвердить, что он ещё есть.\n\n` +
  `━━━━━━━━━━━━━━━\n\n` +
  `⚙️ Чтобы заполнить адрес, телефон и другое — «Меню» → «🏪 Данные магазина»\n\n` +
  `💡 Если что-то непонятно — напишите <code>/cancel</code> и начните заново.\n\n` +
  `<b>Попробуйте прямо сейчас — отправьте первый букет.</b>`;

async function generateUniqueShopId() {
  for (let i = 0; i < 20; i++) {
    const id = generateShopId();
    if (!(await getShopFromDb(id))) return id;
  }
  return generateShopId() + Date.now().toString(36).slice(-4);
}

async function startRegistration(chatId, userName, userUsername) {
  const existing = userToShop[chatId] || await findUserShop(chatId);
  if (existing) {
    return bot.sendMessage(chatId, '❌ Уже привязаны к магазину.');
  }
  registrationState[chatId] = { step: 'shopId', data: {}, messageId: null, userName: userName || null, userUsername: userUsername || null };
  await sendRegistrationStep(chatId, registrationState[chatId]);
}

async function sendRegistrationStep(chatId, state) {
  const stepConfig = REG_STEPS[state.step];
  if (!stepConfig) { delete registrationState[chatId]; return; }
  const opts = { parse_mode: 'HTML' };
  if (stepConfig.skip) {
    opts.reply_markup = { inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: 'reg_skip' }]] };
  }
  const msg = await bot.sendMessage(chatId, stepConfig.text, opts);
  state.messageId = msg.message_id;
}

async function regGoToNextStep(chatId, state) {
  const idx = REG_ORDER.indexOf(state.step);
  if (idx === -1 || idx >= REG_ORDER.length - 1) return regFinish(chatId, state);
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
    const clean = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!clean || clean.length < 2) {
      return bot.sendMessage(chatId, '❌ Только латинские буквы, цифры и _ (минимум 2 символа). Попробуйте ещё раз или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    if (await getShopFromDb(clean)) {
      return bot.sendMessage(chatId, '❌ Это имя уже занято. Попробуйте другое или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.shopId = clean;
  } else if (step === 'displayName') {
    if (value.length < 2 || value.length > 60) {
      return bot.sendMessage(chatId, '❌ Название должно быть от 2 до 60 символов. Попробуйте ещё раз.');
    }
    state.data.displayName = value;
  } else if (step === 'address') {
    state.data.address = value;
  } else if (step === 'hours') {
    state.data.hours = value;
  } else if (step === 'phone') {
    const norm = normalizePhone(value);
    if (!norm) {
      return bot.sendMessage(chatId, '❌ Похоже на опечатку. Пришлите номер целиком.\nНапример: <i>+7 962 402-51-75</i>\n\nИли нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.phone = norm;
  } else if (step === 'telegram') {
    const clean = value.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      return bot.sendMessage(chatId, '❌ Юзернейм — только латиница, цифры, _ (от 3 до 32 символов). Попробуйте ещё раз или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.telegramUsername = clean;
  } else if (step === 'whatsapp') {
    const norm = normalizePhone(value);
    if (!norm) {
      return bot.sendMessage(chatId, '❌ Похоже на опечатку. Пришлите номер целиком.\nНапример: <i>+7 962 402-51-75</i>\n\nИли нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.whatsappPhone = norm;
  } else if (step === 'max') {
    if (!/^https?:\/\/max\.ru\//.test(value)) {
      return bot.sendMessage(chatId, '❌ Ссылка должна начинаться с <code>https://max.ru/u/...</code>\n\nПопробуйте ещё раз или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.maxLink = value;
  }

  await regGoToNextStep(chatId, state);
}

async function regFinish(chatId, state) {
  const d = state.data;
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
  const inviteCode = generateInviteCode();
  const userName = state.userName || 'Владелец';

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
      settings: { logo: null, background: null, markupPercent: 20, aiEnabled: false },
      stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
    });
    await addAdminToDb(chatId, d.shopId, 'owner', userName);
    await setUserOnShift(chatId, d.shopId, true);
    userToShop[chatId] = d.shopId;
    delete registrationState[chatId];
    const shop = await getShopFromDb(d.shopId);
    await bot.sendMessage(chatId, REG_FINAL_TEXT(d.shopId, d.displayName), { parse_mode: 'HTML' });
    await bot.sendMessage(chatId, '👇', { reply_markup: getMainKeyboard(shop, chatId) });

    if (OWNER_CHAT_ID && OWNER_CHAT_ID !== chatId) {
      const tgRef = state.userUsername ? '@' + state.userUsername : `chat_id ${chatId}`;
      const adminTxt =
        `🎉 <b>Новый магазин зарегистрирован!</b>\n\n` +
        `🏪 «${esc(d.displayName)}»\n` +
        `🆔 <code>${esc(d.shopId)}</code>\n` +
        `👤 ${esc(userName)} (${esc(tgRef)})\n\n` +
        `🔗 ${SITE_URL}/shop/${d.shopId}\n\n` +
        `<i>Открыть админ-панель — /admin</i>`;
      bot.sendMessage(OWNER_CHAT_ID, adminTxt, { parse_mode: 'HTML' }).catch(function(){});
    }
    return;
  } catch (e) {
    console.error('Ошибка создания магазина:', e?.message || e);
    delete registrationState[chatId];
    return bot.sendMessage(chatId, '❌ Ошибка при создании магазина. Попробуйте ещё раз /register.');
  }
}

// ========= АДМИН-ПАНЕЛЬ ВЛАДЕЛЬЦА СЕРВИСА =========
const ADMIN_SHOP_PER_PAGE = 25;

async function showAdminPanel(chatId, editMessageId) {
  const shops = await getAllShopsAdmin();
  const total = shops.length;
  const now = Date.now();
  const activeTrials = shops.filter(s => s.trialEnd && new Date(s.trialEnd).getTime() > now).length;
  const expired = total - activeTrials;
  const blocked = shops.filter(s => s.blocked).length;
  const totalBouquets = shops.reduce((sum, s) => sum + s.bouquetsCount, 0);
  const totalOrders = shops.reduce((sum, s) => sum + s.orders, 0);
  const totalCalls = shops.reduce((sum, s) => sum + s.calls, 0);

  const txt =
    `🛡 <b>Админ-панель Flowind</b>\n\n` +
    `🏪 Всего магазинов: <b>${total}</b>\n` +
    `🟢 Активный триал: <b>${activeTrials}</b>\n` +
    `🔴 Истёк триал: <b>${expired}</b>\n` +
    (blocked > 0 ? `🚫 Заблокировано: <b>${blocked}</b>\n` : '') +
    `\n📦 Букетов на витринах: <b>${totalBouquets}</b>\n` +
    `📩 Заявок (сообщения): <b>${totalOrders}</b>\n` +
    `📞 Заявок (звонки): <b>${totalCalls}</b>`;

  const buttons = [
    [{ text: '🏪 Список магазинов', callback_data: 'admin_shops_0' }],
    [{ text: '🔄 Обновить', callback_data: 'admin_refresh' }]
  ];

  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, { chat_id: chatId, message_id: editMessageId, ...opts });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return bot.sendMessage(chatId, txt, opts);
}

async function showAdminShopsList(chatId, page, editMessageId) {
  const currentPage = page || 0;
  const shops = await getAllShopsAdmin();
  const totalPages = Math.max(1, Math.ceil(shops.length / ADMIN_SHOP_PER_PAGE));
  const safePage = Math.max(0, Math.min(currentPage, totalPages - 1));
  const start = safePage * ADMIN_SHOP_PER_PAGE;
  const slice = shops.slice(start, start + ADMIN_SHOP_PER_PAGE);

  let txt = `🏪 <b>Магазины</b> (${shops.length})\n`;
  if (totalPages > 1) txt += `Страница ${safePage + 1} из ${totalPages}\n`;
  txt += `\n<i>Тапните на магазин для подробностей.</i>`;

  const rows = [];
  const now = Date.now();
  for (const s of slice) {
    let emoji = '⚪';
    if (s.blocked) emoji = '🚫';
    else if (s.trialEnd) {
      const daysLeft = Math.ceil((new Date(s.trialEnd).getTime() - now) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 0) emoji = '🔴';
      else if (daysLeft <= 7) emoji = '🟡';
      else emoji = '🟢';
    }
    const name = shortName(s.displayName || s.shopId, 22);
    rows.push([{ text: `${emoji} ${name}`, callback_data: `admin_shop_${s.shopId}` }]);
  }

  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) nav.push({ text: '⬅️ Назад', callback_data: `admin_shops_${safePage - 1}` });
    nav.push({ text: `${safePage + 1} / ${totalPages}`, callback_data: 'noop' });
    if (safePage < totalPages - 1) nav.push({ text: 'Дальше ➡️', callback_data: `admin_shops_${safePage + 1}` });
    rows.push(nav);
  }

  rows.push([{ text: '⬅️ Назад', callback_data: 'admin_main' }]);

  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, { chat_id: chatId, message_id: editMessageId, ...opts });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return bot.sendMessage(chatId, txt, opts);
}

async function showAdminShopCard(chatId, shopId, editMessageId) {
  const shop = await getShopFromDb(shopId);
  if (!shop) {
    try {
      await bot.editMessageText('❌ Магазин не найден.', { chat_id: chatId, message_id: editMessageId });
    } catch (e) { /* ignore */ }
    return;
  }

  const all = await getBouquetsFromDb(shopId, false);
  const active = all.filter(isConfirmedRecently);
  const stats = shop.stats || {};
  const orders = stats.orders || 0;
  const calls = stats.calls || 0;
  const owner = shop.admins.find(a => a.role === 'owner');
  const florists = shop.admins.filter(a => a.role !== 'owner');

  const days = getRemainingDays(shop);
  let trialStatus = days > 0 ? `🟢 ${days} дней` : '🔴 истёк';
  if (shop.blocked) trialStatus = '🚫 ЗАБЛОКИРОВАН';

  let txt = `🏪 <b>${esc(shop.displayName)}</b>\n`;
  txt += `<code>${esc(shop.shopId)}</code>\n\n`;

  if (shop.blocked && shop.blockedReason) {
    txt += `🚫 <b>Причина блокировки:</b>\n<i>${esc(shop.blockedReason)}</i>\n\n`;
  }

  if (owner) {
    txt += `👑 Владелец: <b>${esc(owner.name || 'Флорист')}</b>\n`;
    txt += `🆔 <code>${owner.chatId}</code>\n`;
    if (shop.telegramUsername) txt += `💬 @${esc(shop.telegramUsername)}\n`;
    if (shop.phone) txt += `📞 ${esc(formatPhone(shop.phone))}\n`;
  } else {
    txt += `⚠️ Владелец не найден\n`;
  }

  if (florists.length > 0) {
    txt += `\n👥 Флористы (${florists.length}): ${florists.map(f => esc(f.name || 'без имени')).join(', ')}\n`;
  } else {
    txt += `\n👥 Флористы: <i>нет</i>\n`;
  }

  txt += `\n📦 На витрине: <b>${active.length}</b> из ${all.length}\n`;
  txt += `📅 Триал: ${trialStatus}\n\n`;
  txt += `📊 <b>Заявки:</b>\n`;
  txt += `📩 Сообщения: ${orders}\n`;
  txt += `📞 Звонки: ${calls}\n`;

  const buttons = [
    [{ text: '⏱ Продлить на 7 дней', callback_data: `admin_extend_7_${shop.shopId}` }],
    [{ text: '⏱ Продлить на 30 дней', callback_data: `admin_extend_30_${shop.shopId}` }],
    [{ text: '⏱ Продлить на 90 дней', callback_data: `admin_extend_90_${shop.shopId}` }],
    [{ text: '💬 Написать владельцу', callback_data: `admin_msg_${shop.shopId}` }],
    [shop.blocked
      ? { text: '✅ Разблокировать', callback_data: `admin_unblock_${shop.shopId}` }
      : { text: '🚫 Заблокировать', callback_data: `admin_block_${shop.shopId}` }],
    [{ text: '🛒 Открыть витрину', url: `${SITE_URL}/shop/${shop.shopId}` }],
    [{ text: '⬅️ К списку', callback_data: 'admin_shops_0' }]
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

// ========= /start =========
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match && match[1] ? match[1].trim() : null;
  const userName = msg.from.first_name || 'Флорист';

  delete archiveSessions[chatId];

  if (param && param.startsWith('inv_')) {
    const inviteCode = param.replace('inv_', '').toUpperCase();
    const shopId = await getShopByInvite(inviteCode);
    if (shopId) {
      const shop = await getShopFromDb(shopId);
      if (shop && shop.blocked) {
        return bot.sendMessage(chatId, '🚫 Этот магазин заблокирован. Напишите @floop10.');
      }
      const currentShop = await findUserShop(chatId);
      if (currentShop && currentShop !== shopId) return bot.sendMessage(chatId, '❌ Вы уже привязаны к другому магазину.');
      await addAdminToDb(chatId, shopId, 'florist', userName);
      userToShop[chatId] = shopId;
      const updatedShop = await getShopFromDb(shopId);
      return bot.sendMessage(chatId,
        `🎉 Добро пожаловать в команду «${esc(shop.displayName)}»!\n\n` +
        `📷 Добавляйте букеты: фото с подписью «Название цена».\n` +
        `✅ Подтверждайте наличие через «Что в наличии?».\n\n` +
        `<i>💡 Чтобы получать уведомления о клиентах, нажмите «✅ Я сегодня работаю» в меню.</i>`,
        { parse_mode: 'HTML', reply_markup: getMainKeyboard(updatedShop, chatId) });
    }
    return bot.sendMessage(chatId, '❌ Приглашение недействительно.');
  }

  let shopId = userToShop[chatId] || await findUserShop(chatId);

  if (!shopId) {
    if (OWNER_CHAT_ID && chatId === OWNER_CHAT_ID) {
      const presetShop = await getShopFromDb(PRESET_SHOP.shopId);
      if (presetShop && presetShop.admins.length === 0) {
        await addAdminToDb(chatId, PRESET_SHOP.shopId, 'owner', userName);
        await setUserOnShift(chatId, PRESET_SHOP.shopId, true);
        userToShop[chatId] = PRESET_SHOP.shopId;
        shopId = PRESET_SHOP.shopId;
      }
    }
  }

  if (shopId) {
    const shop = await getShopFromDb(shopId);
    if (!shop) return bot.sendMessage(chatId, '❌ Магазин не найден.');
    userToShop[chatId] = shopId;

    if (shop.blocked) {
      return bot.sendMessage(chatId,
        `🚫 <b>Магазин заблокирован</b>\n\n` +
        (shop.blockedReason ? `Причина: <i>${esc(shop.blockedReason)}</i>\n\n` : '') +
        `Для разблокировки напишите: @floop10`,
        { parse_mode: 'HTML' });
    }

    if (!isSubscriptionActive(shop)) {
      return bot.sendMessage(chatId,
        `⏳ <b>Подписка истекла</b>\n\nМагазин «${esc(shop.displayName)}» приостановлен. Витрина не показывается клиентам, букеты не добавляются.\n\nДля продления напишите: @floop10`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💳 Продлить', callback_data: 'menu_renew' }]] } });
    }

    const owner = isOwner(shop, chatId);
    const me = shop.admins.find(a => a.chatId === chatId);
    const onShift = !!(me && me.onShift);

    let txt = `🌸 «${esc(shop.displayName)}»\n\n`;
    txt += owner ? `👑 Вы — владелец.\n` : `🌸 Вы — флорист.\n`;
    txt += onShift ? `🟢 Вы <b>на смене</b>.\n\n` : `⚪ Вы <b>не на смене</b>. Нажмите «✅ Я сегодня работаю», чтобы получать уведомления о клиентах.\n\n`;
    txt += `📷 Добавить букет — отправить фото с подписью\n`;
    txt += `✅ Что в наличии — отметить актуальные\n`;
    txt += `✏️ Изменить цену — обновить стоимость\n`;
    txt += `📝 Переименовать — изменить название\n`;
    if (owner) txt += `🗑 Удалить — убрать букет совсем\n`;
    txt += `📦 Архив — вернуть ушедшие букеты\n`;
    txt += `⚙️ Меню — настройки`;
    return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }

  return bot.sendMessage(chatId,
    `🌸 <b>Добро пожаловать в Flowind!</b>\n\n` +
    `Это витрина для цветочных магазинов.\n` +
    `Флорист добавляет букет через бота — он сразу появляется на витрине.\n` +
    `Клиент видит витрину и пишет вам в мессенджер.\n\n` +
    `Если вы флорист — нажмите «Создать магазин», и через минуту у вас будет своя витрина.\n\n` +
    `Если вас пригласил владелец магазина — просто откройте ссылку, которую он прислал.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '➕ Создать магазин', callback_data: 'welcome_create' }]
    ] } }
  );
});

// ========= /admin =========
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isServiceAdmin(chatId)) return;
  return showAdminPanel(chatId);
});

// ========= CALLBACK =========
bot.on('callback_query', async (q) => {
  const chatId = q.from.id;
  const data = q.data;
  bot.answerCallbackQuery(q.id).catch(function(){});

  if (checkSessions[chatId]) {
    checkSessions[chatId].lastActivity = Date.now();
  }

  if (data === 'welcome_create') {
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return startRegistration(chatId, q.from.first_name, q.from.username);
  }

  if (data === 'reg_skip') {
    const state = registrationState[chatId];
    if (!state) {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return;
    }
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return regSkipCurrentStep(chatId, state);
  }

  // ========= АДМИН-ПАНЕЛЬ =========
  if (data.startsWith('admin_') && isServiceAdmin(chatId)) {
    if (data === 'admin_main' || data === 'admin_refresh') {
      return showAdminPanel(chatId, q.message.message_id);
    }
    if (data.startsWith('admin_shops_')) {
      const page = parseInt(data.replace('admin_shops_', '')) || 0;
      return showAdminShopsList(chatId, page, q.message.message_id);
    }
    if (data.startsWith('admin_shop_')) {
      const targetShopId = data.replace('admin_shop_', '');
      return showAdminShopCard(chatId, targetShopId, q.message.message_id);
    }
    if (data.startsWith('admin_extend_')) {
      const rest = data.replace('admin_extend_', '');
      const firstUnderscore = rest.indexOf('_');
      const days = parseInt(rest.slice(0, firstUnderscore));
      const targetShopId = rest.slice(firstUnderscore + 1);
      if (!days || !targetShopId) return;
      await extendShopTrial(targetShopId, days);
      await bot.answerCallbackQuery(q.id, { text: `✅ Продлено на ${days} дней`, show_alert: false }).catch(function(){});
      return showAdminShopCard(chatId, targetShopId, q.message.message_id);
    }
    if (data.startsWith('admin_msg_')) {
      const targetShopId = data.replace('admin_msg_', '');
      const targetShop = await getShopFromDb(targetShopId);
      if (!targetShop) return;
      const targetOwner = targetShop.admins.find(a => a.role === 'owner');
      if (!targetOwner) {
        return bot.sendMessage(chatId, '❌ У этого магазина нет владельца.');
      }
      awaitingAdminMessage[chatId] = {
        targetChatId: targetOwner.chatId,
        targetName: targetOwner.name || 'Флорист',
        shopId: targetShopId
      };
      return bot.sendMessage(chatId,
        `💬 Напишите сообщение для <b>${esc(targetOwner.name || 'Флориста')}</b> (магазин «${esc(targetShop.displayName)}»).\n\n` +
        `Он получит его от бота Flowind.\n\n` +
        `<i>Отмена — /cancel</i>`,
        { parse_mode: 'HTML' });
    }
    if (data.startsWith('admin_block_')) {
      const targetShopId = data.replace('admin_block_', '');
      const targetShop = await getShopFromDb(targetShopId);
      if (!targetShop) return;
      awaitingAdminBlockReason[chatId] = { shopId: targetShopId };
      return bot.sendMessage(chatId,
        `🚫 <b>Блокировка магазина</b>\n\n` +
        `Магазин «${esc(targetShop.displayName)}»\n\n` +
        `Напишите <b>причину блокировки</b> — она будет показана владельцу, когда он напишет в бот.\n\n` +
        `<i>Отмена — /cancel</i>`,
        { parse_mode: 'HTML' });
    }
    if (data.startsWith('admin_unblock_')) {
      const targetShopId = data.replace('admin_unblock_', '');
      await unblockShop(targetShopId);
      const shop = await getShopFromDb(targetShopId);
      const owner = shop.admins.find(a => a.role === 'owner');
      if (owner) {
        bot.sendMessage(owner.chatId,
          `✅ <b>Магазин разблокирован</b>\n\n«${esc(shop.displayName)}» снова работает.`,
          { parse_mode: 'HTML' }).catch(function(){});
      }
      return showAdminShopCard(chatId, targetShopId, q.message.message_id);
    }
  }

  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (!shopId) return;
  const shop = await getShopFromDb(shopId);
  if (!shop) return;
  const owner = isOwner(shop, chatId);

  // Пагинация списков букетов (для удалить / переименовать / изменить цену)
  if (data.startsWith('bqlist_')) {
    const rest = data.replace('bqlist_', '');
    const lastUnderscore = rest.lastIndexOf('_');
    const action = rest.slice(0, lastUnderscore);
    const page = parseInt(rest.slice(lastUnderscore + 1)) || 0;
    const headers = {
      editprice: '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.',
      rename: '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.',
      askdel: '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.'
    };
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return showBouquetList(chatId, shopId, action, headers[action] || '', page);
  }

  if (data.startsWith('arch_')) {
    const session = archiveSessions[chatId];
    if (!session) {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return;
    }
    if (data === 'arch_close') {
      delete archiveSessions[chatId];
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return bot.sendMessage(chatId, '📦 Архив закрыт.', { reply_markup: getMainKeyboard(shop, chatId) });
    }
    if (data === 'arch_next') {
      session.currentIndex++;
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return showArchiveCard(chatId, session);
    }
    if (data === 'arch_restore') {
      const b = session.bouquets[session.currentIndex];
      if (!b) return;
      await updateBouquetFields(b.id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
      session.currentIndex++;
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return showArchiveCard(chatId, session);
    }
  }

  if (data === 'noop') return;
  if (data === 'menu_link') return bot.sendMessage(chatId, `🔗 Ваша витрина:\n${SITE_URL}/shop/${shopId}`);
  if (data === 'menu_close') { delete checkSessions[chatId]; delete archiveSessions[chatId]; return bot.deleteMessage(chatId, q.message.message_id).catch(function(){}); }
  if (data === 'menu_back') {
    if (!owner) return;
    delete archiveSessions[chatId];
    try {
      await bot.editMessageText('⚙️ Меню магазина:', { chat_id: chatId, message_id: q.message.message_id, ...getSettingsMenu(shop, chatId) });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data === 'menu_shopdata') {
    if (!owner) return;
    const { text, options } = buildShopDataMessage(shop);
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options });
    } catch (e) { /* ignore */ }
    return;
  }
  if (data.startsWith('edit_shop_')) {
    if (!owner) return;
    const field = data.replace('edit_shop_', '');
    const prompts = {
      displayname: { q: '📝 Введите новое <b>название</b> магазина (как показывать клиентам).\nПример: <i>Цветы на Фрунзе</i>', field: 'display_name' },
      address:     { q: '📍 Введите новый <b>адрес</b>.\nПример: <i>г. Москва, ул. Фрунзе, 15</i>\n(или "нет", чтобы убрать)', field: 'address' },
      hours:       { q: '🕐 Введите новые <b>часы работы</b>.\nПример: <i>Пн-Вс 10:30-21:00</i>\n(или "нет", чтобы убрать)', field: 'hours' },
      phone:       { q: '📞 Введите новый <b>телефон</b> для кнопки «Позвонить».\nПример: <i>+7 962 402-51-75</i>\n(или "нет", чтобы убрать)', field: 'phone' },
      telegram:    { q: '📱 Введите <b>Telegram-юзернейм</b> (без @).\nПример: <i>KupidonAdm</i>\n(или "нет", чтобы убрать)', field: 'telegram_username' },
      whatsapp:    { q: '💬 Введите <b>номер WhatsApp</b>.\nПример: <i>+7 962 402-51-75</i>\n(или "нет", чтобы убрать)', field: 'whatsapp_phone' },
      max:         { q: '🅼 <b>Ссылка на профиль в MAX</b>\n\n<b>Как получить:</b>\n1. Откройте приложение MAX\n2. Зайдите в свой профиль\n3. Нажмите «Пригласить друзей» или «Поделиться»\n4. Скопируйте ссылку\n\nОна начинается с <code>https://max.ru/u/...</code>\n\nПришлите её сюда целиком.\n(или "нет", чтобы убрать)', field: 'max_username' }
    };
    const p = prompts[field];
    if (!p) return;
    awaitingInput[chatId] = { field: p.field, from: 'shopdata' };
    return bot.sendMessage(chatId, `${p.q}\n\n<i>Отмена — /cancel</i>`, { parse_mode: 'HTML' });
  }
  if (data === 'menu_invite') {
    if (!owner) return;
    const link = `https://t.me/${BOT_USERNAME}?start=inv_${shop.inviteCode}`;
    return bot.sendMessage(chatId, `🔑 Ссылка-приглашение:\n\n${link}\n\nОтправьте её флористу — он кликнет и сразу попадёт в вашу команду.`);
  }
  if (data === 'menu_team') {
    if (!owner) return;
    const others = shop.admins.filter(a => a.chatId !== chatId);
    if (others.length === 0) return bot.sendMessage(chatId, '👥 <b>Команда магазина</b>\n\nПока только вы.', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } });
    const keyboard = others.map(a => {
      const dot = a.onShift ? '🟢' : '⚪';
      return [{ text: `${dot} ${a.name || 'Флорист'}`, callback_data: `team_user_${a.chatId}` }];
    });
    keyboard.push([{ text: '↩️ Назад', callback_data: 'menu_back' }]);
    return bot.sendMessage(chatId, `👥 <b>Команда магазина</b> (${others.length})`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  }
  if (data.startsWith('team_user_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[2]);
    const target = shop.admins.find(a => a.chatId === targetChatId);
    if (!target) return;
    const statusText = target.onShift ? '🟢 На смене' : '⚪ Выходной';
    return bot.sendMessage(chatId,
      `🌸 <b>${esc(target.name || 'Флорист')}</b>\n\n` +
      `Статус: ${statusText}\n` +
      `Присоединился: ${new Date(target.joinedAt).toLocaleDateString()}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '🗑 Удалить доступ', callback_data: `kick_${targetChatId}` }],
        [{ text: '↩️ Назад', callback_data: 'menu_team' }]
      ] } });
  }
  if (data.startsWith('kick_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[1]);
    return bot.sendMessage(chatId, `⚠️ Удалить доступ?`, { reply_markup: { inline_keyboard: [
      [{ text: '🗑 Да', callback_data: `confirmkick_${targetChatId}` }],
      [{ text: '↩️ Отмена', callback_data: 'menu_team' }]
    ] } });
  }
  if (data.startsWith('confirmkick_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[1]);
    const target = shop.admins.find(a => a.chatId === targetChatId);
    const name = target ? (target.name || 'Флорист') : 'Флорист';
    await removeAdminFromDb(targetChatId, shopId);
    delete userToShop[targetChatId];
    bot.editMessageText(`✅ Доступ для «${name}» удалён.`, { chat_id: chatId, message_id: q.message.message_id }).catch(function(){});
    bot.sendMessage(targetChatId, `🚫 Ваш доступ к витрине «${shop.displayName}» удалён.`).catch(function(){});
    return;
  }
  if (data === 'menu_stats') {
    if (!owner) return;
    const all = await getBouquetsFromDb(shopId, true);
    const clickMap = {};
    for (const b of all) {
      const key = normalizeName(b.name);
      if (!key) continue;
      if (!clickMap[key]) clickMap[key] = { name: b.name, clicks: 0, hasActive: false };
      clickMap[key].clicks += (b.clicks || 0);
      if (!b.deleted) { clickMap[key].name = b.name; clickMap[key].hasActive = true; }
    }
    const top = Object.values(clickMap).filter(x => x.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 5);
    const stats = shop.stats;
    const orders = stats.orders || 0;
    const calls = stats.calls || 0;
    const total = orders + calls;
    let txt = `📊 <b>Статистика</b>\n\n`;
    txt += `📩 Хотели написать: <b>${orders}</b>\n`;
    txt += `📞 Хотели позвонить: <b>${calls}</b>\n`;
    txt += `📈 Всего заявок: <b>${total}</b>\n`;
    txt += `\n<i>Здесь только реальные клики клиентов. Ваши собственные заходы не считаются.</i>\n`;
    if (top.length > 0) {
      txt += `\n🔥 <b>Топ-5 по заявкам:</b>\n`;
      for (let i = 0; i < top.length; i++) {
        const x = top[i];
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
        const mark = x.hasActive ? '' : ' (архив)';
        txt += `${medal} ${esc(x.name)} — ${x.clicks}${mark}\n`;
      }
    } else {
      txt += `\n<i>Пока ни одной заявки. Поделитесь ссылкой с клиентами!</i>`;
    }
    return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } });
  }
  if (data === 'menu_markup') {
    if (!owner) return;
    const current = shop.settings.markupPercent || 0;
    let txt = `💰 <b>Наценка</b>\n\nСейчас: <b>${current}%</b>\n\n`;
    if (current === 0) txt += `При 0% витрина показывает одну цену.`;
    else txt += `Пример: 1000 ₽ → <s>${calculateOldPrice(1000, current)} ₽</s> <b>1000 ₽</b>`;
    return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '0%', callback_data: 'markup_set_0' }, { text: '10%', callback_data: 'markup_set_10' }, { text: '15%', callback_data: 'markup_set_15' }],
      [{ text: '20%', callback_data: 'markup_set_20' }, { text: '30%', callback_data: 'markup_set_30' }, { text: '50%', callback_data: 'markup_set_50' }],
      [{ text: '✏️ Своё', callback_data: 'markup_custom' }],
      [{ text: '↩️ Назад', callback_data: 'menu_back' }]
    ] } });
  }
  if (data.startsWith('markup_set_')) {
    if (!owner) return;
    const percent = parseInt(data.replace('markup_set_', ''));
    shop.settings.markupPercent = percent;
    await saveShopSettings(shopId, shop.settings);
    bot.editMessageText(`✅ <b>Наценка: ${percent}%</b>`, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } }).catch(function(){});
    return;
  }
  if (data === 'markup_custom') {
    if (!owner) return;
    awaitingMarkup[chatId] = true;
    return bot.sendMessage(chatId, `💰 Напишите процент числом (0–200).\n<i>Отмена — /cancel</i>`, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }
  if (data === 'menu_status') {
    const active = (await getBouquetsFromDb(shopId)).length;
    const days = getRemainingDays(shop);
    const myRole = owner ? '👑 Владелец' : '🌸 Флорист';
    const me = shop.admins.find(a => a.chatId === chatId);
    const myShift = me && me.onShift ? '🟢 На смене' : '⚪ Не на смене';
    let txt = `📋 <b>${esc(shop.displayName)}</b>\n\n👤 ${myRole} · ${myShift}\n👥 Команда: ${shop.admins.length}\n📦 Букетов: ${active}\n💰 Наценка: ${shop.settings.markupPercent}%\n📅 Триал: ${days} дней`;
    const kb = owner ? { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } : { inline_keyboard: [[{ text: '❌ Закрыть', callback_data: 'menu_close' }]] };
    return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: kb });
  }
  if (data === 'menu_renew') return bot.sendMessage(chatId, '💳 Продление: @floop10', { reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } });
  if (data === 'menu_logo') {
    if (!owner) return;
    return bot.sendMessage(chatId, shop.settings.logo ? '🎨 Логотип установлен.' : '🎨 Логотип не установлен.', { reply_markup: { inline_keyboard: [
      [{ text: '📷 Загрузить', callback_data: 'setlogo_now' }],
      [{ text: '🗑 Убрать', callback_data: 'resetlogo_now' }],
      [{ text: '↩️ Назад', callback_data: 'menu_back' }]
    ] } });
  }
  if (data === 'menu_background') {
    if (!owner) return;
    return bot.sendMessage(chatId, shop.settings.background ? '🖼 Фон установлен.' : '🖼 Фон не установлен.', { reply_markup: { inline_keyboard: [
      [{ text: '📷 Загрузить', callback_data: 'setbg_now' }],
      [{ text: '🗑 Убрать', callback_data: 'resetbg_now' }],
      [{ text: '↩️ Назад', callback_data: 'menu_back' }]
    ] } });
  }
  if (data === 'setlogo_now') { if (!owner) return; awaitingUpload[chatId] = 'logo'; return bot.sendMessage(chatId, '📷 Отправьте фото логотипа.'); }
  if (data === 'setbg_now') { if (!owner) return; awaitingUpload[chatId] = 'background'; return bot.sendMessage(chatId, '📷 Отправьте фото фона.'); }
  if (data === 'resetlogo_now') { if (!owner) return; shop.settings.logo = null; await saveShopSettings(shopId, shop.settings); bot.editMessageText('✅ Логотип убран.', { chat_id: chatId, message_id: q.message.message_id }).catch(function(){}); return; }
  if (data === 'resetbg_now') { if (!owner) return; shop.settings.background = null; await saveShopSettings(shopId, shop.settings); bot.editMessageText('✅ Фон убран.', { chat_id: chatId, message_id: q.message.message_id }).catch(function(){}); return; }

  if (data === 'check_start') {
    const bouquets = await getCheckableBouquets(shopId);
    if (bouquets.length === 0) {
      bot.editMessageText('🌿 На витрине нет букетов — проверять нечего.', {
        chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML'
      }).catch(function(){});
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
    const kb = { inline_keyboard: buildCheckListKeyboard(session) };
    bot.editMessageText(txt, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: kb }).catch(function(){});
    return;
  }

  if (data === 'check_cancel') {
    delete checkSessions[chatId];
    bot.editMessageText('❌ Проверка отменена.', { chat_id: chatId, message_id: q.message.message_id }).catch(function(){});
    return;
  }

  if (data === 'check_finish') {
    delete checkSessions[chatId];
    try {
      await bot.editMessageText('✅ Проверка завершена.', { chat_id: chatId, message_id: q.message.message_id, reply_markup: getMainKeyboard(shop, chatId) });
    } catch (e) {
      bot.sendMessage(chatId, '✅ Проверка завершена.', { reply_markup: getMainKeyboard(shop, chatId) }).catch(function(){});
    }
    return;
  }

  if (data.startsWith('check_page_')) {
    const session = checkSessions[chatId];
    if (!session) {
      bot.editMessageText('⚠️ Сессия проверки истекла. Начните заново.', {
        chat_id: chatId, message_id: q.message.message_id
      }).catch(function(){});
      return;
    }
    const newPage = parseInt(data.replace('check_page_', ''));
    if (!isNaN(newPage)) session.currentPage = newPage;
    session.lastActivity = Date.now();
    const txt = buildCheckListText(session);
    const kb = { inline_keyboard: buildCheckListKeyboard(session) };
    bot.editMessageText(txt, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: kb }).catch(function(){});
    return;
  }

  if (data.startsWith('check_show_')) {
    const session = checkSessions[chatId];
    if (!session) return bot.sendMessage(chatId, '⚠️ Сессия проверки прервана. Начните заново.');
    const id = parseInt(data.split('_')[2]);
    const b = session.bouquets.find(x => x.id === id);
    if (!b) return bot.sendMessage(chatId, '⚠️ Букет больше не в списке.');
    session.currentBouquetId = id;
    session.lastActivity = Date.now();
    const already = session.checked[id];
    const headerText = already ? `📷 <b>Проверка (уже отмечен)</b>` : `📷 <b>Проверка наличия</b>`;
    return sendBouquetPreview(chatId, b, headerText, [
      [{ text: '✅ Есть', callback_data: `check_yes_${b.id}` }],
      [{ text: '🚫 Убрать', callback_data: `check_no_${b.id}` }],
      [{ text: '↩️ К списку', callback_data: 'check_back' }]
    ]);
  }

  if (data === 'check_back') {
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return bot.sendMessage(chatId, '👆 Вернуться к списку — выше. Нажмите на любой букет.');
  }

  if (data.startsWith('check_yes_')) {
    const session = checkSessions[chatId];
    if (!session) return bot.sendMessage(chatId, '⚠️ Сессия проверки прервана. Начните заново.');
    const id = parseInt(data.split('_')[2]);
    if (!session.bouquets.find(x => x.id === id)) return;
    await updateBouquetFields(id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
    session.checked[id] = 'yes';
    session.order = [id, ...session.order.filter(x => x !== id)];
    session.currentBouquetId = null;
    session.lastActivity = Date.now();
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return refreshCheckList(chatId, session);
  }

  if (data.startsWith('check_no_')) {
    const session = checkSessions[chatId];
    if (!session) return bot.sendMessage(chatId, '⚠️ Сессия проверки прервана. Начните заново.');
    const id = parseInt(data.split('_')[2]);
    if (!session.bouquets.find(x => x.id === id)) return;
    await updateBouquetField(id, 'hidden', true);
    session.checked[id] = 'no';
    session.order = [id, ...session.order.filter(x => x !== id)];
    session.currentBouquetId = null;
    session.lastActivity = Date.now();
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return refreshCheckList(chatId, session);
  }

  if (data.startsWith('confirm_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
    const b = await getBouquetById(shopId, id);
    return bot.sendMessage(chatId, `✅ Букет №${b ? b.shopNumber : id} подтверждён.`);
  }
  if (data.startsWith('hide_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetField(id, 'hidden', true);
    const b = await getBouquetById(shopId, id);
    return bot.sendMessage(chatId, `🚫 Букет №${b ? b.shopNumber : id} убран.`);
  }
  if (data.startsWith('show_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { hidden: false, confirmed_at: new Date().toISOString(), reminded: false });
    const b = await getBouquetById(shopId, id);
    return bot.sendMessage(chatId, `↩️ Букет №${b ? b.shopNumber : id} возвращён.`);
  }
  if (data.startsWith('extend_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
    return bot.sendMessage(chatId, '🌿 Продлено.');
  }

  if (data.startsWith('editprice_ok_')) {
    const id = parseInt(data.split('_')[2]);
    const b = await getBouquetById(shopId, id);
    if (!b) return;
    awaitingPrice[chatId] = b.id;
    return bot.sendMessage(chatId, `✏️ Напишите новую цену для букета <b>№${b.shopNumber}</b> (${esc(b.name)}).\nТекущая: <b>${b.price} ₽</b>\n<i>Отмена — /cancel</i>`, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }
  if (data.startsWith('editprice_no_')) {
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return showBouquetList(chatId, shopId, 'editprice', '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.', 0);
  }
  if (data.startsWith('editprice_')) {
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    if (!b) return bot.sendMessage(chatId, '❌ Букет не найден.');
    return sendBouquetPreview(chatId, b, '✏️ <b>Изменить цену?</b>', [
      [{ text: '✅ Да, менять цену', callback_data: `editprice_ok_${b.id}` }],
      [{ text: '↩️ Нет, к списку', callback_data: `editprice_no_${b.id}` }]
    ]);
  }

  if (data.startsWith('rename_ok_')) {
    const id = parseInt(data.split('_')[2]);
    const b = await getBouquetById(shopId, id);
    if (!b) return;
    awaitingName[chatId] = b.id;
    return bot.sendMessage(chatId, `📝 Напишите новое название для букета <b>№${b.shopNumber}</b>.\nТекущее: <b>${esc(b.name)}</b>\n<i>Точка в начале — закрепить. Отмена — /cancel</i>`, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }
  if (data.startsWith('rename_no_')) {
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return showBouquetList(chatId, shopId, 'rename', '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.', 0);
  }
  if (data.startsWith('rename_')) {
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    if (!b) return bot.sendMessage(chatId, '❌ Букет не найден.');
    return sendBouquetPreview(chatId, b, '📝 <b>Переименовать этот букет?</b>', [
      [{ text: '✅ Да, менять название', callback_data: `rename_ok_${b.id}` }],
      [{ text: '↩️ Нет, к списку', callback_data: `rename_no_${b.id}` }]
    ]);
  }

  if (data.startsWith('askdel_')) {
    if (!owner) return;
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    if (!b) return;
    return sendBouquetPreview(chatId, b, '🗑 <b>Удалить этот букет?</b>', [
      [{ text: '🗑 Да, удалить', callback_data: `confirmdel_${b.id}` }],
      [{ text: '↩️ Нет, к списку', callback_data: 'canceldel' }]
    ]);
  }
  if (data.startsWith('confirmdel_')) {
    if (!owner) return;
    const id = parseInt(data.split('_')[1]);
    const b = await getBouquetById(shopId, id);
    const num = b ? b.shopNumber : id;
    await updateBouquetField(id, 'deleted', true);
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return showBouquetList(chatId, shopId, 'askdel', `✅ <b>Букет №${num} удалён с витрины.</b>\n\n🗑 Какой удалить ещё?`, 0);
  }
  if (data === 'canceldel') {
    bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
    return showBouquetList(chatId, shopId, 'askdel', '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.', 0);
  }
});async function refreshCheckList(chatId, session) {
  const total = session.bouquets.length;
  const done = Object.keys(session.checked).length;
  if (done >= total) {
    delete checkSessions[chatId];
    try {
      await bot.editMessageText(`🎉 <b>Проверка завершена!</b>\n\nВсе ${total} ${plural(total, 'букет', 'букета', 'букетов')} проверены.`, {
        chat_id: chatId, message_id: session.listMessageId, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(chatId, `🎉 Проверка завершена! Все ${total} букетов проверены.`, { parse_mode: 'HTML' }).catch(function(){});
    }
    return;
  }
  const txt = buildCheckListText(session);
  const kb = { inline_keyboard: buildCheckListKeyboard(session) };
  try {
    await bot.editMessageText(txt, { chat_id: chatId, message_id: session.listMessageId, parse_mode: 'HTML', reply_markup: kb });
  } catch (e) {
    try {
      const msg = await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: kb });
      session.listMessageId = msg.message_id;
    } catch (e2) { /* ignore */ }
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  // Ввод причины блокировки магазина (админ сервиса)
  if (awaitingAdminBlockReason[chatId]) {
    const target = awaitingAdminBlockReason[chatId];
    const reason = text.trim();
    if (!reason || reason.length < 3) {
      return bot.sendMessage(chatId, '❌ Причина слишком короткая (минимум 3 символа). Напишите понятнее или /cancel.');
    }
    if (reason.length > 300) {
      return bot.sendMessage(chatId, '❌ Слишком длинная причина (максимум 300 символов).');
    }
    delete awaitingAdminBlockReason[chatId];
    await blockShop(target.shopId, reason);
    const shop = await getShopFromDb(target.shopId);
    const owner = shop.admins.find(a => a.role === 'owner');
    if (owner) {
      bot.sendMessage(owner.chatId,
        `🚫 <b>Магазин заблокирован</b>\n\n` +
        `Причина: <i>${esc(reason)}</i>\n\n` +
        `Если это ошибка — напишите @floop10.`,
        { parse_mode: 'HTML' }).catch(function(){});
    }
    return bot.sendMessage(chatId, `✅ Магазин «${esc(shop.displayName)}» заблокирован.`);
  }

  // Сообщение от админа сервиса владельцу магазина
  if (awaitingAdminMessage[chatId]) {
    const target = awaitingAdminMessage[chatId];
    const textToSend = text.trim();
    if (textToSend.length > 1000) {
      return bot.sendMessage(chatId, '❌ Слишком длинное сообщение (максимум 1000 символов).');
    }
    delete awaitingAdminMessage[chatId];
    try {
      await bot.sendMessage(target.targetChatId,
        `📩 <b>Сообщение от Flowind</b>\n\n${esc(textToSend)}\n\n<i>Если нужна помощь — пишите @floop10</i>`,
        { parse_mode: 'HTML' });
      return bot.sendMessage(chatId, `✅ Отправлено в «${esc(target.targetName)}».`);
    } catch (e) {
      return bot.sendMessage(chatId, '❌ Не удалось отправить. Возможно, пользователь не начинал диалог с ботом.');
    }
  }

  if (MENU_BUTTONS.includes(text)) {
    delete awaitingPrice[chatId];
    delete awaitingName[chatId];
    delete awaitingMarkup[chatId];
    delete awaitingInput[chatId];
    delete awaitingUpload[chatId];
    delete archiveSessions[chatId];
    delete awaitingAdminMessage[chatId];
    delete awaitingAdminBlockReason[chatId];
    // Сессию проверки НЕ удаляем — она живёт 60 минут
  }

  const shopId = userToShop[chatId] || await findUserShop(chatId);

  const input = awaitingInput[chatId];
  if (input && shopId) {
    const shop = await getShopFromDb(shopId);
    if (!shop) { delete awaitingInput[chatId]; return; }
    if (!isOwner(shop, chatId)) { delete awaitingInput[chatId]; return bot.sendMessage(chatId, '🚫 Только владелец.'); }

    let value = text.trim();
    if (value.toLowerCase() === 'нет') value = null;

    if (input.field === 'telegram_username' && value) value = value.replace(/^@/, '').toLowerCase();
    if (input.field === 'max_username' && value) {
      if (!/^https?:\/\/max\.ru\//.test(value)) {
        return bot.sendMessage(chatId, '❌ Ссылка должна начинаться с <code>https://max.ru/u/...</code>\n\nПопробуйте ещё раз или нажмите /cancel.', { parse_mode: 'HTML' });
      }
    }
    if ((input.field === 'phone' || input.field === 'whatsapp_phone') && value) {
      const norm = normalizePhone(value);
      if (!norm) {
        return bot.sendMessage(chatId, '❌ Похоже на опечатку. Пришлите номер целиком.\nНапример: <i>+7 962 402-51-75</i>\n\nИли напишите "нет" и нажмите /cancel.', { parse_mode: 'HTML' });
      }
      value = norm;
    }

    if (input.field === 'display_name' && value) {
      if (value.length < 2 || value.length > 60) return bot.sendMessage(chatId, '❌ 2–60 символов.');
    }
    if (input.field === 'telegram_username' && value) {
      if (!/^[a-z0-9_]{3,32}$/.test(value)) return bot.sendMessage(chatId, '❌ Только латиница, цифры, _, от 3 до 32 символов.');
    }

    await updateShopField(shopId, input.field, value);
    delete awaitingInput[chatId];

    const updatedShop = await getShopFromDb(shopId);
    const { text: t, options } = buildShopDataMessage(updatedShop);
    return bot.sendMessage(chatId, `✅ Сохранено!\n\n${t}`, { ...options, reply_markup: getMainKeyboard(updatedShop, chatId) });
  }

  if (awaitingPrice[chatId]) {
    if (!shopId) { delete awaitingPrice[chatId]; return; }
    const b = await getBouquetById(shopId, awaitingPrice[chatId]);
    if (!b) { delete awaitingPrice[chatId]; return bot.sendMessage(chatId, '❌ Букет не найден.'); }
    const newPrice = parseFloat(text.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (isNaN(newPrice) || newPrice <= 0) return bot.sendMessage(chatId, '❌ Введите число. Или нажмите любую кнопку меню, чтобы выйти.');
    const oldPrice = b.price;
    await updateBouquetField(b.id, 'price', Math.round(newPrice));
    delete awaitingPrice[chatId];
    const shop = await getShopFromDb(shopId);
    return bot.sendMessage(chatId, `✅ Цена обновлена: ${oldPrice} → ${Math.round(newPrice)} ₽`, { reply_markup: getMainKeyboard(shop, chatId) });
  }

  if (awaitingName[chatId]) {
    if (!shopId) { delete awaitingName[chatId]; return; }
    const newName = text.trim();
    if (newName.length < 2 || newName.length > 80) return bot.sendMessage(chatId, '❌ 2–80 символов. Или нажмите любую кнопку меню, чтобы выйти.');
    const newTags = extractTagsFromName(newName);
    await updateBouquetFields(awaitingName[chatId], {
      name: newName,
      is_pinned: newName.startsWith('.'),
      tags: JSON.stringify(newTags)
    });
    delete awaitingName[chatId];
    const shop = await getShopFromDb(shopId);
    let msg = `✅ Переименовано: «${newName}»`;
    if (newTags.length > 0) msg += `\n🏷 Теги: ${newTags.map(t => '#' + t).join(' ')}`;
    return bot.sendMessage(chatId, msg, { reply_markup: getMainKeyboard(shop, chatId) });
  }

  if (awaitingMarkup[chatId]) {
    if (!shopId) { delete awaitingMarkup[chatId]; return; }
    const pct = parseInt(text.replace(/[^\d]/g, ''));
    if (isNaN(pct) || pct < 0 || pct > 200) return bot.sendMessage(chatId, '❌ 0–200. Или нажмите любую кнопку меню, чтобы выйти.');
    const shop = await getShopFromDb(shopId);
    shop.settings.markupPercent = pct;
    await saveShopSettings(shopId, shop.settings);
    delete awaitingMarkup[chatId];
    return bot.sendMessage(chatId, `✅ Наценка: ${pct}%`, { reply_markup: getMainKeyboard(shop, chatId) });
  }

  if (!shopId) return;
  const shop = await getShopFromDb(shopId);

  if (text === '📷 Добавить букет') return bot.sendMessage(chatId, ADD_BOUQUET_HINT, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  if (text === '✅ Что в наличии?') {
    if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла.');
    const existing = checkSessions[chatId];
    if (existing && (Date.now() - (existing.lastActivity || 0)) < CHECK_SESSION_TTL) {
      existing.lastActivity = Date.now();
      const t = buildCheckListText(existing);
      const kb = { inline_keyboard: buildCheckListKeyboard(existing) };
      const msg = await bot.sendMessage(chatId, t, { parse_mode: 'HTML', reply_markup: kb });
      existing.listMessageId = msg.message_id;
      return;
    }
    const { text: t, options } = await buildCheckStartScreen(shopId);
    return bot.sendMessage(chatId, t, options);
  }
  if (text === '✏️ Изменить цену') {
    return showBouquetList(chatId, shopId, 'editprice', '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.', 0);
  }
  if (text === '📝 Переименовать') {
    return showBouquetList(chatId, shopId, 'rename', '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.', 0);
  }
  if (text === '🗑 Удалить букет') {
    if (!isOwner(shop, chatId)) return bot.sendMessage(chatId, '🚫 Только владелец.');
    return showBouquetList(chatId, shopId, 'askdel', '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.', 0);
  }
  if (text === '📦 Архив') {
    const arch = await getArchivedBouquets(shopId);
    if (arch.length === 0) return bot.sendMessage(chatId, '📦 В архиве пусто — все букеты на витрине.', { reply_markup: getMainKeyboard(shop, chatId) });
    archiveSessions[chatId] = { bouquets: arch, currentIndex: 0, shopId, keyboardHidden: false };
    return showArchiveCard(chatId, archiveSessions[chatId]);
  }
  if (text === '✅ Я сегодня работаю') {
    await setUserOnShift(chatId, shopId, true);
    const updated = await getShopFromDb(shopId);
    return bot.sendMessage(chatId,
      `✅ Отлично! Вы <b>на смене</b>.\n\n` +
      `Теперь все уведомления о клиентах будут приходить вам. Через 14 часов статус сбросится автоматически.`,
      { parse_mode: 'HTML', reply_markup: getMainKeyboard(updated, chatId) });
  }
  if (text === '🚪 Закончить работу') {
    await setUserOnShift(chatId, shopId, false);
    const updated = await getShopFromDb(shopId);
    return bot.sendMessage(chatId,
      `👋 Хорошего отдыха!\n\n` +
      `Уведомления больше не приходят. Вернётесь — нажмите «✅ Я сегодня работаю».`,
      { reply_markup: getMainKeyboard(updated, chatId) });
  }
  if (text === '🔄 Обновить') {
    delete awaitingPrice[chatId];
    delete awaitingName[chatId];
    delete awaitingMarkup[chatId];
    delete awaitingInput[chatId];
    delete awaitingUpload[chatId];
    delete archiveSessions[chatId];
    delete awaitingAdminMessage[chatId];
    delete awaitingAdminBlockReason[chatId];
    delete registrationState[chatId];
    const updated = await getShopFromDb(shopId);
    return bot.sendMessage(chatId,
      `🔄 <b>Обновлено</b>\n\nВернулись в главное меню. Все данные на месте.`,
      { parse_mode: 'HTML', reply_markup: getMainKeyboard(updated, chatId) });
  }
  if (text === '⚙️ Меню') return bot.sendMessage(chatId, '⚙️ Меню магазина:', getSettingsMenu(shop, chatId));
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ /start');
  const shop = await getShopFromDb(shopId);

  if (shop.blocked) return bot.sendMessage(chatId, '🚫 Магазин заблокирован. Напишите @floop10.');

  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;

  if (awaitingUpload[chatId]) {
    const which = awaitingUpload[chatId];
    if (which === 'logo' || which === 'background') {
      bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(function(){});
      const result = await savePhotoToStorage(fileId, shopId);
      shop.settings[which] = result;
      await saveShopSettings(shopId, shop.settings);
      delete awaitingUpload[chatId];
      return bot.sendMessage(chatId, `✅ ${which === 'logo' ? 'Логотип' : 'Фон'} установлен!`, { reply_markup: getMainKeyboard(shop, chatId) });
    }
  }

  if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла.');

  const caption = (msg.caption || '').trim();

  if (caption) {
    const words = caption.split(/\s+/).filter(w => w.length > 0);
    const lastWord = words[words.length - 1] || '';
    const price = /^\d+$/.test(lastWord) ? parseInt(lastWord, 10) : 0;
    const finalName = words.slice(0, -1).join(' ').trim();

    if (price <= 0 || !finalName) {
      return bot.sendMessage(chatId, PARSE_ERROR_TEXT, { parse_mode: 'HTML' });
    }

    const tags = computeAllTags(finalName, caption);

    bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(function(){});
    const result = await savePhotoToStorage(fileId, shopId);

    const norm = normalizeName(finalName);
    const all = await getBouquetsFromDb(shopId, true);
    let archivedClicks = 0;
    for (const old of all) if (old.deleted && normalizeName(old.name) === norm) archivedClicks += (old.clicks || 0);

    const addResult = await addBouquetToDb(shopId, {
      name: finalName, price: price, description: null,
      photos: [result], isPinned: finalName.startsWith('.'),
      chatId, clicks: archivedClicks, tags
    });
    lastBouquetByUser[chatId] = addResult.id;

    let reply = `✅ Букет <b>№${addResult.shopNumber}</b> «${esc(finalName)}» добавлен! ${price} ₽`;
    if (tags.length > 0) reply += `\n🏷 Теги: ${tags.map(t => '#' + t).join(' ')}`;
    if (archivedClicks > 0) reply += `\n\n📊 Учтено прошлых кликов: ${archivedClicks}`;
    reply += `\n\n💡 Ещё фото? Отправьте без подписи.`;
    return bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }

  const lastId = lastBouquetByUser[chatId];
  if (!lastId) return bot.sendMessage(chatId, '❌ Отправьте фото с подписью.\n\n' + ADD_BOUQUET_HINT, { parse_mode: 'HTML' });
  const b = await getBouquetById(shopId, lastId);
  if (!b) return bot.sendMessage(chatId, '❌ Букет не найден.');

  bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(function(){});
  const result = await savePhotoToStorage(fileId, shopId);

  const photos = b.photos || [];
  photos.push(result);
  await updateBouquetField(lastId, 'photos', JSON.stringify(photos));
  return bot.sendMessage(chatId, `📸 Фото добавлено. Всего: ${photos.length}`, { reply_markup: getMainKeyboard(shop, chatId) });
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  delete awaitingUpload[chatId]; delete awaitingInput[chatId]; delete awaitingPrice[chatId];
  delete awaitingName[chatId]; delete awaitingMarkup[chatId];
  delete awaitingAdminMessage[chatId];
  delete awaitingAdminBlockReason[chatId];
  delete checkSessions[chatId]; delete archiveSessions[chatId];
  delete registrationState[chatId];
  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (shopId) {
    const shop = await getShopFromDb(shopId);
    return bot.sendMessage(chatId, '❌ Отменено.', { reply_markup: getMainKeyboard(shop, chatId) });
  }
  bot.sendMessage(chatId, '❌ Отменено.');
});

bot.onText(/\/migrate/, async (msg) => {
  const chatId = msg.chat.id;
  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Сначала /start');
  const shop = await getShopFromDb(shopId);
  if (!shop) return;
  if (!isOwner(shop, chatId)) return bot.sendMessage(chatId, '🚫 Только владелец.');
  if (!S3_ENABLED) return bot.sendMessage(chatId, '❌ Yandex S3 не настроен. Проверьте переменные YC_* на Render.');

  await bot.sendMessage(chatId, '⏳ Начинаю миграцию фото в Yandex S3.\nЭто может занять 1–2 минуты. Не выключайте.');
  try {
    const r = await migratePhotosToS3(shopId);
    let txt = '✅ <b>Миграция завершена</b>\n\n';
    txt += '📤 Перенесено: <b>' + r.migrated + '</b>\n';
    txt += '⏭ Уже было в S3: <b>' + r.skipped + '</b>\n';
    txt += '❌ Ошибок: <b>' + r.failed + '</b>\n\n';
    if (r.failed > 0) {
      txt += '<i>Часть фото не удалось перенести — они останутся через Telegram, будут грузиться медленнее.</i>\n\n';
    }
    txt += 'Откройте витрину — старые фото теперь тоже должны грузиться быстро.';
    return bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Ошибка миграции:', e?.message || e);
    return bot.sendMessage(chatId, '❌ Ошибка во время миграции. Проверьте логи Render.');
  }
});

bot.onText(/\/register/, async (msg) => {
  await startRegistration(msg.chat.id, msg.from.first_name, msg.from.username);
});

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
  if (!cfg) { delete registrationState[chatId]; return; }

  if (text.trim().toLowerCase() === 'нет' && !cfg.mandatory) {
    return regSkipCurrentStep(chatId, state);
  }
  return regSaveValue(chatId, state, text);
});

app.get('/shop/:shopId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) return res.status(404).send('❌ Магазин не найден');
    if (shop.blocked) return res.send(`<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:50px;"><h1>🚫 Магазин временно недоступен</h1><p style="color:#666;">Приносим извинения за неудобства.</p></body></html>`);
    if (!isSubscriptionActive(shop)) return res.send(`<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:50px;"><h1>🌸 ${esc(shop.displayName)}</h1><p>Витрина приостановлена.</p></body></html>`);

    const priceFilter = req.query.price || 'all';
    const sortParam = req.query.sort || 'default';
    const tagFilter = req.query.tag || 'all';

    let all = await getBouquetsFromDb(shop.shopId);
    let active = all.filter(isConfirmedRecently);

    const tagCounts = {};
    for (const b of active) {
      for (const t of (b.tags || [])) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }

    if (priceFilter === 'low') active = active.filter(b => b.price < 3000);
    else if (priceFilter === 'mid') active = active.filter(b => b.price >= 3000 && b.price <= 6000);
    else if (priceFilter === 'high') active = active.filter(b => b.price > 6000);

    if (tagFilter !== 'all') {
      active = active.filter(b => (b.tags || []).includes(tagFilter));
    }

    if (sortParam === 'asc') {
      active.sort((a, b) => a.price - b.price);
    } else if (sortParam === 'desc') {
      active.sort((a, b) => b.price - a.price);
    } else {
      active.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return new Date(b.confirmedAt || b.createdAt) - new Date(a.confirmedAt || a.createdAt);
      });
    }

    const buildUrl = (newPrice, newSort, newTag) => {
      const p = (newPrice !== undefined && newPrice !== null) ? newPrice : priceFilter;
      const s = (newSort !== undefined && newSort !== null) ? newSort : sortParam;
      const t = (newTag !== undefined && newTag !== null) ? newTag : tagFilter;
      const parts = [];
      if (p && p !== 'all') parts.push('price=' + p);
      if (s && s !== 'default') parts.push('sort=' + s);
      if (t && t !== 'all') parts.push('tag=' + encodeURIComponent(t));
      return '/shop/' + shop.shopId + (parts.length ? '?' + parts.join('&') : '');
    };

    const pillBase = 'display:inline-block;padding:8px 16px;margin:4px;border-radius:20px;text-decoration:none;font-size:14px;font-weight:bold;';
    const pillActive = 'background:#e74c3c;color:#fff;';
    const pillIdle = 'background:#f0f0f0;color:#555;';
    const pill = (label, filterValue) => {
      const isActive = priceFilter === filterValue;
      return `<a href="${buildUrl(filterValue, null, null)}" style="${pillBase}${isActive ? pillActive : pillIdle}">${label}</a>`;
    };

    const sortPillBase = 'display:inline-block;padding:6px 12px;margin:4px;border-radius:16px;text-decoration:none;font-size:13px;';
    const sortPillActive = 'background:#3498db;color:#fff;';
    const sortPillIdle = 'background:#f5f5f5;color:#666;';
    const sortPill = (label, sortValue) => {
      const isActive = sortParam === sortValue;
      return `<a href="${buildUrl(null, sortValue, null)}" style="${sortPillBase}${isActive ? sortPillActive : sortPillIdle}">${label}</a>`;
    };

    let tagPillsHTML = '';
    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    if (sortedTags.length > 0) {
      const tagPillBase = 'display:inline-block;padding:6px 12px;margin:4px;border-radius:16px;text-decoration:none;font-size:13px;font-weight:bold;';
      const tagPillActive = 'background:#27ae60;color:#fff;';
      const tagPillIdle = 'background:#e8f5e9;color:#2c3e50;';
      const allActive = tagFilter === 'all';
      let tagsHTML = `<a href="${buildUrl(null, null, 'all')}" style="${tagPillBase}${allActive ? tagPillActive : tagPillIdle}">Все</a>`;
      for (const [tag, count] of sortedTags) {
        const isActive = tagFilter === tag;
        tagsHTML += `<a href="${buildUrl(null, null, tag)}" style="${tagPillBase}${isActive ? tagPillActive : tagPillIdle}">#${esc(tag)} ${count}</a>`;
      }
      tagPillsHTML = `<div style="margin:10px 0 6px;">${tagsHTML}</div>`;
    }

    const filtersHTML = `
      ${tagPillsHTML}
      <div style="margin:10px 0 6px;">
        ${pill('Все', 'all')}${pill('До 3000 ₽', 'low')}${pill('3000–6000 ₽', 'mid')}${pill('От 6000 ₽', 'high')}
      </div>
      <div style="margin-bottom:20px;">
        ${sortPill('↓ Сначала дешевле', 'asc')}${sortPill('↑ Сначала дороже', 'desc')}
      </div>`;

    const useTwoColumns = active.length > TWO_COLUMNS_THRESHOLD;
    const gridStyle = useTwoColumns
      ? 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;max-width:760px;margin:0 auto;align-items:stretch;'
      : 'display:flex;flex-wrap:wrap;justify-content:center;';
    const cardExtraStyle = useTwoColumns ? 'width:100%;box-sizing:border-box;min-width:0;' : 'max-width:300px;';

    let cards = '';
    if (active.length === 0) {
      cards = '<div style="text-align:center;padding:50px;font-size:20px;color:#888;grid-column:1/-1;">🌿 По этому фильтру букетов нет.</div>';
    } else {
      for (const b of active) {
        const photoRefsList = [];
        for (const p of b.photos) {
          const r = getPhotoRefs(p);
          if (r.primary) photoRefsList.push(r);
        }
        let gallery = '';
        if (photoRefsList.length === 0) gallery = `<div style="width:100%;aspect-ratio:1/1;background:#f0f0f0;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:40px;">📷</div>`;
        else if (photoRefsList.length === 1) {
          gallery = renderImgTag(photoRefsList[0], 'width:100%;border-radius:12px;aspect-ratio:1/1;object-fit:cover;');
        } else {
          const slides = photoRefsList.map(r => renderImgTag(r, 'height:220px;width:auto;border-radius:12px;flex-shrink:0;')).join('');
          gallery = `<div style="display:flex;overflow-x:auto;gap:6px;margin-bottom:4px;max-width:100%;min-width:0;">${slides}</div>`;
        }

        const oldPrice = calculateOldPrice(b.price, shop.settings.markupPercent);
        const bouquetUrl = `${SITE_URL}/shop/${shop.shopId}/b/${b.id}`;
        const contactUrl = `/contact/${shop.shopId}/${b.id}`;

        const bouquetUrlJs = JSON.stringify(bouquetUrl);
        const bouquetNameJs = JSON.stringify(b.name);
        const bouquetPriceJs = b.price;

        const titleFontSize = useTwoColumns ? '15px' : '18px';
        const priceFontSize = useTwoColumns ? '18px' : '22px';
        const oldPriceFontSize = useTwoColumns ? '14px' : '18px';
        const cardPadding = useTwoColumns ? '10px' : '16px';
        const cardMargin = useTwoColumns ? '0' : '12px';

        const confirmedLine = formatConfirmedAt(b.confirmedAt);
        const confirmedHTML = confirmedLine
          ? `<div style="font-size:11px;color:#27ae60;margin:2px 0 4px;">✓ Обновлено ${esc(confirmedLine)}</div>`
          : '';

        cards += `<div style="border:1px solid #eee;border-radius:16px;padding:${cardPadding};margin:${cardMargin};${cardExtraStyle}background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:center;position:relative;display:flex;flex-direction:column;">
          <div style="position:absolute;top:${useTwoColumns ? '16px' : '24px'};right:${useTwoColumns ? '16px' : '24px'};background:rgba(44,62,80,0.85);color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:bold;z-index:10;">№${b.shopNumber}</div>
          ${gallery}
          <h3 style="margin:10px 0 4px;font-size:${titleFontSize};line-height:1.25;word-wrap:break-word;overflow-wrap:break-word;">${esc(b.name)}</h3>
          <p style="font-size:${priceFontSize};font-weight:bold;color:#2c3e50;margin:4px 0;">
            ${oldPrice > b.price ? `<span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:${oldPriceFontSize};">${oldPrice} ₽</span>&nbsp;` : ''}${b.price} ₽
          </p>
          ${confirmedHTML}
          <div style="margin-top:auto;">
            <a href="${contactUrl}" style="display:block;max-width:230px;margin:10px auto 0;background:#e74c3c;color:#fff;padding:12px 16px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;font-size:15px;">📞 Связаться</a>
            <div style="margin-top:8px;">
              <a href="#" onclick='shareBouquet(event, ${bouquetUrlJs}, ${bouquetNameJs}, ${bouquetPriceJs}); return false;' style="display:inline-block;color:#888;font-size:12px;text-decoration:none;padding:5px 10px;border-radius:16px;background:#f5f5f5;">📤 Поделиться</a>
            </div>
          </div>
        </div>`;
      }
    }

    const logoUrl = shop.settings.logo ? await getPhotoUrl(shop.settings.logo) : null;
    const bgRefs = shop.settings.background ? getPhotoRefs(shop.settings.background) : null;
    const bgUrl = bgRefs ? bgRefs.primary : null;
    const bodyStyle = bgUrl ? `background-image:url('${bgUrl}');background-size:cover;background-attachment:fixed;` : `background:#fafaf8;`;
    const headerHTML = logoUrl ? `<img src="${escAttr(logoUrl)}" style="max-height:90px;display:block;margin:0 auto 12px;">` : '';

    const totalActiveCount = all.filter(isConfirmedRecently).length;
    const countLine = totalActiveCount > 0 ? `<div style="font-size:13px;color:#27ae60;margin-top:6px;">🌸 ${totalActiveCount} ${plural(totalActiveCount, 'букет', 'букета', 'букетов')} в наличии</div>` : '';

    const titleHTML = `<div style="background:rgba(255,255,255,0.9);border-radius:18px;padding:14px 20px;max-width:560px;margin:0 auto 16px;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><h1 style="color:#2c3e50;margin:0 0 6px;font-size:24px;">${esc(shop.displayName)}</h1>${(shop.address || shop.hours) ? `<div style="color:#555;font-size:14px;">${shop.address ? `📍 ${esc(shop.address)}` : ''} ${shop.hours ? `· 🕐 ${esc(shop.hours)}` : ''}</div>` : ''}${countLine}</div>`;

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(shop.displayName)} — Flowind</title>
      <style>
        body{font-family:-apple-system,sans-serif;margin:0;padding:20px;text-align:center;${bodyStyle}}
        h1{color:#2c3e50;}
        .container{max-width:1200px;margin:0 auto;}
        .shop-grid img{cursor:zoom-in;}
      </style></head>
      <body><div class="container">${headerHTML}${titleHTML}${filtersHTML}<div class="shop-grid" style="${gridStyle}">${cards}</div></div>

      <div id="lightbox" onclick="closeLightbox()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;">
        <img id="lightbox-img" src="" alt="" style="max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,0.6);">
        <button onclick="closeLightbox()" style="position:fixed;top:20px;right:20px;background:rgba(255,255,255,0.95);border:none;width:44px;height:44px;border-radius:50%;font-size:22px;cursor:pointer;font-weight:bold;color:#333;box-shadow:0 2px 8px rgba(0,0,0,0.4);">✕</button>
      </div>

      <script>
        function shareBouquet(e, url, name, price) {
          if (e) { e.preventDefault(); }
          var text = name + ' — ' + price + ' ₽';
          if (navigator.share) {
            navigator.share({ title: name, text: text, url: url }).catch(function(){});
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function(){
              alert('Ссылка скопирована — вставьте её в мессенджер');
            }).catch(function(){ prompt('Скопируйте ссылку:', url); });
          } else { prompt('Скопируйте ссылку:', url); }
        }
        function openLightbox(src) {
          var lb = document.getElementById('lightbox');
          var img = document.getElementById('lightbox-img');
          img.src = src;
          lb.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        }
        function closeLightbox() {
          document.getElementById('lightbox').style.display = 'none';
          document.getElementById('lightbox-img').src = '';
          document.body.style.overflow = '';
        }
        document.addEventListener('click', function(e) {
          var img = e.target.closest('.shop-grid img');
          if (!img) return;
          e.preventDefault();
          e.stopPropagation();
          openLightbox(img.src);
        });
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') closeLightbox();
        });
      </script>
      </body></html>`);
  } catch (e) { console.error('Ошибка витрины'); res.status(500).send('Ошибка'); }
});

app.get('/', (req, res) => res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>🌸 Flowind</h1></body></html>'));

async function checkAndNotify() {
  try {
    const shops = await pool.query('SELECT shop_id FROM shops WHERE blocked = FALSE');
    for (const s of shops.rows) {
      const active = await getBouquetsFromDb(s.shop_id);
      for (const b of active) {
        if (b.isPinned || b.hidden || b.reminded || !b.confirmedAt) continue;
        const rem = 3 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(b.confirmedAt).getTime());
        if (rem > 0 && rem <= 12 * 60 * 60 * 1000) {
          bot.sendMessage(b.chatId, `⚠️ Букет №${b.shopNumber} «${esc(b.name)}» скоро скроется. Продлить?`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🌿 Продлить', callback_data: `extend_${b.id}` }]] } }).catch(function(){});
          await updateBouquetField(b.id, 'reminded', true);
        }
      }
    }
  } catch (e) { console.error('Notify error'); }
}

function cleanupExpiredCheckSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const chatId of Object.keys(checkSessions)) {
    const s = checkSessions[chatId];
    if (!s || !s.lastActivity || now - s.lastActivity > CHECK_SESSION_TTL) {
      delete checkSessions[chatId];
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 Очищено сессий проверки: ${cleaned}`);
}

initDb().then(async () => {
  const existing = await getShopFromDb(PRESET_SHOP.shopId);
  if (!existing) {
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
    const inviteCode = generateInviteCode();
    await createShopInDb({
      shopId: PRESET_SHOP.shopId, name: PRESET_SHOP.shopId,
      displayName: PRESET_SHOP.displayName, address: PRESET_SHOP.address,
      hours: PRESET_SHOP.hours, phone: normalizePhone(PRESET_SHOP.phone),
      telegramUsername: PRESET_SHOP.telegramUsername,
      whatsappPhone: normalizePhone(PRESET_SHOP.whatsappPhone),
      maxLink: PRESET_SHOP.maxLink,
      inviteCode, trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(),
      settings: { logo: null, background: null, markupPercent: PRESET_SHOP.markupPercent, aiEnabled: false },
      stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
    });
    console.log(`✅ Preset-магазин ${PRESET_SHOP.shopId} создан`);
  } else {
    console.log(`✅ Preset-магазин ${PRESET_SHOP.shopId} найден`);
    if (!existing.maxLink) {
      await updateShopField(PRESET_SHOP.shopId, 'max_username', PRESET_SHOP.maxLink);
      console.log(`✅ MAX-ссылка для ${PRESET_SHOP.shopId} установлена`);
    }
  }

  const WEBHOOK_URL = `${SITE_URL}${WEBHOOK_PATH}`;
  console.log('🔗 Устанавливаем webhook...');
  try {
    await bot.deleteWebHook();
    await bot.setWebHook(WEBHOOK_URL);
    console.log(`✅ Webhook установлен`);
  } catch (e) { console.error('❌ Ошибка установки webhook'); }

  setInterval(checkAndNotify, 10 * 60 * 1000);
  setInterval(cleanupExpiredCheckSessions, 5 * 60 * 1000);
  setInterval(cleanupNotifiedClicks, 5 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Flowind на порту ${PORT} (webhook)`));
}).catch(err => { console.error('❌ Ошибка инициализации:', err.message); process.exit(1); });
