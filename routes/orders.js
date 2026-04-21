const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 创建订单
router.post('/create', async (req, res) => {
  let connection; // 提前声明，用于事务
  try {
    const { user_id, goods_id } = req.body;

    // 1. 参数校验
    if (!user_id || !goods_id) {
      return res.status(400).json({ code: 400, msg: '参数不完整' });
    }
    // 统一转为数字，避免类型不匹配
    const userId = parseInt(user_id);
    const goodsId = parseInt(goods_id);
    if (isNaN(userId) || isNaN(goodsId)) {
      return res.status(400).json({ code: 400, msg: '参数格式错误' });
    }

    // 2. 获取连接（开启事务）
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 3. 校验用户是否被禁用
    const [userRows] = await connection.query(
      'SELECT user_status FROM users WHERE user_id = ?',
      [userId]
    );
    if (!userRows.length || userRows[0].user_status === 2) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ code: 403, msg: '账号异常，无法下单' });
    }

    // 4. 查询商品信息
    const [goods] = await connection.query(
      'SELECT * FROM goods WHERE goods_id = ?',
      [goodsId]
    );
    if (goods.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ code: 404, msg: '商品不存在' });
    }

    const goodsInfo = goods[0];

    // 5. 拦截：自己不能买自己的商品
    if (goodsInfo.user_id === userId) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: 400, msg: '不能购买自己发布的商品' });
    }

    // 6. 拦截：商品已下架 / 已售出 / 锁定
    // goods_status（商品状态）：1=正常展示 2=已被下单锁定 0=已删除
    // audit_status（审核状态）: 0-待审核 1-审核通过 2-审核拒绝
    if ([0, 2].includes(goodsInfo.goods_status) || goodsInfo.audit_status !== 1) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: 400, msg: '商品已被购买或已下架' });
    }

    // 7. 锁定商品（防止重复下单）
    await connection.query(
      'UPDATE goods SET goods_status = 2 WHERE goods_id = ?',
      [goodsId]
    );

    // 8. 生成订单号
    const order_no = 'ORDER' + Date.now();

    // 9. 插入订单（唯一一次INSERT）
    await connection.query(`
      INSERT INTO orders 
      (order_no, user_id, seller_id, goods_id, goods_title, goods_price, address_id, order_status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      order_no,
      userId,            // 买家
      goodsInfo.user_id, // 卖家
      goodsId,
      goodsInfo.name,
      goodsInfo.price,
      goodsInfo.address_id || null, // 地址
    ]);
      // 更新商品表，标记为锁定状态--否则商品表的order_status没更新，数据不一致
    await connection.query(`
      UPDATE goods SET order_status = 1 WHERE goods_id = ?
    `, [goods_id]);

    // 10. 提交事务
    await connection.commit();
    connection.release();

    return res.json({
      code: 200,
      msg: '下单成功',
      order_no
    });

  } catch (err) {
    // 异常回滚
    if (connection) await connection.rollback();
    if (connection) connection.release();

    console.error('创建订单失败：', err);
    return res.status(500).json({
      code: 500,
      msg: '下单失败，服务器异常',
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
    const { order_id, order_status, user_id } = req.body;
    // 1. 必传参数校验
    if (!order_id || !order_status || !user_id) {
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

    const [orderRows] = await connection.query(
      'SELECT goods_id FROM orders WHERE order_id = ?',
      [order_id]
    );
    if (orderRows.length === 0) {
      return res.status(404).json({ code: 404, message: '订单不存在' });
    }
    const goods_id = orderRows[0].goods_id;
    // 先更新订单状态，再处理商品状态
    await connection.query(
      'UPDATE orders SET order_status = ? WHERE order_id = ?',
      [order_status, order_id]
    );
    // 3. 按订单状态更新商品状态（核心修正）
    // 取消订单/退单 order_status = 5 → 商品恢复可售（order_status=0）
    if (order_status === 5) {
      await connection.query(
        'UPDATE goods SET order_status = 0, goods_status = 1 WHERE goods_id = ?',
        [goods_id]
      );
    }
    // 订单完成 order_status = 4 → 商品标记为已售出（order_status=2）
    else if (order_status === 4) {
      await connection.query(
        'UPDATE goods SET order_status = 2 WHERE goods_id = ?',
        [goods_id]
      );
    }

    // 待确认 / 待自提 / 待收货 order_status = 1/2/3 → 商品锁定（order_status=1）
    else if ([1, 2, 3].includes(order_status)) {
      await connection.query(
        'UPDATE goods SET order_status = 1 WHERE goods_id = ?',
        [goods_id]
      );
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

// 订单详情接口
router.get('/detail', async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) {
      return res.status(400).json({ code: 400, message: '订单ID不能为空' });
    }

    const [orders] = await pool.query(`
      SELECT 
        o.*,
        u.username AS buyer_name,
        u.phone AS buyer_phone,
        s.username AS seller_name,
        s.phone AS seller_phone,
        g.name AS goods_name,
        g.price AS goods_price,
        g.image_url,
        g.goods_status,
        g.audit_status
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id
      LEFT JOIN users s ON o.seller_id = s.user_id
      LEFT JOIN goods g ON o.goods_id = g.goods_id
      WHERE o.order_id = ?
      LIMIT 1
    `, [order_id]);

    if (orders.length === 0) {
      return res.status(404).json({ code: 404, message: '订单不存在' });
    }

    // 订单状态文字说明（前端直接用）
    const order = orders[0];
    order.order_status_text = 
      order.order_status === 0 ? '待付款'
      : order.order_status === 1 ? '交易中'
      : order.order_status === 2 ? '已完成'
      : order.order_status === 3 ? '已取消'
      : '未知状态';

    res.json({
      code: 200,
      message: '查询成功',
      data: order
    });

  } catch (err) {
    console.error('订单详情错误：', err);
    res.status(500).json({ code: 500, message: '服务器异常' });
  }
});

module.exports = router;