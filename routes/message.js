const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. 获取消息列表（模拟会话）
router.get('/list', async (req, res) => {
  try {
    const userId = req.query.user_id;
    // 简化版：获取所有有过交易/发布的用户消息
    const [messages] = await pool.query(`
      SELECT DISTINCT u.user_id, u.nick_name, u.avatar_url 
      FROM users u 
      JOIN goods g ON u.user_id = g.user_id 
      WHERE g.user_id = ? OR g.user_id != ?
      LIMIT 10
    `, [userId, userId]);
    res.json({ code: 200, data: messages });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '获取失败' });
  }
});

module.exports = router;