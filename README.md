# Badminton Group Manager

Web app quản lý nhóm cầu lông (7 thành viên cố định) với:
- Điểm danh theo buổi
- Tính phí tự động theo rule hiện tại
- Cập nhật công nợ tự động vào Google Sheets
- Giao diện tiếng Việt, dùng tốt trên điện thoại

---

## 1) Kiến trúc hiện tại (Phase 2.5)

- **Primary DB:** Vercel Postgres (`POSTGRES_URL`)
- **Backup/Reporting mirror:** Google Sheets
- **Cơ chế sync:** dữ liệu được đồng bộ từ Postgres -> Google Sheets mỗi ngày qua Vercel Cron (`/api/cron/sync-sheets`)
- **Manual sync:** admin có thể gọi `POST /api/admin/sync-sheets`

---

## 2) Plan chi tiết (tiếng Việt)

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

### 2.2 Các sheet trong Google Sheets cần có (Phase 2)

Backend sẽ tự tạo sheet và header nếu chưa có:

1. `Config`
   - `key`, `value`
   - Lưu tham số hệ thống: `extraCourtRate`, `maleGuestRate`, `femaleGuestRate`, `highThreshold`, `lowThreshold`

2. `Members`
   - `memberId`, `name`, `type`, `gender`, `level`, `active`, `phoneNumber`, `zaloId`, `createdAt`, `updatedAt`
   - `level` được validate từ 1 -> 10

3. `Sessions`
   - `sessionId`, `date`, `time`, `location`, `note`, `fixedCourtCost`, `extraCourts`, `shuttlecockCost`, `totalCost`, `createdBy`, `createdAt`

4. `SessionParticipants`
   - `sessionId`, `memberId`, `memberName`, `status` (`yes`/`no`/`pending`), `respondedAt`

5. `Polls`
   - `pollId`, `sessionId`, `question`, `createdAt`

6. `PollAnswers`
   - `pollId`, `sessionId`, `memberId`, `memberName`, `answer`, `answeredAt`

7. `Payments`
   - `paymentId`, `date`, `memberId`, `memberName`, `amount`, `note`, `createdAt`

8. `Debts`
   - Bảng công nợ tổng hợp tự động recompute sau mỗi lần submit buổi / thêm payment

9. `MatchPairHistory`
   - Lưu lịch sử cặp đôi để giảm lặp cặp khi auto generate trận

### 2.3 API endpoints Phase 2

- `GET /api/login-options`
  - Lấy danh sách thành viên cố định cho dropdown user login

- `POST /api/login`
  - Admin: `{ mode: "admin", password }`
  - User: `{ mode: "user", memberName, phoneNumber }`

- `POST /api/logout`
  - Đăng xuất

- `GET /api/bootstrap`
  - Admin: trả về `members`, `sessions`, `debts`, `payments`
  - User: trả về `upcomingSession`, `myDebt`, `myHistory`, `myPayments`

- `POST /api/sessions`
  - Admin tạo buổi và poll để điểm danh trước trận (Phase 2): `date`, `time`, `location`, `note`, `pollQuestion`

- `POST /api/sessions/:sessionId/settle`
  - Admin chốt dữ liệu thực tế sau trận (Phase 1): `fixedCourtCost`, `extraCourts`, `shuttlecockCost`, `fixedMembers[]`, `guests[]`
  - Endpoint này mới là nơi tính phí và cập nhật công nợ

- `POST /api/sessions/:sessionId/respond`
  - User trả lời bắt buộc tham gia `yes/no` + poll answer (nếu có poll)

- `POST /api/sessions/:sessionId/guests`
  - Admin thêm GL vào danh sách điểm danh trước buổi (`guestName`, `level`, `status`)
  - GL được đưa vào xếp trận nếu status = `yes`

- `POST /api/sessions/:sessionId/matches`
  - Admin generate Round 1..N cho đánh đôi theo level

- `PATCH /api/members/level`
  - Admin update level member (1-10)

- `POST /api/payments`
  - Admin ghi nhận thanh toán: `{ date, memberName, amount, note }`

- `GET /api/reports/monthly?month=YYYY-MM`
  - JSON report tháng

