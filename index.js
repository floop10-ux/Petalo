const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { S3Client } = require('@aws-sdk/client-s3');
const pool = require('./db');
require('dotenv').config();

const { 
  OWNER_CHAT_ID, SITE_URL, PRESET_SHOP,
  esc, getNowMoscow, isWithinWorkingHours,
  normalizePhone, generateInviteCode,
  isSubscriptionActive, getRemainingDays,
  shortName, isConfirmedRecently
} = require('./config');

const { 
  initDb, getShopFromDb, createShopInDb,
  updateShopField, getBouquetsFromDb,
  getShopFromDb: getShop
} = require('./db-actions');

const { setupStorefront } = require('./storefront');
const { setupBotHandlers } = require('./bot-handlers');
const { setupWarehouse } = require('./warehouse-ui');
const { initWarehouseDb } = require('./warehouse');

const app = express();
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN не задан в переменных окружения');
  process.exit(1);
}

// ========== S3 НАСТРОЙКИ ==========
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
}

const BC_BUCKET = process.env.S3_BACKUP_BUCKET;
const BC_ACCESS_KEY = process.env.S3_BACKUP_ACCESS_KEY;
const BC_SECRET_KEY = process.env.S3_BACKUP_SECRET_KEY;
const BC_ENDPOINT = process.env.S3_BACKUP_ENDPOINT;
const S3_BACKUP_ENABLED = !!(BC_BUCKET && BC_ACCESS_KEY && BC_SECRET_KEY && BC_ENDPOINT);

let s3backup = null;
if (S3_BACKUP_ENABLED) {
  s3backup = new S3Client({
    region: 'ru-1',
    endpoint: BC_ENDPOINT,
    credentials: {
      accessKeyId: BC_ACCESS_KEY,
      secretAccessKey: BC_SECRET_KEY
    },
    forcePathStyle: true
  });
}

const s3ctx = {
  s3, YC_BUCKET, S3_ENABLED,
  s3backup, BC_BUCKET, BC_ENDPOINT, S3_BACKUP_ENABLED
};

// ========== БОТ ==========
app.use(express.json({ limit: '20mb' }));
const bot = new TelegramBot(token);

const WEBHOOK_PATH = `/bot${token}`;
app.post(WEBHOOK_PATH, (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error('⚠️ Ошибка апдейта:', e?.message || e);
  }
  res.sendStatus(200);
});

// ========== АВТОРИЗАЦИЯ СКЛАДА ==========
const crypto = require('crypto');
const COOKIE_SECRET = process.env.WH_COOKIE_SECRET;
if (!COOKIE_SECRET) {
  console.error('❌ WH_COOKIE_SECRET не задан!');
  process.exit(1);
}

function signAuth(chatId, shopId) {
  const payload = chatId + '.' + shopId;
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET)
    .update(payload).digest('hex');
  return payload + '.' + hmac;
}

function verifyAuth(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  
  const chatId = parts[0];
  const shopId = parts[1];
  const signature = parts[2];
  const expected = crypto.createHmac('sha256', COOKIE_SECRET)
    .update(chatId + '.' + shopId).digest('hex');
    
  if (signature !== expected) return null;
  return { chatId: Number(chatId), shopId: shopId };
}

function getAuth(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/wh_auth=([^;]+)/);
  if (!match) return null;
  return verifyAuth(match[1]);
}

// ========== ФОНОВЫЕ ЗАДАЧИ ==========
const morningReminderSent = {};
const morningLaterSent = {};
const weeklyReportSent = {};
const { checkSessions } = require('./bot-handlers');

async function checkAndNotify() {
  try {
    const shops = await pool.query(
      'SELECT shop_id, hours FROM shops WHERE blocked = FALSE'
    );
    for (const s of shops.rows) {
      if (!isWithinWorkingHours(s.hours)) continue;
      const active = await getBouquetsFromDb(s.shop_id);
      for (const b of active) {
        if (b.isPinned || b.hidden || b.reminded || !b.confirmedAt) continue;
        const rem = 3 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(b.confirmedAt).getTime());
        
        if (rem > 0 && rem <= 12 * 60 * 60 * 1000) {
          let n = '⚠️ Букет №' + b.shopNumber + ' «';
          n += esc(b.name) + '» скоро скроется. Продлить?';
          bot.sendMessage(b.chatId, n, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '🌿 Продлить', callback_data: 'extend_' + b.id }]] }
          }).catch(function(){});
          await pool.query('UPDATE bouquets SET reminded = TRUE WHERE id = $1', [b.id]);
        }
      }
    }
  } catch (e) {
    console.error('Notify error:', e?.message || e);
  }
}

async function morningReminder() {
  try {
    const now = getNowMoscow();
    const todayKey = now.toISOString().slice(0, 10);
    const shops = await pool.query('SELECT shop_id, hours FROM shops WHERE blocked = FALSE');
    
    for (const s of shops.rows) {
      const sentKey = s.shop_id + ':' + todayKey;
      if (morningReminderSent[sentKey]) continue;

      const shop = await getShopFromDb(s.shop_id);
      if (!shop || !isSubscriptionActive(shop)) continue;

      const all = await getBouquetsFromDb(s.shop_id);
      const active = all.filter(isConfirmedRecently);
      if (active.length < 3) continue;

      const targets = shop.admins.filter(a => a.role === 'owner' || a.onShift);
      const unique = new Set();
      const text = '🌸 <b>Доброе утро!</b>\n\nМагазин открылся. Проверьте наличие?';
      const kb = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Проверить наличие', callback_data: 'check_start' }]
          ]
        }
      };
      
      for (const admin of targets) {
        if (unique.has(admin.chatId)) continue;
        unique.add(admin.chatId);
        bot.sendMessage(admin.chatId, text, kb).catch(function(){});
      }
      morningReminderSent[sentKey] = Date.now();
    }
  } catch (e) {
    console.error('Morning error:', e?.message || e);
  }
}

