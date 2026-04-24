const express = require('express');
const router = express.Router();
const db = require('../config/db');
// 商品发布接口 - 敏感词检测
async function checkSensitiveWords(text, db) {
  const [rows] = await db.execute('SELECT word FROM sensitive_words');
  const words = rows.map(r => r.word);
  if (words.length === 0) return false;
  const reg = new RegExp(words.join('|'), 'g');
  return reg.test(text);
}
// 修正版脱敏函数
async function desensitizeText(text, db) {
  if (!text) return '';
  // 1. 一次性获取所有敏感词
  const [rows] = await db.execute('SELECT word FROM sensitive_words');
  if (rows.length === 0) return text;

  // 2. 关键：把所有词拼接成一个正则，一次性替换，避免循环创建正则
  const words = rows.map(r => r.word);
  // 转义特殊字符（防止词里有. * + 等正则元字符）
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const reg = new RegExp(escapedWords.join('|'), 'g');

  // 3. 一次替换所有敏感词
  return text.replace(reg, '***');
}

// 获取商品列表
router.get('/query', async (req, res) => {
  try {
    // 1. 获取查询参数
    // 过滤自己发布的闲置，未登录时没有user_id，查询全部
    const { name, user_id } = req.query;

    let sql = `
      SELECT g.*, u.username AS publish_user, c.name AS category_name
      FROM goods g
      LEFT JOIN users u ON g.user_id = u.user_id
      LEFT JOIN category c ON g.category_id = c.category_id
      WHERE g.audit_status = 1 AND g.goods_status = 1 AND is_deleted = 0
    `;
     // 展示已审批通过且没有被锁单的商品 goods_status 1=正常展示 2=已被下单锁定 0=已删除
    let params = [];

    // 如果用户已登录（有传 user_id），才追加过滤条件
    if (user_id !== undefined && user_id !== null && user_id !== '') {
      sql += ` AND g.user_id != ?`;
      params.push(user_id); // 只在有值时加入参数
    }
    // 如果传了 name 参数，添加模糊查询条件
    if (name && name.trim() !== '') {
      sql += ' AND g.name LIKE ?';
      params.push(`%${name.trim()}%`);
    }
    sql += ' ORDER BY g.release_time DESC';
    // 执行查询
    const [goodsList] = await db.execute(sql, params);

    res.json({
      code: 200,
      data: goodsList,
      msg: '获取成功'
    });
  } catch (err) {
    console.error('商品列表查询错误：', err);
    res.status(500).json({
      code: 500,
      msg: '服务器错误',
      error: err.message
    });
  }
});

