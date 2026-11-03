const { Pool } = require('pg');
require('dotenv').config();

// Убираем sslmode из строки подключения
// Задаём SSL только через опции
let connectionString = process.env.DATABASE_URL || '';
connectionString = connectionString.replace(/\?.*$/, '');

if (!connectionString) {
  console.error('❌ DATABASE_URL не задан в переменных окружения');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
  statement_timeout: 15000
});

pool.connect(function(err, client, release) {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
    return;
  }
  console.log('✅ Успешное подключение к PostgreSQL');
  release();
});

// Graceful shutdown (мягкая остановка)
process.on('SIGTERM', function() {
  console.log('🛑 Завершение работы. Закрываем пул БД...');
  pool.end().then(function() {
    console.log('✅ Пул БД закрыт');
    process.exit(0);
  }).catch(function(e) {
    console.error('Ошибка при закрытии пула:', e.message);
    process.exit(1);
  });
});

module.exports = pool;