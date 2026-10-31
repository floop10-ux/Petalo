const pool = require('./db');
const crypto = require('crypto');

function capWords(str) {
  if (!str) return '';
  return String(str).replace(
    /(^[\p{L}\d])|(\s+[\p{L}\d])/gu,
    function(letter) {
      return letter.toUpperCase();
    }
  );
}

async function logAction(shopId, chatId, action, details, refId) {
  try {
    await pool.query(
      'INSERT INTO wh_audit_log (shop_id, chat_id, ' +
      'action, details, ref_id) VALUES ($1, $2, $3, $4, $5)',
      [shopId, chatId, action, details, refId || null]
    );
  } catch (e) { console.error('Log error:', e.message); }
}

function setupWarehouseApi(app, bot, s3ctx, getAuth) {
  // ====== МИГРАЦИИ ======
  pool.query(
    'ALTER TABLE wh_writeoffs ADD COLUMN ' +
    'IF NOT EXISTS doc_id VARCHAR(100)'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE wh_writeoffs ADD COLUMN ' +
    'IF NOT EXISTS status VARCHAR(20) DEFAULT \'completed\''
  ).catch(function(){});
  pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS status VARCHAR(20) DEFAULT \'active\''
  ).catch(function(){});
  
  // Миграция для альтернативных ингредиентов
  pool.query(
    'ALTER TABLE wh_bouquet_recipes ADD COLUMN ' +
    'IF NOT EXISTS alternatives JSONB DEFAULT \'[]\'::jsonb'
  ).catch(function(){});

  pool.query(
    'UPDATE wh_writeoffs SET doc_id = \'legacy_\' || shop_id ' +
    '|| \'_\' || extract(epoch from date)::int WHERE doc_id IS NULL'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE admins ADD COLUMN IF NOT EXISTS login VARCHAR(50)'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE admins ADD COLUMN IF NOT EXISTS ' +
    'password_hash VARCHAR(100)'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE shops ADD COLUMN IF NOT EXISTS settings JSONB'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE shops ADD COLUMN IF NOT EXISTS invite_code VARCHAR(50)'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE bouquets ADD COLUMN IF NOT EXISTS wh_linked ' +
    'BOOLEAN DEFAULT FALSE'
  ).catch(function(){});
  pool.query(
    'ALTER TABLE bouquets ADD COLUMN IF NOT EXISTS deleted ' +
    'BOOLEAN DEFAULT FALSE'
  ).catch(function(){});

  // ====== АВТОРИЗАЦИЯ ======
  function getAuthCookie(chatId, shopId) {
    const secret = process.env.WH_COOKIE_SECRET || 'fallback_secret';
    const payload = chatId + '.' + shopId;
    const hmac = crypto.createHmac('sha256', secret)
      .update(payload).digest('hex');
    return payload + '.' + hmac;
  }

  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const shopId = req.body.shopId;
      const pin = String(req.body.pin);

      const r = await pool.query(
        'SELECT chat_id, role FROM admins WHERE shop_id = $1 ' +
        'AND warehouse_pin = $2', [shopId, pin]
      );

      if (r.rows.length === 0) return res.json({ ok: false });
      
      const chatId = r.rows[0].chat_id;
      const token = getAuthCookie(chatId, shopId);
      
      res.cookie('wh_auth', token, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true, 
        secure: true, 
        sameSite: 'none' 
      });
      
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { 
      console.error('Auth error:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/auth-owner', async (req, res) => {
    try {
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      
      if (!login || !password) return res.json({ ok: false });

      const hash = crypto.createHash('sha256')
        .update(password).digest('hex');
      
      const r = await pool.query(
        'SELECT chat_id, role, shop_id FROM admins WHERE login = $1 ' +
        'AND password_hash = $2', [login, hash]
      );

      if (r.rows.length === 0) return res.json({ ok: false });
      
      const chatId = r.rows[0].chat_id;
      const shopId = r.rows[0].shop_id;
      const token = getAuthCookie(chatId, shopId);
      
      res.cookie('wh_auth', token, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true, 
        secure: true, 
        sameSite: 'none' 
      });
      
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { 
      console.error('Auth-owner error:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  // ====== ТОВАРЫ ======
  app.get('/api/warehouse/categories', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT id, name FROM wh_categories ORDER BY sort_order ASC'
      );
      res.json({ ok: true, categories: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const showArchive = req.query.show_archive === 'true';
      
      let query = 
        'SELECT i.id, i.current_stock, i.retail_price, ' +
        'i.last_cost, i.is_pinned, i.avg_cost, i.hidden, ' +
        'COALESCE(i.custom_name, w.name) AS name, ' +
        'w.photo_url, w.category_id, w.unit ' +
        'FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 ';
        
      if (!showArchive) {
        query += 'AND (i.hidden = FALSE OR i.hidden IS NULL) ';
      }
      
      if (showArchive) {
        query += 'AND NOT EXISTS (SELECT 1 FROM wh_bouquet_recipes r ' +
                 'WHERE r.shop_item_id = i.id) ';
      }
      
      query += 'ORDER BY i.is_pinned DESC, w.name ASC';
      
      const r = await pool.query(query, [shopId]);
      res.json({ ok: true, items: r.rows });
    } catch (e) {
      console.error('API items:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== УПРАВЛЕНИЕ ТОВАРОМ ======
  app.post('/api/warehouse/item/set-price', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const itemId = parseInt(req.body.id);
      const price = parseFloat(
        String(req.body.price).replace(',', '.')
      );
      if (!itemId || isNaN(itemId) || isNaN(price) || price <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      await pool.query(
        'UPDATE wh_shop_items SET retail_price = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [price, itemId, auth.shopId]
      );
      
      await logAction(auth.shopId, auth.chatId, 'set_price', 
        'Цена ' + price + ' ₽ для ID: ' + itemId, itemId);
        
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/item/rename', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1', [auth.chatId, auth.shopId]
      );
      if (ownerCheck.rows.length === 0 ||
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false, error: 'Только владелец' });
      }

      const itemId = parseInt(req.body.id);
      const newName = capWords(req.body.name);
      if (!itemId || isNaN(itemId) || !newName || newName.length > 200) {
        return res.json({ ok: false, error: 'Некорректное имя' });
      }

      const r = await pool.query(
        'SELECT i.item_id FROM wh_shop_items i ' +
        'WHERE i.id = $1 AND i.shop_id = $2', [itemId, auth.shopId]
      );
      if (r.rows.length === 0) return res.json({ ok: false });

      await pool.query(
        'UPDATE wh_items SET name = $1 WHERE id = $2',
        [newName, r.rows[0].item_id]
      );
      await pool.query(
        'UPDATE wh_shop_items SET custom_name = $1 WHERE id = $2',
        [newName, itemId]
      );
      
      await logAction(auth.shopId, auth.chatId, 'rename', 
        'Переименование в: ' + newName, itemId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/item/pin', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const itemId = parseInt(req.body.id);
      const val = req.body.val === true;
      if (!itemId || isNaN(itemId)) return res.json({ ok: false });
      
      await pool.query(
        'UPDATE wh_shop_items SET is_pinned = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [val, itemId, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/item/set-photo', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopItemId = parseInt(req.body.id);
      const url = String(req.body.url || '');
      if (!shopItemId || isNaN(shopItemId) || !url.startsWith('http')) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      const r = await pool.query(
        'SELECT item_id FROM wh_shop_items ' +
        'WHERE id = $1 AND shop_id = $2',
        [shopItemId, auth.shopId]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      
      await pool.query(
        'UPDATE wh_items SET photo_url = $1 WHERE id = $2',
        [url, r.rows[0].item_id]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/item/delete', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const itemId = parseInt(req.body.id);
      if (!itemId || isNaN(itemId)) {
        client.release(); return res.json({ ok: false });
      }
      
      const historyRes = await client.query(
        'SELECT (SELECT COUNT(*) FROM wh_sale_items ' +
        'WHERE shop_item_id = $1) + (SELECT COUNT(*) FROM ' +
        'wh_receipt_items WHERE shop_item_id = $1) + ' +
        '(SELECT COUNT(*) FROM wh_writeoffs ' +
        'WHERE shop_item_id = $1) as cnt', [itemId]
      );
      const hasHistory = parseInt(historyRes.rows[0].cnt) > 0;

      await client.query('BEGIN');
      if (hasHistory) {
        await client.query(
          'UPDATE wh_shop_items SET hidden = TRUE ' +
          'WHERE id = $1 AND shop_id = $2', [itemId, auth.shopId]
        );
      } else {
        await client.query(
          'DELETE FROM wh_bouquet_recipes ' +
          'WHERE shop_item_id = $1', [itemId]
        );
        await client.query(
          'DELETE FROM wh_shop_items ' +
          'WHERE id = $1 AND shop_id = $2', [itemId, auth.shopId]
        );
      }
      await client.query('COMMIT');
      client.release();
      res.json({ ok: true, archived: hasHistory });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ВОССТАНОВЛЕНИЕ ИЗ АРХИВА ======
  app.post('/api/warehouse/item/restore', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const itemId = parseInt(req.body.id);
      if (!itemId || isNaN(itemId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const r = await pool.query(
        'UPDATE wh_shop_items SET hidden = FALSE ' +
        'WHERE id = $1 AND shop_id = $2 RETURNING id',
        [itemId, auth.shopId]
      );
      
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Товар не найден' });
      }
      
      await logAction(auth.shopId, auth.chatId, 'restore',
        'Восстановление из архива ID: ' + itemId, itemId);
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ИСТОРИЯ ТОВАРА ======
  app.get('/api/warehouse/item/history', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const itemId = parseInt(req.query.id);
      if (!itemId || isNaN(itemId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const limit = parseInt(req.query.limit) || 10;
      const offset = parseInt(req.query.offset) || 0;

      const itemInfo = await pool.query(
        'SELECT i.id, i.current_stock, i.item_id, i.is_pinned, ' +
        'i.retail_price, i.hidden, ' +
        'COALESCE(i.custom_name, w.name) AS name, w.unit ' +
        'FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.id = $1 AND i.shop_id = $2', [itemId, shopId]
      );
      if (itemInfo.rows.length === 0) {
        return res.json({ ok: false, error: 'Товар не найден' });
      }

      const countQ = await pool.query(
        'SELECT ' +
        '(SELECT COUNT(*) FROM wh_sale_items ' +
        'WHERE shop_item_id = $1 AND qty > 0) + ' +
        '(SELECT COUNT(*) FROM wh_receipt_items ' +
        'WHERE shop_item_id = $1 AND qty > 0) + ' +
        '(SELECT COUNT(*) FROM wh_writeoffs ' +
        'WHERE shop_item_id = $1 AND qty > 0) as total', [itemId]
      );
      const total = parseInt(countQ.rows[0].total) || 0;

      const unionQuery = `
        SELECT * FROM (
          SELECT s.id::text as id, s.date, 'sale' as type, si.qty, 
                 COALESCE(a.name, 'Флорист')::text as person, 
                 NULL::text as reason, s.status
          FROM wh_sale_items si 
          JOIN wh_sales s ON s.id = si.sale_id 
          LEFT JOIN admins a ON a.chat_id = s.chat_id 
          WHERE si.shop_item_id = $1 AND s.shop_id = $2
          AND si.qty > 0
          UNION ALL
          SELECT r.id::text as id, r.date, 'receipt' as type, ri.qty, 
                 'Приход'::text as person, NULL::text as reason, 
                 r.status
          FROM wh_receipt_items ri 
          JOIN wh_receipts r ON r.id = ri.receipt_id 
          WHERE ri.shop_item_id = $1 AND r.shop_id = $2
          AND ri.qty > 0
          UNION ALL
          SELECT w.id::text as id, w.date, 'writeoff' as type, w.qty, 
                 COALESCE(a.name, 'Флорист')::text as person, 
                 COALESCE(w.reason, '')::text as reason, 
                 w.status
          FROM wh_writeoffs w 
          LEFT JOIN admins a ON a.chat_id = w.chat_id 
          WHERE w.shop_item_id = $1 AND w.shop_id = $2
          AND w.qty > 0
        ) as combined
        ORDER BY date DESC 
        LIMIT $3 OFFSET $4
      `;
      
      const historyRes = await pool.query(unionQuery, [
        itemId, shopId, limit, offset
      ]);
      
      let list = historyRes.rows;
      let runningStock = parseFloat(itemInfo.rows[0].current_stock) || 0;
      
      list.forEach(function(op) {
        let qty = parseFloat(op.qty) || 0;
        op.stock_after = runningStock;
        if (op.type === 'receipt') {
          op.stock_before = runningStock - qty;
          runningStock -= qty;
        } else {
          op.stock_before = runningStock + qty;
          runningStock += qty;
        }
      });

      res.json({ 
        ok: true, 
        item: itemInfo.rows[0], 
        history: list, 
        total: total 
      });
    } catch (e) {
      console.error('History error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });
  // ====== МУЛЬТИТОЧКИ (ПЕРЕКЛЮЧЕНИЕ МАГАЗИНОВ) ======
  app.get('/api/warehouse/my-shops', async (req, res) => {
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
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/switch-shop', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const newShopId = req.body.shopId;
      
      const check = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 AND shop_id = $2',
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
        sameSite: 'none' 
      });
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ПРОДАЖИ ======
  app.post('/api/warehouse/sale', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }

      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const real_price = parseFloat(
        String(req.body.real_price).replace(',', '.')
      );
      if (!real_price || real_price <= 0) {
        client.release(); 
        return res.json({ ok: false, error: 'Сумма > 0' });
      }

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        client.release(); 
        return res.json({ ok: false, error: 'Корзина пуста' });
      }

      const idempotency_key = req.body.idempotency_key || null;

      if (idempotency_key) {
        const checkKey = await client.query(
          'SELECT id FROM wh_sales WHERE idempotency_key = $1 ' +
          'AND shop_id = $2', [idempotency_key, shopId]
        );
        if (checkKey.rows.length > 0) {
          client.release();
          return res.json({ ok: true, duplicated: true });
        }
      }

      const payments = Array.isArray(req.body.payments) ? 
        req.body.payments : [];
        
      let payCash = 0, payCard = 0, payQr = 0;
      payments.forEach(function(p) {
        if (p.method === 'cash') payCash += p.amount;
        if (p.method === 'card') payCard += p.amount;
        if (p.method === 'qr') payQr += p.amount;
      });

      await client.query('BEGIN');
      
      const saleRes = await client.query(
        'INSERT INTO wh_sales (shop_id, real_price, chat_id, ' +
        'pay_cash, pay_card, pay_qr, idempotency_key, status) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, \'active\') RETURNING id',
        [shopId, real_price, chatId, payCash, payCard, payQr, 
         idempotency_key]
      );
      const saleId = saleRes.rows[0].id;
      let itemsStr = '';

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var qty = parseFloat(String(item.qty).replace(',', '.'));
        
        // ЗАЩИТА ОТ x0
        if (!qty || qty <= 0) continue;
        
        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1 WHERE id = $2 AND shop_id = $3',
          [qty, item.id, shopId]
        );
        
        const costQ = await client.query(
          'SELECT avg_cost FROM wh_shop_items ' +
          'WHERE id = $1 AND shop_id = $2', [item.id, shopId]
        );
        var costVal = 0;
        if (costQ.rows.length > 0 && costQ.rows[0].avg_cost) {
          costVal = Math.round(
            parseFloat(costQ.rows[0].avg_cost) * 100
          ) / 100;
        }
        
        await client.query(
          'INSERT INTO wh_sale_items (sale_id, shop_item_id, ' +
          'qty, cost_at_sale) VALUES ($1, $2, $3, $4)',
          [saleId, item.id, qty, costVal]
        );
        
        itemsStr += item.name + ' x' + qty + ', ';
      }
      if (itemsStr.length > 2) { itemsStr = itemsStr.slice(0, -2); }

      await client.query('COMMIT');
      client.release();

      await logAction(shopId, chatId, 'sale',
        'Продажа на ' + real_price + ' ₽. Товары: ' + itemsStr, saleId);
        
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      console.error('Sale error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== СПИСАНИЯ ======
  app.post('/api/warehouse/writeoff', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        client.release(); 
        return res.json({ ok: false, error: 'Список пуст' });
      }

      await client.query('BEGIN');
      let totalLoss = 0;
      const docId = 'WO_' + Date.now() + '_' + 
        Math.floor(Math.random() * 1000);
      let firstId = null;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const qty = parseFloat(String(item.qty).replace(',', '.'));
        
        // ЗАЩИТА ОТ x0
        if (!qty || qty <= 0) continue;

        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1 WHERE id = $2 AND shop_id = $3', 
          [qty, item.id, shopId]
        );
        
        const costQ = await client.query(
          'SELECT avg_cost FROM wh_shop_items ' +
          'WHERE id = $1 AND shop_id = $2', [item.id, shopId]
        );
        const cost = parseFloat(costQ.rows[0].avg_cost) || 0;
        totalLoss += (cost * qty);

        const ins = await client.query(
          'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, ' +
          'reason, comment, photo_url, chat_id, doc_id, status) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, \'completed\') ' +
          'RETURNING id',
          [shopId, item.id, qty, req.body.reason, 
           req.body.comment, req.body.photo, chatId, docId]
        );
        if (i === 0) firstId = ins.rows[0].id;
      }

      await client.query('COMMIT');
      client.release();

      const itemName = items[0].name || 'Товар';
      await logAction(shopId, chatId, 'writeoff', 
        'Списание: ' + itemName + ' (и др.)', firstId);

      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ЗАГРУЗКА ФОТО (S3) ======
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const s3 = s3ctx.s3;
      const s3backup = s3ctx.s3backup;
      const YC_BUCKET = s3ctx.YC_BUCKET;
      const BC_BUCKET = s3ctx.BC_BUCKET;
      const BC_ENDPOINT = s3ctx.BC_ENDPOINT;

      if (!s3) {
        return res.status(503).json({ ok: false, error: 'S3 не настроен' });
      }
      
      const base64Data = req.body.image;
      if (!base64Data || !base64Data.includes(';base64,')) {
        return res.json({ ok: false, error: 'Неверный формат фото' });
      }
      
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      
      if (buffer.length > 10 * 1024 * 1024) {
        return res.json({ ok: false, error: 'Фото больше 10 МБ' });
      }
      
      const key = 'wh_' + Date.now() + '_' + 
        Math.random().toString(36).slice(2, 6) + '.jpg';
      
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      
      const cmd = new PutObjectCommand({ 
        Bucket: YC_BUCKET, Key: key, Body: buffer, 
        ContentType: 'image/jpeg',
        ContentLength: buffer.length
      });
      
      await s3.send(cmd);
      const url = 'https://' + YC_BUCKET + 
        '.storage.yandexcloud.net/' + key;
      
      let urlBackup = null;
      if (s3backup && BC_BUCKET && BC_ENDPOINT) {
        try {
          const cmd2 = new PutObjectCommand({ 
            Bucket: BC_BUCKET, Key: key, Body: buffer, 
            ContentType: 'image/jpeg',
            ContentLength: buffer.length
          });
          await s3backup.send(cmd2);
          urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
        } catch (err) {
          console.error('Backup S3 error:', err.message);
        }
      }
      
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) {
      console.error('Upload error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== НАКЛАДНЫЕ (ПРИХОДЫ) ======
  app.get('/api/warehouse/receipts', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const r = await pool.query(
        'SELECT r.id, r.date, r.updated_at, r.total_sum, r.status, ' +
        'a.name as author FROM wh_receipts r ' +
        'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'WHERE r.shop_id = $1 ORDER BY r.date DESC LIMIT 30',
        [auth.shopId]
      );
      res.json({ ok: true, docs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/receipt/delete', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const receiptId = parseInt(req.body.id);
      if (!receiptId || isNaN(receiptId)) return res.json({ ok: false });
      
      const r = await pool.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2', [receiptId, auth.shopId]
      );
      
      if (r.rows.length === 0 || r.rows[0].status !== 'draft') {
        return res.json({ ok: false, error: 'Только черновики' });
      }
      
      await pool.query(
        'DELETE FROM wh_receipt_items WHERE receipt_id = $1', [receiptId]
      );
      await pool.query(
        'DELETE FROM wh_receipts WHERE id = $1 AND shop_id = $2', 
        [receiptId, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.get('/api/warehouse/receipt/items', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const receiptId = parseInt(req.query.id);
      if (!receiptId || isNaN(receiptId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const r = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ' +
        'ri.shop_item_id, shi.retail_price, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1', [receiptId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/receipt/item/add', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const receiptId = parseInt(req.body.receipt_id);
      if (!receiptId || isNaN(receiptId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }

      const checkR = await pool.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2', [receiptId, shopId]
      );
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'draft') {
        return res.json({ ok: false, error: 'Накладная не черновик' });
      }

      const name = capWords(String(req.body.name || '').trim());
      const numQty = parseFloat(
        String(req.body.qty).replace(',', '.')
      );
      const numPrice = parseFloat(
        String(req.body.price).replace(',', '.')
      );
      const numRetail = parseFloat(
        String(req.body.retail).replace(',', '.')
      ) || 0;

      if (!name || isNaN(numQty) || isNaN(numPrice) || 
          numQty <= 0 || numPrice <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      const catId = req.body.cat_id ? parseInt(req.body.cat_id) : null;
      const unit = req.body.unit || 'шт';
      const photoUrl = req.body.photo_url || null;

      let itemRes = await pool.query(
        'SELECT id FROM wh_items WHERE name = $1', [name]
      );
      let itemId;
      
      if (itemRes.rows.length === 0) {
        const ni = await pool.query(
          'INSERT INTO wh_items (name, unit, category_id, photo_url) ' +
          'VALUES ($1, $2, $3, $4) RETURNING id',
          [name, unit, catId, photoUrl]
        );
        itemId = ni.rows[0].id;
      } else {
        itemId = itemRes.rows[0].id;
        if (photoUrl) {
          await pool.query(
            'UPDATE wh_items SET photo_url = $1 WHERE id = $2', 
            [photoUrl, itemId]
          );
        }
      }

      let shopItemRes = await pool.query(
        'SELECT id FROM wh_shop_items ' +
        'WHERE shop_id = $1 AND item_id = $2', 
        [shopId, itemId]
      );
      let shopItemId;
      
      if (shopItemRes.rows.length === 0) {
        const nsi = await pool.query(
          'INSERT INTO wh_shop_items (shop_id, item_id) ' +
          'VALUES ($1, $2) RETURNING id', [shopId, itemId]
        );
        shopItemId = nsi.rows[0].id;
      } else { 
        shopItemId = shopItemRes.rows[0].id; 
      }

      const sum = Math.round(numQty * numPrice * 100) / 100;

      const existing = await pool.query(
        'SELECT id, qty, sum FROM wh_receipt_items ' +
        'WHERE receipt_id = $1 AND shop_item_id = $2', 
        [receiptId, shopItemId]
      );
      
      if (existing.rows.length > 0) {
        const ex = existing.rows[0];
        const exQty = parseFloat(ex.qty); 
        const exSum = parseFloat(ex.sum);
        const newQty = exQty + numQty; 
        const newSum = exSum + sum;
        const newAvg = Math.round((newSum / newQty) * 100) / 100;
        
        await pool.query(
          'UPDATE wh_receipt_items SET qty = $1, sum = $2, ' +
          'unit_cost = $3 WHERE id = $4', 
          [newQty, newSum, newAvg, ex.id]
        );
      } else {
        await pool.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, ' +
          'qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)', 
          [receiptId, shopItemId, numQty, numPrice, sum]
        );
      }

      await pool.query(
        'UPDATE wh_receipts SET total_sum = total_sum + $1, ' +
        'updated_at = NOW() WHERE id = $2', [sum, receiptId]
      );
      
      await pool.query(
        'UPDATE wh_shop_items SET retail_price = ' +
        'CASE WHEN $1 > 0 THEN $1 ELSE retail_price END ' +
        'WHERE id = $2', [numRetail, shopItemId]
      );

      const items = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ' +
        'ri.shop_item_id, shi.retail_price, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1', [receiptId]
      );
      res.json({ ok: true, items: items.rows });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });
  // ====== ПРОВЕДЕНИЕ НАКЛАДНОЙ ======
  app.post('/api/warehouse/receipt/save-all', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const shopId = auth.shopId;
      const receiptId = parseInt(req.body.receipt_id);
      const items = req.body.items;
      
      if (!receiptId || isNaN(receiptId) || !Array.isArray(items)) {
        client.release(); 
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      const checkR = await client.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE', [receiptId, shopId]
      );
      
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ 
          ok: false, error: 'Накладная не найдена или уже проведена' 
        });
      }

      await client.query(
        'DELETE FROM wh_receipt_items WHERE receipt_id = $1', [receiptId]
      );

      let totalSum = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = parseFloat(String(it.qty).replace(',', '.'));
        const price = parseFloat(
          String(it.unit_cost).replace(',', '.')
        );
        const sum = Math.round(qty * price * 100) / 100;
        totalSum += sum;

        await client.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, ' +
          'qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)',
          [receiptId, it.shop_item_id, qty, price, sum]
        );
        
        if (it.retail_price && parseFloat(it.retail_price) > 0) {
          await client.query(
            'UPDATE wh_shop_items SET retail_price = $1 ' +
            'WHERE id = $2 AND shop_id = $3',
            [parseFloat(it.retail_price), it.shop_item_id, shopId]
          );
        }
      }
      
      await client.query(
        'UPDATE wh_receipts SET total_sum = $1 WHERE id = $2', 
        [totalSum, receiptId]
      );

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const curr = await client.query(
          'SELECT current_stock, avg_cost FROM wh_shop_items ' +
          'WHERE id = $1 AND shop_id = $2 FOR UPDATE', 
          [it.shop_item_id, shopId]
        );
        
        let oldStock = parseFloat(curr.rows[0].current_stock) || 0;
        let oldAvg = parseFloat(curr.rows[0].avg_cost) || 0;
        let qty = parseFloat(String(it.qty).replace(',', '.')) || 0;
        let price = parseFloat(
          String(it.unit_cost).replace(',', '.')
        ) || 0;

        let newStock = oldStock + qty;
        let newAvg = 0;
        
        if (newStock > 0) { 
          newAvg = (oldStock * oldAvg + qty * price) / newStock; 
          newAvg = Math.round(newAvg * 100) / 100; 
        }

        await client.query(
          'UPDATE wh_shop_items SET current_stock = $1, ' +
          'last_cost = $2, avg_cost = $3 WHERE id = $4',
          [newStock, price, newAvg, it.shop_item_id]
        );
      }

      await client.query(
        'UPDATE wh_receipts SET status = \'completed\', ' +
        'updated_at = NOW() WHERE id = $1', [receiptId]
      );
      
      await client.query('COMMIT');
      client.release();

      await logAction(shopId, auth.chatId, 'receipt', 
        'Проведена накладная ID ' + receiptId, receiptId);
        
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ОТМЕНА НАКЛАДНОЙ ======
  app.post('/api/warehouse/receipt/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const shopId = auth.shopId;
      const receiptId = parseInt(req.body.id);
      
      if (!receiptId || isNaN(receiptId)) { 
        client.release(); 
        return res.json({ ok: false, error: 'Неверный ID' }); 
      }
      
      await client.query('BEGIN');
      const checkR = await client.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE', [receiptId, shopId]
      );
      
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'completed') {
        await client.query('ROLLBACK'); client.release(); 
        return res.json({ 
          ok: false, error: 'Накладная не найдена или не проведена' 
        });
      }

      const items = await client.query(
        'SELECT shop_item_id, qty FROM wh_receipt_items ' +
        'WHERE receipt_id = $1', [receiptId]
      );
      
      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1 WHERE id = $2 AND shop_id = $3',
          [item.qty, item.shop_item_id, shopId]
        );
      }
      
      await client.query(
        'UPDATE wh_receipts SET status = \'draft\', ' +
        'updated_at = NOW() WHERE id = $1 AND shop_id = $2', 
        [receiptId, shopId]
      );
      await client.query('COMMIT');
      client.release();
      
      await logAction(shopId, auth.chatId, 'receipt_cancel', 
        'Отменено проведение накладной ' + receiptId, receiptId);
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ДОКУМЕНТЫ (СПИСОК) ======
  app.get('/api/warehouse/documents', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const type = req.query.type || 'receipts';
      
      if (type === 'receipts') {
        const r = await pool.query(
          'SELECT r.id, r.date, r.total_sum as amount, ' +
          'a.name as author ' +
          'FROM wh_receipts r ' +
          'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
          'WHERE r.shop_id = $1 AND r.status = \'completed\' ' +
          'ORDER BY r.date DESC LIMIT 50', [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      } else {
        const r = await pool.query(
          'SELECT doc_id as id, MAX(date) as date, ' +
          'SUM(amount) as amount, MAX(reason) as reason, ' +
          'MAX(author) as author, ' +
          'STRING_AGG(items, \', \') as items ' +
          'FROM (' +
          '  SELECT COALESCE(w.doc_id, w.id::text) as doc_id, ' +
          '  w.date, w.qty as amount, w.reason, ' +
          '  a.name as author, ' +
          '  COALESCE(shi.custom_name, i.name) || \' x\' || ' +
          '  TRIM(TRAILING \'.\' FROM TRIM(TRAILING \'0\' FROM ' +
          '  w.qty::text)) as items ' +
          '  FROM wh_writeoffs w ' +
          '  LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
          '  LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          '  LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          '  WHERE w.shop_id = $1 AND w.status = \'completed\'' +
          ') sub ' +
          'GROUP BY doc_id ORDER BY MAX(date) DESC LIMIT 50',
          [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      }
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  // ====== ДЕТАЛИ ДОКУМЕНТА ======
  app.get('/api/warehouse/documents/details', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const id = req.query.id; 
      const type = req.query.type;
      
      if (!id) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      if (type === 'receipts') {
        const rid = parseInt(id);
        if (!rid || isNaN(rid)) {
          return res.json({ ok: false, error: 'Неверный ID' });
        }
        const header = await pool.query(
          'SELECT r.id, r.date, r.total_sum, r.status, ' +
          'a.name as author FROM wh_receipts r ' +
          'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
          'WHERE r.id = $1 AND r.shop_id = $2', [rid, shopId]
        );
        
        if (header.rows.length === 0) {
          return res.json({ ok: false, error: 'Не найдено' });
        }
        
        const items = await pool.query(
          'SELECT ri.shop_item_id, ri.qty, ri.unit_cost, ri.sum, ' +
          'COALESCE(shi.custom_name, i.name) as name ' +
          'FROM wh_receipt_items ri ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE ri.receipt_id = $1', [rid]
        );
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      } else {
        const docId = String(id);
        const header = await pool.query(
          'SELECT COALESCE(MAX(w.doc_id), MAX(w.id)::text) as id, ' +
          'MAX(w.date) as date, SUM(w.qty) as total_sum, ' +
          'MAX(w.reason) as reason, MAX(a.name) as author, ' +
          'MAX(w.status) as status ' +
          'FROM wh_writeoffs w ' +
          'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
          'WHERE (w.doc_id = $1 OR w.id::text = $1) ' +
          'AND w.shop_id = $2', [docId, shopId]
        );
        
        if (header.rows.length === 0 || !header.rows[0].date) {
          return res.json({ ok: false, error: 'Не найдено' });
        }
        
        const items = await pool.query(
          'SELECT w.shop_item_id, w.qty, 0 as unit_cost, 0 as sum, ' +
          'COALESCE(shi.custom_name, i.name) as name ' +
          'FROM wh_writeoffs w ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE (w.doc_id = $1 OR w.id::text = $1)', [docId]
        );
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      }
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  // ====== БУКЕТЫ (ДЛЯ ВИТРИНЫ И КАССЫ) ======
  app.get('/api/warehouse/bouquets', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      
      // Получаем базовую информацию по букетам и их рецептам
      const r = await pool.query(
        'SELECT b.id, b.name, b.price, b.photos, ' +
        'r.shop_item_id, r.qty as recipe_qty, r.alternatives, ' +
        'i.current_stock ' +
        'FROM bouquets b ' +
        'LEFT JOIN wh_bouquet_recipes r ON r.bouquet_id = b.id ' +
        'LEFT JOIN wh_shop_items i ON i.id = r.shop_item_id ' +
        'WHERE b.shop_id = $1 AND b.wh_linked = TRUE ' +
        'AND b.deleted = FALSE', [shopId]
      );
      
      // Группируем по букетам
      let bouquetsMap = {};
      for (const row of r.rows) {
        if (!bouquetsMap[row.id]) {
          bouquetsMap[row.id] = {
            id: row.id, name: row.name, price: row.price,
            photos: row.photos, all_in_stock: true
          };
        }
        
        if (row.shop_item_id) {
          let totalStock = parseFloat(row.current_stock) || 0;
          
          // Если есть альтернативы, суммируем их остатки
          if (row.alternatives && row.alternatives.length > 0) {
            const altRes = await pool.query(
              'SELECT COALESCE(SUM(current_stock), 0) as total ' +
              'FROM wh_shop_items WHERE id = ANY($1)', 
              [row.alternatives]
            );
            totalStock += parseFloat(altRes.rows[0].total);
          }
          
          if (totalStock < parseFloat(row.recipe_qty)) {
            bouquetsMap[row.id].all_in_stock = false;
          }
        }
      }
      
      const result = Object.values(bouquetsMap).map(function(b) {
        let photoUrl = null;
        if (b.photos && b.photos.length > 0) {
          const p = b.photos[0];
          if (typeof p === 'string') photoUrl = p;
          else if (p.s3) photoUrl = p.s3;
          else if (p.s3b) photoUrl = p.s3b;
        }
        return {
          id: b.id, name: b.name, price: b.price,
          photo_url: photoUrl, all_in_stock: b.all_in_stock
        };
      });
      
      res.json({ ok: true, bouquets: result });
    } catch (e) { 
      console.error('API bouquets:', e.message);
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  // РАЗВОРАЧИВАНИЕ БУКЕТА В КАССЕ (с альтернативами)
  app.post('/api/warehouse/bouquet/expand', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const bouquetId = parseInt(req.body.bouquet_id);
      
      if (!bouquetId || isNaN(bouquetId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const checkB = await pool.query(
        'SELECT wh_linked FROM bouquets ' +
        'WHERE id = $1 AND shop_id = $2', [bouquetId, shopId]
      );
      
      if (checkB.rows.length === 0 || !checkB.rows[0].wh_linked) {
        return res.json({ ok: false, error: 'Не связан со складом' });
      }
      
      const r = await pool.query(
        'SELECT r.shop_item_id, r.qty, r.alternatives, i.current_stock, ' +
        'i.retail_price, COALESCE(i.custom_name, w.name) AS name ' +
        'FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items i ON i.id = r.shop_item_id ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE r.bouquet_id = $1', [bouquetId]
      );
      
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Рецепт пуст' });
      }

      let ingredients = [];
      for (const it of r.rows) {
        let altsData = [];
        if (it.alternatives && it.alternatives.length > 0) {
           const altQuery = await pool.query(
             'SELECT i.id, i.current_stock, i.retail_price, ' +
             'COALESCE(i.custom_name, w.name) AS name ' +
             'FROM wh_shop_items i ' +
             'JOIN wh_items w ON w.id = i.item_id ' +
             'WHERE i.id = ANY($1)', [it.alternatives]
           );
           altsData = altQuery.rows;
        }
        
        ingredients.push({
          shop_item_id: it.shop_item_id,
          qty: it.qty,
          current_stock: it.current_stock,
          retail_price: it.retail_price,
          name: it.name,
          alternatives: altsData
        });
      }
      
      res.json({ ok: true, ingredients: ingredients });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/warehouse/bouquets/all', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const r = await pool.query(
        'SELECT b.id, b.name, b.price, b.photos, b.wh_linked, ' +
        'b.deleted, ' +
        '(SELECT STRING_AGG(COALESCE(shi.custom_name, i.name) ' +
        '|| \' x\' || TRIM(TRAILING \'.\' FROM TRIM(TRAILING \'0\' ' +
        'FROM rcp.qty::text)), \', \') ' +
        'FROM wh_bouquet_recipes rcp ' +
        'JOIN wh_shop_items shi ON shi.id = rcp.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE rcp.bouquet_id = b.id) as recipe_text ' +
        'FROM bouquets b WHERE b.shop_id = $1 ORDER BY b.name ASC',
        [auth.shopId]
      );
      
      const result = r.rows.map(function(b) {
        let photoUrl = null;
        if (b.photos && b.photos.length > 0) {
          const p = b.photos[0];
          if (typeof p === 'string') photoUrl = p;
          else if (p.s3) photoUrl = p.s3;
          else if (p.s3b) photoUrl = p.s3b;
        }
        return {
          id: b.id, name: b.name, price: b.price,
          photo_url: photoUrl, wh_linked: b.wh_linked,
          recipe_text: b.recipe_text, deleted: b.deleted
        };
      });
      res.json({ ok: true, bouquets: result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/warehouse/bouquet/toggle', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      await pool.query(
        'UPDATE bouquets SET wh_linked = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [req.body.val, req.body.id, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/bouquet/delete', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      await pool.query(
        'UPDATE bouquets SET deleted = TRUE ' +
        'WHERE id = $1 AND shop_id = $2',
        [req.body.id, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/warehouse/bouquet/restore', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      await pool.query(
        'UPDATE bouquets SET deleted = FALSE ' +
        'WHERE id = $1 AND shop_id = $2',
        [req.body.id, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/warehouse/bouquets/info', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        'SELECT id, name, price, photos, wh_linked FROM bouquets ' +
        'WHERE id = $1 AND shop_id = $2',
        [req.query.id, auth.shopId]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      res.json({ ok: true, bouquet: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/bouquet/save', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const bId = parseInt(req.body.id);
      const name = String(req.body.name || '').trim();
      const price = parseFloat(
        String(req.body.price).replace(',', '.')
      );
      const photoUrl = req.body.photo_url;
      const isLinked = req.body.is_linked === true;
      
      if (!name || !price || price <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      let photos = []; if (photoUrl) { photos.push(photoUrl); }
      let finalId = bId;

      if (bId > 0) {
        if (photoUrl) {
          await pool.query(
            'UPDATE bouquets SET name = $1, price = $2, photos = $3, ' +
            'wh_linked = $4 WHERE id = $5 AND shop_id = $6',
            [name, price, JSON.stringify(photos), isLinked, bId, 
             auth.shopId]
          );
        } else {
          await pool.query(
            'UPDATE bouquets SET name = $1, price = $2, wh_linked = $3 ' +
            'WHERE id = $4 AND shop_id = $5',
            [name, price, isLinked, bId, auth.shopId]
          );
        }
      } else {
        const shopNumberRes = await pool.query(
          'SELECT COALESCE(MAX(shop_number), 0) + 1 AS next ' +
          'FROM bouquets WHERE shop_id = $1', [auth.shopId]
        );
        const shopNumber = shopNumberRes.rows[0].next;
        const ins = await pool.query(
          'INSERT INTO bouquets (shop_id, shop_number, name, price, ' +
          'photos, chat_id, confirmed_at, wh_linked, deleted) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, FALSE) ' +
          'RETURNING id',
          [auth.shopId, shopNumber, name, price, 
           JSON.stringify(photos), auth.chatId, isLinked]
        );
        finalId = ins.rows[0].id;
      }
      res.json({ ok: true, id: finalId });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/warehouse/bouquets/recipe', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        'SELECT r.id, r.shop_item_id, r.qty, r.alternatives, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'i.unit, shi.current_stock FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items shi ON shi.id = r.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE r.bouquet_id = $1 AND shi.shop_id = $2 ORDER BY r.id ASC',
        [req.query.id, auth.shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/bouquets/recipe/save', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const bId = parseInt(req.body.bouquet_id);
      const items = req.body.items;
      if (!bId || !Array.isArray(items)) {
        client.release(); 
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      await client.query(
        'DELETE FROM wh_bouquet_recipes WHERE bouquet_id = $1', [bId]
      );
      
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = parseFloat(String(it.qty).replace(',', '.'));
        const alts = Array.isArray(it.alternatives) ? it.alternatives : [];
        
        await client.query(
          'INSERT INTO wh_bouquet_recipes ' +
          '(bouquet_id, shop_item_id, qty, alternatives) ' +
          'VALUES ($1, $2, $3, $4)', 
          [bId, it.shop_item_id, qty, JSON.stringify(alts)]
        );
      }
      await client.query('COMMIT'); client.release();
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  // ====== ЖУРНАЛ ======
  app.get('/api/warehouse/audit', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId;
      const period = req.query.period || 'today';
      const targetDate = req.query.date;
      let dateFilter = '';
      let params = [shopId];
      if (targetDate) {
        dateFilter = 'AND l.date >= $2::date AND ' +
          'l.date < ($2::date + 1)';
        params.push(targetDate);
      } else if (period === 'today') {
        dateFilter = 'AND l.date >= CURRENT_DATE AND ' +
          'l.date < CURRENT_DATE + 1';
      } else if (period === 'week') {
        dateFilter = 'AND l.date >= NOW() - INTERVAL \'7 days\'';
      } else if (period === 'month') {
        dateFilter = 'AND l.date >= NOW() - INTERVAL \'1 month\'';
      }
      const r = await pool.query(
        'SELECT l.action, l.details, l.date, l.ref_id, ' +
        'a.name as person ' +
        'FROM wh_audit_log l ' +
        'LEFT JOIN admins a ON a.chat_id = l.chat_id ' +
        'WHERE l.shop_id = $1 ' + dateFilter + ' ' +
        'ORDER BY l.date DESC LIMIT 100', params
      );
      res.json({ ok: true, logs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== УМНЫЕ ОТЧЁТЫ ======
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId;
      const start = req.query.start;
      const end = req.query.end;
      
      let fSales = ''; let fWrites = ''; let fRec = '';
      let pSales = [shopId]; let pWrites = [shopId]; let pRec = [shopId];
      
      if (start && end) {
        fSales = 'AND s.date >= $2 AND s.date < $3 ';
        fWrites = 'AND w.date >= $2 AND w.date < $3 ';
        fRec = 'AND r.date >= $2 AND r.date < $3 ';
        let endNext = new Date(end);
        endNext.setDate(endNext.getDate() + 1);
        let endStr = endNext.toISOString().slice(0, 10);
        pSales.push(start, endStr);
        pWrites.push(start, endStr);
        pRec.push(start, endStr);
      }

      const rev = await pool.query(
        'SELECT COALESCE(SUM(real_price), 0) AS total, ' +
        'COALESCE(SUM(pay_cash), 0) as cash, ' +
        'COALESCE(SUM(pay_card), 0) as card, ' +
        'COALESCE(SUM(pay_qr), 0) as qr, COUNT(id) as count ' +
        'FROM wh_sales s WHERE s.shop_id = $1 ' + fSales +
        'AND s.status = \'active\'', pSales
      );
      
      const cost = await pool.query(
        'SELECT COALESCE(SUM(si.qty * si.cost_at_sale), 0) AS ' +
        'total FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'WHERE s.shop_id = $1 ' + fSales +
        'AND s.status = \'active\'', pSales
      );
      
      const loss = await pool.query(
        'SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total, ' +
        'w.reason FROM wh_writeoffs w ' +
        'JOIN wh_shop_items i ON i.id = w.shop_item_id ' +
        'WHERE w.shop_id = $1 ' + fWrites +
        'GROUP BY w.reason', pWrites
      );
      
      const top = await pool.query(
        'SELECT shi.id as shop_item_id, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'SUM(si.qty) as total_qty, ' +
        'SUM(si.qty * (s.real_price / ' +
        '(SELECT SUM(qty) FROM wh_sale_items ' +
        'WHERE sale_id = s.id))) as total_rev ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE s.shop_id = $1 ' + fSales +
        'AND s.status = \'active\' ' +
        'GROUP BY shi.id, shi.custom_name, i.name ' +
        'ORDER BY total_rev DESC LIMIT 5', pSales
      );
      
      const receiptSum = await pool.query(
        'SELECT COALESCE(SUM(total_sum), 0) AS total ' +
        'FROM wh_receipts r WHERE r.shop_id = $1 ' +
        'AND r.status = \'completed\' ' + fRec, pRec
      );
      
      const daily = await pool.query(
        'SELECT DATE(s.date) as day, ' +
        'SUM(s.real_price) as total, ' +
        'SUM((SELECT SUM(si.qty * si.cost_at_sale) ' +
        'FROM wh_sale_items si WHERE si.sale_id = s.id)) as cost ' +
        'FROM wh_sales s WHERE s.shop_id = $1 ' + fSales +
        'AND s.status = \'active\' ' +
        'GROUP BY DATE(s.date) ORDER BY DATE(s.date) DESC', pSales
      );

      const abcRaw = await pool.query(
        'SELECT COALESCE(shi.custom_name, i.name) as name, ' +
        'SUM(si.qty * (s.real_price / (SELECT SUM(qty) ' +
        'FROM wh_sale_items WHERE sale_id = s.id))) as total_rev ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE s.shop_id = $1 ' + fSales + 'AND s.status = \'active\' ' +
        'GROUP BY shi.id, shi.custom_name, i.name ' +
        'ORDER BY total_rev DESC', pSales
      );
      
      let abc = { A: [], B: [], C: [] };
      let abcTotal = abcRaw.rows.reduce(
        (sum, r) => sum + parseFloat(r.total_rev), 0
      );
      let runningSum = 0;
      
      abcRaw.rows.forEach(function(r) {
        let rev = parseFloat(r.total_rev);
        runningSum += rev;
        let pct = abcTotal > 0 ? (runningSum / abcTotal) * 100 : 0;
        let item = { name: r.name, rev: rev };
        if (pct <= 80) abc.A.push(item);
        else if (pct <= 95) abc.B.push(item);
        else abc.C.push(item);
      });

      const frozen = await pool.query(
        'SELECT COALESCE(shi.custom_name, i.name) as name, ' +
        'shi.current_stock, shi.avg_cost, ' +
        '(shi.current_stock * shi.avg_cost) as total_cost ' +
        'FROM wh_shop_items shi ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE shi.shop_id = $1 AND shi.current_stock > 0 ' +
        'AND (shi.hidden = FALSE OR shi.hidden IS NULL) ' +
        'ORDER BY total_cost DESC', [shopId]
      );

      const revenue = parseFloat(rev.rows[0].total) || 0;
      const costVal = parseFloat(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      let marginPct = 0;
      if (revenue > 0) marginPct = Math.round((profit / revenue) * 100);
      
      let losses = 0; let lossReasons = {};
      loss.rows.forEach(function(r) {
        let amt = parseFloat(r.total) || 0;
        losses += amt;
        lossReasons[r.reason] = amt;
      });
      let lossPercent = 0;
      if ((revenue + losses) > 0) {
        lossPercent = Math.round((losses / (revenue + losses)) * 100);
      }
      
      res.json({
        ok: true,
        finance: {
          revenue: revenue, cost: costVal, profit: profit,
          margin_pct: marginPct,
          avg_check: rev.rows[0].count > 0 ? 
            (revenue / rev.rows[0].count) : 0,
          cash: parseFloat(rev.rows[0].cash) || 0,
          card: parseFloat(rev.rows[0].card) || 0,
          qr: parseFloat(rev.rows[0].qr) || 0,
          count: parseInt(rev.rows[0].count) || 0
        },
        losses: { total: losses, percent: lossPercent, reasons: lossReasons },
        top: top.rows,
        abc: abc,
        frozen: frozen.rows,
        movement: {
          receipts: parseFloat(receiptSum.rows[0].total) || 0,
          sales: revenue, writeoffs: losses
        },
        daily: daily.rows
      });
    } catch (e) {
      console.error('Report error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ЭКСПОРТ ОТЧЁТА В CSV ======
  app.get('/api/warehouse/reports/export', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).send('Unauthorized');
      
      const shopId = auth.shopId;
      const start = req.query.start;
      const end = req.query.end;
      
      let fSales = '';
      let pSales = [shopId];
      
      if (start && end) {
        fSales = 'AND s.date >= $2 AND s.date < $3 ';
        let endNext = new Date(end);
        endNext.setDate(endNext.getDate() + 1);
        let endStr = endNext.toISOString().slice(0, 10);
        pSales.push(start, endStr);
      }

      const daily = await pool.query(
        'SELECT DATE(s.date) as day, ' +
        'SUM(s.real_price) as total, ' +
        'SUM((SELECT SUM(si.qty * si.cost_at_sale) ' +
        'FROM wh_sale_items si WHERE si.sale_id = s.id)) as cost, ' +
        'SUM(pay_cash) as cash, SUM(pay_card) as card, ' +
        'SUM(pay_qr) as qr ' +
        'FROM wh_sales s WHERE s.shop_id = $1 ' + fSales +
        'AND s.status = \'active\' ' +
        'GROUP BY DATE(s.date) ORDER BY DATE(s.date) DESC',
        pSales
      );

      let csv = '\uFEFF';
      csv += 'Дата;Выручка;Себестоимость;Прибыль;';
      csv += 'Наличные;Карта;QR\n';

      daily.rows.forEach(function(r) {
        let d = new Date(r.day).toLocaleDateString('ru-RU');
        let rev = parseFloat(r.total) || 0;
        let cost = parseFloat(r.cost) || 0;
        let prof = rev - cost;
        let cash = parseFloat(r.cash) || 0;
        let card = parseFloat(r.card) || 0;
        let qr = parseFloat(r.qr) || 0;

        let revStr = rev.toFixed(2).replace('.', ',');
        let costStr = cost.toFixed(2).replace('.', ',');
        let profStr = prof.toFixed(2).replace('.', ',');
        let cashStr = cash.toFixed(2).replace('.', ',');
        let cardStr = card.toFixed(2).replace('.', ',');
        let qrStr = qr.toFixed(2).replace('.', ',');

        csv += d + ';' + revStr + ';' + costStr + ';';
        csv += profStr + ';' + cashStr + ';' + cardStr + ';';
        csv += qrStr + '\n';
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 
        'attachment; filename="report.csv"');
      res.send(csv);
    } catch (e) {
      console.error('Export error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== СМЕНЫ ======
  app.post('/api/warehouse/shift', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId; 
      const chatId = auth.chatId;
      
      if (req.body.action === 'open') {
        const existing = await pool.query(
          'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
          'AND chat_id = $2 AND status = \'open\' LIMIT 1',
          [shopId, chatId]
        );
        if (existing.rows.length > 0) {
          return res.json({ ok: false, error: 'Смена уже открыта' });
        }
        const startCash = parseFloat(req.body.val) || 0;
        if (startCash < 0) {
          return res.json({ ok: false, error: 'Некорректная сумма' });
        }
        await pool.query(
          'INSERT INTO wh_shifts (shop_id, chat_id, start_cash) ' +
          'VALUES ($1, $2, $3)',
          [shopId, chatId, startCash]
        );
      } else {
        const shiftRes = await pool.query(
          'SELECT id, start_cash, open_time FROM wh_shifts ' +
          'WHERE shop_id = $1 AND chat_id = $2 ' +
          'AND status = \'open\' ORDER BY open_time DESC LIMIT 1',
          [shopId, chatId]
        );
        if (shiftRes.rows.length === 0) {
          return res.json({ ok: false, error: 'Смена не найдена' });
        }
        const shift = shiftRes.rows[0];
        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t FROM wh_sales ' +
          'WHERE shop_id = $1 AND date >= $2 AND status = \'active\'',
          [shopId, shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const total = parseFloat(st.t || 0);
        const expected = parseFloat(shift.start_cash) + cash;
        const actual = parseFloat(req.body.val);
        if (isNaN(actual)) {
          return res.json({ ok: false, error: 'Некорректная сумма' });
        }
        const discrepancy = actual - expected;
        await pool.query(
          'UPDATE wh_shifts SET close_time = NOW(), ' +
          'end_cash_fact = $1, total_sales = $2, ' +
          'cash_sales = $3, card_sales = $4, qr_sales = $5, ' +
          'discrepancy = $6, status = \'closed\' WHERE id = $7',
          [actual, total, cash, parseFloat(st.k || 0),
           parseFloat(st.q || 0), discrepancy, shift.id]
        );
        await logAction(shopId, chatId, 'shift',
          'Закрыта смена. Расхождение: ' + discrepancy);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ФЛОРИСТЫ ======
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const ownerCheck = await pool.query(
        'SELECT role, login FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1',
        [auth.chatId, auth.shopId]
      );
      if (!ownerCheck.rows[0] || 
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ 
          ok: false, error: 'Только владелец' 
        });
      }
      const shopInfo = await pool.query(
        'SELECT invite_code FROM shops WHERE shop_id = $1',
        [auth.shopId]
      );
      const r = await pool.query(
        'SELECT a.name, a.warehouse_pin, a.can_receipt, ' +
        'a.can_sale, a.can_writeoff, a.chat_id, a.role, ' +
        'COALESCE(SUM(s.real_price), 0) as total_sales ' +
        'FROM admins a ' +
        'LEFT JOIN wh_sales s ON a.chat_id = s.chat_id ' +
        'AND s.status = \'active\' ' +
        'WHERE a.shop_id = $1 AND a.role = \'florist\' ' +
        'GROUP BY a.chat_id, a.name, a.warehouse_pin, ' +
        'a.can_receipt, a.can_sale, a.can_writeoff, a.role',
        [auth.shopId]
      );
      res.json({
        ok: true, staff: r.rows,
        inviteCode: shopInfo.rows.length > 0 ? 
          shopInfo.rows[0].invite_code : '',
        ownerLogin: ownerCheck.rows[0].login || ''
      });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1',
        [auth.chatId, auth.shopId]
      );
      if (!ownerCheck.rows[0] || 
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      await pool.query(
        'UPDATE admins SET warehouse_pin = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3',
        [req.body.pin, auth.shopId, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1',
        [auth.chatId, auth.shopId]
      );
      if (!ownerCheck.rows[0] || 
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      var col = req.body.field;
      if (col === 'receipt') col = 'can_receipt';
      if (col === 'sale') col = 'can_sale';
      if (col === 'writeoff') col = 'can_writeoff';
      await pool.query(
        'UPDATE admins SET ' + col + ' = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3',
        [req.body.val, auth.shopId, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/florist/delete', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1',
        [auth.chatId, auth.shopId]
      );
      if (!ownerCheck.rows[0] || 
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      await pool.query(
        'DELETE FROM admins WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND role = \'florist\'',
        [auth.shopId, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== НАСТРОЙКИ ======
  app.get('/api/warehouse/settings', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1',
        [auth.shopId]
      );
      const adm = await pool.query(
        'SELECT login FROM admins WHERE chat_id = $1 LIMIT 1',
        [auth.chatId]
      );
      const currentLogin = adm.rows.length > 0 ? 
        adm.rows[0].login : '';
      res.json({
        ok: true,
        settings: r.rows.length > 0 ? 
          (r.rows[0].settings || {}) : {},
        currentLogin: currentLogin || ''
      });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/settings', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      var obj = {}; obj[req.body.key] = req.body.val;
      await pool.query(
        'UPDATE shops SET settings = ' +
        'COALESCE(settings, \'{}\'::jsonb) || $1::jsonb ' +
        'WHERE shop_id = $2',
        [JSON.stringify(obj), auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/owner/set-password', 
    async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1',
        [auth.chatId, auth.shopId]
      );
      if (!ownerCheck.rows[0] || 
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      if (!login || login.length < 3) {
        return res.json({ ok: false, error: 'Логин от 3 символов' });
      }
      if (!password || password.length < 4) {
        return res.json({ ok: false, error: 'Пароль от 4 символов' });
      }
      const hash = crypto.createHash('sha256')
        .update(password).digest('hex');
      await pool.query(
        'UPDATE admins SET login = $1, password_hash = $2 ' +
        'WHERE chat_id = $3 AND shop_id = $4',
        [login, hash, auth.chatId, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Ошибка сохранения' });
    }
  });

  // ====== ИСТОРИЯ СМЕНЫ ======
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId;
      const targetDate = req.query.date || 
        new Date().toISOString().slice(0, 10);
      const filterChatId = req.query.chat_id;
      let fSales = ''; let fWrites = ''; 
      let fRec = ''; let params = [shopId, targetDate];
      
      if (filterChatId) {
        fSales = 'AND s.chat_id = $3 ';
        fWrites = 'AND w.chat_id = $3 ';
        fRec = 'AND r.chat_id = $3 ';
        params.push(filterChatId);
      }
      
      const sales = await pool.query(
        'SELECT s.id::text, s.real_price as amount, s.date, ' +
        '\'sale\' as type, a.name as person, s.pay_cash, ' +
        's.pay_card, s.pay_qr, ' +
        '(SELECT STRING_AGG(COALESCE(shi.custom_name, ' +
        'i.name) || \' x\' || TRIM(TRAILING \'.\' FROM ' +
        'TRIM(TRAILING \'0\' FROM si.qty::text)), \', \') ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE si.sale_id = s.id AND si.qty > 0) as items ' +
        'FROM wh_sales s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.shop_id = $1 AND s.status = \'active\' ' +
        'AND s.date >= $2::date AND s.date < ($2::date + 1) ' +
        fSales + 'ORDER BY s.date DESC', params
      );
      
      const cancels = await pool.query(
        'SELECT s.id::text, s.real_price as amount, s.date, ' +
        '\'cancel\' as type, a.name as person, s.pay_cash, ' +
        's.pay_card, s.pay_qr, ' +
        '(SELECT STRING_AGG(COALESCE(shi.custom_name, ' +
        'i.name) || \' x\' || TRIM(TRAILING \'.\' FROM ' +
        'TRIM(TRAILING \'0\' FROM si.qty::text)), \', \') ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE si.sale_id = s.id AND si.qty > 0) as items ' +
        'FROM wh_sales s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.shop_id = $1 AND s.status = \'cancelled\' ' +
        'AND s.date >= $2::date AND s.date < ($2::date + 1) ' +
        fSales + 'ORDER BY s.date DESC', params
      );
      
      const writeoffs = await pool.query(
        'SELECT COALESCE(MAX(w.doc_id), MIN(w.id)::text) as id, ' +
        'SUM(w.qty) as amount, ' +
        'DATE_TRUNC(\'minute\', w.date) as date, ' +
        '\'writeoff\' as type, MAX(a.name) as person, ' +
        'MAX(w.reason) as reason, ' +
        'STRING_AGG(COALESCE(shi.custom_name, i.name) || ' +
        '\' x\' || TRIM(TRAILING \'.\' FROM TRIM(TRAILING \'0\' ' +
        'FROM w.qty::text)), \', \') as items ' +
        'FROM wh_writeoffs w ' +
        'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
        'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
        'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE w.shop_id = $1 AND w.date >= $2::date ' +
        'AND w.date < ($2::date + 1) ' + fWrites +
        'GROUP BY COALESCE(w.doc_id, w.id::text), ' +
        'DATE_TRUNC(\'minute\', w.date) ' +
        'ORDER BY DATE_TRUNC(\'minute\', w.date) DESC', params
      );
      
      const receipts = await pool.query(
        'SELECT r.id::text, r.total_sum as amount, r.date, ' +
        '\'receipt\' as type, a.name as person, ' +
        '(SELECT STRING_AGG(COALESCE(shi.custom_name, ' +
        'i.name) || \' x\' || TRIM(TRAILING \'.\' FROM ' +
        'TRIM(TRAILING \'0\' FROM ri.qty::text)), \', \') ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = r.id) as items ' +
        'FROM wh_receipts r ' +
        'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'WHERE r.shop_id = $1 AND r.date >= $2::date ' +
        'AND r.date < ($2::date + 1) ' +
        'AND r.status = \'completed\' ' + fRec +
        'ORDER BY r.date DESC', params
      );
      
      let list = [...sales.rows, ...cancels.rows, 
        ...writeoffs.rows, ...receipts.rows];
      list.sort(function(a, b) {
        return new Date(b.date) - new Date(a.date);
      });
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ДЕТАЛИ ПРОДАЖИ И ВОЗВРАТ ======
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const saleId = parseInt(req.query.id);
      if (!saleId || isNaN(saleId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      const sale = await pool.query(
        'SELECT s.id, s.real_price, s.date, s.status, ' +
        's.pay_cash, s.pay_card, s.pay_qr, ' +
        'a.name as seller FROM wh_sales s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.id = $1 AND s.shop_id = $2',
        [saleId, auth.shopId]
      );
      if (sale.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найдено' });
      }
      const items = await pool.query(
        'SELECT si.qty, si.cost_at_sale, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'shi.id as shop_item_id ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE si.sale_id = $1 AND si.qty > 0', [saleId]
      );
      res.json({
        ok: true, sale: sale.rows[0], items: items.rows
      });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) {
        client.release();
        return res.status(401).json({ ok: false });
      }
      const shopId = auth.shopId;
      const saleId = parseInt(req.body.saleId);
      if (!saleId || isNaN(saleId)) {
        client.release();
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      await client.query('BEGIN');
      const checkSale = await client.query(
        'SELECT status FROM wh_sales WHERE id = $1 ' +
        'AND shop_id = $2', [saleId, shopId]
      );
      if (checkSale.rows.length === 0) {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Чек не найден' });
      }
      if (checkSale.rows[0].status === 'cancelled') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Чек уже отменен' });
      }
      const itemsRes = await client.query(
        'SELECT shop_item_id, qty FROM wh_sale_items ' +
        'WHERE sale_id = $1', [saleId]
      );
      for (let i = 0; i < itemsRes.rows.length; i++) {
        const item = itemsRes.rows[i];
        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock + $1 WHERE id = $2 AND shop_id = $3',
          [item.qty, item.shop_item_id, shopId]
        );
      }
      await client.query(
        'UPDATE wh_sales SET status = \'cancelled\' ' +
        'WHERE id = $1 AND shop_id = $2', [saleId, shopId]
      );
      await client.query('COMMIT');
      client.release();
      await logAction(shopId, auth.chatId, 'cancel',
        'Возврат продажи (Отмена чека): ID ' + saleId, saleId);
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { setupWarehouseApi };