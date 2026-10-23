const pool = require('./db');

async function logAction(shopId, chatId, action, details, refId) {
  try {
    await pool.query(
      'INSERT INTO wh_audit_log (shop_id, chat_id, ' +
      'action, details, ref_id) VALUES ($1, $2, $3, $4, $5)',
      [shopId, chatId, action, details, refId || null]
    );
  } catch (e) { console.error('Log error:', e.message); }
}

async function notifyOwner(bot, shopId, text, type) {
  try {
    const r = await pool.query(
      'SELECT settings FROM shops WHERE shop_id = $1', [shopId]
    );
    if (r.rows.length === 0) return;
    const settings = r.rows[0].settings || {};
    if (settings['notif_' + type] === false) return;
    
    const a = await pool.query(
      'SELECT chat_id FROM admins WHERE shop_id = $1 ' +
      'AND role = $2', [shopId, 'owner']
    );
    if (a.rows.length > 0 && bot) {
      bot.sendMessage(a.rows[0].chat_id, text, { 
        parse_mode: 'HTML' 
      }).catch(function() {});
    }
  } catch (e) { console.error('Notify error:', e.message); }
}

function fmtNum(n) {
  var num = parseFloat(n);
  if (isNaN(num)) return "0";
  return num % 1 === 0 ? num.toString() : 
    num.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function setupWarehouse(app, bot) {
  const brandColor = '#124444';
  const accentColor = '#E08567';

  // 1. Главный экран
  app.get('/warehouse-app', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatIdStr = match ? match[1] : null;
      const chatId = chatIdStr ? Number(chatIdStr) : null;
      
      if (!chatId) {
        return res.redirect('/warehouse-login?shop=kupidon');
      }

      const r = await pool.query(
        'SELECT role, name, can_receipt, can_sale, ' +
        'can_writeoff FROM admins WHERE chat_id = $1 LIMIT 1', 
        [chatId]
      );
      
      if (r.rows.length === 0) {
        return res.redirect('/warehouse-login?shop=kupidon');
      }

      const user = r.rows[0];
      const isOwner = user.role === 'owner';
      const userName = user.name || 'Флорист';
      const canSale = user.can_sale === true;
      const canWriteoff = user.can_writeoff === true;
      const canReceipt = user.can_receipt === true;

      const shiftRes = await pool.query(
        'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1', 
        ['kupidon', chatId]
      );
      const hasOpenShift = shiftRes.rows.length > 0;

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" ';
      html += 'content="width=device-width, initial-scale=1.0">';
      html += '<script src="https://telegram.org/js/';
      html += 'telegram-web-app.js"><\/script>';
      html += '<style>';
      html += 'body { font-family: sans-serif; margin: 0; ';
      html += 'padding: 20px; text-align: center; ';
      html += 'background: #fafaf8; color: ' + brandColor + '; }';
      html += '.header { background: #fff; padding: 20px; ';
      html += 'border-radius: 20px; margin-bottom: 20px; ';
      html += 'border-bottom: 4px solid ' + brandColor + '; }';
      html += 'h1 { margin: 0; font-size: 24px; }';
      html += '.grid { display: grid; ';
      html += 'grid-template-columns: 1fr 1fr; gap: 15px; }';
      html += '.btn { background: #fff; padding: 20px 10px; ';
      html += 'border-radius: 20px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; font-weight: bold; ';
      html += 'font-size: 16px; display: flex; ';
      html += 'flex-direction: column; align-items: center; ';
      html += 'justify-content: center; border: 1px solid #eee; }';
      html += '.btn span { font-size: 28px; margin-bottom: 8px; }';
      html += '.full { grid-column: 1 / -1; }';
      html += '.shift-open { background: #e0f7fa; ';
      html += 'border-color: #00acc1; }';
      html += '.shift-closed { background: #fff3e0; ';
      html += 'border-color: #f39c12; }';
      html += '</style></head><body>';
      
      html += '<div class="header"><h1>📦 Склад</h1>';
      html += '<p style="color:#888;margin:5px 0 0;">Вы: ';
      html += '<b>' + userName + '</b> ';
      html += '(' + (isOwner ? 'Владелец' : 'Флорист') + ')</p></div>';

      if (hasOpenShift) {
        html += '<a href="/warehouse/shift" ';
        html += 'class="btn full shift-open">';
        html += '<span>🟢</span>Смена открыта (Закрыть)</a>';
      } else {
        html += '<a href="/warehouse/shift" ';
        html += 'class="btn full shift-closed">';
        html += '<span>🟠</span>Смена закрыта (Открыть)</a>';
      }

      html += '<div class="grid" style="margin-top:15px;">';
      
      if (isOwner || canSale) {
        html += '<a href="/warehouse/sale" class="btn">';
        html += '<span>💰</span>Продажа</a>';
      }
      if (isOwner || canWriteoff) {
        html += '<a href="/warehouse/writeoff" class="btn">';
        html += '<span>🗑</span>Списание</a>';
      }
      if (isOwner || canReceipt) {
        html += '<a href="/warehouse/receipts" class="btn">';
        html += '<span>📥</span>Приход</a>';
      }
      
      html += '<a href="/warehouse/history" class="btn">';
      html += '<span>📋</span>История</a>';
      html += '<a href="/warehouse/inventory" class="btn">';
      html += '<span>📦</span>Обзор</a>';
      
      if (isOwner) {
        html += '<a href="/warehouse/documents" class="btn">';
        html += '<span>📑</span>Документы</a>';
        html += '<a href="/warehouse/staff" class="btn">';
        html += '<span>👥</span>Флористы</a>';
        html += '<a href="/warehouse/reports" class="btn">';
        html += '<span>📊</span>Отчёты</a>';
        html += '<a href="/warehouse/audit" class="btn">';
        html += '<span>👁</span>Журнал</a>';
        html += '<a href="/warehouse/settings" class="btn full">';
        html += '<span>⚙️</span>Настройки</a>';
      }
      html += '</div>';
      html += '<script>Telegram.WebApp.ready();<\/script>';
      html += '</body></html>';
      res.send(html);
    } catch (e) { 
      res.status(500).send('Ошибка сервера'); 
    }
  });

  // 2. Вход
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; text-align: center; ';
    html += 'padding: 50px 20px; background: #fafaf8; }';
    html += '.card { background: #fff; border-radius: 20px; ';
    html += 'padding: 30px; max-width: 400px; margin: 0 auto; ';
    html += 'border-bottom: 5px solid ' + brandColor + '; }';
    html += 'input { font-size: 24px; padding: 10px; ';
    html += 'width: 120px; text-align: center; ';
    html += 'border: 2px solid #ddd; border-radius: 10px; ';
    html += 'margin: 20px 0; }';
    html += 'button { background: ' + brandColor + '; ';
    html += 'color: white; border: none; padding: 15px 40px; ';
    html += 'font-size: 18px; border-radius: 30px; }';
    html += '</style></head><body>';
    html += '<div class="card"><h1>📦 Склад</h1>';
    html += '<p>Введите PIN-код</p>';
    html += '<input type="password" id="pin" maxlength="4" ';
    html += 'inputmode="numeric" placeholder="****">';
    html += '<br><button onclick="login()">Войти</button></div>';
    html += '<script>';
    html += 'function login() {';
    html += '  var pin = document.getElementById("pin").value;';
    html += '  fetch("/api/warehouse/auth", { ';
    html += 'method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "' + shopId + '", ';
    html += 'pin: pin }) }).then(function(r) { return r.json(); })';
    html += '    .then(function(data) {';
    html += '    if (data.ok) window.location.href = "/warehouse-app"; ';
    html += 'else alert("Неверный PIN"); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 3. API Авторизации
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT chat_id, role FROM admins WHERE shop_id = $1 ' +
        'AND warehouse_pin = $2', [req.body.shopId, req.body.pin]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      
      res.setHeader('Set-Cookie', 
        'wh_auth=' + r.rows[0].chat_id + 
        '; Path=/; Max-Age=2592000; HttpOnly'
      );
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  // 4. API Категорий
  app.get('/api/warehouse/categories', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT id, name FROM wh_categories ORDER BY sort_order ASC'
      );
      res.json({ ok: true, categories: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 5. API Товаров
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT i.id, i.current_stock, i.retail_price, ' +
        'COALESCE(i.custom_name, w.name) AS name, w.photo_url, ' +
        'w.category_id ' +
        'FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 ORDER BY w.name ASC', 
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 6. Экран Обзора склада (с фильтрами)
  app.get('/warehouse/inventory', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; ';
    html += 'border: 2px solid #eee; border-radius: 10px; ';
    html += 'margin-bottom: 15px; box-sizing: border-box; }';
    html += '.h-scroll { display: flex; overflow-x: auto; gap: 8px; ';
    html += 'margin-bottom: 15px; padding-bottom: 5px; }';
    html += '.cat-btn { padding: 8px 15px; border: 1px solid #ddd; ';
    html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
    html += 'font-size: 14px; white-space: nowrap; }';
    html += '.cat-btn.active { background: ' + brandColor + '; ';
    html += 'color: #fff; border-color: ' + brandColor + '; }';
    html += '.grid { display: grid; grid-template-columns: 1fr 1fr; ';
    html += 'gap: 10px; }';
    html += '.card { background: #fff; padding: 10px; ';
    html += 'border-radius: 10px; text-align: center; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'box-shadow: 0 2px 8px rgba(0,0,0,0.05); }';
    html += '.card img { width: 100%; height: 80px; object-fit: cover; ';
    html += 'border-radius: 6px; margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; ';
    html += 'align-items: center; justify-content: center; ';
    html += 'margin-bottom: 5px; }';
    html += '.name { font-size: 13px; font-weight: bold; ';
    html += 'margin-bottom: 4px; }';
    html += '.stock { font-size: 12px; font-weight: bold; }';
    html += '.green { color: #27ae60; } .red { color: #e74c3c; }';
    html += '</style></head><body>';
    
    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>📦 Обзор</h1></div>';
    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." onkeyup="applyFilters()">';
    
    html += '<div class="h-scroll" id="catList">';
    html += '<div class="cat-btn active" id="cat-0" ';
    html += 'onclick="setCat(0)">Все</div>';
    html += '</div>';
    
    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<script>';
    html += 'var allItems = []; var currentCat = 0; var searchQ = "";';
    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';
    
    html += 'fetch("/api/warehouse/categories")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  if (d.ok) {';
    html += '    var cl = document.getElementById("catList");';
    html += '    d.categories.forEach(function(c) {';
    html += '      var div = document.createElement("div");';
    html += '      div.className = "cat-btn"; div.id = "cat-" + c.id;';
    html += '      div.innerText = c.name;';
    html += '      div.onclick = function() { setCat(c.id); };';
    html += '      cl.appendChild(div);';
    html += '    });';
    html += '  }';
    html += '});';
    
    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  if (d.ok) { allItems = d.items; applyFilters(); }';
    html += '});';
    
    html += 'function setCat(id) {';
    html += '  currentCat = id;';
    html += '  document.querySelectorAll(".cat-btn").forEach(function(el) { ';
    html += 'el.classList.remove("active"); });';
    html += '  document.getElementById("cat-" + id).classList.add("active");';
    html += '  applyFilters();';
    html += '}';
    
    html += 'function applyFilters() {';
    html += '  searchQ = document.getElementById("search").value.toLowerCase();';
    html += '  var filtered = allItems.filter(function(i) {';
    html += '    var matchSearch = i.name.toLowerCase().includes(searchQ);';
    html += '    var matchCat = true;';
    html += '    if (currentCat !== 0) {';
    html += '      matchCat = (i.category_id === currentCat);';
    html += '    }';
    html += '    return matchSearch && matchCat;';
    html += '  });';
    html += '  render(filtered);';
    html += '}';
    
    html += 'function render(items) {';
    html += '  var g = document.getElementById("itemsGrid"); ';
    html += 'g.innerHTML = "";';
    html += '  items.forEach(function(i) {';
    html += '    var a = document.createElement("a"); ';
    html += 'a.className = "card";';
    html += '    a.href = "/warehouse/item?id=" + i.id;';
    html += '    var img = i.photo_url ? ';
    html += '\'<img src="\' + i.photo_url + \'">\' : ';
    html += '\'<div class="ph">📷</div>\';';
    html += '    var stockColor = parseFloat(i.current_stock) > 0 ? ';
    html += '"green" : "red";';
    html += '    a.innerHTML = img + \'<div class="name">\' + ';
    html += 'i.name + \'</div>\';';
    html += '    a.innerHTML += \'<div class="stock \' + stockColor + ';
    html += '\'">Ост: \' + fmtNum(i.current_stock) + \'</div>\';';
    html += '    g.appendChild(a);';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 7. API Истории товара (Выписка с остатками)
  app.get('/api/warehouse/item/history', async (req, res) => {
    try {
      const itemId = req.query.id;
      const shopId = req.query.shop || 'kupidon';
      
      const itemInfo = await pool.query(
        'SELECT i.id, i.current_stock, i.item_id, ' +
        'COALESCE(i.custom_name, w.name) AS name ' +
        'FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.id = $1 AND i.shop_id = $2', [itemId, shopId]
      );
      if (itemInfo.rows.length === 0) {
        return res.json({ ok: false, error: 'Товар не найден' });
      }

      const sales = await pool.query(
        'SELECT s.id, s.date, \'sale\' as type, si.qty, ' +
        'a.name as person FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE si.shop_item_id = $1 AND s.shop_id = $2 ' +
        'ORDER BY s.date DESC LIMIT 30', [itemId, shopId]
      );
      
      const receipts = await pool.query(
        'SELECT r.id, r.date, \'receipt\' as type, ri.qty, ' +
        '\'Приход\' as person FROM wh_receipt_items ri ' +
        'JOIN wh_receipts r ON r.id = ri.receipt_id ' +
        'WHERE ri.shop_item_id = $1 AND r.shop_id = $2 ' +
        'ORDER BY r.date DESC LIMIT 30', [itemId, shopId]
      );

      const writeoffs = await pool.query(
        'SELECT w.id, w.date, \'writeoff\' as type, w.qty, ' +
        'a.name as person, w.reason FROM wh_writeoffs w ' +
        'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
        'WHERE w.shop_item_id = $1 AND w.shop_id = $2 ' +
        'ORDER BY w.date DESC LIMIT 30', [itemId, shopId]
      );

      let list = [...sales.rows, ...receipts.rows, ...writeoffs.rows];
      list.sort(function(a, b) { 
        return new Date(b.date) - new Date(a.date); 
      });

      // Расчет остатков
      let runningStock = parseFloat(itemInfo.rows[0].current_stock);
      list.forEach(function(op) {
        let qty = parseFloat(op.qty);
        op.stock_after = runningStock;
        if (op.type === 'receipt') {
          op.stock_before = runningStock - qty;
          runningStock -= qty;
        } else {
          op.stock_before = runningStock + qty;
          runningStock += qty;
        }
      });
      
      res.json({ ok: true, item: itemInfo.rows[0], history: list });
    } catch (e) { 
      console.error('History error:', e.message);
      res.json({ ok: false, error: e.message }); 
    }
  });

  // 8. API Переименования
  app.post('/api/warehouse/item/rename', async (req, res) => {
    try {
      const itemId = req.body.id;
      const newName = req.body.name;
      const r = await pool.query(
        'SELECT item_id FROM wh_shop_items WHERE id = $1', [itemId]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найден' });
      }
      
      await pool.query(
        'UPDATE wh_items SET name = $1 WHERE id = $2', 
        [newName, r.rows[0].item_id]
      );
      await pool.query(
        'UPDATE wh_shop_items SET custom_name = $1 WHERE id = $2', 
        [newName, itemId]
      );
      await logAction('kupidon', null, 'rename', 
        'Переименование в: ' + newName);
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  // 9. API Объединения (Merge)
  app.post('/api/warehouse/item/merge', async (req, res) => {
    try {
      const sourceId = req.body.source_id;
      const targetName = req.body.target_name;
      const shopId = 'kupidon';

      const targetRes = await pool.query(
        'SELECT i.id FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 AND w.name = $2', [shopId, targetName]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ ok: false, error: 'Целевой товар не найден' });
      }
      const targetId = targetRes.rows[0].id;

      if (sourceId == targetId) {
        return res.json({ ok: false, error: 'Одинаковые товары' });
      }

      await pool.query(
        'UPDATE wh_sale_items SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2', [targetId, sourceId]
      );
      await pool.query(
        'UPDATE wh_receipt_items SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2', [targetId, sourceId]
      );
      await pool.query(
        'UPDATE wh_writeoffs SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2', [targetId, sourceId]
      );

      await pool.query(
        'UPDATE wh_shop_items SET current_stock = current_stock + ' +
        '(SELECT current_stock FROM wh_shop_items WHERE id = $1) ' +
        'WHERE id = $2', [sourceId, targetId]
      );

      await pool.query(
        'DELETE FROM wh_shop_items WHERE id = $1', [sourceId]
      );
      await logAction(shopId, null, 'merge', 
        'Объединение ID ' + sourceId);
      
      res.json({ ok: true });
    } catch (e) { 
      res.status(500).json({ ok: false, error: e.message }); 
    }
  });

  // 10. API Добавления фото
  app.post('/api/warehouse/item/set-photo', async (req, res) => {
    try {
      const shopItemId = req.body.id;
      const url = req.body.url;
      const r = await pool.query(
        'SELECT item_id FROM wh_shop_items WHERE id = $1', [shopItemId]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      
      await pool.query(
        'UPDATE wh_items SET photo_url = $1 WHERE id = $2',
        [url, r.rows[0].item_id]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 11. Экран Карточки Товара (Выписка) с ФОТО
  app.get('/warehouse/item', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.item { background: #fff; border-radius: 10px; ';
    html += 'padding: 12px; margin-bottom: 10px; display: flex; ';
    html += 'justify-content: space-between; align-items: center; ';
    html += 'text-decoration: none; color: ' + brandColor + '; }';
    html += '.item.sale { border-left: 4px solid #2980b9; }'; 
    html += '.item.receipt { border-left: 4px solid #27ae60; }'; 
    html += '.item.writeoff { border-left: 4px solid #e74c3c; }'; 
    html += '.date { font-size: 11px; color: #888; margin-top: 3px; }';
    html += '.amount { font-weight: bold; font-size: 16px; text-align: right; }';
    html += '.reason { font-size: 12px; color: #e74c3c; margin-top: 2px; }';
    html += '.stock-flow { font-size: 13px; color: #555; margin-top: 5px; }';
    html += '.actions { display: flex; gap: 10px; margin-top: 15px; ';
    html += 'justify-content: center; margin-bottom: 15px; }';
    html += '.btn-act { padding: 10px 15px; border-radius: 10px; ';
    html += 'border: none; font-weight: bold; color: #fff; }';
    html += '.btn-rename { background: #f39c12; } ';
    html += '.btn-merge { background: #e74c3c; }';
    html += '.btn-photo { background: #2980b9; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse/inventory" ';
    html += 'class="back">←</a><h1>📦 Выписка</h1></div>';
    
    html += '<input type="file" id="photoInput" accept="image/*" ';
    html += 'style="display:none;" onchange="uploadPhoto()">';

    html += '<div id="header-info" style="text-align:center; ';
    html += 'margin-bottom:15px;"></div>';
    
    html += '<div class="actions" id="actions" style="display:none;">';
    html += '<button class="btn-act btn-rename" ';
    html += 'onclick="renameItem()">✏️ Имя</button>';
    html += '<button class="btn-act btn-merge" ';
    html += 'onclick="mergeItem()">🔗 Слить</button>';
    html += '<button class="btn-act btn-photo" ';
    html += 'onclick="document.getElementById(\'photoInput\').click()">';
    html += '📷 Фото</button>';
    html += '</div>';
    
    html += '<div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var itemId = urlParams.get("id"); var itemName = "";';
    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';
    
    html += 'fetch("/api/warehouse/item/history?id=" + itemId)';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  var hi = document.getElementById("header-info");';
    html += '  if (!d.ok) { ';
    html += 'hi.innerHTML = "<div style=\'color:red\'>Ошибка: " + ';
    html += 'd.error + "</div>"; return; }';
    html += '  if (d.item) {';
    html += '    itemName = d.item.name;';
    html += '    document.getElementById("actions").style.display = "flex";';
    html += '    var col = parseFloat(d.item.current_stock) > 0 ? ';
    html += '"#27ae60" : "#e74c3c";';
    html += '    hi.innerHTML = "<h2 style=\'margin:0;\'>" + ';
    html += 'itemName + "</h2>";';
    html += '    hi.innerHTML += "<div style=\'font-size:20px; ';
    html += 'font-weight:bold; color:" + col + "; margin-top:5px;\'>';
    html += 'Текущий остаток: " + fmtNum(d.item.current_stock) + " шт</div>";';
    html += '  }';
    html += '  if (d.history.length === 0) { ';
    html += 'b.innerHTML = "<div style=\'text-align:center; ';
    html += 'color:#888; margin-top:20px;\'>Нет операций</div>"; return; }';
    
    html += '  d.history.forEach(function(h) {';
    html += '    var a = document.createElement("a");';
    html += '    var ds = new Date(h.date).toLocaleString("ru-RU", ';
    html += '{ day: "2-digit", month: "2-digit", ';
    html += 'hour: "2-digit", minute: "2-digit" });';
    
    html += '    var title = document.createElement("div");';
    html += '    var amt = document.createElement("div");';
    html += '    var dateLbl = document.createElement("div");';
    html += '    dateLbl.className = "date"; dateLbl.innerText = ds;';
    html += '    var stockFlow = document.createElement("div");';
    html += '    stockFlow.className = "stock-flow";';
    html += '    stockFlow.innerText = "Остаток: " + fmtNum(h.stock_before) ';
    html += '+ " → " + fmtNum(h.stock_after);';
    
    html += '    if (h.type === "sale") {';
    html += '      a.className = "item sale";';
    html += '      a.href = "/warehouse/sale/details?id=" + h.id;';
    html += '      title.innerHTML = "<b>💰 Продажа №" + h.id + "</b> (" + ';
    html += '(h.person || "Флорист") + ")";';
    html += '      amt.innerText = "-" + fmtNum(h.qty) + " шт";';
    html += '      amt.style.color = "#2980b9";';
    html += '    } else if (h.type === "writeoff") {';
    html += '      a.className = "item writeoff";';
    html += '      a.href = "/warehouse/documents/details?id=" + h.id ';
    html += '+ "&type=writeoffs";';
    html += '      title.innerHTML = "<b>🗑 Списание №" + h.id + "</b> (" + ';
    html += '(h.person || "Флорист") + ")";';
    html += '      var rs = document.createElement("div");';
    html += '      rs.className = "reason"; rs.innerText = h.reason;';
    html += '      title.appendChild(rs);';
    html += '      amt.innerText = "-" + fmtNum(h.qty) + " шт";';
    html += '      amt.style.color = "#e74c3c";';
    html += '    } else {';
    html += '      a.className = "item receipt";';
    html += '      a.href = "/warehouse/documents/details?id=" + h.id ';
    html += '+ "&type=receipts";';
    html += '      title.innerHTML = "<b>📥 Приход №" + h.id + "</b>";';
    html += '      amt.innerText = "+" + fmtNum(h.qty) + " шт";';
    html += '      amt.style.color = "#27ae60";';
    html += '    }';
    
    html += '    title.appendChild(dateLbl); title.appendChild(stockFlow);';
    html += '    amt.className = "amount";';
    html += '    a.appendChild(title); a.appendChild(amt);';
    html += '    b.appendChild(a);';
    html += '  });';
    html += '});';
    
    html += 'function renameItem() {';
    html += '  var newName = prompt("Введите новое название:", itemName);';
    html += '  if (!newName || newName === itemName) return;';
    html += '  fetch("/api/warehouse/item/rename", { ';
    html += 'method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ id: itemId, name: newName }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { alert("Переименовано"); ';
    html += 'location.reload(); } else alert(d.error); });';
    html += '}';
    
    html += 'function mergeItem() {';
    html += '  var targetName = prompt("Введите название товара, ';
    html += 'В КОТОРЫЙ хотите объединить этот:");';
    html += '  if (!targetName) return;';
    html += '  if (!confirm("Вы уверены? Этот товар будет удален, ';
    html += 'а данные перейдут в \'" + targetName + "\'.")) return;';
    html += '  fetch("/api/warehouse/item/merge", { ';
    html += 'method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ source_id: itemId, ';
    html += 'target_name: targetName }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { alert("Объединено!"); ';
    html += 'window.location.href = "/warehouse/inventory"; } ';
    html += 'else alert(d.error); });';
    html += '}';

    html += 'function uploadPhoto() {';
    html += '  var f = document.getElementById("photoInput").files[0];';
    html += '  if (!f) return;';
    html += '  var rd = new FileReader();';
    html += '  rd.onload = function(e) {';
    html += '    fetch("/api/warehouse/upload", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ image: e.target.result }) })';
    html += '    .then(function(r) { return r.json(); })';
    html += '    .then(function(d) { if(d.ok) { savePhoto(d.url); } });';
    html += '  };';
    html += '  rd.readAsDataURL(f);';
    html += '}';
    html += 'function savePhoto(url) {';
    html += '  fetch("/api/warehouse/item/set-photo", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ id: itemId, url: url }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) {';
    html += '    if(d.ok) { alert("Фото обновлено"); location.reload(); }';
    html += '    else alert(d.error);';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 12. Экран Смены
  app.get('/warehouse/shift', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      const shiftRes = await pool.query(
        'SELECT * FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1', 
        ['kupidon', chatId]
      );
      
      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" ';
      html += 'content="width=device-width, initial-scale=1.0">';
      html += '<style>';
      html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
      html += 'background: #fafaf8; color: ' + brandColor + '; }';
      html += '.header { display: flex; align-items: center; ';
      html += 'margin-bottom: 15px; }';
      html += '.back { font-size: 24px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; margin-right: 15px; }';
      html += '.card { background: #fff; border-radius: 15px; ';
      html += 'padding: 20px; }';
      html += '.btn { width: 100%; padding: 15px; color: #fff; ';
      html += 'border: none; border-radius: 10px; font-size: 18px; ';
      html += 'font-weight: bold; margin-top: 15px; }';
      html += '.btn-green { background: #27ae60; }';
      html += '.btn-red { background: #e74c3c; }';
      html += 'input { width: 100%; padding: 15px; font-size: 20px; ';
      html += 'border: 2px solid #ddd; border-radius: 10px; ';
      html += 'margin-top: 5px; box-sizing: border-box; }';
      html += 'label { display: block; margin-top: 15px; ';
      html += 'font-weight: bold; }';
      html += '.stats { margin-top: 15px; font-size: 14px; }';
      html += '.stats div { display: flex; justify-content: space-between; }';
      html += '</style></head><body>';

      html += '<div class="header"><a href="/warehouse-app" ';
      html += 'class="back">←</a><h1>⏱ Смена</h1></div>';

      if (shiftRes.rows.length === 0) {
        html += '<div class="card"><h3>Открытие смены</h3>';
        html += '<p>Укажите сумму наличных в кассе на начало дня.</p>';
        html += '<label>Наличные в кассе (₽)</label>';
        html += '<input type="number" id="startCash" placeholder="0">';
        html += '<button class="btn btn-green" onclick="openShift()">';
        html += 'Открыть смену</button></div>';
      } else {
        const shift = shiftRes.rows[0];
        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t ' +
          'FROM wh_sales WHERE shop_id = $1 AND date >= $2', 
          ['kupidon', shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const card = parseFloat(st.k || 0);
        const qr = parseFloat(st.q || 0);
        const total = parseFloat(st.t || 0);
        const start = parseFloat(shift.start_cash);

        html += '<div class="card"><h3>Смена открыта</h3>';
        html += '<div class="stats">';
        html += '<div><span>Наличные:</span> ';
        html += '<b>' + cash + ' ₽</b></div>';
        html += '<div><span>Карта:</span> ';
        html += '<b>' + card + ' ₽</b></div>';
        html += '<div><span>QR:</span> ';
        html += '<b>' + qr + ' ₽</b></div>';
        html += '<hr><div><span>Общая выручка:</span> ';
        html += '<b>' + total + ' ₽</b></div>';
        html += '</div>';
        
        html += '<label>Фактически наличных в кассе (₽)</label>';
        html += '<input type="number" id="endCash" ';
        html += 'placeholder="' + (start + cash) + '">';
        html += '<p style="font-size:12px; color:#888;">';
        html += 'Ожидается: ' + (start + cash) + ' ₽ ';
        html += '(Остаток на старте + Наличные)</p>';
        html += '<button class="btn btn-red" onclick="closeShift()">';
        html += 'Закрыть смену</button></div>';
      }

      html += '<script>';
      html += 'function openShift() {';
      html += '  var v = document.getElementById("startCash").value || 0;';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ action: "open", val: v }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) location.reload(); else alert(d.error);';
      html += '  });';
      html += '}';
      
      html += 'function closeShift() {';
      html += '  var v = document.getElementById("endCash").value;';
      html += '  if (!v) { alert("Введите сумму"); return; }';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ action: "close", val: v }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { alert("Смена закрыта"); ';
      html += 'window.location.href = "/warehouse-app"; } ';
      html += '    else alert(d.error);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) { res.status(500).send(e.message); }
  });

  // 13. API Смены
  app.post('/api/warehouse/shift', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      if (req.body.action === 'open') {
        await pool.query(
          'INSERT INTO wh_shifts (shop_id, chat_id, start_cash) ' +
          'VALUES ($1, $2, $3)', 
          ['kupidon', chatId, req.body.val]
        );
      } else {
        const shiftRes = await pool.query(
          'SELECT id, start_cash, open_time FROM wh_shifts ' +
          'WHERE shop_id = $1 AND chat_id = $2 AND status = \'open\' ' +
          'ORDER BY open_time DESC LIMIT 1', ['kupidon', chatId]
        );
        if (shiftRes.rows.length === 0) {
          return res.json({ ok: false, error: 'Смена не найдена' });
        }
        const shift = shiftRes.rows[0];
        
        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t ' +
          'FROM wh_sales WHERE shop_id = $1 AND date >= $2', 
          ['kupidon', shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const card = parseFloat(st.k || 0);
        const qr = parseFloat(st.q || 0);
        const total = parseFloat(st.t || 0);
        
        const expected = parseFloat(shift.start_cash) + cash;
        const actual = parseFloat(req.body.val);
        const discrepancy = actual - expected;

        await pool.query(
          'UPDATE wh_shifts SET close_time = NOW(), ' +
          'end_cash_fact = $1, total_sales = $2, cash_sales = $3, ' +
          'card_sales = $4, qr_sales = $5, discrepancy = $6, ' +
          'status = \'closed\' WHERE id = $7',
          [actual, total, cash, card, qr, discrepancy, shift.id]
        );
        await logAction('kupidon', chatId, 'shift', 
          'Закрыта смена. Расхождение: ' + discrepancy);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 14. Экран Продажи (Касса) - НОВЫЙ ДИЗАЙН
  app.get('/warehouse/sale', async (req, res) => {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/wh_auth=(\d+)/);
    const chatId = match ? Number(match[1]) : null;
    
    const shiftRes = await pool.query(
      'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
      'AND chat_id = $2 AND status = \'open\' LIMIT 1', 
      ['kupidon', chatId]
    );
    
    if (shiftRes.rows.length === 0) {
      return res.send('<html><body style="text-align:center; ' +
        'padding:50px; font-family:sans-serif;">' +
        '<h2>Смена не открыта</h2>' +
        '<a href="/warehouse/shift">Открыть смену</a>' +
        '</body></html>');
    }

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 10px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 10px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; margin-bottom: 10px; ';
    html += 'box-sizing: border-box; }';
    html += '.h-scroll { display: flex; overflow-x: auto; gap: 8px; ';
    html += 'margin-bottom: 10px; padding-bottom: 5px; }';
    html += '.cat-btn { padding: 8px 15px; border: 1px solid #ddd; ';
    html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
    html += 'font-size: 14px; white-space: nowrap; }';
    html += '.cat-btn.active { background: ' + brandColor + '; ';
    html += 'color: #fff; border-color: ' + brandColor + '; }';
    html += '.grid { display: grid; grid-template-columns: 1fr 1fr; ';
    html += 'gap: 8px; }';
    html += '.card { background: #fff; padding: 8px; ';
    html += 'border-radius: 8px; text-align: center; cursor: pointer; }';
    html += '.card img { width: 100%; height: 60px; object-fit: cover; ';
    html += 'border-radius: 4px; }';
    html += '.card .ph { height: 60px; font-size: 20px; ';
    html += 'line-height: 60px; }';
    html += '.card .stock { font-size: 10px; color: #27ae60; }';
    html += '.basket { background: #fff; border-radius: 12px; ';
    html += 'padding: 10px; margin-bottom: 10px; ';
    html += 'border: 2px solid ' + brandColor + '; display: none; }';
    html += '.b-row { display: grid; ';
    html += 'grid-template-columns: 1fr 110px 30px; gap: 5px; ';
    html += 'align-items: center; margin-bottom: 5px; ';
    html += 'font-size: 14px; }';
    html += '.qty-btn { background: #eee; border: none; padding: 5px 10px; ';
    html += 'border-radius: 4px; font-weight: bold; }';
    html += '.qty-input { width: 40px; text-align: center; ';
    html += 'font-size: 16px; font-weight: bold; border: 1px solid #ddd; ';
    html += 'border-radius: 4px; padding: 4px 0; }';
    html += '.pay-btn { padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; background: #fff; cursor: pointer; ';
    html += 'flex: 1; text-align: center; }';
    html += '.pay-btn.active { background: #e0f7fa; ';
    html += 'border-color: #00acc1; }';
    html += '.numpad { display: grid; ';
    html += 'grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-top: 10px; }';
    html += '.numpad button { padding: 15px; font-size: 20px; ';
    html += 'border: none; background: #fff; border-radius: 8px; ';
    html += 'box-shadow: 0 2px 4px rgba(0,0,0,0.1); }';
    html += '.pay-input-row { display: flex; gap: 5px; margin-top: 10px; }';
    html += '.pay-input-row input { font-size: 24px; font-weight: bold; ';
    html += 'text-align: right; flex: 1; padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; box-sizing: border-box; }';
    html += '.pay-input-row button { background: ' + brandColor + '; color: #fff; ';
    html += 'border: none; border-radius: 8px; padding: 0 15px; ';
    html += 'font-size: 16px; font-weight: bold; white-space: nowrap; }';
    html += '.btn-submit { width: 100%; padding: 15px; font-size: 18px; ';
    html += 'font-weight: bold; color: #fff; background: #ccc; ';
    html += 'border: none; border-radius: 10px; margin-top: 10px; }';
    html += '.btn-submit.ready { background: #27ae60; }';
    html += '.pay-list { font-size: 14px; margin-top: 10px; }';
    html += '.pay-item { display: flex; justify-content: space-between; ';
    html += 'margin-bottom: 5px; color: #27ae60; font-weight: bold; }';
    html += '.modal-bg { display: none; position: fixed; top: 0; left: 0; ';
    html += 'width: 100%; height: 100%; background: rgba(0,0,0,0.6); ';
    html += 'align-items: center; justify-content: center; z-index: 1000; }';
    html += '.modal { background: #fff; padding: 30px; border-radius: 20px; ';
    html += 'width: 85%; max-width: 350px; text-align: center; }';
    html += '.modal h1 { color: #27ae60; font-size: 24px; margin: 0 0 10px 0; }';
    html += '.modal .change { font-size: 36px; font-weight: bold; ';
    html += 'color: ' + brandColor + '; margin: 15px 0; }';
    html += '.modal .change-label { font-size: 16px; color: #888; }';
    html += '.modal .change-methods { display: flex; gap: 5px; margin: 15px 0; }';
    html += '.modal .change-method { flex: 1; padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; cursor: pointer; font-size: 12px; text-align: center; }';
    html += '.modal .change-method.active { background: #e0f7fa; ';
    html += 'border-color: #00acc1; font-weight: bold; }';
    html += '.modal button.close-btn { width: 100%; padding: 15px; border: none; ';
    html += 'border-radius: 10px; font-size: 18px; font-weight: bold; color: #fff; ';
    html += 'background: #27ae60; margin-top: 15px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" ';
    html += 'class="back">←</a><h1>💰 Касса</h1></div>';
    
    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    
    html += '<div class="h-scroll" id="catList">';
    html += '<div class="cat-btn active" id="cat-0" ';
    html += 'onclick="setCat(0)">Все</div>';
    html += '</div>';

    html += '<div class="basket" id="basket">';
    html += '<div id="bList"></div>';
    
    html += '<div style="border-top:1px solid #eee; ';
    html += 'margin-top:5px; padding-top:5px;">';
    html += '<label style="font-size:12px;">Сумма чека (можно менять)</label>';
    html += '<input type="number" id="totalPrice" ';
    html += 'style="font-size:24px; font-weight:bold; width:100%; ';
    html += 'border:1px solid #ddd; border-radius:8px; ';
    html += 'padding:5px; box-sizing:border-box;" value="0" ';
    html += 'oninput="onManualPriceChange()">';
    html += '</div>';
    
    html += '<div style="display:flex; gap:5px; margin-top:10px;">';
    html += '<div class="pay-btn active" id="btn-cash" ';
    html += 'onclick="setPay(\'cash\')">💵 Нал</div>';
    html += '<div class="pay-btn" id="btn-card" ';
    html += 'onclick="setPay(\'card\')">💳 Карта</div>';
    html += '<div class="pay-btn" id="btn-qr" ';
    html += 'onclick="setPay(\'qr\')">📱 QR</div>';
    html += '</div>';

    html += '<div style="margin-top:10px;" id="payArea">';
    html += '<div class="pay-input-row">';
    html += '<input type="number" id="payAmount" placeholder="Сумма" ';
    html += 'onclick="this.select()">';
    html += '<button onclick="addPayment()">Внести</button>';
    html += '</div>';
    
    html += '<div class="numpad">';
    html += '<button onclick="num(\'1\')">1</button>';
    html += '<button onclick="num(\'2\')">2</button>';
    html += '<button onclick="num(\'3\')">3</button>';
    html += '<button onclick="num(\'4\')">4</button>';
    html += '<button onclick="num(\'5\')">5</button>';
    html += '<button onclick="num(\'6\')">6</button>';
    html += '<button onclick="num(\'7\')">7</button>';
    html += '<button onclick="num(\'8\')">8</button>';
    html += '<button onclick="num(\'9\')">9</button>';
    html += '<button onclick="num(\'C\')" style="color:red;">C</button>';
    html += '<button onclick="num(\'0\')">0</button>';
    html += '<button onclick="num(\'X\')">⌫</button>';
    html += '</div>';
    html += '</div>';
    
    html += '<div class="pay-list" id="payList"></div>';
    html += '<div style="text-align:center; margin-top:5px; ';
    html += 'font-size:14px; font-weight:bold;" id="remainTxt"></div>';
    
    html += '<button class="btn-submit" id="btnSubmit" ';
    html += 'onclick="saveSale()">Принять оплату</button>';
    html += '</div>';

    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<div class="modal-bg" id="successModal">';
    html += '<div class="modal">';
    html += '<h1>🎉 Успешно!</h1>';
    html += '<div style="font-size:18px; margin-bottom:10px;">Продажа оформлена</div>';
    html += '<div id="changeBlock" style="display:none;">';
    html += '<div class="change-label">СДАЧА:</div>';
    html += '<div class="change" id="changeAmount">0</div>';
    html += '<div class="change-label">Куда выдать?</div>';
    html += '<div class="change-methods" id="changeMethods">';
    html += '<div class="change-method active" id="cm-cash" onclick="setChangeMethod(\'cash\')">💵 Нал</div>';
    html += '<div class="change-method" id="cm-card" onclick="setChangeMethod(\'card\')">💳 Карта</div>';
    html += '<div class="change-method" id="cm-qr" onclick="setChangeMethod(\'qr\')">📱 QR</div>';
    html += '</div></div>';
    html += '<button class="close-btn" id="closeSuccessBtn" onclick="closeSuccess()">Готово</button>';
    html += '</div></div>';
    html += '<script>';
    html += 'var allItems = []; var cart = []; ';
    html += 'var payMethod = "cash"; var payments = []; ';
    html += 'var changeMethod = "cash"; var currentCat = 0;';
    
    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';
    
    html += 'fetch("/api/warehouse/categories")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  if (d.ok) {';
    html += '    var cl = document.getElementById("catList");';
    html += '    d.categories.forEach(function(c) {';
    html += '      var div = document.createElement("div");';
    html += '      div.className = "cat-btn"; div.id = "cat-" + c.id;';
    html += '      div.innerText = c.name;';
    html += '      div.onclick = function() { setCat(c.id); };';
    html += '      cl.appendChild(div);';
    html += '    });';
    html += '  }';
    html += '});';

    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { allItems = d.items; render(); });';

    html += 'function setCat(id) {';
    html += '  currentCat = id;';
    html += '  var els = document.querySelectorAll(".cat-btn");';
    html += '  els.forEach(function(el) { el.classList.remove("active"); });';
    html += '  document.getElementById("cat-" + id).classList.add("active");';
    html += '  filterItems();';
    html += '}';

    html += 'function render() { filterItems(); }';

    html += 'function filterItems() { ';
    html += '  var q = document.getElementById("search").value.toLowerCase(); ';
    html += '  var items = allItems.filter(function(i) { ';
    html += '    var matchQ = i.name.toLowerCase().includes(q); ';
    html += '    var matchC = (currentCat === 0 || i.category_id === currentCat);';
    html += '    return matchQ && matchC; }); ';
    html += '  drawCards(items); ';
    html += '}';

    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(function(item) {';
    html += '    var d = document.createElement("div"); d.className = "card";';
    html += '    var img = item.photo_url ? \'<img src="\' + ';
    html += 'item.photo_url + \'">\' : \'<div class="ph">📷</div>\';';
    html += '    d.innerHTML = img + \'<div>\' + item.name + \'</div>\';';
    html += '    d.innerHTML += \'<div class="stock">Ост: \' + ';
    html += 'fmtNum(item.current_stock) + \'</div>\';';
    html += '    d.onclick = function() { addToCart(item); }; ';
    html += 'g.appendChild(d);';
    html += '  });';
    html += '}';

    html += 'function addToCart(item) {';
    html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
    html += '  if (ex) ex.qty += 1; else cart.push({ id: item.id, ';
    html += 'name: item.name, qty: 1, retail: item.retail_price || 0 });';
    html += '  resetPayments();';
    html += '}';
    
    html += 'function resetPayments() {';
    html += '  payments = [];';
    html += '  renderBasket();';
    html += '}';

    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket"); ';
    html += 'var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = ""; var total = 0;';
    html += '  cart.forEach(function(item, idx) {';
    html += '    total += (item.retail * item.qty);';
    html += '    var div = document.createElement("div"); ';
    html += 'div.className = "b-row";';
    html += '    var name = document.createElement("div"); ';
    html += 'name.innerText = item.name;';
    html += '    var ctrl = document.createElement("div"); ';
    html += 'ctrl.style = "display:flex; justify-content:space-between; ';
    html += 'align-items:center; gap:4px;";';
    html += '    var mn = document.createElement("button"); ';
    html += 'mn.innerText = "-"; mn.className = "qty-btn"; ';
    html += 'mn.onclick = function() { changeQty(idx, -1); };';
    html += '    var vl = document.createElement("input"); ';
    html += 'vl.type = "number"; vl.className = "qty-input"; ';
    html += 'vl.value = item.qty; vl.onclick = function() { ';
    html += 'this.select(); }; vl.onchange = function() { ';
    html += 'var v = parseFloat(this.value); if(v>0) { ';
    html += 'cart[idx].qty = v; resetPayments(); } };';
    html += '    var pl = document.createElement("button"); ';
    html += 'pl.innerText = "+"; pl.className = "qty-btn"; ';
    html += 'pl.onclick = function() { changeQty(idx, 1); };';
    html += '    ctrl.appendChild(mn); ctrl.appendChild(vl); ';
    html += 'ctrl.appendChild(pl);';
    html += '    var del = document.createElement("span"); ';
    html += 'del.innerText = "✕"; del.style = "color:red; ';
    html += 'cursor:pointer; font-size:20px; text-align:center;"; ';
    html += 'del.onclick = function() { cart.splice(idx, 1); ';
    html += 'resetPayments(); };';
    html += '    div.appendChild(name); div.appendChild(ctrl); ';
    html += 'div.appendChild(del);';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '  document.getElementById("totalPrice").value = total;';
    html += '  renderPayments();';
    html += '}';

    html += 'function changeQty(idx, delta) {';
    html += '  cart[idx].qty += delta;';
    html += '  if (cart[idx].qty <= 0) cart.splice(idx, 1);';
    html += '  resetPayments();';
    html += '}';

    html += 'function onManualPriceChange() { resetPayments(); }';

    html += 'function setPay(method) {';
    html += '  payMethod = method;';
    html += '  var els = document.querySelectorAll(".pay-btn");';
    html += '  els.forEach(function(b) { b.classList.remove("active"); });';
    html += '  document.getElementById("btn-" + method).classList.add("active");';
    html += '}';

    html += 'function num(v) {';
    html += '  var inp = document.getElementById("payAmount");';
    html += '  if (v === "C") inp.value = "";';
    html += '  else if (v === "X") inp.value = inp.value.slice(0, -1);';
    html += '  else inp.value += v;';
    html += '}';

    html += 'function addPayment() {';
    html += '  var pa = document.getElementById("payAmount").value;';
    html += '  var val = parseFloat(pa);';
    html += '  if (!val || val <= 0) { alert("Введите сумму"); return; }';
    html += '  payments.push({ method: payMethod, amount: val });';
    html += '  document.getElementById("payAmount").value = "";';
    html += '  renderPayments();';
    html += '}';

    html += 'function renderPayments() {';
    html += '  var tp = document.getElementById("totalPrice").value;';
    html += '  var total = parseFloat(tp) || 0;';
    html += '  var paid = 0;';
    html += '  var pl = document.getElementById("payList"); pl.innerHTML = "";';
    html += '  payments.forEach(function(p) {';
    html += '    paid += p.amount;';
    html += '    var mn = p.method === "cash" ? "Нал" : ';
    html += '(p.method === "card" ? "Карта" : "QR");';
    html += '    pl.innerHTML += "<div class=\'pay-item\'><span>" + mn + ';
    html += '"</span><span>" + p.amount + " ₽</span></div>";';
    html += '  });';
    html += '  var remain = total - paid;';
    html += '  var rTxt = document.getElementById("remainTxt");';
    html += '  var btn = document.getElementById("btnSubmit");';
    html += '  var amtInp = document.getElementById("payAmount");';
    
    html += '  if (remain > 0) {';
    html += '    rTxt.innerText = "Осталось внести: " + remain + " ₽";';
    html += '    rTxt.style.color = "#e74c3c";';
    html += '    btn.classList.remove("ready");';
    html += '    if (!amtInp.value) amtInp.value = remain;';
    html += '  } else if (remain < 0) {';
    html += '    rTxt.innerText = "Сдача: " + Math.abs(remain) + " ₽";';
    html += '    rTxt.style.color = "#2980b9";';
    html += '    btn.classList.add("ready");';
    html += '    amtInp.value = "";';
    html += '  } else {';
    html += '    rTxt.innerText = "Оплачено полностью";';
    html += '    rTxt.style.color = "#27ae60";';
    html += '    btn.classList.add("ready");';
    html += '    amtInp.value = "";';
    html += '  }';
    html += '}';

    html += 'function setChangeMethod(m) {';
    html += '  changeMethod = m;';
    html += '  var els = document.querySelectorAll(".change-method");';
    html += '  els.forEach(function(el) { el.classList.remove("active"); });';
    html += '  document.getElementById("cm-" + m).classList.add("active");';
    html += '}';

    html += 'function saveSale() {';
    html += '  var btn = document.getElementById("btnSubmit");';
    html += '  if (!btn.classList.contains("ready")) { ';
    html += 'alert("Оплата не завершена"); return; }';
    
    html += '  btn.disabled = true; btn.innerText = "Отправка...";';
    
    html += '  var tp = document.getElementById("totalPrice").value;';
    html += '  var total = parseFloat(tp);';
    html += '  var paid = 0;';
    html += '  payments.forEach(function(p) { paid += p.amount; });';
    html += '  var change = paid - total;';
    
    html += '  var finalPayments = JSON.parse(JSON.stringify(payments));';
    html += '  if (change > 0) {';
    html += '    var found = false;';
    html += '    for (var i = 0; i < finalPayments.length; i++) {';
    html += '      if (finalPayments[i].method === changeMethod) {';
    html += '        if (finalPayments[i].amount >= change) {';
    html += '          finalPayments[i].amount -= change;';
    html += '          found = true; break;';
    html += '        } else {';
    html += '          btn.disabled = false; btn.innerText = "Принять оплату";';
    html += '          alert("Недостаточно средств для сдачи");';
    html += '          return;';
    html += '        }';
    html += '      }';
    html += '    }';
    html += '    if (!found) {';
    html += '      btn.disabled = false; btn.innerText = "Принять оплату";';
    html += '      alert("Вы не вносили оплату этим способом"); return;';
    html += '    }';
    html += '  }';

    html += '  fetch("/api/warehouse/sale", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "kupidon", ';
    html += 'real_price: total, payments: finalPayments, items: cart }) })';
    
    html += '  .then(function(r) { return r.json(); }).then(function(d) {';
    html += '    if (d.ok) {';
    html += '      var cBlock = document.getElementById("changeBlock");';
    html += '      var sModal = document.getElementById("successModal");';
    html += '      if (change > 0) {';
    html += '        var cAmt = document.getElementById("changeAmount");';
    html += '        cAmt.innerText = change + " ₽";';
    html += '        cBlock.style.display = "block";';
    html += '        sModal.style.display = "flex";';
    html += '      } else {';
    html += '        cBlock.style.display = "none";';
    html += '        sModal.style.display = "flex";';
    html += '      }';
    html += '    } else {';
    html += '      btn.disabled = false; btn.innerText = "Принять оплату";';
    html += '      alert("Ошибка: " + (d.error || "unknown"));';
    html += '    }';
    html += '  });';
    html += '}';

    html += 'function closeSuccess() {';
    html += '  window.location.reload();';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 15. API Продажи (Обновленный)
  app.post('/api/warehouse/sale', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      const real_price = parseFloat(req.body.real_price);
      const payments = req.body.payments || [];
      
      let payCash = 0, payCard = 0, payQr = 0;
      payments.forEach(function(p) {
        if (p.method === 'cash') payCash += p.amount;
        if (p.method === 'card') payCard += p.amount;
        if (p.method === 'qr') payQr += p.amount;
      });

      const saleRes = await pool.query(
        'INSERT INTO wh_sales (shop_id, real_price, chat_id, ' +
        'pay_cash, pay_card, pay_qr) VALUES ($1, $2, $3, $4, $5, $6) ' +
        'RETURNING id', 
        [req.body.shopId, real_price, chatId, payCash, payCard, payQr]
      );
      const saleId = saleRes.rows[0].id;
      let itemsStr = '';

      for (var item of req.body.items) {
        await pool.query(
          'UPDATE wh_shop_items SET current_stock = current_stock - $1 ' +
          'WHERE id = $2', [item.qty, item.id]
        );
        const costQ = await pool.query(
          'SELECT avg_cost FROM wh_shop_items WHERE id = $1', [item.id]
        );
        await pool.query(
          'INSERT INTO wh_sale_items (sale_id, shop_item_id, ' +
          'qty, cost_at_sale) VALUES ($1, $2, $3, $4)', 
          [saleId, item.id, item.qty, costQ.rows[0].avg_cost || 0]
        );
        itemsStr += item.name + ' x' + item.qty + ', ';
      }
      if (itemsStr.length > 2) itemsStr = itemsStr.slice(0, -2);

      await logAction(req.body.shopId, chatId, 'sale', 
        'Продажа на ' + real_price + ' ₽. Товары: ' + itemsStr, saleId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // 16. Экран Списка накладных
  app.get('/warehouse/receipts', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.btn-new { display: block; width: 100%; padding: 15px; ';
    html += 'background: ' + brandColor + '; color: #fff; ';
    html += 'text-align: center; text-decoration: none; ';
    html += 'border-radius: 10px; font-size: 18px; font-weight: bold; ';
    html += 'margin-bottom: 15px; box-sizing: border-box; }';
    html += '.doc { background: #fff; border-radius: 10px; padding: 15px; ';
    html += 'margin-bottom: 10px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; display: flex; ';
    html += 'justify-content: space-between; align-items: center; }';
    html += '.doc.completed { border-left: 4px solid #27ae60; }';
    html += '.doc.draft { border-left: 4px solid #f39c12; ';
    html += 'background: #fffdf7; }';
    html += '.meta { font-size: 12px; color: #888; margin-top: 4px; }';
    html += '.amount { font-weight: bold; font-size: 16px; }';
    html += '.del-btn { font-size: 20px; color: #e74c3c; ';
    html += 'margin-left: 10px; cursor: pointer; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" ';
    html += 'class="back">←</a>';
    html += '<h1>📥 Приходы</h1></div>';
    html += '<a href="/warehouse/receipt/new" class="btn-new">';
    html += '+ Создать накладную</a>';
    html += '<div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/receipts?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok || d.docs.length === 0) { ';
    html += 'b.innerHTML = "Накладных нет"; return; }';
    html += '  d.docs.forEach(function(doc) {';
    html += '    var a = document.createElement("a");';
    html += '    var st = doc.status === "draft" ? "draft" : "completed";';
    html += '    a.className = "doc " + st;';
    html += '    if (st === "draft") { ';
    html += 'a.href = "/warehouse/receipt/edit?id=" + doc.id; } ';
    html += 'else { a.href = "/warehouse/documents/details?id=" + doc.id ';
    html += '+ "&type=receipts"; }';
    
    html += '    var ds = new Date(doc.date).toLocaleString("ru-RU");';
    html += '    var author = doc.author || "Флорист";';
    html += '    var statusTxt = st === "draft" ? "⚠️ Черновик" : "Накладная";';
    html += '    var div = document.createElement("div");';
    html += '    div.innerHTML = "<div><b>" + statusTxt + " №" + doc.id + "</b>";';
    html += '    div.innerHTML += "<div class=\'meta\'>" + ds + " · " + author + "</div></div>";';
    html += '    div.innerHTML += "<div class=\'amount\'>" + ';
    html += 'parseFloat(doc.total_sum).toLocaleString("ru-RU") + " ₽</div>";';
    html += '    a.appendChild(div);';
    
    html += '    if (st === "draft") {';
    html += '      var del = document.createElement("span");';
    html += '      del.innerText = "🗑"; del.className = "del-btn";';
    html += '      del.onclick = function(e) { e.preventDefault(); ';
    html += 'e.stopPropagation(); deleteDraft(doc.id); };';
    html += '      a.appendChild(del);';
    html += '    }';
    html += '    b.appendChild(a);';
    html += '  });';
    html += '});';
    
    html += 'function deleteDraft(id) {';
    html += '  if (!confirm("Удалить черновик №" + id + "?")) return;';
    html += '  fetch("/api/warehouse/receipt/delete", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ id: id }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if(d.ok) { location.reload(); } ';
    html += 'else alert(d.error); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 17. API Удаления черновика
  app.post('/api/warehouse/receipt/delete', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT status FROM wh_receipts WHERE id = $1', [req.body.id]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найдено' });
      }
      if (r.rows[0].status !== 'draft') {
        return res.json({ ok: false, error: 'Можно удалять только черновики' });
      }
      await pool.query('DELETE FROM wh_receipts WHERE id = $1', [req.body.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 18. API Списка накладных
  app.get('/api/warehouse/receipts', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT r.id, r.date, r.total_sum, r.status, a.name as author ' +
        'FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'WHERE r.shop_id = $1 ORDER BY r.date DESC LIMIT 30', 
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, docs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 19. Создание черновика
  app.get('/warehouse/receipt/new', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      const r = await pool.query(
        'INSERT INTO wh_receipts (shop_id, chat_id, status) ' +
        'VALUES ($1, $2, \'draft\') RETURNING id', ['kupidon', chatId]
      );
      res.redirect('/warehouse/receipt/edit?id=' + r.rows[0].id);
    } catch (e) { res.status(500).send('Ошибка создания'); }
  });

  // 20. Экран Редактирования черновика (с категориями)
  app.get('/warehouse/receipt/edit', (req, res) => {
    const receiptId = req.query.id;
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; ';
    html += 'padding: 15px; margin-bottom: 15px; }';
    html += 'label { display: block; font-size: 12px; color: #888; ';
    html += 'margin-bottom: 5px; }';
    html += 'input[type="text"], input[type="number"], select { ';
    html += 'width: 100%; padding: 12px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; margin-bottom: 15px; ';
    html += 'box-sizing: border-box; }';
    html += '.btn-add { width: 100%; background: #2980b9; color: #fff; ';
    html += 'border: none; padding: 12px; border-radius: 8px; ';
    html += 'font-size: 16px; margin-bottom: 15px; }';
    html += '.basket { background: #fff; border-radius: 10px; ';
    html += 'padding: 15px; margin-bottom: 15px; ';
    html += 'border: 2px solid #2980b9; display: none; }';
    html += '.b-row { display: flex; justify-content: space-between; ';
    html += 'margin-bottom: 8px; border-bottom: 1px solid #eee; ';
    html += 'padding-bottom: 8px; font-size: 14px; }';
    html += '.btn-save { width: 100%; background: ' + brandColor + '; ';
    html += 'color: #fff; border: none; padding: 15px; ';
    html += 'border-radius: 10px; font-size: 18px; font-weight: bold; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse/receipts" ';
    html += 'class="back">←</a><h1>📥 Накладная</h1></div>';
    
    html += '<div class="card">';
    html += '<label>Название</label>';
    html += '<input type="text" id="itemName" list="itemsList" ';
    html += 'placeholder="Начните вводить...">';
    html += '<datalist id="itemsList"></datalist>';
    html += '<label>Категория (для нового товара)</label>';
    html += '<select id="itemCategory"></select>';
    html += '<label>Количество</label>';
    html += '<input type="number" id="itemQty" step="0.1">';
    html += '<label>Цена закупки</label><input type="number" id="itemPrice">';
    html += '<label>Розничная цена</label>';
    html += '<input type="number" id="itemRetail">';
    html += '</div>';
    
    html += '<button class="btn-add" onclick="addToBasket()">';
    html += '+ Добавить в накладную</button>';
    
    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">В накладной:</h3>';
    html += '<div id="bList"></div>';
    html += '<button class="btn-save" id="btnSaveReceipt" style="margin-top:15px;" ';
    html += 'onclick="saveReceipt()">Провести накладную</button>';
    html += '</div>';
    
    html += '<script>';
    html += 'var receiptId = "' + receiptId + '";';
    
    html += 'fetch("/api/warehouse/categories")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { ';
    html += 'var sel = document.getElementById("itemCategory"); ';
    html += 'd.categories.forEach(function(c) { ';
    html += 'var opt = document.createElement("option"); ';
    html += 'opt.value = c.id; opt.innerText = c.name; sel.appendChild(opt); }); } });';

    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { ';
    html += 'var dl = document.getElementById("itemsList"); ';
    html += 'd.items.forEach(function(i) { ';
    html += 'var opt = document.createElement("option"); ';
    html += 'opt.value = i.name; dl.appendChild(opt); }); } });';

    html += 'fetch("/api/warehouse/receipt/items?id=" + receiptId)';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { renderList(d.items); } });';

    html += 'function addToBasket() {';
    html += '  var name = document.getElementById("itemName").value;';
    html += '  var qty = document.getElementById("itemQty").value;';
    html += '  var price = document.getElementById("itemPrice").value;';
    html += '  var retail = document.getElementById("itemRetail").value || 0;';
    html += '  var catId = document.getElementById("itemCategory").value;';
    html += '  if (!name || !qty || !price) { alert("Заполните поля"); return; }';
    html += '  fetch("/api/warehouse/receipt/item/add", { ';
    html += 'method: "POST", headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ receipt_id: receiptId, name: name, ';
    html += 'qty: qty, price: price, retail: retail, cat_id: catId }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) {';
    html += '    if (d.ok) { ';
    html += 'document.getElementById("itemName").value = ""; ';
    html += 'document.getElementById("itemQty").value = ""; ';
    html += 'document.getElementById("itemPrice").value = ""; ';
    html += 'document.getElementById("itemRetail").value = ""; ';
    html += 'renderList(d.items); } else alert(d.error);';
    html += '  });';
    html += '}';

    html += 'function renderList(items) {';
    html += '  var b = document.getElementById("basket"); ';
    html += 'var list = document.getElementById("bList");';
    html += '  if (items.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  items.forEach(function(item) {';
    html += '    var div = document.createElement("div"); div.className = "b-row";';
    html += '    var n = document.createElement("span"); n.innerText = item.name;';
    html += '    var p = document.createElement("span"); ';
    html += 'p.innerText = item.qty + " x " + item.unit_cost + " ₽";';
    html += '    div.appendChild(n); div.appendChild(p); list.appendChild(div);';
    html += '  });';
    html += '}';

    html += 'function saveReceipt() {';
    html += '  var btn = document.getElementById("btnSaveReceipt");';
    html += '  btn.disabled = true; btn.innerText = "Проведение...";';
    html += '  fetch("/api/warehouse/receipt/finalize", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ receipt_id: receiptId }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) {';
    html += '    if (d.ok) { alert("Накладная проведена!"); ';
    html += 'window.location.href="/warehouse/receipts"; }';
    html += '    else { btn.disabled = false; btn.innerText = "Провести"; ';
    html += 'alert("Ошибка: " + (d.error || "unknown")); }';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 21. API получения позиций накладной
  app.get('/api/warehouse/receipt/items', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1', [req.query.id]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 22. API добавления позиции (с категорией)
  app.post('/api/warehouse/receipt/item/add', async (req, res) => {
    try {
      const { receipt_id, name, qty, price, retail, cat_id } = req.body;
      let itemRes = await pool.query(
        'SELECT id FROM wh_items WHERE name = $1', [name]
      );
      let itemId;
      if (itemRes.rows.length === 0) {
        const ni = await pool.query(
          'INSERT INTO wh_items (name, unit, category_id) ' +
          'VALUES ($1, \'шт\', $2) RETURNING id', 
          [name, cat_id || null]
        );
        itemId = ni.rows[0].id;
      } else { itemId = itemRes.rows[0].id; }

      let shopItemRes = await pool.query(
        'SELECT id FROM wh_shop_items WHERE shop_id = $1 AND item_id = $2', 
        ['kupidon', itemId]
      );
      let shopItemId;
      if (shopItemRes.rows.length === 0) {
        const nsi = await pool.query(
          'INSERT INTO wh_shop_items (shop_id, item_id) VALUES ($1, $2) RETURNING id', 
          ['kupidon', itemId]
        );
        shopItemId = nsi.rows[0].id;
      } else { shopItemId = shopItemRes.rows[0].id; }

      const sum = Math.round(parseFloat(qty) * parseFloat(price) * 100) / 100;
      await pool.query(
        'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, qty, unit_cost, sum) ' +
        'VALUES ($1, $2, $3, $4, $5)', 
        [receipt_id, shopItemId, qty, price, sum]
      );
      
      await pool.query(
        'UPDATE wh_receipts SET total_sum = total_sum + $1 WHERE id = $2', 
        [sum, receipt_id]
      );
      
      if (parseFloat(retail) > 0) {
        await pool.query(
          'UPDATE wh_shop_items SET retail_price = $1 WHERE id = $2',
          [retail, shopItemId]
        );
      }

      const items = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id WHERE ri.receipt_id = $1', 
        [receipt_id]
      );
      res.json({ ok: true, items: items.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 23. API проведения накладной
  app.post('/api/warehouse/receipt/finalize', async (req, res) => {
    try {
      const receiptId = req.body.receipt_id;
      const items = await pool.query(
        'SELECT shop_item_id, qty, unit_cost FROM wh_receipt_items ' +
        'WHERE receipt_id = $1', [receiptId]
      );
      
      for (var item of items.rows) {
        const curr = await pool.query(
          'SELECT current_stock, avg_cost FROM wh_shop_items WHERE id = $1', 
          [item.shop_item_id]
        );
        let oldStock = parseFloat(curr.rows[0].current_stock);
        let oldAvg = parseFloat(curr.rows[0].avg_cost);
        let qty = parseFloat(item.qty);
        let price = parseFloat(item.unit_cost);
        
        let newStock = oldStock + qty;
        let newAvg = oldStock * oldAvg + qty * price;
        if (newStock > 0) { newAvg = newAvg / newStock; }
        newAvg = Math.round(newAvg * 100) / 100;

        await pool.query(
          'UPDATE wh_shop_items SET current_stock = $1, last_cost = $2, ' +
          'avg_cost = $3 WHERE id = $4',
          [newStock, price, newAvg, item.shop_item_id]
        );
      }
      
      await pool.query(
        'UPDATE wh_receipts SET status = \'completed\' WHERE id = $1', 
        [receiptId]
      );
      await logAction('kupidon', null, 'receipt', 
        'Проведена накладная ID ' + receiptId, receiptId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 24. Экран Списания (с модалкой и успехом)
  app.get('/warehouse/writeoff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; border: 2px solid #eee; ';
    html += 'border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.grid { display: grid; grid-template-columns: ';
    html += 'repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 15px; }';
    html += '.card { background: #fff; padding: 8px; border-radius: 10px; ';
    html += 'text-align: center; cursor: pointer; }';
    html += '.card img { width: 100%; height: 80px; object-fit: cover; ';
    html += 'border-radius: 6px; margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; ';
    html += 'align-items: center; justify-content: center; margin-bottom: 5px; }';
    html += '.card .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }';
    html += '.card .stock { font-size: 11px; color: #27ae60; }';
    html += '.card .stock.zero { color: #e74c3c; }';
    html += '.basket { background: #fff; border-radius: 15px; padding: 15px; ';
    html += 'margin-bottom: 15px; border: 2px solid ' + accentColor + '; display: none; }';
    html += '.b-row { display: flex; justify-content: space-between; ';
    html += 'margin-bottom: 8px; border-bottom: 1px solid #eee; ';
    html += 'padding-bottom: 8px; font-size: 14px; }';
    html += '.reasons { display: grid; grid-template-columns: 1fr 1fr; ';
    html += 'gap: 10px; margin-bottom: 15px; }';
    html += '.reason { padding: 10px; border-radius: 10px; border: 2px solid #eee; ';
    html += 'background: #fff; text-align: center; cursor: pointer; font-size: 14px; }';
    html += '.reason.active { border-color: ' + accentColor + '; ';
    html += 'color: ' + accentColor + '; font-weight: bold; }';
    html += '.btn-save { width: 100%; padding: 15px; background: ' + accentColor + '; ';
    html += 'color: #fff; border: none; border-radius: 10px; font-size: 18px; ';
    html += 'font-weight: bold; }';
    html += '.modal-bg { display: none; position: fixed; top: 0; left: 0; ';
    html += 'width: 100%; height: 100%; background: rgba(0,0,0,0.5); ';
    html += 'align-items: center; justify-content: center; z-index: 1000; }';
    html += '.modal { background: #fff; padding: 20px; border-radius: 15px; ';
    html += 'width: 80%; max-width: 300px; text-align: center; }';
    html += '.modal input { font-size: 24px; text-align: center; ';
    html += 'width: 100%; box-sizing: border-box; padding: 10px; ';
    html += 'border: 1px solid #ddd; border-radius: 8px; margin-bottom: 15px; }';
    html += '.modal-btns { display: flex; gap: 10px; }';
    html += '.modal-btns button { flex: 1; padding: 12px; border: none; ';
    html += 'border-radius: 8px; font-size: 16px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>🗑 Списание</h1></div>';
    
    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">Выбрано:</h3><div id="bList"></div>';
    html += '<label style="margin-top:10px; display:block;">Причина</label><div class="reasons">';
    html += '<div class="reason active" onclick="setR(this, \'spoilage\')">Порча</div>';
    html += '<div class="reason" onclick="setR(this, \'loss\')">Потеря</div>';
    html += '<div class="reason" onclick="setR(this, \'markdown\')">Уценка</div>';
    html += '<div class="reason" onclick="setR(this, \'sorting\')">Пересорт</div>';
    html += '</div>';
    html += '<label>Комментарий</label>';
    html += '<textarea id="comment" style="width:100%; padding:10px; ';
    html += 'border-radius:10px; border:1px solid #ddd; margin-bottom:10px;"></textarea>';
    html += '<label>Фото (необязательно)</label>';
    html += '<input type="file" id="wPhoto" accept="image/*" style="margin-bottom:15px;">';
    html += '<button class="btn-save" id="btnSaveWriteoff" ';
    html += 'onclick="saveWriteoff()">Списать всё</button>';
    html += '</div>';

    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<div class="modal-bg" id="qtyModal">';
    html += '<div class="modal">';
    html += '<h3 style="margin-top:0; color:' + brandColor + ';">Сколько списать?</h3>';
    html += '<input type="number" id="qtyInput" inputmode="decimal">';
    html += '<div class="modal-btns">';
    html += '<button onclick="closeQtyModal()" style="background:#eee; color:#333;">Отмена</button>';
    html += '<button onclick="confirmQty()" style="background:' + brandColor + '; color:#fff;">ОК</button>';
    html += '</div></div></div>';
    
    html += '<div class="modal-bg" id="successModal">';
    html += '<div class="modal">';
    html += '<h1 style="color:#27ae60; font-size:24px; margin:0 0 10px 0;">✅</h1>';
    html += '<div style="font-size:18px; margin-bottom:15px;">Успешно списано!</div>';
    html += '<button class="close-btn" onclick="window.location.href=\'/warehouse-app\'" ';
    html += 'style="width: 100%; padding: 15px; border: none; border-radius: 10px; ';
    html += 'font-size: 18px; font-weight: bold; color: #fff; background: #27ae60;">';
    html += 'Готово</button>';
    html += '</div></div>';
    
    html += '<script>';
    html += 'var allItems = []; var cart = []; var selReason = "spoilage";';
    html += 'var currentItem = null;';
    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(function(r) { ';
    html += 'return r.json(); }).then(function(d) { allItems = d.items; render(); });';
    html += 'function render() { drawCards(allItems); }';
    html += 'function filterItems() { var q = ';
    html += 'document.getElementById("search").value.toLowerCase(); ';
    html += 'drawCards(allItems.filter(function(i) { ';
    html += 'return i.name.toLowerCase().includes(q); })); }';
    
    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(function(i) {';
    html += '    var d = document.createElement("div"); d.className = "card";';
    html += '    var img = i.photo_url ? \'<img src="\' + i.photo_url + \'">\' : ';
    html += '\'<div class="ph">📷</div>\';';
    html += '    var stClass = parseFloat(i.current_stock) > 0 ? "" : "zero";';
    html += '    d.innerHTML = img + \'<div class="name">\' + i.name + \'</div>\';';
    html += '    d.innerHTML += \'<div class="stock \' + stClass + \'">Ост: \' + ';
    html += 'fmtNum(i.current_stock) + \'</div>\';';
    html += '    d.onclick = function() { addToBasket(i); }; g.appendChild(d);';
    html += '  });';
    html += '}';
    
    html += 'function addToBasket(item) {';
    html += '  currentItem = item;';
    html += '  document.getElementById("qtyInput").value = "";';
    html += '  document.getElementById("qtyModal").style.display = "flex";';
    html += '  setTimeout(function() { ';
    html += '    document.getElementById("qtyInput").focus();';
    html += '  }, 100);';
    html += '}';
    
    html += 'function closeQtyModal() {';
    html += '  document.getElementById("qtyModal").style.display = "none";';
    html += '}';
    
    html += 'function confirmQty() {';
    html += '  var q = parseFloat(document.getElementById("qtyInput").value);';
    html += '  if (q && q > 0) {';
    html += '    var ex = cart.find(function(c) { return c.id === currentItem.id; });';
    html += '    if (ex) ex.qty += q; ';
    html += '    else cart.push({ id: currentItem.id, name: currentItem.name, qty: q });';
    html += '    renderBasket();';
    html += '    window.scrollTo(0, 0);';
    html += '  }';
    html += '  closeQtyModal();';
    html += '}';
    
    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket"); var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  cart.forEach(function(item, idx) {';
    html += '    var div = document.createElement("div"); div.className = "b-row";';
    html += '    var span1 = document.createElement("span"); span1.innerText = item.name;';
    html += '    var span2 = document.createElement("span"); ';
    html += 'span2.innerText = fmtNum(item.qty) + " шт"; ';
    html += 'var x = document.createElement("span"); x.innerText = " ✕"; ';
    html += 'x.style = "color:red; cursor:pointer; margin-left:10px;"; ';
    html += 'x.onclick = function() { cart.splice(idx, 1); renderBasket(); }; ';
    html += 'span2.appendChild(x); div.appendChild(span1); div.appendChild(span2); ';
    html += 'list.appendChild(div);';
    html += '  });';
    html += '}';
    
    html += 'function setR(el, r) { ';
    html += 'document.querySelectorAll(".reason").forEach(function(b) { ';
    html += 'b.classList.remove("active"); }); ';
    html += 'el.classList.add("active"); selReason = r; }';
    
    html += 'function saveWriteoff() {';
    html += '  if (cart.length === 0) return;';
    html += '  var btn = document.getElementById("btnSaveWriteoff");';
    html += '  btn.disabled = true; btn.innerText = "Списание...";';
    html += '  var c = document.getElementById("comment").value;';
    html += '  var f = document.getElementById("wPhoto").files[0];';
    html += '  if (f) { var rd = new FileReader(); ';
    html += 'rd.onload = function(e) { upload(e.target.result, c); }; ';
    html += 'rd.readAsDataURL(f); }';
    html += '  else submit(null, c);';
    html += '}';
    html += 'function upload(base64, c) {';
    html += '  fetch("/api/warehouse/upload", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ image: base64 }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'submit(d.url, c); }).catch(function() { submit(null, c); });';
    html += '}';
    html += 'function submit(url, c) {';
    html += '  fetch("/api/warehouse/writeoff", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "kupidon", items: cart, ';
    html += 'reason: selReason, comment: c, photo: url }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'if (d.ok) { ';
    html += 'document.getElementById("successModal").style.display = "flex"; ';
    html += '} else { ';
    html += 'document.getElementById("btnSaveWriteoff").disabled = false; ';
    html += 'document.getElementById("btnSaveWriteoff").innerText = "Списать всё"; ';
    html += 'alert(d.error); } });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 25. API Списания
  app.post('/api/warehouse/writeoff', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      let wId = null;
      for (var item of req.body.items) {
        await pool.query(
          'UPDATE wh_shop_items SET current_stock = current_stock - $1 ' +
          'WHERE id = $2', [item.qty, item.id]
        );
        const wRes = await pool.query(
          'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, ' +
          'comment, photo_url, chat_id) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', 
          [req.body.shopId, item.id, item.qty, req.body.reason, 
           req.body.comment, req.body.photo, chatId]
        );
        if (!wId) wId = wRes.rows[0].id;
      }
      await logAction(req.body.shopId, chatId, 'writeoff', 
        'Списание: ' + req.body.items[0].name + ' и др.', wId);
      await notifyOwner(bot, req.body.shopId, 
        '🗑 Крупное списание!', 'writeoff');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 26. API Загрузки фото
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      const base64Data = req.body.image;
      if (!base64Data) return res.json({ ok: false });
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      const key = 'wh_' + Date.now() + '.jpg';
      const cmd = new PutObjectCommand({ 
        Bucket: YC_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg' 
      });
      await s3.send(cmd);
      const url = 'https://' + YC_BUCKET + '.storage.yandexcloud.net/' + key;
      let urlBackup = null;
      if (s3backup) {
        const cmd2 = new PutObjectCommand({ 
          Bucket: BC_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg' 
        });
        await s3backup.send(cmd2);
        urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
      }
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  // 27. Экран Документов (Список)
  app.get('/warehouse/documents', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.tabs { display: flex; gap: 10px; margin-bottom: 15px; }';
    html += '.tab { flex: 1; padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; background: #fff; text-align: center; ';
    html += 'cursor: pointer; text-decoration: none; color: ' + brandColor + '; }';
    html += '.tab.active { background: ' + brandColor + '; color: #fff; }';
    html += '.doc { background: #fff; border-radius: 10px; padding: 15px; ';
    html += 'margin-bottom: 10px; text-decoration: none; color: ' + brandColor + '; ';
    html += 'display: flex; justify-content: space-between; align-items: center; }';
    html += '.doc.receipt { border-left: 4px solid #3498db; } ';
    html += '.doc.writeoff { border-left: 4px solid ' + accentColor + '; }';
    html += '.meta { font-size: 12px; color: #888; margin-top: 4px; } ';
    html += '.amount { font-weight: bold; font-size: 16px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" ';
    html += 'class="back">←</a><h1>📑 Документы</h1></div>';
    html += '<div class="tabs">';
    html += '<a href="/warehouse/documents?type=receipts" ';
    html += 'class="tab" id="tab-receipts">Приходы</a>';
    html += '<a href="/warehouse/documents?type=writeoffs" ';
    html += 'class="tab" id="tab-writeoffs">Списания</a>';
    html += '</div><div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'var currentType = new URLSearchParams(window.location.search)';
    html += '.get("type") || "receipts";';
    html += 'document.getElementById("tab-" + currentType).classList.add("active");';
    html += 'fetch("/api/warehouse/documents?shop=kupidon&type=" + currentType)';
    html += '.then(function(r) { return r.json(); }).then(function(d) {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok) { b.innerHTML = "Ошибка: " + (d.error || "сервер"); return; }';
    html += '  if (d.docs.length === 0) { ';
    html += 'b.innerHTML = "Документов нет"; return; }';
    
    html += '  d.docs.forEach(function(doc) {';
    html += '    var div = document.createElement("a");';
    html += '    div.className = "doc " + ';
    html += '(currentType === "receipts" ? "receipt" : "writeoff");';
    html += '    div.href = "/warehouse/documents/details?id=" + doc.id + ';
    html += '"&type=" + currentType;';
    html += '    var ds = new Date(doc.date).toLocaleString("ru-RU");';
    html += '    var author = doc.author || "Система";';
    
    html += '    if (currentType === "receipts") {';
    html += '      div.innerHTML = "<div><b>Накладная №" + doc.id + "</b>";';
    html += '      div.innerHTML += "<div class=\'meta\'>" + ds + ';
    html += '" · " + author + "</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:#3498db;\'>+" + ';
    html += 'parseFloat(doc.amount).toLocaleString("ru-RU") + " ₽</div>";';
    html += '    } else {';
    html += '      div.innerHTML = "<div><b>Акт списания №" + doc.id + "</b>";';
    html += '      div.innerHTML += "<div class=\'meta\'>" + ds + ';
    html += '" · " + author + "</div>";';
    html += '      div.innerHTML += "<div class=\'meta\'>" + ';
    html += '(doc.item_name || "") + " (" + doc.reason + ")</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:' + accentColor + '\'>-" + ';
    html += 'parseFloat(doc.amount) + " шт</div>";';
    html += '    }';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 28. API Документов (Список)
  app.get('/api/warehouse/documents', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const type = req.query.type || 'receipts';
      
      if (type === 'receipts') {
        const r = await pool.query(
          'SELECT r.id, r.date, r.total_sum as amount, a.name as author ' +
          'FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
          'WHERE r.shop_id = $1 AND r.status = \'completed\' ' +
          'ORDER BY r.date DESC LIMIT 50', [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      } else {
        const r = await pool.query(
          'SELECT w.id, w.date, w.qty as amount, w.reason, a.name as author, ' +
          'COALESCE(shi.custom_name, i.name) as item_name ' +
          'FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE w.shop_id = $1 ORDER BY w.date DESC LIMIT 50', [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 29. Экран Деталей Документа
  app.get('/warehouse/documents/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; ';
    html += 'padding: 20px; margin-bottom: 15px; }';
    html += '.item-row { display: flex; justify-content: space-between; ';
    html += 'padding: 12px 0; border-bottom: 1px solid #eee; ';
    html += 'text-decoration: none; color: ' + brandColor + '; }';
    html += '.item-row:last-child { border-bottom: none; } ';
    html += '.item-name { font-weight: bold; } ';
    html += '.item-qty { text-align: right; font-weight: bold; }';
    html += '.total-row { margin-top: 15px; padding-top: 15px; ';
    html += 'border-top: 2px solid ' + brandColor + '; display: flex; ';
    html += 'justify-content: space-between; font-size: 18px; font-weight: bold; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse/documents" ';
    html += 'class="back">←</a><h1>📄 Документ</h1></div>';
    html += '<div class="card" id="content">Загрузка...</div>';
    
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search); ';
    html += 'var docId = urlParams.get("id"); var docType = urlParams.get("type");';
    html += 'fetch("/api/warehouse/documents/details?id=" + docId + ';
    html += '"&type=" + docType).then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  if (!d.ok) { ';
    html += 'document.getElementById("content").innerText = ';
    html += '"Ошибка: " + d.error; return; }';
    html += '  var h = d.header; var ds = new Date(h.date).toLocaleString("ru-RU");';
    html += '  var title = docType === "receipts" ? ';
    html += '"Приходная накладная №" : "Акт списания №";';
    html += '  var hc = "<div style=\'font-size:20px; font-weight:bold;\'>" + ';
    html += 'title + h.id + "</div>";';
    html += '  hc += "<div style=\'font-size:14px; color:#666; ';
    html += 'margin-bottom:15px;\'>" + ds + "<br>Сделал: " + ';
    html += '(h.author || "Неизвестно") + "</div>";';
    
    html += '  d.items.forEach(function(i) {';
    html += '    var itemUrl = "/warehouse/item?id=" + i.shop_item_id;';
    html += '    hc += "<a href=\'" + itemUrl + "\' class=\'item-row\'>";';
    html += '    hc += "<div><div class=\'item-name\'>" + i.name + "</div>";';
    
    html += '    if (docType === "receipts") {';
    html += '      hc += "<div style=\'font-size:12px; color:#888;\'>" + ';
    html += 'parseFloat(i.unit_cost).toLocaleString("ru-RU") + " ₽/шт</div></div>";';
    html += '      hc += "<div class=\'item-qty\'>" + parseFloat(i.qty) + " шт<br>";';
    html += '      hc += "<span style=\'font-size:12px; color:#888;\'>" + ';
    html += 'parseFloat(i.sum).toLocaleString("ru-RU") + " ₽</span></div></a>";';
    html += '    } else {';
    html += '      hc += "<div style=\'font-size:12px; color:#888;\'>Причина: " + ';
    html += 'h.reason + "</div></div>";';
    html += '      hc += "<div class=\'item-qty\'>" + parseFloat(i.qty) + " шт</div></a>";';
    html += '    }';
    html += '  });';
    
    html += '  var totalTxt = docType === "receipts" ? ';
    html += 'parseFloat(h.total_sum).toLocaleString("ru-RU") + " ₽" : ';
    html += 'h.total_sum + " шт";';
    html += '  hc += "<div class=\'total-row\'><span>Итого:</span><span>" + ';
    html += 'totalTxt + "</span></div>";';
    html += '  document.getElementById("content").innerHTML = hc;';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 30. API Деталей Документа
  app.get('/api/warehouse/documents/details', async (req, res) => {
    try {
      const id = req.query.id; const type = req.query.type;
      
      if (type === 'receipts') {
        const header = await pool.query(
          'SELECT r.id, r.date, r.total_sum, a.name as author ' +
          'FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
          'WHERE r.id = $1', [id]
        );
        const items = await pool.query(
          'SELECT ri.shop_item_id, ri.qty, ri.unit_cost, ri.sum, ' +
          'COALESCE(shi.custom_name, i.name) as name ' +
          'FROM wh_receipt_items ri ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE ri.receipt_id = $1', [id]
        );
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      } else {
        const header = await pool.query(
          'SELECT w.id, w.date, w.qty as total_sum, w.reason, a.name as author ' +
          'FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
          'WHERE w.id = $1', [id]
        );
        const items = await pool.query(
          'SELECT w.shop_item_id, w.qty, 0 as unit_cost, 0 as sum, ' +
          'COALESCE(shi.custom_name, i.name) as name ' +
          'FROM wh_writeoffs w ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE w.id = $1', [id]
        );
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 31. API Отчётов
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon'; 
      const period = req.query.period || 'all';
      
      let dateFilter = '';
      if (period === 'today') {
        dateFilter = 'AND DATE(date) = CURRENT_DATE';
      }
      if (period === 'week') {
        dateFilter = 'AND date >= NOW() - INTERVAL \'7 days\'';
      }
      if (period === 'month') {
        dateFilter = 'AND date >= NOW() - INTERVAL \'1 month\'';
      }
      
      const rev = await pool.query(
        'SELECT COALESCE(SUM(real_price), 0) AS total ' +
        'FROM wh_sales WHERE shop_id = $1 ' + dateFilter, [shopId]
      );
      
      const loss = await pool.query(
        'SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total ' +
        'FROM wh_writeoffs w JOIN wh_shop_items i ON i.id = w.shop_item_id ' +
        'WHERE w.shop_id = $1 ' + 
        dateFilter.replace('date', 'w.date'), [shopId]
      );
      
      const cost = await pool.query(
        'SELECT COALESCE(SUM(s.qty * s.cost_at_sale), 0) AS total ' +
        'FROM wh_sale_items s JOIN wh_sales sa ON sa.id = s.sale_id ' +
        'WHERE sa.shop_id = $1 ' + 
        dateFilter.replace('date', 'sa.date'), [shopId]
      );
      
      const revenue = parseFloat(rev.rows[0].total) || 0; 
      const losses = parseFloat(loss.rows[0].total) || 0; 
      const costVal = parseFloat(cost.rows[0].total) || 0;
      const profit = revenue - costVal; 
      
      let lossPercent = 0;
      if ((revenue + losses) > 0) {
        lossPercent = Math.round((losses / (revenue + losses)) * 100);
      }
      
      res.json({ ok: true, revenue, profit, losses, lossPercent });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 32. Экран Отчётов
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.filters { display: flex; gap: 10px; margin-bottom: 15px; } ';
    html += '.filter { flex: 1; padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 8px; background: #fff; text-align: center; ';
    html += 'cursor: pointer; font-size: 14px; }';
    html += '.filter.active { background: ' + brandColor + '; color: #fff; } ';
    html += '.card { background: #fff; border-radius: 15px; padding: 20px; ';
    html += 'margin-bottom: 15px; text-align: center; }';
    html += '.val { font-size: 28px; font-weight: bold; } ';
    html += '.blue { color: #2980b9; } .green { color: #27ae60; } ';
    html += '.red { color: ' + accentColor + '; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" ';
    html += 'class="back">←</a><h1>📊 Отчёты</h1></div>';
    
    html += '<div class="filters">';
    html += '<div class="filter" id="f-today" ';
    html += 'onclick="setPeriod(\'today\')">Сегодня</div>';
    html += '<div class="filter" id="f-week" ';
    html += 'onclick="setPeriod(\'week\')">Неделя</div>';
    html += '<div class="filter" id="f-month" ';
    html += 'onclick="setPeriod(\'month\')">Месяц</div>';
    html += '<div class="filter active" id="f-all" ';
    html += 'onclick="setPeriod(\'all\')">Всё</div>';
    html += '</div>';
    
    html += '<div id="load" style="text-align:center;">Загрузка...</div>';
    html += '<div id="cont" style="display:none;">';
    html += '<div class="card"><div>Выручка</div>';
    html += '<div class="val blue" id="rev">0</div></div>';
    html += '<div class="card"><div>Прибыль</div>';
    html += '<div class="val green" id="prof">0</div></div>';
    html += '<div class="card" style="border: 2px solid ' + accentColor + ';">';
    html += '<div>Потери</div>';
    html += '<div class="val red" id="loss">0</div>';
    html += '<div id="pct"></div></div></div>';
    
    html += '<script>';
    html += 'var currentPeriod = "all";';
    html += 'function setPeriod(p) { ';
    html += 'currentPeriod = p; ';
    html += 'document.querySelectorAll(".filter").forEach(function(el) { ';
    html += 'el.classList.remove("active"); }); ';
    html += 'document.getElementById("f-" + p).classList.add("active"); ';
    html += 'loadData(); }';
    
    html += 'function loadData() { ';
    html += 'document.getElementById("load").style.display = "block"; ';
    html += 'document.getElementById("cont").style.display = "none"; ';
    html += 'fetch("/api/warehouse/reports?shop=kupidon&period=" + currentPeriod)';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'if (d.ok) { ';
    html += 'document.getElementById("load").style.display="none"; ';
    html += 'document.getElementById("cont").style.display="block"; ';
    html += 'document.getElementById("rev").innerText = ';
    html += 'd.revenue.toLocaleString("ru-RU") + " ₽"; ';
    html += 'document.getElementById("prof").innerText = ';
    html += 'd.profit.toLocaleString("ru-RU") + " ₽"; ';
    html += 'document.getElementById("loss").innerText = ';
    html += 'd.losses.toLocaleString("ru-RU") + " ₽"; ';
    html += 'document.getElementById("pct").innerText = ';
    html += 'd.lossPercent + "% от закупок"; } }); }';
    
    html += 'loadData();';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 33. API Флористов
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT a.name, a.warehouse_pin, a.can_receipt, ' +
        'a.can_sale, a.can_writeoff, a.chat_id, ' +
        'COALESCE(SUM(s.real_price), 0) as total_sales ' +
        'FROM admins a ' +
        'LEFT JOIN wh_sales s ON a.chat_id = s.chat_id ' +
        'WHERE a.shop_id = $1 AND a.role = \'florist\' ' +
        'GROUP BY a.chat_id, a.name, a.warehouse_pin, ' +
        'a.can_receipt, a.can_sale, a.can_writeoff', 
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, staff: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 34. Экран Флористов
  app.get('/warehouse/staff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 15px; ';
    html += 'margin-bottom: 15px; }';
    html += '.name { font-size: 18px; font-weight: bold; } ';
    html += '.sales { font-size: 20px; color: #27ae60; margin-top: 5px; }';
    html += '.row { display: flex; justify-content: space-between; ';
    html += 'margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }';
    html += '.btn-pin { margin-top:10px; padding:8px 15px; ';
    html += 'border-radius:8px; border:none; background:' + brandColor + '; ';
    html += 'color:#fff; }';
    html += 'input[type="checkbox"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>👥 Флористы</h1></div><div id="list"></div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/staff?shop=kupidon")';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'var b = document.getElementById("list"); ';
    html += 'if (!d.ok || d.staff.length === 0) { ';
    html += 'b.innerHTML = "Нет флористов"; return; } ';
    
    html += 'd.staff.forEach(function(f) { ';
    html += 'var c = document.createElement("div"); c.className = "card"; ';
    html += 'var name = f.name || "Флорист"; ';
    html += 'c.innerHTML = "<div class=\'name\'>" + name + "</div>"; ';
    html += 'var sum = parseFloat(f.total_sales).toLocaleString("ru-RU"); ';
    html += 'c.innerHTML += "<div class=\'sales\'>Продано: " + sum + " ₽</div>"; ';
    html += 'c.innerHTML += "<div style=\'font-size:12px;color:#888;\'>PIN: " + ';
    html += '(f.warehouse_pin || "нет") + "</div>"; ';
    
    html += 'var btn = document.createElement("button"); ';
    html += 'btn.innerText = "Задать PIN"; btn.className = "btn-pin"; ';
    html += 'btn.onclick = function() { setPin(f.chat_id); }; c.appendChild(btn); ';
    
    html += 'c.appendChild(makeCheck("Приход", "receipt", f.can_receipt, f.chat_id)); ';
    html += 'c.appendChild(makeCheck("Продажа", "sale", f.can_sale, f.chat_id)); ';
    html += 'c.appendChild(makeCheck("Списание", "writeoff", f.can_writeoff, f.chat_id)); ';
    html += 'b.appendChild(c); }); });';
    
    html += 'function makeCheck(label, field, checked, chatId) { ';
    html += 'var r = document.createElement("div"); r.className = "row"; ';
    html += 'r.innerHTML = "<span>" + label + "</span>"; ';
    html += 'var cb = document.createElement("input"); cb.type = "checkbox"; ';
    html += 'cb.checked = checked; ';
    html += 'cb.onchange = function() { setRights(chatId, field, cb.checked); }; ';
    html += 'r.appendChild(cb); return r; }';
    
    html += 'function setPin(id) { ';
    html += 'var p = prompt("Введите 4 цифры:"); ';
    html += 'if (p && p.length === 4) { ';
    html += 'fetch("/api/warehouse/florist/pin", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", chatId: id, pin: p }) })';
    html += '.then(function() { location.reload(); }); } }';
    
    html += 'function setRights(id, field, val) { ';
    html += 'fetch("/api/warehouse/florist/rights", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", chatId: id, ';
    html += 'field: field, val: val }) }); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 35. API прав
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      await pool.query(
        'UPDATE admins SET warehouse_pin = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3', 
        [req.body.pin, req.body.shop, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  
  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      var col = 'can_receipt';
      if (req.body.field === 'sale') col = 'can_sale';
      if (req.body.field === 'writeoff') col = 'can_writeoff';
      await pool.query(
        'UPDATE admins SET ' + col + ' = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3', 
        [req.body.val, req.body.shop, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 36. API Журнала
  app.get('/api/warehouse/audit', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT l.action, l.details, l.date, l.ref_id, a.name as person ' +
        'FROM wh_audit_log l LEFT JOIN admins a ON a.chat_id = l.chat_id ' +
        'WHERE l.shop_id = $1 ORDER BY l.date DESC LIMIT 50', 
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, logs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 37. Экран Журнала (Проваливание)
  app.get('/warehouse/audit', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.log { background: #fff; border-radius: 10px; padding: 15px; ';
    html += 'margin-bottom: 10px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; display: block; } ';
    html += '.log.clickable { border-left: 4px solid #2980b9; } ';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; }';
    html += '.link-hint { font-size: 12px; color: #2980b9; margin-top: 5px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>👁 Журнал</h1></div><div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/audit?shop=kupidon")';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'var b = document.getElementById("list"); b.innerHTML = ""; ';
    html += 'if (!d.ok || d.logs.length === 0) { ';
    html += 'b.innerHTML = "Журнал пуст"; return; } ';
    
    html += 'd.logs.forEach(function(l) { ';
    html += 'var div = document.createElement("div"); div.className = "log"; ';
    html += 'var ds = new Date(l.date).toLocaleString("ru-RU"); ';
    html += 'var p = l.person || "Система"; ';
    html += 'div.innerHTML = "<div><b>" + p + "</b>: " + l.details + "</div>"; ';
    html += 'div.innerHTML += "<div class=\'date\'>" + ds + "</div>"; ';
    
    html += 'if (l.ref_id && l.action === "sale") { ';
    html += 'div.className = "log clickable"; ';
    html += 'div.onclick = function() { window.location.href = ';
    html += '"/warehouse/sale/details?id=" + l.ref_id; }; ';
    html += 'div.innerHTML += "<div class=\'link-hint\'>Посмотреть чек</div>"; } ';
    
    html += 'else if (l.ref_id && l.action === "receipt") { ';
    html += 'div.className = "log clickable"; ';
    html += 'div.onclick = function() { window.location.href = ';
    html += '"/warehouse/documents/details?id=" + l.ref_id + ';
    html += '"&type=receipts"; }; ';
    html += 'div.innerHTML += "<div class=\'link-hint\'>Открыть накладную</div>"; } ';
    
    html += 'else if (l.ref_id && l.action === "writeoff") { ';
    html += 'div.className = "log clickable"; ';
    html += 'div.onclick = function() { window.location.href = ';
    html += '"/warehouse/documents/details?id=" + l.ref_id + ';
    html += '"&type=writeoffs"; }; ';
    html += 'div.innerHTML += "<div class=\'link-hint\'>Открыть акт списания</div>"; } ';
    
    html += 'b.appendChild(div); }); });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 38. API Настроек
  app.get('/api/warehouse/settings', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1', 
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, settings: r.rows[0].settings || {} });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/settings', async (req, res) => {
    try {
      var obj = {}; obj[req.body.key] = req.body.val;
      await pool.query(
        'UPDATE shops SET settings = settings || $1::jsonb ' +
        'WHERE shop_id = $2', 
        [JSON.stringify(obj), req.body.shop || 'kupidon']
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 39. Экран Настроек
  app.get('/warehouse/settings', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; ';
    html += 'padding: 15px; margin-bottom: 15px; }';
    html += '.row { display: flex; justify-content: space-between; ';
    html += 'margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }';
    html += 'input[type="checkbox"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; } ';
    html += 'input[type="radio"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; margin-right: 10px; } ';
    html += 'label { display: flex; align-items: center; margin-top: 10px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" ';
    html += 'class="back">←</a><h1>⚙️ Настройки</h1></div>';
    
    html += '<div class="card"><h3>Уведомления</h3>';
    html += '<div id="notifs"></div></div>';
    html += '<div class="card"><h3>Отображение остатков</h3>';
    html += '<div id="views"></div></div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/settings?shop=kupidon")';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'if (!d.ok) return; var s = d.settings; ';
    
    html += 'var nOpts = [ ';
    html += '{ k: "notif_discount", t: "Уведомлять о скидках" }, ';
    html += '{ k: "notif_cancel", t: "Уведомлять об отмене" }, ';
    html += '{ k: "notif_writeoff", t: "Уведомлять о списаниях" } ]; ';
    html += 'var nb = document.getElementById("notifs"); ';
    html += 'nOpts.forEach(function(o) { ';
    html += 'var r = document.createElement("div"); r.className = "row"; ';
    html += 'r.innerHTML = "<span>" + o.t + "</span>"; ';
    html += 'var cb = document.createElement("input"); cb.type = "checkbox"; ';
    html += 'cb.checked = s[o.k] !== false; ';
    html += 'cb.onchange = function() { saveSet(o.k, cb.checked); }; ';
    html += 'r.appendChild(cb); nb.appendChild(r); });';
    
    html += 'var vOpts = [ ';
    html += '{ v: "all", t: "Все товары (включая нулевые)" }, ';
    html += '{ v: "nonzero", t: "Только ненулевые" }, ';
    html += '{ v: "pos", t: "Только в наличии" } ]; ';
    html += 'var currentV = s.inv_view || "pos"; ';
    html += 'var vb = document.getElementById("views"); ';
    html += 'vOpts.forEach(function(o) { ';
    html += 'var lb = document.createElement("label"); ';
    html += 'var rb = document.createElement("input"); rb.type = "radio"; ';
    html += 'rb.name = "inv_view"; rb.value = o.v; ';
    html += 'rb.checked = (currentV === o.v); ';
    html += 'rb.onchange = function() { saveSet("inv_view", o.v); }; ';
    html += 'lb.appendChild(rb); ';
    html += 'lb.appendChild(document.createTextNode(o.t)); ';
    html += 'vb.appendChild(lb); }); });';
    
    html += 'function saveSet(k, v) { ';
    html += 'fetch("/api/warehouse/settings", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", key: k, val: v }) }); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 40. API Истории
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      let targetDate = req.query.date || 
        new Date().toISOString().slice(0, 10);
      
      const sales = await pool.query(
        'SELECT s.id, s.real_price as amount, s.date, ' +
        '\'sale\' as type, a.name as person, ' +
        'STRING_AGG(COALESCE(shi.custom_name, i.name) ' +
        '|| \' x\' || si.qty, \', \') as items FROM wh_sales s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'LEFT JOIN wh_sale_items si ON si.sale_id = s.id ' +
        'LEFT JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE s.shop_id = $1 AND DATE(s.date) = $2 ' +
        'GROUP BY s.id, a.name ORDER BY s.date DESC', 
        [shopId, targetDate]
      );
      
      const writeoffs = await pool.query(
        'SELECT w.id, w.qty as amount, w.date, \'writeoff\' as type, ' +
        'a.name as person, COALESCE(shi.custom_name, i.name) as items, ' +
        'w.reason FROM wh_writeoffs w ' +
        'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
        'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
        'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE w.shop_id = $1 AND DATE(w.date) = $2 ' +
        'ORDER BY w.date DESC', [shopId, targetDate]
      );
      
      const receipts = await pool.query(
        'SELECT r.id, r.total_sum as amount, r.date, \'receipt\' as type, ' +
        'a.name as person, STRING_AGG(COALESCE(shi.custom_name, i.name) ' +
        '|| \' x\' || ri.qty, \', \') as items FROM wh_receipts r ' +
        'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'LEFT JOIN wh_receipt_items ri ON ri.receipt_id = r.id ' +
        'LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE r.shop_id = $1 AND DATE(r.date) = $2 ' +
        'AND r.status = \'completed\' GROUP BY r.id, a.name ' +
        'ORDER BY r.date DESC', [shopId, targetDate]
      );
      
      let list = [...sales.rows, ...writeoffs.rows, ...receipts.rows];
      list.sort(function(a, b) { 
        return new Date(b.date) - new Date(a.date); 
      });
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 41. Экран Истории (Возврат)
  app.get('/warehouse/history', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.calendar { display: flex; overflow-x: auto; gap: 10px; ';
    html += 'margin-bottom: 15px; }';
    html += '.day-btn { background: #fff; border: 1px solid #ddd; ';
    html += 'border-radius: 10px; padding: 10px; text-align: center; ';
    html += 'min-width: 60px; text-decoration: none; color: ' + brandColor + '; }';
    html += '.day-btn.active { background: ' + brandColor + '; color: #fff; }';
    html += '.item { background: #fff; border-radius: 10px; padding: 15px; ';
    html += 'margin-bottom: 10px; display: flex; justify-content: space-between; ';
    html += 'align-items: flex-start; cursor: pointer; }';
    html += '.item.sale { border-left: 4px solid #2980b9; }';
    html += '.item.writeoff { border-left: 4px solid ' + accentColor + '; }';
    html += '.item.receipt { border-left: 4px solid #27ae60; }';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; }';
    html += '.amount { font-weight: bold; font-size: 16px; text-align: right; }';
    html += '.items-list { font-size: 13px; color: #555; margin-top: 4px; ';
    html += 'font-style: italic; }';
    html += '.btn-cancel { background: #fff; border: 1px solid #e74c3c; ';
    html += 'color: #e74c3c; border-radius: 5px; padding: 5px 10px; ';
    html += 'font-size: 12px; margin-top: 5px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>📋 История</h1></div>';
    html += '<div class="calendar" id="calendar"></div>';
    html += '<div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'var selectedDate = new URLSearchParams(window.location.search)';
    html += '.get("date") || new Date().toISOString().slice(0, 10);';
    
    html += 'function renderCalendar() { ';
    html += 'var cal = document.getElementById("calendar"); ';
    html += 'var today = new Date(); ';
    html += 'var daysRu = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; ';
    html += 'for (var i = 0; i < 7; i++) { ';
    html += 'var d = new Date(today); d.setDate(today.getDate() - i); ';
    html += 'var dStr = d.getFullYear() + "-" + ';
    html += 'String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
    html += 'String(d.getDate()).padStart(2, "0"); ';
    html += 'var a = document.createElement("a"); ';
    html += 'a.href = "/warehouse/history?date=" + dStr; ';
    html += 'a.className = "day-btn"; ';
    html += 'if (dStr === selectedDate) a.classList.add("active"); ';
    html += 'var label = i === 0 ? "Сегодня" : daysRu[d.getDay()]; ';
    html += 'a.innerHTML = "<div style=\'font-size:10px;\'>" + label + "</div>"; ';
    html += 'a.innerHTML += "<div style=\'font-size:18px;font-weight:bold;\'>" + ';
    html += 'd.getDate() + "</div>"; ';
    html += 'cal.appendChild(a); } }';
    html += 'renderCalendar();';
    
    html += 'fetch("/api/warehouse/history?shop=kupidon&date=" + selectedDate)';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'var b = document.getElementById("list"); b.innerHTML = ""; ';
    html += 'if (!d.ok || d.history.length === 0) { ';
    html += 'b.innerHTML = "За этот день операций нет"; return; } ';
    
    html += 'd.history.forEach(function(h) { ';
    html += 'var div = document.createElement("div"); ';
    html += 'var ds = new Date(h.date).toLocaleString("ru-RU", ';
    html += '{ hour: "2-digit", minute: "2-digit" }); ';
    html += 'var seller = h.person || "Флорист"; ';
    
    html += 'if (h.type === "sale") { ';
    html += 'div.className = "item sale"; ';
    html += 'div.onclick = function() { window.location.href = ';
    html += '"/warehouse/sale/details?id=" + h.id; }; ';
    html += 'div.innerHTML = "<div><b>💰 Продажа</b> (" + seller + ")"; ';
    html += 'div.innerHTML += "<div class=\'date\'>" + ds + "</div>"; ';
    html += 'div.innerHTML += "<div class=\'items-list\'>" + ';
    html += '(h.items || "") + "</div></div>"; ';
    
    html += 'var btn = "<button class=\'btn-cancel\' ';
    html += 'onclick=\'event.stopPropagation(); cancelSale(" + h.id + ")\'>';
    html += 'Возврат</button>"; ';
    html += 'div.innerHTML += "<div><div class=\'amount\'>+" + ';
    html += 'parseFloat(h.amount).toLocaleString("ru-RU") + " ₽</div>" + ';
    html += 'btn + "</div>"; ';
    
    html += '} else if (h.type === "receipt") { ';
    html += 'div.className = "item receipt"; ';
    html += 'div.onclick = function() { window.location.href = ';
    html += '"/warehouse/documents/details?id=" + h.id + "&type=receipts"; }; ';
    html += 'div.innerHTML = "<div><b>📥 Приход</b> (" + seller + ")"; ';
    html += 'div.innerHTML += "<div class=\'date\'>" + ds + "</div>"; ';
    html += 'div.innerHTML += "<div class=\'items-list\'>" + ';
    html += '(h.items || "") + "</div></div>"; ';
    html += 'div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:#27ae60;\'>+" + ';
    html += 'parseFloat(h.amount).toLocaleString("ru-RU") + " ₽</div>"; ';
    
    html += '} else { ';
    html += 'div.className = "item writeoff"; ';
    html += 'div.onclick = function() { window.location.href = ';
    html += '"/warehouse/documents/details?id=" + h.id + "&type=writeoffs"; }; ';
    html += 'div.innerHTML = "<div><b>🗑 Списание</b> (" + seller + ")"; ';
    html += 'div.innerHTML += "<div class=\'date\'>" + ds + "</div>"; ';
    html += 'div.innerHTML += "<div class=\'items-list\'>" + ';
    html += '(h.items || "") + " (" + h.reason + ")</div></div>"; ';
    html += 'div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:' + accentColor + '\'>-" + parseFloat(h.amount) + ';
    html += '" шт</div>"; } ';
    html += 'b.appendChild(div); }); });';
    
    html += 'function cancelSale(id) { ';
    html += 'var ret = confirm("Оформить возврат?\\n\\nОК = вернуть на склад. ';
    html += 'Отмена = списать в потери."); ';
    html += 'fetch("/api/warehouse/sale/cancel", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "kupidon", saleId: id, ';
    html += 'action: ret ? "return" : "writeoff" }) })';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'if (d.ok) { alert("Возврат оформлен"); location.reload(); } ';
    html += 'else alert("Ошибка"); }); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 42. API Отмены (Возврата)
  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    try {
      const { shopId, saleId, action } = req.body;
      const itemsRes = await pool.query(
        'SELECT shop_item_id, qty FROM wh_sale_items WHERE sale_id = $1', 
        [saleId]
      );
      
      for (var item of itemsRes.rows) {
        if (action === 'return') {
          await pool.query(
            'UPDATE wh_shop_items SET current_stock = current_stock + $1 ' +
            'WHERE id = $2', [item.qty, item.shop_item_id]
          );
        } else {
          await pool.query(
            'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, ' +
            'comment, date) VALUES ($1, $2, $3, $4, $5, NOW())', 
            [shopId, item.shop_item_id, item.qty, 'loss', 'Отмена продажи']
          );
        }
      }
      await pool.query('DELETE FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      await pool.query('DELETE FROM wh_sales WHERE id = $1', [saleId]);
      await logAction(shopId, null, 'cancel', 
        'Возврат продажи ID: ' + saleId, saleId);
      await notifyOwner(bot, shopId, 
        '⚠️ Возврат продажи ID: ' + saleId, 'cancel');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 43. API Деталей Продажи
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const saleId = req.query.id;
      const sale = await pool.query(
        'SELECT s.id, s.real_price, s.date, a.name as seller ' +
        'FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.id = $1', [saleId]
      );
      const items = await pool.query(
        'SELECT si.qty, si.cost_at_sale, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'shi.id as shop_item_id FROM wh_sale_items si ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE si.sale_id = $1', [saleId]
      );
      res.json({ ok: true, sale: sale.rows[0], items: items.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 44. Экран Деталей Продажи
  app.get('/warehouse/sale/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; ';
    html += 'padding: 20px; margin-bottom: 15px; }';
    html += '.total { font-size: 28px; font-weight: bold; color: #27ae60; ';
    html += 'margin-bottom: 10px; }';
    html += '.meta { font-size: 14px; color: #666; margin-bottom: 20px; }';
    html += '.item-row { display: flex; justify-content: space-between; ';
    html += 'padding: 15px 0; border-bottom: 1px solid #eee; ';
    html += 'text-decoration: none; color: ' + brandColor + '; }';
    html += '.item-row:last-child { border-bottom: none; } ';
    html += '.item-name { font-weight: bold; font-size: 16px; } ';
    html += '.item-qty { color: #e74c3c; font-weight: bold; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse/history" ';
    html += 'class="back">←</a><h1>🧾 Чек</h1></div>';
    html += '<div class="card" id="content">Загрузка...</div>';
    
    html += '<script>';
    html += 'var saleId = new URLSearchParams(window.location.search).get("id");';
    html += 'fetch("/api/warehouse/sale/details?id=" + saleId)';
    html += '.then(function(r) { return r.json(); }).then(function(d) { ';
    html += 'if (!d.ok) { ';
    html += 'document.getElementById("content").innerText = "Ошибка"; return; } ';
    html += 'var s = d.sale; var ds = new Date(s.date).toLocaleString("ru-RU"); ';
    html += 'var h = "<div class=\'total\'>" + ';
    html += 'parseFloat(s.real_price).toLocaleString("ru-RU") + " ₽</div>"; ';
    html += 'h += "<div class=\'meta\'>Продал: " + (s.seller || "Неизвестно") + ';
    html += '"<br>Дата: " + ds + "</div>"; ';
    
    html += 'd.items.forEach(function(i) { ';
    html += 'var itemUrl = "/warehouse/item?id=" + i.shop_item_id; ';
    html += 'h += "<a href=\'" + itemUrl + "\' class=\'item-row\'>"; ';
    html += 'h += "<div><div class=\'item-name\'>" + i.name + "</div>"; ';
    html += 'h += "<div style=\'font-size:12px;color:#888;\'>Себестоимость: " + ';
    html += 'parseFloat(i.cost_at_sale) + " ₽/шт</div></div>"; ';
    html += 'h += "<div class=\'item-qty\'>x" + i.qty + "</div></a>"; }); ';
    
    html += 'document.getElementById("content").innerHTML = h; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

}
module.exports = { setupWarehouse };