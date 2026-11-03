const crypto = require('crypto');

const { setupWarehouseViews } = require('./warehouse-views');
const { setupWarehouseAdminViews } = require('./warehouse-views-admin');
const { setupWarehouseApi } = require('./warehouse-api');

const COOKIE_SECRET = process.env.WH_COOKIE_SECRET;

if (!COOKIE_SECRET) {
  console.error('❌ WH_COOKIE_SECRET не задан!');
  process.exit(1);
}

function isAllowedOrigin(str) {
  if (!str) return false;
  try {
    var u = new URL(str);
    return u.hostname === 'flowind.ru' ||
           u.hostname === 'www.flowind.ru' ||
           u.hostname === 'localhost' ||
           u.hostname === '127.0.0.1';
  } catch (e) {
    return false;
  }
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
  
  const chatIdStr = parts[0];
  const shopId = parts[1];
  const signature = parts[2];

  const cid = Number(chatIdStr);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  if (!/^[a-z0-9_-]{2,50}$/i.test(shopId)) return null;

  const expected = crypto.createHmac('sha256', COOKIE_SECRET)
    .update(chatIdStr + '.' + shopId).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  
  return { chatId: cid, shopId: shopId };
}

function getAuth(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/wh_auth=([^;]+)/);
  if (!match) return null;
  return verifyAuth(match[1]);
}

function setupWarehouse(app, bot, s3ctx) {
  // 1. CSRF ЗАЩИТА (ставим СТРОГО ПЕРЕД роутами)
  app.use('/api/warehouse', function(req, res, next) {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const referer = req.headers.referer;
      let allowed = false;
      
      if (isAllowedOrigin(origin) || isAllowedOrigin(referer)) {
        allowed = true;
      }
      
      if (!allowed) {
        return res.status(403).json({ 
          ok: false, error: 'CSRF detected' 
        });
      }
    }
    next();
  });

  // 2. Подключаем API (базу данных)
  setupWarehouseApi(app, bot, s3ctx, getAuth);

  // 3. Получаем общие компоненты для визуала
  const views = require('./warehouse-views');
  
  // 4. Подключаем основные экраны (4 аргумента)
  views.setupWarehouseViews(app, bot, s3ctx, getAuth);

  // 5. Подключаем экраны админки (4 аргумента)
  setupWarehouseAdminViews(app, bot, s3ctx, getAuth);
}

module.exports = { setupWarehouse, getAuth };