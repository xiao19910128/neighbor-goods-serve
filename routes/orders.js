const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 创建订单
router.post('/create', async (req, res) => {
  try {
    const { user_id, goods_id } = req.body;
    // 1. 参数校验（关键防御）
    if (!user_id || !goods_id) {
      return res.status(400).json({ code: 400, msg: '参数不完整' });
    }
    // 2. 统一转为数字，避免类型不匹配
    const userId = parseInt(user_id);
    const goodsId = parseInt(goods_id);
    if (isNaN(userId) || isNaN(goodsId)) {
      return res.status(400).json({ code: 400, msg: '参数格式错误' });
    }
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
    // 3. 查询商品信息（获取卖家ID、价格、标题）
    const [goods] = await pool.query('SELECT * FROM goods WHERE goods_id=?', [goods_id]);
    if (goods.length === 0) {
      return res.status(404).json({ code: 404, msg: '商品不存在' });
    }
    const goodsInfo = goods[0];
    const order_no = 'ORDER' + Date.now(); // 生成唯一订单号
    await pool.execute('UPDATE goods SET status=2 WHERE goods_id=?', [goods_id]);  // 锁定商品，防止重复下单
    // 4. 插入订单
    await pool.query(`
      INSERT INTO orders 
      (order_no, user_id, seller_id, goods_id, goods_title, goods_price, address_id, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      order_no,
      user_id,
      goodsInfo.user_id,
      goods_id,
      goodsInfo.name,
      goodsInfo.price,
      goodsInfo.address_id || null, // 默认地址ID，如果未提供则为null
    ]);
    res.json({ code: 200, msg: '下单成功', order_no });
  } catch (err) {
    res.status(500).json({ 
      code: 500, 
      msg: '服务器错误',
      error: err.message 
    });
  }
});

// 查询订单
router.get('/list', async (req, res) => {
  try {
    const { user_id, type } = req.query;
    let sql = `
      SELECT o.*, g.image_url, g.province, g.city, g.district, g.detail_address
      FROM orders o
      LEFT JOIN goods g ON o.goods_id = g.goods_id
      LEFT JOIN users u ON o.user_id = u.user_id
    `;
    if (type === 'buy') sql += ` WHERE o.user_id = ${user_id}`;
    if (type === 'sell') sql += ` WHERE o.seller_id = ${user_id}`;
    sql += ' ORDER BY o.order_id DESC';

    const [list] = await pool.query(sql);
    res.json({ code: 200, data: list });
  } catch (e) {
    res.status(500).json({ code: 500 });
  }
});

// 修改订单状态（退单释放商品 + 卖家完成订单 + 商品状态自动管理）
router.post('/updateStatus', async (req, res) => {
  let connection;
  try {
    const { order_id, status, user_id } = req.body;
    // 1. 必传参数校验
    if (!order_id || !status || !user_id) {
      return res.status(400).json({ code: 400, message: '参数不完整' });
    }
    // 2. 获取数据库连接
    connection = await pool.getConnection();
    // 校验当前用户是否被禁用
    const [userRows] = await connection.query(
      'SELECT user_status FROM users WHERE user_id = ?',
      [user_id]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    if (userRows[0].user_status === 2) {
      return res.status(403).json({
        code: 403,
        message: '账号已被禁用，无法操作订单'
      });
    }

    // 根据不同状态自动处理商品锁定/释放
    // 如果是【退单 / 取消订单】status = 5
    // → 商品恢复上架 status = 1
    if (status === 5) {
      const [orderRows] = await connection.query(
        'SELECT goods_id FROM orders WHERE order_id = ?',
        [order_id]
      );
      if (orderRows.length > 0) {
        const goods_id = orderRows[0].goods_id;
        // 退单 → 商品释放，重新显示
        await connection.query(
          'UPDATE goods SET status = 1 WHERE goods_id = ?',
          [goods_id]
        );
      }
    }

    // 如果是【卖家确认完成】status = 4
    // → 商品保持锁定
    if (status === 4) {
      const [orderResult] = await connection.query(
        'SELECT goods_id FROM orders WHERE order_id = ?',
        [order_id]
      );
      if (orderResult.length > 0) {
        await connection.query(
          'UPDATE goods SET audit_status = 4 WHERE goods_id = ?',
          [orderResult[0].goods_id]
        );
      }
    }

    // 统一更新订单状态
    await connection.query(
      'UPDATE orders SET status = ? WHERE order_id = ?',
      [status, order_id]
    );

    res.json({ code: 200, message: '状态更新成功' });
  } catch (err) {
    console.error('订单状态更新错误:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  } finally {
    if (connection) connection.release();
  }
});

// 管理员查询所有订单
router.get('/adminOrderList', async (req, res) => {
  try {
    // 分页参数
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    // 查询总数
    const [totalRows] = await pool.query(
      "SELECT COUNT(*) AS total FROM orders"
    );
    const total = totalRows[0].total;

    // 关联条件：o.user_id = buyer.user_id / o.seller_id = seller.user_id
    const [list] = await pool.query(`
      SELECT 
        o.*,
        buyer.username AS buyer_name,
        seller.username AS seller_name,
        g.name, g.image_url, g.price
      FROM orders o
      LEFT JOIN users buyer ON o.user_id = buyer.user_id
      LEFT JOIN users seller ON o.seller_id = seller.user_id
      LEFT JOIN goods g ON o.goods_id = g.goods_id
      ORDER BY o.order_id DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    res.json({
      code: 200,
      data: {
        list: list,
        total: total,
        page: page,
        limit: limit,
        pages: Math.ceil(total / limit)
      },
      msg: "获取成功"
    });

  } catch (err) {
    console.error("管理员订单接口报错:", err);
    res.status(500).json({ code: 500, msg: "服务器错误" });
  }
});

// 订单详情接口
router.post('/detail', async (req, res) => {
  try {
    const { order_id, user_id } = req.body;
    if (!order_id || !user_id) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    // 用户禁用拦截
    const [userRows] = await db.execute('SELECT user_status FROM users WHERE user_id = ?', [user_id]);
    if (userRows.length === 0 || userRows[0].user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号异常，无法查看订单' });
    }

    // 查询订单详情（关联商品、买家/卖家信息）
    const [orderRows] = await db.execute(`
      SELECT o.*, g.name, g.image_url, g.price,
             b.nick_name AS buyer_nickname, b.phone AS buyer_phone,
             s.nick_name AS seller_nickname, s.phone AS seller_phone
      FROM orders o
      LEFT JOIN goods g ON o.goods_id = g.goods_id
      LEFT JOIN users b ON o.buyer_id = b.user_id
      LEFT JOIN users s ON o.seller_id = s.user_id
      WHERE o.order_id = ?
    `, [order_id]);

    if (orderRows.length === 0) {
      return res.status(404).json({ code: 404, message: '订单不存在' });
    }

    const order = orderRows[0];
    // 判断当前用户是买家还是卖家，返回对方信息
    const isBuyer = order.buyer_id === user_id;
    const oppositeInfo = isBuyer ? {
      user_id: order.seller_id,
      nickname: order.seller_nickname,
      phone: order.seller_phone
    } : {
      user_id: order.buyer_id,
      nickname: order.buyer_nickname,
      phone: order.buyer_phone
    };

    res.json({
      code: 200,
      data: {
        ...order,
        opposite_user_id: oppositeInfo.user_id,
        opposite_nickname: oppositeInfo.nickname,
        opposite_phone: oppositeInfo.phone
      }
    });
  } catch (err) {
    console.error('获取订单详情失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;