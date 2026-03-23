// 微信登录报错调整为下方写法
// const mysql = require('mysql2');
// require('dotenv').config();
// // 构建连接配置（处理无密码场景）
// const dbConfig = {
//   host: process.env.DB_HOST || '127.0.0.1 ',
//   user: process.env.DB_USER || 'root',
//   database: process.env.DB_NAME || 'shop',
//   port: process.env.DB_PORT || 3306,
//   charset: 'utf8mb4',
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
//   timezone: '+08:00',  // 指定连接时区为东八区
//   dateStrings: true // 让 DATETIME 直接返回 "YYYY-MM-DD HH:mm:ss" 格式字符串
// };
// // 只有当密码不为空时，才添加 password 配置（关键）
// if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.trim() !== '') {
//   dbConfig.password = process.env.DB_PASSWORD.trim();
// }
// // 创建连接池
// const pool = mysql.createPool(dbConfig);
// // 测试连接（启动时验证）
// pool.getConnection((err, connection) => {
//   if (err) {
//     console.error('=== MySQL 连接失败 ===', err.message);
//     return;
//   }
//   console.log('=== MySQL 连接成功 ===');
//   connection.release(); // 释放连接
// });
// module.exports = pool.promise();

const mysql = require('mysql2/promise'); // 直接引入 promise 版本
require('dotenv').config();

// 构建连接配置
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  database: process.env.DB_NAME || 'shop',
  port: process.env.DB_PORT || 3306,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00',
  dateStrings: true
};

// 处理密码配置
if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.trim() !== '') {
  dbConfig.password = process.env.DB_PASSWORD.trim();
}

// 创建 Promise 版连接池
const pool = mysql.createPool(dbConfig);

// 测试连接（Promise 写法）
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('=== MySQL 连接成功 ===');
    connection.release();
  } catch (err) {
    console.error('=== MySQL 连接失败 ===', err.message);
  }
}
testConnection();

module.exports = pool; // 直接导出 pool，已经是 promise 版