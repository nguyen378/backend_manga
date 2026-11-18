const mangadexService = require('../services/mangadex.service');
const { getDb, isFirebaseEnabled } = require('../config/firebase');
const env = require('../config/env');

/**
 * Controller: Lấy danh sách truyện phổ biến từ MangaDex (có tích hợp cache Firestore nếu Firebase đã bật)
 * Endpoint: GET /api/manga/popular
 * Query params:
 *  - limit (number, default: 20, max: 100)
 *  - offset (number, default: 0)
 *  - type ('followed' | 'rating', default: 'followed')
 *  - lang (string, optional, vd: 'vi', 'en')
 */
async function getPopularManga(req, res, next) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const type = req.query.type === 'rating' ? 'rating' : 'followed';
    const translatedLanguage = req.query.lang ? String(req.query.lang).trim() : '';

    // Tự động lấy địa chỉ máy chủ hiện tại (hỗ trợ cả http local và https khi deploy lên Vercel/Render)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseServerUrl = `${protocol}://${host}`;

    const cacheKey = `popular_${type}_limit${limit}_offset${offset}_lang${translatedLanguage || 'all'}`;

    // 1. Kiểm tra Cache trong Firebase Firestore (nếu đã kích hoạt Firebase)
    if (isFirebaseEnabled()) {
      try {
        const db = getDb();
        const cacheDoc = await db.collection('manga_cache').doc(cacheKey).get();

        if (cacheDoc.exists) {
          const cachedData = cacheDoc.data();
          const now = Date.now();
          if (cachedData.expiresAt && cachedData.expiresAt > now) {
            return res.status(200).json({
              success: true,
              source: 'firebase_cache',
              ...cachedData.payload,
            });
          }
        }
      } catch (cacheReadErr) {
        console.warn('[Firestore Cache Read Warning]:', cacheReadErr.message);
      }
    }

    // 2. Gọi MangaDex API để lấy danh sách truyện phổ biến
    const result = await mangadexService.fetchPopularManga({
      limit,
      offset,
      type,
      translatedLanguage,
      baseServerUrl,
    });

    // 3. Lưu kết quả vào Firebase Firestore Cache (nếu đã kích hoạt Firebase)
    if (isFirebaseEnabled()) {
      try {
        const db = getDb();
        const now = Date.now();
        await db
          .collection('manga_cache')
          .doc(cacheKey)
          .set({
            payload: result,
            updatedAt: now,
            expiresAt: now + env.cacheTtlSeconds * 1000,
          });
      } catch (cacheWriteErr) {
        console.warn('[Firestore Cache Write Warning]:', cacheWriteErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      source: 'mangadex_api',
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Proxy tải ảnh bìa từ MangaDex giúp trình duyệt của học sinh không bao giờ bị chặn Hotlink (403 Forbidden)
 * Endpoint: GET /api/manga/cover/:mangaId/:fileName
 */
async function getCoverImage(req, res, next) {
  try {
    const { mangaId, fileName } = req.params;
    const { buffer, contentType } = await mangadexService.fetchCoverImage(mangaId, fileName);

    // Cho phép trình duyệt và CDN (Vercel/Cloudflare) cache ảnh trong 7 ngày để tải siêu nhanh
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Lấy thông tin chi tiết của một truyện theo ID
 * Endpoint: GET /api/manga/:id
 */
async function getMangaById(req, res, next) {
  try {
    const { id } = req.params;

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseServerUrl = `${protocol}://${host}`;

    const cacheKey = `detail_${id}`;

    // 1. Kiểm tra Cache trong Firebase Firestore (nếu đã kích hoạt Firebase)
    if (isFirebaseEnabled()) {
      try {
        const db = getDb();
        const cacheDoc = await db.collection('manga_cache').doc(cacheKey).get();

        if (cacheDoc.exists) {
          const cachedData = cacheDoc.data();
          const now = Date.now();
          if (cachedData.expiresAt && cachedData.expiresAt > now) {
            return res.status(200).json({
              success: true,
              source: 'firebase_cache',
              data: cachedData.payload,
            });
          }
        }
      } catch (cacheReadErr) {
        console.warn('[Firestore Cache Read Warning]:', cacheReadErr.message);
      }
    }

    // 2. Gọi MangaDex API lấy thông tin chi tiết truyện & thống kê
    const mangaDetail = await mangadexService.fetchMangaById(id, { baseServerUrl });

    // 3. Lưu kết quả vào Firebase Firestore Cache (nếu đã kích hoạt Firebase)
    if (isFirebaseEnabled()) {
      try {
        const db = getDb();
        const now = Date.now();
        await db
          .collection('manga_cache')
          .doc(cacheKey)
          .set({
            payload: mangaDetail,
            updatedAt: now,
            expiresAt: now + env.cacheTtlSeconds * 1000,
          });
      } catch (cacheWriteErr) {
        console.warn('[Firestore Cache Write Warning]:', cacheWriteErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      source: 'mangadex_api',
      data: mangaDetail,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Lấy danh sách các chương (Chapters) của một bộ truyện
 * Endpoint: GET /api/manga/:id/chapters
 * Query params:
 *  - limit (number, default: 100, max: 500)
 *  - offset (number, default: 0)
 *  - order ('asc' | 'desc', default: 'asc')
 *  - lang (string, default: 'vi,en', truyền 'all' để lấy mọi ngôn ngữ)
 */
async function getMangaChapters(req, res, next) {
  try {
    const { id } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const order = req.query.order === 'desc' ? 'desc' : 'asc';
    const translatedLanguage = req.query.lang
      ? String(req.query.lang).trim()
      : '';

    const cacheKey = `chapters_${id}_limit${limit}_offset${offset}_order${order}_lang${translatedLanguage || 'auto'}`;

    // 1. Kiểm tra Cache trong Firebase Firestore (nếu đã kích hoạt Firebase)
    if (isFirebaseEnabled()) {
      try {
        const db = getDb();
        const cacheDoc = await db.collection('manga_cache').doc(cacheKey).get();

        if (cacheDoc.exists) {
          const cachedData = cacheDoc.data();
          const now = Date.now();
          if (cachedData.expiresAt && cachedData.expiresAt > now) {
            return res.status(200).json({
              success: true,
              source: 'firebase_cache',
              ...cachedData.payload,
            });
          }
        }
      } catch (cacheReadErr) {
        console.warn('[Firestore Cache Read Warning]:', cacheReadErr.message);
      }
    }

    // 2. Gọi MangaDex API lấy danh sách chương truyện
    const result = await mangadexService.fetchMangaChapters(id, {
      limit,
      offset,
      order,
      translatedLanguage,
    });

    // 3. Lưu kết quả vào Firebase Firestore Cache (nếu đã kích hoạt Firebase)
    if (isFirebaseEnabled()) {
      try {
        const db = getDb();
        const now = Date.now();
        await db
          .collection('manga_cache')
          .doc(cacheKey)
          .set({
            payload: result,
            updatedAt: now,
            expiresAt: now + env.cacheTtlSeconds * 1000,
          });
      } catch (cacheWriteErr) {
        console.warn('[Firestore Cache Write Warning]:', cacheWriteErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      source: 'mangadex_api',
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Lấy danh sách hình ảnh các trang của 1 chương truyện để đọc
 * Endpoint: GET /api/manga/chapter/:chapterId/pages
 */
async function getChapterPages(req, res, next) {
  try {
    const { chapterId } = req.params;

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseServerUrl = `${protocol}://${host}`;

    const result = await mangadexService.fetchChapterPages(chapterId, {
      baseServerUrl,
    });

    return res.status(200).json({
      success: true,
      source: 'mangadex_api',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Proxy tải trang ảnh chương truyện từ MangaDex@Home
 * Endpoint: GET /api/manga/page?url=...
 */
async function getPageImage(req, res, next) {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu tham số url của trang ảnh',
      });
    }

    const { buffer, contentType } = await mangadexService.fetchPageImage(targetUrl);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPopularManga,
  getMangaById,
  getMangaChapters,
  getChapterPages,
  getCoverImage,
  getPageImage,
};
