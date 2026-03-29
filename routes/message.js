const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 1. 发送消息接口
router.post('/send', async (req, res) => {
  try {
    const { sender_id, receiver_id, order_id, content } = req.body;
    // 参数严格校验，拦截undefined
    if (!sender_id || !receiver_id || !order_id || !content?.trim()) {
      return res.status(400).json({ 
        code: 400, 
        message: '参数错误：sender_id/receiver_id/order_id/content 不能为空' 
      });
    }

    // 用户禁用拦截
    const [userRows] = await db.execute('SELECT user_status FROM users WHERE user_id = ?', [sender_id]);
    if (userRows.length === 0 || userRows[0].user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号异常，无法发送消息' });
    }

    // 插入消息
    await db.execute(`
      INSERT INTO messages (sender_id, receiver_id, order_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, NOW())
    `, [sender_id, receiver_id, order_id, content]);

    res.json({ code: 200, message: '发送成功' });
  } catch (err) {
    console.error('发送消息失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 2. 消息列表接口（按订单+用户筛选）
router.post('/list', async (req, res) => {
  try {
    const { user_id, to_user_id, order_id } = req.body;
    if (!user_id || !to_user_id || !order_id) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    // 查询聊天记录
    const [msgList] = await db.execute(`
      SELECT * FROM messages 
      WHERE (sender_id = ? AND receiver_id = ? AND order_id = ?)
         OR (sender_id = ? AND receiver_id = ? AND order_id = ?)
      ORDER BY created_at ASC
    `, [user_id, to_user_id, order_id, to_user_id, user_id, order_id]);

    res.json({ code: 200, data: msgList });
  } catch (err) {
    console.error('获取消息列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 3. 会话列表接口（最终极简版，彻底解决格式错误+会话分裂）
router.post('/sessionList', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    // 🔥 最终安全版：完全兼容 ONLY_FULL_GROUP_BY，不报错、会话正确合并
    const [sessions] = await db.query(`
      SELECT 
        other_user_id AS to_user_id,
        order_id,
        MAX(created_at) AS last_time,
        MAX(content) AS last_msg,
        SUM(CASE WHEN receiver_id = ? AND is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
        MAX(u.nick_name) AS nickname,
        'https://picsum.photos/id/1005/100/100' AS avatar_url
      FROM (
        SELECT 
          m.*,
          CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AS other_user_id
        FROM messages m
        WHERE m.sender_id = ? OR m.receiver_id = ?
      ) AS filtered
      LEFT JOIN users u ON filtered.other_user_id = u.user_id
      GROUP BY other_user_id, order_id
      ORDER BY last_time DESC
    `, [user_id, user_id, user_id, user_id]);

    res.json({ code: 200, data: sessions });
  } catch (err) {
    console.error('获取会话列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 4. 标记消息已读
router.post('/markRead', async (req, res) => {
  try {
    const { user_id, to_user_id, order_id } = req.body;
    if (!user_id || !to_user_id || !order_id) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    await db.execute(`
      UPDATE messages 
      SET is_read = 1 
      WHERE receiver_id = ? AND sender_id = ? AND order_id = ? AND is_read = 0
    `, [user_id, to_user_id, order_id]);

    res.json({ code: 200, message: '标记成功' });
  } catch (err) {
    console.error('标记已读失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;