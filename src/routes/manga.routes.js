const express = require('express');
const mangaController = require('../controllers/manga.controller');

const router = express.Router();

/**
 * @route   GET /api/manga/popular
 * @desc    Lấy danh sách truyện phổ biến từ MangaDex
 * @access  Public
 */
router.get('/popular', mangaController.getPopularManga);

/**
 * @route   GET /api/manga/cover/:mangaId/:fileName
 * @desc    Proxy tải ảnh bìa từ MangaDex để tránh lỗi chặn Hotlink (403) trên trình duyệt
 * @access  Public
 */
router.get('/cover/:mangaId/:fileName', mangaController.getCoverImage);

module.exports = router;