async function weeklyReport() {
  try {
    const now = getNowMoscow();
    if (now.getDay() !== 0 || now.getHours() !== 19) return;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const shops = await pool.query('SELECT shop_id FROM shops WHERE blocked = FALSE');
    
    for (const s of shops.rows) {
      const shop = await getShopFromDb(s.shop_id);
      if (!shop || !isSubscriptionActive(shop)) continue;

      const lastSent = weeklyReportSent[s.shop_id];
      if (lastSent && (Date.now() - lastSent) < 6 * 24 * 60 * 60 * 1000) continue;

      const activeNow = (await getBouquetsFromDb(s.shop_id)).filter(isConfirmedRecently).length;

      let txt = '📊 <b>Итоги недели «' + esc(shop.displayName) + '»</b>\n\n';
      txt += '🟢 Сейчас на витрине: <b>' + activeNow + '</b>\n';
      txt += '🌿 Продолжайте — витрина работает!\n';
      txt += SITE_URL + '/shop/' + s.shop_id;

      const targets = shop.admins.filter(a => a.role === 'owner' || a.onShift);
      const unique = new Set();
      for (const admin of targets) {
        if (unique.has(admin.chatId)) continue;
        unique.add(admin.chatId);
        bot.sendMessage(admin.chatId, txt, { parse_mode: 'HTML' }).catch(function(){});
      }
      weeklyReportSent[s.shop_id] = Date.now();
    }
  } catch (e) {
    console.error('Weekly report error:', e?.message || e);
  }
}

// ========== ЗАПУСК ==========
async function start() {
  try {
    await initDb();
    await initWarehouseDb();

    // Подключаем Склад (Express)
    setupWarehouse(app, bot, s3ctx);

    // Подключаем Витрину (Express)
    setupStorefront(app, bot, s3ctx);

    // Подключаем Обработчики Бота (Telegram)
    setupBotHandlers(bot, OWNER_CHAT_ID, s3ctx);

    // Проверка Preset-магазина (Kupidon)
    const existing = await getShopFromDb(PRESET_SHOP.shopId);
    if (!existing) {
      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
      const inviteCode = generateInviteCode();
      
      await createShopInDb({
        shopId: PRESET_SHOP.shopId,
        name: PRESET_SHOP.shopId,
        displayName: PRESET_SHOP.displayName,
        address: PRESET_SHOP.address,
        hours: PRESET_SHOP.hours,
        phone: normalizePhone(PRESET_SHOP.phone),
        telegramUsername: PRESET_SHOP.telegramUsername,
        whatsappPhone: normalizePhone(PRESET_SHOP.whatsappPhone),
        maxLink: PRESET_SHOP.maxLink,
        inviteCode,
        trialStart: now.toISOString(),
        trialEnd: trialEnd.toISOString(),
        country: 'RU',
        settings: {
          logo: null, cover: null,
          background: { type: 'preset', id: 1 },
          buttonColor: 'red',
          currency: 'RUB',
          markupPercent: PRESET_SHOP.markupPercent,
          aiEnabled: false
        },
        stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
      });
      console.log('✅ Preset-магазин ' + PRESET_SHOP.shopId + ' создан');
    } else {
      console.log('✅ Preset-магазин ' + PRESET_SHOP.shopId + ' найден');
      if (!existing.maxLink) {
        await updateShopField(PRESET_SHOP.shopId, 'max_username', PRESET_SHOP.maxLink);
      }
    }

    // Установка Webhook и команд
    try {
      await bot.setMyCommands([
        { command: 'start', description: 'Открыть меню' },
        { command: 'help', description: 'Помощь' },
        { command: 'cancel', description: 'Отменить действие' }
      ]);
      
      const WEBHOOK_URL = SITE_URL + WEBHOOK_PATH;
      await bot.deleteWebHook();
      await bot.setWebHook(WEBHOOK_URL);
      console.log('✅ Webhook установлен:', WEBHOOK_URL);
    } catch (e) {
      console.error('❌ Ошибка Webhook:', e?.message || e);
    }

    // Интервалы (Cron)
    setInterval(checkAndNotify, 10 * 60 * 1000);
    setInterval(morningReminder, 5 * 60 * 1000);
    setInterval(weeklyReport, 30 * 60 * 1000);
    setInterval(function() {
      const now = Date.now();
      for (const chatId of Object.keys(checkSessions)) {
        const s = checkSessions[chatId];
        if (!s || !s.lastActivity || now - s.lastActivity > 60 * 60 * 1000) {
          delete checkSessions[chatId];
        }
      }
    }, 5 * 60 * 1000);

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log('🚀 Flowind на порту ' + PORT);
    });
    
  } catch (err) {
    console.error('❌ Ошибка запуска:', err.message);
    process.exit(1);
  }
}

start();