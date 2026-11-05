# Badminton Group Manager

Ứng dụng quản lý nhóm cầu lông: thành viên, vote tham gia, khách giao lưu, xếp trận, sổ tiền sân, tiền dư, thông báo và giải đấu. Giao diện tiếng Việt, hỗ trợ mobile và dark mode.

## Chạy dự án

Cần Node.js >=22, npm và Postgres. Tạo .env từ .env.example nếu chưa có, điền kết nối database và các secret của môi trường chạy.

    npm ci
    npm run config:check
    npm run db:migrate
    npm start

npm run dev chạy qua nodemon. Không có bước build frontend riêng; Express phục vụ các file trong public/. Trang chính ở /, giải đấu độc lập ở /tournament; /basic chuyển về /.

Startup chỉ kiểm tra lịch sử migration. Schema thiếu hoặc checksum không khớp sẽ không sẵn sàng; không tự tạo bảng hoặc thêm thành viên mẫu. Chạy migration bằng kết nối trực tiếp trước khi khởi động bản mới.

    npm run db:status
    npm run db:seed-demo -- --confirm-demo

Seed demo là tùy chọn, chỉ dành cho development khi bảng members còn trống. Production thêm thành viên qua giao diện quản trị hoặc API hiện có.

## Cấu hình và triển khai

POSTGRES_URL dùng cho runtime. POSTGRES_MIGRATION_URL là kết nối trực tiếp tùy chọn dành cho migration. Kết nối từ xa xác minh chứng chỉ; có thể cấu hình CA riêng qua POSTGRES_CA_FILE.

Production được nhận diện bằng NODE_ENV=production hoặc VERCEL=1. Cần ADMIN_PASSWORD riêng ít nhất 12 ký tự, SESSION_SECRET và CRON_SECRET riêng ít nhất 32 ký tự. Cookie production dùng HTTPS. Không tự đổi secret của môi trường thật khi cập nhật mã.