- `GET /api/reports/monthly?month=YYYY-MM&format=csv`
  - Export CSV

- `POST /api/admin/sync-sheets`
  - Admin trigger đồng bộ Postgres -> Google Sheets thủ công

- `POST /api/admin/migrate-from-sheets`
  - One-time migration: import toàn bộ dữ liệu hiện có từ Google Sheets vào Postgres

- `GET /api/cron/sync-sheets`
  - Dùng cho Vercel Cron (bảo vệ bằng `CRON_SECRET`)

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

## 3) Code đầy đủ và cách chạy

### 2.1 Cài đặt

```bash
npm install
cp .env.example .env
```

Sửa `.env`:
- `APP_PASSWORD`: mật khẩu dùng chung cả nhóm
- `ADMIN_PASSWORD`: mật khẩu admin
- `SESSION_SECRET`: chuỗi bất kỳ
- `POSTGRES_URL`: connection string Vercel Postgres
- `CRON_SECRET`: secret cho cron sync endpoint
- `GOOGLE_SHEET_ID`: ID file Google Sheet
- `GOOGLE_APPLICATION_CREDENTIALS`: đường dẫn `credentials.json`
  - hoặc dùng `GOOGLE_SERVICE_ACCOUNT_JSON` (khi deploy)

### 3.2 Chạy local

```bash
npm run dev
```

Mở `http://localhost:3000`

---

## 4) Hướng dẫn setup Google Service Account + credentials.json

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

## 5) Hướng dẫn deploy lên Vercel

### 4.1 Chuẩn bị
- Đẩy code lên GitHub
- Tạo account Vercel

### 4.2 Tạo project trên Vercel
1. `New Project` -> import repo GitHub
2. Framework preset: `Other`
3. Build command: để trống
4. Output directory: để trống

### 5.3 Environment variables trên Vercel

Thêm các biến:
- `APP_PASSWORD`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `POSTGRES_URL`
- `CRON_SECRET`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (paste toàn bộ JSON service account thành 1 dòng)

> Trên Vercel nên dùng `GOOGLE_SERVICE_ACCOUNT_JSON` để không cần upload file `credentials.json`.
> Nếu cấu hình `CRON_SECRET`, Vercel Cron sẽ tự gửi `Authorization: Bearer <CRON_SECRET>`.

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

## 6) Phase 2 đã triển khai

1. **Level thành viên**
   - `Members.level` chuẩn hóa 1-10
   - Admin update level trực tiếp trên UI và API

2. **Login admin/user + phone**
   - Admin login bằng password env (`ADMIN_PASSWORD`)
   - User login bằng dropdown thành viên + số điện thoại
   - Số điện thoại được lưu vào `Members.phoneNumber`

3. **RBAC đơn giản**
   - Admin: full quyền quản trị
   - User: chỉ xem dữ liệu cá nhân + vote tham gia + trả lời poll

4. **Session + điểm danh + poll**
   - Admin tạo buổi với ngày/giờ/địa điểm/note/poll
   - User phải phản hồi `yes/no` cho buổi upcoming
   - Nếu buổi có poll thì user bắt buộc nhập câu trả lời poll

5. **Auto xếp trận**
   - Generate theo vòng, cân bằng level 2 đội, giảm lặp cặp
   - Lưu lịch sử cặp vào `MatchPairHistory`

6. **NotificationService abstraction**
   - `NotificationService.sendToMember(memberId, message)`
   - Hiện tại là stub log console, sẵn điểm nối Telegram/Zalo OA

7. **Công nợ và payment**
   - Debt được recompute theo số người `yes` từng buổi
   - Công thức: share từng buổi = `totalCost / số người yes`
   - `debt = totalDue - totalPaid`

8. **Báo cáo tháng + CSV**
   - Tổng chi tháng
   - Tỷ lệ tham gia từng member
   - Top nợ / top thanh toán

---

## 7) Ghi chú vận hành

- Ứng dụng ưu tiên sự đơn giản và dễ bảo trì:
  - Không cần DB riêng, chỉ dùng Google Sheets
  - Deploy dễ trên Vercel/Render/Railway
- Nếu số dữ liệu tăng lớn (vài chục ngàn dòng), cân nhắc chuyển sang Postgres.
