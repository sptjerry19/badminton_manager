# Badminton Group Manager

Web app quản lý nhóm cầu lông (7 thành viên cố định) với:
- Điểm danh theo buổi
- Tính phí tự động theo rule hiện tại
- Cập nhật công nợ tự động vào Google Sheets
- Giao diện tiếng Việt, dùng tốt trên điện thoại

---

## 1) Plan chi tiết (tiếng Việt)

### 1.1 Cấu trúc thư mục project

```text
badmintonManager/
├─ public/
│  ├─ index.html          # Giao diện web tiếng Việt
│  └─ app.js              # Logic frontend (login, submit buổi, xem công nợ)
├─ src/
│  ├─ config.js           # Biến môi trường + default settings
│  ├─ calc.js             # Logic tính tiền theo rule nhóm
│  └─ sheets.js           # Tầng làm việc với Google Sheets API
├─ server.js              # Express API + static server
├─ package.json
├─ .env.example
└─ README.md
```

### 1.2 Các sheet trong Google Sheets cần có

Backend sẽ tự tạo sheet và header nếu chưa có:

1. `Config`
   - `key`, `value`
   - Lưu tham số hệ thống: `extraCourtRate`, `maleGuestRate`, `femaleGuestRate`, `highThreshold`, `lowThreshold`

2. `Members`
   - `name`, `type`, `gender`, `level`, `active`
   - Danh sách thành viên cố định + GL nếu muốn quản lý lâu dài

3. `Sessions`
   - Tổng hợp mỗi buổi (ngày, tổng chi, tổng người, chế độ tính, cảnh báo...)

4. `Participants`
   - Chi tiết từng người trong từng buổi (sessionId, tên, loại, số tiền phải đóng)

5. `Payments`
   - Log các khoản đã thanh toán

6. `Debts`
   - Bảng công nợ tổng hợp tự động recompute sau mỗi lần submit buổi / thêm payment

### 1.3 API endpoints cần thiết

- `POST /api/login`
  - Body: `{ password }`
  - Đăng nhập bằng mật khẩu chung

- `POST /api/logout`
  - Đăng xuất

- `GET /api/bootstrap`
  - Trả về `settings`, `members`, `debts`, `sessions` để render dashboard

- `POST /api/sessions`
  - Body gồm: `date`, `fixedCourtCost`, `extraCourts`, `shuttlecockCost`, `fixedMembers[]`, `guests[]`
  - Tính tiền + lưu session + lưu participants + cập nhật debts

- `GET /api/debts`
  - Lấy bảng công nợ hiện tại

- `POST /api/payments`
  - Body: `{ date, name, amount, note }`
  - Ghi nhận thanh toán và cập nhật debts

### 1.4 Cách tính tiền (logic)

Giữ đúng rule hiện tại:

- `Tổng chi buổi = tiền sân cố định + số sân thêm * 300k + tiền cầu`
- Đếm người tham gia:
  - TV cố định: checkbox có mặt
  - GL: dòng có tên

#### Nhánh A: `tổng người > 12`
- GL Nam: 80k/người
- GL Nữ: 60k/người
- `Tổng GL = tổng phí GL theo giới tính`
- Phần còn lại cho TV cố định:
  - `pool_fixed = max(tổng chi - tổng GL, 0)`
  - `mỗi TV cố định có mặt = pool_fixed / số TV có mặt`

#### Nhánh B: `tổng người <= 12`
- Chia đều tổng chi cho tất cả người có mặt (TV + GL)

#### Cảnh báo
- Nếu `tổng người < 8` mà vẫn nhập `sân thêm > 0` -> ghi warning để nhắc không nên đặt thêm sân.

---

## 2) Code đầy đủ và cách chạy

### 2.1 Cài đặt

```bash
npm install
cp .env.example .env
```

Sửa `.env`:
- `APP_PASSWORD`: mật khẩu dùng chung cả nhóm
- `SESSION_SECRET`: chuỗi bất kỳ
- `GOOGLE_SHEET_ID`: ID file Google Sheet
- `GOOGLE_APPLICATION_CREDENTIALS`: đường dẫn `credentials.json`
  - hoặc dùng `GOOGLE_SERVICE_ACCOUNT_JSON` (khi deploy)

