// 1. Сначала загружаем переменные окружения
require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { S3Client } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const token = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const COOKIE_SECRET = process.env.WH_COOKIE_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!token) {
  console.error('❌ BOT_TOKEN не задан');
  process.exit(1);
}
if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'flowind_secret_2024') {
  console.error('❌ WEBHOOK_SECRET не задан или дефолтный');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
  console.error('❌ WEBHOOK_SECRET неверного формата');
  process.exit(1);
}
if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) {
  console.error('❌ WH_COOKIE_SECRET слишком короткий');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL не задан');
  process.exit(1);
}

const pool = require('./db');

const { 
  OWNER_CHAT_ID, SITE_URL, PRESET_SHOP,
  esc, getNowMoscow, isWithinWorkingHours,
  normalizePhone, generateInviteCode,
  isSubscriptionActive, getRemainingDays,
  shortName, isConfirmedRecently, parseShopHours
} = require('./config');

if (!SITE_URL || !SITE_URL.startsWith('https://')) {
  console.error('❌ SITE_URL не задан или не HTTPS');
  process.exit(1);
}
const SITE_URL_CLEAN = SITE_URL.replace(/\/+$/, '');

const { 
  initDb, getShopFromDb, createShopInDb,
  updateShopField, getBouquetsFromDb
} = require('./db-actions');

const { setupStorefront } = require('./storefront');
const { setupBotHandlers } = require('./bot-handlers');
const { setupWarehouse } = require('./warehouse-ui');
const { initWarehouseDb } = require('./warehouse');

const app = express();
app.set('trust proxy', 1);

// ========== S3 НАСТРОЙКИ ==========
const YC_BUCKET = process.env.YC_BUCKET_NAME;
const YC_ACCESS_KEY_ID = process.env.YC_ACCESS_KEY_ID;
const YC_SECRET_ACCESS_KEY = process.env.YC_SECRET_ACCESS_KEY;

let s3 = null;
const s3Vars = [YC_BUCKET, YC_ACCESS_KEY_ID, YC_SECRET_ACCESS_KEY];
const s3Set = s3Vars.filter(Boolean).length;
if (s3Set > 0 && s3Set < 3) {
  console.error('❌ Неполная конфигурация основного S3');
  process.exit(1);
}
if (s3Set === 3) {
  s3 = new S3Client({
    region: 'ru-central1',
    endpoint: 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId: YC_ACCESS_KEY_ID,
      secretAccessKey: YC_SECRET_ACCESS_KEY
    }
  });
}
const S3_ENABLED = !!s3;

const BC_BUCKET = process.env.S3_BACKUP_BUCKET;
const BC_ACCESS_KEY = process.env.S3_BACKUP_ACCESS_KEY;
const BC_SECRET_KEY = process.env.S3_BACKUP_SECRET_KEY;
const BC_ENDPOINT = process.env.S3_BACKUP_ENDPOINT;

let s3backup = null;
const bcVars = [BC_BUCKET, BC_ACCESS_KEY, BC_SECRET_KEY, BC_ENDPOINT];
const bcSet = bcVars.filter(Boolean).length;
if (bcSet > 0 && bcSet < 4) {
  console.error('❌ Неполная конфигурация резервного S3');
  process.exit(1);
}
if (bcSet === 4) {
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
const S3_BACKUP_ENABLED = !!s3backup;

const s3ctx = {
  s3, YC_BUCKET, S3_ENABLED,
  s3backup, BC_BUCKET, BC_ENDPOINT, S3_BACKUP_ENABLED
};

// ========== БОТ И WEBHOOK ==========
const bot = new TelegramBot(token);

app.use('/wh', function(req, res, next) {
  const sec = req.headers['x-telegram-bot-api-secret-token'];
  if (sec !== WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }
  next();
});

const whParser = express.json({ limit: '512kb' });

app.post('/wh', whParser, function(req, res) {
  if (!req.body || typeof req.body !== 'object' || 
      !Number.isSafeInteger(req.body.update_id)) {
    return res.sendStatus(400);
  }
  
  try {
    const result = bot.processUpdate(req.body);
    if (result && typeof result.catch === 'function') {
      result.catch(function(e) {
        console.error('Update error:', e && e.message ? e.message : e);
      });
    }
  } catch (err) {
    console.error('Update error (sync):', 
      err && err.message ? err.message : err);
  }
  
  res.sendStatus(200);
});

app.use(express.json({ limit: '2mb' }));

// ========== АВТОРИЗАЦИЯ СКЛАДА ==========
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
  
  const chatIdStr = parts[0];
  const shopId = parts[1];
  const signature = parts[2];
  const expected = crypto.createHmac('sha256', COOKIE_SECRET)
    .update(chatIdStr + '.' + shopId).digest('hex');
    
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  
  const cid = Number(chatIdStr);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  if (!/^[a-z0-9_-]{2,50}$/i.test(shopId)) return null;
  
  return { chatId: cid, shopId: shopId };
}

