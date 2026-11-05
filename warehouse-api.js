const { setupWarehouseAuth } = require('./warehouse-auth');
// Позже добавим:
// const { setupWarehouseStock } = require('./warehouse-stock');
// const { setupWarehouseSales } = require('./warehouse-sales');

function setupWarehouseApi(app, bot, s3ctx, getAuth) {
  setupWarehouseAuth(app, bot, s3ctx, getAuth);
  
  // setupWarehouseStock(app, bot, s3ctx, getAuth);
  // setupWarehouseSales(app, bot, s3ctx, getAuth);
}

module.exports = { setupWarehouseApi };