// routes/admin/category.js
const express = require('express');
const router = express.Router();
const db = require('../../config/db');

// 1. 管理端-添加分类
router.post('/add', async (req, res) => {
  try {
    const { name, sort = 0 } = req.body;
    if (!name) {
      return res.status(400).json({ code: 400, message: '分类名称不能为空' });
    }

    // 检查分类是否已存在
    const [exist] = await db.execute('SELECT id FROM category WHERE name = ?', [name]);
    if (exist.length > 0) {
      return res.status(400).json({ code: 400, message: '该分类已存在' });
    }

    // 添加分类
    const [result] = await db.execute(
      'INSERT INTO category (name, sort) VALUES (?, ?)',
      [name, sort]
    );

    res.json({ code: 200, message: '添加分类成功', data: { id: result.insertId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 2. 管理端-编辑分类
router.put('/edit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sort, status } = req.body;

    // 检查分类是否存在
    const [exist] = await db.execute('SELECT id FROM category WHERE id = ?', [id]);
    if (exist.length === 0) {
      return res.status(400).json({ code: 400, message: '分类不存在' });
    }

    // 编辑分类
    await db.execute(
      'UPDATE category SET name = ?, sort = ?, status = ? WHERE id = ?',
      [name, sort, status, id]
    );

    res.json({ code: 200, message: '编辑分类成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 3. 管理端-删除分类
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查分类是否被商品关联（可选）
    const [goods] = await db.execute('SELECT id FROM goods WHERE category_id = ?', [id]);
    if (goods.length > 0) {
      return res.status(400).json({ code: 400, message: '该分类下有商品，无法删除' });
    }

    // 删除分类
    await db.execute('DELETE FROM category WHERE id = ?', [id]);
    res.json({ code: 200, message: '删除分类成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 4. 查询所有启用的分类（客户端/管理端通用）
router.get('/list', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, name FROM category WHERE status = 1 ORDER BY sort DESC, id ASC'
    );
    res.json({ code: 200, message: '查询成功', data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});


module.exports = router;