function getAuth(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/wh_auth=([^;]+)/);
  if (!match) return null;
  return verifyAuth(match[1]);
}
// ========== ФОНОВЫЕ ЗАДАЧИ ==========
const taskFlags = {};
const runningTasks = new Set();
const timers = [];
const { checkSessions } = require('./bot-handlers');

async function runSafeTask(name, taskFn) {
  if (taskFlags[name]) return;
  taskFlags[name] = true;
  
  const p = (async function() {
    try {
      await taskFn();
    } catch (e) {
      console.error(
        'Task error [' + name + ']:', 
        e && e.message ? e.message : e
      );
    } finally {
      taskFlags[name] = false;
      runningTasks.delete(p);
    }
  })();
  
  runningTasks.add(p);
  return p;
}

function getShopAdmins(shop) {
  if (!shop || !Array.isArray(shop.admins)) return [];
  return shop.admins.filter(function(a) {
    return a && a.chatId && 
      (a.role === 'owner' || a.onShift);
  });
}

// P2-1: Единый фильтр для подсчета активных букетов
function isActiveForCounting(b) {
  if (!b) return false;
  if (b.deleted === true || b.hidden === true || 
      b.archived === true) {
    return false;
  }
  return isConfirmedRecently(b);
}

async function checkAndNotify() {
  try {
    const shops = await pool.query(
      'SELECT shop_id FROM shops WHERE blocked = FALSE'
    );
    for (const s of shops.rows) {
      try {
        const shop = await getShopFromDb(s.shop_id);
        if (!shop) continue;
        
        const targets = getShopAdmins(shop);
        if (!targets.length) continue;
        
        const active = await getBouquetsFromDb(s.shop_id);
        
        for (const b of active) {
          if (b.isPinned || b.hidden || b.reminded) continue;
          if (b.deleted || b.archived) continue;
          if (!b.confirmedAt) continue;
          
          const t = new Date(b.confirmedAt).getTime();
          if (!Number.isFinite(t)) continue;
          
          const rem = 3 * 24 * 60 * 60 * 1000 - 
            (Date.now() - t);
          
          if (rem > 0 && rem <= 12 * 60 * 60 * 1000) {
            let n = '⚠️ Букет №' + b.shopNumber + ' «';
            n += esc(b.name) + '» скоро скроется. Продлить?';
            
            const unique = new Set();
            let sentCount = 0;
            let failCount = 0;
            
            for (const admin of targets) {
              if (unique.has(admin.chatId)) continue;
              unique.add(admin.chatId);
              try {
                await bot.sendMessage(admin.chatId, n, {
                  parse_mode: 'HTML',
                  reply_markup: { 
                    inline_keyboard: [[
                      { text: '🌿 Продлить', 
                        callback_data: 'extend_' + b.id }
                    ]]
                  }
                });
                sentCount++;
              } catch (tgErr) {
                failCount++;
                console.error('TG notify error:', 
                  tgErr && tgErr.message 
                    ? tgErr.message : tgErr);
              }
            }
            
            // P1-1: ставим флаг только если ВСЕ получили
            if (sentCount > 0 && failCount === 0) {
              await pool.query(
                'UPDATE bouquets SET reminded = TRUE ' +
                'WHERE id = $1', [b.id]
              );
            }
          }
        }
      } catch (shopErr) {
        console.error(
          'Notify error shop ' + s.shop_id + ':', 
          shopErr && shopErr.message 
            ? shopErr.message : shopErr
        );
      }
    }
  } catch (e) {
    console.error('Notify global:', 
      e && e.message ? e.message : e);
  }
}

