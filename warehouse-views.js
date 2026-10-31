const core = require('./warehouse-views-core');
const inventory = require('./warehouse-views-inventory');
const sales = require('./warehouse-views-sales');
const docs = require('./warehouse-views-docs');

function setupWarehouseViews(app, bot, s3ctx, getAuth, 
  fmtNum, translateReason, esc, getUnifiedMenu, 
  metaSafari, fontLink, uiScript) {

  // 1. Подключаем базовые экраны (Логин, Главная)
  core.setupWarehouseViewsCore(app, bot, s3ctx, getAuth);

  // 2. Подключаем экраны Обзора и Товаров
  inventory.setupWarehouseViewsInventory(app, bot, s3ctx, getAuth);

  // 3. Подключаем экраны Кассы, Приходов и Списаний
  sales.setupWarehouseViewsSales(app, bot, s3ctx, getAuth);

  // 4. Подключаем экраны Документов и Отчетов
  docs.setupWarehouseViewsDocs(app, bot, s3ctx, getAuth);
}

// Экспортируем утилиты для совместимости с warehouse-ui.js и warehouse-api.js
module.exports = { 
  setupWarehouseViews,
  esc: core.esc, 
  fmtNum: core.fmtNum, 
  translateReason: core.translateReason, 
  getUnifiedMenu: core.getUnifiedMenu, 
  getIconSvg: core.getIconSvg,
  metaSafari: core.metaSafari, 
  fontLink: core.fontLink, 
  uiScript: core.uiScript 
};