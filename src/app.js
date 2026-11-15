const express = require('express');
const cors = require('cors');
const mangaRoutes = require('./routes/manga.routes');
const { isFirebaseEnabled } = require('./config/firebase');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Route kiểm tra trạng thái hoạt động của Server
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'backend_manga',
    firebaseConnected: isFirebaseEnabled(),
    timestamp: new Date().toISOString(),
  });
});

// Routes chính cho Manga
app.use('/api/manga', mangaRoutes);

// Xử lý 404 Not Found
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Không tìm thấy đường dẫn: ${req.originalUrl}`,
  });
});

// Middleware xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error('[API Error]:', err.response?.data || err.message);

  const statusCode = err.response?.status || err.statusCode || 500;
  const message =
    err.response?.data?.errors?.[0]?.detail ||
    err.message ||
    'Đã xảy ra lỗi phía máy chủ khi kết nối MangaDex API';

  res.status(statusCode).json({
    success: false,
    message,
  });
});

module.exports = app;
