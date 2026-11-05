const pool = require('./db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const authAttempts = new Map();
const pinAttempts = new Map();

const MAX_MAP_SIZE = 4500;

function cleanupMap(map, windowMs) {
  const now = Date.now();
  map.forEach(function(v, k) {
    if (now - v.ts > windowMs) map.delete(k);
  });
}

function checkAuthLimit(ip) {
  const now = Date.now();
  const windowMs = 60000;
  
  if (authAttempts.size > MAX_MAP_SIZE) {
    cleanupMap(authAttempts, windowMs);
  }
  
  const e = authAttempts.get(ip);
  if (!e) {
    if (authAttempts.size >= 5000) return false;
    authAttempts.set(ip, { count: 1, ts: now });
    return true;
  }
  if (now - e.ts > windowMs) {
    e.count = 1;
    e.ts = now;
    return true;
  }
  if (e.count >= 10) return false;
  e.count++;
  return true;
}

function checkPinLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60000;
  
  if (pinAttempts.size > MAX_MAP_SIZE) {
    cleanupMap(pinAttempts, windowMs);
  }
  
  const e = pinAttempts.get(ip);
  if (!e) {
    if (pinAttempts.size >= 5000) return false;
    pinAttempts.set(ip, { count: 1, ts: now });
    return true;
  }
  if (now - e.ts > windowMs) {
    e.count = 1;
    e.ts = now;
    return true;
  }
  if (e.count >= 5) return false;
  e.count++;
  return true;
}