Vercel dùng server.js, đóng gói migrations/** và có các cron sync Sheets/nhắc lịch trong vercel.json. Migration chạy ở bước vận hành riêng trước rollout, không tự chạy trong build hoặc request. GET /api/health kiểm tra trạng thái khởi tạo database và trả 503 nếu chưa sẵn sàng khi kiểm tra.

Chi tiết: [migration, TLS, secret và rollout](docs/database-operations.md).

## Kiến trúc mã nguồn

- server.js: route HTTP, session, kiểm tra vai trò, tích hợp thông báo và cron.
- src/postgres.js: API tương thích cho các caller hiện có, cùng nghiệp vụ thành viên/vote, dữ liệu cũ và đồng bộ Sheets.
- src/db/client.js: một pool và một ngữ cảnh transaction dùng chung.
- src/db/connection.js: cấu hình kết nối và xác minh TLS.
- src/db/migrations.js, migrations/: lịch sử schema, checksum và chạy migration.
- src/finance/ledger.js: tạo buổi, chia tiền, thanh toán, hoàn tác và xóa buổi.
- src/finance/credits.js, locks.js: tài khoản tiền dư và khóa đồng thời theo người.
- src/finance/reports.js: thu tiền sân ròng theo sự kiện thanh toán/đảo.
- src/finance/values.js: các phép chuyển đổi và chia phần tiền dùng chung.
- src/matchmaking.js, src/tournament*.js: xếp trận và giải đấu.
- src/notification.js, src/sheets.js: push và mirror Google Sheets.
- public/: HTML/CSS/JavaScript; business-time.js dùng chung quy tắc giờ Việt Nam với Node.
- scripts/, tests/: công cụ backup, lệnh DB và kiểm thử bằng Docker riêng.

Các module tài chính không import ngược src/postgres.js. API xuất từ src/postgres.js giữ nguyên để server, giải đấu và thông báo tiếp tục hoạt động. Xem [ranh giới module và transaction](docs/architecture.md).

## Nghiệp vụ tiền hiện tại

Tổng buổi = tiền sân + tiền cầu + phát sinh. Chia đến đồng cho người được chọn, phân bổ phần dư để tổng các phần đúng bằng tổng buổi. Thành viên và khách đều có phần tiền riêng.

Thanh toán dùng tiền dư sẵn có trước, phần còn lại là thu ngoài tiền dư. Mỗi lần trả lưu phân bổ theo phần tiền. Hoàn tác hoặc xóa buổi ghi đối ứng đúng tiền dư đã dùng, giữ lịch sử. Khoản cũ thiếu phân bổ cần đối soát trước khi hoàn tác; không tự suy đoán lịch sử.

KPI “Thu tiền sân ròng” tính theo thời điểm thanh toán/đảo và Asia/Ho_Chi_Minh, không theo ngày chơi. Tiền dư sử dụng/hoàn được báo riêng, không cộng trùng vào thu mới; khoản cũ thiếu nguồn tiền hoặc ngày trả được báo riêng.

- [Thanh toán, hoàn tác và chống gửi trùng](docs/payment-ledger.md)
- [Định nghĩa báo cáo và múi giờ](docs/monthly-report.md)

## API chính

Các route ghi nghiệp vụ dưới đây yêu cầu admin, trừ vote của thành viên và các route đăng nhập/đăng ký công khai. Danh sách tập trung vào luồng chính; server.js là nguồn đầy đủ.

- GET /api/login-options, POST /api/login, POST /api/logout: đăng nhập/đăng xuất hiện có. Luồng xác thực thành viên không được thay đổi trong đợt xử lý nợ này.
- GET /api/bootstrap: dữ liệu khởi tạo theo vai trò.
- POST /api/members, PATCH /api/members/:memberId, DELETE /api/members/:memberId: quản lý thành viên. Người có lịch sử tài chính được khóa hoạt động thay vì xóa.
- GET /api/sessions/votes, POST /api/sessions: danh sách/tạo buổi vote.
- POST /api/sessions/:sessionId/respond và /poll-answer: phản hồi của thành viên; admin có thể thao tác theo quyền route.
- POST /api/sessions/:sessionId/guests: admin thêm khách giao lưu.
- POST /api/sessions/:sessionId/matches, GET /api/matches?date=YYYY-MM-DD: tạo và tải trận.
- GET /api/basic: dữ liệu sổ tiền cho người đã đăng nhập; có monthlyReport khi là admin.
- POST /api/basic/sessions: tạo buổi tiền sân với date, court, courtFee, shuttleFee, extraFee, memberIds, guestNames và voteSessionId tùy chọn.
- PATCH /api/basic/shares/:shareId: đặt paid=true hoặc false.
- PATCH /api/basic/people/paid: tất toán các phần chưa trả của một người.
- DELETE /api/basic/sessions/:id: xóa buổi và xử lý đối ứng.
- GET /api/basic/report?month=YYYY-MM: báo cáo sổ tiền sân cho admin.
- GET /api/credits: admin xem tổng hợp, thành viên xem số dư của mình.
- POST /api/credits: nạp/trừ tiền dư; nhận memberId, amount, direction=add|use, note và requestId tùy chọn.
- GET /api/notices, POST /api/notices: đọc/đăng thông báo.
- /api/tournament/*: đăng ký, hồ sơ, cặp, trận, điểm và bảng giải theo quyền hiện có.

API dữ liệu cũ vẫn còn GET /api/debts và GET /api/reports/monthly?month=YYYY-MM[&format=csv]. Báo cáo này phục vụ bảng dữ liệu cũ, không đại diện sổ basic_sessions/basic_shares hiện tại.

Các route đã tắt trả HTTP 410:
- POST /api/sessions/:sessionId/settle
- POST /api/payments
- POST /api/expenses
- Nhóm /api/birthday-events và các route chọn đồ uống/admin-view trước đây

Không dùng công thức phí theo giới tính/ngưỡng số người của src/calc.js để mô tả sổ tiền sân hiện tại; phần đó thuộc nghiệp vụ cũ.

## Backup và Google Sheets

Postgres là nguồn dữ liệu chính. Google Sheets là mirror một phần cho báo cáo, không chứa đầy đủ sổ tiền sân, tiền dư, lịch sử thanh toán và giải đấu.

    npm run db:backup
    npm run db:restore -- <file.dump>
    npm run db:verify -- <file.dump>

Dùng Postgres client native hoặc POSTGRES_TOOLS_IMAGE theo hướng dẫn. Restore chỉ cho database trống có tên riêng, khác database nguồn. Công cụ đối chiếu SHA-256 archive, cấu trúc cột, số hàng và nội dung bảng. backups/ và các file dump không vào Git.

    npm run db:drill

Drill tạo backup thật từ nguồn đã cấu hình rồi restore vào container riêng; thao tác này khác npm test chỉ dùng dữ liệu giả. Chi tiết: [backup, khôi phục, phạm vi và lưu giữ](docs/postgres-backup.md).

Admin có thể POST /api/admin/sync-sheets hoặc để cron đồng bộ. POST /api/admin/migrate-from-sheets là công cụ dữ liệu cũ có ghi đè nhóm bảng cũ; không dùng làm quy trình khôi phục toàn bộ ứng dụng hiện tại.

## Kiểm thử

Cần Docker đang chạy, có image postgres:17. Runner tự tạo database trong container riêng, dùng dữ liệu giả rồi dọn cả khi test thất bại.

    docker pull postgres:17
    npm test
    npm run test:money
    npm run test:backup

npm test bao gồm cấu hình, TLS, migration, rollback, tiền, báo cáo, timezone, quyền API báo cáo và hành vi gửi lại form. test:money chạy nhóm nghiệp vụ/transaction; test:backup chạy các test công cụ backup không cần kết nối nguồn.

Không truyền database production cho bộ test và không chạy trực tiếp file integration test. Xem [chi tiết kiểm thử](docs/money-tests.md).

    npm run db:prune-sessions

Lệnh dọn phiên hết hạn chạy riêng; không còn xóa phiên ở startup. Lịch backup, kho lưu ngoài máy, retention và lịch dọn phiên phải được cấu hình ở môi trường vận hành.

## Phạm vi và việc còn lại

Sáu bước xử lý nợ đã được triển khai trong mã và có kiểm thử; triển khai production, đối soát dữ liệu cũ và cấu hình backup ngoài máy là công việc vận hành riêng. Xem [BACKLOG](BACKLOG.md) để phân biệt nợ còn mở với tính năng mới như BXH/hồ sơ điểm.

Chưa triển khai bản thay đổi hoặc chạy migration trên production trong đợt này.
