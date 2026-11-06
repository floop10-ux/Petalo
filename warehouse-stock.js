const pool = require('./db');
const crypto = require('crypto');

async function logAction(shopId, chatId, action, details, refId) {
  try {
    await pool.query(
      'INSERT INTO wh_audit_log (shop_id, chat_id, ' +
      'action, details, ref_id) VALUES ($1, $2, $3, $4, $5)',
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

function isValidUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string' || urlStr.length > 500) {
    return false;
  }
  try {
    const u = new URL(urlStr);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function parseStrictFloat(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).replace(',', '.').trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function parseStrictInt(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = parseInt(str, 10);
  return Number.isSafeInteger(num) ? num : null;
}

function maxFlow(capacity, source, sink) {
  var n = capacity.length;
  var flow = 0;
  var parent = new Array(n);
  
  while (true) {
    for (var i = 0; i < n; i++) parent[i] = -1;
    parent[source] = source;
    var queue = [source];
    var head = 0;
    
    while (head < queue.length) {
      var u = queue[head++];
      for (var v = 0; v < n; v++) {
        if (parent[v] === -1 && capacity[u][v] > 1e-9) {
          parent[v] = u;
          queue.push(v);
          if (v === sink) break;
        }
      }
      if (parent[sink] !== -1) break;
    }
    
    if (parent[sink] === -1) break;
    
    var pathFlow = Infinity;
    var v2 = sink;
    while (v2 !== source) {
      var u2 = parent[v2];
      pathFlow = Math.min(pathFlow, capacity[u2][v2]);
      v2 = u2;
    }
    
    v2 = sink;
    while (v2 !== source) {
      var u3 = parent[v2];
      capacity[u3][v2] -= pathFlow;
      capacity[v2][u3] += pathFlow;
      v2 = u3;
    }
    
    flow += pathFlow;
  }
  
  return flow;
}

function canAssembleBouquet(ingredients, initialStock) {
  var itemIdSet = {};
  var i, j;
  
  for (i = 0; i < ingredients.length; i++) {
    var ing = ingredients[i];
    if (ing.shop_item_id) itemIdSet[ing.shop_item_id] = true;
    if (ing.alternatives) {
      for (j = 0; j < ing.alternatives.length; j++) {
        itemIdSet[ing.alternatives[j]] = true;
      }
    }
  }
  
  var itemIds = Object.keys(itemIdSet);
  var itemIndex = {};
  for (i = 0; i < itemIds.length; i++) {
    itemIndex[itemIds[i]] = i;
  }
  
  var numItems = itemIds.length;
  var numIngredients = ingredients.length;
  var V = numItems + numIngredients + 2;
  var S = V - 2;
  var T = V - 1;
  
  var capacity = [];
  for (i = 0; i < V; i++) {
    capacity.push(new Array(V).fill(0));
  }
  
  var totalNeeded = 0;
  for (i = 0; i < numItems; i++) {
    var id = itemIds[i];
    var stock = Math.max(0, parseFloat(initialStock[id]) || 0);
    capacity[S][i] = stock;
  }
  
  for (i = 0; i < numIngredients; i++) {
    var ing2 = ingredients[i];
    var ingNode = numItems + i;
    var need = ing2.qty;
    totalNeeded += need;
    capacity[ingNode][T] = need;
    
    if (ing2.shop_item_id) {
      var mainIdx = itemIndex[ing2.shop_item_id];
      if (mainIdx !== undefined) {
        capacity[mainIdx][ingNode] = totalNeeded;
      }
    }
    
    if (ing2.alternatives) {
      for (j = 0; j < ing2.alternatives.length; j++) {
        var altId = ing2.alternatives[j];
        var altIdx = itemIndex[altId];
        if (altIdx !== undefined) {
          capacity[altIdx][ingNode] = totalNeeded;
        }
      }
    }
  }
  
  var maxFlowValue = maxFlow(capacity, S, T);
  return maxFlowValue >= totalNeeded - 1e-6;
}

function setupWarehouseStock(app, bot, s3ctx, getAuth) {
  pool.query(
    'ALTER TABLE wh_shop_items ADD COLUMN ' +
    'IF NOT EXISTS photo_url VARCHAR(500)'
  ).catch(function(e) { console.error('Migration photo:', e); });

  pool.query(
    'ALTER TABLE wh_shop_items ADD COLUMN ' +
    'IF NOT EXISTS stock_version INTEGER DEFAULT 0'
  ).catch(function(e) { console.error('Migration ver:', e); });

  pool.query(
    'ALTER TABLE wh_receipt_items ADD COLUMN ' +
    'IF NOT EXISTS prev_avg_cost NUMERIC(10,2)'
  ).catch(function(e) { console.error('Migration avg:', e); });
  
  pool.query(
    'ALTER TABLE wh_receipt_items ADD COLUMN ' +
    'IF NOT EXISTS prev_last_cost NUMERIC(10,2)'
  ).catch(function(e) { console.error('Migration last:', e); });

  pool.query(
    'ALTER TABLE wh_receipt_items ADD COLUMN ' +
    'IF NOT EXISTS stock_version_after INTEGER'
  ).catch(function(e) { console.error('Migration ver2:', e); });

  pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS ' +
    'idx_wh_shop_items_shop_item ON wh_shop_items(shop_id, item_id)'
  ).catch(function(e) { console.error('Migration idx_shop_item:', e); });

  pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS ' +
    'idx_bouquets_shop_number ON bouquets(shop_id, shop_number)'
  ).catch(function(e) { 
    console.error('Migration idx_shop_number:', e.message); 
  });

  (async function() {
    try {
      await pool.query(
        'DROP INDEX IF EXISTS idx_wh_items_name_unit_cat'
      );
      console.log('Drop old idx_items: OK');
    } catch (e) {
      console.error('Drop old idx_items:', e.message);
    }
    try {
      await pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS ' +
        'idx_wh_items_name_unit_cat ON wh_items(' +
        'name, unit, COALESCE(category_id, -1))'
      );
      console.log('Migration idx_items_name_unit: OK');
    } catch (e) {
      console.error('Migration idx_items_name_unit:', e.message);
    }
  })();

  app.get('/api/warehouse/categories', async function(req, res) {
    try {
      const r = await pool.query(
        'SELECT id, name FROM wh_categories ORDER BY sort_order ASC'
      );
      res.json({ ok: true, categories: r.rows });
    } catch (e) { 
      console.error('Categories:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.get('/api/warehouse/items', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const showArchive = req.query.show_archive === 'true';
      const forRecipe = req.query.for_recipe === 'true';
      
      const shopRes = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1',
        [shopId]
      );
      let invView = 'pos';
      if (shopRes.rows.length > 0 && shopRes.rows[0].settings) {
        invView = shopRes.rows[0].settings.inv_view || 'pos';
      }

      let query = 
        'SELECT i.id, i.current_stock, i.retail_price, ' +
        'i.last_cost, i.is_pinned, i.avg_cost, i.hidden, ' +
        'COALESCE(i.custom_name, w.name) AS name, ' +
        'COALESCE(i.photo_url, w.photo_url) AS photo_url, ' +
        'w.category_id, w.unit ' +
        'FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 ';
        
      if (!showArchive) {
        query += 'AND (i.hidden = FALSE OR i.hidden IS NULL) ';
      }
      
      if (showArchive) {
        query += 'AND NOT EXISTS (SELECT 1 FROM wh_bouquet_recipes r ' +
                 'WHERE r.shop_item_id = i.id) ';
      } else if (!forRecipe) {
        if (invView === 'pos') {
          query += 'AND i.current_stock > 0 ';
        } else if (invView === 'nonzero') {
          query += 'AND i.current_stock != 0 ';
        }
      }
      
      query += 'ORDER BY i.is_pinned DESC, w.name ASC';
      
      const r = await pool.query(query, [shopId]);
      res.json({ ok: true, items: r.rows });
    } catch (e) {
      console.error('API items:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/item/set-price', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const itemId = parseStrictInt(req.body.id);
      const price = parseStrictFloat(req.body.price);
      
      if (!itemId || price === null || price <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      const r = await pool.query(
        'UPDATE wh_shop_items SET retail_price = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [price, itemId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      
      await logAction(auth.shopId, auth.chatId, 'set_price', 
        'Цена ' + price + ' ₽ для ID: ' + itemId, itemId);
        
      res.json({ ok: true });
    } catch (e) { 
      console.error('Set price:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/item/rename', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1', [auth.chatId, auth.shopId]
      );
      if (ownerCheck.rows.length === 0 ||
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }

      const itemId = parseStrictInt(req.body.id);
      const newName = capWords(req.body.name);
      if (!itemId || !newName || newName.length > 200) {
        return res.json({ ok: false, error: 'Некорректное имя' });
      }

      const r = await pool.query(
        'UPDATE wh_shop_items SET custom_name = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [newName, itemId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      
      await logAction(auth.shopId, auth.chatId, 'rename', 
        'Переименование в: ' + newName, itemId);
      res.json({ ok: true });
    } catch (e) {
      console.error('Rename:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/item/pin', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const itemId = parseStrictInt(req.body.id);
      const val = req.body.val === true;
      if (!itemId) return res.json({ ok: false });
      
      const r = await pool.query(
        'UPDATE wh_shop_items SET is_pinned = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [val, itemId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      res.json({ ok: true });
    } catch (e) { 
      console.error('Pin:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/item/set-photo', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopItemId = parseStrictInt(req.body.id);
      const url = String(req.body.url || '');
      
      if (!shopItemId || !isValidUrl(url)) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      const r = await pool.query(
        'UPDATE wh_shop_items SET photo_url = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [url, shopItemId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      
      res.json({ ok: true });
    } catch (e) { 
      console.error('Set photo:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/upload', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const s3 = s3ctx.s3;
      const s3backup = s3ctx.s3backup;
      const YC_BUCKET = s3ctx.YC_BUCKET;
      const BC_BUCKET = s3ctx.BC_BUCKET;
      const BC_ENDPOINT = s3ctx.BC_ENDPOINT;

      if (!s3) {
        return res.status(503).json({ ok: false, error: 'S3 нет' });
      }
      
      const base64Data = req.body.image;
      if (!base64Data || !base64Data.includes(';base64,')) {
        return res.json({ ok: false, error: 'Неверный формат' });
      }
      
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      
      if (buffer.length > 10 * 1024 * 1024) {
        return res.json({ ok: false, error: 'Фото > 10 МБ' });
      }

      if (buffer.length < 3 || buffer[0] !== 0xFF || 
          buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
        return res.json({ ok: false, error: 'Только JPEG' });
      }
      
      const key = 'wh_' + crypto.randomBytes(8).toString('hex') 
        + '.jpg';
      
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
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/writeoff', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const perm = await client.query(
        'SELECT role, can_writeoff FROM admins ' +
        'WHERE chat_id = $1 AND shop_id = $2', 
        [auth.chatId, auth.shopId]
      );
      
      if (perm.rows.length === 0 || 
          (perm.rows[0].role !== 'owner' && 
           !perm.rows[0].can_writeoff)) {
        return res.status(403).json({ 
          ok: false, error: 'Нет прав на списание' 
        });
      }
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0 ||
          items.length > 100) {
        return res.json({ ok: false, error: 'Список пуст' });
      }

      const validItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = parseStrictInt(item.id);
        const qty = parseStrictFloat(item.qty);
        
        if (!itemId || qty === null || qty <= 0) {
          return res.json({ ok: false, error: 'Ошибка в позиции' });
        }
        validItems.push({ id: itemId, qty: qty });
      }

      await client.query('BEGIN');
      inTx = true;
      
      const docId = 'WO_' + crypto.randomBytes(6).toString('hex');
      let firstId = null;

      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];

        const u = await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1, stock_version = stock_version + 1 ' +
          'WHERE id = $2 AND shop_id = $3', 
          [item.qty, item.id, shopId]
        );
        
        if (u.rowCount === 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Товар не найден' });
        }
        
        const ins = await client.query(
          'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, ' +
          'reason, comment, photo_url, chat_id, doc_id, status) ' +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed') " +
          'RETURNING id',
          [shopId, item.id, item.qty, req.body.reason, 
           req.body.comment, req.body.photo, chatId, docId]
        );
        if (firstId === null) firstId = ins.rows[0].id;
      }

      await client.query('COMMIT');
      inTx = false;

      await logAction(shopId, chatId, 'writeoff', 
        'Списание: ' + validItems.length + ' поз.', firstId);

      res.json({ ok: true, doc_id: docId, id: firstId });
    } catch (e) {
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Writeoff error:', e.message);
      res.status(500).json({ ok: false, error: 'Ошибка сервера' });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/warehouse/writeoff/cancel', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });

      const perm = await client.query(
        'SELECT role, can_writeoff FROM admins ' +
        'WHERE chat_id = $1 AND shop_id = $2', 
        [auth.chatId, auth.shopId]
      );
      
      if (perm.rows.length === 0 || 
          (perm.rows[0].role !== 'owner' && 
           !perm.rows[0].can_writeoff)) {
        return res.status(403).json({ ok: false });
      }
      
      const shopId = auth.shopId;
      
      let docId = req.body.id;
      if (typeof docId !== 'string' || docId.length === 0 || 
          docId.length > 100) {
        return res.json({ ok: false, error: 'Неверный ID' }); 
      }
      
      await client.query('BEGIN');
      inTx = true;
      
      const items = await client.query(
        'SELECT id, shop_item_id, qty, status FROM wh_writeoffs ' +
        'WHERE (doc_id = $1 OR id::text = $1) ' +
        'AND shop_id = $2 FOR UPDATE', [docId, shopId]
      );
      
      if (items.rows.length === 0) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Документ не найден' });
      }

      let alreadyCancelled = true;
      for (let k = 0; k < items.rows.length; k++) {
        if (items.rows[k].status !== 'cancelled') {
          alreadyCancelled = false;
          break;
        }
      }
      
      if (alreadyCancelled) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Уже отменено' });
      }

      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        if (item.shop_item_id && item.status === 'completed') {
          const u = await client.query(
            'UPDATE wh_shop_items SET current_stock = ' +
            'current_stock + $1, stock_version = stock_version + 1 ' +
            'WHERE id = $2 AND shop_id = $3',
            [item.qty, item.shop_item_id, shopId]
          );
          if (u.rowCount === 0) {
            await client.query('ROLLBACK'); inTx = false;
            return res.json({ ok: false, error: 'Товар не найден' });
          }
        }
      }
      
      await client.query(
        "UPDATE wh_writeoffs SET status = 'cancelled' " +
        'WHERE (doc_id = $1 OR id::text = $1) AND shop_id = $2', 
        [docId, shopId]
      );
      
      await client.query('COMMIT');
      inTx = false;
      
      await logAction(shopId, auth.chatId, 'writeoff_cancel', 
        'Отмена списания №' + docId, docId);
        
      res.json({ ok: true });
    } catch (e) {
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Writeoff cancel:', e.message);
      res.status(500).json({ ok: false, error: 'Ошибка сервера' });
    } finally {
      if (client) client.release();
    }
  });
  app.get('/api/warehouse/suppliers', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const r = await pool.query(
        'SELECT id, name FROM wh_suppliers ' +
        'WHERE shop_id = $1 ORDER BY name ASC', [auth.shopId]
      );
      res.json({ ok: true, suppliers: r.rows });
    } catch (e) { 
      console.error('Suppliers:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/suppliers/create', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const name = String(req.body.name || '').trim();
      if (!name || name.length > 100) {
        return res.json({ ok: false, error: 'Введите имя' });
      }
      
      const r = await pool.query(
        'INSERT INTO wh_suppliers (shop_id, name) ' +
        'VALUES ($1, $2) RETURNING id, name', [auth.shopId, name]
      );
      res.json({ ok: true, id: r.rows[0].id, supplier: r.rows[0] });
    } catch (e) { 
      console.error('Supplier create:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/suppliers/rename', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const id = parseStrictInt(req.body.id);
      const name = String(req.body.name || '').trim();
      if (!id || !name || name.length > 100) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      const r = await pool.query(
        'UPDATE wh_suppliers SET name = $1 ' +
        'WHERE id = $2 AND shop_id = $3', 
        [name, id, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      res.json({ ok: true });
    } catch (e) { 
      console.error('Supplier rename:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/suppliers/delete', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const id = parseStrictInt(req.body.id);
      if (!id) return res.json({ ok: false });
      
      await client.query('BEGIN');
      inTx = true;
      
      await client.query(
        'UPDATE wh_receipts SET supplier_id = NULL ' +
        'WHERE supplier_id = $1 AND shop_id = $2', 
        [id, auth.shopId]
      );
      
      const r = await client.query(
        'DELETE FROM wh_suppliers WHERE id = $1 AND shop_id = $2', 
        [id, auth.shopId]
      );
      
      if (r.rowCount === 0) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false });
      }
      
      await client.query('COMMIT');
      inTx = false;
      res.json({ ok: true });
    } catch (e) { 
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Supplier delete:', e.message);
      res.status(500).json({ ok: false }); 
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/warehouse/receipts', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const supplierId = req.query.supplier_id;
      let query = 
        'SELECT r.id, r.date, r.updated_at, r.total_sum, r.status, ' +
        'r.supplier_id, s.name as supplier_name, a.name as author ' +
        'FROM wh_receipts r ' +
        'LEFT JOIN wh_suppliers s ON s.id = r.supplier_id ' +
        'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'AND a.shop_id = r.shop_id ' +
        'WHERE r.shop_id = $1 ';
        
      let params = [auth.shopId];
      
      if (supplierId) {
        query += 'AND r.supplier_id = $2 ';
        params.push(supplierId);
      }
      
      query += 'ORDER BY r.date DESC LIMIT 50';
      
      const r = await pool.query(query, params);
      res.json({ ok: true, docs: r.rows });
    } catch (e) { 
      console.error('Receipts list:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/receipt/delete', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const receiptId = parseStrictInt(req.body.id);
      if (!receiptId) {
        return res.json({ ok: false });
      }
      
      await client.query('BEGIN');
      inTx = true;
      
      const r = await client.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE', 
        [receiptId, auth.shopId]
      );
      
      if (r.rows.length === 0 || r.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Только черновики' });
      }
      
      await client.query(
        'DELETE FROM wh_receipt_items WHERE receipt_id = $1', 
        [receiptId]
      );
      
      await client.query(
        'DELETE FROM wh_receipts WHERE id = $1 AND shop_id = $2', 
        [receiptId, auth.shopId]
      );
      
      await client.query('COMMIT');
      inTx = false;
      
      await logAction(auth.shopId, auth.chatId, 'receipt_delete', 
        'Удален черновик накладной №' + receiptId, receiptId);
        
      res.json({ ok: true });
    } catch (e) { 
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Receipt delete:', e.message);
      res.status(500).json({ ok: false }); 
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/warehouse/receipt/items', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const receiptId = parseStrictInt(req.query.id);
      if (!receiptId) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const r = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ' +
        'ri.shop_item_id, shi.retail_price, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_receipts r ON r.id = ri.receipt_id ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1 AND r.shop_id = $2', 
        [receiptId, auth.shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { 
      console.error('Receipt items:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/receipt/item/add', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const receiptId = parseStrictInt(req.body.receipt_id);
      if (!receiptId) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }

      await client.query('BEGIN');
      inTx = true;
      
      const checkR = await client.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE', 
        [receiptId, shopId]
      );
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Не черновик' });
      }

      const name = capWords(String(req.body.name || '').trim());
      const numQty = parseStrictFloat(req.body.qty);
      const numPrice = parseStrictFloat(req.body.price);
      
      let numRetail = 0;
      if (req.body.retail !== undefined && req.body.retail !== null && 
          req.body.retail !== '') {
        numRetail = parseStrictFloat(req.body.retail);
        if (numRetail === null || numRetail < 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Неверная розница' });
        }
      }

      if (!name || name.length > 200 || numQty === null || 
          numPrice === null || numQty <= 0 || numPrice <= 0) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      let catId = null;
      if (req.body.cat_id !== undefined && req.body.cat_id !== null && 
          req.body.cat_id !== '') {
        catId = parseStrictInt(req.body.cat_id);
        if (catId === null || catId <= 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Неверная категория' });
        }
      }
      
      const unit = String(req.body.unit || 'шт').slice(0, 10);
      let photoUrl = req.body.photo_url || null;
      
      if (photoUrl && !isValidUrl(photoUrl)) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Неверный URL фото' });
      }

      let itemId = null;
      try {
        const ins = await client.query(
          'INSERT INTO wh_items (name, unit, category_id) ' +
          'VALUES ($1, $2, $3) ' +
          'ON CONFLICT (name, unit, ' +
          'COALESCE(category_id, -1)) DO NOTHING ' +
          'RETURNING id',
          [name, unit, catId]
        );
        
        if (ins.rows.length > 0) {
          itemId = ins.rows[0].id;
        }
      } catch (err) {
        if (err.code !== '42P10') throw err;
      }
      
      if (!itemId) {
        const sel = await client.query(
          'SELECT id FROM wh_items WHERE name = $1 AND unit = $2 ' +
          'AND category_id IS NOT DISTINCT FROM $3 ' +
          'ORDER BY id ASC LIMIT 1',
          [name, unit, catId]
        );
        if (sel.rows.length === 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Ошибка каталога' });
        }
        itemId = sel.rows[0].id;
      }

      const nsi = await client.query(
        'INSERT INTO wh_shop_items (shop_id, item_id, photo_url) ' +
        'VALUES ($1, $2, $3) ' +
        'ON CONFLICT (shop_id, item_id) DO UPDATE ' +
        'SET photo_url = COALESCE(EXCLUDED.photo_url, ' +
        'wh_shop_items.photo_url) ' +
        'RETURNING id',
        [shopId, itemId, photoUrl]
      );
      const shopItemId = nsi.rows[0].id;

      const sum = Math.round(numQty * numPrice * 100) / 100;

      const existing = await client.query(
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
        
        await client.query(
          'UPDATE wh_receipt_items SET qty = $1, sum = $2, ' +
          'unit_cost = $3 WHERE id = $4', 
          [newQty, newSum, newAvg, ex.id]
        );
      } else {
        await client.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, ' +
          'qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)', 
          [receiptId, shopItemId, numQty, numPrice, sum]
        );
      }

      await client.query(
        'UPDATE wh_receipts SET total_sum = total_sum + $1, ' +
        'updated_at = NOW() WHERE id = $2', [sum, receiptId]
      );
      
      if (numRetail > 0) {
        await client.query(
          'UPDATE wh_shop_items SET retail_price = $1 ' +
          'WHERE id = $2 AND shop_id = $3', 
          [numRetail, shopItemId, shopId]
        );
      }

      await client.query('COMMIT');
      inTx = false;

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
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Receipt item add:', e.message);
      res.status(500).json({ ok: false }); 
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/warehouse/receipt/save-all', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const receiptId = parseStrictInt(req.body.receipt_id);
      const items = req.body.items;
      
      let supplierId = null;
      if (req.body.supplier_id !== undefined && 
          req.body.supplier_id !== null && 
          req.body.supplier_id !== '') {
        supplierId = parseStrictInt(req.body.supplier_id);
        if (supplierId === null || supplierId <= 0) {
          return res.json({ ok: false, error: 'Ошибка supplier_id' });
        }
      }
      
      if (!receiptId || !Array.isArray(items) || 
          items.length === 0 || items.length > 500) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      const validItems = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const sid = parseStrictInt(it.shop_item_id);
        const q = parseStrictFloat(it.qty);
        const p = parseStrictFloat(it.unit_cost);
        
        if (!sid || q === null || q <= 0 || 
            p === null || p < 0) {
          return res.json({ ok: false, error: 'Ошибка в позиции' });
        }
        validItems.push({ shop_item_id: sid, qty: q, unit_cost: p });
      }

      await client.query('BEGIN');
      inTx = true;
      
      const checkR = await client.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE', 
        [receiptId, shopId]
      );
      
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Не найдена' });
      }

      if (supplierId) {
        const supCheck = await client.query(
          'SELECT id FROM wh_suppliers ' +
          'WHERE id = $1 AND shop_id = $2', [supplierId, shopId]
        );
        if (supCheck.rows.length === 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Чужой поставщик' });
        }
      }

      const aggItems = {};
      for (let i = 0; i < validItems.length; i++) {
        const it = validItems[i];
        const sid = it.shop_item_id;
        if (!aggItems[sid]) {
          aggItems[sid] = { shop_item_id: sid, qty: 0, sum: 0 };
        }
        aggItems[sid].qty += it.qty;
        aggItems[sid].sum += (it.qty * it.unit_cost);
      }
      
      const finalItems = [];
      const finalIds = [];
      for (let key in aggItems) {
        if (Object.prototype.hasOwnProperty.call(aggItems, key)) {
          finalItems.push(aggItems[key]);
          finalIds.push(aggItems[key].shop_item_id);
        }
      }
      
      const lockedItems = await client.query(
        'SELECT id, current_stock, avg_cost, last_cost, ' +
        'stock_version FROM wh_shop_items ' +
        'WHERE id = ANY($1) AND shop_id = $2 ' +
        'ORDER BY id ASC FOR UPDATE',
        [finalIds, shopId]
      );

      if (lockedItems.rows.length !== finalIds.length) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Товар не найден' });
      }

      const lockedMap = {};
      for (let i = 0; i < lockedItems.rows.length; i++) {
        lockedMap[lockedItems.rows[i].id] = lockedItems.rows[i];
      }
      
      await client.query(
        'DELETE FROM wh_receipt_items WHERE receipt_id = $1', [receiptId]
      );

      let totalSum = 0;
      for (let i = 0; i < finalItems.length; i++) {
        const it = finalItems[i];
        const qty = it.qty;
        const sum = Math.round(it.sum * 100) / 100;
        const price = qty > 0 ? Math.round((sum / qty) * 100) / 100 : 0;
        totalSum += sum;

        await client.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, ' +
          'qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)',
          [receiptId, it.shop_item_id, qty, price, sum]
        );
      }
      
      await client.query(
        'UPDATE wh_receipts SET total_sum = $1, supplier_id = $2 ' +
        'WHERE id = $3 AND shop_id = $4', 
        [totalSum, supplierId, receiptId, shopId]
      );

      for (let i = 0; i < finalItems.length; i++) {
        const it = finalItems[i];
        const qty = it.qty;
        const price = qty > 0 ? 
          Math.round((it.sum / qty) * 100) / 100 : 0;

        const curr = lockedMap[it.shop_item_id];
        
        let oldStock = parseFloat(curr.current_stock) || 0;
        let oldAvg = parseFloat(curr.avg_cost) || 0;
        let oldLast = parseFloat(curr.last_cost) || 0;
        let oldVer = parseInt(curr.stock_version) || 0;

        let newStock = oldStock + qty;
        let newAvg = 0;
        
        if (newStock > 0) {
          if (oldStock <= 0) {
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
          'UPDATE wh_shop_items SET current_stock = $1, ' +
          'last_cost = $2, avg_cost = $3, stock_version = $4 ' +
          'WHERE id = $5 AND shop_id = $6',
          [newStock, price, newAvg, newVer, it.shop_item_id, shopId]
        );
        
        await client.query(
          'UPDATE wh_receipt_items SET ' +
          'prev_avg_cost = $1, prev_last_cost = $2, ' +
          'stock_version_after = $3 ' +
          'WHERE receipt_id = $4 AND shop_item_id = $5',
          [oldAvg, oldLast, newVer, receiptId, it.shop_item_id]
        );
      }

      await client.query(
        "UPDATE wh_receipts SET status = 'completed', " +
        'updated_at = NOW() WHERE id = $1 AND shop_id = $2', 
        [receiptId, shopId]
      );
      
      await client.query('COMMIT');
      inTx = false;

      await logAction(shopId, auth.chatId, 'receipt', 
        'Проведена накладная ID ' + receiptId, receiptId);
        
      res.json({ ok: true });
    } catch (e) {
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Save-all:', e.message);
      res.status(500).json({ ok: false, error: 'Ошибка сервера' });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/warehouse/receipt/cancel', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const receiptId = parseStrictInt(req.body.id);
      
      if (!receiptId) { 
        return res.json({ ok: false, error: 'Неверный ID' }); 
      }
      
      await client.query('BEGIN');
      inTx = true;
      
      const checkR = await client.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE', [receiptId, shopId]
      );
      
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'completed') {
        await client.query('ROLLBACK'); inTx = false; 
        return res.json({ ok: false, error: 'Не найдена' });
      }

      const items = await client.query(
        'SELECT shop_item_id, qty, prev_avg_cost, prev_last_cost, ' +
        'stock_version_after ' +
        'FROM wh_receipt_items WHERE receipt_id = $1 ' +
        'ORDER BY shop_item_id ASC', [receiptId]
      );
      
      const ids = [];
      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        
        if (item.stock_version_after === null || 
            item.stock_version_after === undefined ||
            item.prev_avg_cost === null ||
            item.prev_avg_cost === undefined ||
            item.prev_last_cost === null ||
            item.prev_last_cost === undefined) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ 
            ok: false, 
            error: 'Старая накладная без снимка. Отмена вручную.' 
          });
        }
        
        ids.push(item.shop_item_id);
      }
      
      const lockedItems = await client.query(
        'SELECT id, stock_version FROM wh_shop_items ' +
        'WHERE id = ANY($1) AND shop_id = $2 ' +
        'ORDER BY id ASC FOR UPDATE',
        [ids, shopId]
      );
      
      if (lockedItems.rows.length !== ids.length) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Товар удален' });
      }
      
      const lockedMap = {};
      for (let i = 0; i < lockedItems.rows.length; i++) {
        lockedMap[lockedItems.rows[i].id] = lockedItems.rows[i];
      }

      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        const curr = lockedMap[item.shop_item_id];
        const currVer = parseInt(curr.stock_version) || 0;
        const savedVer = parseInt(item.stock_version_after) || 0;
        
        if (currVer !== savedVer) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ 
            ok: false, 
            error: 'Были другие операции с товаром' 
          });
        }
      }

      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        const u = await client.query(
          'UPDATE wh_shop_items SET ' +
          'current_stock = current_stock - $1, ' +
          'avg_cost = $2, ' +
          'last_cost = $3, ' +
          'stock_version = stock_version + 1 ' +
          'WHERE id = $4 AND shop_id = $5',
          [item.qty, item.prev_avg_cost, item.prev_last_cost, 
           item.shop_item_id, shopId]
        );
        if (u.rowCount === 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Товар не найден' });
        }
      }
      
      await client.query(
        "UPDATE wh_receipts SET status = 'draft', " +
        'updated_at = NOW() WHERE id = $1 AND shop_id = $2', 
        [receiptId, shopId]
      );
      await client.query('COMMIT');
      inTx = false;
      
      await logAction(shopId, auth.chatId, 'receipt_cancel', 
        'Отмена накладной ' + receiptId, receiptId);
      res.json({ ok: true });
    } catch (e) {
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Receipt cancel:', e.message);
      res.status(500).json({ ok: false, error: 'Ошибка сервера' });
    } finally {
      if (client) client.release();
    }
  });
  app.get('/api/warehouse/bouquets', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      
      const r = await pool.query(
        'SELECT b.id, b.name, b.price, b.photos, b.preorder_only, ' +
        'r.shop_item_id, r.qty as recipe_qty, r.alternatives ' +
        'FROM bouquets b ' +
        'LEFT JOIN wh_bouquet_recipes r ON r.bouquet_id = b.id ' +
        'WHERE b.shop_id = $1 AND b.wh_linked = TRUE ' +
        'AND b.deleted = FALSE', [shopId]
      );
      
      let bouquetsMap = {};
      let allItemIds = new Set();
      
      for (let j = 0; j < r.rows.length; j++) {
        let row = r.rows[j];
        if (!bouquetsMap[row.id]) {
          bouquetsMap[row.id] = {
            id: row.id, name: row.name, price: row.price,
            photos: row.photos, preorder_only: row.preorder_only,
            ingredients: []
          };
        }
        
        if (row.shop_item_id) {
          let alts = [];
          if (row.alternatives && row.alternatives.length > 0) {
            for (let k = 0; k < row.alternatives.length; k++) {
              const a = row.alternatives[k];
              if (!a) continue;
              const altId = typeof a === 'object' ? a.shop_item_id : a;
              if (altId) {
                alts.push(altId);
                allItemIds.add(altId);
              }
            }
          }
          
          bouquetsMap[row.id].ingredients.push({
            shop_item_id: row.shop_item_id,
            qty: parseFloat(row.recipe_qty) || 0,
            alternatives: alts
          });
          allItemIds.add(row.shop_item_id);
        }
      }
      
      const idsArr = Array.from(allItemIds);
      let stockMap = {};
      
      if (idsArr.length > 0) {
        const stockRes = await pool.query(
          'SELECT id, current_stock FROM wh_shop_items ' +
          'WHERE id = ANY($1) AND shop_id = $2',
          [idsArr, shopId]
        );
        for (let k = 0; k < stockRes.rows.length; k++) {
          stockMap[stockRes.rows[k].id] = 
            parseFloat(stockRes.rows[k].current_stock) || 0;
        }
      }
      
      let result = [];
      for (let key in bouquetsMap) {
        if (!Object.prototype.hasOwnProperty.call(bouquetsMap, key)) {
          continue;
        }
        let b = bouquetsMap[key];
        
        let allInStock = canAssembleBouquet(b.ingredients, stockMap);
        
        let photoUrl = null;
        if (b.photos && b.photos.length > 0) {
          const p = b.photos[0];
          if (typeof p === 'string') photoUrl = p;
          else if (p.s3) photoUrl = p.s3;
          else if (p.s3b) photoUrl = p.s3b;
        }
        
        result.push({
          id: b.id, name: b.name, price: b.price,
          photo_url: photoUrl, all_in_stock: allInStock,
          preorder_only: b.preorder_only
        });
      }
      
      res.json({ ok: true, bouquets: result });
    } catch (e) { 
      console.error('API bouquets:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/expand', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const shopId = auth.shopId;
      const bouquetId = parseStrictInt(req.body.bouquet_id);
      
      if (!bouquetId) {
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
        'SELECT r.shop_item_id, r.qty, r.alternatives, ' +
        'i.current_stock, i.retail_price, ' +
        'COALESCE(i.custom_name, w.name) AS name ' +
        'FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items i ON i.id = r.shop_item_id ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE r.bouquet_id = $1 AND i.shop_id = $2', 
        [bouquetId, shopId]
      );
      
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Рецепт пуст' });
      }

      let ingredients = [];
      for (let j = 0; j < r.rows.length; j++) {
        let it = r.rows[j];
        let altsData = [];
        if (it.alternatives && it.alternatives.length > 0) {
           const altIds = [];
           for (let k = 0; k < it.alternatives.length; k++) {
             const a = it.alternatives[k];
             if (!a) continue;
             const altId = typeof a === 'object' ? a.shop_item_id : a;
             if (altId) altIds.push(altId);
           }
           if (altIds.length > 0) {
             const altQuery = await pool.query(
               'SELECT i.id, i.current_stock, i.retail_price, ' +
               'COALESCE(i.custom_name, w.name) AS name ' +
               'FROM wh_shop_items i ' +
               'JOIN wh_items w ON w.id = i.item_id ' +
               'WHERE i.id = ANY($1) AND i.shop_id = $2', 
               [altIds, shopId]
             );
             altsData = altQuery.rows;
           }
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
      console.error('Expand:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.get('/api/warehouse/bouquets/all', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const r = await pool.query(
        'SELECT b.id, b.name, b.price, b.photos, b.wh_linked, ' +
        'b.deleted, b.preorder_only, ' +
        "(SELECT STRING_AGG(COALESCE(shi.custom_name, i.name) " +
        "|| ' x' || " +
        "CASE WHEN rcp.qty::text LIKE '%.%' " +
        "THEN TRIM(TRAILING '.' FROM TRIM(TRAILING '0' " +
        "FROM rcp.qty::text)) " +
        "ELSE rcp.qty::text END, ', ') " +
        'FROM wh_bouquet_recipes rcp ' +
        'JOIN wh_shop_items shi ON shi.id = rcp.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE rcp.bouquet_id = b.id) as recipe_text ' +
        'FROM bouquets b WHERE b.shop_id = $1 ORDER BY b.name ASC',
        [auth.shopId]
      );
      
      let result = [];
      for (let j = 0; j < r.rows.length; j++) {
        let b = r.rows[j];
        let photoUrl = null;
        if (b.photos && b.photos.length > 0) {
          const p = b.photos[0];
          if (typeof p === 'string') photoUrl = p;
          else if (p.s3) photoUrl = p.s3;
          else if (p.s3b) photoUrl = p.s3b;
        }
        result.push({
          id: b.id, name: b.name, price: b.price,
          photo_url: photoUrl, wh_linked: b.wh_linked,
          recipe_text: b.recipe_text, deleted: b.deleted,
          preorder_only: b.preorder_only
        });
      }
      res.json({ ok: true, bouquets: result });
    } catch (e) { 
      console.error('Bouquets all:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/toggle', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const bId = parseStrictInt(req.body.id);
      const val = req.body.val === true;
      
      if (!bId) return res.json({ ok: false });
      
      const r = await pool.query(
        'UPDATE bouquets SET wh_linked = $1 ' +
        'WHERE id = $2 AND shop_id = $3',
        [val, bId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      res.json({ ok: true });
    } catch (e) { 
      console.error('Toggle:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/delete', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const bId = parseStrictInt(req.body.id);
      if (!bId) return res.json({ ok: false });
      
      const r = await pool.query(
        'UPDATE bouquets SET deleted = TRUE ' +
        'WHERE id = $1 AND shop_id = $2',
        [bId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      res.json({ ok: true });
    } catch (e) { 
      console.error('Bouquet delete:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/restore', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const bId = parseStrictInt(req.body.id);
      if (!bId) return res.json({ ok: false });
      
      const r = await pool.query(
        'UPDATE bouquets SET deleted = FALSE ' +
        'WHERE id = $1 AND shop_id = $2',
        [bId, auth.shopId]
      );
      
      if (r.rowCount === 0) return res.json({ ok: false });
      res.json({ ok: true });
    } catch (e) { 
      console.error('Bouquet restore:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.get('/api/warehouse/bouquets/info', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const bId = parseStrictInt(req.query.id);
      if (!bId) return res.json({ ok: false });
      
      const r = await pool.query(
        'SELECT id, name, price, photos, wh_linked, preorder_only ' +
        'FROM bouquets WHERE id = $1 AND shop_id = $2',
        [bId, auth.shopId]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      res.json({ ok: true, bouquet: r.rows[0] });
    } catch (e) { 
      console.error('Bouquets info:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquet/save', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      let bId = 0;
      if (req.body.id !== undefined && req.body.id !== null && 
          req.body.id !== '' && String(req.body.id) !== '0') {
        bId = parseStrictInt(req.body.id);
        if (!bId) {
          return res.json({ ok: false, error: 'Неверный ID' });
        }
      }
      
      const name = String(req.body.name || '').trim();
      const price = parseStrictFloat(req.body.price);
      const photoUrl = req.body.photo_url;
      const isLinked = req.body.is_linked === true;
      const isPreorder = req.body.is_preorder === true;
      
      if (!name || name.length > 100 || 
          price === null || price <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      
      let photos = null;
      if (photoUrl !== undefined && photoUrl !== null && 
          photoUrl !== '') {
        if (!isValidUrl(photoUrl)) {
          return res.json({ ok: false, error: 'Неверный URL' });
        }
        photos = JSON.stringify([photoUrl]);
      }
      
      let finalId = bId;

      if (bId > 0) {
        let r;
        if (photos) {
          r = await pool.query(
            'UPDATE bouquets SET name = $1, price = $2, photos = $3, ' +
            'wh_linked = $4, preorder_only = $5 WHERE id = $6 ' +
            'AND shop_id = $7',
            [name, price, photos, isLinked, 
             isPreorder, bId, auth.shopId]
          );
        } else {
          r = await pool.query(
            'UPDATE bouquets SET name = $1, price = $2, ' +
            'wh_linked = $3, preorder_only = $4 WHERE id = $5 ' +
            'AND shop_id = $6',
            [name, price, isLinked, isPreorder, bId, auth.shopId]
          );
        }
        
        if (r.rowCount === 0) {
          return res.json({ ok: false, error: 'Букет не найден' });
        }
      } else {
        try {
          const ins = await pool.query(
            'INSERT INTO bouquets (shop_id, shop_number, name, price, ' +
            'photos, chat_id, confirmed_at, wh_linked, preorder_only, ' +
            'deleted) ' +
            'SELECT $1::varchar, COALESCE(MAX(shop_number), 0) + 1, ' +
            '$2, $3, COALESCE($4::jsonb, \'[]\'::jsonb), $5, NOW(), ' +
            '$6, $7, FALSE ' +
            'FROM bouquets WHERE shop_id = $1::varchar ' +
            'RETURNING id',
            [auth.shopId, name, price, 
             photos, auth.chatId, isLinked, isPreorder]
          );
          finalId = ins.rows[0].id;
        } catch (err) {
          if (err.code === '23505') {
            return res.json({ 
              ok: false, error: 'Повторите попытку' 
            });
          }
          throw err;
        }
      }
      res.json({ ok: true, id: finalId });
    } catch (e) { 
      console.error('Bouquet save:', e.message);
      res.status(500).json({ ok: false, error: 'Ошибка сервера' }); 
    }
  });

  app.get('/api/warehouse/bouquets/recipe', async function(req, res) {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const bId = parseStrictInt(req.query.id);
      if (!bId) return res.json({ ok: false });
      
      const r = await pool.query(
        'SELECT r.id, r.shop_item_id, r.qty, r.alternatives, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'i.unit, shi.current_stock FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items shi ON shi.id = r.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE r.bouquet_id = $1 AND shi.shop_id = $2 ' +
        'ORDER BY r.id ASC',
        [bId, auth.shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { 
      console.error('Bouquet recipe:', e.message);
      res.status(500).json({ ok: false }); 
    }
  });

  app.post('/api/warehouse/bouquets/recipe/save', async function(req, res) {
    let client = null;
    let inTx = false;
    try {
      client = await pool.connect();
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const bId = parseStrictInt(req.body.bouquet_id);
      const items = req.body.items;
      if (!bId || !Array.isArray(items) || items.length > 100) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      inTx = true;
      
      const bCheck = await client.query(
        'SELECT id FROM bouquets ' +
        'WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [bId, auth.shopId]
      );
      if (bCheck.rows.length === 0) {
        await client.query('ROLLBACK'); inTx = false;
        return res.json({ ok: false, error: 'Букет не найден' });
      }

      await client.query(
        'DELETE FROM wh_bouquet_recipes WHERE bouquet_id = $1', [bId]
      );
      
      const agg = {};
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Неверный элемент' });
        }
        
        const qty = parseStrictFloat(it.qty);
        const shopItemId = parseStrictInt(it.shop_item_id);
        
        let alts = [];
        if (it.alternatives !== undefined) {
          if (it.alternatives === null || 
              !Array.isArray(it.alternatives)) {
            await client.query('ROLLBACK'); inTx = false;
            return res.json({ 
              ok: false, error: 'alternatives не массив' 
            });
          }
          alts = it.alternatives;
        }
        
        if (!shopItemId || qty === null || qty <= 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Неверное кол-во' });
        }
        
        if (alts.length > 20) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Много альтернатив' });
        }
        
        const validAlts = [];
        for (let k = 0; k < alts.length; k++) {
          const a = alts[k];
          if (!a) {
            await client.query('ROLLBACK'); inTx = false;
            return res.json({ 
              ok: false, error: 'null в альтернативах' 
            });
          }
          const rawId = typeof a === 'object' ? a.shop_item_id : a;
          const altId = parseStrictInt(rawId);
          
          if (!altId) {
            await client.query('ROLLBACK'); inTx = false;
            return res.json({ 
              ok: false, error: 'Неверная альтернатива' 
            });
          }
          if (altId === shopItemId) {
            await client.query('ROLLBACK'); inTx = false;
            return res.json({ 
              ok: false, error: 'Нельзя в альтернативы' 
            });
          }
          if (validAlts.indexOf(altId) === -1) {
            validAlts.push(altId);
          }
        }
        
        if (agg[shopItemId]) {
          const prevAlts = agg[shopItemId].alternatives;
          let same = prevAlts.length === validAlts.length;
          if (same) {
            for (let k = 0; k < prevAlts.length; k++) {
              if (validAlts.indexOf(prevAlts[k]) === -1) {
                same = false;
                break;
              }
            }
          }
          if (!same) {
            await client.query('ROLLBACK'); inTx = false;
            return res.json({ 
              ok: false, 
              error: 'Разные альтернативы для одного товара' 
            });
          }
          agg[shopItemId].qty += qty;
        } else {
          agg[shopItemId] = { qty: qty, alternatives: validAlts };
        }
      }
      
      for (let key in agg) {
        if (!Object.prototype.hasOwnProperty.call(agg, key)) continue;
        
        const shopItemId = parseInt(key, 10);
        const qty = agg[key].qty;
        const alts = agg[key].alternatives;
        
        const shopItemCheck = await client.query(
          'SELECT id FROM wh_shop_items WHERE id = $1 AND shop_id = $2',
          [shopItemId, auth.shopId]
        );
        if (shopItemCheck.rows.length === 0) {
          await client.query('ROLLBACK'); inTx = false;
          return res.json({ ok: false, error: 'Чужой ингредиент' });
        }

        if (alts.length > 0) {
          for (let k = 0; k < alts.length; k++) {
            const altCheck = await client.query(
              'SELECT id FROM wh_shop_items ' +
              'WHERE id = $1 AND shop_id = $2',
              [alts[k], auth.shopId]
            );
            if (altCheck.rows.length === 0) {
              await client.query('ROLLBACK'); inTx = false;
              return res.json({ 
                ok: false, error: 'Чужая альтернатива' 
              });
            }
          }
        }
        
        await client.query(
          'INSERT INTO wh_bouquet_recipes ' +
          '(bouquet_id, shop_item_id, qty, alternatives) ' +
          'VALUES ($1, $2, $3, $4)', 
          [bId, shopItemId, qty, JSON.stringify(alts)]
        );
      }
      
      await client.query('COMMIT'); 
      inTx = false;
      res.json({ ok: true });
    } catch (e) {
      if (inTx && client) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
      }
      console.error('Recipe save:', e.message);
      res.status(500).json({ ok: false, error: 'Ошибка сервера' });
    } finally {
      if (client) client.release();
    }
  });

}

module.exports = { setupWarehouseStock, logAction, capWords };