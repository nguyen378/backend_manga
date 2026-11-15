const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const env = require('./env');

let db = null;
let isFirebaseEnabled = false;

/**
 * Khởi tạo Firebase Admin SDK và Firestore.
 * Nếu chưa cấu hình serviceAccountKey.json hoặc biến môi trường Firebase,
 * ứng dụng vẫn hoạt động bình thường (chỉ bỏ qua bước lưu/đọc cache trên Firestore).
 */
function initFirebase() {
  try {
    if (admin.apps.length > 0) {
      db = admin.firestore();
      isFirebaseEnabled = true;
      return { db, isFirebaseEnabled };
    }

    const resolvedKeyPath = path.resolve(process.cwd(), env.firebaseServiceAccountPath);

    if (fs.existsSync(resolvedKeyPath)) {
      const serviceAccount = require(resolvedKeyPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      db = admin.firestore();
      isFirebaseEnabled = true;
      console.log('[Firebase] Đã kết nối Firestore qua file serviceAccountKey.json');
    } else if (env.firebaseProjectId && env.firebaseClientEmail && env.firebasePrivateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.firebaseProjectId,
          clientEmail: env.firebaseClientEmail,
          privateKey: env.firebasePrivateKey,
        }),
      });
      db = admin.firestore();
      isFirebaseEnabled = true;
      console.log('[Firebase] Đã kết nối Firestore qua biến môi trường (.env)');
    } else {
      console.log(
        '[Firebase] Chưa cấu hình thông tin xác thực Firebase. Hệ thống sẽ gọi trực tiếp MangaDex API (bỏ qua Firestore cache).'
      );
    }
  } catch (error) {
    console.warn('[Firebase] Không thể khởi tạo Firebase Admin:', error.message);
    isFirebaseEnabled = false;
    db = null;
  }

  return { db, isFirebaseEnabled };
}

initFirebase();

module.exports = {
  admin,
  getDb: () => db,
  isFirebaseEnabled: () => isFirebaseEnabled,
};
