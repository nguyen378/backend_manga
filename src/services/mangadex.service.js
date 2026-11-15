const axios = require('axios');
const env = require('../config/env');

// Khởi tạo Axios client với User-Agent theo yêu cầu bắt buộc của MangaDex API
const mangadexClient = axios.create({
  baseURL: env.mangadexBaseUrl,
  timeout: 15000,
  headers: {
    'User-Agent': 'JSA15-MangaBackend/1.0.0 (Node.js; Express)',
    Accept: 'application/json',
  },
});

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
 * @returns {Object}
 */
function normalizeManga(rawManga) {
  const { id, attributes = {}, relationships = [] } = rawManga;

  // Lấy tiêu đề chính và danh sách tiêu đề phụ
  const title = pickLocalizedText(attributes.title) || 'Untitled';
  const description = pickLocalizedText(attributes.description);

  // Tìm thông tin ảnh bìa (cover_art) trong mảng relationships
  const coverRel = relationships.find((rel) => rel.type === 'cover_art');
  const coverFileName = coverRel?.attributes?.fileName || null;

  const originalCoverUrl = coverFileName
    ? `${env.mangadexUploadsUrl}/covers/${id}/${coverFileName}`
    : null;
  const coverUrl = coverFileName
    ? `${env.mangadexUploadsUrl}/covers/${id}/${coverFileName}.512.jpg`
    : null;
  const coverThumbnailUrl = coverFileName
    ? `${env.mangadexUploadsUrl}/covers/${id}/${coverFileName}.256.jpg`
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
    coverUrl,
    coverThumbnailUrl,
    originalCoverUrl,
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
 */
async function fetchPopularManga({
  limit = 20,
  offset = 0,
  type = 'followed',
  translatedLanguage = '',
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

  const response = await mangadexClient.get(`/manga?${params.toString()}`);
  const payload = response.data;

  const normalizedList = (payload.data || []).map(normalizeManga);

  return {
    total: payload.total || normalizedList.length,
    limit: payload.limit || safeLimit,
    offset: payload.offset || safeOffset,
    data: normalizedList,
  };
}

module.exports = {
  fetchPopularManga,
  normalizeManga,
};
