const pool = require('./db');

async function logAction(shopId, chatId, action, details, refId) {
  try {
    await pool.query(
      "INSERT INTO wh_audit_log (shop_id, chat_id, " +
      "action, details, ref_id) VALUES ($1, $2, $3, $4, $5)",
      [shopId, chatId, action, details, refId || null]
    );
  } catch (e) { 
    console.error('Log error:', e.message); 
  }
}

function capWords(str) {
  if (!str) return '';
  return String(str).replace(
    /(^[\p{L}\d])|(\s+[\p{L}\d])/gu,
    function(letter) {
      return letter.toUpperCase();
    }
  );
}

function setupWarehouseStock(app, bot, s3ctx, getAuth) {
  // ====== МИГРАЦИИ ДЛЯ СКЛАДА ======
  // 1. Локальные фото для магазина (чтобы не менять общие wh_items)
  pool.query(
    "ALTER TABLE wh_shop_items ADD COLUMN " +
    "IF NOT EXISTS photo_url VARCHAR(500)"
  ).catch(function(e) { console.error('Migration photo:', e); });

  // 2. Версия остатков для безопасной отмены накладных
  pool.query(
    "ALTER TABLE wh_shop_items ADD COLUMN " +
    "IF NOT EXISTS stock_version INTEGER DEFAULT 0"
  ).catch(function(e) { console.error('Migration ver:', e); });

  // 3. Сохранение старой себестоимости в накладных
  pool.query(
    "ALTER TABLE wh_receipt_items ADD COLUMN " +
    "IF NOT EXISTS prev_avg_cost NUMERIC(10,2)"
  ).catch(function(e) { console.error('Migration avg:', e); });
  
  pool.query(
    "ALTER TABLE wh_receipt_items ADD COLUMN " +
    "IF NOT EXISTS prev_last_cost NUMERIC(10,2)"
  ).catch(function(e) { console.error('Migration last:', e); });

  pool.query(
    "ALTER TABLE wh_receipt_items ADD COLUMN " +
    "IF NOT EXISTS stock_version_after INTEGER"
  ).catch(function(e) { console.error('Migration ver2:', e); });

  // ====== ТОВАРЫ ======
  app.get('/api/warehouse/categories', async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT id, name FROM wh_categories ORDER BY sort_order ASC"
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
      const forRecipe = req.query.for_recipe === 'true';
      
      const shopRes = await pool.query(
        "SELECT settings FROM shops WHERE shop_id = $1",
        [shopId]
      );
      let invView = 'pos';
      if (shopRes.rows.length > 0 && shopRes.rows[0].settings) {
        invView = shopRes.rows[0].settings.inv_view || 'pos';
      }

      let query = 
        "SELECT i.id, i.current_stock, i.retail_price, " +
        "i.last_cost, i.is_pinned, i.avg_cost, i.hidden, " +
        "COALESCE(i.custom_name, w.name) AS name, " +
        "COALESCE(i.photo_url, w.photo_url) AS photo_url, " +
        "w.category_id, w.unit " +
        "FROM wh_shop_items i " +
        "JOIN wh_items w ON w.id = i.item_id " +
        "WHERE i.shop_id = $1 ";
        
      if (!showArchive) {
        query += "AND (i.hidden = FALSE OR i.hidden IS NULL) ";
      }
      
      if (showArchive) {
        query += "AND NOT EXISTS (SELECT 1 FROM wh_bouquet_recipes r " +
                 "WHERE r.shop_item_id = i.id) ";
      } else if (!forRecipe) {
        if (invView === 'pos') {
          query += "AND i.current_stock > 0 ";
        } else if (invView === 'nonzero') {
          query += "AND i.current_stock != 0 ";
        }
      }
      
      query += "ORDER BY i.is_pinned DESC, w.name ASC";
      
      const r = await pool.query(query, [shopId]);
      res.json({ ok: true, items: r.rows });
    } catch (e) {
      console.error('API items:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

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
        "UPDATE wh_shop_items SET retail_price = $1 " +
        "WHERE id = $2 AND shop_id = $3",
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
        "SELECT role FROM admins WHERE chat_id = $1 " +
        "AND shop_id = $2 LIMIT 1", [auth.chatId, auth.shopId]
      );
      if (ownerCheck.rows.length === 0 ||
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }

      const itemId = parseInt(req.body.id);
      const newName = capWords(req.body.name);
      if (!itemId || isNaN(itemId) || !newName || newName.length > 200) {
        return res.json({ ok: false, error: 'Некорректное имя' });
      }

      await pool.query(
        "UPDATE wh_shop_items SET custom_name = $1 " +
        "WHERE id = $2 AND shop_id = $3",
        [newName, itemId, auth.shopId]
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
        "UPDATE wh_shop_items SET is_pinned = $1 " +
        "WHERE id = $2 AND shop_id = $3",
        [val, itemId, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ИСПРАВЛЕНО: Фото теперь пишется в wh_shop_items, а не в общий wh_items
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
        "UPDATE wh_shop_items SET photo_url = $1 " +
        "WHERE id = $2 AND shop_id = $3",
        [url, shopItemId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
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

  // ====== СПИСАНИЯ ======
  app.post('/api/warehouse/writeoff', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const perm = await client.query(
        "SELECT role, can_writeoff FROM admins " +
        "WHERE chat_id = $1 AND shop_id = $2", 
        [auth.chatId, auth.shopId]
      );
      
      if (perm.rows.length === 0 || 
          (perm.rows[0].role !== 'owner' && !perm.rows[0].can_writeoff)) {
        client.release();
        return res.status(403).json({ 
          ok: false, error: 'Нет прав на списание' 
        });
      }
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        client.release(); 
        return res.json({ ok: false, error: 'Список пуст' });
      }

      await client.query('BEGIN');
      const docId = 'WO_' + Date.now() + '_' + 
        Math.floor(Math.random() * 1000);
      let firstId = null;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const qty = parseFloat(String(item.qty).replace(',', '.'));
        
        if (!qty || qty <= 0) continue;

        // Увеличиваем версию остатка
        await client.query(
          "UPDATE wh_shop_items SET current_stock = " +
          "current_stock - $1, stock_version = stock_version + 1 " +
          "WHERE id = $2 AND shop_id = $3", 
          [qty, item.id, shopId]
        );
        
        const ins = await client.query(
          "INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, " +
          "reason, comment, photo_url, chat_id, doc_id, status) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed') " +
          "RETURNING id",
          [shopId, item.id, qty, req.body.reason, 
           req.body.comment, req.body.photo, chatId, docId]
        );
        if (firstId === null) firstId = ins.rows[0].id;
      }

      await client.query('COMMIT');
      client.release();

      const itemName = items[0].name || 'Товар';
      await logAction(shopId, chatId, 'writeoff', 
        'Списание: ' + itemName + ' (и др.)', firstId);

      res.json({ ok: true, doc_id: docId, id: firstId });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/writeoff/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }
      
      const shopId = auth.shopId;
      const docId = String(req.body.id);
      
      if (!docId) { 
        client.release(); 
        return res.json({ ok: false, error: 'Неверный ID' }); 
      }
      
      await client.query('BEGIN');
      
      const items = await client.query(
        "SELECT id, shop_item_id, qty, status FROM wh_writeoffs " +
        "WHERE (doc_id = $1 OR id::text = $1) " +
        "AND shop_id = $2 FOR UPDATE", [docId, shopId]
      );
      
      if (items.rows.length === 0) {
        await client.query('ROLLBACK'); client.release(); 
        return res.json({ ok: false, error: 'Документ не найден' });
      }

      // ИСПРАВЛЕНО: проверяем статус ВСЕХ строк, а не только первой
      let alreadyCancelled = true;
      for (let k = 0; k < items.rows.length; k++) {
        if (items.rows[k].status !== 'cancelled') {
          alreadyCancelled = false;
          break;
        }
      }
      
      if (alreadyCancelled) {
        await client.query('ROLLBACK'); client.release(); 
        return res.json({ ok: false, error: 'Списание уже отменено' });
      }

      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        if (item.shop_item_id && item.status === 'completed') {
          await client.query(
            "UPDATE wh_shop_items SET current_stock = " +
            "current_stock + $1, stock_version = stock_version + 1 " +
            "WHERE id = $2 AND shop_id = $3",
            [item.qty, item.shop_item_id, shopId]
          );
        }
      }
      
      await client.query(
        "UPDATE wh_writeoffs SET status = 'cancelled' " +
        "WHERE (doc_id = $1 OR id::text = $1) AND shop_id = $2", 
        [docId, shopId]
      );
      
      await client.query('COMMIT');
      client.release();
      
      await logAction(shopId, auth.chatId, 'writeoff_cancel', 
        'Отмена списания №' + docId, docId);
        
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ПОСТАВЩИКИ ======
  app.get('/api/warehouse/suppliers', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        "SELECT id, name FROM wh_suppliers " +
        "WHERE shop_id = $1 ORDER BY name ASC", [auth.shopId]
      );
      res.json({ ok: true, suppliers: r.rows });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/suppliers/create', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const name = String(req.body.name || '').trim();
      if (!name) return res.json({ ok: false, error: 'Введите имя' });
      
      const r = await pool.query(
        "INSERT INTO wh_suppliers (shop_id, name) " +
        "VALUES ($1, $2) RETURNING id, name", [auth.shopId, name]
      );
      res.json({ ok: true, id: r.rows[0].id, supplier: r.rows[0] });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.post('/api/warehouse/suppliers/rename', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const id = parseInt(req.body.id);
      const name = String(req.body.name || '').trim();
      if (!id || isNaN(id) || !name) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      await pool.query(
        "UPDATE wh_suppliers SET name = $1 " +
        "WHERE id = $2 AND shop_id = $3", 
        [name, id, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.post('/api/warehouse/suppliers/delete', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const id = parseInt(req.body.id);
      if (!id || isNaN(id)) return res.json({ ok: false });
      
      await pool.query(
        "UPDATE wh_receipts SET supplier_id = NULL " +
        "WHERE supplier_id = $1 AND shop_id = $2", 
        [id, auth.shopId]
      );
      
      await pool.query(
        "DELETE FROM wh_suppliers WHERE id = $1 AND shop_id = $2", 
        [id, auth.shopId]
      );
      
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

// ====== НАКЛАДНЫЕ (ПРИХОДЫ) ======
  app.get('/api/warehouse/receipts', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const supplierId = req.query.supplier_id;
      let query = 
        "SELECT r.id, r.date, r.updated_at, r.total_sum, r.status, " +
        "r.supplier_id, s.name as supplier_name, a.name as author " +
        "FROM wh_receipts r " +
        "LEFT JOIN wh_suppliers s ON s.id = r.supplier_id " +
        "LEFT JOIN admins a ON a.chat_id = r.chat_id " +
        "AND a.shop_id = r.shop_id " + // Фикс JOIN
        "WHERE r.shop_id = $1 ";
        
      let params = [auth.shopId];
      
      if (supplierId) {
        query += "AND r.supplier_id = $2 ";
        params.push(supplierId);
      }
      
      query += "ORDER BY r.date DESC LIMIT 50";
      
      const r = await pool.query(query, params);
      res.json({ ok: true, docs: r.rows });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/receipt/delete', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const receiptId = parseInt(req.body.id);
      if (!receiptId || isNaN(receiptId)) {
        client.release(); return res.json({ ok: false });
      }
      
      await client.query('BEGIN');
      const r = await client.query(
        "SELECT status FROM wh_receipts " +
        "WHERE id = $1 AND shop_id = $2 FOR UPDATE", 
        [receiptId, auth.shopId]
      );
      
      if (r.rows.length === 0 || r.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Только черновики' });
      }
      
      await client.query(
        "DELETE FROM wh_receipt_items WHERE receipt_id = $1", 
        [receiptId]
      );
      
      await client.query(
        "DELETE FROM wh_receipts WHERE id = $1 AND shop_id = $2", 
        [receiptId, auth.shopId]
      );
      
      await client.query('COMMIT');
      client.release();
      
      await logAction(auth.shopId, auth.chatId, 'receipt_delete', 
        'Удален черновик накладной №' + receiptId, receiptId);
        
      res.json({ ok: true });
    } catch (e) { 
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      res.status(500).json({ ok: false }); 
    }
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
        "SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, " +
        "ri.shop_item_id, shi.retail_price, " +
        "COALESCE(shi.custom_name, i.name) as name " +
        "FROM wh_receipt_items ri " +
        "JOIN wh_receipts r ON r.id = ri.receipt_id " +
        "JOIN wh_shop_items shi ON shi.id = ri.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE ri.receipt_id = $1 AND r.shop_id = $2", 
        [receiptId, auth.shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/receipt/item/add', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const shopId = auth.shopId;
      const receiptId = parseInt(req.body.receipt_id);
      if (!receiptId || isNaN(receiptId)) {
        client.release(); return res.json({ ok: false, error: 'Неверный ID' });
      }

      await client.query('BEGIN');
      const checkR = await client.query(
        "SELECT status FROM wh_receipts " +
        "WHERE id = $1 AND shop_id = $2 FOR UPDATE", [receiptId, shopId]
      );
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Накладная не черновик' });
      }

      const name = capWords(String(req.body.name || '').trim());
      const numQty = parseFloat(String(req.body.qty).replace(',', '.'));
      const numPrice = parseFloat(String(req.body.price).replace(',', '.'));
      const numRetail = parseFloat(String(req.body.retail).replace(',', '.')) || 0;

      if (!name || isNaN(numQty) || isNaN(numPrice) || 
          numQty <= 0 || numPrice <= 0) {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      const catId = req.body.cat_id ? parseInt(req.body.cat_id) : null;
      const unit = req.body.unit || 'шт';
      const photoUrl = req.body.photo_url || null;

      let itemRes = await client.query(
        "SELECT id FROM wh_items WHERE name = $1", [name]
      );
      let itemId;
      
      if (itemRes.rows.length === 0) {
        const ni = await client.query(
          "INSERT INTO wh_items (name, unit, category_id) " +
          "VALUES ($1, $2, $3) RETURNING id",
          [name, unit, catId]
        );
        itemId = ni.rows[0].id;
      } else {
        itemId = itemRes.rows[0].id;
      }

      let shopItemRes = await client.query(
        "SELECT id FROM wh_shop_items " +
        "WHERE shop_id = $1 AND item_id = $2", 
        [shopId, itemId]
      );
      let shopItemId;
      
      if (shopItemRes.rows.length === 0) {
        const nsi = await client.query(
          "INSERT INTO wh_shop_items (shop_id, item_id, photo_url) " +
          "VALUES ($1, $2, $3) RETURNING id", 
          [shopId, itemId, photoUrl]
        );
        shopItemId = nsi.rows[0].id;
      } else { 
        shopItemId = shopItemRes.rows[0].id; 
        if (photoUrl) {
          await client.query(
            "UPDATE wh_shop_items SET photo_url = $1 WHERE id = $2", 
            [photoUrl, shopItemId]
          );
        }
      }

      const sum = Math.round(numQty * numPrice * 100) / 100;

      const existing = await client.query(
        "SELECT id, qty, sum FROM wh_receipt_items " +
        "WHERE receipt_id = $1 AND shop_item_id = $2", 
        [receiptId, shopItemId]
      );
      
      if (existing.rows.length > 0) {
        const ex = existing.rows[0];
        const exQty = parseFloat(ex.qty); 
        const exSum = parseFloat(ex.sum);
        const newQty = exQty + numQty; 
        const newSum = exSum + sum;
        const newAvg = Math.round((newSum / newQty) * 100) / 100;
        
        await client.query(
          "UPDATE wh_receipt_items SET qty = $1, sum = $2, " +
          "unit_cost = $3 WHERE id = $4", 
          [newQty, newSum, newAvg, ex.id]
        );
      } else {
        await client.query(
          "INSERT INTO wh_receipt_items (receipt_id, shop_item_id, " +
          "qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)", 
          [receiptId, shopItemId, numQty, numPrice, sum]
        );
      }

      await client.query(
        "UPDATE wh_receipts SET total_sum = total_sum + $1, " +
        "updated_at = NOW() WHERE id = $2", [sum, receiptId]
      );
      
      if (numRetail > 0) {
        await client.query(
          "UPDATE wh_shop_items SET retail_price = $1 " +
          "WHERE id = $2 AND shop_id = $3", 
          [numRetail, shopItemId, shopId]
        );
      }

      await client.query('COMMIT');
      client.release();

      const items = await pool.query(
        "SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, " +
        "ri.shop_item_id, shi.retail_price, " +
        "COALESCE(shi.custom_name, i.name) as name " +
        "FROM wh_receipt_items ri " +
        "JOIN wh_shop_items shi ON shi.id = ri.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE ri.receipt_id = $1", [receiptId]
      );
      res.json({ ok: true, items: items.rows });
    } catch (e) { 
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.post('/api/warehouse/receipt/save-all', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const shopId = auth.shopId;
      const receiptId = parseInt(req.body.receipt_id);
      const items = req.body.items;
      const supplierId = req.body.supplier_id ? parseInt(req.body.supplier_id) : null;
      
      if (!receiptId || isNaN(receiptId) || !Array.isArray(items)) {
        client.release(); return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      const checkR = await client.query(
        "SELECT status FROM wh_receipts " +
        "WHERE id = $1 AND shop_id = $2 FOR UPDATE", [receiptId, shopId]
      );
      
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Накладная не найдена или уже проведена' });
      }

      if (supplierId) {
        const supCheck = await client.query(
          "SELECT id FROM wh_suppliers WHERE id = $1 AND shop_id = $2",
          [supplierId, shopId]
        );
        if (supCheck.rows.length === 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Чужой поставщик' });
        }
      }

      // Объединяем дубли товаров перед проведением
      const aggItems = {};
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const sid = parseInt(it.shop_item_id);
        if (!sid) continue;
        if (!aggItems[sid]) {
          aggItems[sid] = { shop_item_id: sid, qty: 0, sum: 0, unit_cost: 0 };
        }
        const q = parseFloat(String(it.qty).replace(',', '.')) || 0;
        const p = parseFloat(String(it.unit_cost).replace(',', '.')) || 0;
        aggItems[sid].qty += q;
        aggItems[sid].sum += (q * p);
      }
      
      const finalItems = Object.values(aggItems);
      
      await client.query(
        "DELETE FROM wh_receipt_items WHERE receipt_id = $1", [receiptId]
      );

      let totalSum = 0;
      for (let i = 0; i < finalItems.length; i++) {
        const it = finalItems[i];
        
        // Проверка принадлежности товара
        const itemCheck = await client.query(
          "SELECT id FROM wh_shop_items WHERE id = $1 AND shop_id = $2",
          [it.shop_item_id, shopId]
        );
        if (itemCheck.rows.length === 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Чужой товар в накладной' });
        }

        const qty = it.qty;
        const sum = Math.round(it.sum * 100) / 100;
        const price = qty > 0 ? Math.round((sum / qty) * 100) / 100 : 0;
        totalSum += sum;

        await client.query(
          "INSERT INTO wh_receipt_items (receipt_id, shop_item_id, " +
          "qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)",
          [receiptId, it.shop_item_id, qty, price, sum]
        );
      }
      
      await client.query(
        "UPDATE wh_receipts SET total_sum = $1, supplier_id = $2 " +
        "WHERE id = $3 AND shop_id = $4", [totalSum, supplierId, receiptId, shopId]
      );

      for (let i = 0; i < finalItems.length; i++) {
        const it = finalItems[i];
        const qty = it.qty;
        const price = qty > 0 ? Math.round((it.sum / qty) * 100) / 100 : 0;

        const curr = await client.query(
          "SELECT current_stock, avg_cost, last_cost, stock_version " +
          "FROM wh_shop_items WHERE id = $1 AND shop_id = $2 FOR UPDATE", 
          [it.shop_item_id, shopId]
        );
        
        let oldStock = parseFloat(curr.rows[0].current_stock) || 0;
        let oldAvg = parseFloat(curr.rows[0].avg_cost) || 0;
        let oldLast = parseFloat(curr.rows[0].last_cost) || 0;
        let oldVer = parseInt(curr.rows[0].stock_version) || 0;

        let newStock = oldStock + qty;
        let newAvg = 0;
        
        if (newStock > 0) {
          if (oldStock <= 0) {
            // Фикс: если ушли в минус, новая себестоимость = цена закупки
            newAvg = price;
          } else {
            newAvg = (oldStock * oldAvg + qty * price) / newStock;
            newAvg = Math.round(newAvg * 100) / 100;
          }
        } else {
          newAvg = 0;
        }

        const newVer = oldVer + 1;

        await client.query(
          "UPDATE wh_shop_items SET current_stock = $1, " +
          "last_cost = $2, avg_cost = $3, stock_version = $4 WHERE id = $5",
          [newStock, price, newAvg, newVer, it.shop_item_id]
        );
        
        await client.query(
          "UPDATE wh_receipt_items SET " +
          "prev_avg_cost = $1, prev_last_cost = $2, stock_version_after = $3 " +
          "WHERE receipt_id = $4 AND shop_item_id = $5",
          [oldAvg, oldLast, newVer, receiptId, it.shop_item_id]
        );
      }

      await client.query(
        "UPDATE wh_receipts SET status = 'completed', " +
        "updated_at = NOW() WHERE id = $1 AND shop_id = $2", [receiptId, shopId]
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

  app.post('/api/warehouse/receipt/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const shopId = auth.shopId;
      const receiptId = parseInt(req.body.id);
      
      if (!receiptId || isNaN(receiptId)) { 
        client.release(); return res.json({ ok: false, error: 'Неверный ID' }); 
      }
      
      await client.query('BEGIN');
      const checkR = await client.query(
        "SELECT status FROM wh_receipts " +
        "WHERE id = $1 AND shop_id = $2 FOR UPDATE", [receiptId, shopId]
      );
      
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'completed') {
        await client.query('ROLLBACK'); client.release(); 
        return res.json({ ok: false, error: 'Накладная не найдена или не проведена' });
      }

      const items = await client.query(
        "SELECT shop_item_id, qty, prev_avg_cost, prev_last_cost, stock_version_after " +
        "FROM wh_receipt_items WHERE receipt_id = $1", [receiptId]
      );
      
      // Сначала проверяем все позиции на актуальность версии
      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        const curr = await client.query(
          "SELECT stock_version FROM wh_shop_items WHERE id = $1 AND shop_id = $2",
          [item.shop_item_id, shopId]
        );
        
        if (curr.rows.length === 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Товар удален' });
        }
        
        const currVer = parseInt(curr.rows[0].stock_version) || 0;
        const savedVer = parseInt(item.stock_version_after) || 0;
        
        if (currVer !== savedVer) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ 
            ok: false, 
            error: 'Нельзя отменить: после прихода были другие операции с товаром' 
          });
        }
      }

      // Восстанавливаем остатки, версии и себестоимость
      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        await client.query(
          "UPDATE wh_shop_items SET " +
          "current_stock = current_stock - $1, " +
          "avg_cost = $2, " +
          "last_cost = $3, " +
          "stock_version = stock_version + 1 " +
          "WHERE id = $4 AND shop_id = $5",
          [item.qty, item.prev_avg_cost, item.prev_last_cost, 
           item.shop_item_id, shopId]
        );
      }
      
      await client.query(
        "UPDATE wh_receipts SET status = 'draft', " +
        "updated_at = NOW() WHERE id = $1 AND shop_id = $2", 
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

  // ====== БУКЕТЫ ======
  app.get('/api/warehouse/bouquets', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      
      const r = await pool.query(
        "SELECT b.id, b.name, b.price, b.photos, b.preorder_only, " +
        "r.shop_item_id, r.qty as recipe_qty, r.alternatives, " +
        "i.current_stock " +
        "FROM bouquets b " +
        "LEFT JOIN wh_bouquet_recipes r ON r.bouquet_id = b.id " +
        "LEFT JOIN wh_shop_items i ON i.id = r.shop_item_id AND i.shop_id = b.shop_id " +
        "WHERE b.shop_id = $1 AND b.wh_linked = TRUE " +
        "AND b.deleted = FALSE", [shopId]
      );
      
      let bouquetsMap = {};
      for (const row of r.rows) {
        if (!bouquetsMap[row.id]) {
          bouquetsMap[row.id] = {
            id: row.id, name: row.name, price: row.price,
            photos: row.photos, all_in_stock: true,
            preorder_only: row.preorder_only
          };
        }
        
        if (row.shop_item_id) {
          let totalStock = parseFloat(row.current_stock) || 0;
          
          if (row.alternatives && row.alternatives.length > 0) {
            const altIds = row.alternatives.map(function(a) { 
              return typeof a === 'object' ? a.shop_item_id : a; 
            });
            // Фикс: проверяем принадлежность альтернатив магазину
            const altRes = await pool.query(
              "SELECT COALESCE(SUM(current_stock), 0) as total " +
              "FROM wh_shop_items WHERE id = ANY($1) AND shop_id = $2", 
              [altIds, shopId]
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
          photo_url: photoUrl, all_in_stock: b.all_in_stock,
          preorder_only: b.preorder_only
        };
      });
      
      res.json({ ok: true, bouquets: result });
    } catch (e) { 
      console.error('API bouquets:', e.message);
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

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
        "SELECT wh_linked FROM bouquets " +
        "WHERE id = $1 AND shop_id = $2", [bouquetId, shopId]
      );
      
      if (checkB.rows.length === 0 || !checkB.rows[0].wh_linked) {
        return res.json({ ok: false, error: 'Не связан со складом' });
      }
      
      const r = await pool.query(
        "SELECT r.shop_item_id, r.qty, r.alternatives, " +
        "i.current_stock, i.retail_price, " +
        "COALESCE(i.custom_name, w.name) AS name " +
        "FROM wh_bouquet_recipes r " +
        "JOIN wh_shop_items i ON i.id = r.shop_item_id " +
        "JOIN wh_items w ON w.id = i.item_id " +
        "WHERE r.bouquet_id = $1 AND i.shop_id = $2", [bouquetId, shopId]
      );
      
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Рецепт пуст' });
      }

      let ingredients = [];
      for (const it of r.rows) {
        let altsData = [];
        if (it.alternatives && it.alternatives.length > 0) {
           const altIds = it.alternatives.map(function(a) { 
             return typeof a === 'object' ? a.shop_item_id : a; 
           });
           // Фикс: проверяем магазин
           const altQuery = await pool.query(
             "SELECT i.id, i.current_stock, i.retail_price, " +
             "COALESCE(i.custom_name, w.name) AS name " +
             "FROM wh_shop_items i " +
             "JOIN wh_items w ON w.id = i.item_id " +
             "WHERE i.id = ANY($1) AND i.shop_id = $2", [altIds, shopId]
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
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.get('/api/warehouse/bouquets/all', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const r = await pool.query(
        "SELECT b.id, b.name, b.price, b.photos, b.wh_linked, " +
        "b.deleted, b.preorder_only, " +
        "(SELECT STRING_AGG(COALESCE(shi.custom_name, i.name) " +
        "|| ' x' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' " +
        "FROM rcp.qty::text)), ', ') " +
        "FROM wh_bouquet_recipes rcp " +
        "JOIN wh_shop_items shi ON shi.id = rcp.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE rcp.bouquet_id = b.id) as recipe_text " +
        "FROM bouquets b WHERE b.shop_id = $1 ORDER BY b.name ASC",
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
          recipe_text: b.recipe_text, deleted: b.deleted,
          preorder_only: b.preorder_only
        };
      });
      res.json({ ok: true, bouquets: result });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.post('/api/warehouse/bouquet/toggle', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const bId = parseInt(req.body.id);
      const val = req.body.val === true;
      
      if (!bId || isNaN(bId)) return res.json({ ok: false });
      
      await pool.query(
        "UPDATE bouquets SET wh_linked = $1 " +
        "WHERE id = $2 AND shop_id = $3",
        [val, bId, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/delete', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      await pool.query(
        "UPDATE bouquets SET deleted = TRUE " +
        "WHERE id = $1 AND shop_id = $2",
        [req.body.id, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.post('/api/warehouse/bouquet/restore', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      await pool.query(
        "UPDATE bouquets SET deleted = FALSE " +
        "WHERE id = $1 AND shop_id = $2",
        [req.body.id, auth.shopId]
      );
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.get('/api/warehouse/bouquets/info', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        "SELECT id, name, price, photos, wh_linked, preorder_only " +
        "FROM bouquets WHERE id = $1 AND shop_id = $2",
        [req.query.id, auth.shopId]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      res.json({ ok: true, bouquet: r.rows[0] });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/save', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const bId = parseInt(req.body.id) || 0;
      const name = String(req.body.name || '').trim();
      const price = parseFloat(
        String(req.body.price).replace(',', '.')
      );
      const photoUrl = req.body.photo_url;
      const isLinked = req.body.is_linked === true;
      const isPreorder = req.body.is_preorder === true;
      
      if (!name || !price || price <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      let photos = []; 
      if (photoUrl) { photos.push(photoUrl); }
      let finalId = bId;

      if (bId > 0) {
        if (photoUrl) {
          await pool.query(
            "UPDATE bouquets SET name = $1, price = $2, photos = $3, " +
            "wh_linked = $4, preorder_only = $5 WHERE id = $6 " +
            "AND shop_id = $7",
            [name, price, JSON.stringify(photos), isLinked, 
             isPreorder, bId, auth.shopId]
          );
        } else {
          await pool.query(
            "UPDATE bouquets SET name = $1, price = $2, wh_linked = $3, " +
            "preorder_only = $4 WHERE id = $5 AND shop_id = $6",
            [name, price, isLinked, isPreorder, bId, auth.shopId]
          );
        }
      } else {
        const ins = await pool.query(
          "INSERT INTO bouquets (shop_id, shop_number, name, price, " +
          "photos, chat_id, confirmed_at, wh_linked, preorder_only, " +
          "deleted) " +
          "SELECT $1::varchar, COALESCE(MAX(shop_number), 0) + 1, $2, $3, " +
          "$4::jsonb, $5, NOW(), $6, $7, FALSE " +
          "FROM bouquets WHERE shop_id = $1::varchar " +
          "RETURNING id",
          [auth.shopId, name, price, 
           JSON.stringify(photos), auth.chatId, isLinked, isPreorder]
        );
        finalId = ins.rows[0].id;
      }
      res.json({ ok: true, id: finalId });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  app.get('/api/warehouse/bouquets/recipe', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        "SELECT r.id, r.shop_item_id, r.qty, r.alternatives, " +
        "COALESCE(shi.custom_name, i.name) as name, " +
        "i.unit, shi.current_stock FROM wh_bouquet_recipes r " +
        "JOIN wh_shop_items shi ON shi.id = r.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE r.bouquet_id = $1 AND shi.shop_id = $2 ORDER BY r.id ASC",
        [req.query.id, auth.shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquets/recipe/save', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const bId = parseInt(req.body.bouquet_id);
      const items = req.body.items;
      if (!bId || !Array.isArray(items)) {
        client.release(); return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      
      // Фикс изоляции: проверяем, что букет наш
      const bCheck = await client.query(
        "SELECT id FROM bouquets WHERE id = $1 AND shop_id = $2 FOR UPDATE",
        [bId, auth.shopId]
      );
      if (bCheck.rows.length === 0) {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Букет не найден' });
      }

      await client.query(
        "DELETE FROM wh_bouquet_recipes WHERE bouquet_id = $1", [bId]
      );
      
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = parseFloat(String(it.qty).replace(',', '.'));
        const alts = Array.isArray(it.alternatives) ? it.alternatives : [];
        
        // Фикс изоляции: проверяем, что товар наш
        const shopItemCheck = await client.query(
          "SELECT id FROM wh_shop_items WHERE id = $1 AND shop_id = $2",
          [it.shop_item_id, auth.shopId]
        );
        if (shopItemCheck.rows.length === 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Чужой ингредиент' });
        }

        // Проверка альтернатив
        if (alts.length > 0) {
          for (let k = 0; k < alts.length; k++) {
            const altId = typeof alts[k] === 'object' ? alts[k].shop_item_id : alts[k];
            const altCheck = await client.query(
              "SELECT id FROM wh_shop_items WHERE id = $1 AND shop_id = $2",
              [altId, auth.shopId]
            );
            if (altCheck.rows.length === 0) {
              await client.query('ROLLBACK'); client.release();
              return res.json({ ok: false, error: 'Чужая альтернатива' });
            }
          }
        }
        
        await client.query(
          "INSERT INTO wh_bouquet_recipes " +
          "(bouquet_id, shop_item_id, qty, alternatives) " +
          "VALUES ($1, $2, $3, $4)", 
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
}

module.exports = { setupWarehouseStock, logAction, capWords };
