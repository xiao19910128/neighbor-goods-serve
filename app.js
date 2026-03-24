const express = require('express');
const app = express();
const port = 3000;

const goodsRouter = require('./routes/goods');
const usersRouter = require('./routes/users');
const evaluationsRouter = require('./routes/evaluations');
// const collectionsRouter = require('./routes/collections');
const categoryRouter = require('./routes/category');
const uploadRouter = require('./routes/upload');
const proxyRouter = require('./routes/proxy');
const addressRouter = require('./routes/address');
const messageRouter = require('./routes/message');
// 解析 JSON 请求体
app.use(express.json());

app.use('/api/goods', goodsRouter);
app.use('/api/users', usersRouter);
app.use('/api/evaluations', evaluationsRouter);
// app.use('/api/collections', collectionsRouter);
app.use('/api/category', categoryRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/proxy', proxyRouter); // 代理腾讯地图逆地理编码 APIuter);
app.use('/api/address', addressRouter);
app.use('/api/message', messageRouter);

// 测试接口
app.get('/api/hello', (req, res) => {
  res.send('Hello from backend!');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});