async function morningReminder() {
  try {
    const now = getNowMoscow();
    const todayKey = now.toISOString().slice(0, 10);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const shops = await pool.query(
      'SELECT shop_id, hours, settings ' +
      'FROM shops WHERE blocked = FALSE'
    );
    
    for (const s of shops.rows) {
      try {
        const settings = s.settings || {};
        if (settings.last_reminder_date === todayKey) continue;

        const parsed = parseShopHours(s.hours);
        let targetMinutes = 10 * 60; 
        
        if (parsed) {
          targetMinutes = (parsed.openH * 60 + parsed.openM) + 30;
        }
        
        if (currentMinutes < targetMinutes) continue;
        if (currentMinutes > targetMinutes + 120) continue;

        const shop = await getShopFromDb(s.shop_id);
        if (!shop || !isSubscriptionActive(shop)) continue;

        const all = await getBouquetsFromDb(s.shop_id);
        const active = all.filter(isActiveForCounting);
        if (active.length < 3) continue;

        const targets = getShopAdmins(shop);
        if (!targets.length) continue;
        
        const unique = new Set();
        const text = '🌸 <b>Доброе утро!</b>\n\n' +
          'Магазин открылся. Проверьте наличие?';
        const kb = {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Проверить наличие', 
                callback_data: 'check_start' }
            ]]
          }
        };
        
        let sentCount = 0;
        let failCount = 0;
        
        for (const admin of targets) {
          if (unique.has(admin.chatId)) continue;
          unique.add(admin.chatId);
          try {
            await bot.sendMessage(admin.chatId, text, kb);
            sentCount++;
          } catch (tgErr) {
            failCount++;
            console.error('Morning TG error:', 
              tgErr && tgErr.message 
                ? tgErr.message : tgErr);
          }
        }
        
        if (sentCount > 0 && failCount === 0) {
          // P2-2: COALESCE на случай NULL в settings
          await pool.query(
            "UPDATE shops SET settings = jsonb_set(" +
            "COALESCE(settings, '{}'::jsonb), " +
            "'{last_reminder_date}', to_jsonb($1::text)) " +
            "WHERE shop_id = $2",
            [todayKey, s.shop_id]
          );
        }
      } catch (shopErr) {
        console.error(
          'Morning error shop ' + s.shop_id + ':', 
          shopErr && shopErr.message 
            ? shopErr.message : shopErr
        );
      }
    }
  } catch (e) {
    console.error('Morning global:', 
      e && e.message ? e.message : e);
  }
}

async function weeklyReport() {
  try {
    const now = getNowMoscow();
    if (now.getDay() !== 0 || now.getHours() < 19) return;

    const shops = await pool.query(
      'SELECT shop_id, settings ' +
      'FROM shops WHERE blocked = FALSE'
    );
    
    for (const s of shops.rows) {
      try {
        const shop = await getShopFromDb(s.shop_id);
        if (!shop || !isSubscriptionActive(shop)) continue;

        const settings = s.settings || {};
        const lastWeek = Number(settings.last_weekly_report) || 0;
        
        if (Date.now() - lastWeek < 6 * 24 * 60 * 60 * 1000) {
          continue;
        }

        const all = await getBouquetsFromDb(s.shop_id);
        const activeNow = all.filter(isActiveForCounting).length;

        let txt = '📊 <b>Итоги недели «' +
          esc(shop.displayName) + '»</b>\n\n';
        txt += '🟢 Сейчас на витрине: <b>' + activeNow + '</b>\n';
        txt += '🌿 Продолжайте — витрина работает!\n';
        txt += SITE_URL_CLEAN + '/shop/' + s.shop_id;

        const targets = getShopAdmins(shop);
        if (!targets.length) continue;
        
        const unique = new Set();
        let sentCount = 0;
        let failCount = 0;
        
        for (const admin of targets) {
          if (unique.has(admin.chatId)) continue;
          unique.add(admin.chatId);
          try {
            await bot.sendMessage(admin.chatId, txt, { 
              parse_mode: 'HTML' 
            });
            sentCount++;
          } catch (tgErr) {
            failCount++;
            console.error('Weekly TG error:', 
              tgErr && tgErr.message 
                ? tgErr.message : tgErr);
          }
        }
        
        if (sentCount > 0 && failCount === 0) {
          const nowMs = Date.now();
          // P2-2: COALESCE на случай NULL в settings
          await pool.query(
            "UPDATE shops SET settings = jsonb_set(" +
            "COALESCE(settings, '{}'::jsonb), " +
            "'{last_weekly_report}', to_jsonb($1::bigint)) " +
            "WHERE shop_id = $2",
            [nowMs, s.shop_id]
          );
        }
      } catch (shopErr) {
        console.error(
          'Weekly error shop ' + s.shop_id + ':', 
          shopErr && shopErr.message 
            ? shopErr.message : shopErr
        );
      }
    }
  } catch (e) {
    console.error('Weekly global:', 
      e && e.message ? e.message : e);
  }
}

function cleanSessions() {
  const now = Date.now();
  if (!checkSessions || typeof checkSessions !== 'object') {
    return;
  }
  for (const chatId of Object.keys(checkSessions)) {
    const s = checkSessions[chatId];
    if (!s || !s.lastActivity || 
        now - s.lastActivity > 60 * 60 * 1000) {
      delete checkSessions[chatId];
    }
  }
}

// ========== ЗАПУСК И GRACEFUL SHUTDOWN ==========
let server = null;
let isShuttingDown = false;

