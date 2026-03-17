// routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const upload = multer({ storage: multer.memoryStorage() });

// 中转上传到 kstore
router.post('/image', upload.single('file'), async (req, res) => {
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, req.file.originalname);
    // 先上传成功后拿到fileId，再去获取直链
    const kstoreRes = await axios.post(
      'https://upload.kstore.space/upload/2566757',
      form,
      {
        headers: { ...form.getHeaders() },
        params: { access_token: '17807-f4568335e76748e4b0dc70bc53194832' }
      }
    );

    if (kstoreRes.data.code === 0) {
      const fileId = kstoreRes.data.data.id;
      const directRes = await axios.post('https://api.kstore.space/api/v1/file/direct', null, {
        params: {
          'access_token': '17807-f4568335e76748e4b0dc70bc53194832',
          fileId: fileId,
          isDirect: 1
        }
      });
      if (directRes.data.success === false) {
      }
      res.json({
        code: 200,
        data: { url: kstoreRes.data.data.downloadUrl }
      });
    } else {
      res.status(500).json({ code: 500, msg: 'kstore上传失败' });
    }
  } catch (err) {
    res.status(500).json({ code: 500, msg: '上传失败' });
  }
});

module.exports = router;