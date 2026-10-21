const pool = require('./db');

function setupWarehouse(app) {
  
  // 1. Главный экран склада (с ролями)
  app.get('/warehouse-app', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatIdStr = match ? match[1] : null;
      const chatId = chatIdStr ? Number(chatIdStr) : null;

      if (!chatId) return res.redirect('/warehouse-login?shop=kupidon');

      const r = await pool.query(
        `SELECT role, name, shop_id, can_receipt, ` +
        `can_sale, can_writeoff ` +
        `FROM admins WHERE chat_id = $1 LIMIT 1`, [chatId]
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

      let h = '<!DOCTYPE html><html><head>';
      h += '<meta charset="UTF-8">';
      h += '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      h += '<script src="https://telegram.org/js/telegram-web-app.js"></script>';
      h += '<style>';
      h += 'body { font-family: -apple-system, sans-serif; margin: 0; padding: 20px; background: #fafaf8; color: #2c3e50; text-align: center; }';
      h += '.header { background: #fff; padding: 20px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); margin-bottom: 20px; }';
      h += 'h1 { margin: 0; font-size: 24px; }';
      h += '.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }';
      h += '.btn { background: #fff; padding: 30px 10px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-decoration: none; color: #2c3e50; font-weight: bold; font-size: 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; }';
      h += '.btn span { font-size: 32px; margin-bottom: 10px; }';
      h += '.full { grid-column: 1 / -1; }';
      h += '</style></head><body>';
      h += '<div class="header">';
      h += '<h1>📦 Склад</h1>';
      h += '<p style="color:#888;margin:5px 0 0;">Вы вошли как: <b>' + userName + '</b> (' + (isOwner ? 'Владелец' : 'Флорист') + ')</p>';
      h += '</div>';
      h += '<div class="grid">';
      
      if (isOwner || canSale) h += '<a href="/warehouse/sale" class="btn"><span>💰</span>Продажа</a>';
      if (isOwner || canWriteoff) h += '<a href="/warehouse/writeoff" class="btn"><span>🗑</span>Списание</a>';
      if (isOwner || canReceipt) h += '<a href="/warehouse/receipt" class="btn"><span>📥</span>Приход</a>';
      if (isOwner) {
        h += '<a href="/warehouse/reports" class="btn"><span>📊</span>Отчёты</a>';
        h += '<a href="/warehouse/settings" class="btn full"><span>⚙️</span>Настройки и Флористы</a>';
      }
      h += '</div>';
      h += '<script>Telegram.WebApp.ready();</script>';
      h += '</body></html>';
      res.send(h);
    } catch (e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // 2. Страница входа (PIN)
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let h = '<!DOCTYPE html><html><head>';
    h += '<meta charset="UTF-8">';
    h += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    h += '<style>';
    h += 'body { font-family: sans-serif; text-align: center; padding: 50px 20px; background: #fafaf8; }';
    h += '.card { background: #fff; border-radius: 20px; padding: 30px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }';
    h += 'input { font-size: 24px; padding: 10px; width: 120px; text-align: center; border: 2px solid #ddd; border-radius: 10px; margin: 20px 0; }';
    h += 'button { background: #27ae60; color: white; border: none; padding: 15px 40px; font-size: 18px; border-radius: 30px; font-weight: bold; }';
    h += '</style></head><body>';
    h += '<div class="card"><h1>📦 Склад</h1><p>Введите PIN-код</p>';
    h += '<input type="password" id="pin" maxlength="4" inputmode="numeric" placeholder="****">';
    h += '<br><button onclick="login()">Войти</button></div>';
    h += '<script>';
    h += 'function login() {';
    h += '  var pin = document.getElementById("pin").value;';
    h += '  fetch("/api/warehouse/auth", {';
    h += '    method: "POST",';
    h += '    headers: { "Content-Type": "application/json" },';
    h += '    body: JSON.stringify({ shopId: "' + shopId + '", pin: pin })';
    h += '  }).then(function(r) { return r.json(); }).then(function(data) {';
    h += '    if (data.ok) window.location.href = "/warehouse-app";';
    h += '    else alert("Неверный PIN-код");';
    h += '  });';
    h += '}';
    h += '</script></body></html>';
    res.send(h);
  });

  // 3. API Авторизации
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const { shopId, pin } = req.body;
      const r = await pool.query(
        `SELECT chat_id, role FROM admins ` +
        `WHERE shop_id = $1 AND warehouse_pin = $2`,
        [shopId, pin]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      const user = r.rows[0];
      res.setHeader('Set-Cookie', 'wh_auth=' + user.chat_id + '; Path=/; Max-Age=2592000; HttpOnly');
      res.json({ ok: true, role: user.role });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

}
// 4. API: Получить список товаров
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        `SELECT i.id, i.current_stock, ` +
        `COALESCE(i.custom_name, w.name) AS name, ` +
        `w.photo_url ` +
        `FROM wh_shop_items i ` +
        `JOIN wh_items w ON w.id = i.item_id ` +
        `WHERE i.shop_id = $1 AND i.current_stock > 0`,
        [shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 5. API: Сохранить продажу (с поддержкой дробей)
  app.post('/api/warehouse/sale', async (req, res) => {
    try {
      const { shopId, real_price, items } = req.body;
      const saleRes = await pool.query(
        `INSERT INTO wh_sales (shop_id, real_price) ` +
        `VALUES ($1, $2) RETURNING id`, [shopId, real_price]
      );
      const saleId = saleRes.rows[0].id;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        await pool.query(
          `UPDATE wh_shop_items SET current_stock = ` +
          `current_stock - $1 WHERE id = $2`,
          [item.qty, item.id]
        );
        const costQ = await pool.query(
          `SELECT avg_cost FROM wh_shop_items WHERE id = $1`, [item.id]
        );
        let realCost = costQ.rows[0].avg_cost || 0;
        await pool.query(
          `INSERT INTO wh_sale_items ` +
          `(sale_id, shop_item_id, qty, cost_at_sale) ` +
          `VALUES ($1, $2, $3, $4)`,
          [saleId, item.id, item.qty, realCost]
        );
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 6. Экран Продажи (Корзина наверху, адаптивные плитки)
  app.get('/warehouse/sale', async (req, res) => {
    let h = '<!DOCTYPE html><html><head>';
    h += '<meta charset="UTF-8">';
    h += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    h += '<style>';
    h += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; }';
    h += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    h += '.back { font-size: 24px; text-decoration: none; color: #2c3e50; margin-right: 15px; }';
    h += 'h1 { margin: 0; font-size: 22px; }';
    h += '.search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; font-size: 16px; margin-bottom: 15px; box-sizing: border-box; }';
    
    // Пожелание 2: Адаптивные мелкие плитки
    h += '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 20px; }';
    h += '.card { background: #fff; padding: 8px; border-radius: 10px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); cursor: pointer; }';
    h += '.card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }';
    h += '.card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }';
    h += '.card .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }';
    h += '.card .stock { font-size: 11px; color: #27ae60; }';
    
    h += '.basket { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; border: 2px solid #27ae60; display: none; }';
    h += '.b-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; }';
    h += '.btn-save { width: 100%; padding: 15px; background: #27ae60; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; margin-top: 10px; }';
    h += '</style></head><body>';

    h += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>💰 Продажа</h1></div>';
    
    // Пожелание 1: Корзина наверху
    h += '<div class="basket" id="basket">';
    h += '<h3 style="margin-top:0; font-size:16px;">Выбрано:</h3>';
    h += '<div id="bList"></div>';
    h += '<label style="font-size:12px; color:#666;">Сумма продажи</label>';
    h += '<input type="number" id="totalPrice" step="0.01" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-top:5px; box-sizing:border-box; font-size:16px;" placeholder="0">';
    h += '<button class="btn-save" onclick="saveSale()">Продать</button>';
    h += '</div>';

    h += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    h += '<div class="grid" id="itemsGrid"></div>';

    h += '<script>';
    h += 'var allItems = [];';
    h += 'var cart = [];';
    
    h += 'fetch("/api/warehouse/items?shop=kupidon")';
    h += '.then(function(r) { return r.json(); })';
    h += '.then(function(d) { allItems = d.items; render(allItems); });';

    h += 'function render(items) {';
    h += '  var g = document.getElementById("itemsGrid");';
    h += '  g.innerHTML = "";';
    h += '  items.forEach(function(item) {';
    h += '    var div = document.createElement("div");';
    h += '    div.className = "card";';
    h += '    var img = item.photo_url ? "<img src=\'" + item.photo_url + "\'>" : "<div class=\'ph\'>📷</div>";';
    h += '    div.innerHTML = img + "<div class=\'name\'>" + item.name + "</div><div class=\'stock\'>Ост: " + item.current_stock + "</div>";';
    h += '    div.onclick = function() { addToCart(item); };';
    h += '    g.appendChild(div);';
    h += '  });';
    h += '}';

    h += 'function filterItems() {';
    h += '  var q = document.getElementById("search").value.toLowerCase();';
    h += '  var f = allItems.filter(function(i) { return i.name.toLowerCase().indexOf(q) !== -1; });';
    h += '  render(f);';
    h += '}';

    h += 'function addToCart(item) {';
    h += '  var ex = cart.find(function(c) { return c.id === item.id; });';
    h += '  if (ex) ex.qty += 1;';
    h += '  else cart.push({ id: item.id, name: item.name, qty: 1 });';
    h += '  renderBasket();';
    h += '}';

    h += 'function renderBasket() {';
    h += '  var b = document.getElementById("basket");';
    h += '  var list = document.getElementById("bList");';
    h += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    h += '  b.style.display = "block";';
    h += '  list.innerHTML = "";';
    h += '  cart.forEach(function(item, idx) {';
    h += '    var div = document.createElement("div");';
    h += '    div.className = "b-row";';
    h += '    var nm = "<span style=\'font-size:14px;\'>" + item.name + "</span>";';
    // Пожелание 5: Дробные количества (шаг 0.1)
    h += '    var inp = "<input type=\'number\' step=\'0.1\' value=\'" + item.qty + "\' onchange=\'upQty(" + idx + ", this.value)\' style=\'width:60px; text-align:center; border:1px solid #ddd; border-radius:5px;\'>";';
    h += '    var btn = "<button onclick=\'cart.splice(" + idx + ", 1); renderBasket();\' style=\'border:none; background:none; color:red; font-size:20px;\'>✕</button>";';
    h += '    div.innerHTML = nm + inp + btn;';
    h += '    list.appendChild(div);';
    h += '  });';
    h += '}';

    h += 'function upQty(idx, val) {';
    h += '  var v = parseFloat(val);';
    h += '  if (isNaN(v) || v <= 0) v = 1;';
    h += '  cart[idx].qty = v;';
    h += '}';

    h += 'function saveSale() {';
    h += '  var total = document.getElementById("totalPrice").value;';
    h += '  if (!total) { alert("Введите сумму"); return; }';
    h += '  fetch("/api/warehouse/sale", {';
    h += '    method: "POST",';
    h += '    headers: { "Content-Type": "application/json" },';
    h += '    body: JSON.stringify({ shopId: "kupidon", real_price: total, items: cart })';
    h += '  }).then(function(r) { return r.json(); }).then(function(d) {';
    h += '    if (d.ok) { alert("Продано!"); window.location.href="/warehouse-app"; }';
    h += '    else { alert("Ошибка"); }';
    h += '  });';
    h += '}';
    h += '</script></body></html>';
    res.send(h);
  });

  // 7. Экран Прихода
  app.get('/warehouse/receipt', async (req, res) => {
    let h = '<!DOCTYPE html><html><head>';
    h += '<meta charset="UTF-8">';
    h += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    h += '<style>';
    h += 'body { font-family: sans-serif; margin: 0; padding: 20px; background: #fafaf8; }';
    h += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    h += '.back { font-size: 24px; text-decoration: none; color: #2c3e50; margin-right: 15px; }';
    h += 'h1 { margin: 0; font-size: 22px; }';
    h += '.card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; }';
    h += 'label { display: block; font-size: 12px; color: #888; margin-bottom: 5px; }';
    h += 'input[type="text"], input[type="number"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; margin-bottom: 15px; box-sizing: border-box; }';
    h += '.btn-save { width: 100%; background: #27ae60; color: #fff; border: none; padding: 15px; border-radius: 10px; font-size: 18px; font-weight: bold; }';
    h += '</style></head><body>';

    h += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📥 Приход</h1></div>';
    h += '<div class="card">';
    h += '<label>Название</label><input type="text" id="itemName" placeholder="Роза">';
    h += '<label>Количество (можно 0.5)</label><input type="number" id="itemQty" step="0.1" placeholder="0">';
    h += '<label>Цена закупки</label><input type="number" id="itemPrice" placeholder="0">';
    h += '<label>Фото (необязательно)</label><input type="file" id="itemPhoto" accept="image/*">';
    h += '</div>';
    h += '<button class="btn-save" onclick="saveReceipt()">Добавить</button>';

    h += '<script>';
    h += 'function saveReceipt() {';
    h += '  var name = document.getElementById("itemName").value;';
    h += '  var qty = document.getElementById("itemQty"). 'value;';
    h +=  '  var price = document })..getElementById("itemPrice").value;';
    h += ' then if (!name || !qty || !price) {(function alert("Заполните поля"); return; }';
   (r h += '  var file = document.getElementById("itemPhoto").files[0];';
    h += '  if (file) {';
    h += '    var reader = new FileReader();';
    h += '    reader.onload = function(e) { upload(e.target.result, name, qty, price); };';
    h += '    reader.readAsDataURL(file);';
    h += '  } else { submit(name, qty, price, null, null); }';
    h += '}';

    h += 'function upload(base64, name, qty, price) {';
    h += '  fetch("/api/warehouse/upload", {';
    h += '    method: "POST",';
    h += '    headers: { "Content-Type": "application/json" },';
    h += '    body: JSON.stringify({ image: base64 })';
    h +=) { return r.json(); }).then(function(d) {';
    h += '    submit(name, qty, price, d.url, d.urlBackup);';
    h += '  }).catch(function() { submit(name, qty, price, null, null); });';
    h += '}';

    h += 'function submit(name, qty, price, url, url2) {';
    h += '  fetch("/api/warehouse/receipt", {';
    h += '    method: "POST",';
    h += '    headers: { "Content-Type": "application/json" },';
    h += '    body: JSON.stringify({ shopId: "kupidon", name: name, qty: qty, price: price, photo: url, photoBackup: url2 })';
    h += '  }).then(function(r) { return r.json(); }).then(function(d) {';
    h += '    if (d.ok) { alert("Добавлено!"); window.location.href="/warehouse-app"; }';
    h += '    else { alert("Ошибка"); }';
    h += '  });';
    h += '}';
    h += '</script></body></html>';
    res.send(h);
  });// 8. API: Списание (с фото)
  app.post('/api/warehouse/writeoff', async (req, res) => {
    try {
      const { shopId, items, reason, comment, photo } = req.body;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        await pool.query(
          `UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2`,
          [item.qty, item.id]
        );
        await pool.query(
          `INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, photo_url) ` +
          `VALUES ($1, $2, $3, $4, $5, $6)`,
          [shopId, item.id, item.qty, reason, comment, photo]
        );
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 9. Экран Списания
  app.get('/warehouse/writeoff', async (req, res) => {
    let h = '<!DOCTYPE html><html><head>';
    h += '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">';
    h += '<style>';
    h += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; }';
    h += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    h += '.back { font-size: 24px; text-decoration: none; color: #2c3e50; margin-right: 15px; }';
    h += 'h1 { margin: 0; font-size: 22px; }';
    h += '.search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }';
    h += '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 15px; }';
    h += '.card { background: #fff; padding: 10px; border-radius: 10px; text-align: center; cursor: pointer; }';
    h += '.reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }';
    h += '.reason { padding: 12px; border-radius: 10px; border: 2px solid #eee; background: #fff; text-align: center; }';
    h += '.reason.active { border-color: #e74c3c; color: #e74c3c; }';
    h += '.btn-save { width: 100%; padding: 15px; background: #e74c3c; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; }';
    h += '</style></head><body>';

    h += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>🗑 Списание</h1></div>';
    h += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    h += '<div class="grid" id="itemsGrid"></div>';

    h += '<div id="form" style="display:none;">';
    h += '<h3>Причина</h3><div class="reasons">';
    h += '<div class="reason active" onclick="setR(this,\'spoilage\')">Порча</div>';
    h += '<div class="reason" onclick="setR(this,\'loss\')">Потеря</div>';
    h += '<div class="reason" onclick="setR(this,\'markdown\')">Уценка</div>';
    h += '<div class="reason" onclick="setR(this,\'sorting\')">Пересорт</div>';
    h += '</div>';
    h += '<label>Комментарий</label><textarea id="comment" style="width:100%; padding:10px; border-radius:10px; border:1px solid #ddd; margin-bottom:10px;"></textarea>';
    h += '<label>Фото (необязательно)</label><input type="file" id="wPhoto" accept="image/*" style="margin-bottom:15px;">';
    h += '<button class="btn-save" onclick="saveWriteoff()">Списать</button></div>';

    h += '<script>';
    h += 'var allItems = []; var selItem = null; var selReason = "spoilage";';
    h += 'fetch("/api/warehouse/items?shop=kupidon").then(function(r) { return r.json(); }).then(function(d) { allItems = d.items; render(); });';
    h += 'function render() { var g = document.getElementById("itemsGrid"); g.innerHTML = ""; allItems.forEach(function(i) { var d = document.createElement("div"); d.className = "card"; d.innerHTML = "<b>" + i.name + "</b><br>Ост: " + i.current_stock; d.onclick = function() { selectItem(i); }; g.appendChild(d); }); }';
    h += 'function filterItems() { var q = document.getElementById("search").value.toLowerCase(); var f = allItems.filter(function(i) { return i.name.toLowerCase().indexOf(q) !== -1; }); var g = document.getElementById("itemsGrid"); g.innerHTML = ""; f.forEach(function(i) { var d = document.createElement("div"); d.className = "card"; d.innerHTML = "<b>" + i.name + "</b><br>Ост: " + i.current_stock; d.onclick = function() { selectItem(i); }; g.appendChild(d); }); }';
    h += 'function selectItem(item) { var q = prompt("Сколько списать?", "1"); if (q && parseFloat(q) > 0) { selItem = { id: item.id, qty: parseFloat(q) }; document.getElementById("form").style.display = "block"; } }';
    h += 'function setR(el, r) { var list = document.querySelectorAll(".reason"); for (var i = 0; i < list.length; i++) { list[i].classList.remove("active"); } el.classList.add("active"); selReason = r; }';
    h += 'function saveWriteoff() {';
    h += '  if (!selItem) return; var c = document.getElementById("comment").value;';
    h += '  var f = document.getElementById("wPhoto").files[0];';
    h += '  if (f) { var rd = new FileReader(); rd.onload = function(e) { upload(e.target.result, c); }; rd.readAsDataURL(f); }';
    h += '  else { submit(null, c); }';
    h += '}';
    h += 'function upload(base64, c) { fetch("/api/warehouse/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }) }).then(function(r) { return r.json(); }).then(function(d) { submit(d.url, c); }).catch(function() { submit(null, c); }); }';
    h += 'function submit(url, c) { fetch("/api/warehouse/writeoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: "kupidon", items: [selItem], reason: selReason, comment: c, photo: url }) }).then(function(r) { return r.json(); }).then(function(d) { if (d.ok) { alert("Списано!"); window.location.href="/warehouse-app"; } }); }';
    h += '</script></body></html>';
    res.send(h);
  });

  // 10. Отчёты (API и Экран)
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const rev = await pool.query(`SELECT COALESCE(SUM(real_price), 0) AS total FROM wh_sales WHERE shop_id = $1`, [shopId]);
      const loss = await pool.query(`SELECT COALESCE(SUM(wh_writeoffs.qty * wh_shop_items.avg_cost), 0) AS total FROM wh_writeoffs JOIN wh_shop_items ON wh_shop_items.id = wh_writeoffs.shop_item_id WHERE wh_writeoffs.shop_id = $1`, [shopId]);
      const cost = await pool.query(`SELECT COALESCE(SUM(wh_sale_items.qty * wh_sale_items.cost_at_sale), 0) AS total FROM wh_sale_items JOIN wh_sales ON wh_sales.id = wh_sale_items.sale_id WHERE wh_sales.shop_id = $1`, [shopId]);
      
      const revenue = parseInt(rev.rows[0].total) || 0;
      const losses = parseInt(loss.rows[0].total) || 0;
      const costVal = parseInt(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      const lossPercent = (revenue + losses) > 0 ? Math.round((losses / (revenue + losses)) * 100) : 0;
      res.json({ ok: true, revenue, profit, losses, lossPercent });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.get('/warehouse/reports', async (req, res) => {
    let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    h += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; }';
    h += '.header { display: flex; align-items: center; margin-bottom: 15px; }';
    h += '.back { font-size: 24px; text-decoration: none; color: #2c3e50; margin-right: 15px; }';
    h += '.card { background: #fff; border-radius: 15px; padding: 20px; margin-bottom: 15px; text-align: center; }';
    h += '.val { font-size: 28px; font-weight: bold; margin: 5px 0; } .blue { color: #2980b9; } .green { color: #27ae60; } .red { color: #e74c3c; }';
    h += '</style></head><body>';
    h += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>📊 Отчёты</h1></div>';
    h += '<div id="load" style="text-align:center;">Загрузка...</div>';
    h += '<div id="cont" style="display:none;">';
    h += '<div class="card"><div>Выручка</div><div class="val blue" id="rev">0</div></div>';
    h += '<div class="card"><div>Прибыль</div><div class="val green" id="prof">0</div></div>';
    h += '<div class="card" style="border: 2px solid #e74c3c;"><div>Потери</div><div class="val red" id="loss">0</div><div id="pct"></div></div>';
    h += '</div>';
    h += '<script>fetch("/api/warehouse/reports?shop=kupidon").then(r=>r.json()).then(d=>{ if(d.ok){ document.getElementById("load").style.display="none"; document.getElementById("cont").style.display="block"; document.getElementById("rev").innerText=d.revenue.toLocaleString("ru-RU")+" ₽"; document.getElementById("prof").innerText=d.profit.toLocaleString("ru-RU")+" ₽"; document.getElementById("loss").innerText=d.losses.toLocaleString("ru-RU")+" ₽"; document.getElementById("pct").innerText=d.lossPercent+"% от закупок"; } });</script>';
    h += '</body></html>';
    res.send(h);
  });

  // 11. Настройки Флористов
  app.get('/warehouse/settings', async (req, res) => {
    let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>';
    h += 'body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; } .header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: #2c3e50; margin-right: 15px; }';
    h += '.card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; } .row { display: flex; justify-content: space-between; margin-top: 10px; }';
    h += '</style></head><body>';
    h += '<div class="header"><a href="/warehouse-app" class="back">←</a><h1>⚙️ Флористы</h1></div><div id="list"></div>';
    h += '<script>fetch("/api/warehouse/florists?shop=kupidon").then(r=>r.json()).then(d=>{ var b=document.getElementById("list"); if(!d.ok||d.florists.length===0){b.innerHTML="Нет флористов";return;} d.florists.forEach(f=>{ var c=document.createElement("div"); c.className="card"; c.innerHTML="<b>"+(f.name||"Флорист")+"</b><br>PIN: "+(f.warehouse_pin||"не задан")+"<br><button onclick=\'setPin("+f.chat_id+")\' style=\'margin-top:10px;padding:8px;border-radius:8px;border:none;background:#3498db;color:#fff;\'>Задать PIN</button><div class=\'row\'><span>Приход</span><input type=\'checkbox\' "+ (f.can_receipt?"checked":"") +" onchange=\'setR("+f.chat_id+",\"receipt\",this.checked)\'></div><div class=\'row\'><span>Продажа</span><input type=\'checkbox\' "+ (f.can_sale?"checked":"") +" onchange=\'setR("+f.chat_id+",\"sale\",this.checked)\'></div><div class=\'row\'><span>Списание</span><input type=\'checkbox\' "+ (f.can_writeoff?"checked":"") +" onchange=\'setR("+f.chat_id+",\"writeoff\",this.checked)\'></div>"; b.appendChild(c); }); });';
    h += 'function setPin(id){var p=prompt("Введите 4 цифры:"); if(p&&p.length===4){ fetch("/api/warehouse/florist/pin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shop:"kupidon",chatId:id,pin:p})}).then(()=>location.reload()); }}';
    h += 'function setR(id,f,v){ fetch("/api/warehouse/florist/rights",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shop:"kupidon",chatId:id,field:f,val:v})}); }';
    h += '</script></body></html>';
    res.send(h);
  });

  app.get('/api/warehouse/florists', async (req, res) => {
    try { const r = await pool.query(`SELECT chat_id, name, warehouse_pin, can_receipt, can_sale, can_writeoff FROM admins WHERE shop_id = $1 AND role = 'florist'`, [req.query.shop || 'kupidon']); res.json({ ok: true, florists: r.rows }); } catch(e) { res.status(500).json({ ok: false }); }
  });
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try { await pool.query(`UPDATE admins SET warehouse_pin = $1 WHERE shop_id = $2 AND chat_id = $3`, [req.body.pin, req.body.shop, req.body.chatId]); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false }); }
  });
  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try { const col = req.body.field === 'sale' ? 'can_sale' : req.body.field === 'writeoff' ? 'can_writeoff' : 'can_receipt'; await pool.query(`UPDATE admins SET ` + col + ` = $1 WHERE shop_id = $2 AND chat_id = $3`, [req.body.val, req.body.shop, req.body.chatId]); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false }); }
  });

module.exports = { setupWarehouse };