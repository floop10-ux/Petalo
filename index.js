const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./db');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN не задан в переменных окружения Render');
  process.exit(1);
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

const PRESET_SHOP = {
  shopId: 'kupidon',
  displayName: '🌸 Kupidon - для цветов не нужен повод',
  address: 'Ставрополь, Краснофлотская 157/1',
  hours: 'Пн-Вс 10:30-21:00',
  phone: '+7 962 402-51-75',
  telegramUsername: 'KupidonAdm',
  whatsappPhone: '+7 962 402-51-75',
  maxUsername: '',
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

const MAX_BUTTONS_PER_SECTION = 20;
const MAX_LIST_ITEMS = 25;

const MENU_BUTTONS = [
  '📷 Добавить букет',
  '✅ Что в наличии?',
  '✏️ Изменить цену',
  '📝 Переименовать',
  '🗑 Удалить букет',
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
async function getPhotoUrl(fileId) {
  if (!isValidFileId(fileId)) return null;
  const cached = photoUrlCache[fileId];
  if (cached && cached.expires > Date.now()) return cached.url;
  try {
    const fileInfo = await bot.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    photoUrlCache[fileId] = { url, expires: Date.now() + 50 * 60 * 1000 };
    return url;
  } catch (e) { return null; }
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
  if (firstPhoto && isValidFileId(firstPhoto)) {
    try {
      await bot.sendPhoto(chatId, firstPhoto, { caption: caption, parse_mode: 'HTML', reply_markup: opts.reply_markup });
      return;
    } catch (e) { /* фолбэк на текст */ }
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
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS max_username VARCHAR(100)`);

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
    whatsappPhone: s.whatsapp_phone, maxUsername: s.max_username,
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
    shop.telegramUsername, shop.whatsappPhone || null, shop.maxUsername || null,
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
      [{ text: '🗑 Удалить букет' }, { text: '⚙️ Меню' }]
    ], resize_keyboard: true };
  }
  return { keyboard: [
    [{ text: '📷 Добавить букет' }, { text: '✅ Что в наличии?' }],
    [{ text: '✏️ Изменить цену' }, { text: '📝 Переименовать' }],
    [{ text: '⚙️ Меню' }]
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
  txt += `🅼 MAX: ${shop.maxUsername ? '@' + esc(shop.maxUsername) : '<i>не указан</i>'}\n\n`;
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

function buildCheckMessageFromList(shop, active) {
  if (active.length === 0) return { text: '🌿 Нет букетов.', options: { parse_mode: 'HTML' } };
  active.sort((a, b) => a.id - b.id);
  const fresh = [], stale = [], expired = [], hidden = [], pinned = [];
  for (const b of active) {
    const s = getBouquetStatus(b);
    if (s === 'fresh') fresh.push(b);
    else if (s === 'stale') stale.push(b);
    else if (s === 'expired') expired.push(b);
    else if (s === 'hidden') hidden.push(b);
    else if (s === 'pinned') pinned.push(b);
  }

  const rows = [];
  const truncated = [];
  const header = (label) => rows.push([{ text: label, callback_data: 'noop' }]);

  if (fresh.length > 0) {
    header(`— ✅ ЕСТЬ (${fresh.length}) —`);
    for (const b of fresh.slice(0, MAX_BUTTONS_PER_SECTION)) {
      rows.push([{ text: `✅ №${b.id} ${shortName(b.name, 14)}`, callback_data: `confirm_${b.id}` }]);
      rows.push([{ text: `🚫 Убрать №${b.id} — ${b.price} ₽`, callback_data: `hide_${b.id}` }]);
    }
    if (fresh.length > MAX_BUTTONS_PER_SECTION) truncated.push(`первые ${MAX_BUTTONS_PER_SECTION} из ${fresh.length} в «ЕСТЬ»`);
  }
  if (stale.length > 0) {
    header(`— ⏰ СКОРО ИСЧЕЗНУТ (${stale.length}) —`);
    for (const b of stale.slice(0, MAX_BUTTONS_PER_SECTION)) {
      const h = hoursLeft(b);
      rows.push([{ text: `✅ №${b.id} ${shortName(b.name, 14)} (${h}ч)`, callback_data: `confirm_${b.id}` }]);
      rows.push([{ text: `🚫 Убрать №${b.id} — ${b.price} ₽`, callback_data: `hide_${b.id}` }]);
    }
    if (stale.length > MAX_BUTTONS_PER_SECTION) truncated.push(`первые ${MAX_BUTTONS_PER_SECTION} из ${stale.length} в «СКОРО ИСЧЕЗНУТ»`);
  }
  if (hidden.length > 0) {
    header(`— 🚫 УБРАНЫ (${hidden.length}) —`);
    for (const b of hidden.slice(0, MAX_BUTTONS_PER_SECTION)) {
      rows.push([{ text: `↩️ №${b.id} ${shortName(b.name, 14)}`, callback_data: `show_${b.id}` }]);
    }
    if (hidden.length > MAX_BUTTONS_PER_SECTION) truncated.push(`первые ${MAX_BUTTONS_PER_SECTION} из ${hidden.length} в «УБРАНЫ»`);
  }
  if (expired.length > 0) {
    header(`— ❌ ИСТЁК (${expired.length}) —`);
    for (const b of expired.slice(0, MAX_BUTTONS_PER_SECTION)) {
      rows.push([{ text: `↩️ №${b.id} ${shortName(b.name, 14)}`, callback_data: `confirm_${b.id}` }]);
    }
    if (expired.length > MAX_BUTTONS_PER_SECTION) truncated.push(`первые ${MAX_BUTTONS_PER_SECTION} из ${expired.length} в «ИСТЁК»`);
  }
  if (pinned.length > 0) {
    header(`— ⭐ ЗАКРЕПЛЕНЫ (${pinned.length}) —`);
    for (const b of pinned.slice(0, MAX_BUTTONS_PER_SECTION)) {
      rows.push([{ text: `⭐ №${b.id} ${shortName(b.name, 14)} — ${b.price} ₽`, callback_data: 'noop' }]);
    }
    if (pinned.length > MAX_BUTTONS_PER_SECTION) truncated.push(`первые ${MAX_BUTTONS_PER_SECTION} из ${pinned.length} в «ЗАКРЕПЛЕНЫ»`);
  }

  let text = '✅ <b>Что есть в наличии?</b>\n';
  text += 'Нажмите <b>✅</b> чтобы подтвердить букет, или <b>🚫</b> чтобы убрать.';
  if (truncated.length > 0) text += `\n\n<i>⚠️ ${truncated.join('; ')}. Полный список — в витрине.</i>`;

  return { text, options: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } } };
}

app.get('/go/:shopId/:bouquetId/:type', async (req, res) => {
  try {
    const { shopId, type } = req.params;
    const bouquetId = parseInt(req.params.bouquetId);
    if (!bouquetId || isNaN(bouquetId)) return res.status(404).send('Не найдено');
    const shop = await getShopFromDb(shopId);
    if (!shop) return res.status(404).send('Не найдено');
    const b = await getBouquetById(shopId, bouquetId);
    if (!b) return res.status(404).send('Букет не найден');

    let redirectUrl = null;
    if (type === 'tg' && shop.telegramUsername) {
      redirectUrl = `https://t.me/${shop.telegramUsername}`;
      await incrementShopStat(shopId, 'orders');
    } else if (type === 'wa' && shop.whatsappPhone) {
      const waPhone = shop.whatsappPhone.replace(/\D/g, '');
      const orderText = `Здравствуйте! Пишу с вашей витрины. Хочу заказать букет №${b.id} «${b.name}» — ${b.price} ₽.`;
      redirectUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(orderText)}`;
      await incrementShopStat(shopId, 'orders');
    } else if (type === 'max' && shop.maxUsername) {
      redirectUrl = `https://max.ru/${shop.maxUsername}`;
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
});bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = match && match[1] ? match[1].trim() : null;
  const userName = msg.from.first_name || 'Флорист';

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

  if (data === 'noop') return;
  if (data === 'menu_link') return bot.sendMessage(chatId, `🔗 Ваша витрина:\nhttps://petalo.onrender.com/shop/${shopId}`);
  if (data === 'menu_close') return bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
  if (data === 'menu_back') {
    if (!owner) return;
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
      max:         { q: '🅼 Введите <b>MAX-юзернейм</b> (без @).\nПример: <i>kupidon</i>\n(или "нет", чтобы убрать)', field: 'max_username' }
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

  if (data.startsWith('confirm_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
    const active = await getBouquetsFromDb(shopId);
    const { text, options } = buildCheckMessageFromList(shop, active);
    return bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options }).catch(() => {});
  }
  if (data.startsWith('hide_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetField(id, 'hidden', true);
    const active = await getBouquetsFromDb(shopId);
    const { text, options } = buildCheckMessageFromList(shop, active);
    return bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options }).catch(() => {});
  }
  if (data.startsWith('show_')) {
    const id = parseInt(data.split('_')[1]);
    await updateBouquetFields(id, { hidden: false, confirmed_at: new Date().toISOString(), reminded: false });
    const active = await getBouquetsFromDb(shopId);
    const { text, options } = buildCheckMessageFromList(shop, active);
    return bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options }).catch(() => {});
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
    return bot.editMessageText('✅ Букет удалён с витрины.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
  }
  if (data === 'canceldel') {
    bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return showBouquetList(chatId, shopId, 'askdel', '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.');
  }
});

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
    if (input.field === 'max_username' && value) value = value.replace(/^@/, '').toLowerCase();

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
    const active = await getBouquetsFromDb(shopId);
    const { text: t, options } = buildCheckMessageFromList(shop, active);
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
      shop.settings[which] = fileId;
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

    const norm = normalizeName(finalName);
    const all = await getBouquetsFromDb(shopId, true);
    let archivedClicks = 0;
    for (const old of all) if (old.deleted && normalizeName(old.name) === norm) archivedClicks += (old.clicks || 0);

    const id = await addBouquetToDb(shopId, {
      name: finalName, price: Math.round(price), description: null,
      photos: [fileId], isPinned: finalName.startsWith('.'),
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
  const photos = b.photos || [];
  photos.push(fileId);
  await updateBouquetField(lastId, 'photos', JSON.stringify(photos));
  return bot.sendMessage(chatId, `📸 Фото добавлено. Всего: ${photos.length}`, { reply_markup: getMainKeyboard(shop, chatId) });
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  delete awaitingUpload[chatId]; delete awaitingInput[chatId]; delete awaitingPrice[chatId];
  delete awaitingName[chatId]; delete awaitingMarkup[chatId];
  const shopId = userToShop[chatId] || await findUserShop(chatId);
  if (shopId) {
    const shop = await getShopFromDb(shopId);
    return bot.sendMessage(chatId, '❌ Отменено.', { reply_markup: getMainKeyboard(shop, chatId) });
  }
  bot.sendMessage(chatId, '❌ Отменено.');
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
    return bot.sendMessage(chatId, '✅ Шаг 8. <b>MAX-юзернейм</b> (без @).\nПример: <code>kupidon</code>\n(или "нет")', { parse_mode: 'HTML' });
  }
  if (state.step === 'max') {
    state.data.maxUsername = text.trim().toLowerCase() === 'нет' ? null : text.trim().replace(/^@/, '').toLowerCase();

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
      maxUsername: state.data.maxUsername,
      inviteCode, trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(),
      settings: { logo: null, background: null, markupPercent: 20, aiEnabled: false },
      stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
    });
    await addAdminToDb(chatId, state.data.shopId, 'owner', userName);
    userToShop[chatId] = state.data.shopId;
    delete registrationState[chatId];
    const shop = await getShopFromDb(state.data.shopId);
    return bot.sendMessage(chatId, `🎉 Магазин создан!\n🔗 https://petalo.onrender.com/shop/${state.data.shopId}`, { reply_markup: getMainKeyboard(shop, chatId) });
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

    let cards = '';
    if (active.length === 0) {
      cards = '<div style="text-align:center;padding:50px;font-size:20px;color:#888;">🌿 По этому фильтру букетов нет.</div>';
    } else {
      for (const b of active) {
        const photoUrls = [];
        for (const fid of b.photos) { const u = await getPhotoUrl(fid); if (u) photoUrls.push(u); }
        let gallery = '';
        if (photoUrls.length === 0) gallery = `<div style="width:100%;aspect-ratio:1/1;background:#f0f0f0;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:40px;">📷</div>`;
        else if (photoUrls.length === 1) gallery = `<img src="${photoUrls[0]}" style="width:100%;border-radius:12px;aspect-ratio:1/1;object-fit:cover;">`;
        else {
          const slides = photoUrls.map(p => `<img src="${p}" style="height:220px;width:auto;border-radius:12px;flex-shrink:0;">`).join('');
          gallery = `<div style="display:flex;overflow-x:auto;gap:6px;margin-bottom:4px;">${slides}</div>`;
        }

        const oldPrice = calculateOldPrice(b.price, shop.settings.markupPercent);

        let buttonsHTML = '';
        if (shop.telegramUsername) {
          buttonsHTML += `<a href="/go/${shop.shopId}/${b.id}/tg" target="_blank" style="display:block;margin-top:10px;background:#229ED9;color:#fff;padding:12px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;">📩 Написать в Telegram</a>`;
        }
        if (shop.whatsappPhone) {
          buttonsHTML += `<a href="/go/${shop.shopId}/${b.id}/wa" target="_blank" style="display:block;margin-top:8px;background:#25D366;color:#fff;padding:12px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;">💬 Написать в WhatsApp</a>`;
        }
        if (shop.maxUsername) {
          buttonsHTML += `<a href="/go/${shop.shopId}/${b.id}/max" target="_blank" style="display:block;margin-top:8px;background:#7B68EE;color:#fff;padding:12px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;">🅼 Написать в MAX</a>`;
        }
        if (shop.phone) {
          buttonsHTML += `<a href="/go/${shop.shopId}/${b.id}/call" style="display:block;margin-top:8px;background:#3498db;color:#fff;padding:12px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;">📞 Позвонить</a>`;
        }

        cards += `<div style="border:1px solid #eee;border-radius:16px;padding:16px;margin:12px;max-width:300px;display:inline-block;vertical-align:top;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:center;position:relative;">
          <div style="position:absolute;top:24px;right:24px;background:rgba(44,62,80,0.85);color:#fff;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold;z-index:10;">№${b.id}</div>
          ${gallery}
          <h3 style="margin:12px 0 6px;">${esc(b.name)}</h3>
          <p style="font-size:22px;font-weight:bold;color:#2c3e50;margin:6px 0;">
            ${oldPrice > b.price ? `<span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:18px;">${oldPrice} ₽</span>&nbsp;` : ''}${b.price} ₽
          </p>
          ${buttonsHTML || '<div style="color:#888;padding:10px;">Контакты для связи временно недоступны</div>'}
        </div>`;
      }
    }

    const logoUrl = shop.settings.logo ? await getPhotoUrl(shop.settings.logo) : null;
    const bgUrl = shop.settings.background ? await getPhotoUrl(shop.settings.background) : null;
    const bodyStyle = bgUrl ? `background-image:url('${bgUrl}');background-size:cover;background-attachment:fixed;` : `background:#fafaf8;`;
    const headerHTML = logoUrl ? `<img src="${logoUrl}" style="max-height:90px;display:block;margin:0 auto 12px;">` : '';

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(shop.displayName)} — Petalo</title>
      <style>body{font-family:-apple-system,sans-serif;margin:0;padding:20px;text-align:center;${bodyStyle}} h1{color:#2c3e50;} .container{max-width:1200px;margin:0 auto;}</style></head>
      <body><div class="container">${headerHTML}<h1>${esc(shop.displayName)}</h1><div style="color:#555;font-size:14px;margin-bottom:10px;">${shop.address ? `📍 ${esc(shop.address)}` : ''} ${shop.hours ? `· 🕐 ${esc(shop.hours)}` : ''}</div>${filtersHTML}${cards}</div></body></html>`);
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
      maxUsername: PRESET_SHOP.maxUsername,
      inviteCode, trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(),
      settings: { logo: null, background: null, markupPercent: PRESET_SHOP.markupPercent, aiEnabled: false },
      stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
    });
    console.log(`✅ Preset-магазин ${PRESET_SHOP.shopId} создан`);
  } else {
    console.log(`✅ Preset-магазин ${PRESET_SHOP.shopId} найден`);
  }

  const WEBHOOK_URL = `https://petalo.onrender.com${WEBHOOK_PATH}`;
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
