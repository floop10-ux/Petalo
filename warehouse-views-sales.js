const pool = require('./db');
const {
  esc, fmtNum, getUnifiedMenu, getIconSvg,
  metaSafari, fontLink, uiScript
} = require('./warehouse-views-core');

function setupWarehouseViewsSales(app, bot, s3ctx, getAuth) {
  // ====== 5. ЭКРАН ПРОДАЖИ (КАССА) ======
  app.get('/warehouse/sale', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const shiftRes = await pool.query(
        'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        [shopId, chatId]
      );

      if (shiftRes.rows.length === 0) {
        let errHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
        errHtml += metaSafari;
        errHtml += '<meta name="viewport" content="width=device-width, ';
        errHtml += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
        errHtml += fontLink + uiScript + '<style>';
        errHtml += 'body { display: flex; flex-direction: column; ';
        errHtml += 'align-items: center; justify-content: center; ';
        errHtml += 'height: 100vh; padding: 20px; text-align: center; }';
        errHtml += '.card { max-width: 340px; width: 100%; ';
        errHtml += 'padding: 40px 24px; }';
        errHtml += '</style></head><body>';
        errHtml += '<div class="card">';
        errHtml += '<h1 style="font-size:48px; margin:0 0 16px 0;">⏱</h1>';
        errHtml += '<h2 style="margin:0 0 8px 0; font-size:20px;">';
        errHtml += 'Смена не открыта</h2>';
        errHtml += '<p class="text-muted" style="margin-bottom:24px;">';
        errHtml += 'Для оформления продаж сначала откройте смену.</p>';
        errHtml += '<a href="/warehouse/shift" class="btn btn-primary">';
        errHtml += 'Открыть смену</a>';
        errHtml += '</div></body></html>';
        return res.send(errHtml);
      }

      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 80px 16px; }';
      html += '.search-wrapper { position: relative; margin-bottom: 16px; }';
      html += '.search { width: 100%; padding: 14px 16px; border: none; ';
      html += 'border-radius: var(--r-md); box-sizing: border-box; ';
      html += 'font-family: inherit; font-size: 16px; ';
      html += 'box-shadow: var(--sh-1); }';
      html += '.clear-search { position: absolute; right: 14px; ';
      html += 'top: 50%; transform: translateY(-50%); font-size: 18px; ';
      html += 'color: #aaa; cursor: pointer; display: none; ';
      html += 'background: none; border: none; padding: 0; }';
      
      html += '.h-scroll { display: flex; overflow-x: auto; gap: 8px; ';
      html += 'margin-bottom: 16px; padding-bottom: 4px; }';
      html += '.h-scroll::-webkit-scrollbar { display: none; }';
      html += '.cat-btn { padding: 8px 16px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
      html += 'font-size: 14px; white-space: nowrap; font-family: inherit; ';
      html += 'color: var(--f-text); font-weight: 600; }';
      html += '.cat-btn.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';
      html += '.cat-btn.bouquets-btn { background: #FFF3E0; ';
      html += 'color: var(--f-accent); font-weight: 700; border: none; }';
      html += '.cat-btn.bouquets-btn.active { background: var(--f-accent); ';
      html += 'color: #fff; }';
      
      html += '.grid-controls { display: flex; gap: 6px; ';
      html += 'margin-bottom: 12px; justify-content: flex-end; }';
      html += '.grid-btn { background: #fff; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: 6px; padding: 4px 8px; font-size: 12px; ';
      html += 'font-weight: 600; color: var(--f-text-2); cursor: pointer; }';
      html += '.grid-btn.active { background: var(--f-brand); ';
      html += 'color: #fff; border-color: var(--f-brand); }';

      html += '.grid { display: grid; gap: 8px; width: 100%; }';
      html += '.grid-3 { grid-template-columns: repeat(3, 1fr); }';
      html += '.grid-4 { grid-template-columns: repeat(4, 1fr); }';
      html += '.grid-5 { grid-template-columns: repeat(5, 1fr); }';
      html += '.grid-6 { grid-template-columns: repeat(6, 1fr); }';

      html += '.card { background: #fff; padding: 8px; border-radius: 12px; ';
      html += 'text-align: center; cursor: pointer; position: relative; ';
      html += 'box-shadow: var(--sh-1); ';
      html += 'display: flex; flex-direction: column; }';
      html += '.card img { width: 100%; aspect-ratio: 1; object-fit: cover; ';
      html += 'border-radius: 8px; margin-bottom: 6px; }';
      html += '.card .ph { width: 100%; aspect-ratio: 1; ';
      html += 'border-radius: 8px; background: #F0F4F4; ';
      html += 'display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 6px; }';
      html += '.card .name { font-size: 12px; font-weight: 600; ';
      html += 'margin-bottom: 4px; line-height: 1.2; word-break: break-word; ';
      html += 'display: -webkit-box; -webkit-line-clamp: 2; ';
      html += '-webkit-box-orient: vertical; overflow: hidden; }';
      html += '.card .stock { font-size: 11px; font-weight: 800; ';
      html += 'margin-top: auto; }';
      html += '.card .stock.green { color: var(--f-success); }';
      html += '.card .stock.red { color: var(--f-danger); }';
      html += '.card.bouquet { background: #FFF8F3; ';
      html += 'border: 1px solid var(--f-accent); }';
      html += '.card .bouquet-tag { font-size: 10px; ';
      html += 'color: var(--f-accent); font-weight: 800; margin-top: auto; }';
      html += '.card.pinned { border: 2px solid var(--f-accent); }';
      html += '.pin-badge { position: absolute; top: 4px; right: 4px; ';
      html += 'background: var(--f-accent); color: #fff; font-size: 10px; ';
      html += 'width: 20px; height: 20px; border-radius: 50%; ';
      html += 'display: flex; align-items: center; justify-content: center; }';

      html += '.floating-cart { position: fixed; bottom: 20px; left: 16px; ';
      html += 'right: 16px; background: var(--f-brand); color: #fff; ';
      html += 'padding: 16px 20px; border-radius: 16px; display: none; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-3); z-index: 900; cursor: pointer; ';
      html += 'font-weight: 800; font-size: 16px; transition: 0.3s; }';
      html += '.floating-cart.show { display: flex; }';

      html += '.sheet-overlay { position: fixed; top: 0; left: 0; ';
      html += 'width: 100%; height: 100%; background: rgba(0,0,0,0.5); ';
      html += 'display: none; z-index: 2000; backdrop-filter: blur(2px); }';
      html += '.sheet-overlay.open { display: block; }';
      
      html += '.bottom-sheet { position: fixed; bottom: -100%; left: 0; ';
      html += 'width: 100%; height: 90vh; background: var(--f-bg); ';
      html += 'border-radius: 24px 24px 0 0; transition: bottom 0.3s ease; ';
      html += 'z-index: 2001; display: flex; flex-direction: column; }';
      html += '.bottom-sheet.open { bottom: 0; }';
      html += '.sheet-header { padding: 12px 16px; display: flex; ';
      html += 'justify-content: space-between; align-items: center; }';
      html += '.sheet-handle { width: 40px; height: 5px; background: #ccc; ';
      html += 'border-radius: 5px; margin: 0 auto; }';
      html += '.close-sheet { background: none; border: none; ';
      html += 'font-size: 24px; color: #888; cursor: pointer; ';
      html += 'padding: 0; line-height: 1; }';
      
      html += '.sheet-body { display: flex; flex-direction: row; flex: 1; ';
      html += 'overflow: hidden; }';
      html += '.sheet-content { flex: 1; padding: 0 12px; ';
      html += 'overflow-y: auto; border-right: 1px solid var(--f-border); ';
      html += 'min-width: 0; }';
      html += '.calc-panel { flex: 0 0 170px; padding: 12px; ';
      html += 'overflow-y: auto; background: var(--f-surface); }';

      html += '.b-row { display: flex; align-items: center; ';
      html += 'justify-content: space-between; gap: 6px; margin-bottom: 8px; ';
      html += 'font-size: 13px; background: #fff; padding: 8px; ';
      html += 'border-radius: 12px; box-shadow: var(--sh-1); }';
      html += '.b-name { flex: 1; min-width: 0; font-weight: 600; ';
      html += 'word-break: break-word; }';
      html += '.b-ctrl { display: flex; align-items: center; gap: 4px; ';
      html += 'flex-shrink: 0; }';
      html += '.qty-btn { background: #F0F4F4; border: none; width: 26px; ';
      html += 'height: 26px; border-radius: 6px; font-weight: bold; ';
      html += 'font-size: 13px; color: var(--f-text); display: flex; ';
      html += 'align-items: center; justify-content: center; }';
      html += '.b-del { color: var(--f-danger); cursor: pointer; ';
      html += 'font-size: 16px; padding: 0 4px; flex-shrink: 0; }';

      html += '.pay-input-row { display: flex; gap: 4px; margin-top: 12px; }';
      html += '.pay-input-row input { font-size: 16px; font-weight: 800; ';
      html += 'text-align: right; flex: 1; padding: 10px; margin: 0; ';
      html += 'border: 1px solid var(--f-border); border-radius: 8px; }';
      html += '.pay-input-row button { background: var(--f-brand); ';
      html += 'color: #fff; border: none; border-radius: 8px; ';
      html += 'padding: 0 8px; font-size: 12px; font-weight: bold; }';

      html += '.numpad { display: grid; grid-template-columns: 1fr 1fr 1fr; ';
      html += 'gap: 6px; margin-top: 12px; }';
      html += '.numpad button { padding: 12px 0; font-size: 18px; ';
      html += 'border: none; background: #fff; border-radius: 10px; ';
      html += 'font-family: inherit; font-weight: 600; color: var(--f-text); ';
      html += 'box-shadow: var(--sh-1); touch-action: manipulation; }';
      html += '.numpad button:active { background: #eee; }';

      html += '.btn-submit { width: 100%; padding: 14px; font-size: 15px; ';
      html += 'font-weight: 800; color: #fff; background: #ccc; ';
      html += 'border: none; border-radius: 12px; margin-top: 12px; ';
      html += 'box-sizing: border-box; }';
      html += '.btn-submit.ready { background: var(--f-success); }';
      
      html += '.total-inp { font-size: 18px; font-weight: 800; width: 100%; ';
      html += 'border: 1px solid var(--f-border); background: #fff; ';
      html += 'padding: 10px; border-radius: 8px; box-sizing: border-box; ';
      html += 'text-align: right; }';
      
      html += '.pay-btn { padding: 8px 2px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: 8px; background: #fff; cursor: pointer; ';
      html += 'flex: 1; display: flex; flex-direction: column; ';
      html += 'align-items: center; justify-content: center; gap: 2px; ';
      html += 'font-weight: 600; font-size: 11px; transition: 0.2s; ';
      html += 'color: var(--f-text-2); touch-action: manipulation; }';
      html += '.pay-btn svg { width: 18px; height: 18px; ';
      html += 'margin-right: 0; margin-bottom: 2px; }';
      html += '.pay-btn.active { background: #E0F2F1; ';
      html += 'border-color: var(--f-brand); color: var(--f-brand); ';
      html += 'font-weight: 800; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Касса</h2>';
      html += '</div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="search-wrapper">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск..." oninput="onSearchInput()" ';
      html += 'autocomplete="off">';
      html += '<button class="clear-search" id="clearSearch" ';
      html += 'onclick="clearSearchText()">✕</button>';
      html += '</div>';

      html += '<div class="grid-controls">';
      html += '<button class="grid-btn" id="btn-grid-3" ';
      html += 'onclick="setGridCols(3)">3</button>';
      html += '<button class="grid-btn active" id="btn-grid-4" ';
      html += 'onclick="setGridCols(4)">4</button>';
      html += '<button class="grid-btn" id="btn-grid-5" ';
      html += 'onclick="setGridCols(5)">5</button>';
      html += '<button class="grid-btn" id="btn-grid-6" ';
      html += 'onclick="setGridCols(6)">6</button>';
      html += '</div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button>';
      html += '<button class="cat-btn bouquets-btn" id="cat-bouquets" ';
      html += 'onclick="toggleBouquetsMode()">Букеты</button>';
      html += '</div>';

      html += '<div class="grid grid-4" id="itemsGrid"></div>';

      html += '<div class="floating-cart" id="floatingCart">';
      html += '<span id="fcCount">0 товаров</span>';
      html += '<span id="fcTotal">0 ₽</span>';
      html += '</div>';

      html += '<div class="sheet-overlay" id="sheetOverlay" ';
      html += 'onclick="closeSheet()"></div>';
      html += '<div class="bottom-sheet" id="bottomSheet">';
      html += '<div class="sheet-header">';
      html += '<div class="sheet-handle"></div>';
      html += '<button class="close-sheet" onclick="closeSheet()">✕</button>';
      html += '</div>';

      html += '<div class="sheet-body">';
      html += '<div class="sheet-content">';
      html += '<div id="bList" class="swipeable-cart"></div>';
      html += '</div>';

      html += '<div class="calc-panel">';
      html += '<div style="margin-bottom:12px;">';
      html += '<label style="font-size:12px; font-weight:700; ';
      html += 'color:var(--f-text-2);">Сумма чека</label>';
      html += '<input type="text" id="totalPrice" class="total-inp" ';
      html += 'value="0" inputmode="none" readonly ';
      html += 'onclick="setActiveInput(&apos;totalPrice&apos;)">';
      html += '</div>';

      html += '<div style="display:flex; gap:4px; margin-bottom:12px;">';
      html += '<div class="pay-btn" id="btn-cash" ';
      html += 'onclick="setPay(&apos;cash&apos;)">';
      html += getIconSvg('cash') + 'Нал</div>';
      html += '<div class="pay-btn" id="btn-card" ';
      html += 'onclick="setPay(&apos;card&apos;)">';
      html += getIconSvg('card') + 'Карта</div>';
      html += '<div class="pay-btn" id="btn-qr" ';
      html += 'onclick="setPay(&apos;qr&apos;)">';
      html += getIconSvg('qr') + 'QR</div>';
      html += '</div>';

      html += '<div class="pay-input-row">';
      html += '<input type="text" id="payAmount" placeholder="Сумма" ';
      html += 'inputmode="none" readonly ';
      html += 'onclick="setActiveInput(&apos;payAmount&apos;)">';
      html += '<button onclick="addPayment()">Внести</button>';
      html += '</div>';

      html += '<div class="numpad">';
      html += '<button onclick="num(&apos;1&apos;)">1</button>';
      html += '<button onclick="num(&apos;2&apos;)">2</button>';
      html += '<button onclick="num(&apos;3&apos;)">3</button>';
      html += '<button onclick="num(&apos;4&apos;)">4</button>';
      html += '<button onclick="num(&apos;5&apos;)">5</button>';
      html += '<button onclick="num(&apos;6&apos;)">6</button>';
      html += '<button onclick="num(&apos;7&apos;)">7</button>';
      html += '<button onclick="num(&apos;8&apos;)">8</button>';
      html += '<button onclick="num(&apos;9&apos;)">9</button>';
      html += '<button onclick="num(&apos;C&apos;)" ';
      html += 'style="color:red;">C</button>';
      html += '<button onclick="num(&apos;0&apos;)">0</button>';
      html += '<button onclick="num(&apos;X&apos;)">⌫</button>';
      html += '</div>';

      html += '<div class="pay-list" id="payList" style="font-size:13px; ';
      html += 'margin-top:12px;"></div>';
      html += '<div style="text-align:center; margin-top:12px; ';
      html += 'font-size:14px; font-weight:800;" id="remainTxt"></div>';

      html += '<button class="btn-submit" id="btnSubmit" ';
      html += 'onclick="openPrecheck()">Принять</button>';
      html += '</div></div></div>';

      html += '<div class="sheet-overlay" id="precheckModal" ';
      html += 'style="z-index:3000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:24px; ';
      html += 'border-radius:24px; width:90%; max-width:400px; ';
      html += 'max-height:80vh; display:flex; flex-direction:column; ';
      html += 'box-shadow:var(--sh-3);">';
      html += '<h2 style="margin:0 0 16px 0; text-align:center; ';
      html += 'font-size:20px; font-weight:800;">Проверьте чек</h2>';
      html += '<div id="precheckList" style="overflow-y:auto; flex:1; ';
      html += 'margin-bottom:16px; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:12px 0;"></div>';
      
      html += '<div id="precheckChangeBlock" style="display:none; ';
      html += 'margin-bottom:16px; text-align:center;">';
      html += '<div style="font-size:14px; color:#888; margin-bottom:4px;">';
      html += 'Сдача:</div>';
      html += '<div style="font-size:24px; font-weight:800; ';
      html += 'color:var(--f-brand);" id="precheckChangeAmt">0 ₽</div>';
      html += '<div style="font-size:12px; color:#888; margin-top:10px; ';
      html += 'margin-bottom:6px;">Куда выдать?</div>';
      html += '<div style="display:flex; gap:6px;">';
      html += '<div class="pay-btn active" id="pcm-cash" ';
      html += 'onclick="setPrecheckChangeMethod(&apos;cash&apos;)">Нал</div>';
      html += '<div class="pay-btn" id="pcm-card" ';
      html += 'onclick="setPrecheckChangeMethod(&apos;card&apos;)">';
      html += 'Карта</div>';
      html += '<div class="pay-btn" id="pcm-qr" ';
      html += 'onclick="setPrecheckChangeMethod(&apos;qr&apos;)">QR</div>';
      html += '</div></div>';
      
      html += '<div style="display:flex; justify-content:space-between; ';
      html += 'font-weight:800; font-size:18px; margin-bottom:16px;">';
      html += '<span>Итого:</span><span id="precheckTotal">0 ₽</span></div>';
      html += '<div style="display:flex; gap:12px;">';
      html += '<button onclick="closePrecheck()" style="flex:1; ';
      html += 'padding:14px; border:none; border-radius:12px; ';
      html += 'font-weight:800; font-size:16px; background:#F0F4F4; ';
      html += 'color:var(--f-text);">Вернуться</button>';
      html += '<button onclick="saveSale()" style="flex:2; padding:14px; ';
      html += 'border:none; border-radius:12px; font-weight:800; ';
      html += 'font-size:16px; background:var(--f-success); color:#fff;">';
      html += 'Подтвердить</button>';
      html += '</div></div></div>';

      html += '<div class="sheet-overlay" id="successModal" ';
      html += 'style="z-index:3000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:32px 24px; ';
      html += 'border-radius:24px; width:85%; max-width:340px; ';
      html += 'text-align:center; box-shadow:var(--sh-3);">';
      html += '<div style="width:64px; height:64px; background:#E8F5E9; ';
      html += 'color:var(--f-success); border-radius:50%; ';
      html += 'margin:0 auto 16px; display:flex; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="3" stroke-linecap="round" ';
      html += 'stroke-linejoin="round"><polyline points="20 6 9 17 4 12">';
      html += '</polyline></svg></div>';
      html += '<h1 style="color:var(--f-text); font-size:24px; ';
      html += 'margin:0 0 8px 0;">Готово!</h1>';
      html += '<div style="font-size:16px; margin-bottom:16px; ';
      html += 'color:var(--f-text-2);">Продажа оформлена</div>';
      html += '<div id="changeBlock" style="display:none;">';
      html += '<div style="font-size:14px; color:#888; margin-top:16px;">';
      html += 'СДАЧА:</div>';
      html += '<div style="font-size:36px; font-weight:800; ';
      html += 'color:var(--f-brand);" id="changeAmount">0</div></div>';
      html += '<button onclick="closeSuccess()" style="width:100%; ';
      html += 'padding:14px; border:none; border-radius:12px; ';
      html += 'font-size:16px; font-weight:800; color:#fff; ';
      html += 'background:var(--f-success); margin-top:20px;">';
      html += 'Готово</button></div></div>';

      html += getUnifiedMenu('sale');

      html += '<script>';
      html += 'var allItems = []; var currentCat = 0; ';
      html += 'var bouquetsMode = false; var bouquetsList = [];';
      html += 'var cart = []; var payMethod = ""; var payments = []; ';
      html += 'var precheckChangeMethod = "cash"; var gridCols = 4; ';
      html += 'var currentIdempotencyKey = null;';
      html += 'var activeInputId = "payAmount"; var isFirstInput = true; ';
      html += 'var isPayAmountEdited = false; ';
      html += 'var isTotalPriceEdited = false;';
      
      html += 'var svgPh = "<div style=width:40px;height:40px;';
      html += 'background:#D8E4E4;border-radius:50%;></div>";';

      html += 'if (localStorage.getItem("wh_sale_grid_cols")) {';
      html += '  gridCols = parseInt(';
      html += 'localStorage.getItem("wh_sale_grid_cols"));';
      html += '}';
      html += 'function initGrid() {';
      html += '  var g = document.getElementById("itemsGrid");';
      html += '  g.className = "grid grid-" + gridCols;';
      html += '  document.querySelectorAll(".grid-btn").forEach(';
      html += '  function(b){b.classList.remove("active");});';
      html += '  var btn = document.getElementById("btn-grid-" + gridCols);';
      html += '  if (btn) btn.classList.add("active");';
      html += '}';
      html += 'function setGridCols(cols) {';
      html += '  gridCols = cols; ';
      html += 'localStorage.setItem("wh_sale_grid_cols", cols);';
      html += '  initGrid();';
      html += '}';
      html += 'initGrid();';

      html += 'fetch("/api/warehouse/categories")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) {';
      html += '  if (d.ok) {';
      html += '    var cl = document.getElementById("catList");';
      html += '    var bouqBtn = document.getElementById("cat-bouquets");';
      html += '    d.categories.forEach(function(c) {';
      html += '      var b = document.createElement("button");';
      html += '      b.className = "cat-btn"; b.id = "cat-" + c.id;';
      html += '      b.innerText = c.name;';
      html += '      b.onclick = function() { setCat(c.id); };';
      html += '      cl.insertBefore(b, bouqBtn);';
      html += '    });';
      html += '  }';
      html += '}).catch(function() {});';

      html += 'fetch("/api/warehouse/items?t=" + Date.now())';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { ';
      html += '  if (d.ok) { allItems = d.items; render(); } ';
      html += '  else { ';
      html += '    var g = document.getElementById("itemsGrid"); ';
      html += '    var ed = document.createElement("div"); ';
      html += '    ed.style.color = "red"; ';
      html += '    ed.style.textAlign = "center"; ';
      html += '    ed.style.padding = "20px"; ';
      html += '    ed.style.gridColumn = "1/-1"; ';
      html += '    ed.textContent = d.error || "Ошибка загрузки"; ';
      html += '    g.appendChild(ed); ';
      html += '  }';
      html += '}).catch(function(e) { ';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  var ed = document.createElement("div"); ';
      html += '  ed.style.color = "red"; ';
      html += '  ed.style.textAlign = "center"; ';
      html += '  ed.style.padding = "20px"; ';
      html += '  ed.style.gridColumn = "1/-1"; ';
      html += '  ed.textContent = "Сеть: " + e.message; ';
      html += '  g.appendChild(ed); ';
      html += '});';

      html += 'function onSearchInput() {';
      html += '  var val = document.getElementById("search").value;';
      html += '  var btn = document.getElementById("clearSearch");';
      html += '  if (val.length > 0) { btn.style.display = "block"; }';
      html += '  else { btn.style.display = "none"; }';
      html += '  filterItems();';
      html += '}';
      html += 'function clearSearchText() {';
      html += '  document.getElementById("search").value = "";';
      html += '  document.getElementById("clearSearch").style.display = ';
      html += '  "none";';
      html += '  filterItems();';
      html += '}';

      html += 'function toggleBouquetsMode() {';
      html += '  bouquetsMode = !bouquetsMode;';
      html += '  var bqBtn = document.getElementById("cat-bouquets");';
      html += '  var allBtns = document.querySelectorAll(".cat-btn");';
      html += '  if (bouquetsMode) {';
      html += '    allBtns.forEach(function(el) { ';
      html += '      el.classList.remove("active"); });';
      html += '    bqBtn.classList.add("active"); currentCat = -1;';
      html += '    document.getElementById("search").value = ""; ';
      html += '    document.getElementById("clearSearch")';
      html += '    .style.display = "none";';
      html += '    loadBouquets();';
      html += '  } else {';
      html += '    bqBtn.classList.remove("active"); currentCat = 0;';
      html += '    document.getElementById("cat-0").classList.add("active"); ';
      html += '    filterItems();';
      html += '  }';
      html += '}';

      html += 'function loadBouquets() {';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  while(g.firstChild) g.removeChild(g.firstChild);';
      html += '  var ld = document.createElement("div"); ';
      html += '  ld.style = "grid-column:1/-1; text-align:center; ';
      html += '  padding:20px; color:#888;"; ld.innerText = "Загрузка...";';
      html += '  g.appendChild(ld);';
      html += '  fetch("/api/warehouse/bouquets")';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { ';
      html += '      while(g.firstChild) g.removeChild(g.firstChild);';
      html += '      var er = document.createElement("div"); ';
      html += '      er.style = "grid-column:1/-1; text-align:center; ';
      html += '      padding:20px; color:red;"; er.innerText = "Ошибка";';
      html += '      g.appendChild(er); return; }';
      html += '    bouquetsList = d.bouquets; renderBouquets(bouquetsList);';
      html += '  }).catch(function() {});';
      html += '}';

      html += 'function renderBouquets(list) {';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  while(g.firstChild) g.removeChild(g.firstChild);';
      html += '  if (list.length === 0) {';
      html += '    var em = document.createElement("div"); ';
      html += '    em.style = "grid-column:1/-1; text-align:center; ';
      html += '    padding:20px; color:#888;";';
      html += '    em.innerText = "Нет связанных букетов"; ';
      html += '    g.appendChild(em); return;';
      html += '  }';
      html += '  list.forEach(function(b) {';
      html += '    var d = document.createElement("div"); ';
      html += '    d.className = "card bouquet";';
      html += '    if (b.photo_url) { ';
      html += '      var img = document.createElement("img"); ';
      html += '      img.src = b.photo_url; d.appendChild(img); } ';
      html += '    else { ';
      html += '      var ph = document.createElement("div"); ';
      html += '      ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '      d.appendChild(ph); }';
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "name"; nm.textContent = b.name; ';
      html += '    d.appendChild(nm);';
      html += '    var tag = document.createElement("div"); ';
      html += '    tag.className = "bouquet-tag";';
      html += '    var ok = b.all_in_stock !== false;';
      html += '    tag.textContent = ok ? "✓ в наличии" : "⚠ нет ингр.";';
      html += '    if (!ok) tag.style.color = "red";';
      html += '    d.appendChild(tag);';
      html += '    d.onclick = function() { addBouquetToCart(b); };';
      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function addBouquetToCart(b) {';
      html += '  fetch("/api/warehouse/bouquet/expand", { ';
      html += '  method: "POST", headers: { "Content-Type": ';
      html += '  "application/json" }, body: JSON.stringify({ ';
      html += '  bouquet_id: b.id }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { showAlert("Ошибка", d.error || ';
      html += '    "Не удалось", false); return; }';
      html += '    var items = d.ingredients || [];';
      html += '    items.forEach(function(it) {';
      html += '      var ex = cart.find(function(c) { ';
      html += '        return c.id === it.shop_item_id; });';
      html += '      if (ex) { ex.qty += it.qty; }';
      html += '      else { cart.push({ id: it.shop_item_id, ';
      html += '      name: it.name, qty: it.qty, ';
      html += '      retail: it.retail_price || 0 }); }';
      html += '    });';
      html += '    recalculateTotals(); openSheet();';
      html += '  }).catch(function() { showAlert("Ошибка сети", ';
      html += '  "Проверьте интернет", false); });';
      html += '}';

      html += 'function setCat(id) {';
      html += '  bouquetsMode = false; ';
      html += '  document.getElementById("cat-bouquets")';
      html += '  .classList.remove("active");';
      html += '  currentCat = id;';
      html += '  var els = document.querySelectorAll(".cat-btn"); ';
      html += '  els.forEach(function(el) { el.classList.remove("active"); });';
      html += '  document.getElementById("cat-" + id)';
      html += '  .classList.add("active");';
      html += '  filterItems();';
      html += '}';

      html += 'function render() { filterItems(); renderBasket(); }';

      html += 'function filterItems() {';
      html += '  if (bouquetsMode) { renderBouquets(bouquetsList); return; }';
      html += '  var q = document.getElementById("search")';
      html += '  .value.toLowerCase();';
      html += '  var items = allItems.filter(function(i) {';
      html += '    var matchQ = i.name.toLowerCase().includes(q);';
      html += '    var matchC = (currentCat === 0 || ';
      html += '    i.category_id === currentCat);';
      html += '    return matchQ && matchC; });';
      html += '  drawCards(items);';
      html += '}';

      html += 'function drawCards(items) {';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  while(g.firstChild) g.removeChild(g.firstChild);';
      html += '  items.forEach(function(item) {';
      html += '    var d = document.createElement("div");';
      html += '    d.className = item.is_pinned ? "card pinned" : "card";';
      html += '    if (item.is_pinned) {';
      html += '      var pin = document.createElement("div"); ';
      html += '      pin.className = "pin-badge"; pin.innerText = "★";';
      html += '      d.appendChild(pin);';
      html += '    }';
      html += '    if (item.photo_url) { ';
      html += '      var img = document.createElement("img"); ';
      html += '      img.src = item.photo_url; d.appendChild(img); } ';
      html += '    else { ';
      html += '      var ph = document.createElement("div"); ';
      html += '      ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '      d.appendChild(ph); }';
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "name"; nm.textContent = item.name; ';
      html += '    d.appendChild(nm);';
      html += '    var st = document.createElement("div"); ';
      html += '    var stockVal = parseFloat(item.current_stock) || 0;';
      html += '    st.className = "stock " + (stockVal > 0 ? "green" : "red");';
      html += '    st.textContent = "Ост: " + fmtNum(stockVal) ';
      html += '    + " " + (item.unit || "шт");';
      html += '    d.appendChild(st);';
      html += '    d.onclick = function() { addToCart(item); };';
      html += '    var pressTimer;';
      html += '    d.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { ';
      html += '        togglePin(item); }, 600);';
      html += '    });';
      html += '    d.addEventListener("touchend", function() { ';
      html += '      clearTimeout(pressTimer); });';
      html += '    d.addEventListener("touchmove", function() { ';
      html += '      clearTimeout(pressTimer); });';
      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function togglePin(item) {';
      html += '  var newVal = !item.is_pinned;';
      html += '  fetch("/api/warehouse/item/pin", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ id: item.id, val: newVal }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      item.is_pinned = newVal;';
      html += '      showAlert("Готово", newVal ? "Закреплено" : ';
      html += '      "Откреплено", true);';
      html += '      allItems.sort(function(a,b){ ';
      html += '        if(a.is_pinned && !b.is_pinned) return -1; ';
      html += '        if(!a.is_pinned && b.is_pinned) return 1; ';
      html += '        return 0; });';
      html += '      filterItems();';
      html += '    }';
      html += '  }).catch(function(){});';
      html += '}';

      html += 'function addToCart(item) {';
      html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
      html += '  if (ex) ex.qty += 1; ';
      html += '  else cart.push({ id: item.id, name: item.name, qty: 1, ';
      html += '  retail: item.retail_price || 0 });';
      html += '  recalculateTotals();';
      html += '}';

      html += 'function recalculateTotals() { ';
      html += 'currentIdempotencyKey = null; ';
      html += 'saveCart(); renderBasket(); }';

      html += 'function clearCartAndPayments() { ';
      html += 'cart = []; payments = []; isPayAmountEdited = false; ';
      html += 'isTotalPriceEdited = false; currentIdempotencyKey = null; ';
      html += 'saveCart(); renderBasket(); }';

      html += 'function saveCart() {';
      html += '  localStorage.setItem("wh_cart_kupidon", ';
      html += '  JSON.stringify(cart));';
      html += '}';
      html += 'function loadCart() {';
      html += '  var c = localStorage.getItem("wh_cart_kupidon");';
      html += '  if (c) { try { cart = JSON.parse(c); } ';
      html += '  catch(e) { cart = []; } }';
      html += '}';

      html += 'var startX = 0; var isSwiping = false;';
      html += 'var cartList = document.getElementById("bList");';
      
      html += 'cartList.addEventListener("touchstart", function(e) {';
      html += '  if (payments.length > 0) return;';
      html += '  startX = e.touches[0].clientX; isSwiping = true;';
      html += '  cartList.style.transition = "none";';
      html += '});';
      
      html += 'cartList.addEventListener("touchmove", function(e) {';
      html += '  if (!isSwiping) return;';
      html += '  var diff = e.touches[0].clientX - startX;';
      html += '  if (diff < 0) {';
      html += '    if (diff < -150) diff = -150;';
      html += '    cartList.style.transform = "translateX(" + diff + "px)";';
      html += '    cartList.style.background = "rgba(217, 83, 79, " + ';
      html += '    (Math.abs(diff)/150) + ")";';
      html += '    cartList.style.borderRadius = "12px";';
      html += '  }';
      html += '});';
      
      html += 'cartList.addEventListener("touchend", function(e) {';
      html += '  if (!isSwiping) return; isSwiping = false;';
      html += '  var diff = e.changedTouches[0].clientX - startX;';
      html += '  cartList.style.transition = ';
      html += '  "transform 0.3s, background 0.3s";';
      html += '  if (diff < -100) {';
      html += '    cartList.style.transform = "translateX(-100%)";';
      html += '    setTimeout(function() { ';
      html += '      clearCartAndPayments(); ';
      html += '      cartList.style.transform = "translateX(0)"; ';
      html += '      cartList.style.background = "transparent"; }, 300);';
      html += '  } else {';
      html += '    cartList.style.transform = "translateX(0)";';
      html += '    cartList.style.background = "transparent";';
      html += '  }';
      html += '});';

      html += 'var fc = document.getElementById("floatingCart");';
      html += 'fc.addEventListener("touchstart", function(e) { ';
      html += '  startX = e.touches[0].clientX; });';
      html += 'fc.addEventListener("touchend", function(e) {';
      html += '  var diff = e.changedTouches[0].clientX - startX;';
      html += '  if (diff > -30 && diff < 30) { openSheet(); }';
      html += '});';

      html += 'loadCart();';

      html += 'function openSheet() {';
      html += '  document.getElementById("sheetOverlay")';
      html += '  .classList.add("open");';
      html += '  document.getElementById("bottomSheet")';
      html += '  .classList.add("open");';
      html += '}';
      html += 'function closeSheet() {';
      html += '  document.getElementById("sheetOverlay")';
      html += '  .classList.remove("open");';
      html += '  document.getElementById("bottomSheet")';
      html += '  .classList.remove("open");';
      html += '}';

      html += 'function renderBasket() {';
      html += '  var b = document.getElementById("bList");';
      html += '  var fc = document.getElementById("floatingCart");';
      html += '  if (cart.length === 0) { ';
      html += '    fc.classList.remove("show"); ';
      html += '    while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '    payments = []; isPayAmountEdited = false; ';
      html += '    isTotalPriceEdited = false;';
      html += '    document.getElementById("totalPrice").value = "0";';
      html += '    document.getElementById("payAmount").value = "";';
      html += '    renderPayments(); return; ';
      html += '  }';
      
      html += '  fc.classList.add("show"); ';
      html += '  while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '  var total = 0; var count = 0;';
      html += '  cart.forEach(function(item, idx) {';
      html += '    var q = parseFloat(String(item.qty).replace(",", ".")) || 0;';
      html += '    var r = parseFloat(String(item.retail).replace(",", ".")) || 0;';
      html += '    total += (r * q); count += q;';
      
      html += '    var div = document.createElement("div"); ';
      html += '    div.className = "b-row";';
      
      html += '    var name = document.createElement("div"); ';
      html += '    name.className = "b-name";';
      html += '    name.textContent = item.name; ';
      
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.className = "b-ctrl";';
      
      html += '    var mn = document.createElement("button"); ';
      html += '    mn.innerText = "-"; mn.className = "qty-btn";';
      html += '    mn.onclick = function() { changeQty(idx, -1); };';
      
      html += '    var vl = document.createElement("input"); ';
      html += '    vl.type = "number"; vl.className = "qty-input"; ';
      html += '    vl.value = item.qty; vl.readOnly = true; ';
      html += '    vl.id = "qty_" + idx;';
      html += '    vl.style = "width:30px; height:26px; text-align:center; ';
      html += '    border:none; background:#F0F4F4; border-radius:6px; ';
      html += '    font-weight:bold; padding:0; margin:0; font-size:12px;";';
      html += '    vl.onclick = function() { setActiveInput(this.id); };';
      
      html += '    var pl = document.createElement("button"); ';
      html += '    pl.innerText = "+"; pl.className = "qty-btn";';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      
      html += '    ctrl.appendChild(mn); ctrl.appendChild(vl); ';
      html += '    ctrl.appendChild(pl);';
      
      html += '    var del = document.createElement("span"); ';
      html += '    del.innerText = "✕"; del.className = "b-del";';
      
      html += '    del.onclick = function() { ';
      html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
      html += '      function() { ';
      html += '        cart.splice(idx, 1); recalculateTotals(); ';
      html += '      }, true); ';
      html += '    };';
      
      html += '    div.appendChild(name); div.appendChild(ctrl); ';
      html += '    div.appendChild(del); b.appendChild(div);';
      html += '  });';
      
      html += '  if (!isTotalPriceEdited) { ';
      html += '    document.getElementById("totalPrice").value = total; ';
      html += '  }';
      
      html += '  var displayTotal = parseFloat(';
      html += '  document.getElementById("totalPrice").value) || 0;';
      html += '  if (!isPayAmountEdited && payments.length === 0) { ';
      html += '    document.getElementById("payAmount").value = displayTotal; ';
      html += '  } else if (payments.length > 0) { ';
      html += '    var paid = 0; ';
      html += '    payments.forEach(function(p) { paid += p.amount; }); ';
      html += '    var rem = displayTotal - paid; ';
      html += '    if (rem > 0 && !isPayAmountEdited) { ';
      html += '      document.getElementById("payAmount").value = rem; ';
      html += '    } ';
      html += '  }';
      
      html += '  document.getElementById("fcCount").innerText = ';
      html += '  count + " товар(ов)";';
      html += '  document.getElementById("fcTotal").innerText = total + " ₽";';
      html += '  renderPayments();';
      html += '}';

      // ИСПРАВЛЕННЫЙ changeQty (защита от отрицательного количества)
      html += 'function changeQty(idx, delta) {';
      html += '  var cur = parseFloat(String(cart[idx].qty) || "0");';
      html += '  var nextQty = cur + delta;';
      html += '  if (nextQty <= 0) {';
      html += '    showConfirm("Удаление", "Убрать товар?", function() {';
      html += '      cart.splice(idx, 1); recalculateTotals();';
      html += '    }, true);';
      html += '  } else { ';
      html += '    cart[idx].qty = nextQty; ';
      html += '    recalculateTotals(); ';
      html += '  }';
      html += '}';

      html += 'function setPay(method) {';
      html += '  payMethod = method;';
      html += '  var els = document.querySelectorAll(".pay-btn"); ';
      html += '  els.forEach(function(b) { b.classList.remove("active"); });';
      html += '  var btn = document.getElementById("btn-" + method);';
      html += '  if (btn) btn.classList.add("active");';
      html += '}';

      html += 'function setActiveInput(id) {';
      html += '  if (activeInputId !== id) { isFirstInput = true; }';
      html += '  activeInputId = id;';
      html += '  var allInps = document.querySelectorAll(';
      html += '  ".total-inp, .qty-input, .pay-input-row input");';
      html += '  allInps.forEach(function(el) { ';
      html += '    el.classList.remove("input-active"); });';
      html += '  var el = document.getElementById(id);';
      html += '  if (el) { ';
      html += '    el.classList.add("input-active"); ';
      html += '    el.value = ""; ';
      html += '    isFirstInput = false; ';
      html += '  }';
      html += '  if (id === "payAmount") { isPayAmountEdited = true; }';
      html += '  if (id === "totalPrice") { isTotalPriceEdited = true; }';
      html += '}';

      html += 'function num(v) {';
      html += '  var inp = document.getElementById(activeInputId);';
      html += '  if (!inp) return;';
      html += '  if (v === "C") { inp.value = ""; isFirstInput = false; }';
      html += '  else if (v === "X") { ';
      html += '    inp.value = inp.value.slice(0, -1); ';
      html += '    isFirstInput = false; }';
      html += '  else {';
      html += '    if (isFirstInput) { inp.value = ""; isFirstInput = false; }';
      html += '    inp.value += v;';
      html += '  }';
      html += '  if (activeInputId === "payAmount") { ';
      html += '    isPayAmountEdited = true; ';
      html += '    renderPayments(); }';
      
      html += '  if (activeInputId === "totalPrice") { ';
      html += '    isTotalPriceEdited = true; ';
      html += '    var nt = parseFloat(inp.value) || 0; ';
      html += '    if (!isPayAmountEdited) { ';
      html += '      var paid = 0; ';
      html += '      payments.forEach(function(p) { paid += p.amount; }); ';
      html += '      var rem = nt - paid; ';
      html += '      document.getElementById("payAmount").value = ';
      html += '      rem > 0 ? rem : ""; ';
      html += '    } ';
      html += '    renderPayments(); ';
      html += '  }';
      
      // ИСПРАВЛЕННЫЙ ВВОД КОЛИЧЕСТВА (защита от 0)
      html += '  if (activeInputId.indexOf("qty_") === 0) {';
      html += '    var idx = parseInt(activeInputId.replace("qty_", ""));';
      html += '    var newQty = parseFloat(inp.value);';
      html += '    if (isNaN(newQty) || newQty <= 0) { ';
      html += '      showConfirm("Удаление", "Убрать товар?", function() {';
      html += '        cart.splice(idx, 1); recalculateTotals();';
      html += '      }, true);';
      html += '    } else {';
      html += '      cart[idx].qty = newQty; saveCart();';
      html += '      renderBasket();';
      html += '    }';
      html += '  }';
      html += '}';

      html += 'function addPayment() {';
      html += '  if (!payMethod) { ';
      html += '    showAlert("Внимание", "Выберите способ оплаты", false); ';
      html += '    return; }';
      html += '  var val = parseFloat(';
      html += '  document.getElementById("payAmount").value);';
      html += '  if (!val || val <= 0) { ';
      html += '    showAlert("Внимание", "Введите сумму", false); return; }';
      html += '  payments.push({ method: payMethod, amount: val });';
      html += '  document.getElementById("payAmount").value = "";';
      html += '  isPayAmountEdited = false;';
      html += '  setPay(""); ';
      html += '  renderBasket();';
      html += '}';

      html += 'function renderPayments() {';
      html += '  var total = parseFloat(';
      html += '  document.getElementById("totalPrice").value) || 0;';
      html += '  var paid = 0; ';
      html += '  var pl = document.getElementById("payList"); ';
      html += '  while(pl.firstChild) pl.removeChild(pl.firstChild);';
      html += '  payments.forEach(function(p, i) {';
      html += '    paid += p.amount;';
      html += '    var mn = p.method === "cash" ? "Нал" : ';
      html += '    (p.method === "card" ? "Карта" : "QR");';
      html += '    var row = document.createElement("div");';
      html += '    row.style = "display:flex; justify-content:space-between; ';
      html += '    align-items:center; color:var(--f-success); ';
      html += '    font-weight:bold; margin-bottom:6px;";';
      html += '    var txt = document.createElement("span"); ';
      html += '    txt.textContent = mn + " " + p.amount + " ₽";';
      html += '    var delBtn = document.createElement("span"); ';
      html += '    delBtn.textContent = " ✕";';
      html += '    delBtn.style = "color:red; cursor:pointer; ';
      html += '    font-size:16px; margin-left:10px;";';
      html += '    delBtn.onclick = function() { ';
      html += '      payments.splice(i, 1); ';
      html += '      isPayAmountEdited = false; ';
      html += '      renderBasket(); };';
      html += '    row.appendChild(txt); row.appendChild(delBtn); ';
      html += '    pl.appendChild(row);';
      html += '  });';
      html += '  var typed = parseFloat(';
      html += '  document.getElementById("payAmount").value) || 0;';
      html += '  var remain = total - paid;';
      html += '  var rTxt = document.getElementById("remainTxt"); ';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  if (total <= 0) { ';
      html += '    rTxt.innerText = "Укажите сумму"; ';
      html += '    rTxt.style.color = "var(--f-danger)"; ';
      html += '    btn.classList.remove("ready"); return; }';
      html += '  if (remain > 0) { ';
      html += '    rTxt.innerText = "Осталось: " + remain + " ₽"; ';
      html += '    rTxt.style.color = "var(--f-danger)"; ';
      html += '    btn.classList.remove("ready"); ';
      html += '  } else if (remain === 0) {';
      html += '    if (payments.length === 0 && typed > 0) { ';
      html += '      rTxt.innerText = "Нажмите Внести"; ';
      html += '      rTxt.style.color = "var(--f-accent)"; ';
      html += '      btn.classList.remove("ready"); ';
      html += '    } else { ';
      html += '      rTxt.innerText = "Оплачено"; ';
      html += '      rTxt.style.color = "var(--f-success)"; ';
      html += '      btn.classList.add("ready"); }';
      html += '  } else { ';
      html += '    rTxt.innerText = "Сдача: " + Math.abs(remain) + " ₽"; ';
      html += '    rTxt.style.color = "#3C7A89"; ';
      html += '    btn.classList.add("ready"); }';
      html += '}';

      html += 'function setPrecheckChangeMethod(m) { ';
      html += 'precheckChangeMethod = m; ';
      html += 'var els = document.querySelectorAll(".pay-btn"); ';
      html += 'els.forEach(function(el) { el.classList.remove("active"); });';
      html += 'document.getElementById("pcm-" + m).classList.add("active"); }';

      html += 'function openPrecheck() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  if (!btn.classList.contains("ready")) { ';
      html += '    showAlert("Внимание", "Оплата не завершена", false); ';
      html += '    return; }';
      html += '  var totalCheck = parseFloat(';
      html += '  document.getElementById("totalPrice").value) || 0;';
      html += '  if (totalCheck <= 0) { ';
      html += '    showAlert("Ошибка", "Сумма чека должна быть > 0", false); ';
      html += '    return; }';
      html += '  if (!currentIdempotencyKey) {';
      html += '    currentIdempotencyKey = Math.random().toString(36)';
      html += '    .substring(2) + Date.now().toString(36);';
      html += '  }';
      html += '  var total = parseFloat(';
      html += '  document.getElementById("totalPrice").value);';
      html += '  var typed = parseFloat(';
      html += '  document.getElementById("payAmount").value) || 0;';
      html += '  if (typed > 0) { ';
      html += '    if (!payMethod) { ';
      html += '      showAlert("Внимание", "Выберите способ", false); ';
      html += '      return; }';
      html += '    payments.push({ method: payMethod, amount: typed }); ';
      html += '    document.getElementById("payAmount").value = ""; ';
      html += '    renderPayments(); }';
      html += '  var list = document.getElementById("precheckList"); ';
      html += '  while(list.firstChild) list.removeChild(list.firstChild);';
      html += '  cart.forEach(function(item) {';
      html += '    var row = document.createElement("div");';
      html += '    row.style = "display:flex; justify-content:space-between; ';
      html += '    margin-bottom:6px; font-size:14px;";';
      html += '    var n = document.createElement("span"); ';
      html += '    n.textContent = item.name + " x" + fmtNum(item.qty);';
      html += '    var p = document.createElement("span"); ';
      html += '    p.textContent = (item.retail * item.qty) + " ₽";';
      html += '    row.appendChild(n); row.appendChild(p); ';
      html += '    list.appendChild(row);';
      html += '  });';
      html += '  if (payments.length > 0) {';
      html += '    var hr = document.createElement("hr");';
      html += '    hr.style = "border:none; border-top:1px dashed #ccc; ';
      html += '    margin: 10px 0;";';
      html += '    list.appendChild(hr);';
      html += '    payments.forEach(function(p) {';
      html += '      var mn = p.method === "cash" ? "Наличные" : ';
      html += '      (p.method === "card" ? "Карта" : "QR");';
      html += '      var pr = document.createElement("div");';
      html += '      pr.style = "display:flex; justify-content:space-between; ';
      html += '      font-size:13px; color:#666; margin-bottom:4px;";';
      html += '      var n = document.createElement("span"); ';
      html += '      n.textContent = mn;';
      html += '      var v = document.createElement("span"); ';
      html += '      v.textContent = p.amount + " ₽";';
      html += '      pr.appendChild(n); pr.appendChild(v);';
      html += '      list.appendChild(pr);';
      html += '    });';
      html += '  }';
      html += '  var paid = 0; ';
      html += '  payments.forEach(function(p) { paid += p.amount; });';
      html += '  var change = paid - total;';
      html += '  var changeBlock = document.getElementById(';
      html += '  "precheckChangeBlock");';
      html += '  if (change > 0) { ';
      html += '    changeBlock.style.display = "block"; ';
      html += '    document.getElementById("precheckChangeAmt")';
      html += '    .innerText = change + " ₽"; ';
      html += '    precheckChangeMethod = "cash"; ';
      html += '    setPrecheckChangeMethod("cash"); ';
      html += '  } else { changeBlock.style.display = "none"; }';
      html += '  document.getElementById("precheckTotal")';
      html += '  .innerText = total + " ₽";';
      html += '  document.getElementById("precheckModal")';
      html += '  .style.display = "flex";';
      html += '}';
      
      html += 'function closePrecheck() { ';
      html += 'document.getElementById("precheckModal")';
      html += '.style.display = "none"; }';

      html += 'function saveSale() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  if (btn.disabled) return;';
      html += '  btn.disabled = true; btn.innerText = "Отправка...";';
      html += '  var total = parseFloat(';
      html += '  document.getElementById("totalPrice").value);';
      html += '  var paid = 0; ';
      html += '  payments.forEach(function(p) { paid += p.amount; });';
      html += '  var change = paid - total; ';
      html += '  var finalPayments = JSON.parse(JSON.stringify(payments));';
      html += '  if (change > 0) {';
      html += '    var remChange = change;';
      html += '    for (var i = 0; i < finalPayments.length; i++) {';
      html += '      var p = finalPayments[i];';
      html += '      if (p.method === precheckChangeMethod) {';
      html += '        if (p.amount >= remChange) { ';
      html += '          p.amount -= remChange; remChange = 0; break; }';
      html += '        else { remChange -= p.amount; p.amount = 0; }';
      html += '      }';
      html += '    }';
      html += '    if (remChange > 0) {';
      html += '      finalPayments.push({ method: precheckChangeMethod, ';
      html += '      amount: -remChange });';
      html += '    }';
      html += '  }';
      html += '  finalPayments = finalPayments.filter(function(p) { ';
      html += '    return p.amount !== 0; });';
      html += '  var payload = { real_price: total, ';
      html += '  payments: finalPayments, items: cart, ';
      html += '  idempotency_key: currentIdempotencyKey };';
      html += '  fetch("/api/warehouse/sale", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify(payload) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      localStorage.removeItem("wh_cart_kupidon");';
      html += '      var cBlock = document.getElementById("changeBlock");';
      html += '      if (change > 0) { ';
      html += '        document.getElementById("changeAmount")';
      html += '        .innerText = change + " ₽"; ';
      html += '        cBlock.style.display = "block"; }';
      html += '      else { cBlock.style.display = "none"; }';
      html += '      document.getElementById("precheckModal")';
      html += '      .style.display = "none";';
      html += '      document.getElementById("successModal")';
      html += '      .style.display = "flex";';
      html += '      cart = []; payments = []; currentIdempotencyKey = null;';
      html += '    } else { ';
      html += '      btn.disabled = false; btn.innerText = "Принять"; ';
      html += '      showAlert("Ошибка", d.error || "unknown", false); }';
      html += '  }).catch(function(err) { ';
      html += '    btn.disabled = false; btn.innerText = "Принять"; ';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false); });';
      html += '}';

      html += 'function closeSuccess() { window.location.reload(); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) {
      console.error('Sale page error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 6. ЭКРАН СПИСКА НАКЛАДНЫХ (ПРИХОДЫ) ======
  app.get('/warehouse/receipts', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.btn-new { display: flex; align-items: center; ';
      html += 'justify-content: center; width: 100%; padding: 16px; ';
      html += 'background: var(--f-brand); color: #fff; ';
      html += 'text-decoration: none; border-radius: var(--r-md); ';
      html += 'font-size: 16px; font-weight: 800; margin-bottom: 20px; ';
      html += 'box-sizing: border-box; ';
      html += 'box-shadow: 0 4px 12px rgba(6,76,73,0.2); }';
      
      html += '.doc { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 12px; text-decoration: none; ';
      html += 'color: var(--f-text); display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-1); border-left: 4px solid transparent; }';
      html += '.doc.completed { border-left-color: var(--f-success); }';
      html += '.doc.draft { border-left-color: var(--f-warn); }';
      
      html += '.doc-left { display: flex; flex-direction: column; gap: 4px; }';
      html += '.doc-title { font-weight: 700; font-size: 16px; }';
      html += '.meta { font-size: 13px; color: var(--f-text-2); }';
      html += '.meta-edited { font-size: 12px; color: var(--f-accent); ';
      html += 'font-weight: 600; margin-top: 2px; }';
      html += '.amount { font-weight: 800; font-size: 18px; text-align: right; }';
      
      html += '.del-btn { font-size: 20px; color: var(--f-danger); ';
      html += 'margin-left: 12px; cursor: pointer; padding: 8px; }';
      
      html += '#docPreviewModal .custom-modal { ';
      html += 'text-align: left; padding: 24px; }';
      html += '.dp-row { display: flex; justify-content: space-between; ';
      html += 'margin-bottom: 8px; font-size: 14px; }';
      html += '.dp-total { font-weight: 800; font-size: 18px; ';
      html += 'margin-top: 12px; text-align: right; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Приходы</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<a href="/warehouse/receipt/new" class="btn-new">';
      html += '+ Создать накладную</a>';
      html += '<div id="list">Загрузка...</div>';

      html += '<div class="custom-modal-overlay" id="docPreviewModal">';
      html += '<div class="custom-modal">';
      html += '<h3 id="docPreviewTitle" style="margin:0 0 16px 0; ';
      html += 'text-align:center;">Загрузка...</h3>';
      html += '<div id="docPreviewList" style="max-height:50vh; ';
      html += 'overflow-y:auto; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:12px 0;"></div>';
      html += '<div id="docPreviewTotal" class="dp-total"></div>';
      html += '<button class="btn-cancel" style="margin-top:16px; ';
      html += 'width:100%; padding:14px; border:none; border-radius:12px; ';
      html += 'font-weight:700; background:#F0F4F4; color:var(--f-text);" ';
      html += 'onclick="closeDocPreview()">Закрыть</button>';
      html += '</div></div>';

      html += getUnifiedMenu('receipts');

      html += '<script>';
      html += 'fetch("/api/warehouse/receipts")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) {';
      html += '  var b = document.getElementById("list");';
      html += '  while(b.firstChild) b.removeChild(b.firstChild);';
      html += '  if (!d.ok) { b.textContent = "Ошибка API"; return; }';
      html += '  if (!d.docs || d.docs.length === 0) {';
      html += '    var empty = document.createElement("div");';
      html += '    empty.className = "empty-state";';
      html += '    var emTitle = document.createElement("div");';
      html += '    emTitle.className = "empty-state-title";';
      html += '    emTitle.textContent = "Накладных нет";';
      html += '    empty.appendChild(emTitle);';
      html += '    b.appendChild(empty); return; }';

      html += '  d.docs.forEach(function(doc) {';
      html += '    var a = document.createElement("a");';
      html += '    var st = doc.status === "draft" ? "draft" : "completed";';
      html += '    a.className = "doc " + st;';
      html += '    if (st === "draft") {';
      html += '      a.href = "/warehouse/receipt/edit?id=" + doc.id;';
      html += '    } else {';
      html += '      a.href = "/warehouse/documents/details?id=" + ';
      html += 'doc.id + "&type=receipts";';
      html += '    }';
      html += '    var ds = new Date(doc.date).toLocaleString("ru-RU");';
      html += '    var author = doc.author || "Флорист";';
      html += '    var statusTxt = st === "draft" ? "Черновик" : "Накладная";';
      
      html += '    var left = document.createElement("div");';
      html += '    left.className = "doc-left";';
      html += '    var title = document.createElement("div");';
      html += '    title.className = "doc-title";';
      html += '    title.textContent = statusTxt + " №" + doc.id;';
      html += '    left.appendChild(title);';
      html += '    var meta = document.createElement("div");';
      html += '    meta.className = "meta";';
      html += '    meta.textContent = ds + " · " + author;';
      html += '    left.appendChild(meta);';
      
      html += '    if (doc.updated_at && doc.updated_at !== doc.date) {';
      html += '      var upd = new Date(doc.updated_at)';
      html += '      .toLocaleString("ru-RU");';
      html += '      var metaEd = document.createElement("div");';
      html += '      metaEd.className = "meta-edited";';
      html += '      metaEd.textContent = "Изменено: " + upd;';
      html += '      left.appendChild(metaEd);';
      html += '    }';
      
      html += '    var right = document.createElement("div");';
      html += '    right.style.display = "flex";';
      html += '    right.style.alignItems = "center";';
      html += '    var amt = document.createElement("div");';
      html += '    amt.className = "amount";';
      html += '    amt.textContent = parseFloat(doc.total_sum)';
      html += '.toLocaleString("ru-RU") + " ₽";';
      html += '    right.appendChild(amt);';
      
      html += '    if (st === "draft") {';
      html += '      var del = document.createElement("span");';
      html += '      del.className = "del-btn";';
      html += '      del.textContent = "🗑";';
      html += '      del.onclick = function(e) {';
      html += '        e.preventDefault(); e.stopPropagation();';
      html += '        deleteDraft(doc.id);';
      html += '      };';
      html += '      right.appendChild(del);';
      html += '    }';
      
      html += '    var pressTimer;';
      html += '    a.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { ';
      html += '        a.dataset.longpress = "true";';
      html += '        showDocPreview(doc.id);';
      html += '        if (navigator.vibrate) navigator.vibrate(50);';
      html += '      }, 600);';
      html += '    });';
      html += '    a.addEventListener("touchend", function() { ';
      html += '      clearTimeout(pressTimer);';
      html += '      if (a.dataset.longpress === "true") {';
      html += '        closeDocPreview();';
      html += '      }';
      html += '    });';
      html += '    a.addEventListener("touchmove", function() { ';
      html += '      clearTimeout(pressTimer); });';
      html += '    a.addEventListener("click", function(e) {';
      html += '      if (a.dataset.longpress === "true") {';
      html += '        e.preventDefault(); a.dataset.longpress = "false";';
      html += '      }';
      html += '    });';
      
      html += '    a.appendChild(left); a.appendChild(right);';
      html += '    b.appendChild(a);';
      html += '  });';
      html += '}).catch(function() {';
      html += '  document.getElementById("list").textContent = "Ошибка";';
      html += '});';

      html += 'function showDocPreview(id) {';
      html += '  var ov = document.getElementById("docPreviewModal");';
      html += '  var title = document.getElementById("docPreviewTitle");';
      html += '  var list = document.getElementById("docPreviewList");';
      html += '  var total = document.getElementById("docPreviewTotal");';
      html += '  title.textContent = "Загрузка...";';
      html += '  list.innerHTML = ""; total.textContent = "";';
      html += '  ov.style.display = "flex";';
      html += '  fetch("/api/warehouse/documents/details?id=" + id + ';
      html += '  "&type=receipts")';
      html += '  .then(function(r){return r.json();})';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { title.textContent = "Ошибка"; return; }';
      html += '    title.textContent = "Накладная №" + id;';
      html += '    d.items.forEach(function(i) {';
      html += '      var row = document.createElement("div");';
      html += '      row.className = "dp-row";';
      html += '      var n = document.createElement("div");';
      html += '      n.textContent = i.name;';
      html += '      var q = document.createElement("div");';
      html += '      q.style.fontWeight = "bold";';
      html += '      q.textContent = fmtNum(i.qty) + " шт";';
      html += '      row.appendChild(n); row.appendChild(q);';
      html += '      list.appendChild(row);';
      html += '    });';
      html += '    total.textContent = "Итого: " + ';
      html += '    parseFloat(d.header.total_sum).toLocaleString("ru-RU") + ';
      html += '    " ₽";';
      html += '  }).catch(function(){ title.textContent = "Ошибка сети"; });';
      html += '}';
      
      html += 'function closeDocPreview() {';
      html += '  document.getElementById("docPreviewModal").style.display = ';
      html += '  "none";';
      html += '}';

      html += 'function deleteDraft(id) {';
      html += '  showConfirm("Удаление", "Удалить черновик №" + id + "?", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/receipt/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: id }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { if(d.ok) { location.reload(); } ';
      html += '    else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function() {});';
      html += '  }, true);';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 7. СОЗДАНИЕ ЧЕРНОВИКА ======
  app.get('/warehouse/receipt/new', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const r = await pool.query(
        'INSERT INTO wh_receipts (shop_id, chat_id, status) ' +
        'VALUES ($1, $2, \'draft\') RETURNING id',
        [auth.shopId, auth.chatId]
      );
      res.redirect('/warehouse/receipt/edit?id=' + r.rows[0].id);
    } catch (e) { 
      res.status(500).send('Ошибка создания'); 
    }
  });

  // ====== 8. ЭКРАН РЕДАКТИРОВАНИЯ ЧЕРНОВИКА ======
  app.get('/warehouse/receipt/edit', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const rawId = req.query.id;
      const receiptId = parseInt(rawId);
      if (!receiptId || isNaN(receiptId)) {
        return res.status(400).send('Неверный ID накладной');
      }

      const checkR = await pool.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2', [receiptId, auth.shopId]
      );
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'draft') {
        return res.status(403).send('Накладная не найдена или уже проведена');
      }

      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; }';
      html += 'label { display: block; font-size: 13px; ';
      html += 'color: var(--f-text-2); margin-bottom: 6px; font-weight: 600; }';
      
      html += '.btn-add { width: 100%; background: var(--f-brand); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; ';
      html += 'margin-bottom: 20px; box-shadow: 0 4px 12px rgba(6,76,73,0.2); }';
      
      html += '.basket { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 16px; ';
      html += 'border: 2px solid var(--f-brand); display: none; }';
      
      html += '.b-row { display: flex; flex-direction: column; ';
      html += 'margin-bottom: 16px; padding-bottom: 16px; ';
      html += 'border-bottom: 1px solid var(--f-border); }';
      html += '.b-top { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 8px; font-weight: 700; }';
      html += '.b-controls { display: grid; ';
      html += 'grid-template-columns: 1fr 1fr 1fr; ';
      html += 'gap: 8px; align-items: end; }';
      html += '.b-controls label { font-size: 11px; margin-bottom: 4px; }';
      html += '.b-controls input { font-size: 14px; padding: 8px; ';
      html += 'text-align: center; margin-bottom: 0; }';
      
      html += '.btn-save { width: 100%; background: var(--f-success); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; }';
      html += '.img-preview { width: 80px; height: 80px; border-radius: 12px; ';
      html += 'object-fit: cover; display: none; margin-bottom: 12px; }';
      
      html += '.dropdown-wrap { position: relative; }';
      html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
      html += 'right: 0; background: #fff; border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); margin-top: -8px; z-index: 100; ';
      html += 'box-shadow: var(--sh-2); max-height: 220px; ';
      html += 'overflow-y: auto; display: none; }';
      html += '.dd-item { padding: 12px 16px; ';
      html += 'border-bottom: 1px solid var(--f-border); cursor: pointer; ';
      html += 'display: flex; justify-content: space-between; ';
      html += 'align-items: center; }';
      html += '.dd-item:last-child { border-bottom: none; }';
      html += '.dd-name { font-weight: 600; font-size: 14px; }';
      html += '.dd-stock { font-size: 12px; font-weight: 800; }';
      
      html += '.clear-search { position: absolute; right: 14px; top: 14px; ';
      html += 'font-size: 18px; color: #aaa; cursor: pointer; ';
      html += 'display: none; background: none; border: none; padding: 0; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse/receipts" class="back-btn">←</a>';
      html += '<h2 class="page-title">Накладная</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="card">';
      html += '<label>Название товара</label>';
      html += '<div class="dropdown-wrap">';
      html += '<input type="text" id="itemName" class="input-cap" ';
      html += 'oninput="onNameInput()" ';
      html += 'placeholder="Начните вводить..." autocomplete="off">';
      html += '<button class="clear-search" id="clearSearch" ';
      html += 'onclick="clearSearchText()">✕</button>';
      html += '<div class="dropdown-list" id="ddList"></div>';
      html += '</div>';

      html += '<label>Категория (для нового)</label>';
      html += '<select id="itemCategory" onchange="checkCat()"></select>';

      html += '<div id="unitBlock" style="display:none;">';
      html += '<label>Единица измерения</label>';
      html += '<select id="itemUnit">';
      html += '<option value="м">Метры (м)</option>';
      html += '<option value="уп">Упаковки (уп)</option>';
      html += '<option value="шт">Штуки (шт)</option>';
      html += '</select></div>';

      html += '<label>Фото товара (для нового)</label>';
      html += '<input type="file" id="itemPhoto" accept="image/*" ';
      html += 'onchange="previewPhoto()" style="margin-bottom:8px;">';
      html += '<img id="photoPreview" class="img-preview">';

      html += '<label>Количество</label>';
      html += '<input type="number" id="itemQty" step="0.1" ';
      html += 'inputmode="decimal">';
      html += '<label>Цена закупки</label>';
      html += '<input type="number" id="itemPrice" ';
      html += 'inputmode="decimal" oninput="calcCostDiff()">';
      html += '<div id="costDiff" class="hint-cost" ';
      html += 'style="font-size:12px; margin-top:-8px; margin-bottom:12px; ';
      html += 'font-weight:600;"></div>';

      html += '<label>Розничная цена (необязательно)</label>';
      html += '<input type="number" id="itemRetail" inputmode="decimal">';
      html += '</div>';

      html += '<button class="btn-add" id="btnAdd" ';
      html += 'onclick="addToBasket()">+ Добавить в накладную</button>';

      html += '<div class="basket" id="basket">';
      html += '<h3 style="margin-top:0; font-size:18px; font-weight:800; ';
      html += 'margin-bottom:16px;">В накладной:</h3>';
      html += '<div id="bList"></div>';
      html += '<div style="display:flex; justify-content:space-between; ';
      html += 'margin-top:16px; border-top:2px solid var(--f-brand); ';
      html += 'padding-top:12px; font-size:20px; font-weight:800;">';
      html += '<span>Итого:</span><span id="totalSum">0 ₽</span></div>';
      html += '<button class="btn-save" id="btnSaveReceipt" ';
      html += 'style="margin-top:20px;" ';
      html += 'onclick="saveReceipt()">Провести накладную</button>';
      html += '</div>';

      html += getUnifiedMenu('receipts');

      html += '<script>';
      html += 'var receiptId = ' + receiptId + ';';
      html += 'var currentLastCost = 0; var itemsCatalog = [];';
      html += 'var receiptItems = [];';

      html += 'function checkCat() {';
      html += '  var sel = document.getElementById("itemCategory");';
      html += '  var unitBlock = document.getElementById("unitBlock");';
      html += '  if (sel.selectedIndex === -1) return;';
      html += '  var catText = sel.options[sel.selectedIndex].text;';
      html += '  if (catText.includes("Упаковка")) {';
      html += '    unitBlock.style.display = "block";';
      html += '  } else { unitBlock.style.display = "none"; }';
      html += '}';

      html += 'function onNameInput() {';
      html += '  var val = document.getElementById("itemName").value;';
      html += '  var dd = document.getElementById("ddList");';
      html += '  var btn = document.getElementById("clearSearch");';
      html += '  while(dd.firstChild) dd.removeChild(dd.firstChild);';
      html += '  if (val.length > 0) { btn.style.display = "block"; }';
      html += '  else { btn.style.display = "none"; }';
      html += '  if (!val || val.length < 1) { ';
      html += '    dd.style.display = "none"; return; }';
      html += '  var found = itemsCatalog.filter(function(i) { ';
      html += '    return i.name.toLowerCase().includes(val.toLowerCase()); ';
      html += '  }).slice(0, 20);';
      html += '  if (found.length === 0) { ';
      html += '    dd.style.display = "none"; return; }';
      html += '  found.forEach(function(i) {';
      html += '    var row = document.createElement("div"); ';
      html += '    row.className = "dd-item";';
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "dd-name"; nm.textContent = i.name;';
      html += '    var st = document.createElement("div"); ';
      html += '    st.className = "dd-stock"; ';
      html += '    var s = parseFloat(i.current_stock) || 0;';
      html += '    st.textContent = fmtNum(s) + " " + (i.unit || "шт");';
      html += '    st.style.color = s > 0 ? "var(--f-success)" : ';
      html += '    "var(--f-danger)";';
      html += '    row.appendChild(nm); row.appendChild(st);';
      html += '    row.onclick = function() {';
      html += '      document.getElementById("itemName").value = i.name;';
      html += '      document.getElementById("itemRetail").value = ';
      html += '      i.retail_price || "";';
      html += '      currentLastCost = parseFloat(i.last_cost) || 0;';
      html += '      document.getElementById("clearSearch")';
      html += '      .style.display = "none";';
      html += '      dd.style.display = "none";';
      html += '      calcCostDiff();';
      html += '    };';
      html += '    dd.appendChild(row);';
      html += '  });';
      html += '  dd.style.display = "block";';
      html += '}';

      html += 'function clearSearchText() {';
      html += '  document.getElementById("itemName").value = "";';
      html += '  document.getElementById("clearSearch").style.display = ';
      html += '  "none";';
      html += '  document.getElementById("ddList").style.display = "none";';
      html += '}';

      html += 'document.addEventListener("click", function(e) {';
      html += '  var dd = document.getElementById("ddList");';
      html += '  var inp = document.getElementById("itemName");';
      html += '  if (dd && inp && e.target !== dd && ';
      html += '  e.target !== inp && !dd.contains(e.target)) {';
      html += '    dd.style.display = "none";';
      html += '  }';
      html += '});';

      html += 'function calcCostDiff() {';
      html += '  var hint = document.getElementById("costDiff"); ';
      html += '  hint.innerText = "";';
      html += '  var priceStr = document.getElementById("itemPrice").value;';
      html += '  if (!priceStr) return;';
      html += '  var currentPrice = parseFloat(priceStr.replace(",", "."));';
      html += '  if (currentLastCost > 0 && currentPrice > 0) {';
      html += '    var diff = currentPrice - currentLastCost;';
      html += '    var sign = diff > 0 ? "+" : "";';
      html += '    var color = diff > 0 ? "var(--f-danger)" : ';
      html += '    "var(--f-success)";';
      html += '    hint.innerText = "Прошлая закупка: " + currentLastCost + ';
      html += '    " ₽ (" + sign + diff + " ₽)";';
      html += '    hint.style.color = color;';
      html += '  }';
      html += '}';

      html += 'function previewPhoto() {';
      html += '  var f = document.getElementById("itemPhoto").files[0];';
      html += '  if (!f) return;';
      html += '  var rd = new FileReader();';
      html += '  rd.onload = function(e) {';
      html += '    var img = document.getElementById("photoPreview");';
      html += '    img.src = e.target.result; ';
      html += '    img.style.display = "block";';
      html += '  };';
      html += '  rd.readAsDataURL(f);';
      html += '}';

      html += 'fetch("/api/warehouse/categories")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { if (d.ok && d.categories) {';
      html += '  var sel = document.getElementById("itemCategory");';
      html += '  d.categories.forEach(function(c) {';
      html += '    var opt = document.createElement("option");';
      html += '    opt.value = c.id; opt.innerText = c.name;';
      html += '    sel.appendChild(opt);';
      html += '  });';
      html += '  checkCat(); ';
      html += '} else {';
      html += '  var selErr = document.getElementById("itemCategory");';
      html += '  var optErr = document.createElement("option");';
      html += '  optErr.value = ""; optErr.innerText = "Ошибка загрузки";';
      html += '  selErr.appendChild(optErr);';
      html += '} }).catch(function() {});';

      html += 'fetch("/api/warehouse/items")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { if (d.ok) { ';
      html += '  itemsCatalog = d.items;';
      html += '} }).catch(function() {});';

      html += 'fetch("/api/warehouse/receipt/items?id=" + receiptId)';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { if (d.ok) { ';
      html += '  receiptItems = d.items; renderList(); } })';
      html += '.catch(function() {});';
      html += 'function addToBasket() {';
      html += '  var name = document.getElementById("itemName").value;';
      html += '  var qty = document.getElementById("itemQty").value';
      html += '  .replace(",", ".");';
      html += '  var price = document.getElementById("itemPrice").value';
      html += '  .replace(",", ".");';
      html += '  var retail = document.getElementById("itemRetail").value';
      html += '  .replace(",", ".") || 0;';
      html += '  var catId = document.getElementById("itemCategory").value;';
      html += '  var unitEl = document.getElementById("itemUnit");';
      html += '  var unit = "шт";';
      html += '  if (document.getElementById("unitBlock").style.display !== ';
      html += '  "none") { unit = unitEl.value; }';
      html += '  if (!name || !qty || !price) { ';
      html += '    showAlert("Внимание", "Заполните поля", false); return; }';
      html += '  var btn = document.getElementById("btnAdd");';
      html += '  if (btn.disabled) return;';
      html += '  btn.disabled = true; btn.innerText = "Добавление...";';
      html += '  var f = document.getElementById("itemPhoto").files[0];';
      html += '  var finish = function(url) {';
      html += '    fetch("/api/warehouse/receipt/item/add", { ';
      html += '    method: "POST", headers: { "Content-Type": ';
      html += '    "application/json" }, ';
      html += '    body: JSON.stringify({ receipt_id: receiptId, ';
      html += '    name: name, qty: qty, price: price, retail: retail, ';
      html += '    cat_id: catId, unit: unit, photo_url: url }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) {';
      html += '      btn.disabled = false; ';
      html += '      btn.innerText = "+ Добавить в накладную";';
      html += '      if (d.ok) {';
      html += '        document.getElementById("itemName").value = "";';
      html += '        document.getElementById("itemQty").value = "";';
      html += '        document.getElementById("itemPrice").value = "";';
      html += '        document.getElementById("itemRetail").value = "";';
      html += '        document.getElementById("itemPhoto").value = "";';
      html += '        document.getElementById("photoPreview")';
      html += '        .style.display = "none";';
      html += '        document.getElementById("costDiff").innerText = "";';
      html += '        document.getElementById("clearSearch")';
      html += '        .style.display = "none";';
      html += '        receiptItems = d.items; renderList();';
      html += '      } else { showAlert("Ошибка", d.error, false); }';
      html += '    }).catch(function(err) { btn.disabled = false; ';
      html += '    btn.innerText = "+ Добавить в накладную"; ';
      html += '    showAlert("Ошибка", "Сбой сети. Повторите.", false); });';
      html += '  };';
      html += '  if (f) {';
      html += '    var rd = new FileReader();';
      html += '    rd.onload = function(e) {';
      html += '      var img = new Image();';
      html += '      img.onload = function() {';
      html += '        var canvas = document.createElement("canvas"); ';
      html += '        var MAX = 800; var w = img.width, h = img.height;';
      html += '        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } ';
      html += '        else { if (h > MAX) { w *= MAX / h; h = MAX; } }';
      html += '        canvas.width = w; canvas.height = h; ';
      html += '        var ctx = canvas.getContext("2d"); ';
      html += '        ctx.drawImage(img, 0, 0, w, h);';
      html += '        var dataUrl = canvas.toDataURL("image/jpeg", 0.7);';
      html += '        fetch("/api/warehouse/upload", { method: "POST", ';
      html += '        headers: { "Content-Type": "application/json" }, ';
      html += '        body: JSON.stringify({ image: dataUrl }) })';
      html += '        .then(function(r) { return r.json(); })';
      html += '        .then(function(d) { ';
      html += '          finish(d.ok ? d.url : null); })';
      html += '        .catch(function() { finish(null); });';
      html += '      }; img.src = e.target.result;';
      html += '    }; rd.readAsDataURL(f);';
      html += '  } else { finish(null); }';
      html += '}';

      html += 'function renderList() {';
      html += '  var b = document.getElementById("basket"); ';
      html += '  var list = document.getElementById("bList");';
      html += '  if (receiptItems.length === 0) { ';
      html += '    b.style.display = "none"; ';
      html += '    while(list.firstChild) list.removeChild(list.firstChild); ';
      html += '    return; }';
      html += '  b.style.display = "block"; ';
      html += '  while(list.firstChild) list.removeChild(list.firstChild);';
      html += '  var totalSum = 0;';
      html += '  receiptItems.forEach(function(item, idx) {';
      html += '    var q = parseFloat(String(item.qty).replace(",", ".")) || 0;';
      html += '    var p = parseFloat(String(item.unit_cost)';
      html += '    .replace(",", ".")) || 0;';
      html += '    var rowSum = Math.round(q * p * 100) / 100;';
      html += '    totalSum += rowSum;';
      html += '    var div = document.createElement("div"); ';
      html += '    div.className = "b-row";';
      html += '    var top = document.createElement("div"); ';
      html += '    top.className = "b-top";';
      html += '    var n = document.createElement("div"); ';
      html += '    n.textContent = item.name || "Товар";';
      html += '    var del = document.createElement("span"); ';
      html += '    del.textContent = "✕"; ';
      html += '    del.style = "color:red; cursor:pointer; font-size:18px;";';
      html += '    del.onclick = function() { ';
      html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
      html += '      function() { ';
      html += '        receiptItems.splice(idx, 1); renderList(); ';
      html += '      }, true); ';
      html += '    };';
      html += '    top.appendChild(n); top.appendChild(del); ';
      html += '    div.appendChild(top);';
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.className = "b-controls";';
      
      html += '    var c1 = document.createElement("div");';
      html += '    var lbl1 = document.createElement("label");';
      html += '    lbl1.textContent = "Количество";';
      html += '    c1.appendChild(lbl1);';
      html += '    var inpQ = document.createElement("input"); ';
      html += '    inpQ.type = "number"; inpQ.value = fmtNum(item.qty); ';
      html += '    inpQ.step = "0.1"; inpQ.inputMode = "decimal";';
      html += '    inpQ.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")); ';
      html += '      if (v > 0) { receiptItems[idx].qty = v; renderList(); } ';
      html += '      else { this.value = fmtNum(item.qty); }';
      html += '    };';
      html += '    c1.appendChild(inpQ);';
      
      html += '    var c2 = document.createElement("div");';
      html += '    var lbl2 = document.createElement("label");';
      html += '    lbl2.textContent = "Закупка (₽)";';
      html += '    c2.appendChild(lbl2);';
      html += '    var inpP = document.createElement("input"); ';
      html += '    inpP.type = "number"; inpP.value = fmtNum(item.unit_cost); ';
      html += '    inpP.inputMode = "decimal";';
      html += '    inpP.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")); ';
      html += '      if (v > 0) { receiptItems[idx].unit_cost = v;';
      html += '      renderList(); } ';
      html += '      else { this.value = fmtNum(item.unit_cost); }';
      html += '    };';
      html += '    c2.appendChild(inpP);';
      
      html += '    var c3 = document.createElement("div");';
      html += '    var lbl3 = document.createElement("label");';
      html += '    lbl3.textContent = "Розница (₽)";';
      html += '    c3.appendChild(lbl3);';
      html += '    var inpR = document.createElement("input"); ';
      html += '    inpR.type = "number"; ';
      html += '    inpR.value = item.retail_price > 0 ? ';
      html += '    fmtNum(item.retail_price) : ""; ';
      html += '    inpR.inputMode = "decimal";';
      html += '    inpR.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")) || 0; ';
      html += '      receiptItems[idx].retail_price = v; ';
      html += '    };';
      html += '    c3.appendChild(inpR);';
      
      html += '    ctrl.appendChild(c1); ctrl.appendChild(c2); ';
      html += '    ctrl.appendChild(c3);';
      html += '    div.appendChild(ctrl); list.appendChild(div);';
      html += '  });';
      html += '  document.getElementById("totalSum").innerText = ';
      html += '  fmtNum(totalSum) + " ₽";';
      html += '}';

      html += 'function saveReceipt() {';
      html += '  if (receiptItems.length === 0) { ';
      html += '    showAlert("Ошибка", "Накладная пуста.", false); return; }';
      
      html += '  var noPriceCount = 0;';
      html += '  var lowRetailCount = 0;';
      
      html += '  receiptItems.forEach(function(it) {';
      html += '    if (parseFloat(it.retail_price) === 0) { noPriceCount++; }';
      html += '    else if (parseFloat(it.retail_price) < parseFloat(it.unit_cost)) {';
      html += '      lowRetailCount++;';
      html += '    }';
      html += '  });';
      
      html += '  if (lowRetailCount > 0) {';
      html += '    showConfirm("Внимание", "У " + lowRetailCount + " товаров Розница ниже Закупки! Вы уверены, что хотите продавать в убыток?", ';
      html += '    function() { checkNoPrice(noPriceCount); }, false);';
      html += '  } else {';
      html += '    checkNoPrice(noPriceCount);';
      html += '  }';
      html += '}';

      html += 'function checkNoPrice(noPriceCount) {';
      html += '  if (noPriceCount > 0) {';
      html += '    showConfirm("Внимание", "Товаров без цены: " + ';
      html += '    noPriceCount + ". Они не появятся в Кассе. ", ';
      html += '    function() { _doSave(); }, false);';
      html += '  } else { _doSave(); }';
      html += '}';

      html += 'function _doSave() {';
      html += '  var btn = document.getElementById("btnSaveReceipt");';
      html += '  if (btn.disabled) return;';
      html += '  btn.disabled = true; btn.innerText = "Сохранение...";';
      html += '  fetch("/api/warehouse/receipt/save-all", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ receipt_id: receiptId, ';
      html += '  items: receiptItems }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { ';
      html += '      showAlert("Готово", "Накладная проведена!", true); ';
      html += '      setTimeout(function() { ';
      html += '        window.location.href = "/warehouse/receipts"; ';
      html += '      }, 1500); ';
      html += '    } else { ';
      html += '      btn.disabled = false; ';
      html += '      btn.innerText = "Провести накладную"; ';
      html += '      showAlert("Ошибка", d.error || "unknown", false); }';
      html += '  }).catch(function() { ';
      html += '    btn.disabled = false; ';
      html += '    btn.innerText = "Провести накладную"; ';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false); });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 9. ЭКРАН СПИСАНИЯ ======
  app.get('/warehouse/writeoff', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.search-wrap { position: relative; margin-bottom: 16px; }';
      
      html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
      html += 'right: 0; background: #fff; border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); margin-top: 4px; z-index: 100; ';
      html += 'box-shadow: var(--sh-2); max-height: 250px; ';
      html += 'overflow-y: auto; display: none; }';
      html += '.dd-item { padding: 12px 16px; ';
      html += 'border-bottom: 1px solid var(--f-border); cursor: pointer; ';
      html += 'display: flex; justify-content: space-between; ';
      html += 'align-items: center; }';
      html += '.dd-item:last-child { border-bottom: none; }';
      html += '.dd-name { font-weight: 600; font-size: 14px; }';
      html += '.dd-stock { font-size: 12px; font-weight: 800; }';

      html += '.grid { display: grid; grid-template-columns: ';
      html += 'repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; ';
      html += 'margin-bottom: 16px; }';
      html += '.card { background: #fff; padding: 10px; ';
      html += 'border-radius: var(--r-lg); text-align: center; ';
      html += 'cursor: pointer; box-shadow: var(--sh-1); }';
      html += '.card img { width: 100%; aspect-ratio: 1; object-fit: cover; ';
      html += 'border-radius: var(--r-md); margin-bottom: 8px; }';
      html += '.card .ph { width: 100%; aspect-ratio: 1; ';
      html += 'border-radius: var(--r-md); background: #F0F4F4; ';
      html += 'display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 8px; }';
      html += '.card .name { font-size: 13px; font-weight: 600; ';
      html += 'margin-bottom: 4px; line-height: 1.2; display: -webkit-box; ';
      html += '-webkit-line-clamp: 2; -webkit-box-orient: vertical; ';
      html += 'overflow: hidden; }';
      html += '.card .stock { font-size: 12px; font-weight: 800; }';
      html += '.card .stock.green { color: var(--f-success); }';
      html += '.card .stock.red { color: var(--f-danger); }';
      
      html += '.basket { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 16px; ';
      html += 'box-shadow: var(--sh-1); display: none; ';
      html += 'border-left: 4px solid var(--f-accent); }';
      
      html += '.b-row { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 8px; ';
      html += 'font-size: 14px; padding-bottom: 8px; ';
      html += 'border-bottom: 1px solid var(--f-border); }';
      html += '.b-controls { display: flex; gap: 6px; align-items: center; }';
      html += '.qty-btn { background: #F0F4F4; border: none; width: 28px; ';
      html += 'height: 28px; border-radius: 8px; font-weight: bold; ';
      html += 'font-size: 14px; color: var(--f-text); }';
      html += '.qty-input { width: 70px !important; height: 28px; ';
      html += 'font-size: 14px; margin: 0; padding: 0 4px; ';
      html += 'text-align: center; border: 1px solid var(--f-border); }';
      
      html += '.btn-checkout { width: 100%; padding: 16px; ';
      html += 'background: var(--f-accent); color: #fff; ';
      html += 'border: none; border-radius: var(--r-md); font-size: 16px; ';
      html += 'font-weight: 800; margin-top: 12px; display: none; }';

      html += '.form-block { display: none; background: #fff; ';
      html += 'border-radius: var(--r-lg); padding: 16px; ';
      html += 'margin-bottom: 16px; box-shadow: var(--sh-1); }';
      html += '.reasons { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 10px; margin-bottom: 16px; }';
      html += '.reason { padding: 12px; border-radius: var(--r-md); ';
      html += 'border: 1px solid var(--f-border); background: #fff; ';
      html += 'text-align: center; cursor: pointer; font-size: 14px; ';
      html += 'font-weight: 600; color: var(--f-text); }';
      html += '.reason.active { border-color: var(--f-accent); ';
      html += 'color: var(--f-accent); background: #FFF3E0; }';
      html += '.btn-save { width: 100%; padding: 16px; ';
      html += 'background: var(--f-danger); color: #fff; ';
      html += 'border: none; border-radius: var(--r-md); font-size: 16px; ';
      html += 'font-weight: 800; }';
      
      html += '.totals-box { margin-top: 16px; padding-top: 16px; ';
      html += 'border-top: 2px solid var(--f-brand); ';
      html += 'display: flex; justify-content: space-between; ';
      html += 'font-size: 18px; font-weight: 800; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Списание</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="search-wrap">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск..." oninput="onSearchInput()" ';
      html += 'autocomplete="off">';
      html += '<div class="dropdown-list" id="ddList"></div>';
      html += '</div>';

      html += '<div class="basket" id="basket">';
      html += '<h3 style="margin-top:0; font-size:16px; font-weight:800; ';
      html += 'margin-bottom:12px;">К списанию:</h3>';
      html += '<div id="bList"></div>';
      html += '<div class="totals-box">';
      html += '<span id="totQty">Всего: 0 шт</span>';
      html += '<span id="totSum">0 ₽</span>';
      html += '</div>';
      html += '<button class="btn-checkout" id="btnCheckout" ';
      html += 'onclick="showForm()">Перейти к оформлению</button>';
      html += '</div>';

      html += '<div class="form-block" id="formBlock">';
      html += '<label style="display:block; font-size:13px; font-weight:600; ';
      html += 'color:var(--f-text-2); margin-bottom:8px;">';
      html += 'Причина списания</label>';
      html += '<div class="reasons">';
      html += '<div class="reason active" ';
      html += 'onclick="setR(this, &apos;spoilage&apos;)">Порча</div>';
      html += '<div class="reason" ';
      html += 'onclick="setR(this, &apos;loss&apos;)">Потеря</div>';
      html += '<div class="reason" ';
      html += 'onclick="setR(this, &apos;markdown&apos;)">Уценка</div>';
      html += '<div class="reason" ';
      html += 'onclick="setR(this, &apos;sorting&apos;)">Пересорт</div>';
      html += '</div>';
      
      html += '<label style="font-size:13px; font-weight:600; ';
      html += 'color:var(--f-text-2);">Комментарий</label>';
      html += '<textarea id="comment" style="width:100%; padding:12px; ';
      html += 'border-radius:var(--r-md); border:1px solid var(--f-border); ';
      html += 'margin-bottom:16px; font-family:inherit; ';
      html += 'box-shadow: var(--sh-1);"></textarea>';
      
      html += '<label style="font-size:13px; font-weight:600; ';
      html += 'color:var(--f-text-2);">Фото (необязательно)</label>';
      html += '<input type="file" id="wPhoto" accept="image/*" ';
      html += 'style="margin-bottom:16px; box-shadow: none; ';
      html += 'padding: 8px; border: 1px dashed var(--f-border);">';
      
      html += '<button class="btn-save" id="btnSaveWriteoff" ';
      html += 'onclick="saveWriteoff()">Списать всё</button>';
      html += '</div>';

      html += '<div class="grid" id="itemsGrid"></div>';

      html += getUnifiedMenu('writeoff');

      html += '<script>';
      html += 'var allItems = []; var cart = []; ';
      html += 'var selReason = "spoilage";';
      
      html += 'var svgPh = "<div style=width:40px;height:40px;';
      html += 'background:#D8E4E4;border-radius:50%;></div>";';

      html += 'fetch("/api/warehouse/items")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { allItems = d.items; renderGrid(); })';
      html += '.catch(function() {});';

      html += 'document.addEventListener("click", function(e) {';
      html += '  var dd = document.getElementById("ddList");';
      html += '  var inp = document.getElementById("search");';
      html += '  if (dd && inp && e.target !== dd && ';
      html += '  e.target !== inp && !dd.contains(e.target)) {';
      html += '    dd.style.display = "none";';
      html += '  }';
      html += '});';

      html += 'function onSearchInput() {';
      html += '  var q = document.getElementById("search").value';
      html += '  .toLowerCase();';
      html += '  var dd = document.getElementById("ddList");';
      html += '  while(dd.firstChild) dd.removeChild(dd.firstChild);';
      html += '  if (q.length > 0) {';
      html += '    var found = allItems.filter(function(i) { ';
      html += '      return i.name.toLowerCase().includes(q); ';
      html += '    }).slice(0, 20);';
      html += '    if (found.length > 0) {';
      html += '      found.forEach(function(i) {';
      html += '        var row = document.createElement("div"); ';
      html += '        row.className = "dd-item";';
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "dd-name"; nm.textContent = i.name;';
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "dd-stock"; ';
      html += '        var s = parseFloat(i.current_stock);';
      html += '        st.textContent = fmtNum(s) + " " + (i.unit || "шт");';
      html += '        st.style.color = s > 0 ? "var(--f-success)" : ';
      html += '        "var(--f-danger)";';
      html += '        row.appendChild(nm); row.appendChild(st);';
      html += '        row.onclick = function() { ';
      html += '          document.getElementById("search").value = "";';
      html += '          dd.style.display = "none"; ';
      html += '          addToBasket(i); };';
      html += '        dd.appendChild(row);';
      html += '      });';
      html += '      dd.style.display = "block";';
      html += '    } else { dd.style.display = "none"; }';
      html += '  } else { dd.style.display = "none"; }';
      html += '  renderGrid();';
      html += '}';

      html += 'function renderGrid() {';
      html += '  var q = document.getElementById("search").value';
      html += '  .toLowerCase();';
      html += '  var items = allItems.filter(function(i) { ';
      html += '    return i.name.toLowerCase().includes(q); });';
      html += '  drawCards(items);';
      html += '}';

      html += 'function drawCards(items) {';
      html += '  var g = document.getElementById("itemsGrid");';
      html += '  while (g.firstChild) g.removeChild(g.firstChild);';
      html += '  items.forEach(function(i) {';
      html += '    var d = document.createElement("div"); ';
      html += '    d.className = "card";';
      html += '    if (i.photo_url) { ';
      html += '      var img = document.createElement("img"); ';
      html += '      img.src = i.photo_url; d.appendChild(img); } ';
      html += '    else { ';
      html += '      var ph = document.createElement("div"); ';
      html += '      ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '      d.appendChild(ph); }';
      html += '    var nm = document.createElement("div");';
      html += '    nm.className = "name"; nm.textContent = i.name;';
      html += '    var st = document.createElement("div");';
      html += '    var stockVal = parseFloat(i.current_stock) || 0;';
      html += '    st.className = "stock " + (stockVal > 0 ? "green" : "red");';
      html += '    st.textContent = "Ост: " + ';
      html += '    fmtNum(stockVal) + " " + (i.unit || "шт");';
      html += '    d.appendChild(nm); d.appendChild(st);';
      html += '    d.onclick = function() { addToBasket(i); };';
      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function addToBasket(item) {';
      html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
      html += '  if (ex) { ex.qty += 1; }';
      html += '  else { cart.push({ id: item.id, name: item.name, qty: 1, ';
      html += '    avg_cost: item.avg_cost || 0 }); }';
      html += '  renderBasket(); ';
      html += '}';

      html += 'function changeQty(idx, delta) {';
      html += '  cart[idx].qty += delta;';
      html += '  if (cart[idx].qty <= 0) {';
      html += '    cart.splice(idx, 1); renderBasket();';
      html += '  } else { renderBasket(); }';
      html += '}';

      html += 'function renderBasket() {';
      html += '  var b = document.getElementById("basket");';
      html += '  var list = document.getElementById("bList");';
      html += '  var form = document.getElementById("formBlock");';
      html += '  if (cart.length === 0) { ';
      html += '    b.style.display = "none"; form.style.display = "none"; ';
      html += '    return; }';
      html += '  b.style.display = "block"; ';
      html += '  while(list.firstChild) list.removeChild(list.firstChild);';
      html += '  var totQty = 0; var totSum = 0;';
      html += '  cart.forEach(function(item, idx) {';
      html += '    var q = parseFloat(String(item.qty).replace(",", ".")) || 0;';
      html += '    var c = parseFloat(String(item.avg_cost)';
      html += '    .replace(",", ".")) || 0;';
      html += '    totQty += q; totSum += q * c;';
      html += '    var div = document.createElement("div");';
      html += '    div.className = "b-row";';
      html += '    var n = document.createElement("div"); ';
      html += '    n.textContent = item.name;';
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.className = "b-controls";';
      html += '    var mn = document.createElement("button"); ';
      html += '    mn.textContent = "-"; mn.className = "qty-btn"; ';
      html += '    mn.onclick = function() { changeQty(idx, -1); };';
      html += '    var inp = document.createElement("input"); ';
      html += '    inp.type = "number"; inp.className = "qty-input"; ';
      html += '    inp.value = item.qty; inp.inputMode = "decimal";';
      html += '    inp.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")); ';
      html += '      if (v > 0) { cart[idx].qty = v; renderBasket(); } ';
      html += '      else { this.value = item.qty; }';
      html += '    };';
      html += '    var pl = document.createElement("button"); ';
      html += '    pl.textContent = "+"; pl.className = "qty-btn"; ';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      html += '    ctrl.appendChild(mn); ctrl.appendChild(inp); ';
      html += '    ctrl.appendChild(pl);';
      html += '    var del = document.createElement("span"); ';
      html += '    del.textContent = "✕"; ';
      html += '    del.style = "color:red; cursor:pointer; font-size:18px; ';
      html += '    margin-left:10px;";';
      html += '    del.onclick = function() { ';
      html += '      cart.splice(idx, 1); renderBasket(); ';
      html += '    };';
      html += '    ctrl.appendChild(del);';
      html += '    div.appendChild(n); div.appendChild(ctrl); ';
      html += '    list.appendChild(div);';
      html += '  });';
      html += '  document.getElementById("totQty").textContent = ';
      html += '  "Всего: " + fmtNum(totQty) + " шт";';
      html += '  document.getElementById("totSum").textContent = ';
      html += '  Math.round(totSum).toLocaleString("ru-RU") + " ₽";';
      html += '  document.getElementById("btnCheckout").style.display = ';
      html += '  "block";';
      html += '}';

      html += 'function showForm() {';
      html += '  document.getElementById("formBlock").style.display = "block";';
      html += '  document.getElementById("btnCheckout").style.display = ';
      html += '  "none";';
      html += '  document.getElementById("formBlock").scrollIntoView({ ';
      html += '    behavior: "smooth" });';
      html += '}';

      html += 'function setR(el, r) {';
      html += '  document.querySelectorAll(".reason").forEach(function(b) {';
      html += '    b.classList.remove("active"); });';
      html += '  el.classList.add("active"); selReason = r;';
      html += '}';

      html += 'function saveWriteoff() {';
      html += '  if (cart.length === 0) return;';
      html += '  var btn = document.getElementById("btnSaveWriteoff");';
      html += '  if (btn.disabled) return;';
      html += '  btn.disabled = true; btn.innerText = "Списание...";';
      html += '  var c = document.getElementById("comment").value;';
      html += '  var f = document.getElementById("wPhoto").files[0];';
      html += '  if (f) {';
      html += '    var rd = new FileReader();';
      html += '    rd.onload = function(e) { upload(e.target.result, c); };';
      html += '    rd.readAsDataURL(f);';
      html += '  } else { submit(null, c); }';
      html += '}';

      html += 'function upload(base64, c) {';
      html += '  fetch("/api/warehouse/upload", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ image: base64 }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) { submit(d.ok ? d.url : null, c); })';
      html += '  .catch(function() { submit(null, c); });';
      html += '}';

      html += 'function submit(url, c) {';
      html += '  var payload = { items: cart, ';
      html += '    reason: selReason, comment: c, photo: url };';
      html += '  fetch("/api/warehouse/writeoff", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify(payload) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      showAlert("Готово", "Успешно списано!", true);';
      html += '      setTimeout(function() { ';
      html += '        window.location.href = "/warehouse-app"; }, 1500);';
      html += '    } else {';
      html += '      document.getElementById("btnSaveWriteoff").disabled = ';
      html += '      false;';
      html += '      document.getElementById("btnSaveWriteoff").innerText = ';
      html += '      "Списать всё"; showAlert("Ошибка", d.error, false);';
      html += '    }';
      html += '  }).catch(function() {';
      html += '    document.getElementById("btnSaveWriteoff").disabled = false;';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
}

module.exports = { setupWarehouseViewsSales };