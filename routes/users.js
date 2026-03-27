const express = require('express');
const router = express.Router();
const db = require('../config/db');
// 引入bcrypt库，用于密码加密和解密。
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const jwt = require('jsonwebtoken'); // 用于生成 token
const axios = require('axios'); // 用于调用微信接口
const speakeasy = require('speakeasy');
const redis = require('../config/redis.js');

// 1. 获取验证码接口
router.post('/getSmsCode', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ code: 400, message: '手机号不能为空' });
    }
    // 校验手机号
    const phoneReg = /^1[3-9]\d{9}$/;
    if (!phoneReg.test(phone)) {
      return res.status(400).json({ code: 400, message: '手机号格式错误' });
    }

    // 查询用户状态，拦截禁用用户（用 db.execute 确保参数正确）
    const [user] = await db.execute(`SELECT user_status FROM users WHERE phone = ?`, [phone]);
    // 处理用户不存在的情况（新用户可正常获取验证码注册）
    if (user.length > 0 && user[0].user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号已被禁用，无法获取验证码' });
    }
    // 验证码生成
    const code = Math.floor(Math.random() * 900000 + 100000).toString();
    
    // 存储到 Redis（5分钟过期）
    await redis.set(`sms_code_${phone}`, code, 300);

    // 调试日志
    console.log(`手机号 ${phone} 的验证码：${code}（5分钟有效）`);
    res.json({ code: 200, message: '验证码已发送', code });

  } catch (err) {
    console.error('获取验证码错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 2. 手机号验证码登录（新增状态校验）
router.post('/phoneLogin', async (req, res) => {
  let connection;
  // 后续数据库操作、生成 Token 逻辑
  connection = await pool.getConnection();
  try {
    const { phone, smsCode } = req.body;
    // 查询用户
    const [[user]] = await connection.query('SELECT * FROM users WHERE phone = ?', [phone]);
    // 核心：禁用用户拦截
    if (user?.user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号已被禁用，请联系管理员' });
    }
    if (!phone || !smsCode) {
      return res.status(400).json({ code: 400, msg: '手机号/验证码不能为空' });
    }

    // 从 Redis 获取验证码
    const redisCode = await redis.get(`sms_code_${phone}`);
    // 校验验证码
    if (!redisCode || redisCode !== smsCode) {
      return res.status(400).json({ code: 400, msg: '验证码错误/已过期' });
    }

    let userId, userInfo;
    if (!user) {
      // 补充 password 字段，传空字符串
      const [insertResult] = await connection.query(
        'INSERT INTO users (phone, created_time, username, password, openid) VALUES (?, NOW(), ?, ?, ?)',
        [phone, `用户${phone.slice(-4)}`, '', '']
      );
      userId = insertResult.insertId;
      userInfo = { user_id: userId, phone };
    } else {
      userId = user.user_id;
      userInfo = user;
    }

    const token = jwt.sign({ userId, phone }, 'your-jwt-secret', { expiresIn: '7d' });
    res.json({
      code: 200,
      data: {
        token,
        userInfo: {
          user_id: userId,
          phone,
          nickName: userInfo.nickName || `用户${phone.slice(-4)}`,
          avatarUrl: userInfo.avatarUrl || '/static/default-avatar.png'
        }
      },
      msg: '登录成功'
    });

  } catch (err) {
    console.error('手机号登录失败:', err);
    res.status(500).json({ code: 500, msg: '登录失败' });
  } finally {
    if (connection) connection.release();
  }
});

// 微信授权登录
router.post('/wxLogin', async (req, res) => {
  let connection;
  // 获取数据库连接
  try {
    connection = await pool.getConnection();
    console.log('✅ 获取数据库连接成功');
  } catch (connErr) {
    console.error('❌ 获取数据库连接失败:', connErr);
    return res.status(500).json({ code: 500, message: '数据库连接失败' });
  }
  try {
    const { code, nickName, avatarUrl } = req.body;
  // 调用微信接口，用 code 换取 openid（先拿 openid，再查用户）
  const wxRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
    params: {
      appid: 'wxe8c3149805a71387',
      secret: '18bbe69fc856db3c1fcddafb038d3ed9',
      js_code: code,
      grant_type: 'authorization_code'
    }
  });

  const { openid } = wxRes.data;
    // 查询/创建用户
    const [[user]] = await connection.query(
      'SELECT * FROM users WHERE openid = ?',
      [openid]
    );

    // 禁用用户拦截
    if (user?.user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号已被禁用，请联系管理员' });
    }
    if (!code) {
      return res.status(400).json({ code: 400, message: 'code 不能为空' });
    }
    if (!openid) {
      return res.status(400).json({ code: 400, message: '微信登录失败' });
    }
    // 禁用用户拦截（先查用户，再拦截）
    if (user?.user_status === 2) {
      return res.status(403).json({ code: 403, message: '账号已被禁用，请联系管理员' });
    }

    let userId;
    let userInfo;

    // 判断用户是否存在，不存在则自动注册
    if (user) {
      userId = user.user_id;
      userInfo = user;
    } else {
      const [insertResult] = await connection.query(
        'INSERT INTO users (openid, created_time, username, password, nick_name, avatar_url, user_status) VALUES (?, NOW(), ?, ?, ?, ?, 1)',
        [openid, nickName, '', nickName, avatarUrl] // 新增 user_status=1（正常）
      );
      userId = insertResult.insertId;
      userInfo = { user_id: userId, openid };
    }

    // 6. 生成 JWT Token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { userId, openid },
      '你的JWT密钥',
      { expiresIn: '7d' }
    );

    // 7. 返回结果
    res.json({
      code: 200,
      data: {
        token,
        userInfo: {
          user_id: userId,
          openid,
          nick_name: userInfo.nick_name || nickName,
          avatar_url: userInfo.avatar_url || avatarUrl 
        }
      },
      message: '登录成功'
    });

  } catch (err) {
    console.error('微信登录失败:', err);
    res.status(500).json({ code: 500, message: '微信登录失败' });
  } finally {
    if (connection) {
      try {
        connection.release();
      } catch (e) {
        console.error('释放连接失败:', e);
      }
    }
  }
});

