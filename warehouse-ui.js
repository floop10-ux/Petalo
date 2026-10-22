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
      if (!chatId) return res.redirect('/warehouse-login?shop=kupidon');

      const r = await pool.query(
        'SELECT role, name, can_receipt, can_sale, can_writeoff ' +
        'FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
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

      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0">';
      html += '<script src="https://telegram.org/js/';
      html += 'telegram-web-app.js"><\/script>';
      html += '<style>';
      html += 'body { font-family: sans-serif; margin: 0; padding: 20px; ';
      html += 'text-align: center; background: #fafaf8; ';
      html += 'color: ' + brandColor + '; }';
      html += '.header { background: #fff; padding: 20px; ';
      html += 'border-radius: 20px; margin-bottom: 20px; ';
      html += 'border-bottom: 4px solid ' + brandColor + '; }';
      html += 'h1 { margin: 0; font-size: 24px; }';
      html += '.grid { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 15px; }';
      html += '.btn { background: #fff; padding: 20px 10px; ';
      html += 'border-radius: 20px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; font-weight: bold; font-size: 16px; ';
      html += 'display: flex; flex-direction: column; ';
      html += 'align-items: center; justify-content: center; ';
      html += 'border: 1px solid #eee; }';
      html += '.btn span { font-size: 28px; margin-bottom: 8px; }';
      html += '.full { grid-column: 1 / -1; }';
      html += '</style></head><body>';
      
      html += '<div class="header"><h1>📦 Склад</h1>';
      html += '<p style="color:#888;margin:5px 0 0;">Вы: <b>' + userName + '</b> ';
      html += '(' + (isOwner ? 'Владелец' : 'Флорист') + ')</p></div>';
      html += '<div class="grid">';
      
      if (isOwner || canSale) {
        html += '<a href="/warehouse/sale" class="btn">';
        html += '<span>💰</span>Продажа</a>';
      }
      if (isOwner || canWriteoff) {
        html += '<a href="/warehouse/writeoff" class="btn">';
        html += '<span>🗑</span>Списание</a>';
      }
      if (isOwner || canReceipt) {
        html += '<a href="/warehouse/receipt" class="btn">';
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
    } catch (e) { res.status(500).send('Ошибка сервера'); }
  });

  // 2. Вход
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; text-align: center; ';
    html += 'padding: 50px 20px; background: #fafaf8; }';
    html += '.card { background: #fff; border-radius: 20px; padding: 30px; ';
    html += 'max-width: 400px; margin: 0 auto; ';
    html += 'border-bottom: 5px solid ' + brandColor + '; }';
    html += 'input { font-size: 24px; padding: 10px; width: 120px; ';
    html += 'text-align: center; border: 2px solid #ddd; ';
    html += 'border-radius: 10px; margin: 20px 0; }';
    html += 'button { background: ' + brandColor + '; color: white; ';
    html += 'border: none; padding: 15px 40px; font-size: 18px; ';
    html += 'border-radius: 30px; }';
    html += '</style></head><body>';
    html += '<div class="card"><h1>📦 Склад</h1><p>Введите PIN-код</p>';
    html += '<input type="password" id="pin" maxlength="4" ';
    html += 'inputmode="numeric" placeholder="****">';
    html += '<br><button onclick="login()">Войти</button></div>';
    html += '<script>';
    html += 'function login() {';
    html += '  var pin = document.getElementById("pin").value;';
    html += '  fetch("/api/warehouse/auth", { ';
    html += 'method: "POST", headers: { "Content-Type": "application/json" },';
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
        'wh_auth=' + r.rows[0].chat_id + '; Path=/; Max-Age=2592000; HttpOnly'
      );
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 4. API Товаров
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT i.id, i.current_stock, i.retail_price, ' +
        'COALESCE(i.custom_name, w.name) AS name, w.photo_url ' +
        'FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 ORDER BY w.name ASC', 
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 5. Экран Обзора склада
  app.get('/warehouse/inventory', (req, res) => {
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
    html += '.search { width: 100%; padding: 12px; ';
    html += 'border: 2px solid #eee; border-radius: 10px; ';
    html += 'margin-bottom: 15px; box-sizing: border-box; }';
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
    html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<script>';
    html += 'var allItems = [];';
    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  if (d.ok) { allItems = d.items; render(allItems); }';
    html += '});';
    
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
    html += '    var stockColor = ';
    html += 'parseFloat(i.current_stock) > 0 ? "green" : "red";';
    html += '    a.innerHTML = img + \'<div class="name">\' + ';
    html += 'i.name + \'</div>\';';
    html += '    a.innerHTML += \'<div class="stock \' + stockColor + ';
    html += '\'">Ост: \' + i.current_stock + \'</div>\';';
    html += '    g.appendChild(a);';
    html += '  });';
    html += '}';
    
    html += 'function filterItems() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  render(allItems.filter(function(i) { ';
    html += 'return i.name.toLowerCase().includes(q); }));';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 6. API Истории товара (с приходами и списаниями)
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
        `SELECT s.date, 'sale' as type, si.qty, a.name as person ` +
        `FROM wh_sale_items si JOIN wh_sales s ON s.id = si.sale_id ` +
        `LEFT JOIN admins a ON a.chat_id = s.chat_id ` +
        `WHERE si.shop_item_id = $1 AND s.shop_id = $2 ` +
        `ORDER BY s.date DESC LIMIT 30`, [itemId, shopId]
      );
      
      const receipts = await pool.query(
        `SELECT r.date, 'receipt' as type, ri.qty, 'Приход' as person ` +
        `FROM wh_receipt_items ri JOIN wh_receipts r ON r.id = ri.receipt_id ` +
        `WHERE ri.shop_item_id = $1 AND r.shop_id = $2 ` +
        `ORDER BY r.date DESC LIMIT 30`, [itemId, shopId]
      );

      const writeoffs = await pool.query(
        `SELECT w.date, 'writeoff' as type, w.qty, a.name as person, w.reason ` +
        `FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id ` +
        `WHERE w.shop_item_id = $1 AND w.shop_id = $2 ` +
        `ORDER BY w.date DESC LIMIT 30`, [itemId, shopId]
      );

      let list = [...sales.rows, ...receipts.rows, ...writeoffs.rows];
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      res.json({ ok: true, item: itemInfo.rows[0], history: list });
    } catch (e) { 
      console.error('History error:', e.message);
      res.json({ ok: false, error: e.message }); 
    }
  });

  // 7. API Переименования
  app.post('/api/warehouse/item/rename', async (req, res) => {
    try {
      const itemId = req.body.id;
      const newName = req.body.name;
      const r = await pool.query(
        'SELECT item_id FROM wh_shop_items WHERE id = $1', [itemId]
      );
      if (r.rows.length === 0) return res.json({ ok: false, error: 'Не найден' });
      
      await pool.query(
        'UPDATE wh_items SET name = $1 WHERE id = $2', 
        [newName, r.rows[0].item_id]
      );
      await pool.query(
        'UPDATE wh_shop_items SET custom_name = $1 WHERE id = $2', 
        [newName, itemId]
      );
      await logAction('kupidon', null, 'rename', 'Переименование в: ' + newName);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 8. API Объединения (Merge)
  app.post('/api/warehouse/item/merge', async (req, res) => {
    try {
      const sourceId = req.body.source_id;
      const targetName = req.body.target_name;
      const shopId = 'kupidon';

      const targetRes = await pool.query(
        'SELECT i.id FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 AND w.name = $2', [shopId, targetName]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ ok: false, error: 'Целевой товар не найден' });
      }
      const targetId = targetRes.rows[0].id;

      if (sourceId == targetId) {
        return res.json({ ok: false, error: 'Нельзя объединить с самим собой' });
      }

      await pool.query(
        'UPDATE wh_sale_items SET shop_item_id = $1 WHERE shop_item_id = $2', 
        [targetId, sourceId]
      );
      await pool.query(
        'UPDATE wh_receipt_items SET shop_item_id = $1 WHERE shop_item_id = $2', 
        [targetId, sourceId]
      );
      await pool.query(
        'UPDATE wh_writeoffs SET shop_item_id = $1 WHERE shop_item_id = $2', 
        [targetId, sourceId]
      );

      await pool.query(
        'UPDATE wh_shop_items SET current_stock = current_stock + ' +
        '(SELECT current_stock FROM wh_shop_items WHERE id = $1) WHERE id = $2',
        [sourceId, targetId]
      );

      await pool.query('DELETE FROM wh_shop_items WHERE id = $1', [sourceId]);
      await logAction(shopId, null, 'merge', 'Объединение ID ' + sourceId);
      
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 9. Экран Карточки Товара (с историей)
  app.get('/warehouse/item', (req, res) => {
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
    html += '.item { background: #fff; border-radius: 10px; ';
    html += 'padding: 15px; margin-bottom: 10px; display: flex; ';
    html += 'justify-content: space-between; align-items: center; }';
    html += '.item.sale { border-left: 4px solid #2980b9; }'; 
    html += '.item.receipt { border-left: 4px solid #27ae60; }'; 
    html += '.item.writeoff { border-left: 4px solid #e74c3c; }'; 
    html += '.date { font-size: 11px; color: #888; margin-top: 3px; }';
    html += '.amount { font-weight: bold; font-size: 16px; }';
    html += '.reason { font-size: 12px; color: #e74c3c; margin-top: 2px; }';
    html += '.actions { display: flex; gap: 10px; margin-top: 15px; ';
    html += 'justify-content: center; margin-bottom: 15px; }';
    html += '.btn-act { padding: 10px 15px; border-radius: 10px; ';
    html += 'border: none; font-weight: bold; color: #fff; }';
    html += '.btn-rename { background: #f39c12; } ';
    html += '.btn-merge { background: #e74c3c; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse/inventory" ';
    html += 'class="back">←</a><h1>📦 История</h1></div>';
    html += '<div id="header-info" style="text-align:center; ';
    html += 'margin-bottom:15px;"></div>';
    html += '<div class="actions" id="actions" style="display:none;">';
    html += '<button class="btn-act btn-rename" ';
    html += 'onclick="renameItem()">✏️ Переименовать</button>';
    html += '<button class="btn-act btn-merge" ';
    html += 'onclick="mergeItem()">🔗 Объединить</button>';
    html += '</div>';
    html += '<div id="list">Загрузка...</div>';
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var itemId = urlParams.get("id"); var itemName = "";';
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
    html += 'Остаток: " + d.item.current_stock + " шт</div>";';
    html += '  }';
    html += '  if (d.history.length === 0) { ';
    html += 'b.innerHTML = "<div style=\'text-align:center; ';
    html += 'color:#888; margin-top:20px;\'>Нет операций</div>"; return; }';
    html += '  d.history.forEach(function(h) {';
    html += '    var div = document.createElement("div");';
    html += '    var ds = new Date(h.date).toLocaleString("ru-RU", ';
    html += '{ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });';
    html += '    if (h.type === "sale") {';
    html += '      div.className = "item sale";';
    html += '      div.innerHTML = "<div><b>💰 Продажа</b> (" + ';
    html += '(h.person || "Флорист") + ")<div class=\'date\'>" + ';
    html += 'ds + "</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:#2980b9;\'>-" + h.qty + " шт</div>";';
    html += '    } else if (h.type === "writeoff") {';
    html += '      div.className = "item writeoff";';
    html += '      div.innerHTML = "<div><b>🗑 Списание</b> (" + ';
    html += '(h.person || "Флорист") + ")<div class=\'date\'>" + ';
    html += 'ds + "</div><div class=\'reason\'>" + (h.reason || "") + ';
    html += '"</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:#e74c3c;\'>-" + h.qty + " шт</div>";';
    html += '    } else {';
    html += '      div.className = "item receipt";';
    html += '      div.innerHTML = "<div><b>📥 Приход</b><div class=\'date\'>" ';
    html += '+ ds + "</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' ';
    html += 'style=\'color:#27ae60;\'>+" + h.qty + " шт</div>";';
    html += '    }';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';
    
    html += 'function renameItem() {';
    html += '  var newName = prompt("Введите новое название:", itemName);';
    html += '  if (!newName || newName === itemName) return;';
    html += '  fetch("/api/warehouse/item/rename", { ';
    html += 'method: "POST", headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ id: itemId, name: newName }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { alert("Переименовано"); ';
    html += 'location.reload(); } else alert(d.error); });';
    html += '}';
    
    html += 'function mergeItem() {';
    html += '  var targetName = prompt("Введите название товара, В КОТОРЫЙ ';
    html += 'хотите объединить этот:");';
    html += '  if (!targetName) return;';
    html += '  if (!confirm("Вы уверены? Этот товар будет удален, а его ';
    html += 'данные перейдут в \'" + targetName + "\'.")) return;';
    html += '  fetch("/api/warehouse/item/merge", { ';
    html += 'method: "POST", headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ source_id: itemId, target_name: targetName }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { alert("Объединено!"); ';
    html += 'window.location.href = "/warehouse/inventory"; } ';
    html += 'else alert(d.error); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 10. Экран Прихода (с корзиной)
  app.get('/warehouse/receipt', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; ';
    html += 'background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }';
    html += 'label { display: block; font-size: 12px; color: #888; margin-bottom: 5px; }';
    html += 'input[type="text"], input[type="number"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.btn-add { width: 100%; background: #2980b9; color: #fff; border: none; padding: 12px; border-radius: 8px; font-size: 16px; margin-bottom: 15px; }';
    html += '.basket { display: none; background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 15px; border: 2px solid #2980b9; }';
    html += '.b-row { display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 14px; }';
    html += '.btn-save { width: 100%; background: ' + brandColor + '; color: #fff; border: none; padding: 15px; border-radius: 10px; font-size: 18px; font-weight: bold; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📥 Приход</h1></div>';
    
    html += '<div class="card">';
    html += '<label>Название</label>';
    html += '<input type="text" id="itemName" list="itemsList" placeholder="Начните вводить...">';
    html += '<datalist id="itemsList"></datalist>';
    html += '<label>Количество</label><input type="number" id="itemQty" step="0.1">';
    html += '<label>Цена закупки (себестоимость)</label><input type="number" id="itemPrice">';
    html += '<label>Розничная цена</label><input type="number" id="itemRetail">';
    html += '<label>Фото</label><input type="file" id="itemPhoto" accept="image/*">';
    html += '</div>';
    
    html += '<button class="btn-add" onclick="addToBasket()">+ Добавить в накладную</button>';
    
    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">В накладной:</h3>';
    html += '<div id="bList"></div>';
    html += '<button class="btn-save" style="margin-top:15px;" onclick="saveReceipt()">Сохранить накладную</button>';
    html += '</div>';
    
    html += '<script>';
    html += 'var basket = [];';
    html += 'var allItems = [];';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { allItems = d.items; ';
    html += 'var dl = document.getElementById("itemsList"); ';
    html += 'allItems.forEach(function(i) { var opt = document.createElement("option"); ';
    html += 'opt.value = i.name; dl.appendChild(opt); }); } });';

    html += 'function addToBasket() {';
    html += '  var name = document.getElementById("itemName").value;';
    html += '  var qty = document.getElementById("itemQty").value;';
    html += '  var price = document.getElementById("itemPrice").value;';
    html += '  var retail = document.getElementById("itemRetail").value || 0;';
    html += '  if (!name || !qty || !price) { alert("Заполните поля"); return; }';
    html += '  basket.push({ name: name, qty: qty, price: price, retail: retail });';
    html += '  renderBasket();';
    html += '  document.getElementById("itemName").value = "";';
    html += '  document.getElementById("itemQty").value = "";';
    html += '  document.getElementById("itemPrice").value = "";';
    html += '  document.getElementById("itemRetail").value = "";';
    html += '  document.getElementById("itemPhoto").value = "";';
    html += '}';

    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket"); var list = document.getElementById("bList");';
    html += '  if (basket.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  basket.forEach(function(item, idx) {';
    html += '    var div = document.createElement("div"); div.className = "b-row";';
    html += '    div.innerHTML = "<span>" + item.name + "</span>";';
    html += '    div.innerHTML += "<span>" + item.qty + " x " + item.price + " ₽</span>";';
    html += '    div.innerHTML += "<span style=\'color:red; cursor:pointer;\' ';
    html += 'onclick=\'basket.splice(" + idx + ", 1); renderBasket();\'>✕</span>";';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '}';

    html += 'function saveReceipt() {';
    html += '  if (basket.length === 0) return;';
    html += '  fetch("/api/warehouse/receipt", { method: "POST", headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "kupidon", items: basket }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) {';
    html += '    if (d.ok) { alert("Накладная сохранена!"); window.location.href="/warehouse-app"; }';
    html += '    else alert("Ошибка: " + (d.error || "unknown"));';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 11. API Прихода (сохраняем весь список)
  app.post('/api/warehouse/receipt', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      const shopId = req.body.shopId;
      const items = req.body.items;
      
      let totalSum = 0;
      for (var i = 0; i < items.length; i++) { totalSum += (items[i].qty * items[i].price); }
      
      const receiptRes = await pool.query(
        'INSERT INTO wh_receipts (shop_id, chat_id, total_sum) VALUES ($1, $2, $3) RETURNING id', 
        [shopId, chatId, totalSum]
      );
      const receiptId = receiptRes.rows[0].id;

      for (var item of items) {
        let itemRes = await pool.query('SELECT id FROM wh_items WHERE name = $1', [item.name]);
        let itemId;
        if (itemRes.rows.length === 0) {
          const newItem = await pool.query(
            'INSERT INTO wh_items (name, unit) VALUES ($1, \'шт\') RETURNING id', [item.name]
          );
          itemId = newItem.rows[0].id;
        } else { itemId = itemRes.rows[0].id; }

        const curr = await pool.query('SELECT current_stock, avg_cost FROM wh_shop_items WHERE shop_id = $1 AND item_id = $2', [shopId, itemId]);
        let oldStock = 0; let oldAvg = 0;
        if (curr.rows.length > 0) { oldStock = parseFloat(curr.rows[0].current_stock); oldAvg = parseFloat(curr.rows[0].avg_cost); }
        const newStock = oldStock + parseFloat(item.qty);
        const newAvg = (oldStock * oldAvg + parseFloat(item.qty) * parseFloat(item.price)) / newStock;
        
        await pool.query(
          'INSERT INTO wh_shop_items (shop_id, item_id, current_stock, last_cost, avg_cost, retail_price) VALUES ($1, $2, $3, $4, $5, $6) ' +
          'ON CONFLICT (shop_id, item_id) DO UPDATE SET current_stock = $3, last_cost = $4, avg_cost = $5, retail_price = $6',
          [shopId, itemId, newStock, item.price, newAvg, item.retail]
        );

        const shopItemRes = await pool.query('SELECT id FROM wh_shop_items WHERE shop_id = $1 AND item_id = $2', [shopId, itemId]);
        await pool.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)',
          [receiptId, shopItemRes.rows[0].id, item.qty, item.price, (item.qty * item.price)]
        );
      }
      await logAction(shopId, chatId, 'receipt', 'Накладная на сумму ' + totalSum + ' ₽', receiptId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 12. Экран Продажи (с корзиной, оплатой и сдачей)
  app.get('/warehouse/sale', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 20px; }';
    html += '.card { background: #fff; padding: 8px; border-radius: 10px; text-align: center; cursor: pointer; }';
    html += '.card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }';
    html += '.basket { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; border: 2px solid ' + brandColor + '; display: none; }';
    html += '.b-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }';
    html += '.pay-btn { padding: 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; flex: 1; text-align: center; font-size: 14px; }';
    html += '.pay-btn.active { background: #e0f7fa; border-color: #00acc1; color: #00acc1; font-weight: bold; }';
    html += '.btn-save { width: 100%; padding: 15px; background: #ccc; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; margin-top: 15px; }';
    html += '.btn-save.ready { background: ' + brandColor + '; }';
    html += '</style></head><body>';

    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>💰 Продажа</h1></div>';
    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">Корзина:</h3><div id="bList"></div>';
    html += '<div style="margin-top:10px; border-top:1px solid #ddd; padding-top:10px;">';
    html += '<label>Сумма чека</label>';
    html += '<input type="number" id="totalPrice" step="0.01" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:18px; font-weight:bold;" readonly>';
    html += '</div>';
    html += '<div style="margin-top:15px;">';
    html += '<label>Оплата</label>';
    html += '<div style="display:flex; gap:10px; margin-bottom:10px;">';
    html += '<div class="pay-btn" id="btn-cash" onclick="setPay(\'cash\')">💵 Нал</div>';
    html += '<div class="pay-btn" id="btn-card" onclick="setPay(\'card\')">💳 Карта</div>';
    html += '<div class="pay-btn" id="btn-qr" onclick="setPay(\'qr\')">📱 QR</div>';
    html += '</div>';
    html += '<div id="payInputs" style="display:none;">';
    html += '<input type="number" id="payAmount" placeholder="Сумма оплаты" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:10px;">';
    html += '<div id="remainInfo" style="display:none; font-size:14px; color:#e74c3c; margin-bottom:10px;"></div>';
    html += '</div>';
    html += '</div>';
    html += '<button class="btn-save" id="btnSubmit" onclick="saveSale()">Принять оплату</button>';
    html += '</div>';
    html += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';

    html += '<script>';
    html += 'var allItems = []; var cart = []; var payMethod = "";';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(function(r) { return r.json(); })';
    html += '.then(function(d) { allItems = d.items; render(allItems); });';

    html += 'function render(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(function(item) {';
    html += '    var div = document.createElement("div"); div.className = "card";';
    html += '    var img = item.photo_url ? \'<img src="\' + item.photo_url + \'">\' : \'<div class="ph">📷</div>\';';
    html += '    div.innerHTML = img + \'<div>\' + item.name + \'</div>\';';
    html += '    div.onclick = function() { addToCart(item); }; g.appendChild(div);';
    html += '  });';
    html += '}';
    html += 'function filterItems() { var q = document.getElementById("search").value.toLowerCase(); render(allItems.filter(function(i) { return i.name.toLowerCase().includes(q); })); }';

    html += 'function addToCart(item) {';
    html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
    html += '  if (ex) ex.qty += 1; else cart.push({ id: item.id, name: item.name, qty: 1, retail: item.retail_price || 0 });';
    html += '  renderBasket();';
    html += '}';
    
    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket"); var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = ""; var total = 0;';
    html += '  cart.forEach(function(item, idx) {';
    html += '    total += (item.retail * item.qty);';
    html += '    var div = document.createElement("div"); div.className = "b-row";';
    html += '    div.innerHTML = "<span>" + item.name + "</span>";';
    html += '    div.innerHTML += "<input type=\'number\' value=\'" + item.qty + "\' ';
    html += 'onfocus=\'if(this.value==1)this.value=\\\"\\\";\' ';
    html += 'onchange=\'upQty(" + idx + ", this.value)\' ';
    html += 'style=\'width:60px; text-align:center; border:1px solid #ddd; border-radius:5px;\'>";';
    html += '    div.innerHTML += "<span onclick=\'cart.splice(" + idx + ", 1); renderBasket();\' ';
    html += 'style=\'color:red; cursor:pointer; font-size:20px;\'>✕</span>";';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '  document.getElementById("totalPrice").value = total;';
    html += '  checkPay();';
    html += '}';

    html += 'function upQty(idx, val) {';
    html += '  var v = parseFloat(val); if (isNaN(v) || v <= 0) v = 1;';
    html += '  cart[idx].qty = v; renderBasket();';
    html += '}';

    html += 'function setPay(method) {';
    html += '  payMethod = method;';
    html += '  document.querySelectorAll(".pay-btn").forEach(function(b) { b.classList.remove("active"); });';
    html += '  document.getElementById("btn-" + method).classList.add("active");';
    html += '  document.getElementById("payInputs").style.display = "block";';
    html += '  checkPay();';
    html += '}';

    html += 'document.getElementById("payAmount").addEventListener("input", checkPay);';
    html += 'function checkPay() {';
    html += '  var total = parseFloat(document.getElementById("totalPrice").value) || 0;';
    html += '  var paid = parseFloat(document.getElementById("payAmount").value) || 0;';
    html += '  var btn = document.getElementById("btnSubmit");';
    html += '  var rem = document.getElementById("remainInfo");';
    html += '  if (total > 0 && paid >= total && payMethod !== "") {';
    html += '    btn.classList.add("ready");';
    html += '    rem.style.display = "none";';
    html += '  } else {';
    html += '    btn.classList.remove("ready");';
    html += '    if (paid > 0 && paid < total) {';
    html += '      rem.style.display = "block";';
    html += '      rem.innerText = "Остаток: " + (total - paid) + " ₽";';
    html += '    } else { rem.style.display = "none"; }';
    html += '  }';
    html += '}';

    html += 'function saveSale() {';
    html += '  var btn = document.getElementById("btnSubmit");';
    html += '  if (!btn.classList.contains("ready")) { alert("Оплата не завершена"); return; }';
    html += '  var total = document.getElementById("totalPrice").value;';
    html += '  var paid = document.getElementById("payAmount").value;';
    html += '  fetch("/api/warehouse/sale", { method: "POST", headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "kupidon", real_price: total, pay_method: payMethod, paid_amount: paid, items: cart }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) {';
    html += '    if (d.ok) { alert("Продано!"); window.location.href="/warehouse-app"; }';
    html += '    else alert("Ошибка: " + (d.error || "unknown"));';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 13. API Продажи
  app.post('/api/warehouse/sale', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      const shopId = req.body.shopId;
      const real_price = req.body.real_price;
      const paid_amount = req.body.paid_amount;
      const payMethod = req.body.pay_method;
      
      if (paid_amount < real_price) {
        return res.json({ ok: false, error: 'Сумма оплаты меньше чека' });
      }
      
      let payCash = 0, payCard = 0, payQr = 0;
      if (payMethod === 'cash') payCash = real_price;
      if (payMethod === 'card') payCard = real_price;
      if (payMethod === 'qr') payQr = real_price;

      const saleRes = await pool.query(
        'INSERT INTO wh_sales (shop_id, real_price, chat_id, pay_cash, pay_card, pay_qr) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', 
        [shopId, real_price, chatId, payCash, payCard, payQr]
      );
      const saleId = saleRes.rows[0].id;
      let itemsStr = '';

      for (var item of req.body.items) {
        await pool.query('UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2', [item.qty, item.id]);
        const costQ = await pool.query('SELECT avg_cost FROM wh_shop_items WHERE id = $1', [item.id]);
        await pool.query('INSERT INTO wh_sale_items (sale_id, shop_item_id, qty, cost_at_sale) VALUES ($1, $2, $3, $4)', [saleId, item.id, item.qty, costQ.rows[0].avg_cost || 0]);
        itemsStr += item.name + ' x' + item.qty + ', ';
      }
      if (itemsStr.length > 2) itemsStr = itemsStr.slice(0, -2);

      await logAction(shopId, chatId, 'sale', 'Продажа на ' + real_price + ' ₽. Товары: ' + itemsStr, saleId);
      
      // Уведомление, если была переплата (сдача)
      if (paid_amount > real_price) {
        await notifyOwner(bot, shopId, '⚠️ Сдача при продаже: ' + (paid_amount - real_price) + ' ₽', 'discount');
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // 14. Экран Списания (с корзиной и остатками)
  app.get('/warehouse/writeoff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 15px; }';
    html += '.card { background: #fff; padding: 8px; border-radius: 10px; text-align: center; cursor: pointer; }';
    html += '.card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }';
    html += '.card .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }';
    html += '.card .stock { font-size: 11px; color: #27ae60; }';
    html += '.card .stock.zero { color: #e74c3c; }';
    html += '.basket { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; border: 2px solid ' + accentColor + '; display: none; }';
    html += '.b-row { display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 14px; }';
    html += '.reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }';
    html += '.reason { padding: 10px; border-radius: 10px; border: 2px solid #eee; background: #fff; text-align: center; cursor: pointer; font-size: 14px; }';
    html += '.reason.active { border-color: ' + accentColor + '; color: ' + accentColor + '; font-weight: bold; }';
    html += '.btn-save { width: 100%; padding: 15px; background: ' + accentColor + '; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>🗑 Списание</h1></div>';
    
    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">Выбрано:</h3><div id="bList"></div>';
    html += '<label style="margin-top:10px; display:block;">Причина</label><div class="reasons">';
    html += '<div class="reason active" onclick="setR(this, \'spoilage\')">Порча</div>';
    html += '<div class="reason" onclick="setR(this, \'loss\')">Потеря</div>';
    html += '<div class="reason" onclick="setR(this, \'markdown\')">Уценка</div>';
    html += '<div class="reason" onclick="setR(this, \'sorting\')">Пересорт</div>';
    html += '</div>';
    html += '<label>Комментарий</label>';
    html += '<textarea id="comment" style="width:100%; padding:10px; border-radius:10px; border:1px solid #ddd; margin-bottom:10px;"></textarea>';
    html += '<label>Фото (необязательно)</label>';
    html += '<input type="file" id="wPhoto" accept="image/*" style="margin-bottom:15px;">';
    html += '<button class="btn-save" onclick="saveWriteoff()">Списать всё</button>';
    html += '</div>';

    html += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<script>';
    html += 'var allItems = []; var cart = []; var selReason = "spoilage";';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(function(r) { return r.json(); }).then(function(d) { allItems = d.items; render(); });';
    html += 'function render() { drawCards(allItems); }';
    html += 'function filterItems() { var q = document.getElementById("search").value.toLowerCase(); drawCards(allItems.filter(function(i) { return i.name.toLowerCase().includes(q); })); }';
    
    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(function(i) {';
    html += '    var d = document.createElement("div"); d.className = "card";';
    html += '    var img = i.photo_url ? \'<img src="\' + i.photo_url + \'">\' : \'<div class="ph">📷</div>\';';
    html += '    var stClass = parseFloat(i.current_stock) > 0 ? "" : "zero";';
    html += '    d.innerHTML = img + \'<div class="name">\' + i.name + \'</div>\';';
    html += '    d.innerHTML += \'<div class="stock \' + stClass + \'">Ост: \' + i.current_stock + \'</div>\';';
    html += '    d.onclick = function() { addToBasket(i); }; g.appendChild(d);';
    html += '  });';
    html += '}';
    
    html += 'function addToBasket(item) {';
    html += '  var q = prompt("Сколько списать?", "1");';
    html += '  if (q && parseFloat(q) > 0) {';
    html += '    var ex = cart.find(function(c) { return c.id === item.id; });';
    html += '    if (ex) ex.qty += parseFloat(q); ';
    html += '    else cart.push({ id: item.id, name: item.name, qty: parseFloat(q) });';
    html += '    renderBasket();';
    html += '  }';
    html += '}';
    
    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket"); var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  cart.forEach(function(item, idx) {';
    html += '    var div = document.createElement("div"); div.className = "b-row";';
    html += '    div.innerHTML = "<span>" + item.name + "</span>";';
    html += '    div.innerHTML += "<span>" + item.qty + " шт <span onclick=\'cart.splice(" + idx + ", 1); renderBasket();\' style=\'color:red; cursor:pointer; margin-left:10px;\'>✕</span></span>";';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '}';
    
    html += 'function setR(el, r) { document.querySelectorAll(".reason").forEach(function(b) { b.classList.remove("active"); }); el.classList.add("active"); selReason = r; }';
    
    html += 'function saveWriteoff() {';
    html += '  if (cart.length === 0) return;';
    html += '  var c = document.getElementById("comment").value;';
    html += '  var f = document.getElementById("wPhoto").files[0];';
    html += '  if (f) { var rd = new FileReader(); rd.onload = function(e) { upload(e.target.result, c); }; rd.readAsDataURL(f); }';
    html += '  else submit(null, c);';
    html += '}';
    html += 'function upload(base64, c) {';
    html += '  fetch("/api/warehouse/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) { submit(d.url, c); }).catch(function() { submit(null, c); });';
    html += '}';
    html += 'function submit(url, c) {';
    html += '  fetch("/api/warehouse/writeoff", { method: "POST", headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "kupidon", items: cart, reason: selReason, comment: c, photo: url }) })';
    html += '  .then(function(r) { return r.json(); }).then(function(d) { if (d.ok) { alert("Списано!"); window.location.href="/warehouse-app"; } else alert(d.error); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 15. API Списания
  app.post('/api/warehouse/writeoff', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      const shopId = req.body.shopId;
      
      for (var item of req.body.items) {
        await pool.query('UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2', [item.qty, item.id]);
        await pool.query(
          'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, photo_url, chat_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
          [shopId, item.id, item.qty, req.body.reason, req.body.comment, req.body.photo, chatId]
        );
      }
      await logAction(shopId, chatId, 'writeoff', 'Списание: ' + req.body.items[0].name + ' и др.');
      await notifyOwner(bot, shopId, '🗑 Крупное списание!', 'writeoff');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 16. API Загрузки фото
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      const base64Data = req.body.image;
      if (!base64Data) return res.json({ ok: false });
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      const key = 'wh_' + Date.now() + '.jpg';
      const cmd = new PutObjectCommand({ Bucket: YC_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg' });
      await s3.send(cmd);
      const url = 'https://' + YC_BUCKET + '.storage.yandexcloud.net/' + key;
      let urlBackup = null;
      if (s3backup) {
        const cmd2 = new PutObjectCommand({ Bucket: BC_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg' });
        await s3backup.send(cmd2);
        urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
      }
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 17. Экран Документов (Список)
  app.get('/warehouse/documents', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.tabs { display: flex; gap: 10px; margin-bottom: 15px; }';
    html += '.tab { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; text-align: center; cursor: pointer; text-decoration: none; color: ' + brandColor + '; }';
    html += '.tab.active { background: ' + brandColor + '; color: #fff; }';
    html += '.doc { background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 10px; text-decoration: none; color: ' + brandColor + '; display: flex; justify-content: space-between; align-items: center; }';
    html += '.doc.receipt { border-left: 4px solid #3498db; } .doc.writeoff { border-left: 4px solid ' + accentColor + '; }';
    html += '.meta { font-size: 12px; color: #888; margin-top: 4px; } .amount { font-weight: bold; font-size: 16px; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📑 Документы</h1></div>';
    html += '<div class="tabs">';
    html += '<a href="/warehouse/documents?type=receipts" class="tab" id="tab-receipts">Приходы</a>';
    html += '<a href="/warehouse/documents?type=writeoffs" class="tab" id="tab-writeoffs">Списания</a>';
    html += '</div><div id="list">Загрузка...</div>';
    html += '<script>';
    html += 'var currentType = new URLSearchParams(window.location.search).get("type") || "receipts";';
    html += 'document.getElementById("tab-" + currentType).classList.add("active");';
    html += 'fetch("/api/warehouse/documents?shop=kupidon&type=" + currentType).then(function(r) { return r.json(); }).then(function(d) {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok || d.docs.length === 0) { b.innerHTML = "Документов нет"; return; }';
    html += '  d.docs.forEach(function(doc) {';
    html += '    var div = document.createElement("a");';
    html += '    div.className = "doc " + (currentType === "receipts" ? "receipt" : "writeoff");';
    html += '    div.href = "/warehouse/documents/details?id=" + doc.id + "&type=" + currentType;';
    html += '    var ds = new Date(doc.date).toLocaleString("ru-RU");';
    html += '    var author = doc.author || "Система";';
    html += '    if (currentType === "receipts") {';
    html += '      div.innerHTML = "<div><b>Накладная №" + doc.id + "</b><div class=\'meta\'>" + ds + " · " + author + "</div></div><div class=\'amount\' style=\'color:#3498db;\'>+" + doc.amount.toLocaleString("ru-RU") + " ₽</div>";';
    html += '    } else {';
    html += '      div.innerHTML = "<div><b>Акт списания №" + doc.id + "</b><div class=\'meta\'>" + ds + " · " + author + "</div><div class=\'meta\'>" + (doc.item_name || "") + " (" + doc.reason + ")</div></div><div class=\'amount\' style=\'color:" + accentColor + "\'>-" + doc.amount + " шт</div>";';
    html += '    }';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 18. API Документов
  app.get('/api/warehouse/documents', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const type = req.query.type || 'receipts';
      if (type === 'receipts') {
        const r = await pool.query('SELECT r.id, r.date, r.total_sum as amount, a.name as author FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id WHERE r.shop_id = $1 ORDER BY r.date DESC LIMIT 50', [shopId]);
        res.json({ ok: true, docs: r.rows });
      } else {
        const r = await pool.query('SELECT w.id, w.date, w.qty as amount, w.reason, a.name as author, COALESCE(shi.custom_name, i.name) as item_name FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE w.shop_id = $1 ORDER BY w.date DESC LIMIT 50', [shopId]);
        res.json({ ok: true, docs: r.rows });
      }
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 19. Экран Деталей Документа
  app.get('/warehouse/documents/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 20px; margin-bottom: 15px; }';
    html += '.item-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; }';
    html += '.item-row:last-child { border-bottom: none; } .item-name { font-weight: bold; } .item-qty { text-align: right; font-weight: bold; }';
    html += '.total-row { margin-top: 15px; padding-top: 15px; border-top: 2px solid ' + brandColor + '; display: flex; justify-content: space-between; font-size: 18px; font-weight: bold; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse/documents" class="back">←</a><h1>📄 Документ</h1></div>';
    html += '<div class="card" id="content">Загрузка...</div>';
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search); var docId = urlParams.get("id"); var docType = urlParams.get("type");';
    html += 'fetch("/api/warehouse/documents/details?id=" + docId + "&type=" + docType).then(function(r) { return r.json(); }).then(function(d) {';
    html += '  if (!d.ok) { document.getElementById("content").innerText = "Ошибка: " + d.error; return; }';
    html += '  var h = d.header; var ds = new Date(h.date).toLocaleString("ru-RU");';
    html += '  var title = docType === "receipts" ? "Приходная накладная №" : "Акт списания №";';
    html += '  var hc = "<div style=\'font-size:20px; font-weight:bold;\'>" + title + h.id + "</div>";';
    html += '  hc += "<div style=\'font-size:14px; color:#666; margin-bottom:15px;\'>" + ds + "<br>Сделал: " + (h.author || "Неизвестно") + "</div>";';
    html += '  d.items.forEach(function(i) {';
    html += '    hc += "<div class=\'item-row\'><div><div class=\'item-name\'>" + i.name + "</div>";';
    html += '    if (docType === "receipts") { hc += "<div style=\'font-size:12px; color:#888;\'>" + i.unit_cost.toLocaleString("ru-RU") + " ₽/шт</div></div><div class=\'item-qty\'>" + i.qty + " шт<br><span style=\'font-size:12px; color:#888;\'>" + i.sum.toLocaleString("ru-RU") + " ₽</span></div></div>"; }';
    html += '    else { hc += "<div style=\'font-size:12px; color:#888;\'>Причина: " + h.reason + "</div></div><div class=\'item-qty\'>" + i.qty + " шт</div></div>"; }';
    html += '  });';
    html += '  var totalTxt = docType === "receipts" ? h.total_sum.toLocaleString("ru-RU") + " ₽" : h.total_sum + " шт";';
    html += '  hc += "<div class=\'total-row\'><span>Итого:</span><span>" + totalTxt + "</span></div>";';
    html += '  document.getElementById("content").innerHTML = hc;';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 20. API Деталей Документа
  app.get('/api/warehouse/documents/details', async (req, res) => {
    try {
      const id = req.query.id; const type = req.query.type;
      if (type === 'receipts') {
        const header = await pool.query('SELECT r.id, r.date, r.total_sum, a.name as author FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id WHERE r.id = $1', [id]);
        const items = await pool.query('SELECT ri.qty, ri.unit_cost, ri.sum, COALESCE(shi.custom_name, i.name) as name FROM wh_receipt_items ri JOIN wh_shop_items shi ON shi.id = ri.shop_item_id JOIN wh_items i ON i.id = shi.item_id WHERE ri.receipt_id = $1', [id]);
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      } else {
        const header = await pool.query('SELECT w.id, w.date, w.qty as total_sum, w.reason, a.name as author FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id WHERE w.id = $1', [id]);
        const items = await pool.query('SELECT w.qty, 0 as unit_cost, 0 as sum, COALESCE(shi.custom_name, i.name) as name FROM wh_writeoffs w JOIN wh_shop_items shi ON shi.id = w.shop_item_id JOIN wh_items i ON i.id = shi.item_id WHERE w.id = $1', [id]);
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 21. API Отчётов
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon'; const period = req.query.period || 'all';
      let dateFilter = '';
      if (period === 'today') dateFilter = 'AND DATE(date) = CURRENT_DATE';
      if (period === 'week') dateFilter = "AND date >= NOW() - INTERVAL '7 days'";
      if (period === 'month') dateFilter = "AND date >= NOW() - INTERVAL '1 month'";
      const rev = await pool.query('SELECT COALESCE(SUM(real_price), 0) AS total FROM wh_sales WHERE shop_id = $1 ' + dateFilter, [shopId]);
      const loss = await pool.query('SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total FROM wh_writeoffs w JOIN wh_shop_items i ON i.id = w.shop_item_id WHERE w.shop_id = $1 ' + dateFilter.replace('date', 'w.date'), [shopId]);
      const cost = await pool.query('SELECT COALESCE(SUM(s.qty * s.cost_at_sale), 0) AS total FROM wh_sale_items s JOIN wh_sales sa ON sa.id = s.sale_id WHERE sa.shop_id = $1 ' + dateFilter.replace('date', 'sa.date'), [shopId]);
      const revenue = parseInt(rev.rows[0].total) || 0; const losses = parseInt(loss.rows[0].total) || 0; const costVal = parseInt(cost.rows[0].total) || 0;
      const profit = revenue - costVal; let lossPercent = 0;
      if ((revenue + losses) > 0) lossPercent = Math.round((losses / (revenue + losses)) * 100);
      res.json({ ok: true, revenue, profit, losses, lossPercent });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 22. Экран Отчётов
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.filters { display: flex; gap: 10px; margin-bottom: 15px; } .filter { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; text-align: center; cursor: pointer; font-size: 14px; }';
    html += '.filter.active { background: ' + brandColor + '; color: #fff; } .card { background: #fff; border-radius: 15px; padding: 20px; margin-bottom: 15px; text-align: center; }';
    html += '.val { font-size: 28px; font-weight: bold; } .blue { color: #2980b9; } .green { color: #27ae60; } .red { color: ' + accentColor + '; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📊 Отчёты</h1></div>';
    html += '<div class="filters"><div class="filter" id="f-today" onclick="setPeriod(\'today\')">Сегодня</div><div class="filter" id="f-week" onclick="setPeriod(\'week\')">Неделя</div><div class="filter" id="f-month" onclick="setPeriod(\'month\')">Месяц</div><div class="filter active" id="f-all" onclick="setPeriod(\'all\')">Всё</div></div>';
    html += '<div id="load" style="text-align:center;">Загрузка...</div><div id="cont" style="display:none;">';
    html += '<div class="card"><div>Выручка</div><div class="val blue" id="rev">0</div></div>';
    html += '<div class="card"><div>Прибыль</div><div class="val green" id="prof">0</div></div>';
    html += '<div class="card" style="border: 2px solid ' + accentColor + ';"><div>Потери</div><div class="val red" id="loss">0</div><div id="pct"></div></div></div>';
    html += '<script>';
    html += 'var currentPeriod = "all";';
    html += 'function setPeriod(p) { currentPeriod = p; document.querySelectorAll(".filter").forEach(function(el) { el.classList.remove("active"); }); document.getElementById("f-" + p).classList.add("active"); loadData(); }';
    html += 'function loadData() { document.getElementById("load").style.display = "block"; document.getElementById("cont").style.display = "none"; fetch("/api/warehouse/reports?shop=kupidon&period=" + currentPeriod).then(function(r) { return r.json(); }).then(function(d) { if (d.ok) { document.getElementById("load").style.display="none"; document.getElementById("cont").style.display="block"; document.getElementById("rev").innerText = d.revenue.toLocaleString("ru-RU") + " ₽"; document.getElementById("prof").innerText = d.profit.toLocaleString("ru-RU") + " ₽"; document.getElementById("loss").innerText = d.losses.toLocaleString("ru-RU") + " ₽"; document.getElementById("pct").innerText = d.lossPercent + "% от закупок"; } }); }';
    html += 'loadData();';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 23. API Флористов
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const r = await pool.query('SELECT a.name, a.warehouse_pin, a.can_receipt, a.can_sale, a.can_writeoff, a.chat_id, COALESCE(SUM(s.real_price), 0) as total_sales FROM admins a LEFT JOIN wh_sales s ON a.chat_id = s.chat_id WHERE a.shop_id = $1 AND a.role = \'florist\' GROUP BY a.chat_id, a.name, a.warehouse_pin, a.can_receipt, a.can_sale, a.can_writeoff', [req.query.shop || 'kupidon']);
      res.json({ ok: true, staff: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 24. Экран Флористов
  app.get('/warehouse/staff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; } .header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; } .name { font-size: 18px; font-weight: bold; } .sales { font-size: 20px; color: #27ae60; margin-top: 5px; }';
    html += '.row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; } .btn-pin { margin-top:10px; padding:8px 15px; border-radius:8px; border:none; background:' + brandColor + '; color:#fff; } input[type="checkbox"] { transform: scale(1.3); accent-color: ' + brandColor + '; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h1>👥 Флористы</h1></div><div id="list"></div><script>';
    html += 'fetch("/api/warehouse/staff?shop=kupidon").then(function(r) { return r.json(); }).then(function(d) { var b = document.getElementById("list"); if (!d.ok || d.staff.length === 0) { b.innerHTML = "Нет флористов"; return; } d.staff.forEach(function(f) { var c = document.createElement("div"); c.className = "card"; var name = f.name || "Флорист"; c.innerHTML = "<div class=\'name\'>" + name + "</div>"; var sum = parseInt(f.total_sales).toLocaleString("ru-RU"); c.innerHTML += "<div class=\'sales\'>Продано: " + sum + " ₽</div>"; c.innerHTML += "<div style=\'font-size:12px;color:#888;\'>PIN: " + (f.warehouse_pin || "нет") + "</div>"; var btn = document.createElement("button"); btn.innerText = "Задать PIN"; btn.className = "btn-pin"; btn.onclick = function() { setPin(f.chat_id); }; c.appendChild(btn); c.appendChild(makeCheck("Приход", "receipt", f.can_receipt, f.chat_id)); c.appendChild(makeCheck("Продажа", "sale", f.can_sale, f.chat_id)); c.appendChild(makeCheck("Списание", "writeoff", f.can_writeoff, f.chat_id)); b.appendChild(c); }); });';
    html += 'function makeCheck(label, field, checked, chatId) { var r = document.createElement("div"); r.className = "row"; r.innerHTML = "<span>" + label + "</span>"; var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked; cb.onchange = function() { setRights(chatId, field, cb.checked); }; r.appendChild(cb); return r; }';
    html += 'function setPin(id) { var p = prompt("Введите 4 цифры:"); if (p && p.length === 4) { fetch("/api/warehouse/florist/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, pin: p }) }).then(function() { location.reload(); }); } }';
    html += 'function setRights(id, field, val) { fetch("/api/warehouse/florist/rights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, field: field, val: val }) }); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 25. API прав
  app.post('/api/warehouse/florist/pin', async (req, res) => { try { await pool.query('UPDATE admins SET warehouse_pin = $1 WHERE shop_id = $2 AND chat_id = $3', [req.body.pin, req.body.shop, req.body.chatId]); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false }); } });
  app.post('/api/warehouse/florist/rights', async (req, res) => { try { var col = req.body.field === 'sale' ? 'can_sale' : req.body.field === 'writeoff' ? 'can_writeoff' : 'can_receipt'; await pool.query('UPDATE admins SET ' + col + ' = $1 WHERE shop_id = $2 AND chat_id = $3', [req.body.val, req.body.shop, req.body.chatId]); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false }); } });

  // 26. API Журнала
  app.get('/api/warehouse/audit', async (req, res) => {
    try {
      const r = await pool.query('SELECT l.action, l.details, l.date, l.ref_id, a.name as person FROM wh_audit_log l LEFT JOIN admins a ON a.chat_id = l.chat_id WHERE l.shop_id = $1 ORDER BY l.date DESC LIMIT 50', [req.query.shop || 'kupidon']);
      res.json({ ok: true, logs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 27. Экран Журнала
  app.get('/warehouse/audit', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; } .header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.log { background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 10px; text-decoration: none; color: ' + brandColor + '; display: block; } .log.clickable { border-left: 4px solid #2980b9; } .date { font-size: 11px; color: #888; margin-top: 5px; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h1>👁 Журнал</h1></div><div id="list">Загрузка...</div><script>';
    html += 'fetch("/api/warehouse/audit?shop=kupidon").then(function(r) { return r.json(); }).then(function(d) { var b = document.getElementById("list"); b.innerHTML = ""; if (!d.ok || d.logs.length === 0) { b.innerHTML = "Журнал пуст"; return; } d.logs.forEach(function(l) { var div = document.createElement("div"); div.className = "log"; var ds = new Date(l.date).toLocaleString("ru-RU"); var p = l.person || "Система"; div.innerHTML = "<div><b>" + p + "</b>: " + l.details + "</div><div class=\'date\'>" + ds + "</div>"; if (l.ref_id && l.action === "sale") { div.className = "log clickable"; div.onclick = function() { window.location.href = "/warehouse/sale/details?id=" + l.ref_id; }; div.innerHTML += "<div style=\'font-size:12px; color:#2980b9; margin-top:5px;\'>Нажмите, чтобы посмотреть чек</div>"; } b.appendChild(div); }); });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 28. API Настроек
  app.get('/api/warehouse/settings/notif', async (req, res) => { try { const r = await pool.query('SELECT settings FROM shops WHERE shop_id = $1', [req.query.shop || 'kupidon']); res.json({ ok: true, settings: r.rows[0].settings || {} }); } catch (e) { res.status(500).json({ ok: false }); } });
  app.post('/api/warehouse/settings/notif', async (req, res) => { try { var obj = {}; obj[req.body.key] = req.body.val; await pool.query('UPDATE shops SET settings = settings || $1::jsonb WHERE shop_id = $2', [JSON.stringify(obj), req.body.shop || 'kupidon']); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false }); } });

  // 29. Экран Настроек
  app.get('/warehouse/settings', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; } .header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; } .row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; } input[type="checkbox"] { transform: scale(1.3); accent-color: ' + brandColor + '; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h1>⚙️ Настройки</h1></div><div class="card" id="list">Загрузка...</div><script>';
    html += 'fetch("/api/warehouse/settings/notif?shop=kupidon").then(function(r) { return r.json(); }).then(function(d) { var b = document.getElementById("list"); b.innerHTML = ""; if (!d.ok) return; var opts = [ { k: "notif_discount", t: "Уведомлять о скидках" }, { k: "notif_cancel", t: "Уведомлять об отмене продаж" }, { k: "notif_writeoff", t: "Уведомлять о списаниях" } ]; opts.forEach(function(o) { var r = document.createElement("div"); r.className = "row"; r.innerHTML = "<span>" + o.t + "</span>"; var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = d.settings[o.k] !== false; cb.onchange = function() { toggleNotif(o.k, cb.checked); }; r.appendChild(cb); b.appendChild(r); }); });';
    html += 'function toggleNotif(k, v) { fetch("/api/warehouse/settings/notif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", key: k, val: v }) }); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 30. API Истории
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon'; let targetDate = req.query.date || new Date().toISOString().slice(0, 10);
      const sales = await pool.query('SELECT s.id, s.real_price as amount, s.date, \'sale\' as type, a.name as person, STRING_AGG(COALESCE(shi.custom_name, i.name) || \' x\' || si.qty, \', \') as items FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id LEFT JOIN wh_sale_items si ON si.sale_id = s.id LEFT JOIN wh_shop_items shi ON shi.id = si.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE s.shop_id = $1 AND DATE(s.date) = $2 GROUP BY s.id, a.name ORDER BY s.date DESC', [shopId, targetDate]);
      const writeoffs = await pool.query('SELECT w.id, w.qty as amount, w.date, \'writeoff\' as type, a.name as person, COALESCE(shi.custom_name, i.name) as items, w.reason FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE w.shop_id = $1 AND DATE(w.date) = $2 ORDER BY w.date DESC', [shopId, targetDate]);
      const receipts = await pool.query('SELECT r.id, r.total_sum as amount, r.date, \'receipt\' as type, a.name as person, STRING_AGG(COALESCE(shi.custom_name, i.name) || \' x\' || ri.qty, \', \') as items FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id LEFT JOIN wh_receipt_items ri ON ri.receipt_id = r.id LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE r.shop_id = $1 AND DATE(r.date) = $2 GROUP BY r.id, a.name ORDER BY r.date DESC', [shopId, targetDate]);
      let list = [...sales.rows, ...writeoffs.rows, ...receipts.rows]; list.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 31. Экран Истории
  app.get('/warehouse/history', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; } .header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.calendar { display: flex; overflow-x: auto; gap: 10px; margin-bottom: 15px; } .day-btn { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 10px; text-align: center; min-width: 60px; text-decoration: none; color: ' + brandColor + '; } .day-btn.active { background: ' + brandColor + '; color: #fff; }';
    html += '.item { background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; } .item.sale { border-left: 4px solid #2980b9; } .item.writeoff { border-left: 4px solid ' + accentColor + '; } .item.receipt { border-left: 4px solid #27ae60; }';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; } .amount { font-weight: bold; font-size: 16px; text-align: right; } .items-list { font-size: 13px; color: #555; margin-top: 4px; font-style: italic; } .btn-cancel { background: #fff; border: 1px solid #e74c3c; color: #e74c3c; border-radius: 5px; padding: 5px 10px; font-size: 12px; margin-top: 5px; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h1>📋 История</h1></div><div class="calendar" id="calendar"></div><div id="list">Загрузка...</div><script>';
    html += 'var selectedDate = new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);';
    html += 'function renderCalendar() { var cal = document.getElementById("calendar"); var today = new Date(); var daysRu = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; for (var i = 0; i < 7; i++) { var d = new Date(today); d.setDate(today.getDate() - i); var dStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); var a = document.createElement("a"); a.href = "/warehouse/history?date=" + dStr; a.className = "day-btn"; if (dStr === selectedDate) a.classList.add("active"); var label = i === 0 ? "Сегодня" : daysRu[d.getDay()]; a.innerHTML = "<div style=\'font-size:10px;\'>" + label + "</div><div style=\'font-size:18px;font-weight:bold;\'>" + d.getDate() + "</div>"; cal.appendChild(a); } } renderCalendar();';
    html += 'fetch("/api/warehouse/history?shop=kupidon&date=" + selectedDate).then(function(r) { return r.json(); }).then(function(d) { var b = document.getElementById("list"); b.innerHTML = ""; if (!d.ok || d.history.length === 0) { b.innerHTML = "За этот день операций нет"; return; } d.history.forEach(function(h) { var div = document.createElement("div"); var ds = new Date(h.date).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" }); var seller = h.person || "Флорист"; if (h.type === "sale") { div.className = "item sale"; div.style.cursor = "pointer"; div.onclick = function() { window.location.href = "/warehouse/sale/details?id=" + h.id; }; div.innerHTML = "<div><b>💰 Продажа</b> (" + seller + ")<div class=\'date\'>" + ds + "</div><div class=\'items-list\'>" + (h.items || "") + "</div></div>"; var btn = "<button class=\'btn-cancel\' onclick=\'event.stopPropagation(); cancelSale(" + h.id + ")\'>Отменить</button>"; div.innerHTML += "<div><div class=\'amount\'>+" + h.amount.toLocaleString("ru-RU") + " ₽</div>" + btn + "</div>"; } else if (h.type === "receipt") { div.className = "item receipt"; div.innerHTML = "<div><b>📥 Приход</b> (" + seller + ")<div class=\'date\'>" + ds + "</div><div class=\'items-list\'>" + (h.items || "") + "</div></div><div class=\'amount\' style=\'color:#27ae60;\'>+" + h.amount.toLocaleString("ru-RU") + " ₽</div>"; } else { div.className = "item writeoff"; div.innerHTML = "<div><b>🗑 Списание</b> (" + seller + ")<div class=\'date\'>" + ds + "</div><div class=\'items-list\'>" + (h.items || "") + " (" + h.reason + ")</div></div><div class=\'amount\' style=\'color:" + accentColor + "\'>-" + h.amount + " шт</div>"; } b.appendChild(div); }); });';
    html += 'function cancelSale(id) { var ret = confirm("Вернуть товары на склад?\\n\\nОК = вернуть. Отмена = списать."); fetch("/api/warehouse/sale/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: "kupidon", saleId: id, action: ret ? "return" : "writeoff" }) }).then(function(r) { return r.json(); }).then(function(d) { if (d.ok) { alert("Отменено"); location.reload(); } else alert("Ошибка"); }); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 32. API Отмены
  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    try {
      const { shopId, saleId, action } = req.body;
      const itemsRes = await pool.query('SELECT shop_item_id, qty FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      for (var item of itemsRes.rows) {
        if (action === 'return') await pool.query('UPDATE wh_shop_items SET current_stock = current_stock + $1 WHERE id = $2', [item.qty, item.shop_item_id]);
        else await pool.query('INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, date) VALUES ($1, $2, $3, $4, $5, NOW())', [shopId, item.shop_item_id, item.qty, 'loss', 'Отмена продажи']);
      }
      await pool.query('DELETE FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      await pool.query('DELETE FROM wh_sales WHERE id = $1', [saleId]);
      await logAction(shopId, null, 'cancel', 'Отмена продажи ID: ' + saleId, saleId);
      await notifyOwner(bot, shopId, '⚠️ Отменена продажа ID: ' + saleId, 'cancel');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 33. API Деталей Продажи
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const saleId = req.query.id;
      const sale = await pool.query('SELECT s.id, s.real_price, s.date, a.name as seller FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id WHERE s.id = $1', [saleId]);
      const items = await pool.query('SELECT si.qty, si.cost_at_sale, COALESCE(shi.custom_name, i.name) as name, shi.id as shop_item_id FROM wh_sale_items si JOIN wh_shop_items shi ON shi.id = si.shop_item_id JOIN wh_items i ON i.id = shi.item_id WHERE si.sale_id = $1', [saleId]);
      res.json({ ok: true, sale: sale.rows[0], items: items.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 34. Экран Деталей Продажи
  app.get('/warehouse/sale/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; } .header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 20px; margin-bottom: 15px; } .total { font-size: 28px; font-weight: bold; color: #27ae60; margin-bottom: 10px; } .meta { font-size: 14px; color: #666; margin-bottom: 20px; }';
    html += '.item-row { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #eee; text-decoration: none; color: ' + brandColor + '; } .item-row:last-child { border-bottom: none; } .item-name { font-weight: bold; font-size: 16px; } .item-qty { color: #e74c3c; font-weight: bold; }';
    html += '</style></head><body><div class="header"><a href="/warehouse/history" class="back">←</a><h1>🧾 Чек</h1></div><div class="card" id="content">Загрузка...</div><script>';
    html += 'var saleId = new URLSearchParams(window.location.search).get("id");';
    html += 'fetch("/api/warehouse/sale/details?id=" + saleId).then(function(r) { return r.json(); }).then(function(d) { if (!d.ok) { document.getElementById("content").innerText = "Ошибка"; return; } var s = d.sale; var ds = new Date(s.date).toLocaleString("ru-RU"); var h = "<div class=\'total\'>" + s.real_price.toLocaleString("ru-RU") + " ₽</div><div class=\'meta\'>Продал: " + (s.seller || "Неизвестно") + "<br>Дата: " + ds + "</div>"; d.items.forEach(function(i) { h += "<a href=\'/warehouse/item?id=" + i.shop_item_id + "\' class=\'item-row\'><div><div class=\'item-name\'>" + i.name + "</div><div style=\'font-size:12px;color:#888;\'>Себестоимость: " + i.cost_at_sale + " ₽/шт</div></div><div class=\'item-qty\'>x" + i.qty + "</div></a>"; }); document.getElementById("content").innerHTML = h; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

}
module.exports = { setupWarehouse };