// 新增商品
router.post('/add', async (req, res) => {
  try {
    // 1. 获取请求体中的数据--前端入参
    const { name, price, description, goods_status, image_url } = req.body;
    // 2. 参数校验（必填项检查）
    if (!name) {
      return res.status(400).json({
        code: 400,
        message: '商品名称不能为空'
      });
    }
    if (!price || isNaN(price) || price <= 0) {
      return res.status(400).json({
        code: 400,
        message: '商品价格不能为空且必须是正数'
      });
    }
    // 3. 执行插入SQL（用?占位符防止SQL注入）
    const [result] = await db.execute(
      'INSERT INTO goods (name, price, description, goods_status, image_url) VALUES (?, ?, ?, ?, ?)',
      [name, Number(price), description || null, goods_status ?? 1, image_url || null] // 给可选字段设默认值
    );

    // 4. 返回成功响应（包含新增商品的ID）
    res.status(200).json({
      code: 200,
      message: '商品添加成功',
      data: {
        goods_id: result.goods_id, // result为上述插入SQL执行后的结果--这里的返回结果可以不用返回给前端
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
});

// 发布商品接口
router.post('/publish', async (req, res) => {
  let connection;
  try {
    // 1. 先获取所有参数
    const {
      name,
      price,
      category_id,
      user_id,
      description = '',
      image_url = '',
      address_id = 0,
      detail_address,
      province,
      city,
      district,
      street,
      contact_name,
      contact_phone,
      publisher_name,
      publisher_id
    } = req.body;

    // 2. 【关键】先做敏感词检测（在事务外面！！）
    const fullText = `${name} ${description}`;
    const isSensitive = await checkSensitiveWords(fullText, db);
    if (isSensitive) {
      return res.status(400).json({ code: 400, message: '商品包含违规内容，禁止发布' });
    }

    // 3. 【关键】先做脱敏（在事务外面，避免事务内多次IO）
    const safeName = await desensitizeText(name, db);
    const safeDesc = await desensitizeText(description, db);
    const safeDetailAddr = await desensitizeText(detail_address, db);

    // 4. 基础参数校验
    if (!name || !price || !category_id || !publisher_id) {
      return res.status(400).json({ code: -1, msg: '必填字段不能为空' });
    }

    // 5. 现在才开启事务（事务里只做写操作，不做读操作）
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 校验用户状态
    const [[user]] = await connection.query(
      'SELECT user_status FROM users WHERE user_id = ? LIMIT 1',
      [user_id]
    );
    if (!user) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: -1, msg: '用户不存在' });
    }
    if (user.user_status === 2) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ code: -1, msg: '账号已被禁用，无法发布商品' });
    }

    // 校验分类
    const [[category]] = await connection.query(
      'SELECT 1 FROM category WHERE category_id = ? LIMIT 1',
      [category_id]
    );
    if (!category) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: -1, msg: '分类不存在' });
    }

    // 处理地址
    let finalAddressId = 0;
    if (address_id && address_id !== 0) {
      const [[addr]] = await connection.query(
        'SELECT address_id FROM address WHERE address_id = ? AND user_id = ? LIMIT 1',
        [address_id, user_id]
      );
      if (!addr) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ code: -1, msg: '选择的地址不存在' });
      }
      finalAddressId = address_id;
    } else {
      if (!contact_name || !contact_phone) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ code: -1, msg: '自提联系人或电话不能为空' });
      }
      const [addrResult] = await connection.query(
        `INSERT INTO address (
          user_id,
          contact_name,
          contact_phone,
          province,
          city,
          district,
          street,
          detail_address
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          contact_name || '',
          contact_phone || '',
          province || '上海市',
          city || '上海市',
          district || '闵行区',
          street || '梅陇镇',
          detail_address || ''
        ]
      );
      finalAddressId = addrResult.insertId;
    }

    // 插入商品（事务内唯一的写操作）
    const [goodsResult] = await connection.execute(
      `INSERT INTO goods (
        name, price, description, image_url,
        category_id, user_id, audit_status,
        province, city, district, street, detail_address,
        address_id, contact_name, contact_phone,
        publisher_name, publisher_id
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeName || '',
        price || 0,
        safeDesc || '',
        image_url || '',
        category_id || 0,
        user_id,
        province || '上海市',
        city || '上海市',
        district || '闵行区',
        street || '梅陇镇',
        safeDetailAddr || '',
        finalAddressId,
        contact_name || '',
        contact_phone || '',
        publisher_name || '匿名卖家',
        publisher_id || user_id
      ]
    );

    // 提交事务
    await connection.commit();
    connection.release();
    return res.json({
      code: 200,
      msg: '发布成功，请等待管理员审核',
      data: { goodsId: goodsResult.insertId }
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('发布商品失败:', err);
    return res.status(500).json({ code: -1, msg: '发布失败', error: err.message });
  }
});

