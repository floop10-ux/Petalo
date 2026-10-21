const pool = require('./db');

async function logAction(shopId, chatId, action, details) {
  try {
    await pool.query(
      'INSERT INTO wh_audit_log (shop_id, chat_id, action, details) ' +
      'VALUES ($1, $2, $3, $4)',
      [shopId, chatId, action, details]
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
      'SELECT chat_id FROM admins WHERE shop_id = $1 AND role = $2',
      [shopId, 'owner']
    );
    if (a.rows.length > 0 && bot) {
      bot.sendMessage(a.rows[0].chat_id, text, { parse_mode: 'HTML' })
         .catch(function() {});
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
      html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
      html += '<script src="https://telegram.org/js/telegram-web-app.js"><\/script>';
      html += '<style>';
      html += 'body { font-family: sans-serif; margin: 0; padding: 20px; text-align: center; background: #fafaf8; color: ' + brandColor + '; }';
      html += '.header { background: #fff; padding: 20px; border-radius: 20px; margin-bottom: 20px; border-bottom: 4px solid ' + brandColor + '; }';
      html += 'h1 { margin: 0; font-size: 24px; }';
      html += '.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }';
      html += '.btn { background: #fff; padding: 20px 10px; border-radius: 20px; text-decoration: none; color: ' + brandColor + '; font-weight: bold; font-size: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #eee; }';
      html += '.btn span { font-size: 28px; margin-bottom: 8px; }';
      html += '.full { grid-column: 1 / -1; }';
      html += '</style></head><body>';
      
      html += '<div class="header"><h1>📦 Склад</h1>';
      html += '<p style="color:#888;margin:5px 0 0;">Вы: <b>' + userName + '</b> (' + (isOwner ? 'Владелец' : 'Флорист') + ')</p></div>';
      html += '<div class="grid">';
      
      if (isOwner || canSale) {
        html += '<a href="/warehouse/sale" class="btn"><span>💰</span>Продажа</a>';
      }
      if (isOwner || canWriteoff) {
        html += '<a href="/warehouse/writeoff" class="btn"><span>🗑</span>Списание</a>';
      }
      if (isOwner || canReceipt) {
        html += '<a href="/warehouse/receipt" class="btn"><span>📥</span>Приход</a>';
      }
      
      html += '<a href="/warehouse/history" class="btn"><span>📋</span>История</a>';
      html += '<a href="/warehouse/inventory" class="btn"><span>📦</span>Обзор</a>';
      
      if (isOwner) {
        html += '<a href="/warehouse/staff" class="btn"><span>👥</span>Флористы</a>';
        html += '<a href="/warehouse/reports" class="btn"><span>📊</span>Отчёты</a>';
        html += '<a href="/warehouse/audit" class="btn"><span>👁</span>Журнал</a>';
        html += '<a href="/warehouse/settings" class="btn full"><span>⚙️</span>Настройки</a>';
      }
      html += '</div>';
      html += '<script>Telegram.WebApp.ready();<\/script></body></html>';
      res.send(html);
    } catch (e) { res.status(500).send('Ошибка сервера'); }
  });

  // 2. Вход
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; text-align: center; padding: 50px 20px; background: #fafaf8; }';
    html += '.card { background: #fff; border-radius: 20px; padding: 30px; max-width: 400px; margin: 0 auto; border-bottom: 5px solid ' + brandColor + '; }';
    html += 'input { font-size: 24px; padding: 10px; width: 120px; text-align: center; border: 2px solid #ddd; border-radius: 10px; margin: 20px 0; }';
    html += 'button { background: ' + brandColor + '; color: white; border: none; padding: 15px 40px; font-size: 18px; border-radius: 30px; }';
    html += '</style></head><body>';
    html += '<div class="card"><h1>📦 Склад</h1><p>Введите PIN-код</p>';
    html += '<input type="password" id="pin" maxlength="4" inputmode="numeric" placeholder="****">';
    html += '<br><button onclick="login()">Войти</button></div>';
    html += '<script>';
    html += 'function login() {';
    html += '  var pin = document.getElementById("pin").value;';
    html += '  fetch("/api/warehouse/auth", { method: "POST", headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "' + shopId + '", pin: pin }) }).then(r => r.json()).then(data => {';
    html += '    if (data.ok) window.location.href = "/warehouse-app"; else alert("Неверный PIN"); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 3. API Авторизации
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT chat_id, role FROM admins WHERE shop_id = $1 AND warehouse_pin = $2',
        [req.body.shopId, req.body.pin]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      res.setHeader('Set-Cookie', 'wh_auth=' + r.rows[0].chat_id + '; Path=/; Max-Age=2592000; HttpOnly');
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 4. API Товаров (с розничной ценой)
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT i.id, i.current_stock, i.retail_price, ' +
        'COALESCE(i.custom_name, w.name) AS name, w.photo_url ' +
        'FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 ORDER BY w.name ASC', [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 5. Экран Обзора склада (Каталог)
  app.get('/warehouse/inventory', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }';
    html += '.card { background: #fff; padding: 10px; border-radius: 10px; text-align: center; text-decoration: none; color: ' + brandColor + '; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }';
    html += '.card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }';
    html += '.name { font-size: 13px; font-weight: bold; margin-bottom: 4px; }';
    html += '.stock { font-size: 12px; font-weight: bold; }';
    html += '.green { color: #27ae60; } .red { color: #e74c3c; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📦 Обзор</h1></div>';
    html += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<script>';
    html += 'var allItems = [];';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(r => r.json()).then(d => {';
    html += '  if (d.ok) { allItems = d.items; render(allItems); }';
    html += '});';
    
    html += 'function render(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(i => {';
    html += '    var a = document.createElement("a"); a.className = "card";';
    html += '    a.href = "/warehouse/item?id=" + i.id;';
    html += '    var img = i.photo_url ? \'<img src="\' + i.photo_url + \'">\' : \'<div class="ph">📷</div>\';';
    html += '    var stockColor = parseFloat(i.current_stock) > 0 ? "green" : "red";';
    html += '    a.innerHTML = img + \'<div class="name">\' + i.name + \'</div>\';';
    html += '    a.innerHTML += \'<div class="stock \' + stockColor + \'">Ост: \' + i.current_stock + \'</div>\';';
    html += '    g.appendChild(a);';
    html += '  });';
    html += '}';
    
    html += 'function filterItems() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  render(allItems.filter(i => i.name.toLowerCase().includes(q)));';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 6. Экран Прихода (с розничной ценой)
  app.get('/warehouse/receipt', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 20px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; }';
    html += 'label { display: block; font-size: 12px; color: #888; margin-bottom: 5px; }';
    html += 'input[type="text"], input[type="number"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.btn-save { width: 100%; background: ' + brandColor + '; color: #fff; border: none; padding: 15px; border-radius: 10px; font-size: 18px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📥 Приход</h1></div>';
    html += '<div class="card">';
    html += '<label>Название</label>';
    html += '<input type="text" id="itemName" list="itemsList" placeholder="Начните вводить...">';
    html += '<datalist id="itemsList"></datalist>';
    
    html += '<label>Количество</label><input type="number" id="itemQty" step="0.1">';
    html += '<label>Цена закупки (себестоимость)</label><input type="number" id="itemPrice">';
    html += '<label>Розничная цена (для витрины)</label><input type="number" id="itemRetail">';
    html += '<label>Фото</label><input type="file" id="itemPhoto" accept="image/*">';
    html += '</div>';
    html += '<button class="btn-save" onclick="saveReceipt()">Добавить</button>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(r => r.json()).then(d => {';
    html += '  var dl = document.getElementById("itemsList");';
    html += '  if (d.ok) { d.items.forEach(i => {';
    html += '    var opt = document.createElement("option"); opt.value = i.name; dl.appendChild(opt);';
    html += '  }); }';
    html += '});';

    html += 'function saveReceipt() {';
    html += '  var name = document.getElementById("itemName").value;';
    html += '  var qty = document.getElementById("itemQty").value;';
    html += '  var price = document.getElementById("itemPrice").value;';
    html += '  var retail = document.getElementById("itemRetail").value || 0;';
    html += '  if (!name || !qty || !price) { alert("Заполните поля"); return; }';
    html += '  var file = document.getElementById("itemPhoto").files[0];';
    html += '  if (file) {';
    html += '    var reader = new FileReader();';
    html += '    reader.onload = function(e) { upload(e.target.result, name, qty, price, retail); };';
    html += '    reader.readAsDataURL(file);';
    html += '  } else submit(name, qty, price, retail, null, null);';
    html += '}';
    html += 'function upload(base64, name, qty, price, retail) {';
    html += '  fetch("/api/warehouse/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }) })';
    html += '  .then(r => r.json()).then(d => { submit(name, qty, price, retail, d.url, d.urlBackup); })';
    html += '  .catch(function() { submit(name, qty, price, retail, null, null); });';
    html += '}';
    html += 'function submit(name, qty, price, retail, url, url2) {';
    html += '  fetch("/api/warehouse/receipt", { method: "POST", headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "kupidon", name: name, qty: qty, price: price, retail_price: retail, photo: url, photoBackup: url2 }) })';
    html += '  .then(r => r.json()).then(d => {';
    html += '    if (d.ok) { alert("Добавлено!"); window.location.href="/warehouse-app"; }';
    html += '    else alert("Ошибка: " + (d.error || "unknown"));';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 7. Экран Продажи (со скидками)
  app.get('/warehouse/sale', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }';
    html += '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 20px; }';
    html += '.card { background: #fff; padding: 8px; border-radius: 10px; text-align: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }';
    html += '.card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }';
    html += '.card .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }';
    html += '.card .stock { font-size: 11px; color: #27ae60; }';
    html += '.basket { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; border: 2px solid ' + brandColor + '; display: none; }';
    html += '.b-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; }';
    html += '.btn-save { width: 100%; padding: 15px; background: ' + brandColor + '; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; margin-top: 10px; }';
    html += '</style></head><body>';

    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>💰 Продажа</h1></div>';
    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">Выбрано:</h3>';
    html += '<div id="bList"></div>';
    html += '<div id="discountBox" style="display:none; margin-top:10px; padding:10px; background:#fff3e0; border-radius:8px;">';
    html += '<div style="font-size:12px; color:#e65100;">Скидка от розницы!</div>';
    html += '<input type="text" id="discReason" placeholder="Причина скидки (опт, торг...)" style="width:100%; padding:8px; margin-top:5px; border:1px solid #ffb74d; border-radius:5px;">';
    html += '</div>';
    html += '<label style="font-size:12px; color:#666; margin-top:10px; display:block;">Сумма</label>';
    html += '<input type="number" id="totalPrice" step="0.01" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-top:5px; box-sizing:border-box;" onchange="checkDiscount()">';
    html += '<button class="btn-save" onclick="saveSale()">Продать</button></div>';
    html += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    html += '<script>';
    html += 'var allItems = []; var cart = []; var retailSum = 0;';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(r => r.json()).then(d => { allItems = d.items; render(allItems); });';
    html += 'function render(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(item => {';
    html += '    var div = document.createElement("div"); div.className = "card";';
    html += '    var img = item.photo_url ? \'<img src="\' + item.photo_url + \'">\' : \'<div class="ph">📷</div>\';';
    html += '    div.innerHTML = img + \'<div class="name">\' + item.name + \'</div>\';';
    html += '    div.innerHTML += \'<div class="stock">Ост: \' + item.current_stock + \'</div>\';';
    html += '    div.onclick = function() { addToCart(item); }; g.appendChild(div);';
    html += '  });';
    html += '}';
    html += 'function filterItems() { var q = document.getElementById("search").value.toLowerCase(); render(allItems.filter(i => i.name.toLowerCase().includes(q))); }';
    html += 'function addToCart(item) {';
    html += '  var ex = cart.find(c => c.id === item.id);';
    html += '  if (ex) ex.qty += 1; else cart.push({ id: item.id, name: item.name, qty: 1, retail: item.retail_price || 0 });';
    html += '  renderBasket();';
    html += '}';
    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket"); var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = ""; retailSum = 0;';
    html += '  cart.forEach((item, idx) => {';
    html += '    retailSum += (item.retail * item.qty);';
    html += '    var div = document.createElement("div"); div.className = "b-row";';
    html += '    div.innerHTML = \'<span>\' + item.name + \'</span>\' +';
    html += '      \'<input type="number" step="0.1" value="\' + item.qty + \'" onchange="upQty(\' + idx + \', this.value)" style="width:60px; text-align:center;">\' +';
    html += '      \'<button onclick="cart.splice(\' + idx + \', 1); renderBasket();" style="border:none; color:red; font-size:20px;">✕</button>\';';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '  checkDiscount();';
    html += '}';
    html += 'function upQty(idx, val) { var v = parseFloat(val); if (isNaN(v) || v <= 0) v = 1; cart[idx].qty = v; renderBasket(); }';
    html += 'function checkDiscount() {';
    html += '  var total = parseFloat(document.getElementById("totalPrice").value) || 0;';
    html += '  if (total > 0 && total < retailSum) {';
    html += '    document.getElementById("discountBox").style.display = "block";';
    html += '  } else {';
    html += '    document.getElementById("discountBox").style.display = "none";';
    html += '  }';
    html += '}';
    html += 'function saveSale() {';
    html += '  var total = document.getElementById("totalPrice").value;';
    html += '  if (!total) { alert("Введите сумму"); return; }';
    html += '  var reason = document.getElementById("discReason").value;';
    html += '  fetch("/api/warehouse/sale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: "kupidon", real_price: total, retail_sum: retailSum, discount_reason: reason, items: cart }) })';
    html += '  .then(r => r.json()).then(d => {';
    html += '    if (d.ok) { alert("Продано!"); window.location.href="/warehouse-app"; }';
    html += '    else alert("Ошибка: " + (d.error || "unknown"));';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 8. Экран Списания
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
    html += '.card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; }';
    html += '.card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; }';
    html += '.reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }';
    html += '.reason { padding: 12px; border-radius: 10px; border: 2px solid #eee; background: #fff; text-align: center; }';
    html += '.reason.active { border-color: ' + accentColor + '; color: ' + accentColor + '; font-weight: bold; }';
    html += '.btn-save { width: 100%; padding: 15px; background: ' + accentColor + '; color: #fff; border: none; border-radius: 10px; font-size: 18px; margin-top: 15px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>🗑 Списание</h1></div>';
    html += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    html += '<div id="form" style="display:none;">';
    html += '<h3>Причина</h3><div class="reasons">';
    html += '<div class="reason active" onclick="setR(this, \'spoilage\')">Порча</div>';
    html += '<div class="reason" onclick="setR(this, \'loss\')">Потеря</div>';
    html += '<div class="reason" onclick="setR(this, \'markdown\')">Уценка</div>';
    html += '<div class="reason" onclick="setR(this, \'sorting\')">Пересорт</div>';
    html += '</div>';
    html += '<label>Комментарий</label>';
    html += '<textarea id="comment" style="width:100%; padding:10px; border-radius:10px; border:1px solid #ddd; margin-bottom:10px;"></textarea>';
    html += '<label>Фото (необязательно)</label>';
    html += '<input type="file" id="wPhoto" accept="image/*" style="margin-bottom:15px;">';
    html += '<button class="btn-save" onclick="saveWriteoff()">Списать</button></div>';
    
    html += '<script>';
    html += 'var allItems = []; var selItem = null; var selReason = "spoilage";';
    html += 'fetch("/api/warehouse/items?shop=kupidon").then(r => r.json()).then(d => { allItems = d.items; render(); });';
    html += 'function render() { drawCards(allItems); }';
    html += 'function filterItems() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  drawCards(allItems.filter(i => i.name.toLowerCase().includes(q)));';
    html += '}';
    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(i => {';
    html += '    var d = document.createElement("div"); d.className = "card";';
    html += '    var img = i.photo_url ? \'<img src="\' + i.photo_url + \'">\' : \'<div class="ph">📷</div>\';';
    html += '    d.innerHTML = img + \'<div>\' + i.name + \'</div>\';';
    html += '    d.onclick = () => selectItem(i); g.appendChild(d);';
    html += '  });';
    html += '}';
    html += 'function selectItem(item) {';
    html += '  var q = prompt("Сколько списать?", "1");';
    html += '  if (q && parseFloat(q) > 0) {';
    html += '    selItem = { id: item.id, qty: parseFloat(q), name: item.name };';
    html += '    document.getElementById("form").style.display = "block";';
    html += '  }';
    html += '}';
    html += 'function setR(el, r) {';
    html += '  document.querySelectorAll(".reason").forEach(b => b.classList.remove("active"));';
    html += '  el.classList.add("active"); selReason = r;';
    html += '}';
    html += 'function saveWriteoff() {';
    html += '  if (!selItem) return; var c = document.getElementById("comment").value;';
    html += '  var f = document.getElementById("wPhoto").files[0];';
    html += '  if (f) { var rd = new FileReader(); rd.onload = e => upload(e.target.result, c); rd.readAsDataURL(f); }';
    html += '  else submit(null, c);';
    html += '}';
    html += 'function upload(base64, c) {';
    html += '  fetch("/api/warehouse/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }) })';
    html += '  .then(r => r.json()).then(d => submit(d.url, c)).catch(() => submit(null, c));';
    html += '}';
    html += 'function submit(url, c) {';
    html += '  fetch("/api/warehouse/writeoff", { method: "POST", headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "kupidon", items: [selItem], reason: selReason, comment: c, photo: url }) })';
    html += '  .then(r => r.json()).then(d => { if (d.ok) { alert("Списано!"); window.location.href="/warehouse-app"; } else alert(d.error); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 9. API Прихода (сохраняем retail_price)
  app.post('/api/warehouse/receipt', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      const name = req.body.name;
      const qty = parseFloat(req.body.qty);
      const price = parseFloat(req.body.price);
      const retail = parseFloat(req.body.retail_price) || 0;
      const sum = qty * price;

      let itemRes = await pool.query('SELECT id FROM wh_items WHERE name = $1', [name]);
      let itemId;
      if (itemRes.rows.length === 0) {
        const newItem = await pool.query(
          'INSERT INTO wh_items (name, unit, photo_url, photo_url_backup) VALUES ($1, \'шт\', $2, $3) RETURNING id',
          [name, req.body.photo, req.body.photoBackup]
        );
        itemId = newItem.rows[0].id;
      } else {
        itemId = itemRes.rows[0].id;
      }

      const curr = await pool.query('SELECT current_stock, avg_cost FROM wh_shop_items WHERE shop_id = $1 AND item_id = $2', [req.body.shopId, itemId]);
      let oldStock = 0; let oldAvg = 0;
      if (curr.rows.length > 0) { oldStock = parseFloat(curr.rows[0].current_stock); oldAvg = parseFloat(curr.rows[0].avg_cost); }
      const newStock = oldStock + qty;
      const newAvg = (oldStock * oldAvg + qty * price) / newStock;
      
      await pool.query(
        'INSERT INTO wh_shop_items (shop_id, item_id, current_stock, last_cost, avg_cost, retail_price) VALUES ($1, $2, $3, $4, $5, $6) ' +
        'ON CONFLICT (shop_id, item_id) DO UPDATE SET current_stock = $3, last_cost = $4, avg_cost = $5, retail_price = $6',
        [req.body.shopId, itemId, newStock, price, newAvg, retail]
      );

      const shopItemRes = await pool.query('SELECT id FROM wh_shop_items WHERE shop_id = $1 AND item_id = $2', [req.body.shopId, itemId]);
      const receiptRes = await pool.query('INSERT INTO wh_receipts (shop_id, chat_id, total_sum) VALUES ($1, $2, $3) RETURNING id', [req.body.shopId, chatId, sum]);
      await pool.query(
        'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)',
        [receiptRes.rows[0].id, shopItemRes.rows[0].id, qty, price, sum]
      );

      await logAction(req.body.shopId, chatId, 'receipt', 'Приход: ' + name + ' x' + qty);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 10. API Продажи (со скидками и уведомлениями)
  app.post('/api/warehouse/sale', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      const real_price = req.body.real_price;
      const retail_sum = req.body.retail_sum || 0;
      const reason = req.body.discount_reason || '';
      
      const saleRes = await pool.query(
        'INSERT INTO wh_sales (shop_id, real_price, retail_price, discount_reason, chat_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', 
        [req.body.shopId, real_price, retail_sum, reason, chatId]
      );
      const saleId = saleRes.rows[0].id;
      let itemsStr = '';

      for (let item of req.body.items) {
        await pool.query('UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2', [item.qty, item.id]);
        const costQ = await pool.query('SELECT avg_cost FROM wh_shop_items WHERE id = $1', [item.id]);
        await pool.query('INSERT INTO wh_sale_items (sale_id, shop_item_id, qty, cost_at_sale) VALUES ($1, $2, $3, $4)', [saleId, item.id, item.qty, costQ.rows[0].avg_cost || 0]);
        itemsStr += item.name + ' x' + item.qty + ', ';
      }

      if (retail_sum > real_price && retail_sum > 0) {
        let msg = '⚠️ <b>Скидка при продаже</b>\n\n';
        msg += 'Сумма по рознице: ' + retail_sum + ' ₽\n';
        msg += 'Продано за: ' + real_price + ' ₽\n';
        msg += 'Причина: ' + (reason || 'не указана') + '\n';
        msg += 'Товары: ' + itemsStr.slice(0, -2);
        await notifyOwner(bot, req.body.shopId, msg, 'discount');
        await logAction(req.body.shopId, chatId, 'discount', 'Скидка: ' + (retail_sum - real_price) + ' ₽. Причина: ' + reason);
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 11. API Списания
  app.post('/api/warehouse/writeoff', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;

      for (let item of req.body.items) {
        await pool.query('UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2', [item.qty, item.id]);
        await pool.query(
          'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, photo_url, chat_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
          [req.body.shopId, item.id, item.qty, req.body.reason, req.body.comment, req.body.photo, chatId]
        );
      }
      await logAction(req.body.shopId, chatId, 'writeoff', 'Списание: ' + req.body.items[0].name + ' x' + req.body.items[0].qty);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 12. API Загрузки фото
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

  // 13. API Отчётов (с периодами)
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const period = req.query.period || 'all';
      
      let dateFilter = '';
      if (period === 'today') dateFilter = 'AND DATE(date) = CURRENT_DATE';
      if (period === 'week') dateFilter = "AND date >= NOW() - INTERVAL '7 days'";
      if (period === 'month') dateFilter = "AND date >= NOW() - INTERVAL '1 month'";

      const rev = await pool.query(`SELECT COALESCE(SUM(real_price), 0) AS total FROM wh_sales WHERE shop_id = $1 ${dateFilter}`, [shopId]);
      const loss = await pool.query(`SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total FROM wh_writeoffs w JOIN wh_shop_items i ON i.id = w.shop_item_id WHERE w.shop_id = $1 ${dateFilter.replace('date', 'w.date')}`, [shopId]);
      const cost = await pool.query(`SELECT COALESCE(SUM(s.qty * s.cost_at_sale), 0) AS total FROM wh_sale_items s JOIN wh_sales sa ON sa.id = s.sale_id WHERE sa.shop_id = $1 ${dateFilter.replace('date', 'sa.date')}`, [shopId]);
      
      const revenue = parseInt(rev.rows[0].total) || 0;
      const losses = parseInt(loss.rows[0].total) || 0;
      const costVal = parseInt(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      let lossPercent = 0;
      if ((revenue + losses) > 0) lossPercent = Math.round((losses / (revenue + losses)) * 100);
      
      res.json({ ok: true, revenue, profit, losses, lossPercent });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 14. Экран Отчётов
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.filters { display: flex; gap: 10px; margin-bottom: 15px; }';
    html += '.filter { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; text-align: center; cursor: pointer; font-size: 14px; }';
    html += '.filter.active { background: ' + brandColor + '; color: #fff; border-color: ' + brandColor + '; }';
    html += '.card { background: #fff; border-radius: 15px; padding: 20px; margin-bottom: 15px; text-align: center; }';
    html += '.val { font-size: 28px; font-weight: bold; }';
    html += '.blue { color: #2980b9; } .green { color: #27ae60; } .red { color: ' + accentColor + '; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📊 Отчёты</h1></div>';
    
    html += '<div class="filters">';
    html += '<div class="filter" id="f-today" onclick="setPeriod(\'today\')">Сегодня</div>';
    html += '<div class="filter" id="f-week" onclick="setPeriod(\'week\')">Неделя</div>';
    html += '<div class="filter" id="f-month" onclick="setPeriod(\'month\')">Месяц</div>';
    html += '<div class="filter active" id="f-all" onclick="setPeriod(\'all\')">Всё</div>';
    html += '</div>';

    html += '<div id="load" style="text-align:center;">Загрузка...</div>';
    html += '<div id="cont" style="display:none;">';
    html += '<div class="card"><div>Выручка</div><div class="val blue" id="rev">0</div></div>';
    html += '<div class="card"><div>Прибыль</div><div class="val green" id="prof">0</div></div>';
    html += '<div class="card" style="border: 2px solid ' + accentColor + ';"><div>Потери</div><div class="val red" id="loss">0</div><div id="pct"></div></div>';
    html += '</div>';
    
    html += '<script>';
    html += 'var currentPeriod = "all";';
    html += 'function setPeriod(p) {';
    html += '  currentPeriod = p;';
    html += '  document.querySelectorAll(".filter").forEach(el => el.classList.remove("active"));';
    html += '  document.getElementById("f-" + p).classList.add("active");';
    html += '  loadData();';
    html += '}';
    html += 'function loadData() {';
    html += '  document.getElementById("load").style.display = "block";';
    html += '  document.getElementById("cont").style.display = "none";';
    html += '  fetch("/api/warehouse/reports?shop=kupidon&period=" + currentPeriod)';
    html += '  .then(r => r.json()).then(d => {';
    html += '    if (d.ok) {';
    html += '      document.getElementById("load").style.display="none";';
    html += '      document.getElementById("cont").style.display="block";';
    html += '      var r = d.revenue.toLocaleString("ru-RU");';
    html += '      var p = d.profit.toLocaleString("ru-RU");';
    html += '      var l = d.losses.toLocaleString("ru-RU");';
    html += '      document.getElementById("rev").innerText = r + " ₽";';
    html += '      document.getElementById("prof").innerText = p + " ₽";';
    html += '      document.getElementById("loss").innerText = l + " ₽";';
    html += '      document.getElementById("pct").innerText = d.lossPercent + "% от закупок";';
    html += '    }';
    html += '  });';
    html += '}';
    html += 'loadData();';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // 15. API Флористов (с суммой продаж)
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        'SELECT a.name, a.warehouse_pin, a.can_receipt, ' +
        'a.can_sale, a.can_writeoff, a.chat_id, ' +
        'COALESCE(SUM(s.real_price), 0) as total_sales ' +
        'FROM admins a ' +
        'LEFT JOIN wh_sales s ON a.chat_id = s.chat_id ' +
        'WHERE a.shop_id = $1 AND a.role = \'florist\' ' +
        'GROUP BY a.chat_id, a.name, a.warehouse_pin, ' +
        'a.can_receipt, a.can_sale, a.can_writeoff',
        [shopId]
      );
      res.json({ ok: true, staff: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 16. Экран Флористов
  app.get('/warehouse/staff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0;';
    html += ' padding: 15px; background: #fafaf8;';
    html += ' color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none;';
    html += ' color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px;';
    html += ' padding: 15px; margin-bottom: 15px; }';
    html += '.name { font-size: 18px; font-weight: bold; }';
    html += '.sales { font-size: 20px; color: #27ae60; margin-top: 5px; }';
    html += '.row { display: flex; justify-content: space-between;';
    html += ' margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }';
    html += '.btn-pin { margin-top:10px; padding:8px 15px;';
    html += ' border-radius:8px; border:none;';
    html += ' background:' + brandColor + '; color:#fff; }';
    html += 'input[type="checkbox"] { transform: scale(1.3);';
    html += ' accent-color: ' + brandColor + '; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>👥 Флористы</h1></div><div id="list"></div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/staff?shop=kupidon")';
    html += '.then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list");';
    html += '  if (!d.ok || d.staff.length === 0) {';
    html += '    b.innerHTML = "Нет флористов"; return;';
    html += '  }';
    html += '  d.staff.forEach(f => {';
    html += '    var c = document.createElement("div");';
    html += '    c.className = "card";';
    html += '    var name = f.name || "Флорист";';
    html += '    c.innerHTML = "<div class=\'name\'>" + name + "</div>";';
    html += '    var sum = parseInt(f.total_sales).toLocaleString("ru-RU");';
    html += '    c.innerHTML += "<div class=\'sales\'>Продано: " + sum + " ₽</div>";';
    html += '    c.innerHTML += "<div style=\'font-size:12px;color:#888;\'>PIN: " + (f.warehouse_pin || "нет") + "</div>";';
    html += '    var btn = document.createElement("button");';
    html += '    btn.innerText = "Задать PIN"; btn.className = "btn-pin";';
    html += '    btn.onclick = () => setPin(f.chat_id); c.appendChild(btn);';
    html += '    c.appendChild(makeCheck("Приход", "receipt", f.can_receipt, f.chat_id));';
    html += '    c.appendChild(makeCheck("Продажа", "sale", f.can_sale, f.chat_id));';
    html += '    c.appendChild(makeCheck("Списание", "writeoff", f.can_writeoff, f.chat_id));';
    html += '    b.appendChild(c);';
    html += '  });';
    html += '});';
    
    html += 'function makeCheck(label, field, checked, chatId) {';
    html += '  var r = document.createElement("div"); r.className = "row";';
    html += '  r.innerHTML = "<span>" + label + "</span>";';
    html += '  var cb = document.createElement("input"); cb.type = "checkbox";';
    html += '  cb.checked = checked;';
    html += '  cb.onchange = () => setRights(chatId, field, cb.checked);';
    html += '  r.appendChild(cb); return r;';
    html += '}';
    html += 'function setPin(id) {';
    html += '  var p = prompt("Введите 4 цифры:");';
    html += '  if (p && p.length === 4) {';
    html += '    fetch("/api/warehouse/florist/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, pin: p }) }).then(() => location.reload());';
    html += '  }';
    html += '}';
    html += 'function setRights(id, field, val) {';
    html += '  fetch("/api/warehouse/florist/rights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, field: field, val: val }) });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 17. API Обновления прав и PIN (скрытые обработчики)
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      await pool.query('UPDATE admins SET warehouse_pin = $1 WHERE shop_id = $2 AND chat_id = $3', [req.body.pin, req.body.shop, req.body.chatId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      let col = 'can_receipt';
      if (req.body.field === 'sale') col = 'can_sale';
      if (req.body.field === 'writeoff') col = 'can_writeoff';
      await pool.query('UPDATE admins SET ' + col + ' = $1 WHERE shop_id = $2 AND chat_id = $3', [req.body.val, req.body.shop, req.body.chatId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 18. API Журнала действий (Audit Log)
  app.get('/api/warehouse/audit', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        'SELECT l.action, l.details, l.date, a.name as person ' +
        'FROM wh_audit_log l ' +
        'LEFT JOIN admins a ON a.chat_id = l.chat_id ' +
        'WHERE l.shop_id = $1 ORDER BY l.date DESC LIMIT 50',
        [shopId]
      );
      res.json({ ok: true, logs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 19. Экран Журнала действий
  app.get('/warehouse/audit', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px;';
    html += ' background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none;';
    html += ' color: ' + brandColor + '; margin-right: 15px; }';
    html += '.log { background: #fff; border-radius: 10px;';
    html += ' padding: 15px; margin-bottom: 10px; }';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>👁 Журнал</h1></div>';
    html += '<div id="list">Загрузка...</div>';
    html += '<script>';
    html += 'fetch("/api/warehouse/audit?shop=kupidon").then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok || d.logs.length === 0) { b.innerHTML = "Журнал пуст"; return; }';
    html += '  d.logs.forEach(l => {';
    html += '    var div = document.createElement("div"); div.className = "log";';
    html += '    var ds = new Date(l.date).toLocaleString("ru-RU");';
    html += '    var p = l.person ? l.person : "Система";';
    html += '    div.innerHTML = "<div><b>" + p + "</b>: " + l.details + "</div>";';
    html += '    div.innerHTML += "<div class=\'date\'>" + ds + "</div>";';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 20. API Настроек (уведомления)
  app.get('/api/warehouse/settings/notif', async (req, res) => {
    try {
      const r = await pool.query('SELECT settings FROM shops WHERE shop_id = $1', [req.query.shop || 'kupidon']);
      const s = r.rows[0].settings || {};
      res.json({ ok: true, settings: s });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  app.post('/api/warehouse/settings/notif', async (req, res) => {
    try {
      const key = req.body.key; const val = req.body.val;
      const obj = {}; obj[key] = val;
      await pool.query('UPDATE shops SET settings = settings || $1::jsonb WHERE shop_id = $2', [JSON.stringify(obj), req.body.shop || 'kupidon']);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 21. Экран Настроек (уведомления)
  app.get('/warehouse/settings', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px;';
    html += ' background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none;';
    html += ' color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px;';
    html += ' padding: 15px; margin-bottom: 15px; }';
    html += '.row { display: flex; justify-content: space-between;';
    html += ' margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }';
    html += 'input[type="checkbox"] { transform: scale(1.3);';
    html += ' accent-color: ' + brandColor + '; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>⚙️ Уведомления</h1></div>';
    html += '<div class="card" id="list">Загрузка...</div>';
    html += '<script>';
    html += 'fetch("/api/warehouse/settings/notif?shop=kupidon").then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok) return;';
    html += '  var opts = [';
    html += '    { k: "notif_discount", t: "Скидки при продаже" },';
    html += '    { k: "notif_cancel", t: "Отмена продаж" },';
    html += '    { k: "notif_writeoff", t: "Крупные списания" }';
    html += '  ];';
    html += '  opts.forEach(o => {';
    html += '    var r = document.createElement("div"); r.className = "row";';
    html += '    r.innerHTML = "<span>" + o.t + "</span>";';
    html += '    var cb = document.createElement("input"); cb.type = "checkbox";';
    html += '    cb.checked = d.settings[o.k] !== false;';
    html += '    cb.onchange = () => toggleNotif(o.k, cb.checked);';
    html += '    r.appendChild(cb); b.appendChild(r);';
    html += '  });';
    html += '});';
    html += 'function toggleNotif(k, v) {';
    html += '  fetch("/api/warehouse/settings/notif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", key: k, val: v }) });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 22. API Истории (Календарь)
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      let targetDate = req.query.date || new Date().toISOString().slice(0, 10);
      
      const sales = await pool.query(
        `SELECT s.id, s.real_price as amount, s.date, 'sale' as type, a.name as person, ` +
        `STRING_AGG(COALESCE(shi.custom_name, i.name) || ' x' || si.qty, ', ') as items ` +
        `FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id ` +
        `LEFT JOIN wh_sale_items si ON si.sale_id = s.id ` +
        `LEFT JOIN wh_shop_items shi ON shi.id = si.shop_item_id ` +
        `LEFT JOIN wh_items i ON i.id = shi.item_id ` +
        `WHERE s.shop_id = $1 AND DATE(s.date) = $2 ` +
        `GROUP BY s.id, a.name ORDER BY s.date DESC`, [shopId, targetDate]
      );
      
      const writeoffs = await pool.query(
        `SELECT w.id, w.qty as amount, w.date, 'writeoff' as type, a.name as person, ` +
        `COALESCE(shi.custom_name, i.name) as items, w.reason ` +
        `FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id ` +
        `LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ` +
        `LEFT JOIN wh_items i ON i.id = shi.item_id ` +
        `WHERE w.shop_id = $1 AND DATE(w.date) = $2 ` +
        `ORDER BY w.date DESC`, [shopId, targetDate]
      );
      
      const receipts = await pool.query(
        `SELECT r.id, r.total_sum as amount, r.date, 'receipt' as type, a.name as person, ` +
        `STRING_AGG(COALESCE(shi.custom_name, i.name) || ' x' || ri.qty, ', ') as items ` +
        `FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id ` +
        `LEFT JOIN wh_receipt_items ri ON ri.receipt_id = r.id ` +
        `LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ` +
        `LEFT JOIN wh_items i ON i.id = shi.item_id ` +
        `WHERE r.shop_id = $1 AND DATE(r.date) = $2 ` +
        `GROUP BY r.id, a.name ORDER BY r.date DESC`, [shopId, targetDate]
      );
      
      let list = [...sales.rows, ...writeoffs.rows, ...receipts.rows];
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 23. Экран Истории (с календарем)
  app.get('/warehouse/history', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px;';
    html += ' background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none;';
    html += ' color: ' + brandColor + '; margin-right: 15px; }';
    html += '.calendar { display: flex; overflow-x: auto; gap: 10px; margin-bottom: 15px; }';
    html += '.day-btn { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 10px; text-align: center; min-width: 60px; text-decoration: none; color: ' + brandColor + '; }';
    html += '.day-btn.active { background: ' + brandColor + '; color: #fff; }';
    html += '.item { background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; }';
    html += '.item.sale { border-left: 4px solid #27ae60; }';
    html += '.item.writeoff { border-left: 4px solid ' + accentColor + '; }';
    html += '.item.receipt { border-left: 4px solid #3498db; }';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; }';
    html += '.amount { font-weight: bold; font-size: 16px; text-align: right; }';
    html += '.items-list { font-size: 13px; color: #555; margin-top: 4px; font-style: italic; }';
    html += '.btn-cancel { background: #fff; border: 1px solid #e74c3c; color: #e74c3c; border-radius: 5px; padding: 5px 10px; font-size: 12px; margin-top: 5px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h1>📋 История</h1></div>';
    html += '<div class="calendar" id="calendar"></div>';
    html += '<div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var selectedDate = urlParams.get("date") || new Date().toISOString().slice(0, 10);';
    html += 'function renderCalendar() {';
    html += '  var cal = document.getElementById("calendar");';
    html += '  var today = new Date();';
    html += '  var daysRu = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];';
    html += '  for (var i = 0; i < 7; i++) {';
    html += '    var d = new Date(today); d.setDate(today.getDate() - i);';
    html += '    var yyyy = d.getFullYear();';
    html += '    var mm = String(d.getMonth() + 1).padStart(2, "0");';
    html += '    var dd = String(d.getDate()).padStart(2, "0");';
    html += '    var dStr = yyyy + "-" + mm + "-" + dd;';
    html += '    var a = document.createElement("a");';
    html += '    a.href = "/warehouse/history?date=" + dStr;';
    html += '    a.className = "day-btn";';
    html += '    if (dStr === selectedDate) a.classList.add("active");';
    html += '    var label = i === 0 ? "Сегодня" : daysRu[d.getDay()];';
    html += '    a.innerHTML = "<div style=\'font-size:10px;\'>" + label + "</div>";';
    html += '    a.innerHTML += "<div style=\'font-size:18px;font-weight:bold;\'>" + dd + "</div>";';
    html += '    cal.appendChild(a);';
    html += '  }';
    html += '}';
    html += 'renderCalendar();';

    html += 'fetch("/api/warehouse/history?shop=kupidon&date=" + selectedDate)';
    html += '.then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok || d.history.length === 0) { b.innerHTML = "За этот день операций нет"; return; }';
    html += '  d.history.forEach(h => {';
    html += '    var div = document.createElement("div");';
    html += '    var ds = new Date(h.date).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });';
    html += '    var seller = h.person ? h.person : "Флорист";';
    html += '    if (h.type === "sale") {';
    html += '      div.className = "item sale";';
    html += '      div.style.cursor = "pointer";';
    html += '      div.onclick = function() { window.location.href = "/warehouse/sale/details?id=" + h.id; };';
    html += '      div.innerHTML = "<div><b>💰 Продажа</b> (" + seller + ")";';
    html += '      div.innerHTML += "<div class=\'date\'>Время: " + ds + "</div>";';
    html += '      div.innerHTML += "<div class=\'items-list\'>" + (h.items || "") + "</div></div>";';
    html += '      var btn = "<button class=\'btn-cancel\' onclick=\'event.stopPropagation(); cancelSale(" + h.id + ")\'>Отменить</button>";';
    html += '      div.innerHTML += "<div><div class=\'amount\'>+" + h.amount.toLocaleString("ru-RU") + " ₽</div>" + btn + "</div>";';
    html += '    } else if (h.type === "receipt") {';
    html += '      div.className = "item receipt";';
    html += '      div.innerHTML = "<div><b>📥 Приход</b> (" + seller + ")";';
    html += '      div.innerHTML += "<div class=\'date\'>Время: " + ds + "</div>";';
    html += '      div.innerHTML += "<div class=\'items-list\'>" + (h.items || "") + "</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' style=\'color:#3498db;\'>+" + h.amount.toLocaleString("ru-RU") + " ₽</div>";';
    html += '    } else {';
    html += '      div.className = "item writeoff";';
    html += '      div.innerHTML = "<div><b>🗑 Списание</b> (" + seller + ")";';
    html += '      div.innerHTML += "<div class=\'date\'>Время: " + ds + "</div>";';
    html += '      div.innerHTML += "<div class=\'items-list\'>" + (h.items || "") + " (" + h.reason + ")</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' style=\'color:" + accentColor + "\'>-" + h.amount + " шт</div>";';
    html += '    }';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';
    
    html += 'function cancelSale(id) {';
    html += '  var ret = confirm("Вернуть товары на склад?\\n\\nОК = вернуть. Отмена = списать.");';
    html += '  fetch("/api/warehouse/sale/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: "kupidon", saleId: id, action: ret ? "return" : "writeoff" }) }).then(r => r.json()).then(d => { if (d.ok) { alert("Отменено"); location.reload(); } else alert("Ошибка"); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 24. API Отмены продажи
  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    try {
      const { shopId, saleId, action } = req.body;
      const itemsRes = await pool.query('SELECT shop_item_id, qty FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      for (let item of itemsRes.rows) {
        if (action === 'return') {
          await pool.query('UPDATE wh_shop_items SET current_stock = current_stock + $1 WHERE id = $2', [item.qty, item.shop_item_id]);
        } else {
          await pool.query('INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, date) VALUES ($1, $2, $3, $4, $5, NOW())', [shopId, item.shop_item_id, item.qty, 'loss', 'Отмена продажи']);
        }
      }
      await pool.query('DELETE FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      await pool.query('DELETE FROM wh_sales WHERE id = $1', [saleId]);
      await logAction(shopId, null, 'cancel', 'Отмена продажи ID: ' + saleId);
      await notifyOwner(bot, shopId, '⚠️ Отменена продажа ID: ' + saleId, 'cancel');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 25. API и Экран Деталей Продажи
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const saleId = req.query.id;
      const sale = await pool.query(
        `SELECT s.id, s.real_price, s.date, a.name as seller ` +
        `FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id ` +
        `WHERE s.id = $1`, [saleId]
      );
      const items = await pool.query(
        `SELECT si.qty, si.cost_at_sale, COALESCE(shi.custom_name, i.name) as name, shi.id as shop_item_id ` +
        `FROM wh_sale_items si ` +
        `JOIN wh_shop_items shi ON shi.id = si.shop_item_id ` +
        `JOIN wh_items i ON i.id = shi.item_id ` +
        `WHERE si.sale_id = $1`, [saleId]
      );
      res.json({ ok: true, sale: sale.rows[0], items: items.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.get('/warehouse/sale/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: 0; padding: 15px;';
    html += ' background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none;';
    html += ' color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 15px;';
    html += ' padding: 20px; margin-bottom: 15px; }';
    html += '.total { font-size: 28px; font-weight: bold; color: #27ae60; margin-bottom: 10px; }';
    html += '.meta { font-size: 14px; color: #666; margin-bottom: 20px; }';
    html += '.item-row { display: flex; justify-content: space-between;';
    html += ' padding: 15px 0; border-bottom: 1px solid #eee;';
    html += ' text-decoration: none; color: ' + brandColor + '; }';
    html += '.item-row:last-child { border-bottom: none; }';
    html += '.item-name { font-weight: bold; font-size: 16px; }';
    html += '.item-qty { color: #e74c3c; font-weight: bold; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse/history" class="back">←</a>';
    html += '<h1>🧾 Чек</h1></div>';
    html += '<div class="card" id="content">Загрузка...</div>';
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var saleId = urlParams.get("id");';
    html += 'fetch("/api/warehouse/sale/details?id=" + saleId)';
    html += '.then(r => r.json()).then(d => {';
    html += '  if (!d.ok) { document.getElementById("content").innerText = "Ошибка"; return; }';
    html += '  var s = d.sale;';
    html += '  var ds = new Date(s.date).toLocaleString("ru-RU");';
    html += '  var h = "<div class=\'total\'>" + s.real_price.toLocaleString("ru-RU") + " ₽</div>";';
    html += '  h += "<div class=\'meta\'>Продал: " + (s.seller || "Неизвестно") + "<br>Дата: " + ds + "</div>";';
    html += '  d.items.forEach(i => {';
    html += '    h += "<a href=\'/warehouse/item?id=" + i.shop_item_id + "\' class=\'item-row\'>";';
    html += '    h += "<div><div class=\'item-name\'>" + i.name + "</div>";';
    html += '    h += "<div style=\'font-size:12px;color:#888;\'>Себестоимость: " + i.cost_at_sale + " ₽/шт</div></div>";';
    html += '    h += "<div class=\'item-qty\'>x" + i.qty + "</div></a>";';
    html += '  });';
    html += '  document.getElementById("content").innerHTML = h;';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 26. API и Экран Истории Товара
  app.get('/api/warehouse/item/history', async (req, res) => {
    try {
      const itemId = req.query.id;
      const shopId = req.query.shop || 'kupidon';
      
      const itemInfo = await pool.query(
        'SELECT i.current_stock, COALESCE(i.custom_name, w.name) AS name ' +
        'FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.id = $1 AND i.shop_id = $2', [itemId, shopId]
      );

      const sales = await pool.query(
        `SELECT s.date, 'sale' as type, si.qty, a.name as person ` +
        `FROM wh_sale_items si JOIN wh_sales s ON s.id = si.sale_id ` +
        `LEFT JOIN admins a ON a.chat_id = s.chat_id ` +
        `WHERE si.shop_item_id = $1 AND s.shop_id = $2 ` +
        `ORDER BY s.date DESC LIMIT 20`, [itemId, shopId]
      );
      const receipts = await pool.query(
        `SELECT r.date, 'receipt' as type, ri.qty, 'Приход' as person ` +
        `FROM wh_receipt_items ri JOIN wh_receipts r ON r.id = ri.receipt_id ` +
        `WHERE ri.shop_item_id = $1 AND r.shop_id = $2 ` +
        `ORDER BY r.date DESC LIMIT 20`, [itemId, shopId]
      );
      let list = [...sales.rows, ...receipts.rows];
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      res.json({ ok: true, item: itemInfo.rows[0], history: list });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.get('/warehouse/item', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += 'body { font-family: sans-serif; margin: # 0; padding: 15px;';
    html27 += ' background: #fafaf8; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none;';
    html += ' color: ' + brandColor + '; margin-right: 15px; }';
    html += '.item { background: #fff; border-radius: 10px;';
    html += ' padding: 15px; margin-bottom: 10px;';
    html += ' display: flex; justify-content: space-between; align-items: center; }';
    html += '.item.sale { border-left: 4px solidae60; }';
    html += '.item.receipt { border-left: 4px solid #3498db; }';
    html += '.date { font-size: 11px; color: #888; }';
    html += '.amount { font-weight: bold; font-size: 16px; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse/inventory" class="back">←</a>';
    html += '<h1>📦 История товара</h1></div>';
    html += '<div id="header-info" style="text-align:center; margin-bottom:15px;"></div>';
    html += '<div id="list">Загрузка...</div>';
    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var itemId = urlParams.get("id");';
    html += 'fetch("/api/warehouse/item/history?id=" + itemId)';
    html += '.then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  var hi = document.getElementById("header-info");';
    html += '  if (d.ok && d.item) {';
    html += '    var col = parseFloat(d.item.current_stock) > 0 ? "#27ae60" : "#e74c3c";';
    html += '    hi.innerHTML = "<h2 style=\'margin:0;\'>" + d.item.name + "</h2>";';
    html += '    hi.innerHTML += "<div style=\'font-size:20px; font-weight:bold; color:" + col + "; margin-top:5px;\'>Остаток: " + d.item.current_stock + " шт</div>";';
    html += '  }';
    html += '  if (!d.ok || d.history.length === 0) { b.innerHTML = "Нет операций"; return; }';
    html += '  d.history.forEach(h => {';
    html += '    var div = document.createElement("div");';
    html += '    var ds = new Date(h.date).toLocaleString("ru-RU");';
    html += '    if (h.type === "sale") {';
    html += '      div.className = "item sale";';
var pName = h.person ? h.person : "Флорист";
      div.innerHTML = "<div><b>💰 Продажа</b> (" + pName + ")";
      div.innerHTML += "<div class='date'>" + ds + "</div></div>";
    html += '      div.innerHTML += "<div class=\'amount\'>-" + h.qty + " шт</div>";';
    html += '    } else {';
    html += '      div.className = "item receipt";';
    html += '      div.innerHTML = "<div><b>📥 Приход</b><div class=\'date\'>" + ds + "</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' style=\'color:#3498db;\'>+" + h.qty + " шт</div>";';
    html += '    }';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

}
module.exports = { setupWarehouse };