### 2.2 Chạy local

```bash
npm run dev
```

Mở `http://localhost:3000`

---

## 3) Hướng dẫn setup Google Service Account + credentials.json

1. Vào [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới (hoặc dùng project có sẵn)
3. Enable API: **Google Sheets API**
4. Vào **IAM & Admin** → **Service Accounts** → **Create service account**
5. Vào service account vừa tạo → tab **Keys** → **Add key** → **Create new key** → chọn **JSON**
6. File JSON tải về, đổi tên thành `credentials.json` và đặt trong root project
7. Mở Google Sheet của bạn:
   - bấm Share
   - chia sẻ cho email service account (dạng `xxx@xxx.iam.gserviceaccount.com`)
   - quyền **Editor**
8. Lấy `GOOGLE_SHEET_ID` từ URL:
   - `https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit`

---

## 4) Hướng dẫn deploy lên Vercel

### 4.1 Chuẩn bị
- Đẩy code lên GitHub
- Tạo account Vercel

### 4.2 Tạo project trên Vercel
1. `New Project` -> import repo GitHub
2. Framework preset: `Other`
3. Build command: để trống
4. Output directory: để trống

### 4.3 Environment variables trên Vercel

Thêm các biến:
- `APP_PASSWORD`
- `SESSION_SECRET`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (paste toàn bộ JSON service account thành 1 dòng)

> Trên Vercel nên dùng `GOOGLE_SERVICE_ACCOUNT_JSON` để không cần upload file `credentials.json`.

### 4.4 Deploy
- Bấm Deploy
- Sau deploy, mở URL Vercel để test login/submit

---

## 5) Hướng dẫn sử dụng cho người không biết code

### 5.1 Tạo buổi đánh mới
1. Mở web
2. Nhập mật khẩu chung
3. Chọn ngày đánh
4. Nhập tiền sân cố định, số sân thêm, tiền cầu
5. Tick ai đi trong 7 thành viên cố định
6. Bấm `+ Thêm GL` để nhập khách giao lưu (tên + giới tính)
7. Bấm `Submit điểm danh & tính tiền`
8. Web sẽ hiện bảng tính tiền + tự cập nhật công nợ

### 5.2 Xem công nợ
- Kéo xuống mục `Công nợ tổng hợp`
- Cột `Số dư`:
  - Dương: còn nợ
  - Âm: đã đóng dư

### 5.3 Ghi nhận đã thanh toán
1. Vào phần `Ghi nhận thanh toán`
2. Chọn ngày, nhập tên, số tiền, ghi chú (nếu có)
3. Bấm `Lưu thanh toán`
4. Bảng công nợ tự cập nhật ngay

### 5.4 Thêm thành viên mới
1. Mở Google Sheet -> tab `Members`
2. Thêm dòng mới:
   - `name`: tên người
   - `type`: `Cố định` hoặc `GL`
   - `active`: `TRUE`
3. Reload web, hệ thống sẽ lấy danh sách mới

---

## 6) Gợi ý cải tiến Phase 2

1. **Trình độ thành viên (1-10 hoặc Beginner/Intermediate/Advanced)**
   - Dùng cột `level` trong `Members`
   - Thêm giao diện chỉnh level

2. **Tự động xếp trận đôi**
   - Rule: ưu tiên chênh lệch level không quá 2
   - Generate danh sách cặp đấu theo vòng

3. **Thông báo tự động**
   - Tích hợp bot Telegram/Zalo OA để gửi:
     - lịch đánh
     - công nợ còn thiếu
     - kết quả buổi mới

4. **Tách quyền**
   - Admin mới được submit buổi / ghi payment
   - Thành viên chỉ xem lịch và công nợ bản thân

5. **Xuất báo cáo tháng**
   - Tổng chi tháng
   - Tỷ lệ tham gia từng thành viên
   - Top nợ / đã thanh toán

---

## 7) Ghi chú vận hành

- Ứng dụng ưu tiên sự đơn giản và dễ bảo trì:
  - Không cần DB riêng, chỉ dùng Google Sheets
  - Deploy dễ trên Vercel/Render/Railway
- Nếu số dữ liệu tăng lớn (vài chục ngàn dòng), cân nhắc chuyển sang Postgres.
