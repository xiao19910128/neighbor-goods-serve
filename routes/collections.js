const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.post('/toggle', async (req, res) => {
  try {
    const { user_id, goods_id } = req.body;
    // 校验当前用户是否被禁用
    const [userRows] = await pool.query(
      'SELECT user_status FROM users WHERE user_id = ?',
      [user_id]
    );
    // 如果用户是禁用状态，直接拦截
    if (userRows[0].user_status === 2) {
      return res.status(403).json({
        code: 403,
        message: '账号已被禁用，无法创建订单'
      });
    }
    const [exists] = await pool.query('SELECT * FROM collections WHERE user_id=? AND goods_id=?', [user_id, goods_id]);
    if (exists.length) {
      await pool.query('DELETE FROM collections WHERE user_id=? AND goods_id=?', [user_id, goods_id]);
      return res.json({ code: 200, msg: '取消收藏', isCollect: false });
    } else {
      await pool.query('INSERT INTO collections (user_id, goods_id) VALUES (?,?)', [user_id, goods_id]);
      return res.json({ code: 200, msg: '收藏成功', isCollect: true });
    }
  } catch (err) {
    res.status(500).json({ code: 500 });
  }
});

// 是否收藏
router.get('/status', async (req, res) => {
  const { user_id, goods_id } = req.query;
  const [rows] = await pool.query('SELECT * FROM collections WHERE user_id=? AND goods_id=?', [user_id, goods_id]);
  res.json({ code: 200, isCollect: rows.length > 0 });
});

router.get('/myList', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ code: 400, msg: '用户ID不能为空' });
    }

    // 查询收藏 + 关联商品信息（标题、图片、价格、状态）
    const [list] = await pool.query(`
      SELECT 
        c.*,
        g.goods_id,
        g.name,
        g.price,
        g.image_url,
        g.goods_status,
        g.province,
        g.city,
        g.district,
        g.detail_address
      FROM collections c
      LEFT JOIN goods g ON c.goods_id = g.goods_id
      WHERE c.user_id = ?
      ORDER BY c.id DESC
    `, [user_id]);

    // 处理图片数组（把字符串转成数组）
    const result = list.map(item => {
      try {
        item.images = JSON.parse(item.images || '[]');
      } catch (e) {
        item.images = [];
      }
      return item;
    });

    res.json({
      code: 200,
      data: result,
      msg: '获取收藏列表成功'
    });

  } catch (err) {
    console.error('❌ 获取收藏列表失败：', err);
    res.status(500).json({ code: 500, msg: '获取失败' });
  }
});

module.exports = router;