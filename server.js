const app = require('./src/app');
const env = require('./src/config/env');

const PORT = env.port;

// Khi chạy local hoặc trên Render/Railway thì lắng nghe cổng PORT
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Server Backend MangaDex đang chạy tại cổng ${PORT}`);
    console.log(`👉 Health check: http://localhost:${PORT}/health`);
    console.log(`👉 Truyện phổ biến: http://localhost:${PORT}/api/manga/popular`);
    console.log(`==================================================`);
  });
}

// Export app cho Serverless (Vercel)
module.exports = app;