// 管理端-获取待审核商品列表
router.get('/pending-audit', async (req, res) => {
  try {
    // 1. 分页参数处理
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // 2. 查询总条数
    const [totalRows] = await db.query(
      `SELECT COUNT(*) AS total FROM goods WHERE audit_status = 0`
    );
    const total = totalRows[0].total;

    // 3. 同时用模板字符串直接拼接分页参数，避免占位符不匹配
    const sql = `
      SELECT g.*, u.username AS publish_user, c.name AS category_name 
      FROM goods g 
      LEFT JOIN users u ON g.user_id = u.user_id 
      LEFT JOIN category c ON g.category_id = c.category_id 
      WHERE g.audit_status = 0 
      ORDER BY g.release_time DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await db.query(sql);

    // 4. 返回标准分页结构
    res.json({
      code: 200,
      message: '查询成功',
      data: {
        list: rows,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('查询待审核商品错误:', err);
    res.status(500).json({ 
      code: 500, 
      message: '服务器内部错误',
      error: err.message 
    });
  }
});

// 管理端-审核商品（通过/拒绝）
router.post('/audit', async (req, res) => {
  try {
    const { goods_id, auditor_id, audit_status, audit_remark = '' } = req.body;
    
    // 校验参数
    if (!goods_id || !audit_status || ![1,2].includes(audit_status)) {
      return res.status(400).json({ code: 400, message: '审核参数错误' });
    }

    // 检查商品是否存在
    const [exist] = await db.execute('SELECT goods_id FROM goods WHERE goods_id = ?', [goods_id]);
    if (exist.length === 0) {
      return res.status(400).json({ code: 400, message: '商品不存在' });
    }

    // 更新审核状态
    await db.execute(
      `UPDATE goods 
       SET audit_status = ?, audit_remark = ?, audit_time = NOW() 
       WHERE goods_id = ?`,
      [audit_status, audit_remark, goods_id]
    );

    const msg = audit_status === 1 ? '审核通过' : '审核拒绝';
    res.json({ code: 200, message: msg, data: null });
  } catch (err) {
    console.error('审核商品错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

router.delete('/delete/:id', async (req, res) => {
  try {
    // 1. 获取请求参数中的ID
    const {goods_id} = req.params;
    // 2. 必填入参校验--非空
    if (!goods_id) {
      return res.status(400).json({
        code: 400,
        message: '商品ID不能为空'
      });
    }
    const goodsId = Number(goods_id); // 转换为数字
    // 3. 先检查对应ID的商品是否存在
    const [checkResult] = await db.execute('SELECT * FROM goods WHERE goods_id=?', [goodsId]);
    if (checkResult.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '删除失败，该商品不存在'
      });
    }
    // 4. 执行删除SQL（用?占位符防SQL注入）
    await db.execute('DELETE FROM goods WHERE goods_id=?', [goodsId]);
    // 5. 返回成功响应
    res.status(200).json({
      code: 200,
      message: '商品删除成功',
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
})

// 获取当前用户发布的商品列表
router.get('/published', async (req, res) => {
  try {
    // 1. 接收分页参数
    const { userId, user_id, page = 1, size = 10 } = req.query;
    const finalUserId = userId || user_id;
    
    // 校验 userId
    if (!finalUserId) {
      return res.status(400).json({ code: 400, msg: 'userId 不能为空' });
    }

    // 2. 计算分页偏移量
    const pageNum = parseInt(page);
    const pageSize = parseInt(size);
    const offset = (pageNum - 1) * pageSize;

    const connection = await db.getConnection();
    try {
      // 3. 查询总数（过滤已删除商品）
      const [[countResult]] = await connection.query(
        'SELECT COUNT(*) AS total FROM goods WHERE user_id = ? AND is_deleted = 0',
        [finalUserId]
      );
      const total = countResult.total;

      // 4. 查询当前页数据（过滤已删除商品！）
      const [goodsList] = await connection.query(
        `SELECT goods_id, name, price, description, image_url, 
                street, detail_address, category_id, user_id, audit_status, release_time
         FROM goods 
         WHERE user_id = ? AND is_deleted = 0
         ORDER BY release_time DESC 
         LIMIT ? OFFSET ?`,
        [finalUserId, pageSize, offset]
      );

      // 5. 计算总页数
      const totalPages = Math.ceil(total / pageSize);

      res.json({
        code: 200,
        data: {
          list: goodsList,
          pagination: {
            page: pageNum,
            size: pageSize,
            total: total,
            totalPages: totalPages
          }
        }
      });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('获取发布商品失败:', err);
    res.status(500).json({ code: 500, msg: '获取发布商品失败', error: err.message });
  }
});

// 删除商品接口
router.post('/deletePublished', async (req, res) => {
  try {
    const { goods_id, user_id } = req.body;
    // 1. 参数校验
    if (!goods_id) {
      return res.status(400).json({ code: 400, msg: 'goods_id 不能为空' });
    }
    const connection = await db.getConnection();
    // 查询用户状态--禁用账号不可删除
    const [user] = await connection.execute(`SELECT user_status FROM users WHERE user_id = ?`, [user_id]);
    if (user[0]?.user_status === 2) {
      connection.release(); // 必须释放连接
      return res.status(403).json({ code: 403, message: '账号已被禁用，无法删除商品' });
    }

    // 进行中订单不允许删除商品--待确认/待自提/待收货
    const [orderList] = await connection.execute(
      `SELECT order_status FROM orders WHERE goods_id = ? AND order_status IN (1,2,3)`, 
      [goods_id]
    );
    // order_status=1待确认 / 2待交割 / 3待收货 → 属于进行中订单
    if (orderList.length > 0) {
      connection.release();
      return res.status(400).json({ 
        code: 400, 
        msg: "该商品存在未完成订单，无法删除，请先处理订单" 
      });
    }
    try {
      // 执行删除--UPDATE更新商品状态，标记软删除
      const [result] = await connection.execute(
        'UPDATE goods SET is_deleted = 1 WHERE goods_id = ?',
        [goods_id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ code: 404, msg: '商品不存在或已删除' });
      }

      res.json({ code: 200, msg: '删除成功' });
    } finally {
      connection.release();
    }

  } catch (err) {
    console.error('删除商品失败:', err);
    res.status(500).json({ 
      code: 500, 
      msg: '删除商品失败',
      error: err.message
    });
  }
});

// 获取商品详情
router.get('/detail', async (req, res) => {
  try {
    const { goods_id, delete_detail = false } = req.query;
    if (!goods_id) {
      return res.status(400).json({ code: 400, msg: 'goods_id 不能为空' });
    }
    const connection = await db.getConnection();
    try {
      let sql = 
        `SELECT 
          g.goods_id, 
          g.name, 
          g.price, 
          g.description, 
          g.image_url, 
          g.street, 
          g.detail_address, 
          g.category_id, 
          g.user_id, 
          g.audit_status,
          g.publisher_name, 
          g.publisher_id,
          g.is_deleted,
          c.name AS category_name
         FROM goods g
         LEFT JOIN category c ON g.category_id = c.category_id
         WHERE g.goods_id = ?`
      let params = [goods_id];
      // 正常需要过滤已删除商品，但是订单详情和收藏列表是需要展示已删除商品详情的
      if (!delete_detail) {
        sql += ' AND g.is_deleted = 0';
      }
      const [[goods]] = await connection.query(sql, params);
      if (!goods) {
        return res.status(404).json({ code: 404, msg: '商品不存在' });
      }

      res.json({
        code: 200,
        data: goods
      });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('获取商品详情失败:', err);
    res.status(500).json({ code: 500, msg: '获取商品详情失败' });
  }
});

// 更新商品信息
router.post('/update', async (req, res) => {
  try {
    const {
      goods_id,
      name,
      price,
      description,
      image_url,
      street,
      detail_address,
      category_id,
      user_id,
      address_id,
      contact_name,
      contact_phone
    } = req.body;

    if (!goods_id || !name || !price || !category_id) {
      return res.status(400).json({ code: 400, msg: '必填字段不能为空' });
    }
    // 1. 先检查用户状态--禁用账号不可更新
    const [user] = await db.execute('SELECT user_status FROM users WHERE user_id = ?', [user_id]);
    if (!user || user[0]?.user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号已禁用' });
    }
    // 2. 【关键】敏感词检测（事务外面）
    const fullText = `${name} ${description}`;
    const isSensitive = await checkSensitiveWords(fullText, db);
    if (isSensitive) {
      return res.status(400).json({ code: 400, message: '商品包含违规内容，禁止修改' });
    }
    // 3. 【关键】脱敏处理
    const safeName = await desensitizeText(name, db);
    const safeDesc = await desensitizeText(description, db);
    const safeDetailAddr = await desensitizeText(detail_address, db);
    // 4. 开启事务执行更新
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 检查商品是否存在
      const [[goods]] = await connection.query('SELECT * FROM goods WHERE goods_id = ?', [goods_id]);
      if (!goods) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ code: 404, msg: '商品不存在' });
      }
      const finalAddressId = address_id ? Number(address_id) : null;
      // 执行更新（使用脱敏后内容）
      await connection.query(
        `UPDATE goods 
         SET 
           name = ?,
           price = ?,
           description = ?,
           image_url = ?,
           street = ?,
           detail_address = ?,
           category_id = ?,
           address_id = ?,
           contact_name = ?,
           contact_phone = ?
         WHERE goods_id = ?`,
        [
          safeName,
          price,
          safeDesc,
          image_url,
          street,
          safeDetailAddr,
          category_id,
          finalAddressId,
          contact_name || '',
          contact_phone || '',
          goods_id
        ]
      );

      await connection.commit();
      connection.release();
      res.json({ code: 200, msg: '更新成功' });
    } catch (err) {
      await connection.rollback();
      connection.release();
      console.error('更新事务异常:', err);
      res.status(500).json({ code: 500, msg: '更新失败' });
    }

  } catch (err) {
    console.error('更新接口异常:', err);
    res.status(500).json({ code: 500, msg: '服务器异常' });
  }
});

// 管理员-商品列表查询（全量+筛选+分页）
router.get('/admin/list', async (req, res) => {
  try {
    // 1. 分页参数
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // 2. 筛选参数（前端传参）
    const { keyword = '', audit_status = '', publish_user = '' } = req.query;

    // 3. 构建动态SQL（补上 order_status 字段交易锁定状态）
    let sql = `
      SELECT 
        g.*, 
        u.username AS publish_user, 
        c.name AS category_name,
        g.order_status
      FROM goods g 
      LEFT JOIN users u ON g.user_id = u.user_id 
      LEFT JOIN category c ON g.category_id = c.category_id 
      WHERE 1=1
    `;
    const params = [];

    // 商品名称/发布人 模糊搜索
    if (keyword) {
      sql += ` AND (g.name LIKE ? OR u.username LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 商品状态筛选
    if (audit_status !== '' && audit_status !== null) {
      sql += ` AND g.audit_status = ?`;
      params.push(parseInt(audit_status));
    }

    // 4. 分页+排序
    sql += ` ORDER BY g.release_time DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // 5. 查询总数（用于分页）
    let countSql = `SELECT COUNT(*) AS total FROM goods g LEFT JOIN users u ON g.user_id = u.user_id WHERE 1=1`;
    const countParams = [];
    if (keyword) {
      countSql += ` AND (g.name LIKE ? OR u.username LIKE ?)`;
      countParams.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (audit_status !== '' && audit_status !== null) {
      countSql += ` AND g.audit_status = ?`;
      countParams.push(parseInt(audit_status));
    }

    // 6. 执行查询
    const [totalRows] = await db.query(countSql, countParams);
    const total = totalRows[0].total;
    const [rows] = await db.query(sql, params);

    // 7. 给商品追加状态文字
    const formatList = rows.map(item => ({
      ...item,
      // 审核状态文字
      audit_status_text:
        item.audit_status === 0 ? '待审核'
        : item.audit_status === 1 ? '已上架'
        : item.audit_status === 2 ? '已拒绝'
        : item.audit_status === 3 ? '已下架'
        : item.audit_status === 4 ? '已完成'
        : '未知状态',
      // 交易状态文字（🔥 下架锁定判断用）
      order_status_text:
        item.order_status === 0 ? '可售'
        : item.order_status === 1 ? '交易中'
        : item.order_status === 2 ? '已售出'
        : '未知'
    }));

    // 8. 返回结果
    res.json({
      code: 200,
      message: '查询成功',
      data: {
        list: formatList,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error('商品列表查询错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 管理员-商品操作（审核/上架/下架/删除 统一接口）
router.post('/admin/operate', async (req, res) => {
  try {
    const { goods_id, action } = req.body;

    // 1. 校验参数
    if (!goods_id || !action) {
      return res.status(400).json({ code: 400, message: '参数不完整' });
    }

    // 2. 先查询商品当前状态 + 交易锁定状态
    const [goods] = await db.query(`SELECT audit_status, order_status FROM goods WHERE goods_id = ?`, [goods_id]);
    if (goods.length === 0) {
      return res.status(404).json({ code: 404, message: '商品不存在' });
    }
    const currentStatus = goods[0].audit_status;
    const orderStatus = goods[0].order_status; // 交易状态：0=可售 1=锁定 2=已售出

    // 3. 执行对应操作
    let updateSql = '';
    let updateParams = [];
    let successMsg = '';

    switch (action) {
      // 审核通过（上架）
      case 'pass':
        if (currentStatus !== 0) {
          return res.status(400).json({ code: 400, message: '仅待审核商品可通过' });
        }
        updateSql = `UPDATE goods SET audit_status = 1 WHERE goods_id = ?`;
        updateParams = [goods_id];
        successMsg = '审核通过，商品已上架';
        break;

      // 审核拒绝
      case 'reject':
        if (currentStatus !== 0) {
          return res.status(400).json({ code: 400, message: '仅待审核商品可拒绝' });
        }
        updateSql = `UPDATE goods SET audit_status = 2 WHERE goods_id = ?`;
        updateParams = [goods_id];
        successMsg = '审核拒绝';
        break;

      // 上架
      case 'up':
        if (currentStatus !== 3) {
          return res.status(400).json({ code: 400, message: '仅下架商品可上架' });
        }
        updateSql = `UPDATE goods SET audit_status = 1, goods_status = 1 WHERE goods_id = ?`;
        updateParams = [goods_id];
        successMsg = '商品已上架';
        break;

      // 下架：增加【锁定商品不可下架】逻辑
      case 'down':
        if (currentStatus !== 1) {
          return res.status(400).json({ code: 400, message: '仅上架商品可下架' });
        }

        // 交易锁定的商品，禁止下架
        if (orderStatus === 1) {
          return res.status(400).json({
            code: 400,
            message: '该商品正在交易中，无法下架'
          });
        }

        updateSql = `UPDATE goods SET audit_status = 3, goods_status = 2 WHERE goods_id = ?`;
        updateParams = [goods_id];
        successMsg = '商品已下架';
        break;

      // 删除（仅已完成交易商品可删）
      case 'delete':
        if (currentStatus !== 4) {
          return res.status(400).json({ code: 400, message: '仅已完成交易商品可删除' });
        }
        await db.query(`DELETE FROM goods WHERE goods_id = ?`, [goods_id]);
        return res.json({ code: 200, message: '商品删除成功' });

      default:
        return res.status(400).json({ code: 400, message: '无效操作' });
    }

    // 4. 执行更新
    await db.query(updateSql, updateParams);
    res.json({ code: 200, message: successMsg });

  } catch (err) {
    console.error('商品操作错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;