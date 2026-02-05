const express = require('express');
const app = express();
const port = 3000;

const goodsRouter = require('./routes/goods');
// 解析 JSON 请求体
app.use(express.json());

app.use('/api/goods', goodsRouter);

// 测试接口
app.get('/api/hello', (req, res) => {
  res.send('Hello from backend!');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});