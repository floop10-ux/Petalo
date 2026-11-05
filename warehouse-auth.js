const pool = require('./db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Защита от перебора в памяти с авто-очисткой
const authAttempts = new Map();
const pinAttempts = new Map();

function checkAuthLimit(ip) {
  const now = Date.now();
  const e = authAttempts.get(ip);
  if (!e || now - e.ts > 60000) {
    authAttempts.set(ip, { count: 1, ts: now });
    return true;
  }
  if (e.count >= 10) return false;
  e.count++;
  return true;
}

function checkPinLimit(ip) {
  const now = Date.now();
  const e = pinAttempts.get(ip);
  if (!e || now - e.ts > 15 * 60000) {
    pinAttempts.set(ip, { count: 1, ts: now });
    return true;
  }
  if (e.count >= 5) return false;
  e.count++;
  return true;
}

// Очистка памяти раз в 5 минут
setInterval(function() {
  const now = Date.now();
  authAttempts.forEach(function(v, k) {
    if (now - v.ts > 120000) authAttempts.delete(k);
  });
  pinAttempts.forEach(function(v, k) {
    if (now - v.ts > 30 * 60000) pinAttempts.delete(k);
  });
}, 5 * 60 * 1000).unref();

function setupWarehouseAuth(app, bot, s3ctx, getAuth) {
  function getAuthCookie(chatId, shopId) {
    const secret = process.env.WH_COOKIE_SECRET;
    if (!secret) throw new Error('WH_COOKIE_SECRET не задан');
    
    const payload = chatId + '.' + shopId;
    const hmac = crypto.createHmac('sha256', secret)
      .update(payload).digest('hex');
    return payload + '.' + hmac;
  }

  // НОВЫЙ ВХОД: ID магазина + PIN
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const ip = req.ip || 'unknown';
      if (!checkAuthLimit(ip) || !checkPinLimit(ip)) {
        return res.json({ ok: false, rate_limited: true });
      }

      const pin = String(req.body.pin || '');
      const shopId = String(req.body.shopId || '').trim();

      if (!pin || !shopId) {
        return res.json({ ok: false, error: 'Нужен PIN и ID' });
      }

      // Ищем ТОЛЬКО внутри конкретного магазина (фикс P0)
      const r = await pool.query(
        "SELECT chat_id, shop_id, role, warehouse_pin_hash " +
        "FROM admins WHERE shop_id = $1 " +
        "AND warehouse_pin_hash IS NOT NULL",
        [shopId]
      );

      let matchedAdmin = null;
      // Перебор идет только по сотрудникам ОДНОГО магазина (обычно 1-5 чел)
      for (const row of r.rows) {
        if (row.warehouse_pin_hash) {
          const isMatch = await bcrypt.compare(
            pin, row.warehouse_pin_hash
          );
          if (isMatch) {
            matchedAdmin = row;
            break;
          }
        }
      }

      if (!matchedAdmin) return res.json({ ok: false });
      
      const allShopsRes = await pool.query(
        "SELECT a.shop_id, s.display_name, a.role " +
        "FROM admins a " +
        "JOIN shops s ON s.shop_id = a.shop_id " +
        "WHERE a.chat_id = $1",
        [matchedAdmin.chat_id]
      );

      const shops = allShopsRes.rows;

      if (shops.length > 1) {
        return res.json({ 
          ok: true, 
          multi: true, 
          shops: shops,
          chatId: matchedAdmin.chat_id
        });
      }

      const chatId = matchedAdmin.chat_id;
      const finalShopId = matchedAdmin.shop_id;
      const token = getAuthCookie(chatId, finalShopId);
      
      res.cookie('wh_auth', token, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true, 
        secure: true, 
        sameSite: 'lax' 
      });
      
      res.json({ ok: true, role: matchedAdmin.role });
    } catch (e) { 
      console.error('Auth error:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  // Вход владельца по логину и паролю
  app.post('/api/warehouse/auth-owner', async (req, res) => {
    try {
      const ip = req.ip || 'unknown';
      if (!checkAuthLimit(ip)) {
        return res.json({ ok: false, rate_limited: true });
      }

      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      
      if (!login || !password) return res.json({ ok: false });

      const r = await pool.query(
        "SELECT chat_id, role, shop_id, password_hash FROM admins " +
        "WHERE login = $1", [login]
      );

      if (r.rows.length === 0) return res.json({ ok: false });
      
      let valid = false;
      const dbHash = r.rows[0].password_hash;
      
      if (dbHash && dbHash.length === 64) {
        const sha = crypto.createHash('sha256')
          .update(password).digest('hex');
        valid = (sha === dbHash);
      } else if (dbHash) {
        valid = await bcrypt.compare(password, dbHash);
      }

      if (!valid) return res.json({ ok: false });
      
      const chatId = r.rows[0].chat_id;
      const shopId = r.rows[0].shop_id;
      const token = getAuthCookie(chatId, shopId);
      
      res.cookie('wh_auth', token, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true, 
        secure: true, 
        sameSite: 'lax' 
      });
      
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { 
      console.error('Auth-owner error:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  // Смена магазина и список магазинов
  app.get('/api/warehouse/my-shops', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const r = await pool.query(
        "SELECT a.shop_id, s.display_name, a.role " +
        "FROM admins a " +
        "JOIN shops s ON s.shop_id = a.shop_id " +
        "WHERE a.chat_id = $1",
        [auth.chatId]
      );
      
      res.json({ ok: true, shops: r.rows, active: auth.shopId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/switch-shop', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const newShopId = req.body.shopId;
      
      const check = await pool.query(
        "SELECT role FROM admins " +
        "WHERE chat_id = $1 AND shop_id = $2",
        [auth.chatId, newShopId]
      );
      
      if (check.rows.length === 0) {
        return res.status(403).json({ ok: false, error: 'Нет доступа' });
      }
      
      const token = getAuthCookie(auth.chatId, newShopId);
      res.cookie('wh_auth', token, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true, 
        secure: true, 
        sameSite: 'lax' 
      });
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Создание нового магазина (доступно только владельцу)
  app.post('/api/warehouse/shop/create', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const ownerCheck = await pool.query(
        "SELECT role FROM admins WHERE chat_id = $1 " +
        "AND role = 'owner' LIMIT 1",
        [auth.chatId]
      );
      
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ ok: false });
      }

      const name = String(req.body.name || '').trim();
      if (!name) return res.json({ ok: false, error: 'Нужно имя' });

      const shopId = 'shop_' + Math.random().toString(36)
        .slice(2, 8);
      const inviteCode = Math.random().toString(36)
        .slice(2, 8).toUpperCase();
      
      const trialEnd = new Date();
      trialEnd.setMonth(trialEnd.getMonth() + 1);

      await pool.query(
        "INSERT INTO shops (shop_id, name, display_name, " +
        "invite_code, trial_start, trial_end, settings) " +
        "VALUES ($1, $2, $2, $3, NOW(), $4, '{}'::jsonb)",
        [shopId, name, inviteCode, trialEnd.toISOString()]
      );

      await pool.query(
        "INSERT INTO admins (chat_id, shop_id, role, name) " +
        "VALUES ($1, $2, 'owner', 'Владелец')",
        [auth.chatId, shopId]
      );

      res.json({ ok: true, shopId: shopId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { setupWarehouseAuth };