// 管理员-用户列表查询（带筛选+分页）
router.get('/query', async (req, res) => {
  try {
    // 分页参数
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // 筛选参数
    const { keyword = '', user_status = '' } = req.query;

    // 构建动态SQL
    let sql = `SELECT * FROM users WHERE 1=1`;
    const params = [];

    // 模糊搜索（用户名/手机号/ID）
    if (keyword) {
      sql += ` AND (username LIKE ? OR phone LIKE ? OR user_id = ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`, isNaN(keyword) ? -1 : parseInt(keyword));
    }

    // 状态筛选
    if (user_status !== '' && user_status !== null) {
      sql += ` AND status = ?`;
      params.push(parseInt(user_status));
    }

    // 分页+排序
    sql += ` ORDER BY user_id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // 查询总数
    let countSql = `SELECT COUNT(*) AS total FROM users WHERE 1=1`;
    const countParams = [];
    if (keyword) {
      countSql += ` AND (username LIKE ? OR phone LIKE ? OR user_id = ?)`;
      countParams.push(`%${keyword}%`, `%${keyword}%`, isNaN(keyword) ? -1 : parseInt(keyword));
    }
    if (user_status !== '' && user_status !== null) {
      countSql += ` AND user_status = ?`;
      countParams.push(parseInt(user_status));
    }

    // 执行查询
    const [totalRows] = await db.query(countSql, countParams);
    const total = totalRows[0].total;
    const [rows] = await db.query(sql, params);

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
    console.error('用户列表查询错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});
// 管理员-用户操作（禁用/启用/删除）
router.post('/admin/operate', async (req, res) => {
  try {
    const { user_id, action } = req.body;

    // 1. 校验参数
    if (!user_id || !action) {
      return res.status(400).json({ code: 400, message: '参数不完整' });
    }

    // 2. 核心修复：用 db.execute 替代 db.query，确保数据正确读取
    const [user] = await db.execute(`SELECT * FROM users WHERE user_id = ?`, [user_id]);
    if (user.length === 0) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    const currentStatus = user[0].user_status;
    // 🔴 调试日志：打印当前状态，确认取值
    console.log(`用户ID: ${user_id}, 当前状态: ${currentStatus}, 操作: ${action}`);

    let updateSql = '';
    let updateParams = [];
    let successMsg = '';

    switch (action) {
      // 禁用（正常→禁用）
      case 'disable':
        // 核心修复：判断条件修正 + 日志
        if (currentStatus !== 1) {
          console.log(`拦截禁用：当前状态不是1，实际为${currentStatus}`);
          return res.status(400).json({ code: 400, message: `仅正常用户可禁用，当前状态：${currentStatus}` });
        }
        updateSql = `UPDATE users SET user_status = 2 WHERE user_id = ?`;
        updateParams = [user_id];
        successMsg = '用户已禁用';
        break;

      // 启用（禁用→正常）
      case 'enable':
        if (currentStatus !== 2) {
          return res.status(400).json({ code: 400, message: '仅禁用用户可启用' });
        }
        updateSql = `UPDATE users SET user_status = 1 WHERE user_id = ?`;
        updateParams = [user_id];
        successMsg = '用户已启用';
        break;

      // 删除（仅禁用用户可删）
      case 'delete':
        if (currentStatus !== 2) {
          return res.status(400).json({ code: 400, message: '仅禁用用户可删除' });
        }
        await db.execute(`DELETE FROM users WHERE user_id = ?`, [user_id]);
        return res.json({ code: 200, message: '用户删除成功' });

      default:
        return res.status(400).json({ code: 400, message: '无效操作' });
    }

    // 3. 核心修复：用 db.execute 执行更新，确保参数正确
    await db.execute(updateSql, updateParams);
    res.json({ code: 200, message: successMsg });

  } catch (err) {
    console.error('用户操作错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', error: err.message });
  }
});

// 新增用户接口（POST请求）
router.post('/add', async (req, res) => {
  try {
    // 1. 从请求体获取参数
    const { username, password, phone } = req.body;

    // 2. 严格的参数校验（核心：杜绝undefined传入SQL）
    // 校验用户名
    if (!username || username.trim() === '') {
      return res.status(400).json({
        code: 400,
        message: '用户名不能为空！'
      });
    }
    // 校验密码
    if (!password || password.trim() === '') {
      return res.status(400).json({
        code: 400,
        message: '密码不能为空！'
      });
    }
    // 校验手机号（非空+格式）
    if (!phone || phone.trim() === '') {
      return res.status(400).json({
        code: 400,
        message: '手机号不能为空！'
      });
    }
    const phoneReg = /^1[3-9]\d{9}$/; // 国内手机号正则
    if (!phoneReg.test(phone.trim())) {
      return res.status(400).json({
        code: 400,
        message: '手机号格式错误（请输入11位有效手机号）！'
      });
    }

    // 3. 检查用户名/手机号是否已存在（避免唯一约束报错）
    const [checkUser] = await db.execute(
      'SELECT * FROM users WHERE username = ? OR phone = ?',
      [username.trim(), phone.trim()]
    );
    if (checkUser.length > 0) {
      const existField = checkUser[0].username === username.trim() ? '用户名' : '手机号';
      return res.status(400).json({
        code: 400,
        message: `${existField}已被注册！`
      });
    }

    // 4. 密码加密（生产环境必须加密，不能存明文）
    const saltRounds = 10; // 加密强度
    const hashedPassword = await bcrypt.hash(password.trim(), saltRounds);

    // 5. 执行新增（参数都是非空字符串，杜绝undefined）
    const [result] = await db.execute(
      'INSERT INTO users (username, password, phone) VALUES (?, ?, ?)',
      [username.trim(), hashedPassword, phone.trim()] // 所有参数都做trim，避免空格问题
    );

    // 6. 返回成功响应（不返回密码）
    res.status(201).json({
      code: 201,
      message: '用户注册成功！',
      data: {
        userId: result.insertId,
        username: username.trim(),
        phone: phone.trim()
      }
    });

  } catch (error) {
    console.error('新增用户失败：', error);
    // 区分唯一约束报错（兜底，避免重复校验漏判）
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        code: 400,
        message: '用户名或手机号已被注册！'
      });
    }
    // 通用服务器错误响应
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : '系统异常'
    });
  }
});


router.delete('/delete/:id', async (req, res) => {
  try {
    // 1. 获取请求参数中的ID
    const {user_id} = req.params;
    // 2. 必填入参校验--非空
    if (!user_id) {
      return res.status(400).json({
        code: 400,
        message: '用户ID不能为空'
      });
    }
    const usersId = Number(user_id); // 转换为数字
    // 3. 先检查对应ID的用户是否存在
    const [checkResult] = await db.execute('SELECT * FROM users WHERE user_id=?', [usersId]);
    if (checkResult.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '删除失败，该用户不存在'
      });
    }
    // 4. 执行删除SQL（用?占位符防SQL注入）
    await db.execute('DELETE FROM users WHERE user_id=?', [usersId]);
    // 5. 返回成功响应
    res.status(200).json({
      code: 200,
      message: '用户删除成功',
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
})

module.exports = router;