const express = require('express');
const mangaController = require('../controllers/manga.controller');

const router = express.Router();

/**
 * @route   GET /api/manga/popular
 * @desc    Lấy danh sách truyện phổ biến từ MangaDex
 * @access  Public
 */
router.get('/popular', mangaController.getPopularManga);

module.exports = router;
