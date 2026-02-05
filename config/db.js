const mysql = require('mysql2');
require('dotenv').config();

// 构建连接配置（处理无密码场景）
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1 ',
  user: process.env.DB_USER || 'root',
  database: process.env.DB_NAME || 'shop',
  port: process.env.DB_PORT || 3306,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 只有当密码不为空时，才添加 password 配置（关键）
if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.trim() !== '') {
  dbConfig.password = process.env.DB_PASSWORD.trim();
}

// 创建连接池
const pool = mysql.createPool(dbConfig);

// 测试连接（启动时验证）
pool.getConnection((err, connection) => {
  if (err) {
    console.error('=== MySQL 连接失败 ===', err.message);
    return;
  }
  console.log('=== MySQL 连接成功 ===');
  connection.release(); // 释放连接
});

module.exports = pool.promise();