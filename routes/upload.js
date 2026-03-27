const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // 计算MD5
const db = require('../config/db');

// 存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // 临时文件名，后面会替换成MD5
    const tmpName = Date.now() + '-' + Math.random() + path.extname(file.originalname);
    cb(null, tmpName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (types.includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片'));
  }
});

// 上传前计算MD5，判断是否已存在
const checkDuplicateImage = async (req, res, next) => {
  try {
    if (!req.file) return next();
    // 1. 计算文件MD5
    const buffer = fs.readFileSync(req.file.path);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    const ext = path.extname(req.file.originalname);
    const finalFileName = hash + ext;
    const finalPath = path.join(__dirname, '../public/uploads', finalFileName);
    const finalUrl = `http://localhost:3000/uploads/${finalFileName}`;

    // 2. 查询数据库是否已存在该MD5
    const [rows] = await db.execute(
      'SELECT url FROM uploads WHERE md5 = ?',
      [hash]
    );

    if (rows.length > 0) {
      // 图片已存在 → 删除临时文件 → 直接返回旧URL
      fs.unlinkSync(req.file.path);
      return res.json({
        code: 200,
        message: '图片已存在（未重复存储）',
        data: { url: rows[0].url }
      });
    }

    // 3. 不存在 → 重命名为MD5文件名
    fs.renameSync(req.file.path, finalPath);
    req.file.filename = finalFileName;
    req.file.md5 = hash;
    req.file.finalUrl = finalUrl;
    next();
  } catch (err) {
    console.error('MD5校验失败', err);
    next();
  }
};

// 保存记录到数据库
const saveUploadRecord = async (req, res, next) => {
  try {
    if (!req.file.md5) return next();
    await db.execute(
      'INSERT INTO uploads (md5, filename, url, created_at) VALUES (?, ?, ?, NOW())',
      [req.file.md5, req.file.filename, req.file.finalUrl]
    );
  } catch (e) {}
  next();
};

// 最终上传接口
router.post('/image',
  upload.single('file'),
  checkDuplicateImage,
  saveUploadRecord,
  (req, res) => {
    res.json({
      code: 200,
      message: '上传成功',
      data: { url: req.file.finalUrl }
    });
  }
);
module.exports = router;