const express = require('express');
const router = express.Router();
const db = require('../config/db');
// 引入bcrypt库，用于密码加密和解密。
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const jwt = require('jsonwebtoken'); // 用于生成 token
const axios = require('axios'); // 用于调用微信接口

// 微信登录接口
router.post('/wxLogin', async (req, res) => {
  let connection;
  try {
    const { code, nickName, avatarUrl } = req.body;
    if (!code) {
      return res.status(400).json({ code: 400, msg: 'code 不能为空' });
    }

    // 1. 调用微信接口，用 code 换取 openid
    const wxRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: 'wxe8c3149805a71387',
        secret: '18bbe69fc856db3c1fcddafb038d3ed9',
        js_code: code,
        grant_type: 'authorization_code'
      }
    });

    const { openid } = wxRes.data;
    if (!openid) {
      return res.status(400).json({ code: 400, msg: '微信登录失败' });
    }

    // 2. 获取数据库连接
    try {
      connection = await pool.getConnection();
      console.log('✅ 获取数据库连接成功');
    } catch (connErr) {
      console.error('❌ 获取数据库连接失败:', connErr);
      return res.status(500).json({ code: 500, msg: '数据库连接失败' });
    }

    // 3. 查询用户
    const [[user]] = await connection.query(
      'SELECT * FROM users WHERE openid = ?',
      [openid]
    );

    let userId;
    let userInfo;

    // 4. 判断用户是否存在，不存在则自动注册
    if (user) {
      userId = user.user_id;
      userInfo = user;
    } else {
      const [insertResult] = await connection.query(
        'INSERT INTO users (openid, created_time, username, password, nick_name, avatar_url) VALUES (?, NOW(), ?, ?, ?, ?)',
        [openid, nickName, '', nickName, avatarUrl] // 把昵称/头像存入数据库
      );
      userId = insertResult.insertId;
      userInfo = { user_id: userId, openid };
    }

    // 5. 生成 JWT Token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { userId, openid },
      '你的JWT密钥',
      { expiresIn: '7d' }
    );

    // 6. 返回结果
    res.json({
      code: 200,
      data: {
        token,
        userInfo: {
          user_id: userId,
          openid,
          nick_name: userInfo.nickName,
          avatar_url: userInfo.avatarUrl 
        }
      },
      msg: '登录成功'
    });

  } catch (err) {
    console.error('微信登录失败:', err);
    res.status(500).json({ code: 500, msg: '微信登录失败' });
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

// 获取用户列表
router.get('/query', async (req, res) => {
  try {
    console.log('=== 开始执行数据库查询 ===');
    // 执行查询
    const [rows] = await db.execute('SELECT * FROM users');
    // 返回结果
    res.status(200).json({
      code: 200,
      message: '获取用户列表成功',
      data: rows
    });
  } catch (error) {
    // 强制打印完整错误（重点！）
    console.error('=== 数据库查询错误 ===');
    console.error('错误类型：', error.name);
    console.error('错误信息：', error.message);
    console.error('错误堆栈：', error.stack);
    // 返回友好提示
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message // 调试用，生产环境可删除
    });
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