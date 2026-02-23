const express = require('express');
const router = express.Router();
const db = require('../config/db');
// 引入bcrypt库，用于密码加密和解密。
const bcrypt = require('bcrypt');

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
    const {id} = req.params;
    // 2. 必填入参校验--非空
    if (!id) {
      return res.status(400).json({
        code: 400,
        message: '用户ID不能为空'
      });
    }
    const usersId = Number(id); // 转换为数字
    // 3. 先检查对应ID的用户是否存在
    const [checkResult] = await db.execute('SELECT * FROM users WHERE id=?', [usersId]);
    if (checkResult.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '删除失败，该用户不存在'
      });
    }
    // 4. 执行删除SQL（用?占位符防SQL注入）
    await db.execute('DELETE FROM users WHERE id=?', [usersId]);
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