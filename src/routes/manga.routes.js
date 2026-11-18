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

/**
 * @route   GET /api/manga/page
 * @desc    Proxy tải ảnh trang truyện (MangaDex@Home) tránh lỗi chặn Hotlink/CORS
 * @access  Public
 */
router.get('/page', mangaController.getPageImage);

/**
 * @route   GET /api/manga/chapter/:chapterId/pages
 * @desc    Lấy danh sách các trang ảnh của một chương truyện để đọc
 * @access  Public
 */
router.get('/chapter/:chapterId/pages', mangaController.getChapterPages);

/**
 * @route   GET /api/manga/:id/chapters
 * @desc    Lấy danh sách các chương (Chapters) của một bộ truyện theo ID truyện
 * @access  Public
 */
router.get('/:id/chapters', mangaController.getMangaChapters);

/**
 * @route   GET /api/manga/:id
 * @desc    Lấy thông tin chi tiết của một bộ truyện theo ID (kèm điểm đánh giá & lượt theo dõi)
 * @access  Public
 */
router.get('/:id', mangaController.getMangaById);

module.exports = router;
