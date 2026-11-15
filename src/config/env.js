require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5000,
  mangadexBaseUrl: process.env.MANGADEX_BASE_URL || 'https://api.mangadex.org',
  mangadexUploadsUrl: process.env.MANGADEX_UPLOADS_URL || 'https://uploads.mangadex.org',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : '',
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 900,
};
