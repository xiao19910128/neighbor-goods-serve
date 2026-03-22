const express = require('express');
const router = express.Router();
const axios = require('axios');

// 代理腾讯地图逆地理编码 API
router.get('/geocoder', async (req, res) => {
  try {
    const { location, key } = req.query;
    // 转发请求到腾讯地图服务器
    const response = await axios.get('https://apis.map.qq.com/ws/geocoder/v1/', {
      params: { location, key }
    });
    // 把结果返回给前端
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ status: -1, message: '代理请求失败' });
  }
});

module.exports = router;