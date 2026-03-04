const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 获取商品列表
router.get('/query', async (req, res) => {
  try {
    // 1. 获取查询参数：name（商品名称关键词，可选）
    const { name } = req.query;

     // 2. 构建SQL语句和参数（支持过滤/全量查询）
    let sql = 'SELECT * FROM goods';
    const params = [];
    // 如果传了name参数，添加模糊查询条件
    if (name && name.trim() !== '') {
      sql += ' WHERE name LIKE ?';
      params.push(`%${name.trim()}%`); // % 是MySQL模糊查询通配符，匹配任意字符序列
    }

    // 3. 执行查询--params需要过滤的参数数组
    const [rows] = await db.execute(sql, params); // 注意：此处用的是execute而非query，因为我们要获取插入行的ID
    // 4. 返回结果
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

// 新增商品
router.post('/add', async (req, res) => {
  try {
    // 1. 获取请求体中的数据--前端入参
    const { name, price, description, status, image_url } = req.body;
    // 2. 参数校验（必填项检查）
    if (!name) {
      return res.status(400).json({
        code: 400,
        message: '商品名称不能为空'
      });
    }
    if (!price || isNaN(price) || price <= 0) {
      return res.status(400).json({
        code: 400,
        message: '商品价格不能为空且必须是正数'
      });
    }
    // 3. 执行插入SQL（用?占位符防止SQL注入）
    const [result] = await db.execute(
      'INSERT INTO goods (name, price, description, status, image_url) VALUES (?, ?, ?, ?, ?)',
      [name, Number(price), description || null, status ?? 1, image_url || null] // 给可选字段设默认值
    );

    // 4. 返回成功响应（包含新增商品的ID）
    res.status(200).json({
      code: 200,
      message: '商品添加成功',
      data: {
        goods_id: result.goods_id, // result为上述插入SQL执行后的结果--这里的返回结果可以不用返回给前端
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
    const {goods_id} = req.params;
    // 2. 必填入参校验--非空
    if (!goods_id) {
      return res.status(400).json({
        code: 400,
        message: '商品ID不能为空'
      });
    }
    const goodsId = Number(goods_id); // 转换为数字
    // 3. 先检查对应ID的商品是否存在
    const [checkResult] = await db.execute('SELECT * FROM goods WHERE goods_id=?', [goodsId]);
    if (checkResult.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '删除失败，该商品不存在'
      });
    }
    // 4. 执行删除SQL（用?占位符防SQL注入）
    await db.execute('DELETE FROM goods WHERE goods_id=?', [goodsId]);
    // 5. 返回成功响应
    res.status(200).json({
      code: 200,
      message: '商品删除成功',
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
})

// 发布商品接口
router.post('/publish', async (req, res) => {
  const { name, price, category_id, user_id, description } = req.body;
  console.log('开始发布商品:', { name, price, category_id, user_id });

  // 参数校验
  if (!name || !price || !user_id || !category_id) {
    return res.status(400).json({ code: -1, msg: '缺少必填参数' });
  }
  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json({ code: -1, msg: '价格必须是大于0的数字' });
  }
  if (!Number.isInteger(user_id) || user_id <= 0 || !Number.isInteger(category_id) || category_id <= 0) {
    return res.status(400).json({ code: -1, msg: '用户ID和分类ID必须是正整数' });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // 校验用户是否存在
    const [[user]] = await connection.query('SELECT 1 FROM users WHERE user_id = ? LIMIT 1', [user_id]);
    if (!user) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: -1, msg: '用户不存在' });
    }

    // 校验分类是否存在
    const [[category]] = await connection.query('SELECT 1 FROM category WHERE category_id = ? LIMIT 1', [category_id]);
    if (!category) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: -1, msg: '分类不存在' });
    }

    // 插入商品数据
    const [result] = await connection.execute(
      'INSERT INTO goods (name, price, category_id, user_id, description, status) VALUES (?, ?, ?, ?, ?, 0)',
      [name, price, category_id, user_id, description]
    );

    await connection.commit();
    connection.release();
    console.log('商品发布成功:', { goodsId: result.insertId });
    res.status(200).json({ code: 0, msg: '发布成功, 等待审核', goodsId: result.insertId });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('发布商品失败:', err);
    res.status(500).json({ code: -1, msg: '发布失败', error: err.message });
  }
});
module.exports = router;