const pool = require('./db');
const {
  esc, fmtNum, getUnifiedMenu,
  metaSafari, fontLink, uiScript,
  translateReason
} = require('./warehouse-views-core');

function setupWarehouseViewsInventory(app, bot, s3ctx, getAuth) {
  // ====== 3. ОБЗОР СКЛАДА ======
  app.get('/warehouse/inventory', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const shopId = auth.shopId;

      const statsRes = await pool.query(
        'SELECT COALESCE(SUM(current_stock), 0) as stems, ' +
        'COALESCE(SUM(current_stock * avg_cost), 0) as cost, ' +
        'COALESCE(SUM(current_stock * retail_price), 0) as retail ' +
        'FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND current_stock > 0 AND (hidden = FALSE OR hidden IS NULL)',
        [shopId]
      );
      const stats = statsRes.rows[0];

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.stats-bar { display: flex; gap: 12px; margin-bottom: 16px; }';
      html += '.stat-box { flex: 1; background: #fff; padding: 12px; ';
      html += 'border-radius: var(--r-md); text-align: center; ';
      html += 'box-shadow: var(--sh-1); }';
      html += '.stat-val { font-size: 18px; font-weight: 800; }';
      html += '.stat-lbl { font-size: 12px; color: var(--f-text-2); ';
      html += 'font-weight: 600; margin-top: 4px; }';

      html += '.search-wrap { position: relative; margin-bottom: 16px; }';
      html += '.search { width: 100%; padding: 14px 16px; border: none; ';
      html += 'border-radius: var(--r-md); box-sizing: border-box; ';
      html += 'font-family: inherit; font-size: 16px; ';
      html += 'box-shadow: var(--sh-1); }';
      
      html += '.controls { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 16px; gap: 8px; }';
      html += '.view-toggles { display: flex; gap: 4px; ';
      html += 'background: #e0e0e0; padding: 4px; border-radius: 10px; }';
      html += '.view-btn { border: none; background: none; padding: 8px; ';
      html += 'border-radius: 8px; cursor: pointer; color: #666; ';
      html += 'display: flex; }';
      html += '.view-btn.active { background: #fff; ';
      html += 'box-shadow: var(--sh-1); color: var(--f-brand); }';
      html += '.view-btn svg { width: 20px; height: 20px; }';
      
      html += '.limit-select { padding: 8px 12px; border-radius: 10px; ';
      html += 'border: none; font-family: inherit; font-weight: 600; ';
      html += 'color: var(--f-brand); background: #fff; ';
      html += 'box-shadow: var(--sh-1); width: 80px; text-align: center; ';
      html += 'margin: 0; }';

      html += '.h-scroll { display: flex; overflow-x: auto; ';
      html += 'gap: 8px; margin-bottom: 16px; padding-bottom: 4px; }';
      html += '.h-scroll::-webkit-scrollbar { display: none; }';
      
      html += '.cat-btn { padding: 8px 16px; border: none; ';
      html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
      html += 'font-size: 14px; white-space: nowrap; ';
      html += 'font-family: inherit; color: var(--f-text); ';
      html += 'font-weight: 600; box-shadow: var(--sh-1); }';
      html += '.cat-btn.active { background: var(--f-brand); color: #fff; }';
      
      html += '.spec-btn { padding: 6px 12px; border: none; ';
      html += 'border-radius: 12px; background: #fff; cursor: pointer; ';
      html += 'font-size: 13px; font-weight: 600; font-family: inherit; ';
      html += 'box-shadow: var(--sh-1); color: var(--f-text); }';
      html += '.spec-btn.active { background: var(--f-brand); color: #fff; }';
      
      html += '.grid-tiles { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 12px; }';
      html += '.card-tile { background: #fff; padding: 12px; ';
      html += 'border-radius: var(--r-lg); text-align: center; ';
      html += 'text-decoration: none; color: var(--f-text); ';
      html += 'position: relative; box-shadow: var(--sh-1); }';
      html += '.card-tile img { width: 100%; height: 100px; ';
      html += 'object-fit: cover; border-radius: var(--r-md); ';
      html += 'margin-bottom: 8px; }';
      html += '.card-tile .ph { height: 100px; border-radius: var(--r-md); ';
      html += 'background: #F0F4F4; display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 8px; }';
      
      html += '.grid-rows { display: flex; flex-direction: column; gap: 8px; }';
      html += '.card-row { background: #fff; padding: 12px 16px; ';
      html += 'border-radius: var(--r-md); display: flex; align-items: center; ';
      html += 'justify-content: space-between; text-decoration: none; ';
      html += 'color: var(--f-text); box-shadow: var(--sh-1); }';
      html += '.card-row .row-left { display: flex; align-items: center; ';
      html += 'gap: 12px; }';
      html += '.card-row img, .card-row .ph { width: 48px; height: 48px; ';
      html += 'border-radius: var(--r-sm); object-fit: cover; }';
      html += '.card-row .ph { background: #F0F4F4; display: flex; ';
      html += 'align-items: center; justify-content: center; }';
      
      html += '.name { font-size: 14px; font-weight: 600; margin-bottom: 4px; ';
      html += 'line-height: 1.2; word-break: break-word; }';
      html += '.card-row .name { font-size: 15px; margin-bottom: 0; }';
      html += '.stock { font-size: 13px; font-weight: 800; }';
      html += '.green { color: var(--f-success); } ';
      html += '.red { color: var(--f-danger); }';
      html += '.pin-icon { position: absolute; top: 8px; right: 8px; ';
      html += 'color: #E67E22; font-size: 18px; line-height: 1; }';
      html += '.card-row .pin-icon { position: static; margin-left: 6px; }';
      html += '.price-warn { font-size: 11px; color: var(--f-accent); ';
      html += 'font-weight: 800; margin-top: 4px; }';
      html += '.cost-info { font-size: 11px; color: var(--f-text-2); ';
      html += 'margin-top: 4px; font-weight: 600; }';
      
      html += '.archived-item { opacity: 0.6; }';
      html += '.archived-badge { font-size: 10px; color: #666; ';
      html += 'background: #eee; padding: 2px 6px; border-radius: 4px; ';
      html += 'display: inline-block; margin-top: 4px; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Обзор склада</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="stats-bar">';
      html += '<div class="stat-box"><div class="stat-val">';
      html += fmtNum(stats.stems);
      html += '</div><div class="stat-lbl">Стебли</div></div>';
      html += '<div class="stat-box"><div class="stat-val">';
      html += Math.round(stats.cost).toLocaleString('ru-RU') + ' ₽';
      html += '</div><div class="stat-lbl">Закупка</div></div>';
      html += '<div class="stat-box"><div class="stat-val">';
      html += Math.round(stats.retail).toLocaleString('ru-RU') + ' ₽';
      html += '</div><div class="stat-lbl">Розница</div></div>';
      html += '</div>';

      html += '<div class="search-wrap">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск по названию..." onkeyup="applyFilters()">';
      html += '</div>';
      
      html += '<div class="controls">';
      html += '  <div style="display:flex; gap:6px; flex-wrap:wrap;">';
      html += '    <button class="spec-btn" id="cat-noprice" ';
      html += 'onclick="toggleNoPrice()">Без цены</button>';
      html += '    <button class="spec-btn" id="cat-minus" ';
      html += 'onclick="toggleMinus()">Минус</button>';
      html += '    <button class="spec-btn" id="cat-archive" ';
      html += 'onclick="toggleArchive()">Архив</button>';
      html += '  </div>';
      html += '  <div style="display:flex; gap:8px; align-items:center;">';
      html += '    <div class="view-toggles">';
      html += '      <button class="view-btn active" id="btn-view-tile" ';
      html += 'onclick="setViewMode(&apos;tile&apos;)">';
      html += '<svg viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="2">';
      html += '<rect x="3" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="14" width="7" height="7"/>';
      html += '<rect x="3" y="14" width="7" height="7"/></svg></button>';
      html += '      <button class="view-btn" id="btn-view-row" ';
      html += 'onclick="setViewMode(&apos;row&apos;)">';
      html += '<svg viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="2">';
      html += '<line x1="8" y1="6" x2="21" y2="6"/>';
      html += '<line x1="8" y1="12" x2="21" y2="12"/>';
      html += '<line x1="8" y1="18" x2="21" y2="18"/>';
      html += '<line x1="3" y1="6" x2="3.01" y2="6"/>';
      html += '<line x1="3" y1="12" x2="3.01" y2="12"/>';
      html += '<line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>';
      html += '    </div>';
      html += '    <select class="limit-select" id="limitSelect" ';
      html += 'onchange="setLimit(this.value)">';
      html += '      <option value="10">10 шт</option>';
      html += '      <option value="30">30 шт</option>';
      html += '      <option value="50">50 шт</option>';
      html += '      <option value="100">100 шт</option>';
      html += '    </select>';
      html += '  </div>';
      html += '</div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button></div>';
      
      html += '<div id="itemsContainer"></div>';
      html += '<div id="pagination" style="display:flex; ';
      html += 'justify-content:center; gap:10px; margin-top:20px;"></div>';

      html += getUnifiedMenu('inventory');

      html += '<script>';
      html += 'var allItems = []; var currentCat = 0;';
      html += 'var currentPage = 1; var pageLimit = 10; ';
      html += 'var viewMode = "tile"; ';
      html += 'var noPriceFilter = false; var minusFilter = false; ';
      html += 'var showArchive = false;';

      html += 'var svgPh = "<div style=width:100%;height:100px;';
      html += 'background:#F0F4F4;border-radius:8px;></div>";';
      html += 'var svgPhRow = "<div style=width:48px;height:48px;';
      html += 'background:#F0F4F4;border-radius:8px;></div>";';

      html += 'if (localStorage.getItem("wh_view_mode")) ';
      html += 'viewMode = localStorage.getItem("wh_view_mode");';
      html += 'if (localStorage.getItem("wh_page_limit")) ';
      html += 'pageLimit = parseInt(localStorage.getItem("wh_page_limit"));';
      html += 'document.getElementById("limitSelect").value = pageLimit;';
      html += 'updateViewButtons();';

      html += 'function setViewMode(mode) {';
      html += '  viewMode = mode; ';
      html += 'localStorage.setItem("wh_view_mode", mode); ';
      html += 'updateViewButtons(); render(); }';
      
      html += 'function updateViewButtons() {';
      html += '  document.getElementById("btn-view-tile")';
      html += '.classList.remove("active");';
      html += '  document.getElementById("btn-view-row")';
      html += '.classList.remove("active");';
      html += '  document.getElementById("btn-view-" + ';
      html += '(viewMode === "tile" ? "tile" : "row"))';
      html += '.classList.add("active");';
      html += '}';
      
      html += 'function setLimit(val) { ';
      html += 'pageLimit = parseInt(val); ';
      html += 'localStorage.setItem("wh_page_limit", pageLimit); ';
      html += 'currentPage = 1; render(); }';

      html += 'function toggleNoPrice() {';
      html += '  noPriceFilter = !noPriceFilter; minusFilter = false; ';
      html += 'showArchive = false;';
      html += '  updateFilterUI(); currentPage = 1; applyFilters();';
      html += '}';
      
      html += 'function toggleMinus() {';
      html += '  minusFilter = !minusFilter; noPriceFilter = false; ';
      html += 'showArchive = false;';
      html += '  updateFilterUI(); currentPage = 1; applyFilters();';
      html += '}';
      
      html += 'function toggleArchive() {';
      html += '  showArchive = !showArchive; noPriceFilter = false; ';
      html += 'minusFilter = false;';
      html += '  updateFilterUI(); fetchItems();';
      html += '}';

      html += 'function updateFilterUI() {';
      html += '  var npBtn = document.getElementById("cat-noprice");';
      html += '  var mBtn = document.getElementById("cat-minus");';
      html += '  var aBtn = document.getElementById("cat-archive");';
      html += '  if (noPriceFilter) { npBtn.classList.add("active"); } ';
      html += '  else { npBtn.classList.remove("active"); }';
      html += '  if (minusFilter) { mBtn.classList.add("active"); } ';
      html += '  else { mBtn.classList.remove("active"); }';
      html += '  if (showArchive) { aBtn.classList.add("active"); } ';
      html += '  else { aBtn.classList.remove("active"); }';
      
      html += '  if (noPriceFilter || minusFilter || showArchive) {';
      html += '    document.querySelectorAll(".cat-btn").forEach(';
      html += '    function(b){ if(b.id !== "cat-noprice" && ';
      html += '    b.id !== "cat-minus" && b.id !== "cat-archive") ';
      html += '    b.classList.remove("active"); });';
      html += '  } else {';
      html += '    document.getElementById("cat-" + currentCat)';
      html += '    .classList.add("active");';
      html += '  }';
      html += '}';

      html += 'fetch("/api/warehouse/categories")';
      html += '.then(function(r){return r.json();}).then(function(d){';
      html += '  if (d.ok) { ';
      html += '  var cl = document.getElementById("catList"); ';
      html += '  d.categories.forEach(function(c){ ';
      html += '    var b = document.createElement("button"); ';
      html += '    b.className = "cat-btn"; b.id = "cat-" + c.id; ';
      html += '    b.innerText = c.name; ';
      html += '    b.onclick = function(){setCat(c.id);}; ';
      html += '    cl.appendChild(b); }); }';
      html += '}).catch(function(){});';

      html += 'function fetchItems() {';
      html += '  var url = "/api/warehouse/items?t=" + Date.now();';
      html += '  if (showArchive) url += "&show_archive=true";';
      html += '  fetch(url)';
      html += '  .then(function(r){return r.json();}).then(function(d){';
      html += '    if (d.ok) { allItems = d.items; applyFilters(); } ';
      html += '    else { ';
      html += '      var g = document.getElementById("itemsContainer"); ';
      html += '      g.textContent = "Ошибка API"; ';
      html += '    }';
      html += '  }).catch(function(err){ ';
      html += '    var g = document.getElementById("itemsContainer"); ';
      html += '    g.textContent = "Ошибка сети"; ';
      html += '  });';
      html += '}';
      html += 'fetchItems();';

      html += 'function setCat(id) { ';
      html += 'noPriceFilter = false; minusFilter = false; showArchive = false;';
      html += 'updateFilterUI();';
      html += 'currentCat = id; currentPage = 1; ';
      html += 'var els = document.querySelectorAll(".cat-btn"); ';
      html += 'els.forEach(function(el){el.classList.remove("active");}); ';
      html += 'document.getElementById("cat-" + id).classList.add("active"); ';
      html += 'applyFilters(); }';

      html += 'function applyFilters() {';
      html += '  var q = document.getElementById("search")';
      html += '  .value.toLowerCase();';
      html += '  var filtered = allItems.filter(function(i){';
      html += '    var matchQ = i.name.toLowerCase().includes(q);';
      html += '    var matchC = (currentCat === 0 || ';
      html += '    i.category_id === currentCat);';
      html += '    var matchP = !noPriceFilter || ';
      html += '    (parseFloat(i.retail_price) === 0);';
      html += '    var matchM = !minusFilter || ';
      html += '    (parseFloat(i.current_stock) < 0);';
      html += '    return matchQ && matchC && matchP && matchM;';
      html += '  });';
      html += '  currentPage = 1; render(filtered);';
      html += '}';

      html += 'var filteredItems = [];';
      html += 'function render(items) {';
      html += '  if (items) filteredItems = items;';
      html += '  var container = document.getElementById("itemsContainer");';
      html += '  try {';
      html += '    var totalPages = ';
      html += 'Math.ceil(filteredItems.length / pageLimit) || 1;';
      html += '    if (currentPage > totalPages) currentPage = totalPages;';
      html += '    var start = (currentPage - 1) * pageLimit;';
      html += '    var end = start + pageLimit;';
      html += '    var pageItems = filteredItems.slice(start, end);';
      html += '    container.className = ';
      html += 'viewMode === "tile" ? "grid-tiles" : "grid-rows";';
      html += '    while (container.firstChild) ';
      html += '    container.removeChild(container.firstChild);';
      
      html += '    if (pageItems.length === 0) { ';
      html += '      var empty = document.createElement("div"); ';
      html += '      empty.style = "grid-column: 1 / -1; text-align:center; ';
      html += '      padding:30px; color:#888;";';
      html += '      empty.innerText = "Ничего не найдено"; ';
      html += '      container.appendChild(empty); }';
      
      html += '    pageItems.forEach(function(i) {';
      html += '      var a = document.createElement("a");';
      html += '      a.href = "/warehouse/item?id=" + i.id;';
      html += '      var stock = parseFloat(i.current_stock) || 0;';
      html += '      var cl = stock > 0 ? "green" : "red";';
      html += '      var unit = i.unit || "шт";';
      html += '      var hasPrice = parseFloat(i.retail_price) > 0;';
      html += '      var isArchived = i.hidden === true;';
      
      html += '      var costStr = "";';
      html += '      if (stock > 0 && !isArchived) {';
      html += '        var avgCost = parseFloat(i.avg_cost) || 0;';
      html += '        var totalCost = stock * avgCost;';
      html += '        costStr = "(" + Math.round(avgCost) + " ₽/шт) = " + ';
      html += 'Math.round(totalCost).toLocaleString("ru-RU") + " ₽";';
      html += '      }';
      
      html += '      if (viewMode === "tile") {';
      html += '        a.className = "card-tile";';
      html += '        if (isArchived) a.classList.add("archived-item");';
      html += '        if (i.photo_url) { ';
      html += '          var img = document.createElement("img"); ';
      html += '          img.src = i.photo_url; a.appendChild(img); } ';
      html += '        else { ';
      html += '          var ph = document.createElement("div"); ';
      html += '          ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '          a.appendChild(ph); }';
      
      html += '        if (i.is_pinned) { ';
      html += '          var pin = document.createElement("div"); ';
      html += '          pin.className = "pin-icon"; ';
      html += '          pin.textContent = "★"; a.appendChild(pin); }';
      
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "name"; nm.textContent = i.name; ';
      html += '        a.appendChild(nm);';
      
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "stock " + cl; ';
      html += '        st.textContent = fmtNum(stock) + " " + unit; ';
      html += '        a.appendChild(st);';
      
      html += '        if (costStr) { ';
      html += '          var cDiv = document.createElement("div"); ';
      html += '          cDiv.className = "cost-info"; ';
      html += '          cDiv.textContent = costStr; ';
      html += '          a.appendChild(cDiv); }';
      
      html += '        if (!hasPrice && !isArchived) { ';
      html += '          var pw = document.createElement("div"); ';
      html += '          pw.className = "price-warn"; ';
      html += '          pw.textContent = "Нет цены"; a.appendChild(pw); }';
      
      html += '        if (isArchived) {';
      html += '          var ab = document.createElement("div");';
      html += '          ab.className = "archived-badge"; ';
      html += '          ab.textContent = "Архив"; a.appendChild(ab); }';
      
      html += '      } else {';
      html += '        a.className = "card-row";';
      html += '        if (isArchived) a.classList.add("archived-item");';
      html += '        var left = document.createElement("div"); ';
      html += '        left.className = "row-left";';
      
      html += '        if (i.photo_url) { ';
      html += '          var img = document.createElement("img"); ';
      html += '          img.src = i.photo_url; left.appendChild(img); } ';
      html += '        else { ';
      html += '          var ph = document.createElement("div"); ';
      html += '          ph.className = "ph"; ph.innerHTML = svgPhRow; ';
      html += '          left.appendChild(ph); }';
      
      html += '        var nmWrap = document.createElement("div");';
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "name"; nm.textContent = i.name; ';
      html += '        nmWrap.appendChild(nm);';
      
      html += '        if (!hasPrice && !isArchived) { ';
      html += '          var pw = document.createElement("div"); ';
      html += '          pw.className = "price-warn"; ';
      html += '          pw.textContent = "Нет цены"; nmWrap.appendChild(pw); }';
      
      html += '        if (isArchived) {';
      html += '          var ab = document.createElement("div");';
      html += '          ab.className = "archived-badge"; ';
      html += '          ab.textContent = "Архив"; nmWrap.appendChild(ab); }';
      
      html += '        if (i.is_pinned) { ';
      html += '          var pin = document.createElement("span"); ';
      html += '          pin.className = "pin-icon"; ';
      html += '          pin.textContent = "★"; nmWrap.appendChild(pin); }';
      html += '        left.appendChild(nmWrap); a.appendChild(left);';
      
      html += '        var right = document.createElement("div");';
      html += '        right.style = "text-align:right;";';
      
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "stock " + cl; ';
      html += '        st.textContent = fmtNum(stock) + " " + unit; ';
      html += '        right.appendChild(st);';
      
      html += '        if (costStr) { ';
      html += '          var cDiv = document.createElement("div"); ';
      html += '          cDiv.className = "cost-info"; ';
      html += '          cDiv.textContent = costStr; ';
      html += '          right.appendChild(cDiv); }';
      
      html += '        a.appendChild(right);';
      html += '      }';
      html += '      container.appendChild(a);';
      html += '    });';

      html += '    var pag = document.getElementById("pagination"); ';
      html += '    while (pag.firstChild) pag.removeChild(pag.firstChild);';
      html += '    if (totalPages > 1) {';
      html += '      var prevBtn = document.createElement("button"); ';
      html += '      prevBtn.className = "cat-btn"; ';
      html += '      prevBtn.innerText = "←"; ';
      html += '      prevBtn.disabled = currentPage === 1; ';
      html += '      prevBtn.onclick = function(){ currentPage--; ';
      html += '      render(); window.scrollTo(0,0); }; ';
      html += '      if(currentPage === 1) prevBtn.style.opacity = "0.3";';
      
      html += '      var nextBtn = document.createElement("button"); ';
      html += '      nextBtn.className = "cat-btn"; ';
      html += '      nextBtn.innerText = "→"; ';
      html += '      nextBtn.disabled = currentPage === totalPages; ';
      html += '      nextBtn.onclick = function(){ currentPage++; ';
      html += '      render(); window.scrollTo(0,0); }; ';
      html += '      if(currentPage === totalPages) ';
      html += '      nextBtn.style.opacity = "0.3";';
      
      html += '      var txt = document.createElement("span"); ';
      html += '      txt.style = "display:flex; align-items:center; ';
      html += '      font-weight:600; font-size:14px;"; ';
      html += '      txt.innerText = currentPage + " / " + totalPages;';
      
      html += '      pag.appendChild(prevBtn); pag.appendChild(txt); ';
      html += '      pag.appendChild(nextBtn);';
      html += '    }';
      html += '  } catch (err) {';
      html += '    var errDiv = document.createElement("div");';
      html += '    errDiv.style = "color:red;text-align:center;padding:20px;";';
      html += '    errDiv.textContent = "Ошибка отрисовки: " + err.message;';
      html += '    container.appendChild(errDiv);';
      html += '  }';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) {
      console.error('Inventory error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 4. КАРТОЧКА ТОВАРА (ВЫПИСКА) ======
  app.get('/warehouse/item', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.history-card { background: #fff; border-radius: var(--r-md); ';
      html += 'padding: 16px; margin-bottom: 10px; display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-1); text-decoration: none; ';
      html += 'color: var(--f-text); border-left: 4px solid transparent; }';
      html += '.history-card.sale { border-left-color: #3C7A89; }';
      html += '.history-card.receipt { border-left-color: var(--f-success); }';
      html += '.history-card.writeoff { border-left-color: var(--f-danger); }';
      
      html += '.h-left { display: flex; flex-direction: column; gap: 4px; }';
      html += '.h-title { font-weight: 700; font-size: 15px; display: flex; ';
      html += 'align-items: center; gap: 6px; }';
      html += '.h-meta { font-size: 12px; color: var(--f-text-2); }';
      html += '.h-badge { font-size: 11px; padding: 2px 8px; ';
      html += 'border-radius: 10px; font-weight: 700; display: inline-block; }';
      html += '.badge-sale { background: #E3F2FD; color: #3C7A89; }';
      html += '.badge-receipt { background: #E8F5E9; color: var(--f-success); }';
      html += '.badge-writeoff { background: #FFEBEE; color: var(--f-danger); }';
      
      html += '.h-right { text-align: right; display: flex; ';
      html += 'flex-direction: column; align-items: flex-end; gap: 4px; }';
      html += '.h-amount { font-weight: 800; font-size: 16px; }';
      html += '.h-stock { font-size: 11px; color: #aaa; font-weight: 600; }';
      
      html += '.actions { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 8px; margin-top: 16px; margin-bottom: 24px; }';
      html += '.btn-act { padding: 12px; border-radius: var(--r-md); ';
      html += 'border: 1px solid var(--f-border); font-weight: 600; ';
      html += 'color: var(--f-text); font-size: 14px; background: #fff;';
      html += 'font-family: inherit; display: flex; align-items: center; ';
      html += 'justify-content: center; gap: 6px; box-shadow: var(--sh-1); }';
      html += '.btn-act svg { width: 18px; height: 18px; }';
      html += '.btn-act.primary { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';
      html += '.btn-act.danger { color: var(--f-danger); }';
      html += '.btn-act.full { grid-column: 1 / -1; }';
      html += '.btn-act.success { color: var(--f-success); ';
      html += 'border-color: var(--f-success); }';
      
      html += '.controls { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 16px; }';
      html += '.limit-select { padding: 8px 12px; border-radius: 10px; ';
      html += 'border: 1px solid var(--f-border); font-family: inherit; ';
      html += 'font-weight: 600; color: var(--f-text); background: #fff; ';
      html += 'box-shadow: var(--sh-1); width: 80px; text-align: center; ';
      html += 'margin: 0; }';
      html += '.pag-btn { background: #fff; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'padding: 8px 12px; border-radius: 10px; font-weight: 600; ';
      html += 'color: var(--f-text); box-shadow: var(--sh-1); }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse/inventory" class="back-btn">←</a>';
      html += '<h2 class="page-title">Выписка</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<input type="file" id="photoInput" accept="image/*" ';
      html += 'style="display:none;" onchange="uploadPhoto()">';
      
      html += '<div id="header-info" style="text-align:center; ';
      html += 'margin-bottom:20px;"></div>';

      html += '<div class="actions" id="actions" style="display:none;">';
      
      html += '<button class="btn-act success full" id="btnRestore" ';
      html += 'style="display:none;" onclick="restoreItem()">';
      html += 'Восстановить из архива</button>';
      
      html += '<button class="btn-act primary" id="btnSetPrice" ';
      html += 'style="display:none;" onclick="setRetailPrice()">';
      html += 'Задать цену</button>';
      html += '<button class="btn-act" id="btnPin" ';
      html += 'onclick="togglePin()">Закрепить</button>';
      html += '<button class="btn-act" onclick="renameItem()">';
      html += 'Переименовать</button>';
      html += '<button class="btn-act" onclick="clickPhoto()">';
      html += 'Загрузить фото</button>';
      html += '<button class="btn-act danger full" id="btnDelete" ';
      html += 'onclick="deleteItem()">Удалить товар</button>';
      html += '</div>';

      html += '<div class="controls" id="historyControls" ';
      html += 'style="display:none;">';
      html += '<h3 style="margin:0; font-size:16px;">История операций</h3>';
      html += '<select class="limit-select" id="limitSelect" ';
      html += 'onchange="changeLimit(this.value)">';
      html += '<option value="10">10</option>';
      html += '<option value="30">30</option>';
      html += '<option value="50">50</option>';
      html += '<option value="100">100</option>';
      html += '</select>';
      html += '</div>';

      html += '<div style="display:flex; justify-content:center; ';
      html += 'gap:10px; align-items:center; margin-bottom:16px;">';
      html += '<button class="pag-btn" id="btnPrev" onclick="prevPage()" ';
      html += 'style="opacity:0.3;">←</button>';
      html += '<span id="pageInfo" style="font-weight:800; font-size:14px;">';
      html += '1 / 1</span>';
      html += '<button class="pag-btn" id="btnNext" onclick="nextPage()" ';
      html += 'style="opacity:0.3;">→</button>';
      html += '</div>';

      html += '<div id="list">Загрузка...</div>';
      
      html += getUnifiedMenu('inventory');

      html += '<script>';
      html += 'var itemId = parseInt(new URLSearchParams(';
      html += 'window.location.search).get("id")) || 0;';
      html += 'var itemName = ""; var itemUnit = "шт"; var isPinned = false;';
      html += 'var itemPrice = 0; var totalHistory = 0; var currentPage = 1;';
      html += 'var pageLimit = parseInt(localStorage.getItem(';
      html += '"wh_item_limit")) || 10;';
      html += 'var isArchived = false;';
      html += 'document.getElementById("limitSelect").value = pageLimit;';

      html += 'function clickPhoto() {';
      html += '  document.getElementById("photoInput").click();';
      html += '}';

      html += 'function changeLimit(v) {';
      html += '  pageLimit = parseInt(v); ';
      html += 'localStorage.setItem("wh_item_limit", v);';
      html += '  currentPage = 1; loadHistory();';
      html += '}';

      html += 'function prevPage() { ';
      html += '  if (currentPage > 1) { currentPage--; loadHistory(); } }';
      html += 'function nextPage() { ';
      html += '  var maxP = Math.ceil(totalHistory / pageLimit) || 1; ';
      html += '  if (currentPage < maxP) { currentPage++; loadHistory(); } }';

      html += 'function loadHistory() {';
      html += '  var list = document.getElementById("list");';
      html += '  if (currentPage === 1) list.textContent = "Загрузка...";';
      html += '  var offset = (currentPage - 1) * pageLimit;';
      html += '  fetch("/api/warehouse/item/history?id=" + itemId + ';
      html += '  "&limit=" + pageLimit + "&offset=" + offset)';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { ';
      html += '      list.textContent = "Ошибка: " + (d.error || "unknown"); ';
      html += '      return; ';
      html += '    }';
      html += '    totalHistory = d.total || 0;';
      
      html += '    if (currentPage === 1) {';
      html += '      var hi = document.getElementById("header-info");';
      html += '      while (hi.firstChild) hi.removeChild(hi.firstChild);';
      html += '      itemName = d.item.name; itemUnit = d.item.unit || "шт";';
      html += '      isPinned = d.item.is_pinned === true;';
      html += '      isArchived = d.item.hidden === true;';
      html += '      itemPrice = parseFloat(d.item.retail_price) || 0;';
      html += '      document.getElementById("actions")';
      html += '      .style.display = "grid";';
      html += '      document.getElementById("historyControls")';
      html += '      .style.display = "flex";';
      html += '      updatePinBtn();';
      
      html += '      if (isArchived) {';
      html += '        var br = document.getElementById("btnRestore");';
      html += '        br.style.display = "flex";';
      html += '        document.getElementById("btnDelete").style.display = "none";';
      html += '      }';

      html += '      if (itemPrice === 0) { ';
      html += '        var bsp = document.getElementById("btnSetPrice");';
      html += '        bsp.style.display = "flex"; ';
      html += '        bsp.innerText = "Задать цену"; }';
      html += '      else { ';
      html += '        var bsp2 = document.getElementById("btnSetPrice");';
      html += '        bsp2.style.display = "flex"; ';
      html += '        bsp2.innerText = "Изменить цену"; }';
      
      html += '      var isPos = parseFloat(d.item.current_stock) > 0;';
      html += '      var cl = isPos ? "var(--f-success)" : "var(--f-danger)";';
      html += '      var h2 = document.createElement("h2");';
      html += '      h2.style.margin = "0"; h2.style.fontSize = "24px";';
      html += '      h2.style.fontWeight = "800";';
      html += '      h2.textContent = itemName; hi.appendChild(h2);';
      html += '      var stockDiv = document.createElement("div");';
      html += '      stockDiv.style.fontSize = "20px";';
      html += '      stockDiv.style.fontWeight = "800";';
      html += '      stockDiv.style.color = cl;';
      html += '      stockDiv.style.marginTop = "8px";';
      html += '      stockDiv.textContent = "Остаток: " + ';
      html += '      fmtNum(d.item.current_stock) + " " + itemUnit;';
      html += '      hi.appendChild(stockDiv);';
      html += '      if (itemPrice > 0) {';
      html += '        var prDiv = document.createElement("div");';
      html += '        prDiv.style.fontSize = "16px";';
      html += '        prDiv.style.fontWeight = "600";';
      html += '        prDiv.style.color = "var(--f-brand)";';
      html += '        prDiv.style.marginTop = "4px";';
      html += '        prDiv.textContent = "Цена: " + ';
      html += '        itemPrice.toLocaleString("ru-RU") + " ₽";';
      html += '        hi.appendChild(prDiv);';
      html += '      }';
      html += '    }';
      
      html += '    var maxP = Math.ceil(totalHistory / pageLimit) || 1;';
      html += '    document.getElementById("pageInfo").textContent = ';
      html += '    currentPage + " / " + maxP;';
      html += '    document.getElementById("btnPrev").style.opacity = ';
      html += '    currentPage === 1 ? "0.3" : "1";';
      html += '    document.getElementById("btnNext").style.opacity = ';
      html += '    currentPage === maxP ? "0.3" : "1";';

      html += '    while (list.firstChild) list.removeChild(list.firstChild);';
      html += '    var histList = d.history || [];';
      html += '    if (histList.length === 0) {';
      html += '      list.textContent = "Нет операций"; return; }';

      html += '    histList.forEach(function(h) {';
      html += '      var a = document.createElement("a");';
      html += '      var hDate = h.date ? new Date(h.date) : new Date();';
      html += '      if (isNaN(hDate.getTime())) hDate = new Date();';
      html += '      var ds = hDate.toLocaleString("ru-RU", { ';
      html += '      day: "2-digit", month: "2-digit", hour: "2-digit", ';
      html += '      minute: "2-digit" });';
      
      html += '      var left = document.createElement("div");';
      html += '      left.className = "h-left";';
      html += '      var title = document.createElement("div");';
      html += '      title.className = "h-title";';
      html += '      var meta = document.createElement("div");';
      html += '      meta.className = "h-meta";';
      html += '      meta.textContent = ds + " · " + (h.person || "Система");';
      
      html += '      var right = document.createElement("div");';
      html += '      right.className = "h-right";';
      html += '      var amt = document.createElement("div");';
      html += '      amt.className = "h-amount";';
      html += '      var stockFlow = document.createElement("div");';
      html += '      stockFlow.className = "h-stock";';
      html += '      stockFlow.textContent = fmtNum(h.stock_before) + ';
      html += '      " → " + fmtNum(h.stock_after);';

      html += '      if (h.type === "sale") {';
      html += '        a.className = "history-card sale";';
      html += '        a.href = "/warehouse/sale/details?id=" + h.id;';
      html += '        var bdg = document.createElement("span");';
      html += '        bdg.className = "h-badge badge-sale";';
      html += '        bdg.innerText = "Продажа";';
      html += '        title.appendChild(bdg);';
      html += '        var tId = document.createTextNode(" №" + h.id);';
      html += '        title.appendChild(tId);';
      html += '        amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
      html += '        amt.style.color = "#3C7A89";';
      html += '      } else if (h.type === "writeoff") {';
      html += '        a.className = "history-card writeoff";';
      html += '        a.href = "/warehouse/documents/details?id=" + h.id + ';
      html += '        "&type=writeoffs";';
      html += '        var bdg2 = document.createElement("span");';
      html += '        bdg2.className = "h-badge badge-writeoff";';
      html += '        bdg2.innerText = "Списание";';
      html += '        title.appendChild(bdg2);';
      html += '        var tId2 = document.createTextNode(" №" + h.id);';
      html += '        title.appendChild(tId2);';
      html += '        meta.textContent += " · " + translateReason(h.reason);';
      html += '        amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
      html += '        amt.style.color = "var(--f-danger)";';
      html += '      } else {';
      html += '        a.className = "history-card receipt";';
      html += '        a.href = "/warehouse/documents/details?id=" + h.id + ';
      html += '        "&type=receipts";';
      html += '        var bdg3 = document.createElement("span");';
      html += '        bdg3.className = "h-badge badge-receipt";';
      html += '        bdg3.innerText = "Приход";';
      html += '        title.appendChild(bdg3);';
      html += '        var tId3 = document.createTextNode(" №" + h.id);';
      html += '        title.appendChild(tId3);';
      html += '        amt.textContent = "+" + fmtNum(h.qty) + " " + itemUnit;';
      html += '        amt.style.color = "var(--f-success)";';
      html += '      }';

      html += '      left.appendChild(title); left.appendChild(meta);';
      html += '      right.appendChild(amt); right.appendChild(stockFlow);';
      html += '      a.appendChild(left); a.appendChild(right);';
      html += '      list.appendChild(a);';
      html += '    });';
      html += '  }).catch(function(err) {';
      html += '    document.getElementById("list").textContent = ';
      html += '    "Ошибка сети: " + err.message;';
      html += '  });';
      html += '}';

      html += 'loadHistory();';
      
      html += 'function restoreItem() {';
      html += '  var btn = document.getElementById("btnRestore");';
      html += '  btn.disabled = true; btn.innerText = "Восстановление...";';
      html += '  fetch("/api/warehouse/item/restore", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ id: itemId }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) { if (d.ok) { ';
      html += '    showAlert("Готово", "Товар возвращен", true); ';
      html += '    setTimeout(function() { location.reload(); }, 1000); } ';
      html += '    else { btn.disabled = false; ';
      html += '      btn.innerText = "Восстановить из архива"; ';
      html += '      showAlert("Ошибка", d.error, false); } })';
      html += '  .catch(function() { btn.disabled = false; ';
      html += '    btn.innerText = "Восстановить из архива"; ';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false); });';
      html += '}';

      html += 'function deleteItem() {';
      html += '  showConfirm("Удаление", "Вы уверены, что хотите удалить " + ';
      html += '  itemName + "? Если есть история, он будет скрыт.", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/item/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: itemId }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { if (d.ok) { ';
      html += '      showAlert("Готово", "Товар удален", true); ';
      html += '      setTimeout(function() { window.location.href = ';
      html += '      "/warehouse/inventory"; }, 1000); ';
      html += '    } else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function(){});';
      html += '  }, true);';
      html += '}';

      html += 'function setRetailPrice() {';
      html += '  var def = itemPrice > 0 ? itemPrice : "";';
      html += '  showPrompt("Розничная цена", "Введите цену (₽)", def, ';
      html += '  function(p) {';
      html += '    if (!p) return;';
      html += '    var num = parseFloat(String(p).replace(",", "."));';
      html += '    if (isNaN(num) || num <= 0) { ';
      html += '      showAlert("Ошибка", "Неверная цена", false); return; }';
      html += '    fetch("/api/warehouse/item/set-price", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: itemId, price: num }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { ';
      html += '      if (d.ok) { showAlert("Готово", ';
      html += '      "Цена установлена", true); ';
      html += '      setTimeout(function() { location.reload(); }, 1000); } ';
      html += '      else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function() {});';
      html += '  });';
      html += '}';

      html += 'function togglePin() {';
      html += '  var newVal = !isPinned;';
      html += '  fetch("/api/warehouse/item/pin", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ id: itemId, val: newVal }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) { if (d.ok) { isPinned = newVal; ';
      html += '  updatePinBtn(); } })';
      html += '  .catch(function() {});';
      html += '}';
      
      html += 'function updatePinBtn() {';
      html += '  var b = document.getElementById("btnPin");';
      html += '  if (isPinned) { b.style.background = "#FFF3E0"; ';
      html += '    b.style.color = "#E67E22"; b.style.borderColor = "#E67E22";';
      html += '    b.innerText = "Открепить"; }';
      html += '  else { b.style.background = "#fff"; ';
      html += '    b.style.color = "var(--f-text)"; ';
      html += '    b.style.borderColor = "var(--f-border)";';
      html += '    b.innerText = "Закрепить"; }';
      html += '}';

      html += 'function renameItem() {';
      html += '  showPrompt("Новое название", "Введите имя", itemName, ';
      html += '  function(newName) {';
      html += '    if (!newName || newName === itemName) return;';
      html += '    fetch("/api/warehouse/item/rename", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: itemId, name: newName }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { if (d.ok) { ';
      html += '      showAlert("Готово", "Переименовано", true); ';
      html += '      setTimeout(function() { location.reload(); }, 1000); ';
      html += '    } else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function() {});';
      html += '  });';
      html += '}';

      html += 'function uploadPhoto() {';
      html += '  var f = document.getElementById("photoInput").files[0];';
      html += '  if (!f) return;';
      html += '  showAlert("Загрузка", "Сжимаем и отправляем фото...", true);';
      html += '  var rd = new FileReader();';
      html += '  rd.onload = function(e) {';
      html += '    var img = new Image();';
      html += '    img.onload = function() {';
      html += '      var canvas = document.createElement("canvas");';
      html += '      var MAX = 800;';
      html += '      var w = img.width, h = img.height;';
      html += '      if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }';
      html += '      else { if (h > MAX) { w *= MAX / h; h = MAX; } }';
      html += '      canvas.width = w; canvas.height = h;';
      html += '      var ctx = canvas.getContext("2d");';
      html += '      ctx.drawImage(img, 0, 0, w, h);';
      html += '      var dataUrl = canvas.toDataURL("image/jpeg", 0.7);';
      html += '      sendCompressedPhoto(dataUrl);';
      html += '    };';
      html += '    img.src = e.target.result;';
      html += '  };';
      html += '  rd.readAsDataURL(f);';
      html += '}';

      html += 'function sendCompressedPhoto(base64) {';
      html += '  fetch("/api/warehouse/upload", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ image: base64 }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { savePhoto(d.url); }';
      html += '    else { showAlert("Ошибка", d.error || ';
      html += '    "Сервер не принял фото", false); }';
      html += '  }).catch(function() { showAlert("Ошибка сети", ';
      html += '  "Проверьте интернет", false); });';
      html += '}';

      html += 'function savePhoto(url) {';
      html += '  fetch("/api/warehouse/item/set-photo", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ id: itemId, url: url }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { showAlert("Готово", "Фото обновлено", true); ';
      html += '    setTimeout(function() { location.reload(); }, 1000); }';
      html += '    else showAlert("Ошибка базы", d.error, false);';
      html += '  }).catch(function() { showAlert("Ошибка", ';
      html += '  "Сбой при сохранении", false); });';
      html += '}';
      
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      console.error('Item page error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });
}

module.exports = { setupWarehouseViewsInventory };