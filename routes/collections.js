const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 获取收藏列表
router.get('/query', async (req, res) => {
  try {
    console.log('=== 开始执行数据库查询 ===');
    // 执行查询
    const [rows] = await db.execute('SELECT * FROM collections');
    // 返回结果
    res.status(200).json({
      code: 200,
      message: '获取收藏列表成功',
      data: rows
    });
  } catch (error) {
    // 强制打印完整错误（重点！）
    console.error('=== 数据库查询错误 ===');
    // 返回友好提示
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message // 调试用，生产环境可删除
    });
  }
});

// 新增收藏
router.post('/add', async (req, res) => {
  try {
    // 1. 获取请求体中的数据--前端入参
    const { content } = req.body;
    // 2. 执行插入SQL（用?占位符防止SQL注入）
    const [result] = await db.execute(
      'INSERT INTO collections (content) VALUES (?)',
      [content] // 给可选字段设默认值
    );

    // 4. 返回成功响应（包含新增商品的ID）
    res.status(200).json({
      code: 200,
      message: '收藏成功',
      data: {
        id: result.id, // result为上述插入SQL执行后的结果--这里的返回结果可以不用返回给前端
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
});

router.delete('/delete/:id', async (req, res) => {
  try {
    // 1. 获取请求参数中的ID
    const {id} = req.params;
    // 2. 必填入参校验--非空
    if (!id) {
      return res.status(400).json({
        code: 400,
        message: '收藏ID不能为空'
      });
    }
    const collectionsId = Number(id); // 转换为数字
    // 3. 先检查对应ID的收藏是否存在
    const [checkResult] = await db.execute('SELECT * FROM collections WHERE id=?', [collectionsId]);
    if (checkResult.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '删除失败，该收藏不存在'
      });
    }
    // 4. 执行删除SQL（用?占位符防SQL注入）
    await db.execute('DELETE FROM collections WHERE id=?', [collectionsId]);
    // 5. 返回成功响应
    res.status(200).json({
      code: 200,
      message: '收藏删除成功',
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
})

module.exports = router;