setInterval(function() {
  cleanupMap(authAttempts, 120000);
  cleanupMap(pinAttempts, 30 * 60000);
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

  const cookieOpts = { 
    maxAge: 30 * 24 * 60 * 60 * 1000, 
    httpOnly: true, 
    secure: true, 
    sameSite: 'lax' 
  };

  app.post('/api/warehouse/auth', async function(req, res) {
    try {
      const ip = req.ip || 'unknown';
      if (!checkAuthLimit(ip) || !checkPinLimit(ip)) {
        return res.json({ ok: false, rate_limited: true });
      }

      const pin = String(req.body.pin || '');
      const shopId = String(req.body.shopId || '').trim();

      if (!/^\d{4}$/.test(pin)) {
        return res.json({ ok: false });
      }
      if (!shopId || shopId.length > 100) {
        return res.json({ ok: false, error: 'Нужен ID' });
      }

      const r = await pool.query(
        'SELECT chat_id, shop_id, role, warehouse_pin_hash ' +
        'FROM admins WHERE shop_id = $1 ' +
        'AND warehouse_pin_hash IS NOT NULL',
        [shopId]
      );

      let matchedAdmin = null;
      let matchCount = 0;

      for (let i = 0; i < r.rows.length; i++) {
        let row = r.rows[i];
        if (row.warehouse_pin_hash) {
          const isMatch = await bcrypt.compare(
            pin, row.warehouse_pin_hash
          );
          if (isMatch) {
            matchedAdmin = row;
            matchCount++;
          }
        }
      }

      if (matchCount === 0) return res.json({ ok: false });
      if (matchCount > 1) {
        return res.json({ 
          ok: false, 
          error: 'Дублирование PIN. Обратитесь к владельцу.' 
        });
      }

      const allShopsRes = await pool.query(
        'SELECT a.shop_id, s.display_name, a.role ' +
        'FROM admins a ' +
        'JOIN shops s ON s.shop_id = a.shop_id ' +
        'WHERE a.chat_id = $1',
        [matchedAdmin.chat_id]
      );

      const shops = allShopsRes.rows;
      const chatId = matchedAdmin.chat_id;
      const finalShopId = matchedAdmin.shop_id;

      const token = getAuthCookie(chatId, finalShopId);
      res.cookie('wh_auth', token, cookieOpts);

      if (shops.length > 1) {
        return res.json({ ok: true, multi: true, shops: shops });
      }

      res.json({ ok: true, role: matchedAdmin.role });
    } catch (e) { 
      console.error('Auth error:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/auth-owner', async function(req, res) {
    try {
      const ip = req.ip || 'unknown';
      if (!checkAuthLimit(ip)) {
        return res.json({ ok: false, rate_limited: true });
      }

      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      
      if (!login || !password) return res.json({ ok: false });
      if (login.length > 64 || password.length > 100) {
        return res.json({ ok: false });
      }

      const r = await pool.query(
        'SELECT chat_id, shop_id, role, password_hash ' +
        'FROM admins WHERE login = $1 LIMIT 1', [login]
      );

      if (r.rows.length === 0) return res.json({ ok: false });
      
      let valid = false;
      const dbHash = r.rows[0].password_hash;
      const pwBytes = Buffer.byteLength(password, 'utf8');
      
      if (dbHash && dbHash.length === 64) {
        const sha = crypto.createHash('sha256')
          .update(password).digest('hex');
        const a = Buffer.from(sha, 'hex');
        const b = Buffer.from(dbHash, 'hex');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          valid = true;
          // bcrypt работает максимум с 72 байтами.
          // Длинные пароли не мигрируем — оставляем SHA-256.
          if (pwBytes <= 72) {
            const newHash = await bcrypt.hash(password, 10);
            await pool.query(
              'UPDATE admins SET password_hash = $1 ' +
              'WHERE chat_id = $2 AND shop_id = $3 ' +
              'AND password_hash = $4',
              [newHash, r.rows[0].chat_id, 
               r.rows[0].shop_id, dbHash]
            );
          }
        }
      } else if (dbHash) {
        // bcrypt проверяет только первые 72 байта.
        // Если пароль длиннее — отказываем, чтобы не ослаблять защиту.
        if (pwBytes > 72) {
          return res.json({ ok: false });
        }
        valid = await bcrypt.compare(password, dbHash);
      }

      if (!valid) return res.json({ ok: false });
      
      const chatId = r.rows[0].chat_id;
      const shopId = r.rows[0].shop_id;
      const token = getAuthCookie(chatId, shopId);
      
      res.cookie('wh_auth', token, cookieOpts);
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { 
      console.error('Auth-owner error:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.get('/api/warehouse/my-shops', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const r = await pool.query(
        'SELECT a.shop_id, s.display_name, a.role ' +
        'FROM admins a ' +
        'JOIN shops s ON s.shop_id = a.shop_id ' +
        'WHERE a.chat_id = $1',
        [auth.chatId]
      );
      
      res.json({ ok: true, shops: r.rows, active: auth.shopId });
    } catch (e) {
      console.error('My-shops error:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/switch-shop', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const newShopId = String(req.body.shopId || '').trim();
      if (!newShopId || newShopId.length > 100) {
        return res.json({ ok: false });
      }
      
      const check = await pool.query(
        'SELECT role FROM admins ' +
        'WHERE chat_id = $1 AND shop_id = $2',
        [auth.chatId, newShopId]
      );
      
      if (check.rows.length === 0) {
        return res.status(403).json({ ok: false });
      }
      
      const token = getAuthCookie(auth.chatId, newShopId);
      res.cookie('wh_auth', token, cookieOpts);
      
      res.json({ ok: true });
    } catch (e) {
      console.error('Switch-shop error:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/shop/create', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND role = \'owner\' LIMIT 1',
        [auth.chatId]
      );
      
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ ok: false });
      }

      const name = String(req.body.name || '').trim();
      if (!name || name.length > 100) {
        return res.json({ ok: false, error: 'Нужно имя' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      inTx = true;

      let shopId = '';
      let inviteCode = '';
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 3) {
        shopId = 'shop_' + crypto.randomBytes(8)
          .toString('hex');
        inviteCode = crypto.randomBytes(8)
          .toString('hex').toUpperCase();

        const check = await client.query(
          'SELECT 1 FROM shops WHERE shop_id = $1 ' +
          'OR invite_code = $2',
          [shopId, inviteCode]
        );

        if (check.rows.length === 0) isUnique = true;
        attempts++;
      }

      if (!isUnique) throw new Error('Не удалось сгенерировать ID');

      await client.query(
        'INSERT INTO shops (shop_id, name, display_name, ' +
        'invite_code, trial_start, trial_end, settings) ' +
        'VALUES ($1, $2, $2, $3, NOW(), ' +
        'NOW() + INTERVAL \'1 month\', \'{}\'::jsonb)',
        [shopId, name, inviteCode]
      );

      await client.query(
        'INSERT INTO admins (chat_id, shop_id, role, name) ' +
        'VALUES ($1, $2, \'owner\', \'Владелец\')',
        [auth.chatId, shopId]
      );

      await client.query('COMMIT');
      inTx = false;

      res.json({ ok: true, shopId: shopId });
    } catch (e) {
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      
      if (e.code === '23505') {
        return res.json({ 
          ok: false, 
          error: 'Ошибка уникальности. Попробуйте снова.' 
        });
      }
      
      console.error('Shop create error:', e.message);
      res.status(500).json({ ok: false });
    } finally {
      if (client) client.release();
    }
  });
}

module.exports = { setupWarehouseAuth };