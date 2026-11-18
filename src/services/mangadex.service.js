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
    titles: attributes.title || {},
    altTitles: attributes.altTitles || [],
    description,
    descriptions: attributes.description || {},
    status: attributes.status || null,
    year: attributes.year || null,
    contentRating: attributes.contentRating || 'safe',
    originalLanguage: attributes.originalLanguage || null,
    availableTranslatedLanguages: attributes.availableTranslatedLanguages || [],
    lastVolume: attributes.lastVolume || null,
    lastChapter: attributes.lastChapter || null,
    publicationDemographic: attributes.publicationDemographic || null,
    links: attributes.links || {},
    tags,
    authors,
    artists,
    author: authors[0]?.name || null,
    artist: artists[0]?.name || null,
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

/**
 * Lấy thông tin chi tiết của một truyện theo ID (kèm theo thống kê điểm đánh giá & lượt theo dõi)
 * @param {string} mangaId UUID của truyện trên MangaDex
 * @param {Object} [options]
 * @param {string} [options.baseServerUrl=''] URL gốc của server hiện tại để tạo link proxy ảnh
 */
async function fetchMangaById(mangaId, { baseServerUrl = '' } = {}) {
  if (!mangaId) {
    const err = new Error('Vui lòng cung cấp ID truyện (mangaId)');
    err.statusCode = 400;
    throw err;
  }

  const params = new URLSearchParams();
  params.append('includes[]', 'cover_art');
  params.append('includes[]', 'author');
  params.append('includes[]', 'artist');

  // Gọi song song API thông tin truyện và API thống kê (rating, follows)
  const [mangaRes, statsRes] = await Promise.allSettled([
    requestWithRetry(() =>
      mangadexClient.get(`/manga/${encodeURIComponent(mangaId)}?${params.toString()}`)
    ),
    requestWithRetry(() =>
      mangadexClient.get(`/statistics/manga/${encodeURIComponent(mangaId)}`)
    ),
  ]);

  if (mangaRes.status === 'rejected') {
    throw mangaRes.reason;
  }

  const rawManga = mangaRes.value.data?.data;
  const normalized = normalizeManga(rawManga, baseServerUrl);

  // Gắn thêm thông tin thống kê (điểm đánh giá, số người theo dõi) nếu lấy thành công
  let statistics = {
    rating: {
      average: null,
      bayesian: null,
    },
    follows: 0,
  };

  if (statsRes.status === 'fulfilled') {
    const rawStats = statsRes.value.data?.statistics?.[mangaId];
    if (rawStats) {
      statistics = {
        rating: {
          average: rawStats.rating?.average
            ? Number(rawStats.rating.average.toFixed(2))
            : null,
          bayesian: rawStats.rating?.bayesian
            ? Number(rawStats.rating.bayesian.toFixed(2))
            : null,
        },
        follows: rawStats.follows || 0,
      };
    }
  }

  return {
    ...normalized,
    statistics,
  };
}

/**
 * Chuẩn hóa thông tin 1 chương truyện (Chapter) từ MangaDex
 * @param {Object} rawChapter
 */
function normalizeChapter(rawChapter) {
  const { id, attributes = {}, relationships = [] } = rawChapter;

  const scanlationGroups = relationships
    .filter((rel) => rel.type === 'scanlation_group' && rel.attributes?.name)
    .map((rel) => ({ id: rel.id, name: rel.attributes.name }));

  const uploaderRel = relationships.find((rel) => rel.type === 'user');
  const mangaRel = relationships.find((rel) => rel.type === 'manga');

  return {
    id,
    mangaId: mangaRel?.id || null,
    volume: attributes.volume || null,
    chapter: attributes.chapter || null,
    title: attributes.title || null,
    translatedLanguage: attributes.translatedLanguage || null,
    pages: attributes.pages || 0,
    isExternal: Boolean(attributes.externalUrl && !attributes.pages),
    externalUrl: attributes.externalUrl || null,
    publishAt: attributes.publishAt || null,
    readableAt: attributes.readableAt || null,
    createdAt: attributes.createdAt || null,
    scanlationGroup: scanlationGroups[0]?.name || 'No Group',
    scanlationGroups,
    uploader: uploaderRel?.attributes?.username || null,
  };
}

/**
 * Lấy danh sách các chương (Chapters) của một bộ truyện theo mangaId
 * @param {string} mangaId UUID của bộ truyện
 * @param {Object} [options]
 * @param {number} [options.limit=100] Số lượng chương trả về (1 - 500)
 * @param {number} [options.offset=0] Vị trí phân trang
 * @param {'asc'|'desc'} [options.order='asc'] Thứ tự sắp xếp chương ('asc' = từ chương 1, 'desc' = chương mới nhất trước)
 * @param {string} [options.translatedLanguage=''] Ngôn ngữ bản dịch (vd: 'vi', 'en', 'vi,en', hoặc 'all')
 */
