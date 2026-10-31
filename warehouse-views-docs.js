const pool = require('./db');
const {
  esc, fmtNum, getUnifiedMenu,
  metaSafari, fontLink, uiScript,
  translateReason
} = require('./warehouse-views-core');

function setupWarehouseViewsDocs(app, bot, s3ctx, getAuth) {
  // ====== 10. ЭКРАН ДОКУМЕНТОВ ======
  app.get('/warehouse/documents', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.tabs { display: flex; gap: 8px; margin-bottom: 16px; } ';
      html += '.tab { flex: 1; padding: 12px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); background: #fff; ';
      html += 'text-align: center; cursor: pointer; text-decoration: none; ';
      html += 'font-weight: 600; font-size: 14px; color: var(--f-text); }';
      html += '.tab.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); } ';
      
      html += '.doc { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 12px; text-decoration: none; ';
      html += 'color: var(--f-text); display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-1); border-left: 4px solid transparent; }';
      html += '.doc.receipt { border-left-color: #3C7A89; } ';
      html += '.doc.writeoff { border-left-color: var(--f-accent); } ';
      
      html += '.doc-left { display: flex; flex-direction: column; gap: 4px; }';
      html += '.doc-title { font-weight: 700; font-size: 16px; }';
      html += '.meta { font-size: 13px; color: var(--f-text-2); } ';
      html += '.amount { font-weight: 800; font-size: 18px; text-align: right; }';
      
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
      html += '<h2 class="page-title">Документы</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="tabs">';
      html += '<a href="/warehouse/documents?type=receipts" ';
      html += 'class="tab" id="tab-receipts">Приходы</a>';
      html += '<a href="/warehouse/documents?type=writeoffs" class="tab" ';
      html += 'id="tab-writeoffs">Списания</a></div><div id="list">';
      html += 'Загрузка...</div>';

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

      html += getUnifiedMenu('documents');

      html += '<script>';
      html += 'var currentType = new URLSearchParams(window.location.search)';
      html += '.get("type") || "receipts";';
      html += 'var tab = document.getElementById("tab-" + currentType); ';
      html += 'if (tab) tab.classList.add("active");';
      
      html += 'function shortId(id) {';
      html += '  if (!id) return "";';
      html += '  var parts = String(id).split("_");';
      html += '  return parts[parts.length - 1];';
      html += '}';
      
      html += 'fetch("/api/warehouse/documents?type=" + currentType)';
      html += '.then(function(r){return r.json();})';
      html += '.then(function(d){';
      html += '  var b = document.getElementById("list"); ';
      html += '  while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '  if (!d.ok) { ';
      html += '    var erDiv = document.createElement("div");';
      html += '    erDiv.className = "empty-state";';
      html += '    var erT = document.createElement("div");';
      html += '    erT.className = "empty-state-title";';
      html += '    erT.textContent = "Ошибка загрузки";';
      html += '    erDiv.appendChild(erT); b.appendChild(erDiv); ';
      html += '    return; ';
      html += '  } ';
      html += '  if (!d.docs || d.docs.length === 0) { ';
      html += '    var em = document.createElement("div"); ';
      html += '    em.className = "empty-state"; ';
      html += '    var emT = document.createElement("div"); ';
      html += '    emT.className = "empty-state-title"; ';
      html += '    emT.textContent = "Документов нет"; ';
      html += '    em.appendChild(emT); b.appendChild(em); ';
      html += '    return; }';
      
      html += '  d.docs.forEach(function(doc){ ';
      html += '    var a = document.createElement("a"); ';
      html += '    var cl = currentType === "receipts" ? "receipt" : "writeoff";';
      html += '    a.className = "doc " + cl; ';
      html += '    a.href = "/warehouse/documents/details?id=" + doc.id + ';
      html += '    "&type=" + currentType;';
      html += '    var ds = new Date(doc.date).toLocaleString("ru-RU"); ';
      html += '    var author = doc.author || "Система"; ';
      
      html += '    var left = document.createElement("div"); ';
      html += '    left.className = "doc-left"; ';
      html += '    var title = document.createElement("div"); ';
      html += '    title.className = "doc-title"; ';
      html += '    var meta = document.createElement("div"); ';
      html += '    meta.className = "meta"; ';
      html += '    var amount = document.createElement("div"); ';
      html += '    amount.className = "amount";';
      
      html += '    if (currentType === "receipts") { ';
      html += '      title.textContent = "Накладная №" + shortId(doc.id); ';
      html += '      meta.textContent = ds + " · " + author; ';
      html += '      amount.textContent = parseFloat(doc.amount)';
      html += '      .toLocaleString("ru-RU") + " ₽"; ';
      html += '      amount.style.color = "#3C7A89"; ';
      html += '    } else { ';
      html += '      title.textContent = "Акт списания №" + shortId(doc.id); ';
      html += '      var itm = doc.items || ""; ';
      html += '      var reason = translateReason(doc.reason); ';
      html += '      meta.textContent = ds + " · " + author + " (" + ';
      html += '      itm + " / " + reason + ")"; ';
      html += '      amount.textContent = "-" + fmtNum(doc.amount) + " шт"; ';
      html += '      amount.style.color = "var(--f-accent)"; }';
      
      html += '    left.appendChild(title); left.appendChild(meta); ';
      html += '    a.appendChild(left); a.appendChild(amount); ';

      html += '    var pressTimer;';
      html += '    a.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { ';
      html += '        a.dataset.longpress = "true";';
      html += '        showDocPreview(doc.id, currentType);';
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

      html += '    b.appendChild(a); });';
      html += '}).catch(function(){ ';
      html += 'document.getElementById("list").textContent = "Ошибка"; });';

      html += 'function showDocPreview(id, type) {';
      html += '  var ov = document.getElementById("docPreviewModal");';
      html += '  var title = document.getElementById("docPreviewTitle");';
      html += '  var list = document.getElementById("docPreviewList");';
      html += '  var total = document.getElementById("docPreviewTotal");';
      html += '  title.textContent = "Загрузка...";';
      html += '  list.innerHTML = ""; total.textContent = "";';
      html += '  ov.style.display = "flex";';
      html += '  fetch("/api/warehouse/documents/details?id=" + id + ';
      html += '  "&type=" + type)';
      html += '  .then(function(r){return r.json();})';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { title.textContent = "Ошибка"; return; }';
      html += '    title.textContent = (type === "receipts" ? ';
      html += '    "Накладная №" : "Акт №") + shortId(id);';
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
      html += '    var totalTxt = type === "receipts" ? ';
      html += '    parseFloat(d.header.total_sum).toLocaleString("ru-RU") ';
      html += '    + " ₽" : fmtNum(d.header.total_sum) + " шт";';
      html += '    total.textContent = "Итого: " + totalTxt;';
      html += '  }).catch(function(){ title.textContent = "Ошибка сети"; });';
      html += '}';
      
      html += 'function closeDocPreview() {';
      html += '  document.getElementById("docPreviewModal").style.display = ';
      html += '  "none";';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 11. ЭКРАН ДЕТАЛЕЙ ДОКУМЕНТА ======
  app.get('/warehouse/documents/details', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; }';
      html += '.item-row { display: flex; justify-content: space-between; ';
      html += 'padding: 12px 0; border-bottom: 1px solid var(--f-border); ';
      html += 'text-decoration: none; color: var(--f-text); } ';
      html += '.item-row:last-child { border-bottom: none; } ';
      html += '.item-name { font-weight: 600; font-size: 15px; } ';
      html += '.item-qty { text-align: right; font-weight: 800; }';
      html += '.total-row { margin-top: 16px; padding-top: 16px; ';
      html += 'border-top: 2px solid var(--f-brand); display: flex; ';
      html += 'justify-content: space-between; font-size: 20px; ';
      html += 'font-weight: 800; }';
      html += '.btn-cancel-doc { width: 100%; padding: 16px; ';
      html += 'background: #fff; border: 2px solid var(--f-danger); ';
      html += 'color: var(--f-danger); border-radius: var(--r-md); ';
      html += 'font-weight: 800; font-size: 16px; margin-top: 24px; ';
      html += 'cursor: pointer; }';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="#" onclick="history.back(); return false;" ';
      html += 'class="back-btn">←</a>';
      html += '<h2 class="page-title">Документ</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="card" id="content">Загрузка...</div>';

      html += getUnifiedMenu('documents');

      html += '<script>';
      html += 'function shortId(id) {';
      html += '  if (!id) return "";';
      html += '  var parts = String(id).split("_");';
      html += '  return parts[parts.length - 1];';
      html += '}';
      
      html += 'var urlParams = new URLSearchParams(window.location.search); ';
      html += 'var docId = urlParams.get("id") || ""; ';
      html += 'var docType = urlParams.get("type") || "receipts";';
      html += 'fetch("/api/warehouse/documents/details?id=" + docId + ';
      html += '"&type=" + docType).then(function(r){return r.json();})';
      html += '.then(function(d){';
      html += '  var content = document.getElementById("content"); ';
      html += '  while(content.firstChild) ';
      html += '  content.removeChild(content.firstChild); ';
      html += '  if (!d.ok) { ';
      html += '    content.textContent = "Ошибка: " + d.error; return; }';
      html += '  var h = d.header; ';
      html += '  var ds = new Date(h.date).toLocaleString("ru-RU"); ';
      html += '  var titleTxt = docType === "receipts" ? ';
      html += '  "Приходная накладная №" : "Акт списания №";';
      
      html += '  var title = document.createElement("div"); ';
      html += '  title.style = "font-size:20px; font-weight:800;"; ';
      html += '  title.textContent = titleTxt + shortId(h.id); ';
      html += '  content.appendChild(title);';
      
      html += '  var meta = document.createElement("div"); ';
      html += '  meta.style = "font-size:13px; color:var(--f-text-2); ';
      html += '  margin-bottom:16px;"; ';
      html += '  meta.textContent = ds + " · Сделал: " + ';
      html += '  (h.author || "Неизвестно"); ';
      html += '  content.appendChild(meta);';
      
      html += '  d.items.forEach(function(i){ ';
      html += '    var a = document.createElement("a"); ';
      html += '    a.href = "/warehouse/item?id=" + ';
      html += '    (parseInt(i.shop_item_id) || 0); ';
      html += '    a.className = "item-row"; ';
      html += '    var left = document.createElement("div"); ';
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "item-name"; nm.textContent = i.name; ';
      html += '    left.appendChild(nm);';
      
      html += '    if (docType === "receipts") { ';
      html += '      var cost = document.createElement("div"); ';
      html += '      cost.style = "font-size:12px; color:var(--f-text-2);"; ';
      html += '      cost.textContent = parseFloat(i.unit_cost)';
      html += '      .toFixed(2) + " ₽/шт"; ';
      html += '      left.appendChild(cost); ';
      html += '    } else { ';
      html += '      var rsn = document.createElement("div"); ';
      html += '      rsn.style = "font-size:12px; color:var(--f-text-2);"; ';
      html += '      rsn.textContent = "Причина: " + ';
      html += '      translateReason(h.reason); ';
      html += '      left.appendChild(rsn); }';
      
      html += '    var right = document.createElement("div"); ';
      html += '    right.className = "item-qty"; ';
      html += '    right.textContent = fmtNum(i.qty) + " шт";';
      html += '    if (docType === "receipts") { ';
      html += '      var sum = document.createElement("div"); ';
      html += '      sum.style = "font-size:12px; ';
      html += '      color:var(--f-text-2); font-weight:400;"; ';
      html += '      sum.textContent = parseFloat(i.sum)';
      html += '      .toFixed(2) + " ₽"; ';
      html += '      right.appendChild(sum); }';
      html += '    a.appendChild(left); a.appendChild(right); ';
      html += '    content.appendChild(a); });';
      
      html += '  var total = document.createElement("div"); ';
      html += '  total.className = "total-row";';
      html += '  var totalTxt = docType === "receipts" ? ';
      html += '  parseFloat(h.total_sum).toLocaleString("ru-RU") + " ₽" : ';
      html += '  fmtNum(h.total_sum) + " шт";';
      
      html += '  var spanLeft = document.createElement("span"); ';
      html += '  spanLeft.textContent = "Итого:"; ';
      html += '  var spanRight = document.createElement("span"); ';
      html += '  spanRight.textContent = totalTxt; ';
      html += '  total.appendChild(spanLeft); ';
      html += '  total.appendChild(spanRight); ';
      html += '  content.appendChild(total);';
      
      html += '  if (docType === "receipts" && h.status === "completed") {';
      html += '    var cancelBtn = document.createElement("button"); ';
      html += '    cancelBtn.className = "btn-cancel-doc"; ';
      html += '    cancelBtn.innerText = "Отменить проведение";';
      html += '    cancelBtn.onclick = function() { ';
      html += '      showConfirm("Отмена", "Вы уверены? Товары спишутся ';
      html += '      со склада, накладная станет черновиком.", ';
      html += '      function() {';
      html += '        fetch("/api/warehouse/receipt/cancel", { ';
      html += '        method: "POST", headers: { "Content-Type": ';
      html += '        "application/json" }, body: JSON.stringify({ ';
      html += '        id: docId }) })';
      html += '        .then(function(r){return r.json();})';
      html += '        .then(function(res){ ';
      html += '        if(res.ok){ showAlert("Готово", ';
      html += '        "Накладная отменена", true); ';
      html += '        setTimeout(function(){window.location.href=';
      html += '        "/warehouse/receipt/edit?id=" + docId;}, 1000); } ';
      html += '        else showAlert("Ошибка", res.error, false); })';
      html += '        .catch(function(){});';
      html += '      }, true); };';
      html += '    content.appendChild(cancelBtn);';
      html += '  }';
      html += '}).catch(function(){ ';
      html += 'document.getElementById("content").textContent = ';
      html += '"Ошибка загрузки"; });';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 12. ЭКРАН ОТЧЁТОВ ======
  app.get('/warehouse/reports', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.date-row { display: flex; gap: 8px; margin-bottom: 12px; }';
      html += '.date-row input { flex: 1; padding: 10px; border: none; ';
      html += 'border-radius: var(--r-md); font-family: inherit; ';
      html += 'font-size: 14px; box-shadow: var(--sh-1); margin: 0; }';
      
      html += '.quick-dates { display: flex; gap: 6px; margin-bottom: 16px; }';
      html += '.q-btn { flex: 1; padding: 10px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); background: #fff; ';
      html += 'text-align: center; font-size: 13px; font-weight: 600; ';
      html += 'cursor: pointer; color: var(--f-text); }';
      html += '.q-btn.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';

      html += '.tabs { display: flex; gap: 6px; margin-bottom: 16px; ';
      html += 'overflow-x: auto; padding-bottom: 4px; }';
      html += '.tabs::-webkit-scrollbar { display: none; }';
      html += '.tab { padding: 10px 16px; border-radius: 20px; ';
      html += 'background: #fff; border: 1px solid var(--f-border); ';
      html += 'font-size: 14px; font-weight: 600; white-space: nowrap; ';
      html += 'cursor: pointer; color: var(--f-text); }';
      html += '.tab.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';

      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; text-align: center; }';
      html += '.val { font-size: 28px; font-weight: 800; margin-bottom: 4px; }';
      html += '.val.blue { color: #3C7A89; } ';
      html += '.val.green { color: var(--f-success); } ';
      html += '.val.red { color: var(--f-danger); }';
      html += '.lbl { font-size: 14px; color: var(--f-text-2); }';
      
      html += '.list-item { display: flex; justify-content: space-between; ';
      html += 'padding: 12px 0; border-bottom: 1px solid var(--f-border); ';
      html += 'font-size: 15px; }';
      html += '.list-item:last-child { border-bottom: none; }';
      
      html += '.chart-container { margin-top: 20px; overflow-x: auto; ';
      html += 'padding-bottom: 12px; -webkit-overflow-scrolling: touch; }';
      html += '.chart-wrap { display: flex; align-items: flex-end; ';
      html += 'height: 140px; gap: 8px; min-width: 100%; width: max-content; }';
      html += '.bar-col { width: 44px; display: flex; flex-direction: column; ';
      html += 'justify-content: flex-end; align-items: center; height: 100%; }';
      html += '.bar { width: 100%; background: #E0F2F1; ';
      html += 'border-radius: 6px 6px 0 0; transition: background 0.2s; ';
      html += 'cursor: pointer; min-height: 4px; }';
      html += '.bar.active { background: var(--f-brand); }';
      html += '.bar-lbl { font-size: 11px; color: var(--f-text-2); ';
      html += 'margin-top: 6px; font-weight: 600; }';
      html += '.chart-info { font-size: 14px; font-weight: 700; ';
      html += 'margin-top: 12px; color: var(--f-brand); height: 20px; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Отчёты</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="date-row">';
      html += '<input type="date" id="dateStart" onchange="setCustom()">';
      html += '<input type="date" id="dateEnd" onchange="setCustom()">';
      html += '</div>';
      
      html += '<div class="quick-dates">';
      html += '<div class="q-btn" id="q-today" ';
      html += 'onclick="setQuick(&apos;today&apos;)">Сегодня</div>';
      html += '<div class="q-btn" id="q-week" ';
      html += 'onclick="setQuick(&apos;week&apos;)">Неделя</div>';
      html += '<div class="q-btn" id="q-month" ';
      html += 'onclick="setQuick(&apos;month&apos;)">Месяц</div>';
      html += '<div class="q-btn" id="q-all" ';
      html += 'onclick="setQuick(&apos;all&apos;)">Всё</div>';
      html += '</div>';

      html += '<div class="tabs">';
      html += '<div class="tab active" id="t-fin" ';
      html += 'onclick="setTab(&apos;fin&apos;)">Финансы</div>';
      html += '<div class="tab" id="t-loss" ';
      html += 'onclick="setTab(&apos;loss&apos;)">Потери</div>';
      html += '<div class="tab" id="t-top" ';
      html += 'onclick="setTab(&apos;top&apos;)">Топ-5</div>';
      html += '<div class="tab" id="t-move" ';
      html += 'onclick="setTab(&apos;move&apos;)">Движение</div>';
      html += '</div>';

      html += '<div id="content">Загрузка...</div>';

      html += getUnifiedMenu('reports');

      html += '<script>';
      html += 'var currentTab = "fin"; var reportData = null;';
      html += 'function fmtMoney(v) { ';
      html += 'return Math.round(v).toLocaleString("ru-RU") + " ₽"; }';

      html += 'function setCustom() {';
      html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
      html += '    b.classList.remove("active");});';
      html += '  loadData();';
      html += '}';

      html += 'function setQuick(type) {';
      html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
      html += '    b.classList.remove("active");});';
      html += '  document.getElementById("q-" + type).classList.add("active");';
      html += '  var d = new Date(); var start = ""; var end = "";';
      html += '  var y = d.getFullYear(); ';
      html += '  var m = String(d.getMonth() + 1).padStart(2, "0");';
      html += '  var day = String(d.getDate()).padStart(2, "0");';
      html += '  end = y + "-" + m + "-" + day;';
      
      html += '  if (type === "today") { start = end; }';
      html += '  else if (type === "week") { ';
      html += '    d.setDate(d.getDate() - 7); ';
      html += '    start = d.getFullYear() + "-" + ';
      html += '    String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
      html += '    String(d.getDate()).padStart(2, "0"); }';
      html += '  else if (type === "month") { ';
      html += '    d.setMonth(d.getMonth() - 1); ';
      html += '    start = d.getFullYear() + "-" + ';
      html += '    String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
      html += '    String(d.getDate()).padStart(2, "0"); }';
      html += '  else if (type === "all") { start = ""; end = ""; }';
      
      html += '  document.getElementById("dateStart").value = start;';
      html += '  document.getElementById("dateEnd").value = end;';
      html += '  loadData();';
      html += '}';

      html += 'function setTab(t) {';
      html += '  currentTab = t;';
      html += '  document.querySelectorAll(".tab").forEach(function(el){';
      html += '    el.classList.remove("active");});';
      html += '  document.getElementById("t-" + t).classList.add("active");';
      html += '  if (reportData) { renderTab(); } else { loadData(); }';
      html += '}';

      html += 'function loadData() {';
      html += '  var st = document.getElementById("dateStart").value;';
      html += '  var en = document.getElementById("dateEnd").value;';
      html += '  var url = "/api/warehouse/reports";';
      html += '  if (st && en) { url += "?start=" + st + "&end=" + en; }';
      html += '  var c = document.getElementById("content");';
      html += '  c.textContent = "Загрузка...";';
      html += '  fetch(url).then(function(r){return r.json();})';
      html += '  .then(function(d){';
      html += '    if (d.ok) { reportData = d; renderTab(); }';
      html += '    else { c.textContent = "Ошибка"; }';
      html += '  }).catch(function(){ c.textContent = "Ошибка сети"; });';
      html += '}';

      html += 'function showBarInfo(el, dateStr, sum) {';
      html += '  document.querySelectorAll(".bar").forEach(function(b){';
      html += '    b.classList.remove("active"); });';
      html += '  el.classList.add("active");';
      html += '  document.getElementById("chartInfo").textContent = ';
      html += '  dateStr + ": " + fmtMoney(sum);';
      html += '}';

      html += 'function renderTab() {';
      html += '  var c = document.getElementById("content");';
      html += '  while(c.firstChild) c.removeChild(c.firstChild);';
      html += '  if (!reportData) return;';
      html += '  var f = reportData.finance; var l = reportData.losses;';
      
      html += '  if (currentTab === "fin") {';
      html += '    var card1 = document.createElement("div"); ';
      html += '    card1.className = "card";';
      html += '    var v1 = document.createElement("div"); ';
      html += '    v1.className = "val blue"; ';
      html += '    v1.textContent = fmtMoney(f.revenue);';
      html += '    var lbl1 = document.createElement("div"); ';
      html += '    lbl1.className = "lbl"; ';
      html += '    lbl1.textContent = "Выручка (чеков: " + f.count + ")";';
      html += '    card1.appendChild(v1); card1.appendChild(lbl1); ';
      html += '    c.appendChild(card1);';

      html += '    var card2 = document.createElement("div"); ';
      html += '    card2.className = "card";';
      html += '    var v2 = document.createElement("div"); ';
      html += '    v2.className = "val green"; ';
      html += '    v2.textContent = fmtMoney(f.profit);';
      html += '    var lbl2 = document.createElement("div"); ';
      html += '    lbl2.className = "lbl"; ';
      html += '    lbl2.textContent = "Прибыль (Себест: " + ';
      html += '    fmtMoney(f.cost) + ") · Маржа: " + f.margin_pct + "%";';
      html += '    card2.appendChild(v2); card2.appendChild(lbl2); ';
      html += '    c.appendChild(card2);';

      html += '    var card3 = document.createElement("div"); ';
      html += '    card3.className = "card";';
      html += '    var v3 = document.createElement("div"); ';
      html += '    v3.className = "val"; v3.style.fontSize = "18px";';
      html += '    v3.textContent = "Нал: " + fmtMoney(f.cash) + ';
      html += '    " | Карта: " + fmtMoney(f.card) + ';
      html += '    " | QR: " + fmtMoney(f.qr);';
      html += '    card3.appendChild(v3); c.appendChild(card3);';
      
      html += '    if (reportData.daily && reportData.daily.length > 0) {';
      html += '      var chartCard = document.createElement("div");';
      html += '      chartCard.className = "card";';
      html += '      var title = document.createElement("div");';
      html += '      title.style = "font-weight:800; text-align:left; ';
      html += '      margin-bottom:8px;";';
      html += '      title.textContent = "Выручка по дням";';
      html += '      chartCard.appendChild(title);';
      
      html += '      var maxVal = 0;';
      html += '      reportData.daily.forEach(function(d){ ';
      html += '        if(parseFloat(d.total) > maxVal) ';
      html += '        maxVal = parseFloat(d.total); });';
      
      html += '      var maxLbl = document.createElement("div");';
      html += '      maxLbl.style = "font-size:12px; color:#888; ';
      html += '      text-align:left; margin-bottom:16px;";';
      html += '      maxLbl.textContent = "Макс: " + fmtMoney(maxVal);';
      html += '      chartCard.appendChild(maxLbl);';
      
      html += '      var cont = document.createElement("div");';
      html += '      cont.className = "chart-container";';
      html += '      var wrap = document.createElement("div");';
      html += '      wrap.className = "chart-wrap";';
      
      html += '      reportData.daily.forEach(function(d){ ';
      html += '        var col = document.createElement("div");';
      html += '        col.className = "bar-col";';
      html += '        var bar = document.createElement("div");';
      html += '        bar.className = "bar";';
      html += '        var hPct = maxVal > 0 ? ';
      html += '        (parseFloat(d.total)/maxVal)*100 : 0;';
      html += '        bar.style.height = hPct + "%";';
      html += '        var parts = String(d.day).split("-");';
      html += '        var dayStr = parts.length === 3 ? ';
      html += '        parseInt(parts[2]) + "." + ';
      html += '        parseInt(parts[1]) : d.day;';
      html += '        bar.onclick = (function(dateStr, sum, el) { ';
      html += '          return function() { ';
      html += '            showBarInfo(el, dateStr, sum); };';
      html += '        })(dayStr, d.total, bar);';
      html += '        col.appendChild(bar);';
      html += '        var lbl = document.createElement("div");';
      html += '        lbl.className = "bar-lbl";';
      html += '        lbl.textContent = dayStr;';
      html += '        col.appendChild(lbl);';
      html += '        wrap.appendChild(col);';
      html += '      });';
      
      html += '      cont.appendChild(wrap);';
      html += '      chartCard.appendChild(cont);';
      html += '      var info = document.createElement("div");';
      html += '      info.id = "chartInfo";';
      html += '      info.className = "chart-info";';
      html += '      info.textContent = "Нажмите на столбик";';
      html += '      chartCard.appendChild(info);';
      html += '      c.appendChild(chartCard);';
      html += '    }';

      html += '  } else if (currentTab === "loss") {';
      html += '    var cardL = document.createElement("div"); ';
      html += '    cardL.className = "card"; ';
      html += '    cardL.style.border = "2px solid var(--f-accent)";';
      html += '    var vL = document.createElement("div"); ';
      html += '    vL.className = "val red"; ';
      html += '    vL.textContent = fmtMoney(l.total);';
      html += '    var lblL = document.createElement("div"); ';
      html += '    lblL.className = "lbl"; ';
      html += '    lblL.textContent = "Потери (" + l.percent + ';
      html += '    "% от закупок)";';
      html += '    cardL.appendChild(vL); cardL.appendChild(lblL); ';
      html += '    c.appendChild(cardL);';

      html += '    var reasons = { spoilage: "Порча", loss: "Потеря", ';
      html += '    markdown: "Уценка", sorting: "Пересорт" };';
      html += '    var listCard = document.createElement("div"); ';
      html += '    listCard.className = "card";';
      html += '    listCard.style.textAlign = "left";';
      html += '    for (var key in reasons) {';
      html += '      var amt = l.reasons[key] || 0;';
      html += '      if (amt > 0) {';
      html += '        var row = document.createElement("div"); ';
      html += '        row.className = "list-item";';
      html += '        var n = document.createElement("span"); ';
      html += '        n.textContent = reasons[key];';
      html += '        var v = document.createElement("span"); ';
      html += '        v.style = "font-weight:800; color:var(--f-danger);";';
      html += '        v.textContent = fmtMoney(amt);';
      html += '        row.appendChild(n); row.appendChild(v); ';
      html += '        listCard.appendChild(row);';
      html += '      }';
      html += '    }';
      html += '    c.appendChild(listCard);';

      html += '  } else if (currentTab === "top") {';
      html += '    var topCard = document.createElement("div"); ';
      html += '    topCard.className = "card";';
      html += '    topCard.style.textAlign = "left";';
      html += '    if (reportData.top.length === 0) {';
      html += '      topCard.textContent = "Нет продаж";';
      html += '      topCard.style.textAlign = "center";';
      html += '    } else {';
      html += '      reportData.top.forEach(function(t, idx) {';
      html += '        var row = document.createElement("a"); ';
      html += '        row.className = "list-item";';
      html += '        row.style.textDecoration = "none"; ';
      html += '        row.style.color = "var(--f-text)";';
      html += '        row.href = "/warehouse/item?id=" + t.shop_item_id;';
      html += '        var n = document.createElement("span"); ';
      html += '        n.textContent = (idx+1) + ". " + t.name + ';
      html += '        " (" + fmtNum(t.total_qty) + " шт) →";';
      html += '        var v = document.createElement("span"); ';
      html += '        v.style = "font-weight:800; color:var(--f-success);";';
      html += '        v.textContent = fmtMoney(t.total_rev);';
      html += '        row.appendChild(n); row.appendChild(v); ';
      html += '        topCard.appendChild(row);';
      html += '      });';
      html += '    }';
      html += '    c.appendChild(topCard);';

      html += '  } else if (currentTab === "move") {';
      html += '    var m = reportData.movement;';
      html += '    var mCard = document.createElement("div"); ';
      html += '    mCard.className = "card";';
      html += '    mCard.style.textAlign = "left";';
      
      html += '    var r1 = document.createElement("div"); ';
      html += '    r1.className = "list-item";';
      html += '    var n1 = document.createElement("span"); ';
      html += '    n1.textContent = "Приход (закупка)";';
      html += '    var v1 = document.createElement("span"); ';
      html += '    v1.style = "color:var(--f-success); font-weight:800;";';
      html += '    v1.textContent = fmtMoney(m.receipts);';
      html += '    r1.appendChild(n1); r1.appendChild(v1); ';
      html += '    mCard.appendChild(r1);';
      
      html += '    var r2 = document.createElement("div"); ';
      html += '    r2.className = "list-item";';
      html += '    var n2 = document.createElement("span"); ';
      html += '    n2.textContent = "Продажи (выручка)";';
      html += '    var v2 = document.createElement("span"); ';
      html += '    v2.style = "color:#3C7A89; font-weight:800;";';
      html += '    v2.textContent = fmtMoney(m.sales);';
      html += '    r2.appendChild(n2); r2.appendChild(v2); ';
      html += '    mCard.appendChild(r2);';
      
      html += '    var r3 = document.createElement("div"); ';
      html += '    r3.className = "list-item";';
      html += '    var n3 = document.createElement("span"); ';
      html += '    n3.textContent = "Списания (потери)";';
      html += '    var v3 = document.createElement("span"); ';
      html += '    v3.style = "color:var(--f-danger); font-weight:800;";';
      html += '    v3.textContent = "-" + fmtMoney(m.writeoffs);';
      html += '    r3.appendChild(n3); r3.appendChild(v3); ';
      html += '    mCard.appendChild(r3);';
      
      html += '    c.appendChild(mCard);';
      html += '  }';
      html += '}';

      html += 'setQuick("month");';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
}

module.exports = { setupWarehouseViewsDocs };