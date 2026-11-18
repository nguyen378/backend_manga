# Backend MangaDex API (Node.js + Express + Firebase)

Backend đóng vai trò trung gian kết nối với **MangaDex API v5**, chuẩn hóa dữ liệu truyện tranh (tiêu đề, mô tả, thể loại, tác giả, link ảnh bìa hoàn chỉnh) và hỗ trợ bộ nhớ đệm (Cache) thông qua **Firebase Firestore**.

---

## 1. Cấu trúc thư mục

```text
backend_manga/
├── src/
│   ├── config/
│   │   ├── env.js              # Quản lý biến môi trường
│   │   └── firebase.js         # Khởi tạo Firebase Admin SDK & Firestore
│   ├── services/
│   │   └── mangadex.service.js # Gọi MangaDex API & chuẩn hóa dữ liệu
│   ├── controllers/
│   │   └── manga.controller.js # Xử lý request/response và Firestore Cache
│   ├── routes/
│   │   └── manga.routes.js     # Định nghĩa route /api/manga/...
│   └── app.js                  # Cấu hình Express, CORS, Error Handler
├── .env                        # Biến môi trường
├── .env.example                # Mẫu cấu hình biến môi trường
├── package.json
└── server.js                   # Điểm khởi chạy ứng dụng
```

---

## 2. Hướng dẫn cài đặt và chạy dự án

### Bước 1: Cài đặt thư viện
```bash
npm install
```

### Bước 2: Cấu hình Firebase (Tuỳ chọn)
Hệ thống được thiết kế để **tự động chạy được ngay cả khi bạn chưa cấu hình Firebase** (khi đó server sẽ gọi trực tiếp từ MangaDex API).
Để bật tính năng lưu/cache trên Firebase Firestore:
1. Vào **Firebase Console** -> **Project Settings** -> **Service accounts** -> **Generate new private key**.
2. Đổi tên file tải về thành `serviceAccountKey.json` và đặt vào thư mục gốc `backend_manga/`.

### Bước 3: Khởi chạy Server
- Chạy chế độ phát triển (tự động reload khi sửa code):
  ```bash
  npm run dev
  ```
- Chạy chế độ thông thường:
  ```bash
  npm start
  ```

---

## 3. Tài liệu API (Endpoints)

### 3.1. Kiểm tra trạng thái Server
- **URL:** `GET /health`
- **Response:**
  ```json
  {
    "status": "ok",
    "service": "backend_manga",
    "firebaseConnected": false,
    "timestamp": "2026-11-15T08:00:00.000Z"
  }
  ```

### 3.2. Lấy danh sách truyện phổ biến (Popular Manga)
- **URL:** `GET /api/manga/popular`
- **Query Parameters:**
  | Tham số | Kiểu | Mặc định | Mô tả |
  | :--- | :--- | :--- | :--- |
  | `limit` | `number` | `20` | Số lượng truyện trả về (từ `1` đến `100`) |
  | `offset` | `number` | `0` | Vị trí bắt đầu phân trang |
  | `type` | `string` | `followed` | `followed` (nhiều lượt theo dõi nhất) hoặc `rating` (điểm đánh giá cao nhất) |
  | `lang` | `string` | *(trống)* | Lọc các truyện có bản dịch theo ngôn ngữ (ví dụ: `vi`, `en`) |

- **Ví dụ gọi API:**
  - Lấy 10 truyện phổ biến nhất: `GET http://localhost:5000/api/manga/popular?limit=10`
  - Lấy 10 truyện điểm cao nhất có bản dịch tiếng Việt: `GET http://localhost:5000/api/manga/popular?limit=10&type=rating&lang=vi`

### 3.3. Lấy thông tin chi tiết một bộ truyện (Manga Details)
- **URL:** `GET /api/manga/:id`
- **Ví dụ:** `GET http://localhost:5000/api/manga/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0`
- **Dữ liệu trả về:** Thông tin đầy đủ của truyện (`title`, `description`, `tags`, `authors`, `artists`, `status`, `year`, `availableTranslatedLanguages`, `coverUrl` qua Proxy) kèm theo thống kê `statistics` (`rating.average`, `rating.bayesian`, `follows`).

### 3.4. Lấy danh sách các chương của một bộ truyện (Manga Chapters)
- **URL:** `GET /api/manga/:id/chapters`
- **Query Parameters:**
  | Tham số | Kiểu | Mặc định | Mô tả |
  | :--- | :--- | :--- | :--- |
  | `limit` | `number` | `100` | Số lượng chương trả về (tối đa `500`) |
  | `offset` | `number` | `0` | Vị trí bắt đầu phân trang |
  | `order` | `string` | `asc` | `asc` (từ chương 1 trở đi) hoặc `desc` (chương mới nhất trước) |
  | `lang` | `string` | *(tự động ưu tiên `vi,en`)* | Lọc theo ngôn ngữ dịch (`vi`, `en`, `vi,en`, hoặc `all` để lấy mọi ngôn ngữ) |

- **Ví dụ:** `GET http://localhost:5000/api/manga/aa6c76f7-5f5f-46b6-a800-911145f81b9b/chapters?limit=50&order=asc`

### 3.5. Lấy danh sách các trang ảnh của một chương để đọc (Chapter Pages)
- **URL:** `GET /api/manga/chapter/:chapterId/pages`
- **Dữ liệu trả về:** Thông tin chương (`chapter`), tổng số trang (`totalPages`), mảng ảnh chất lượng cao (`pages`) và mảng ảnh tiết kiệm dung lượng (`pagesDataSaver`). Mỗi phần tử chứa sẵn `imageUrl` đã đi qua Proxy của Backend để không bị chặn trên trình duyệt.