async function fetchMangaChapters(
  mangaId,
  {
    limit = 100,
    offset = 0,
    order = 'asc',
    translatedLanguage = '',
  } = {}
) {
  if (!mangaId) {
    const err = new Error('Vui lòng cung cấp ID truyện (mangaId)');
    err.statusCode = 400;
    throw err;
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const safeOrder = order === 'desc' ? 'desc' : 'asc';

  const buildFeedParams = (langFilter) => {
    const params = new URLSearchParams();
    params.append('limit', String(safeLimit));
    params.append('offset', String(safeOffset));
    params.append('includes[]', 'scanlation_group');
    params.append('includes[]', 'user');

    // Lọc nội dung an toàn
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    params.append('contentRating[]', 'erotica');

    // Sắp xếp theo tập (volume) và số chương (chapter)
    params.append('order[volume]', safeOrder);
    params.append('order[chapter]', safeOrder);

    if (langFilter && langFilter !== 'all') {
      const langs = String(langFilter)
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const lang of langs) {
        params.append('translatedLanguage[]', lang);
      }
    }
    return params;
  };

  // Mặc định ưu tiên tìm bản dịch tiếng Việt & tiếng Anh trước nếu người dùng không chỉ định ngôn ngữ
  const initialLang = translatedLanguage || 'vi,en';
  let response = await requestWithRetry(() =>
    mangadexClient.get(
      `/manga/${encodeURIComponent(mangaId)}/feed?${buildFeedParams(initialLang).toString()}`
    )
  );

  let payload = response.data;

  // Nếu người dùng không ép buộc ngôn ngữ cụ thể mà bộ truyện không có bản dịch vi/en,
  // tự động lấy tất cả ngôn ngữ hiện có để học sinh luôn có danh sách chương hiển thị
  if (!translatedLanguage && (!payload.data || payload.data.length === 0)) {
    response = await requestWithRetry(() =>
      mangadexClient.get(
        `/manga/${encodeURIComponent(mangaId)}/feed?${buildFeedParams('all').toString()}`
      )
    );
    payload = response.data;
  }

  const chapters = (payload.data || []).map(normalizeChapter);

  return {
    mangaId,
    total: payload.total || chapters.length,
    limit: payload.limit || safeLimit,
    offset: payload.offset || safeOffset,
    order: safeOrder,
    data: chapters,
  };
}

/**
 * Lấy danh sách đường dẫn ảnh các trang của một chương truyện (MangaDex@Home)
 * @param {string} chapterId UUID của chương truyện
 * @param {Object} [options]
 * @param {string} [options.baseServerUrl=''] Địa chỉ gốc của Backend để tạo link proxy trang truyện
 */
async function fetchChapterPages(chapterId, { baseServerUrl = '' } = {}) {
  if (!chapterId) {
    const err = new Error('Vui lòng cung cấp ID chương truyện (chapterId)');
    err.statusCode = 400;
    throw err;
  }

  const [atHomeRes, chapterInfoRes] = await Promise.allSettled([
    requestWithRetry(() =>
      mangadexClient.get(`/at-home/server/${encodeURIComponent(chapterId)}`)
    ),
    requestWithRetry(() =>
      mangadexClient.get(
        `/chapter/${encodeURIComponent(chapterId)}?includes[]=scanlation_group&includes[]=manga`
      )
    ),
  ]);

  if (atHomeRes.status === 'rejected') {
    throw atHomeRes.reason;
  }

  const { baseUrl, chapter = {} } = atHomeRes.value.data || {};
  const { hash, data = [], dataSaver = [] } = chapter;
  const cleanBaseServerUrl = baseServerUrl ? baseServerUrl.replace(/\/$/, '') : '';

  const buildPageObj = (fileName, index, mode = 'data') => {
    const directUrl = `${baseUrl}/${mode}/${hash}/${fileName}`;
    const proxyUrl = cleanBaseServerUrl
      ? `${cleanBaseServerUrl}/api/manga/page?url=${encodeURIComponent(directUrl)}`
      : directUrl;
    return {
      page: index + 1,
      imageUrl: proxyUrl,
      directImageUrl: directUrl,
    };
  };

  const pages = data.map((fileName, idx) => buildPageObj(fileName, idx, 'data'));
  const pagesDataSaver = dataSaver.map((fileName, idx) =>
    buildPageObj(fileName, idx, 'data-saver')
  );

  const chapterDetail =
    chapterInfoRes.status === 'fulfilled' && chapterInfoRes.value.data?.data
      ? normalizeChapter(chapterInfoRes.value.data.data)
      : { id: chapterId };

  return {
    chapter: chapterDetail,
    totalPages: pages.length,
    pages,
    pagesDataSaver,
  };
}

/**
 * Tải trang ảnh chương truyện từ MangaDex@Home Server (dùng cho Proxy)
 * @param {string} targetUrl Đường dẫn ảnh trang truyện trên MangaDex@Home
 */
async function fetchPageImage(targetUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    const err = new Error('Đường dẫn ảnh trang truyện không hợp lệ');
    err.statusCode = 400;
    throw err;
  }

  // Chỉ cho phép proxy tới các máy chủ hợp lệ của MangaDex để đảm bảo an toàn (chống SSRF)
  const allowedHostSuffixes = ['.mangadex.network', '.mangadex.org'];
  const isAllowed = allowedHostSuffixes.some(
    (suffix) =>
      parsedUrl.hostname.endsWith(suffix) ||
      parsedUrl.hostname === 'uploads.mangadex.org'
  );

  if (!isAllowed) {
    const err = new Error('Chỉ cho phép tải ảnh từ máy chủ của MangaDex');
    err.statusCode = 403;
    throw err;
  }

  const response = await requestWithRetry(() =>
    axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
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
  fetchMangaById,
  fetchMangaChapters,
  fetchChapterPages,
  normalizeManga,
  normalizeChapter,
  fetchCoverImage,
  fetchPageImage,
};
