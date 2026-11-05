const { setupWarehouseAuth } = require('./warehouse-auth');
const { setupWarehouseStock } = require('./warehouse-stock');
// Позже добавим:
// const { setupWarehouseSales } = require('./warehouse-sales');

function setupWarehouseApi(app, bot, s3ctx, getAuth) {
  setupWarehouseAuth(app, bot, s3ctx, getAuth);
  setupWarehouseStock(app, bot, s3ctx, getAuth);
  
  // setupWarehouseSales(app, bot, s3ctx, getAuth);
}

module.exports = { setupWarehouseApi };