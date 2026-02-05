const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 获取商品列表
router.get('/', async (req, res) => {
  try {
    console.log('=== 开始执行数据库查询 ===');
    // 执行查询
    const [rows] = await db.execute('SELECT * FROM goods');
    // 返回结果
    res.status(200).json({
      code: 200,
      message: '获取商品列表成功',
      data: rows
    });
  } catch (error) {
    // 强制打印完整错误（重点！）
    console.error('=== 数据库查询错误 ===');
    console.error('错误类型：', error.name);
    console.error('错误信息：', error.message);
    console.error('错误堆栈：', error.stack);
    // 返回友好提示
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message // 调试用，生产环境可删除
    });
  }
});

module.exports = router;