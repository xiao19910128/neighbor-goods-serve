const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { pool } = require('../config/db');
const util = require('util');
// 获取商品列表
router.get('/query', async (req, res) => {
  try {
    // 1. 获取查询参数
    const { name } = req.query;

    // 2. 构建SQL语句和参数
    let sql = `
      SELECT g.*, u.username AS publish_user, c.name AS category_name
      FROM goods g
      LEFT JOIN users u ON g.user_id = u.user_id
      LEFT JOIN category c ON g.category_id = c.category_id
      WHERE g.audit_status = 1
    `;
    // WHERE g.audit_status = 1 AND g.status = 1 // 待确认是否需要上架状态，上架状态为1，下架状态为0
    const params = [];
    // 如果传了 name 参数，添加模糊查询条件
    if (name && name.trim() !== '') {
      sql += ' AND g.name LIKE ?';
      params.push(`%${name.trim()}%`);
    }
    // 最后加上排序
    sql += ' ORDER BY g.release_time DESC';
    // 3. 执行查询
    const [rows] = await db.execute(sql, params);

    res.json({
      code: 200,
      message: '获取商品列表成功',
      data: rows
    });
  } catch (err) {
    console.error('数据库查询错误 ===', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 新增商品
router.post('/add', async (req, res) => {
  try {
    // 1. 获取请求体中的数据--前端入参
    const { name, price, description, status, image_url } = req.body;
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
      'INSERT INTO goods (name, price, description, status, image_url) VALUES (?, ?, ?, ?, ?)',
      [name, Number(price), description || null, status ?? 1, image_url || null] // 给可选字段设默认值
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
    const { name, price, category_id, user_id, description='', image_url=''} = req.body;
    // 参数校验
    if (!name || !price || !category_id || !user_id) {
      return res.status(400).json({ code: 400, message: '必填字段不能为空' });
    }

  const connection = await db.getConnection();
  try {    
    await connection.beginTransaction();
    const [[user]] = await connection.query('SELECT 1 FROM users WHERE user_id = ? LIMIT 1', [user_id]);
    if (!user) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: -1, msg: '用户不存在' });
    }

    // 校验分类是否存在
    const [[category]] = await connection.query('SELECT 1 FROM category WHERE category_id = ? LIMIT 1', [category_id]);
    if (!category) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ code: -1, msg: '分类不存在', error: '分类不存在' });
    }


    // 插入商品，审核状态默认0（待审核）
    const [result] = await connection.execute(
      `INSERT INTO goods 
      (name, price, description, image_url, category_id, user_id, audit_status, 
        province, city, district, street, detail_address)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        name, price, description, image_url, category_id, user_id,
        // 新增地址字段，从 req.body 取
        req.body.province || '上海市',   // 默认上海市
        req.body.city || '上海市',       // 默认上海市
        req.body.district || '闵行区',   // 默认闵行区
        req.body.street || '梅陇镇',     // 默认梅陇镇（你的核心社区）
        req.body.detail_address || ''    // 详细地址可为空
      ]
    );

    await connection.commit();
    connection.release();
    res.json({
      code: 200,
      msg: '发布成功，请等待管理员审核',
      data: { goodsId: result.insertId }
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('发布商品失败:', err);
    res.status(500).json({ code: -1, msg: '发布失败', error: err.message });
  }
});

// 管理端-获取待审核商品列表
router.get('/pending-audit', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT g.*, u.username AS publish_user, c.name AS category_name 
       FROM goods g 
       LEFT JOIN users u ON g.user_id = u.user_id 
       LEFT JOIN category c ON g.category_id = c.category_id 
       WHERE g.audit_status = 0 
       ORDER BY g.release_time DESC`
    );

    res.json({
      code: 200,
      message: '查询成功',
      data: rows
    });
  } catch (err) {
    console.error('查询待审核商品错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
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
    const { userId, user_id, page = 1, size = 10 } = req.query;
    const finalUserId = userId || user_id;
    const offset = (page - 1) * size;

    if (!finalUserId) {
      return res.status(400).json({ code: 400, msg: 'userId 不能为空' });
    }

    // ✅ 和发布商品接口一样：直接从 db 获取连接
    const connection = await db.getConnection();
    try {
      // 1. 查询总数（直接用 connection.query，不需要包装）
      const [[countResult]] = await connection.query(
        'SELECT COUNT(*) AS total FROM goods WHERE user_id = ?',
        [finalUserId]
      );
      const total = countResult.total;

      // 2. 查询列表（直接用 connection.query）
      const [goodsList] = await connection.query(
        `SELECT goods_id, name, price, image_url, street, detail_address, release_time, audit_status
         FROM goods 
         WHERE user_id = ? 
         ORDER BY release_time DESC 
         LIMIT ? OFFSET ?`,
        [finalUserId, size, offset]
      );

      res.json({
        code: 200,
        data: { list: goodsList, total }
      });
    } finally {
      // ✅ 确保连接一定释放
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
    const { goods_id } = req.body;

    // 1. 参数校验
    if (!goods_id) {
      return res.status(400).json({ code: 400, msg: 'goods_id 不能为空' });
    }

    // 2. 用连接池获取连接（和项目其他接口保持一致）
    const connection = await db.getConnection();
    try {
      // 3. 执行删除
      const [result] = await connection.execute(
        'DELETE FROM goods WHERE goods_id = ?',
        [goods_id]
      );

      // 4. 判断是否真的删除了数据
      if (result.affectedRows === 0) {
        return res.status(404).json({ code: 404, msg: '商品不存在或已删除' });
      }

      res.json({
        code: 200,
        msg: '删除成功'
      });
    } finally {
      // 5. 确保连接一定释放回池
      connection.release();
    }

  } catch (err) {
    // 打印完整错误日志，方便排查
    console.error('删除商品失败:', err);
    res.status(500).json({ 
      code: 500, 
      msg: '删除商品失败',
      error: err.message // 开发环境返回具体错误信息
    });
  }
});


// 获取商品详情
router.get('/detail', async (req, res) => {
  try {
    const { goods_id } = req.query;
    if (!goods_id) {
      return res.status(400).json({ code: 400, msg: 'goods_id 不能为空' });
    }

    const connection = await db.getConnection();
    try {
      const [[goods]] = await connection.query(
        `SELECT goods_id, name, price, description, image_url, 
                street, detail_address, category_id, user_id, audit_status
         FROM goods 
         WHERE goods_id = ?`,
        [goods_id]
      );

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
    const { goods_id, name, price, description, image_url, 
            street, detail_address, category_id } = req.body;
    
    if (!goods_id || !name || !price || !category_id) {
      return res.status(400).json({ code: 400, msg: '必填字段不能为空' });
    }

    const connection = await db.getConnection();
    try {
      // 开启事务
      await connection.beginTransaction();

      // 校验商品是否存在
      const [[goods]] = await connection.query(
        'SELECT 1 FROM goods WHERE goods_id = ?',
        [goods_id]
      );
      if (!goods) {
        await connection.rollback();
        return res.status(404).json({ code: 404, msg: '商品不存在' });
      }

      // 更新商品数据
      await connection.query(
        `UPDATE goods 
         SET name=?, price=?, description=?, image_url=?, 
             street=?, detail_address=?, category_id=?
         WHERE goods_id=?`,
        [name, price, description, image_url, street, detail_address, category_id, goods_id]
      );

      await connection.commit();
      res.json({ code: 200, msg: '更新成功' });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('更新商品失败:', err);
    res.status(500).json({ code: 500, msg: '更新商品失败' });
  }
});



module.exports = router;