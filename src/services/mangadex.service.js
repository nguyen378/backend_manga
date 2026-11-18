const axios = require('axios');
const https = require('https');
const env = require('../config/env');

// Ưu tiên IPv4 để tránh lỗi ECONNRESET trên một số nhà mạng khi gọi tới Cloudflare/MangaDex
const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
});

// Khởi tạo Axios client với User-Agent theo yêu cầu bắt buộc của MangaDex API
const mangadexClient = axios.create({
  baseURL: env.mangadexBaseUrl,
  timeout: 15000,
  httpsAgent,
  headers: {
    'User-Agent': 'JSA15-MangaBackend/1.0.0 (Node.js; Express)',
    Accept: 'application/json',
  },
});

/**
 * Helper tự động thử lại nếu gặp lỗi mạng tạm thời (ECONNRESET, ETIMEDOUT)
 */
async function requestWithRetry(fn, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isNetworkError =
        !err.response &&
        (err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNABORTED' ||
          err.message?.includes('ECONNRESET'));
      if (attempt < retries && isNetworkError) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Chọn chuỗi ngôn ngữ ưu tiên từ object đa ngôn ngữ của MangaDex (ưu tiên: vi -> en -> ja-ro -> ja -> ngôn ngữ đầu tiên)
 * @param {Object} localizedObj Object chứa các bản dịch theo mã ngôn ngữ
 * @returns {string}
 */
function pickLocalizedText(localizedObj) {
  if (!localizedObj || typeof localizedObj !== 'object') return '';
  const preferredLangs = ['vi', 'en', 'ja-ro', 'ja'];
  for (const lang of preferredLangs) {
    if (localizedObj[lang]) return localizedObj[lang];
  }
  const firstKey = Object.keys(localizedObj)[0];
  return firstKey ? localizedObj[firstKey] : '';
}

/**
 * Chuẩn hóa 1 object Manga từ cấu trúc của MangaDex sang định dạng gọn gàng cho Frontend
 * @param {Object} rawManga Dữ liệu thô của 1 manga từ MangaDex API
 * @param {string} [baseServerUrl=''] Địa chỉ gốc của Backend (ví dụ: https://backend.vercel.app) để tạo link ảnh proxy không bị chặn
 * @returns {Object}
 */
function normalizeManga(rawManga, baseServerUrl = '') {
  const { id, attributes = {}, relationships = [] } = rawManga;

  // Lấy tiêu đề chính và danh sách tiêu đề phụ
  const title = pickLocalizedText(attributes.title) || 'Untitled';
  const description = pickLocalizedText(attributes.description);

  // Tìm thông tin ảnh bìa (cover_art) trong mảng relationships
  const coverRel = relationships.find((rel) => rel.type === 'cover_art');
  const coverFileName = coverRel?.attributes?.fileName || null;

  // Link gốc trực tiếp từ MangaDex (sẽ bị chặn nếu web deploy mà không có referrerpolicy="no-referrer")
  const directOriginalCoverUrl = coverFileName
    ? `${env.mangadexUploadsUrl}/covers/${id}/${coverFileName}`
    : null;
  const directCoverUrl = coverFileName
    ? `${env.mangadexUploadsUrl}/covers/${id}/${coverFileName}.512.jpg`
    : null;
  const directThumbnailUrl = coverFileName
    ? `${env.mangadexUploadsUrl}/covers/${id}/${coverFileName}.256.jpg`
    : null;

  // Link qua Proxy của Backend (không bao giờ bị chặn trên trình duyệt của học sinh)
  const cleanBaseUrl = baseServerUrl ? baseServerUrl.replace(/\/$/, '') : '';
  const coverUrl = coverFileName
    ? cleanBaseUrl
      ? `${cleanBaseUrl}/api/manga/cover/${id}/${coverFileName}.512.jpg`
      : directCoverUrl
    : null;
  const coverThumbnailUrl = coverFileName
    ? cleanBaseUrl
      ? `${cleanBaseUrl}/api/manga/cover/${id}/${coverFileName}.256.jpg`
      : directThumbnailUrl
    : null;
  const originalCoverUrl = coverFileName
    ? cleanBaseUrl
      ? `${cleanBaseUrl}/api/manga/cover/${id}/${coverFileName}`
      : directOriginalCoverUrl
    : null;

  // Tìm tên tác giả (author) và họa sĩ (artist)
  const authors = relationships
    .filter((rel) => rel.type === 'author' && rel.attributes?.name)
    .map((rel) => ({ id: rel.id, name: rel.attributes.name }));

  const artists = relationships
    .filter((rel) => rel.type === 'artist' && rel.attributes?.name)
    .map((rel) => ({ id: rel.id, name: rel.attributes.name }));

  // Chuẩn hóa danh sách thể loại (tags)
  const tags = (attributes.tags || []).map((tag) => ({
    id: tag.id,
    name: pickLocalizedText(tag.attributes?.name),
    group: tag.attributes?.group || 'genre',
  }));

  return {
    id,
    title,
    altTitles: attributes.altTitles || [],
    description,
    status: attributes.status || null,
    year: attributes.year || null,
    contentRating: attributes.contentRating || 'safe',
    originalLanguage: attributes.originalLanguage || null,
    lastVolume: attributes.lastVolume || null,
    lastChapter: attributes.lastChapter || null,
    publicationDemographic: attributes.publicationDemographic || null,
    tags,
    authors,
    artists,
    author: authors[0]?.name || null,
    coverFileName,
    coverUrl,
    coverThumbnailUrl,
    originalCoverUrl,
    directCoverUrl,
    createdAt: attributes.createdAt || null,
    updatedAt: attributes.updatedAt || null,
  };
}

/**
 * Lấy danh sách truyện phổ biến từ MangaDex API
 * @param {Object} options Tham số truy vấn
 * @param {number} [options.limit=20] Số lượng truyện trả về (1 - 100)
 * @param {number} [options.offset=0] Vị trí bắt đầu phân trang
 * @param {'followed'|'rating'} [options.type='followed'] Tiêu chí phổ biến: lượt theo dõi ('followed') hoặc điểm đánh giá ('rating')
 * @param {string} [options.translatedLanguage] Mã ngôn ngữ bản dịch (vd: 'vi', 'en') nếu muốn lọc
 * @param {string} [options.baseServerUrl=''] URL gốc của server hiện tại để tạo link proxy ảnh
 */
async function fetchPopularManga({
  limit = 20,
  offset = 0,
  type = 'followed',
  translatedLanguage = '',
  baseServerUrl = '',
} = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const params = new URLSearchParams();
  params.append('limit', String(safeLimit));
  params.append('offset', String(safeOffset));

  // Bao gồm thông tin ảnh bìa, tác giả và họa sĩ ngay trong 1 lần gọi
  params.append('includes[]', 'cover_art');
  params.append('includes[]', 'author');
  params.append('includes[]', 'artist');

  // Lọc mức độ nội dung an toàn mặc định
  params.append('contentRating[]', 'safe');
  params.append('contentRating[]', 'suggestive');

  // Sắp xếp theo tiêu chí phổ biến
  if (type === 'rating') {
    params.append('order[rating]', 'desc');
  } else {
    params.append('order[followedCount]', 'desc');
  }

  // Nếu có truyền ngôn ngữ bản dịch cụ thể (vd: 'vi' hoặc 'en')
  if (translatedLanguage) {
    params.append('availableTranslatedLanguage[]', translatedLanguage);
  }

  const response = await requestWithRetry(() =>
    mangadexClient.get(`/manga?${params.toString()}`)
  );
  const payload = response.data;

  const normalizedList = (payload.data || []).map((item) =>
    normalizeManga(item, baseServerUrl)
  );

  return {
    total: payload.total || normalizedList.length,
    limit: payload.limit || safeLimit,
    offset: payload.offset || safeOffset,
    data: normalizedList,
  };
}

/**
 * Tải ảnh bìa từ MangaDex Uploads Server (dùng cho Proxy để tránh lỗi chặn Hotlink/CORS trên trình duyệt)
 * @param {string} mangaId UUID của truyện
 * @param {string} fileName Tên file ảnh bìa (vd: abc.jpg.512.jpg)
 */
async function fetchCoverImage(mangaId, fileName) {
  const imageUrl = `${env.mangadexUploadsUrl}/covers/${encodeURIComponent(mangaId)}/${encodeURIComponent(fileName)}`;
  const response = await requestWithRetry(() =>
    axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      httpsAgent,
      headers: {
        'User-Agent': 'JSA15-MangaBackend/1.0.0 (Node.js; Express)',
      },
    })
  );

  return {
    buffer: response.data,
    contentType: response.headers['content-type'] || 'image/jpeg',
  };
}

module.exports = {
  fetchPopularManga,
  normalizeManga,
  fetchCoverImage,
};
