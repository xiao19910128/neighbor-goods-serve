const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 1. 发送消息接口
router.post('/send', async (req, res) => {
  try {
    const { sender_id, receiver_id, order_id, content, session_id: clientSessionId } = req.body;
    if (!sender_id || !receiver_id || !content?.trim()) {
      return res.status(400).json({
        code: 400,
        message: '参数错误：sender_id/receiver_id/content 不能为空'
      });
    }
    const [userRows] = await db.execute('SELECT user_status FROM users WHERE user_id = ?', [sender_id]);
    if (userRows.length === 0 || userRows[0].user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号异常，无法发送消息' });
    }
    let session_id;
    // 前端传的session_id是通过getSessionByUserPair接口下发的，直接信任！不再校验是否存在
    if (clientSessionId) {
      const numSession = Number(clientSessionId);
      if (!isNaN(numSession)) {
        session_id = numSession;
      }
    }
    if (!session_id) {
      session_id = Date.now();
    }

    // 插入消息（一定是前端传的那个 session_id）
    await db.execute(`
      INSERT INTO messages (session_id, sender_id, receiver_id, order_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, NOW())
    `, [session_id, sender_id, receiver_id, order_id || null, content]);

    // ✅ 返回的一定是前端传的 session_id
    res.json({ code: 200, message: '发送成功', session_id });

  } catch (err) {
    console.error('发送消息失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误', error: err.message });
  }
});

// 2. 消息列表接口（按订单+用户筛选）
router.get('/list', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ code: 400, message: 'user_id 不能为空' });
    }
    // 按 session_id 分组，合并同一对用户的消息
    // 1. 先查出当前用户所有会话的基础信息
    const [sessions] = await db.execute(`
      SELECT 
        session_id,
        MAX(created_at) AS last_time,
        (SELECT content FROM messages WHERE session_id = m.session_id ORDER BY created_at DESC LIMIT 1) AS content,
        COUNT(CASE WHEN is_read = 0 AND sender_id != ? THEN 1 END) AS unread_count,
        IF(MAX(sender_id) = ?, MAX(receiver_id), MAX(sender_id)) AS other_user_id, 'https://picsum.photos/id/1005/100/100' AS avatar_url
      FROM messages m
      WHERE sender_id = ? OR receiver_id = ?
      GROUP BY session_id
      ORDER BY last_time DESC
    `, [user_id, user_id, user_id, user_id]);

    if (sessions.length === 0) {
      return res.json({ code: 200, data: [] });
    }

    // 2. 再根据会话里的 other_user_id，批量查出用户名
    const otherUserIds = sessions.map(s => s.other_user_id);
    const [users] = await db.execute(`
      SELECT user_id, username FROM users WHERE user_id IN (${otherUserIds.join(',')})
    `);

    // 合并数据
    const userMap = {};
    users.forEach(u => userMap[u.user_id] = u.username);
    const list = sessions.map(s => ({
      ...s,
      username: userMap[s.other_user_id] || ''
    }));

    res.json({ code: 200, data: list });
  } catch (err) {
    console.error('获取消息列表失败:', err);
    res.status(500).json({ 
      code: 500, 
      message: '服务器错误',
      error: err.message 
    });
  }
});
// 3. 会话列表接口
// router.post('/sessionList', async (req, res) => {
//   try {
//     const { user_id } = req.body;
//     if (!user_id) {
//       return res.status(400).json({ code: 400, message: '参数错误' });
//     }

//     // 完全兼容 ONLY_FULL_GROUP_BY，不报错、会话正确合并
//     const [sessions] = await db.query(`
//       SELECT 
//         other_user_id AS to_user_id,
//         order_id,
//         MAX(created_at) AS last_time,
//         MAX(content) AS last_msg,
//         SUM(CASE WHEN receiver_id = ? AND is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
//         MAX(u.nick_name) AS nickname,
//         'https://picsum.photos/id/1005/100/100' AS avatar_url
//       FROM (
//         SELECT 
//           m.*,
//           CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AS other_user_id
//         FROM messages m
//         WHERE m.sender_id = ? OR m.receiver_id = ?
//       ) AS filtered
//       LEFT JOIN users u ON filtered.other_user_id = u.user_id
//       GROUP BY other_user_id, order_id
//       ORDER BY last_time DESC
//     `, [user_id, user_id, user_id, user_id]);

//     res.json({ code: 200, data: sessions });
//   } catch (err) {
//     console.error('获取会话列表失败:', err);
//     res.status(500).json({ code: 500, message: '服务器错误' });
//   }
// });

// 4. 标记消息已读
router.post('/markRead', async (req, res) => {
  try {
    const { user_id, to_user_id, order_id } = req.body;
    if (!user_id || !to_user_id) {
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

// 单会话聊天记录接口----对话框中的消息信息
router.get('/history', async (req, res) => {
  try {
    const { session_id, user_id } = req.query;
    if (!session_id || !user_id) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    // 拉取该会话下的所有消息，按时间排序
    const [messages] = await db.execute(`
      SELECT 
        id, sender_id, receiver_id, content, is_read, created_at
      FROM messages
      WHERE session_id = ?
        AND (sender_id = ? OR receiver_id = ?)
      ORDER BY created_at ASC
    `, [session_id, user_id, user_id]);

    // 顺便标记为已读（可选）
    await db.execute(`
      UPDATE messages SET is_read = 1
      WHERE session_id = ? AND receiver_id = ? AND is_read = 0
    `, [session_id, user_id]);

    res.json({ code: 200, data: messages });
  } catch (err) {
    console.error('获取聊天记录失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 根据 买家ID 和 卖家ID 获取或创建会话（用于订单沟通按钮）
router.get('/getSessionByUserPair', async (req, res) => {
  try {
    const { user1_id, user2_id } = req.query;

    // 排序，保证 A-B 和 B-A 是同一个会话
    const [a, b] = [parseInt(user1_id), parseInt(user2_id)].sort((x, y) => x - y);

    const [rows] = await db.execute(`
      SELECT DISTINCT session_id 
      FROM messages 
      WHERE (sender_id = ? AND receiver_id = ?) 
         OR (sender_id = ? AND receiver_id = ?)
      LIMIT 1
    `, [a, b, b, a]);

    let session_id;
    if (rows.length > 0) {
      session_id = rows[0].session_id;
    } else {
      // 没有会话就创建一个临时ID（发送第一条消息时会自动保存）
      session_id = Date.now();
    }

    res.json({ code: 200, session_id });
  } catch (err) {
    res.status(500).json({ code: 500, message: '获取会话失败' });
  }
});

module.exports = router;