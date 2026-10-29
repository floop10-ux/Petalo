const crypto = require('crypto');

const { setupWarehouseViews } = require('./warehouse-views');
const { setupWarehouseAdminViews } = require('./warehouse-views-admin');
const { setupWarehouseApi } = require('./warehouse-api');

// ====== БЕЗОПАСНОСТЬ ======
const authAttempts = {};
const pinAttempts = {};
const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_TRIES = 10;
const PIN_MAX_TRIES = 5;
const PIN_BLOCK_TIME = 15 * 60 * 1000;

function checkAuthLimit(ip) {
  const now = Date.now();
  const e = authAttempts[ip];
  if (!e || now - e.ts > AUTH_WINDOW_MS) {
    authAttempts[ip] = { count: 1, ts: now };
    return true;
  }
  if (e.count >= AUTH_MAX_TRIES) return false;
  e.count++;
  return true;
}

function checkPinLimit(chatId) {
  const now = Date.now();
  const e = pinAttempts[chatId];
  if (!e) {
    pinAttempts[chatId] = { count: 1, ts: now };
    return true;
  }
  if (e.count >= PIN_MAX_TRIES) {
    if (now - e.ts < PIN_BLOCK_TIME) return false;
    pinAttempts[chatId] = { count: 1, ts: now };
    return true;
  }
  e.count++;
  return true;
}

setInterval(function() {
  const now = Date.now();
  for (const ip of Object.keys(authAttempts)) {
    if (now - authAttempts[ip].ts > AUTH_WINDOW_MS * 2) {
      delete authAttempts[ip];
    }
  }
  for (const id of Object.keys(pinAttempts)) {
    if (now - pinAttempts[id].ts > PIN_BLOCK_TIME * 2) {
      delete pinAttempts[id];
    }
  }
}, 5 * 60 * 1000);

// ====== ГЛАВНАЯ ФУНКЦИЯ ======
function setupWarehouse(app, bot, s3ctx) {
  // 1. Подключаем API (базу данных)
  setupWarehouseApi(app, bot, s3ctx, getAuth);

  // 2. Получаем общие компоненты для визуала
  const views = require('./warehouse-views');
  
  // 3. Подключаем основные экраны
  views.setupWarehouseViews(
    app, bot, s3ctx, getAuth,
    views.fmtNum, views.translateReason, views.esc,
    views.getUnifiedMenu, views.metaSafari, 
    views.fontLink, views.uiScript
  );

  // 4. Подключаем экраны админки
  setupWarehouseAdminViews(
    app, bot, s3ctx, getAuth,
    views.fmtNum, views.translateReason, views.esc,
    views.getUnifiedMenu, views.metaSafari, 
    views.fontLink, views.uiScript
  );

  // ====== АВТОРИЗАЦИЯ (HMAC) ======
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

  // ====== CSRF ЗАЩИТА ======
  app.use('/api/warehouse', function(req, res, next) {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const referer = req.headers.referer;
      let allowed = false;
      
      if (origin && origin.includes('flowind.ru')) allowed = true;
      if (referer && referer.includes('flowind.ru')) allowed = true;
      if (!origin && !referer) allowed = true;
      
      if (!allowed) {
        return res.status(403).json({ ok: false, error: 'CSRF detected' });
      }
    }
    next();
  });
}

module.exports = { setupWarehouse };