const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/query', async (req, res) => {
  try {
    // 1. 获取查询参数：name（商品名称关键词，可选）
    const { name } = req.query;

     // 2. 构建SQL语句和参数（支持过滤/全量查询）
    let sql = 'SELECT * FROM category';
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

// 添加分类
router.post('/add', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        code: 400,
        message: '分类名称不能为空'
      });
    }

    // 检查分类是否已存在
    const [exist] = await db.execute(
      'SELECT category_id FROM category WHERE name = ?',
      [name.trim()]
    );
    if (exist.length > 0) {
      return res.status(400).json({
        code: 400,
        message: '该分类名称已存在'
      });
    }
    // 插入新分类
    const [result] = await db.execute(
      'INSERT INTO category (name, sort, status) VALUES (?, 0, 1)',
      [name.trim()]
    );

    // 关键：检查 result 是否存在，并正确获取 insertId
    if (result && result.insertId) {
      res.json({
        code: 200,
        message: '添加分类成功',
        data: {
          id: result.insertId,
          name: name.trim()
        }
      });
    } else {
      // 如果获取不到 insertId，也返回成功，但不返回 ID
      res.json({
        code: 200,
        message: '添加分类成功',
        data: {
          name: name.trim()
        }
      });
    }
  } catch (err) {
    console.error('添加分类错误:', err); // 查看终端的详细错误信息
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

// 编辑分类
router.put('/edit/:category_id', async (req, res) => {
  try {
    const { category_id } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        code: 400,
        message: '分类名称不能为空'
      });
    }

    // 检查分类是否存在
    const [exist] = await db.execute(
      'SELECT category_id FROM category WHERE category_id = ?',
      [category_id]
    );
    if (exist.length === 0) {
      return res.status(400).json({
        code: 400,
        message: '分类不存在'
      });
    }

    // 检查新名称是否与其他分类重名
    const [sameName] = await db.execute(
      'SELECT category_id FROM category WHERE name = ? AND category_id != ?',
      [name.trim(), category_id]
    );
    if (sameName.length > 0) {
      return res.status(400).json({
        code: 400,                    
        message: '该分类名称已被其他分类使用'
      });
    }

    // 更新分类名称
    await db.execute(
      'UPDATE category SET name = ? WHERE category_id = ?',
      [name.trim(), category_id]
    );

    res.json({
      code: 200,
      message: '编辑分类成功'
    });
  } catch (err) {
    console.error('编辑分类错误:', err);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

// 删除分类
router.delete('/delete/:category_id', async (req, res) => {
  try {
    const { category_id } = req.params;

    // 检查分类是否存在
    const [exist] = await db.execute(
      'SELECT category_id FROM category WHERE category_id = ?',
      [category_id]
    );
    if (exist.length === 0) {
      return res.status(400).json({
        code: 400,
        message: '分类不存在'
      });
    }

    // 检查是否有商品关联该分类（可选，防止误删）
    const [goods] = await db.execute(
      'SELECT category_id FROM goods WHERE category_id = ?',
      [category_id]
    );
    if (goods.length > 0) {
      return res.status(400).json({
        code: 400,
        message: '该分类下还有商品，无法删除'
      });
    }

    // 删除分类
    await db.execute(
      'DELETE FROM category WHERE category_id = ?',
      [category_id]
    );

    res.json({
      code: 200,
      message: '删除分类成功'
    });
  } catch (err) {
    console.error('删除分类错误:', err);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

module.exports = router;