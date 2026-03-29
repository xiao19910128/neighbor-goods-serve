const express = require('express');
const app = express();
const path = require('path');
const port = process.env.PORT || 3000;

const goodsRouter = require('./routes/goods');
const usersRouter = require('./routes/users');
const evaluationsRouter = require('./routes/evaluations');
const collectionsRouter = require('./routes/collections');
const categoryRouter = require('./routes/category');
const uploadRouter = require('./routes/upload');
const proxyRouter = require('./routes/proxy');
const addressRouter = require('./routes/address');
const messageRouter = require('./routes/message');
const ordersRouter = require('./routes/orders');
// 解析 JSON 请求体
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 配置静态资源访问（让上传的图片可以直接访问）
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use('/api/goods', goodsRouter);
app.use('/api/users', usersRouter);
app.use('/api/evaluations', evaluationsRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/category', categoryRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/proxy', proxyRouter); // 代理腾讯地图逆地理编码 APIuter);
app.use('/api/address', addressRouter);
app.use('/api/message', messageRouter);
app.use('/api/orders', ordersRouter);

//  定时任务：每天清理 30 天前已读的消息
const cleanExpiredMessages = async () => {
  try {
    await db.query(`
      DELETE FROM messages 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) 
      AND is_read = 1
    `);
    console.log('✅ 已清理30天前已读消息');
  } catch (err) {
    console.error('❌ 清理消息失败', err);
  }
};

// 每天执行一次 86400000 毫秒 = 24小时
setInterval(cleanExpiredMessages, 86400000);

// 测试接口
app.get('/api/hello', (req, res) => {
  res.send('Hello from backend!');
});

// 启动服务
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});