async function start() {
  try {
    await initDb();
    await initWarehouseDb();

    setupWarehouse(app, bot, s3ctx);
    setupStorefront(app, bot, s3ctx);
    setupBotHandlers(bot, s3ctx);

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
        stats: { views: 0, orders: 0, calls: 0, 
          startedAt: now.toISOString() }
      });
      console.log('✅ Preset-магазин ' + PRESET_SHOP.shopId + ' создан');
    } else {
      console.log('✅ Preset-магазин найден');
      if (!existing.maxLink) {
        await updateShopField(PRESET_SHOP.shopId, 'max_username', 
          PRESET_SHOP.maxLink);
      }
    }

    const PORT = process.env.PORT || 3000;
    server = app.listen(PORT, function() {
      console.log('🚀 Flowind на порту ' + PORT);
    });

    server.on('error', function(e) {
      console.error('❌ Ошибка сервера:', e.message);
      shutdown('serverError', 1).catch(function() {
        process.exit(1);
      });
    });

    try {
      await bot.setMyCommands([
        { command: 'start', description: 'Открыть меню' },
        { command: 'help', description: 'Помощь' },
        { command: 'cancel', description: 'Отменить действие' }
      ]);
    } catch (e) {
      console.error('⚠️ Ошибка команд:', 
        e && e.message ? e.message : e);
    }

    try {
      // P2-6: используем нормализованный URL
      const WEBHOOK_URL = SITE_URL_CLEAN + '/wh';
      await bot.setWebHook(WEBHOOK_URL, { 
        secret_token: WEBHOOK_SECRET 
      });
      console.log('✅ Webhook установлен');
    } catch (e) {
      console.error('❌ КРИТИЧЕСКАЯ Webhook:', 
        e && e.message ? e.message : e);
      await shutdown('webhookError', 1);
      return;
    }

    // Немедленный запуск задач (для пробуждения Render)
    runSafeTask('checkAndNotify', checkAndNotify);
    runSafeTask('morningReminder', morningReminder);
    runSafeTask('weeklyReport', weeklyReport);

    timers.push(setInterval(function() {
      runSafeTask('checkAndNotify', checkAndNotify);
    }, 10 * 60 * 1000));

    timers.push(setInterval(function() {
      runSafeTask('morningReminder', morningReminder);
    }, 5 * 60 * 1000));

    timers.push(setInterval(function() {
      runSafeTask('weeklyReport', weeklyReport);
    }, 30 * 60 * 1000));

    timers.push(setInterval(cleanSessions, 5 * 60 * 1000));

  } catch (err) {
    console.error('❌ Ошибка запуска:', 
      err && err.message ? err.message : err);
    await shutdown('startError', 1);
  }
}

async function shutdown(signal, exitCode) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  const code = (typeof exitCode === 'number') ? exitCode : 0;
  console.log('🛑 ' + signal + ': Остановка (код ' + code + ')...');
  
  for (const t of timers) clearInterval(t);
  
  if (server) {
    await new Promise(function(resolve) {
      let done = false;
      const timer = setTimeout(function() {
        if (done) return;
        done = true;
        console.warn('⚠️ Таймаут закрытия сервера');
        if (server.closeAllConnections) {
          server.closeAllConnections();
        }
        resolve();
      }, 5000);
      
      server.close(function() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.log('✅ HTTP сервер закрыт');
        resolve();
      });
    });
  }
  
  if (runningTasks.size > 0) {
    console.log('⏳ Ждем задач: ' + runningTasks.size);
    await Promise.race([
      Promise.all(Array.from(runningTasks)),
      new Promise(function(r) { setTimeout(r, 5000); })
    ]);
    // P2-4: явное предупреждение при таймауте
    if (runningTasks.size > 0) {
      console.warn(
        '⚠️ Таймаут ожидания задач, осталось: ' + 
        runningTasks.size
      );
    } else {
      console.log('✅ Все задачи завершены');
    }
  }
  
  try {
    await pool.end();
    console.log('✅ Пул БД закрыт');
  } catch (e) {
    console.error('Ошибка БД:', e.message);
  }
  
  if (s3) { try { s3.destroy(); } catch (e) {} }
  if (s3backup) { try { s3backup.destroy(); } catch (e) {} }
  console.log('✅ S3 уничтожены');
  
  process.exit(code);
}

process.on('SIGTERM', function() { shutdown('SIGTERM', 0); });
process.on('SIGINT', function() { shutdown('SIGINT', 0); });
process.on('unhandledRejection', function(reason) {
  console.error('🚨 unhandledRejection:', reason);
  shutdown('unhandledRejection', 1).catch(function() {
    process.exit(1);
  });
});

start();