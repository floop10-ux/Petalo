const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('./db');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN не задан в переменных окружения Render');
  process.exit(1);
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

const BOT_USERNAME = 'petalo_rus_bot';
const SITE_URL = 'https://petalo.onrender.com';

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

const MAX_BUTTONS_PER_SECTION = 20;
const MAX_LIST_ITEMS = 25;
const MAX_SESSION_BOUQUETS = 80;
const TWO_COLUMNS_THRESHOLD = 12;

const MENU_BUTTONS = [
  '📷 Добавить букет',
  '✅ Что в наличии?',
  '✏️ Изменить цену',
  '📝 Переименовать',
  '🗑 Удалить букет',
  '📦 Архив',
  '⚙️ Меню'
];

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
      return { primary: `/photo/tg/${photo}`, fallback: null };
    }
    return { primary: null, fallback: null };
  }
  if (typeof photo === 'object') {
    if (photo.s3 && photo.tg) {
      return { primary: photo.s3, fallback: `/photo/tg/${photo.tg}` };
    }
    if (photo.s3) return { primary: photo.s3, fallback: null };
    if (photo.tg) return { primary: `/photo/tg/${photo.tg}`, fallback: null };
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
}function estimateCheckMinutes(count) {
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
  if (count > MAX_SESSION_BOUQUETS) {
    return { text: `⚠️ Слишком много букетов для одной проверки (${count}).`, options: { parse_mode: 'HTML' } };
  }
  const minutes = estimateCheckMinutes(count);
  const txt = `✅ <b>Проверка наличия</b>\n\n` +
    `В списке <b>${count}</b> ${plural(count, 'букет', 'букета', 'букетов')}.\n` +
    `⏱ Это займёт примерно <b>${minutes}</b> ${plural(minutes, 'минуту', 'минуты', 'минут')}.\n\n` +
    `<i>⚠️ Не отвлекайтесь — если прервать, проверка начнётся сначала.</i>`;
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
  let txt = `✅ <b>Проверка наличия</b>\n`;
  txt += `Проверено <b>${done}</b> из <b>${total}</b>\n\n`;
  txt += `<i>Работайте снизу списка: непроверенные букеты — под проверенными.</i>`;
  return txt;
}

