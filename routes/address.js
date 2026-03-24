const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. 获取地址列表（支持数字/字符串 user_id）
router.get('/list', async (req, res) => {
  try {
    const user_id = parseInt(req.query.user_id); // 强制转为数字，确保一致性
    if (isNaN(user_id)) {
      return res.status(400).json({ code: 400, msg: '用户ID无效' });
    }
    const [list] = await pool.query(
      'SELECT * FROM address WHERE user_id = ? ORDER BY is_default DESC, created_time DESC',
      [user_id]
    );
    res.json({ code: 200, data: list });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '获取失败' });
  }
});

// 2. 新增地址
router.post('/add', async (req, res) => {
  try {
    const { user_id, name, phone, province, city, county, detail, is_default } = req.body;
    // 强制转为数字，确保一致性
    const userId = parseInt(user_id);
    if (is_default == 1) {
      await pool.query('UPDATE address SET is_default=0 WHERE user_id=?', [userId]);
    }

    const [result] = await pool.query(
      'INSERT INTO address (user_id, name, phone, province, city, county, detail, is_default) VALUES (?,?,?,?,?,?,?,?)',
      [userId, name, phone, province || '上海市', city || '上海市', county || '闵行区', detail, is_default || 0]
    );

    res.json({ code: 200, msg: '添加成功', address_id: result.insertId });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '添加失败' });
  }
});
// 3. 修改地址
router.post('/update', async (req, res) => {
  try {
    const { address_id, user_id, name, phone, province, city, county, detail, is_default } = req.body;
    const userId = parseInt(user_id);
    // 校验必填项
    if (!address_id || !name || !phone || !detail) {
      return res.status(400).json({ code: 400, msg: '信息不完整' });
    }
    // 如果设为默认，先取消其他默认
    if (is_default == 1) {
      await pool.query('UPDATE address SET is_default=0 WHERE user_id=?', [userId]);
    }

    const [result] = await pool.query(
      'UPDATE address SET name=?, phone=?, province=?, city=?, county=?, detail=?, is_default=? WHERE address_id=? AND user_id=?',
      [name, phone, province, city, county, detail, is_default, address_id, userId]
    );

    res.json({ code: 200, msg: '修改成功' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '修改失败' });
  }
});

// 4. 删除地址
router.post('/delete', async (req, res) => {
  try {
    const { address_id, user_id } = req.body;
    const userId = parseInt(user_id);
    if (!address_id || !userId) {
      return res.status(400).json({ code: 400, msg: '参数错误' });
    }
    await pool.query('DELETE FROM address WHERE address_id=? AND user_id=?', [address_id, userId]);
    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '删除失败' });
  }
});
module.exports = router;