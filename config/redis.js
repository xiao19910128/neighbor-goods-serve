// config/redis.js
const { createClient } = require('@redis/client');

// 1. 创建客户端（本地无密码配置）
const client = createClient({
  socket: {
    host: 'localhost', // 本地地址
    port: 6379,        // 默认端口
    connectTimeout: 5000 // 连接超时时间
  }
});

// 2. 监听连接状态
client.on('connect', () => {
  console.log('✅ Redis 客户端已连接');
});

client.on('ready', () => {
  console.log('✅ Redis 服务已就绪');
});

client.on('error', (err) => {
  console.error('❌ Redis 连接错误:', err.message);
});

client.on('end', () => {
  console.log('❌ Redis 连接已断开');
});

// 3. 封装连接方法（确保连接成功后再使用）
async function connectRedis() {
  try {
    if (!client.isOpen) {
      await client.connect();
    }
  } catch (err) {
    console.error('❌ Redis 手动连接失败:', err.message);
    // 重试连接（毕设阶段可选）
    setTimeout(connectRedis, 3000);
  }
}

// 4. 初始化连接
connectRedis();

// 5. 封装常用方法（简化接口调用）
module.exports = {
  // 存储值并设置过期时间
  async set(key, value, expireSeconds) {
    await connectRedis(); // 确保连接
    await client.set(key, value);
    if (expireSeconds) {
      await client.expire(key, expireSeconds);
    }
  },
  // 获取值
  async get(key) {
    await connectRedis(); // 确保连接
    return await client.get(key);
  },
  // 直接暴露客户端（备用）
  client
};