const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // 计算MD5
const db = require('../config/db');

// 工具函数：生成带目录的上传配置
function createUpload(dirName) {
  const fullDir = path.join(__dirname, '../public/uploads', dirName);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: fullDir,
    filename: (req, file, cb) => {
      const filename = Date.now() + path.extname(file.originalname);
      cb(null, filename);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allow = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      allow.includes(file.mimetype) ? cb(null, true) : cb(new Error('仅支持图片'));
    }
  });
}

// 创建两个上传实例
const uploadPublish = createUpload('publish');
const uploadChat = createUpload('chat');

// MD5 去重中间件（通用，支持目录）
function checkDuplicate(dirName) {
  return async (req, res, next) => {
    if (!req.file) return next();

    try {
      const buffer = fs.readFileSync(req.file.path);
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const ext = path.extname(req.file.originalname);
      const fileName = hash + ext;

      const targetDir = path.join(__dirname, '../public/uploads', dirName);
      const targetPath = path.join(targetDir, fileName);
      const finalUrl = `http://localhost:3000/uploads/${dirName}/${fileName}`;

      // 查询是否已存在
      const [rows] = await db.execute('SELECT url FROM uploads WHERE md5 = ?', [hash]);
      if (rows.length > 0) {
        fs.unlinkSync(req.file.path);
        return res.json({ code: 200, data: { url: rows[0].url } });
      }

      // 重命名为 MD5
      fs.renameSync(req.file.path, targetPath);
      req.file.filename = fileName;
      req.file.finalUrl = finalUrl;
      req.file.md5 = hash;
      next();
    } catch (err) {
      console.error('MD5 失败', err);
      next();
    }
  };
}

// 保存记录到数据库
const saveRecord = async (req, res, next) => {
  if (req.file?.md5) {
    try {
      await db.execute(
        'INSERT INTO uploads (md5, filename, url, created_at) VALUES (?, ?, ?, NOW())',
        [req.file.md5, req.file.filename, req.file.finalUrl]
      );
    } catch (e) {}
  }
  next();
};

// 商品图片
router.post('/image', uploadPublish.single('file'), checkDuplicate('publish'), saveRecord, (req, res) => {
  res.json({ code: 200, data: { url: req.file.finalUrl } });
});

// 聊天图片
router.post('/chatImage', uploadChat.single('file'), checkDuplicate('chat'), saveRecord, (req, res) => {
  res.json({ code: 200, data: { url: req.file.finalUrl } });
});

module.exports = router;