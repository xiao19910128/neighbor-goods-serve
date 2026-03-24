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
    // 3. 查询商品信息（获取卖家ID、价格、标题）
    const [goods] = await pool.query(
      'SELECT * FROM goods WHERE goods_id = ?',
      [goodsId]
    );
    if (goods.length === 0) {
      return res.status(404).json({ code: 404, msg: '商品不存在' });
    }
    const goodsInfo = goods[0];
    const orderNo = 'ORDER' + Date.now(); // 生成唯一订单号
    // 4. 插入订单（完整字段，避免缺失）
    await pool.query(`
      INSERT INTO orders 
      (order_no, user_id, seller_id, goods_id, goods_title, goods_price, address_id, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      orderNo,
      userId,
      goodsInfo.user_id, // 卖家ID
      goodsId,
      goodsInfo.title || goodsInfo.name, // 商品标题（兼容两种字段名）
      goodsInfo.price, // 商品价格
      addressId
    ]);
    res.json({ 
      code: 200, 
      msg: '下单成功', 
      order_no: orderNo 
    });

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
      SELECT o.*, g.image_url, u.nick_name 
      FROM orders o 
      LEFT JOIN goods g ON o.goods_id = g.goods_id
      LEFT JOIN users u ON o.user_id = u.user_id
    `;
    if (type === 'buy') sql += ` WHERE o.user_id = ${user_id}`;
    if (type === 'sell') sql += ` WHERE o.seller_id = ${user_id}`;
    sql += ' ORDER BY o.order_id DESC';
    
    const [list] = await pool.query(sql);
    res.json({ code:200, data:list });
  } catch (e) {
    res.status(500).json({});
  }
});

// 修改订单状态
router.post('/updateStatus', async (req, res) => {
  try {
    const { order_id, status } = req.body;
    await pool.query('UPDATE orders SET status=? WHERE order_id=?', [status, order_id]);
    res.json({ code:200, msg:'状态更新成功' });
  } catch (e) {
    res.status(500).json({});
  }
});

// 管理员查询所有订单
router.get('/adminList', async (req, res) => {
  try {
    const [list] = await pool.query(`
      SELECT o.*, u.nick_name as buyer, s.nick_name as seller, g.title
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id
      LEFT JOIN users s ON o.seller_id = s.user_id
      LEFT JOIN goods g ON o.goods_id = g.goods_id
      ORDER BY o.order_id DESC
    `);
    res.json({ code:200, data:list });
  } catch (e) {
    res.status(500).json({});
  }
});



module.exports = router;