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
    const { user_id, contact_name, contact_phone, province, city, district, street, detail_address, is_default } = req.body;
    if (!user_id || !contact_name || !contact_phone || !province || !city || !district || !street || !detail_address) {
      return res.status(400).json({ code: 400, message: '参数不完整' });
    }

    // 1. 新增重复地址校验
    const [existingAddress] = await pool.execute(`
      SELECT address_id FROM address
      WHERE user_id = ? 
        AND contact_name = ? 
        AND contact_phone = ? 
        AND province = ? 
        AND city = ? 
        AND district = ? 
        AND street = ? 
        AND detail_address = ?
      LIMIT 1
    `, [user_id, contact_name, contact_phone, province, city, district, street, detail_address]);

    if (existingAddress.length > 0) {
      // 地址已存在，直接返回已有地址ID，不再新增
      return res.json({
        code: 200,
        message: '地址已存在',
        data: { address_id: existingAddress[0].address_id }
      });
    }

    // 2. 正常的新增地址逻辑
    await pool.execute(`
      INSERT INTO address (user_id, contact_name, contact_phone, province, city, district, street, detail_address, is_default, created_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [user_id, contact_name, contact_phone, province, city, district, street, detail_address, is_default || 0]);

    res.json({ code: 200, message: '地址添加成功' });
  } catch (err) {
    console.error('添加地址失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});
// 3. 修改地址
router.post('/update', async (req, res) => {
  try {
    const { address_id, user_id, contact_name, contact_phone, province, city, district, street, detail_address, is_default } = req.body;
    const userId = parseInt(user_id);
    // 校验必填项
    if (!address_id || !contact_name || !contact_phone || !detail_address) {
      return res.status(400).json({ code: 400, msg: '信息不完整' });
    }
    // 如果设为默认，先取消其他默认
    if (is_default == 1) {
      await pool.query('UPDATE address SET is_default=0 WHERE user_id=?', [userId]);
    }

    const [result] = await pool.query(
      'UPDATE address SET contact_name=?, contact_phone=?, province=?, city=?, district=?, street=?, detail_address=?, is_default=? WHERE address_id=? AND user_id=?',
      [contact_name, contact_phone, province, city, district, street, detail_address, is_default, address_id, userId]
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