function buildCheckListKeyboard(session) {
  const rows = [];
  for (const id of session.order) {
    const b = session.bouquets.find(x => x.id === id);
    if (!b) continue;
    const mark = session.checked[id] === 'yes' ? '✓' : '🚫';
    rows.push([{ text: `${mark} №${b.id} ${shortName(b.name, 16)}`, callback_data: `check_show_${b.id}` }]);
  }
  const unchecked = session.bouquets.filter(b => !session.checked[b.id]).sort((a, b) => a.id - b.id);
  for (const b of unchecked) {
    rows.push([{ text: `№${b.id} ${shortName(b.name, 16)}`, callback_data: `check_show_${b.id}` }]);
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

function buildArchiveCardText(session) {
  const total = session.bouquets.length;
  const b = session.bouquets[session.currentIndex];
  const s = getBouquetStatus(b);
  const status = s === 'hidden' ? '🚫 Убран вручную' : '❌ Срок истёк';
  let dateStr = '';
  if (b.confirmedAt) {
    const d = new Date(b.confirmedAt);
    dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }
  let txt = `📦 <b>Архив — ${session.currentIndex + 1} из ${total}</b>\n\n`;
  txt += `<b>№${b.id}</b> ${esc(b.name)}\n`;
  txt += `💰 <b>${b.price} ₽</b>\n`;
  txt += `<i>${status}`;
  if (dateStr) txt += ` · ${dateStr}`;
  txt += `</i>`;
  return txt;
}

async function showArchiveCard(chatId, session) {
  if (session.currentIndex >= session.bouquets.length) {
    delete archiveSessions[chatId];
    return bot.sendMessage(chatId, '🎉 Архив просмотрен!').catch(() => {});
  }
  const b = session.bouquets[session.currentIndex];
  const txt = buildArchiveCardText(session);
  const buttons = [
    [{ text: '↩️ Вернуть на витрину', callback_data: 'arch_restore' }],
    [{ text: '⏭ Следующий', callback_data: 'arch_next' }, { text: '⏹ Закрыть', callback_data: 'arch_close' }]
  ];
  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };

  const firstPhoto = (b.photos && b.photos.length > 0) ? b.photos[0] : null;
  const tgRef = getTelegramPhotoRef(firstPhoto);
  if (tgRef) {
    try {
      await bot.sendPhoto(chatId, tgRef, { caption: txt, ...opts });
      return;
    } catch (e) { /* фолбэк */ }
  }
  await bot.sendMessage(chatId, txt, opts);
}

async function showBouquetList(chatId, shopId, action, headerText) {
  const active = await getBouquetsFromDb(shopId);
  if (active.length === 0) return bot.sendMessage(chatId, '🌿 Нет букетов.');
  active.sort((a, b) => a.id - b.id);
  const shown = active.slice(0, MAX_LIST_ITEMS);
  let listTxt = `${headerText}\n\n`;
  for (const b of shown) {
    listTxt += `<b>№${b.id}</b> — ${esc(b.name)} — <b>${b.price} ₽</b>\n\n`;
  }
  if (active.length > shown.length) listTxt += `<i>Показаны первые ${shown.length} из ${active.length}.</i>`;
  const kb = [];
  for (let i = 0; i < shown.length; i += 4) {
    kb.push(shown.slice(i, i + 4).map(b => ({ text: `№${b.id}`, callback_data: `${action}_${b.id}` })));
  }
  return bot.sendMessage(chatId, listTxt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function sendBouquetPreview(chatId, b, headerText, buttons) {
  const caption = `${headerText}\n\n<b>№${b.id}</b> ${esc(b.name)}\n💰 ${b.price} ₽`;
  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };
  const firstPhoto = (b.photos && b.photos.length > 0) ? b.photos[0] : null;
  const tgRef = getTelegramPhotoRef(firstPhoto);
  if (tgRef) {
    try {
      await bot.sendPhoto(chatId, tgRef, { caption: caption, parse_mode: 'HTML', reply_markup: opts.reply_markup });
      return;
    } catch (e) { /* фолбэк */ }
  }
  await bot.sendMessage(chatId, caption, opts).catch(() => {});
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bouquets_shop_active ON bouquets(shop_id, deleted, is_pinned, confirmed_at DESC)`);
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
    settings: s.settings || { logo: null, background: null, markupPercent: 20, aiEnabled: false },
    stats: s.stats || { views: 0, orders: 0, calls: 0, startedAt: new Date().toISOString() },
    admins: admins.rows.map(a => ({ chatId: parseInt(a.chat_id), role: a.role, name: a.name, joinedAt: a.joined_at }))
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
async function getBouquetsFromDb(shopId, includeDeleted = false) {
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
  return { id: b.id, name: b.name, price: b.price, description: b.description, photos: b.photos || [], createdAt: b.created_at, confirmedAt: b.confirmed_at, hidden: b.hidden, deleted: b.deleted, isPinned: b.is_pinned, chatId: parseInt(b.chat_id), reminded: b.reminded, clicks: b.clicks };
}
async function addBouquetToDb(shopId, bouquet) {
  const res = await pool.query(`
    INSERT INTO bouquets (shop_id, name, price, description, photos, confirmed_at, is_pinned, chat_id, clicks)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
  `, [shopId, bouquet.name, bouquet.price, bouquet.description, JSON.stringify(bouquet.photos), new Date().toISOString(), bouquet.isPinned, bouquet.chatId, bouquet.clicks || 0]);
  return res.rows[0].id;
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

function getMainKeyboard(shop, chatId) {
  const owner = isOwner(shop, chatId);
  if (owner) {
    return { keyboard: [
      [{ text: '📷 Добавить букет' }, { text: '✅ Что в наличии?' }],
      [{ text: '✏️ Изменить цену' }, { text: '📝 Переименовать' }],
      [{ text: '🗑 Удалить букет' }, { text: '📦 Архив' }],
      [{ text: '⚙️ Меню' }]
    ], resize_keyboard: true };
  }
  return { keyboard: [
    [{ text: '📷 Добавить букет' }, { text: '✅ Что в наличии?' }],
    [{ text: '✏️ Изменить цену' }, { text: '📝 Переименовать' }],
    [{ text: '📦 Архив' }, { text: '⚙️ Меню' }]
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
  txt += `📞 Телефон: ${shop.phone ? esc(shop.phone) : '<i>не указан</i>'}\n\n`;
  txt += `📱 Telegram: ${shop.telegramUsername ? '@' + esc(shop.telegramUsername) : '<i>не указан</i>'}\n`;
  txt += `💬 WhatsApp: ${shop.whatsappPhone ? esc(shop.whatsappPhone) : '<i>не указан</i>'}\n`;
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
    <div class="sub">Букет №${bouquet.id} — ${bouquetNameEsc} — ${bouquet.price} ₽</div>
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
  const primaryPhotoUrl = (photoRefs && photoRefs.primary) ? photoRefs.primary : null;
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
<meta property="og:site_name" content="Petalo">
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
  const orderText = `Здравствуйте! Пишу с вашей витрины. Хочу заказать букет №${bouquet.id} «${bouquet.name}» — ${bouquet.price} ₽.`;
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
    const orderText = `Здравствуйте! Пишу с вашей витрины. Хочу заказать букет №${b.id} «${b.name}» — ${b.price} ₽.`;
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
});bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match && match[1] ? match[1].trim() : null;
  const userName = msg.from.first_name || 'Флорист';

  delete checkSessions[chatId];
  delete archiveSessions[chatId];

  if (param && param.startsWith('inv_')) {
    const inviteCode = param.replace('inv_', '').toUpperCase();
    const shopId = await getShopByInvite(inviteCode);
    if (shopId) {
      const shop = await getShopFromDb(shopId);
      const currentShop = await findUserShop(chatId);
      if (currentShop && currentShop !== shopId) return bot.sendMessage(chatId, '❌ Вы уже привязаны к другому магазину.');
      await addAdminToDb(chatId, shopId, 'florist', userName);
      userToShop[chatId] = shopId;
      return bot.sendMessage(chatId, `🎉 Добро пожаловать в команду «${esc(shop.displayName)}»!\n\n📷 Добавляйте букеты: фото с подписью "Название цена".\n✅ Подтверждайте наличие через «Что в наличии?».`, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
    }
    return bot.sendMessage(chatId, '❌ Приглашение недействительно.');
  }

  let shopId = userToShop[chatId] || await findUserShop(chatId);
  if (!shopId) {
    const presetShop = await getShopFromDb(PRESET_SHOP.shopId);
    if (presetShop && presetShop.admins.length === 0) {
      await addAdminToDb(chatId, PRESET_SHOP.shopId, 'owner', userName);
      userToShop[chatId] = PRESET_SHOP.shopId;
      shopId = PRESET_SHOP.shopId;
    }
  }

  if (shopId) {
    const shop = await getShopFromDb(shopId);
    if (!shop) return bot.sendMessage(chatId, '❌ Магазин не найден.');
    userToShop[chatId] = shopId;

    if (!isSubscriptionActive(shop)) {
      return bot.sendMessage(chatId,
        `⏳ <b>Подписка истекла</b>\n\nМагазин «${esc(shop.displayName)}» приостановлен. Витрина не показывается клиентам, букеты не добавляются.\n\nДля продления напишите: @floop10`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💳 Продлить', callback_data: 'menu_renew' }]] } });
    }

    const owner = isOwner(shop, chatId);
    let txt = `🌸 «${esc(shop.displayName)}»\n\n`;
    txt += owner ? `👑 Вы — владелец.\n\n` : `🌸 Вы — флорист.\n\n`;
    txt += `📷 Добавить букет — отправить фото с подписью\n`;
    txt += `✅ Что в наличии — отметить актуальные\n`;
    txt += `✏️ Изменить цену — обновить стоимость\n`;
    txt += `📝 Переименовать — изменить название\n`;
    if (owner) txt += `🗑 Удалить — убрать букет совсем\n`;
    txt += `📦 Архив — вернуть ушедшие букеты\n`;
    txt += `⚙️ Меню — настройки`;
    return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  } else {
    bot.sendMessage(chatId, '🌸 <b>Petalo</b> — витрина для цветочных магазинов.\n\nОткройте витрину магазина и напишите нам в удобном мессенджере.', { parse_mode: 'HTML' });
  }
});

bot.on('callback_query', async (q) => {
  const chatId = q.from.id;
  const data = q.data;
  bot.answerCallbackQuery(q.id).catch(() => {});

  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (!shopId) return;
  const shop = await getShopFromDb(shopId);
  if (!shop) return;
  const owner = isOwner(shop, chatId);

  if (data.startsWith('arch_')) {
    const session = archiveSessions[chatId];
    if (!session) {
      bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
      return;
    }
    if (data === 'arch_close') {
      delete archiveSessions[chatId];
      bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
      return bot.sendMessage(chatId, '📦 Архив закрыт.', { reply_markup: getMainKeyboard(shop, chatId) });
    }
    if (data === 'arch_next') {
      session.currentIndex++;
      bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
      return showArchiveCard(chatId, session);
    }
    if (data === 'arch_restore') {
      const b = session.bouquets[session.currentIndex];
      if (!b) return;
      await updateBouquetFields(b.id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
      session.currentIndex++;
      bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
      return showArchiveCard(chatId, session);
    }
  }

  if (data === 'noop') return;
  if (data === 'menu_link') return bot.sendMessage(chatId, `🔗 Ваша витрина:\n${SITE_URL}/shop/${shopId}`);
  if (data === 'menu_close') { delete checkSessions[chatId]; delete archiveSessions[chatId]; return bot.deleteMessage(chatId, q.message.message_id).catch(() => {}); }
  if (data === 'menu_back') {
    if (!owner) return;
    delete checkSessions[chatId];
    delete archiveSessions[chatId];
    return bot.editMessageText('⚙️ Меню магазина:', { chat_id: chatId, message_id: q.message.message_id, ...getSettingsMenu(shop, chatId) }).catch(() => {});
  }
  if (data === 'menu_shopdata') {
    if (!owner) return;
    const { text, options } = buildShopDataMessage(shop);
    return bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options }).catch(() => {});
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
    return bot.sendMessage(chatId, `🔑 Ссылка-приглашение:\n\n${link}`);
  }
  if (data === 'menu_team') {
    if (!owner) return;
    const others = shop.admins.filter(a => a.chatId !== chatId);
    if (others.length === 0) return bot.sendMessage(chatId, '👥 <b>Команда магазина</b>\n\nПока только вы.', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } });
    const keyboard = others.map(a => [{ text: `🌸 ${a.name || 'Флорист'}`, callback_data: `team_user_${a.chatId}` }]);
    keyboard.push([{ text: '↩️ Назад', callback_data: 'menu_back' }]);
    return bot.sendMessage(chatId, `👥 <b>Команда магазина</b> (${others.length})`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  }
  if (data.startsWith('team_user_')) {
    if (!owner) return;
    const targetChatId = parseInt(data.split('_')[2]);
    const target = shop.admins.find(a => a.chatId === targetChatId);
    if (!target) return;
    return bot.sendMessage(chatId, `🌸 <b>${esc(target.name || 'Флорист')}</b>\n\nПрисоединился: ${new Date(target.joinedAt).toLocaleDateString()}`,
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
    bot.editMessageText(`✅ Доступ для «${name}» удалён.`, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    bot.sendMessage(targetChatId, `🚫 Ваш доступ к витрине «${shop.displayName}» удалён.`).catch(() => {});
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
    return bot.editMessageText(`✅ <b>Наценка: ${percent}%</b>`, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } }).catch(() => {});
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
    let txt = `📋 <b>${esc(shop.displayName)}</b>\n\n👤 ${myRole}\n👥 Команда: ${shop.admins.length}\n📦 Букетов: ${active}\n💰 Наценка: ${shop.settings.markupPercent}%\n📅 Триал: ${days} дней`;
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
  if (data === 'resetlogo_now') { if (!owner) return; shop.settings.logo = null; await saveShopSettings(shopId, shop.settings); return bot.editMessageText('✅ Логотип убран.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {}); }
  if (data === 'resetbg_now') { if (!owner) return; shop.settings.background = null; await saveShopSettings(shopId, shop.settings); return bot.editMessageText('✅ Фон убран.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {}); }

  if (data === 'check_start') {
    const bouquets = await getCheckableBouquets(shopId);
    if (bouquets.length === 0) {
      return bot.editMessageText('🌿 На витрине нет букетов — проверять нечего.', {
        chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML'
      }).catch(() => {});
    }
    if (bouquets.length > MAX_SESSION_BOUQUETS) {
      return bot.editMessageText(`⚠️ Слишком много букетов для одной проверки (${bouquets.length}).`,
        { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    }
    checkSessions[chatId] = { shopId, bouquets, checked: {}, order: [], listMessageId: q.message.message_id };
    const session = checkSessions[chatId];
    const txt = buildCheckListText(session);
    const kb = { inline_keyboard: buildCheckListKeyboard(session) };
    return bot.editMessageText(txt, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  }

  if (data === 'check_cancel') {
    delete checkSessions[chatId];
    return bot.editMessageText('❌ Проверка отменена.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
  }

  if (data === 'check_finish') {
    delete checkSessions[chatId];
    return bot.editMessageText('✅ Проверка завершена.', { chat_id: chatId, message_id: q.message.message_id, reply_markup: getMainKeyboard(shop, chatId) }).catch(() => {
      bot.sendMessage(chatId, '✅ Проверка завершена.', { reply_markup: getMainKeyboard(shop, chatId) });
    });
  }

  if (data.startsWith('check_show_')) {
    const session = checkSessions[chatId];
    if (!session) return bot.sendMessage(chatId, '⚠️ Сессия проверки прервана. Начните заново.');
    const id = parseInt(data.split('_')[2]);
    const b = session.bouquets.find(x => x.id === id);
    if (!b) return bot.sendMessage(chatId, '⚠️ Букет больше не в списке.');
    session.currentBouquetId = id;
    const already = session.checked[id];
    const headerText = already ? `📷 <b>Проверка (уже отмечен)</b>` : `📷 <b>Проверка наличия</b>`;
    return sendBouquetPreview(chatId, b, headerText, [
      [{ text: '✅ Есть', callback_data: `check_yes_${b.id}` }],
      [{ text: '🚫 Убрать', callback_data: `check_no_${b.id}` }],
      [{ text: '↩️ К списку', callback_data: 'check_back' }]
    ]);
  }

  if (data === 'check_back') {
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
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
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
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
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return refreshCheckList(chatId, session);
  }

  if (data.startsWith('confirm_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
    return bot.sendMessage(chatId, `✅ Букет №${id} подтверждён.`);
  }
  if (data.startsWith('hide_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetField(id, 'hidden', true);
    return bot.sendMessage(chatId, `🚫 Букет №${id} убран.`);
  }
  if (data.startsWith('show_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { hidden: false, confirmed_at: new Date().toISOString(), reminded: false });
    return bot.sendMessage(chatId, `↩️ Букет №${id} возвращён.`);
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
    return bot.sendMessage(chatId, `✏️ Напишите новую цену для букета <b>№${b.id}</b> (${esc(b.name)}).\nТекущая: <b>${b.price} ₽</b>\n<i>Отмена — /cancel</i>`, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }
  if (data.startsWith('editprice_no_')) {
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return showBouquetList(chatId, shopId, 'editprice', '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.');
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
    return bot.sendMessage(chatId, `📝 Напишите новое название для букета <b>№${b.id}</b>.\nТекущее: <b>${esc(b.name)}</b>\n<i>Точка в начале — закрепить. Отмена — /cancel</i>`, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }
  if (data.startsWith('rename_no_')) {
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return showBouquetList(chatId, shopId, 'rename', '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.');
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
    await updateBouquetField(id, 'deleted', true);
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return showBouquetList(chatId, shopId, 'askdel', `✅ <b>Букет №${id} удалён с витрины.</b>\n\n🗑 Какой удалить ещё?`);
  }
  if (data === 'canceldel') {
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return showBouquetList(chatId, shopId, 'askdel', '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.');
  }
});

async function refreshCheckList(chatId, session) {
  const total = session.bouquets.length;
  const done = Object.keys(session.checked).length;
  if (done >= total) {
    delete checkSessions[chatId];
    try {
      await bot.editMessageText(`🎉 <b>Проверка завершена!</b>\n\nВсе ${total} ${plural(total, 'букет', 'букета', 'букетов')} проверены.`, {
        chat_id: chatId, message_id: session.listMessageId, parse_mode: 'HTML'
      });
    } catch (e) {
      await bot.sendMessage(chatId, `🎉 Проверка завершена! Все ${total} букетов проверены.`, { parse_mode: 'HTML' });
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
    } catch (e2) { /* ничего */ }
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  if (MENU_BUTTONS.includes(text)) {
    delete awaitingPrice[chatId];
    delete awaitingName[chatId];
    delete awaitingMarkup[chatId];
    delete awaitingInput[chatId];
    delete awaitingUpload[chatId];
    delete checkSessions[chatId];
    delete archiveSessions[chatId];
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
    await updateBouquetFields(awaitingName[chatId], { name: newName, is_pinned: newName.startsWith('.') });
    delete awaitingName[chatId];
    const shop = await getShopFromDb(shopId);
    return bot.sendMessage(chatId, `✅ Переименовано: «${newName}»`, { reply_markup: getMainKeyboard(shop, chatId) });
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

  if (text === '📷 Добавить букет') return bot.sendMessage(chatId, '📷 Отправьте фото с подписью "Название цена".\n\n💡 Ещё фото — без подписи.', { reply_markup: getMainKeyboard(shop, chatId) });
  if (text === '✅ Что в наличии?') {
    if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла.');
    const { text: t, options } = await buildCheckStartScreen(shopId);
    return bot.sendMessage(chatId, t, options);
  }
  if (text === '✏️ Изменить цену') {
    return showBouquetList(chatId, shopId, 'editprice', '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.');
  }
  if (text === '📝 Переименовать') {
    return showBouquetList(chatId, shopId, 'rename', '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.');
  }
  if (text === '🗑 Удалить букет') {
    if (!isOwner(shop, chatId)) return bot.sendMessage(chatId, '🚫 Только владелец.');
    return showBouquetList(chatId, shopId, 'askdel', '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.');
  }
  if (text === '📦 Архив') {
    const arch = await getArchivedBouquets(shopId);
    if (arch.length === 0) return bot.sendMessage(chatId, '📦 В архиве пусто — все букеты на витрине.', { reply_markup: getMainKeyboard(shop, chatId) });
    archiveSessions[chatId] = { bouquets: arch, currentIndex: 0 };
    return showArchiveCard(chatId, archiveSessions[chatId]);
  }
  if (text === '⚙️ Меню') return bot.sendMessage(chatId, '⚙️ Меню магазина:', getSettingsMenu(shop, chatId));
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ /start');
  const shop = await getShopFromDb(shopId);

  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;

  if (awaitingUpload[chatId]) {
    const which = awaitingUpload[chatId];
    if (which === 'logo' || which === 'background') {
      bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(() => {});
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
    const words = caption.split(/\s+/);
    let price = 0, name = caption;
    for (let i = words.length - 1; i >= 0; i--) {
      const num = parseFloat(words[i]);
      if (!isNaN(num) && num > 0) { price = num; name = words.slice(0, i).join(' '); break; }
    }
    if (price === 0 || !name) return bot.sendMessage(chatId, '❌ Укажите цену в конце. Пример: "Розы 4500"');
    const finalName = name.trim();

    bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(() => {});
    const result = await savePhotoToStorage(fileId, shopId);

    const norm = normalizeName(finalName);
    const all = await getBouquetsFromDb(shopId, true);
    let archivedClicks = 0;
    for (const old of all) if (old.deleted && normalizeName(old.name) === norm) archivedClicks += (old.clicks || 0);

    const id = await addBouquetToDb(shopId, {
      name: finalName, price: Math.round(price), description: null,
      photos: [result], isPinned: finalName.startsWith('.'),
      chatId, clicks: archivedClicks
    });
    lastBouquetByUser[chatId] = id;

    let reply = `✅ Букет <b>№${id}</b> «${esc(finalName)}» добавлен! ${Math.round(price)} ₽`;
    if (archivedClicks > 0) reply += `\n\n📊 Учтено прошлых кликов: ${archivedClicks}`;
    reply += `\n\n💡 Ещё фото? Отправьте без подписи.`;
    return bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  }

  const lastId = lastBouquetByUser[chatId];
  if (!lastId) return bot.sendMessage(chatId, '❌ Отправьте фото с подписью.');
  const b = await getBouquetById(shopId, lastId);
  if (!b) return bot.sendMessage(chatId, '❌ Букет не найден.');

  bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(() => {});
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
  delete checkSessions[chatId]; delete archiveSessions[chatId];
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
  const chatId = msg.chat.id;
  const existing = userToShop[chatId] || await findUserShop(chatId);
  if (existing) return bot.sendMessage(chatId, '❌ Уже привязаны к магазину.');
  registrationState[chatId] = { step: 'name', data: {} };
  bot.sendMessage(chatId, '📝 Шаг 1 из 8.\n\n<b>Техническое имя</b> (латиницей, без пробелов).\nПример: <code>flowers_msk</code>', { parse_mode: 'HTML' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  const state = registrationState[chatId];
  if (!state) return;

  if (state.step === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]+$/.test(name)) return bot.sendMessage(chatId, '❌ Только латиница, цифры, _.');
    if (await getShopFromDb(name)) return bot.sendMessage(chatId, '❌ Имя занято.');
    state.data.shopId = name;
    state.step = 'displayName';
    return bot.sendMessage(chatId, '✅ Шаг 2. Красивое название.');
  }
  if (state.step === 'displayName') {
    if (text.length < 2 || text.length > 60) return bot.sendMessage(chatId, '❌ 2–60 символов.');
    state.data.displayName = text.trim();
    state.step = 'address';
    return bot.sendMessage(chatId, '✅ Шаг 3. Адрес (или "нет").');
  }
  if (state.step === 'address') {
    state.data.address = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'hours';
    return bot.sendMessage(chatId, '✅ Шаг 4. Часы работы (или "нет").');
  }
  if (state.step === 'hours') {
    state.data.hours = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'phone';
    return bot.sendMessage(chatId, '✅ Шаг 5. Телефон для кнопки «Позвонить» (или "нет").');
  }
  if (state.step === 'phone') {
    state.data.phone = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'telegram';
    return bot.sendMessage(chatId, '✅ Шаг 6. <b>Telegram-юзернейм</b> (без @).\nПример: <code>KupidonAdm</code>\n(или "нет")', { parse_mode: 'HTML' });
  }
  if (state.step === 'telegram') {
    state.data.telegramUsername = text.trim().toLowerCase() === 'нет' ? null : text.trim().replace(/^@/, '').toLowerCase();
    state.step = 'whatsapp';
    return bot.sendMessage(chatId, '✅ Шаг 7. <b>Номер WhatsApp</b>.\nПример: <code>+7 962 402-51-75</code>\n(или "нет")', { parse_mode: 'HTML' });
  }
  if (state.step === 'whatsapp') {
    state.data.whatsappPhone = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'max';
    return bot.sendMessage(chatId, '✅ Шаг 8. 🅼 <b>Ссылка на профиль в MAX</b>\n\n<b>Как получить:</b>\n1. Откройте приложение MAX\n2. Зайдите в свой профиль\n3. Нажмите «Пригласить друзей» или «Поделиться»\n4. Скопируйте ссылку\n\nОна начинается с <code>https://max.ru/u/...</code>\n\nПришлите её сюда целиком.\n(или "нет")', { parse_mode: 'HTML' });
  }
  if (state.step === 'max') {
    if (text.trim().toLowerCase() === 'нет') {
      state.data.maxLink = null;
    } else {
      const v = text.trim();
      if (!/^https?:\/\/max\.ru\//.test(v)) {
        return bot.sendMessage(chatId, '❌ Ссылка должна начинаться с <code>https://max.ru/u/...</code>\n\nПопробуйте ещё раз или напишите "нет".', { parse_mode: 'HTML' });
      }
      state.data.maxLink = v;
    }

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
    const inviteCode = generateInviteCode();
    const userName = msg.from.first_name || 'Владелец';
    await createShopInDb({
      shopId: state.data.shopId, name: state.data.shopId,
      displayName: state.data.displayName, address: state.data.address,
      hours: state.data.hours, phone: state.data.phone,
      telegramUsername: state.data.telegramUsername,
      whatsappPhone: state.data.whatsappPhone,
      maxLink: state.data.maxLink,
      inviteCode, trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(),
      settings: { logo: null, background: null, markupPercent: 20, aiEnabled: false },
      stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
    });
    await addAdminToDb(chatId, state.data.shopId, 'owner', userName);
    userToShop[chatId] = state.data.shopId;
    delete registrationState[chatId];
    const shop = await getShopFromDb(state.data.shopId);
    return bot.sendMessage(chatId, `🎉 Магазин создан!\n🔗 ${SITE_URL}/shop/${state.data.shopId}`, { reply_markup: getMainKeyboard(shop, chatId) });
  }
});

app.get('/shop/:shopId', async (req, res) => {
  try {
    const shop = await getShopFromDb(req.params.shopId);
    if (!shop) return res.status(404).send('❌ Магазин не найден');
    if (!isSubscriptionActive(shop)) return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>🌸 ${esc(shop.displayName)}</h1><p>Витрина приостановлена.</p></body></html>`);

    const priceFilter = req.query.price || 'all';
    const sortParam = req.query.sort || 'default';

    let all = await getBouquetsFromDb(shop.shopId);
    let active = all.filter(isConfirmedRecently);

    if (priceFilter === 'low') active = active.filter(b => b.price < 3000);
    else if (priceFilter === 'mid') active = active.filter(b => b.price >= 3000 && b.price <= 6000);
    else if (priceFilter === 'high') active = active.filter(b => b.price > 6000);

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

    const buildUrl = (newPrice, newSort) => {
      const p = newPrice || priceFilter;
      const s = newSort || sortParam;
      const parts = [];
      if (p !== 'all') parts.push('price=' + p);
      if (s !== 'default') parts.push('sort=' + s);
      return '/shop/' + shop.shopId + (parts.length ? '?' + parts.join('&') : '');
    };

    const pillBase = 'display:inline-block;padding:8px 16px;margin:4px;border-radius:20px;text-decoration:none;font-size:14px;font-weight:bold;';
    const pillActive = 'background:#e74c3c;color:#fff;';
    const pillIdle = 'background:#f0f0f0;color:#555;';
    const pill = (label, filterValue) => {
      const isActive = priceFilter === filterValue;
      return `<a href="${buildUrl(filterValue, null)}" style="${pillBase}${isActive ? pillActive : pillIdle}">${label}</a>`;
    };

    const sortPillBase = 'display:inline-block;padding:6px 12px;margin:4px;border-radius:16px;text-decoration:none;font-size:13px;';
    const sortPillActive = 'background:#3498db;color:#fff;';
    const sortPillIdle = 'background:#f5f5f5;color:#666;';
    const sortPill = (label, sortValue) => {
      const isActive = sortParam === sortValue;
      return `<a href="${buildUrl(null, sortValue)}" style="${sortPillBase}${isActive ? sortPillActive : sortPillIdle}">${label}</a>`;
    };

    const filtersHTML = `
      <div style="margin:20px 0 6px;">
        ${pill('Все', 'all')}${pill('До 3000 ₽', 'low')}${pill('3000–6000 ₽', 'mid')}${pill('От 6000 ₽', 'high')}
      </div>
      <div style="margin-bottom:20px;">
        ${sortPill('↓ Сначала дешевле', 'asc')}${sortPill('↑ Сначала дороже', 'desc')}
      </div>`;

    const useTwoColumns = active.length > TWO_COLUMNS_THRESHOLD;
    const gridStyle = useTwoColumns
      ? 'display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:760px;margin:0 auto;grid-auto-rows:1fr;align-items:stretch;'
      : 'display:flex;flex-wrap:wrap;justify-content:center;';
    const cardExtraStyle = useTwoColumns ? 'width:100%;box-sizing:border-box;' : 'max-width:300px;';

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
          gallery = `<div style="display:flex;overflow-x:auto;gap:6px;margin-bottom:4px;">${slides}</div>`;
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

        cards += `<div style="border:1px solid #eee;border-radius:16px;padding:${cardPadding};margin:${cardMargin};${cardExtraStyle}background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:center;position:relative;display:flex;flex-direction:column;">
          <div style="position:absolute;top:${useTwoColumns ? '16px' : '24px'};right:${useTwoColumns ? '16px' : '24px'};background:rgba(44,62,80,0.85);color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:bold;z-index:10;">№${b.id}</div>
          ${gallery}
          <h3 style="margin:10px 0 4px;font-size:${titleFontSize};line-height:1.25;">${esc(b.name)}</h3>
          <p style="font-size:${priceFontSize};font-weight:bold;color:#2c3e50;margin:4px 0;">
            ${oldPrice > b.price ? `<span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:${oldPriceFontSize};">${oldPrice} ₽</span>&nbsp;` : ''}${b.price} ₽
          </p>
          <div style="margin-top:auto;">
            <a href="${contactUrl}" style="display:block;margin-top:10px;background:#e74c3c;color:#fff;padding:12px 16px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;font-size:15px;">📞 Связаться</a>
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

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(shop.displayName)} — Petalo</title>
      <style>body{font-family:-apple-system,sans-serif;margin:0;padding:20px;text-align:center;${bodyStyle}} h1{color:#2c3e50;} .container{max-width:1200px;margin:0 auto;}</style></head>
      <body><div class="container">${headerHTML}<h1>${esc(shop.displayName)}</h1><div style="color:#555;font-size:14px;margin-bottom:10px;">${shop.address ? `📍 ${esc(shop.address)}` : ''} ${shop.hours ? `· 🕐 ${esc(shop.hours)}` : ''}</div>${filtersHTML}<div style="${gridStyle}">${cards}</div></div>
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
      </script>
      </body></html>`);
  } catch (e) { console.error('Ошибка витрины'); res.status(500).send('Ошибка'); }
});

app.get('/', (req, res) => res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>🌸 Petalo</h1></body></html>'));

async function checkAndNotify() {
  try {
    const shops = await pool.query('SELECT shop_id FROM shops');
    for (const s of shops.rows) {
      const active = await getBouquetsFromDb(s.shop_id);
      for (const b of active) {
        if (b.isPinned || b.hidden || b.reminded || !b.confirmedAt) continue;
        const rem = 3 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(b.confirmedAt).getTime());
        if (rem > 0 && rem <= 12 * 60 * 60 * 1000) {
          bot.sendMessage(b.chatId, `⚠️ Букет №${b.id} «${esc(b.name)}» скоро скроется. Продлить?`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🌿 Продлить', callback_data: `extend_${b.id}` }]] } }).catch(() => {});
          await updateBouquetField(b.id, 'reminded', true);
        }
      }
    }
  } catch (e) { console.error('Notify error'); }
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
      hours: PRESET_SHOP.hours, phone: PRESET_SHOP.phone,
      telegramUsername: PRESET_SHOP.telegramUsername,
      whatsappPhone: PRESET_SHOP.whatsappPhone,
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

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Petalo на порту ${PORT} (webhook)`));
}).catch(err => { console.error('❌ Ошибка инициализации:', err.message); process.exit(1); });
