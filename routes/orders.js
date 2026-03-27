const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 创建订单
router.post('/create', async (req, res) => {
  try {
    const { user_id, goods_id, address_id } = req.body;
    // 1. 参数校验（关键防御）
    if (!user_id || !goods_id || !address_id) {
      return res.status(400).json({ code: 400, msg: '参数不完整' });
    }
    // 2. 统一转为数字，避免类型不匹配
    const userId = parseInt(user_id);
    const goodsId = parseInt(goods_id);
    const addressId = parseInt(address_id);
    if (isNaN(userId) || isNaN(goodsId) || isNaN(addressId)) {
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
      address_id
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

// 修改订单状态
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
    // 如果用户是禁用状态，直接拦截
    if (userRows[0].user_status === 2) {
      return res.status(403).json({
        code: 403,
        message: '账号已被禁用，无法操作订单'
      });
    }
    // 3. 更新订单状态
    await connection.query(
      'UPDATE orders SET status=? WHERE order_id=?',
      [status, order_id]
    );
    // 4. 订单完成 → 自动设置商品为已完成
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

module.exports = router;