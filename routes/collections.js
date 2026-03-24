const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.post('/toggle', async (req, res) => {
  try {
    const { user_id, goods_id } = req.body;
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

module.exports = router;