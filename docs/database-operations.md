# Migration và cấu hình vận hành

## Luồng chuẩn bị

    npm run config:check
    npm run db:status
    npm run db:migrate
    npm run db:status
    npm start

Chạy migration từ máy/runner được cấp quyền thay đổi schema, trước khi khởi động bản ứng dụng mới. Không tự migrate trong request, cold start hoặc build Vercel. db:status trả exit 1 nếu còn migration chưa áp dụng hoặc lịch sử không khớp; trạng thái pending trước lần migrate đầu tiên là bình thường.

Startup chỉ đọc schema_migrations và kiểm checksum. Database thiếu migration sẽ không sẵn sàng; /api/health trả 503. Startup không tạo bảng, thêm thành viên mẫu, thay đổi cấu hình hoặc dọn dữ liệu. Runtime có thể dùng tài khoản không có quyền DDL, nhưng vẫn cần quyền SELECT/INSERT/UPDATE/DELETE và sequence cho nghiệp vụ ứng dụng.

## Phiên bản và nâng cấp

- 0001: schema cũ, các cột bổ sung và ràng buộc khóa ngoại. Có thể áp dụng lên database cũ mà không xóa bảng/dữ liệu.
- 0002: phân bổ thanh toán, giao dịch hoàn và mã chống gửi trùng của bước 3.
- 0003: giá trị mặc định cho settings và nội dung giải đấu bắt buộc; ON CONFLICT DO NOTHING giữ cấu hình đã chỉnh. Không tạo tài khoản/thành viên mẫu.

- 0004: lưu ngồi chờ theo vòng, giữ tính năng đã có trên main mà không đưa DDL trở lại startup.

schema_migrations lưu tên file, SHA-256 và ngày áp dụng. Checksum chuẩn hóa CRLF/LF để không báo sai khi checkout trên Windows. Không sửa/xóa file đã được áp dụng; thêm file phiên bản lớn hơn. Các file SQL phải được đóng gói cùng backend; vercel.json đưa migrations/** vào function bundle.

Mỗi đợt migration dùng một transaction và advisory lock để ngăn hai tiến trình chạy chồng. Nếu một câu lệnh lỗi, cả đợt và bản ghi phiên bản rollback. Không nuốt lỗi ALTER TABLE. Ràng buộc trên dữ liệu cũ được kiểm tra; nếu có hàng mồ côi, migration từ chối và giữ nguyên dữ liệu để đối soát, không tự xóa/sửa. Thời gian chờ khóa 15 giây, timeout mỗi statement 120 giây.

## Kết nối và TLS

POSTGRES_URL là kết nối runtime. POSTGRES_MIGRATION_URL tùy chọn dùng tài khoản/endpoint trực tiếp riêng; nếu không đặt, dùng POSTGRES_URL. Neon tự chuyển hostname -pooler sang endpoint trực tiếp cho lệnh DB, không sửa cấu hình runtime. Pooler khác cần URL trực tiếp rõ ràng.

Host từ xa dùng TLS với rejectUnauthorized=true. Các chế độ URL require/prefer/verify-ca được nâng thành xác minh đầy đủ; sslmode=disable/no-verify trên host từ xa bị từ chối. Chỉ loopback chính xác (localhost, 127.0.0.1, ::1) mới có thể không dùng TLS. Nếu nhà cung cấp có CA riêng, dùng POSTGRES_CA_FILE hoặc sslrootcert; không khắc phục lỗi chứng chỉ bằng cách tắt xác minh.

Tham số SSL được rút khỏi URL trước khi chuyển cho pg để không ghi đè object ssl. Tham khảo [node-postgres SSL](https://node-postgres.com/features/ssl).

## Cấu hình production

Production khi NODE_ENV=production hoặc VERCEL=1. Cần:
- ADMIN_PASSWORD riêng, ít nhất 12 ký tự.
- SESSION_SECRET riêng, ít nhất 32 ký tự, không dùng giá trị mẫu.
- CRON_SECRET riêng, ít nhất 32 ký tự cho các cron đã khai báo.
- POSTGRES_URL hợp lệ; PORT hợp lệ nếu đặt.
- Không đặt NODE_TLS_REJECT_UNAUTHORIZED=0.

Không thay đổi cơ chế đăng nhập hoặc tự đổi mật khẩu/secret đang dùng. Giá trị mặc định yếu chỉ còn trong development để giữ tương thích local. config:check kiểm tra cấu hình mà không kết nối DB và không in secret. Biến môi trường thực tế hoặc credentials trên Vercel chưa được chỉnh trong bước này.

Cookie session dùng secure trong production (bao gồm host ngoài Vercel); triển khai HTTPS qua reverse proxy phù hợp trust proxy hiện tại.

## Dữ liệu mẫu và dọn phiên

    npm run db:seed-demo -- --confirm-demo
    npm run db:prune-sessions

Seed demo chỉ dành cho dev, khi bảng members trống, trong transaction; bị chặn ở production và không thêm vào danh sách đã có người. Cấu hình nghiệp vụ mặc định đã có trong migration, không cần seed demo để chạy production.

Dọn phiên hết hạn chạy bằng lệnh riêng, nên đặt trong lịch vận hành hằng ngày; không còn xóa phiên ở startup. Đây là DELETE trên phiên đã hết hạn, không tác động phiên còn hiệu lực.

## Trình tự triển khai thực tế

1. Tạo backup và kiểm chứng restore bằng công cụ bước 1.
2. Thử db:migrate và config:check trên DB restore riêng; đối chiếu dữ liệu quan trọng.
3. Cập nhật biến môi trường production và quyền runtime/migration.
4. Tạm ngừng traffic ghi khi rollout thay đổi tài chính, chạy migration một lần, triển khai đồng bộ backend mới.
5. Kiểm tra db:status, /api/health và smoke test nghiệp vụ. Không chạy lẫn backend cũ chưa lấy khóa tiền với bản mới.

Không có down migration tự động cho các bảng tài chính. Khi cần rollback, đánh giá khả năng tương thích schema hoặc dùng backup vào database riêng rồi chuyển kết nối sau đối soát; không drop bảng lịch sử để quay về mã cũ.

## Kiểm chứng

npm test tạo Postgres Docker riêng và chạy kiểm tra migration cùng các test tiền/báo cáo trước đó. Có test database mới, nâng cấp dữ liệu cũ, migration đồng thời, rollback DDL, checksum sai, dữ liệu mồ côi, seed demo và cấu hình/TLS. Chưa chạy migration hoặc thay đổi cấu hình trên production.
