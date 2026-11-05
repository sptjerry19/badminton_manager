# Sao lưu và kiểm chứng khôi phục Postgres

Google Sheets là bản mirror phục vụ báo cáo, không phải backup đầy đủ. Cron hiện có chỉ đồng bộ một phần dữ liệu; không dùng thao tác migrate-from-sheets làm quy trình disaster recovery.

## Phạm vi

Dùng pg_dump định dạng custom cho toàn bộ database: schema, bảng, dữ liệu, sequence, index, constraint, view và function; không chọn riêng danh sách bảng nên bao gồm sổ tiền sân, tiền dư và giải đấu. Khi restore sang môi trường thử, bỏ owner và quyền gốc để tài khoản đích sở hữu đối tượng. Role, mật khẩu, cấu hình máy chủ, file ngoài DB và biến môi trường không nằm trong backup database; lưu riêng trong hệ thống quản lý bí mật.

Công cụ tạo file .dump và .dump.json đi kèm: SHA-256 archive, phiên bản server, số hàng, cấu trúc cột và hai tổng hash nội dung từng bảng. Các số liệu và pg_dump dùng cùng snapshot, timezone UTC và định dạng ngày ISO. Tổng hash dùng để phát hiện khác biệt dữ liệu, không thay thế chữ ký số hoặc kiểm toán bảo mật. Manifest có số liệu nhạy cảm; bảo vệ như archive.

## Điều kiện chạy

- Node >=22 và dependency dự án đã được cài.
- pg_dump/pg_restore cùng major với server nguồn hoặc client mới hơn có hỗ trợ server đó; môi trường restore nên cùng major với nguồn.
- Dùng URL trực tiếp tới Postgres (không qua transaction pooler) để chia sẻ exported snapshot.
- Client native: thêm bin Postgres vào PATH hoặc đặt PG_BIN_DIR.
- Hoặc Docker đang chạy: đặt POSTGRES_TOOLS_IMAGE=postgres:18 (đổi major phù hợp). Khi dùng Docker, localhost được chuyển thành host.docker.internal; kết nối dùng file chứng chỉ local yêu cầu native client.
- Database lớn cần đánh giá thời gian đọc toàn bộ bảng, dung lượng đĩa và tải DB. Không chạy ứng dụng trên database thử trong lúc đối chiếu.

## Tạo backup

Cấu hình POSTGRES_BACKUP_URL trong môi trường chạy, hoặc công cụ dùng POSTGRES_URL hiện có. Không đưa URL/password vào tham số lệnh.

    npm run db:backup
    npm run db:backup -- D:/secure-backups/badminton

Mặc định lưu tại backups/ (đã gitignore). Chỉ dùng backup khi lệnh thoát 0 và có cả hai file. Kiểm tra SHA không chứng minh khôi phục thành công: phải thực hiện bước dưới. Không chạy server.js để tạo backup vì ứng dụng có thể tự sửa schema/seed.

## Khôi phục kiểm thử

Tạo sẵn database PostgreSQL trống, ví dụ badminton_restore_weekly. Tài khoản đích chỉ có quyền trên DB kiểm thử. Đặt POSTGRES_RESTORE_URL trỏ vào database đó qua môi trường bí mật hoặc .env local.

    npm run db:restore -- D:/secure-backups/badminton/<file>.dump
    npm run db:verify -- D:/secure-backups/badminton/<file>.dump

Restore chỉ chấp nhận tên badminton_restore_<tên>, khác tên DB nguồn và DB ứng dụng cấu hình hiện tại. Đích phải trống; không có --clean, DROP hay ghi đè. Restore chạy trong một transaction và tự đối chiếu cấu trúc cột, số hàng và hash của toàn bộ bảng với manifest. Mọi sai lệch trả exit 1; không được xem là khôi phục thành công. Verify chỉ đọc dữ liệu, ngoại trừ advisory lock tạm trong phiên. Không khởi động app trên đích trước khi verify vì startup có thể seed hoặc sửa schema.

Để thử lại sau một lần restore thành công, tạo DB trống khác; công cụ không tự xóa DB đã có dữ liệu. Chỉ khôi phục archive tin cậy vì pg_restore thực thi SQL có trong archive.

Lưu JSON thành công của lệnh restore/verify vào hệ thống log vận hành (không ghi URL/password); kiểm tra đặc biệt các bảng members, basic_sessions, basic_shares, member_credits, generated_matches và tournament_* nếu tồn tại.

## Lịch vận hành đề xuất

- Backup hằng ngày từ runner có Postgres client, không dùng Vercel request/cron để chạy tiến trình dump dài.
- Lưu bản sao mã hóa ở nơi khác máy chủ/database gốc, giới hạn người đọc và áp dụng chính sách lưu giữ đã thống nhất. Thư mục local chưa phải bản sao ngoài hệ thống.
- Thử restore vào DB riêng định kỳ và sau thay đổi schema quan trọng; chỉ công nhận đạt khi đối chiếu thành công.
- Bước triển khai này cung cấp công cụ và quy trình; lịch tự động, kho lưu ngoài hệ thống và retention cần cấu hình theo hạ tầng thực tế.

Tài liệu: https://www.postgresql.org/docs/current/app-pgdump.html và https://www.postgresql.org/docs/current/app-pgrestore.html

## Kiểm chứng tự động bằng Docker local

    $env:POSTGRES_TOOLS_IMAGE = "postgres:17"
    npm run db:drill

Đặt POSTGRES_TOOLS_IMAGE=postgres:17 khi nguồn là Postgres 17. Lệnh đọc database nguồn, tạo backup thật, khởi tạo container Postgres tạm chỉ mở cổng loopback, restore và verify, kiểm tra từ chối restore lần hai lên đích đã có dữ liệu. Container tự dừng và dữ liệu thử trong tmpfs bị hủy; archive, manifest và báo cáo .verification.json được giữ trong backups/. Không cần cấu hình POSTGRES_RESTORE_URL khi chạy drill.

Neon: công cụ tự chuyển endpoint -pooler sang endpoint trực tiếp theo [quy tắc hostname của Neon](https://github.com/neondatabase/website/blob/main/content/faqs/find-connection-details-neon-console.md), giữ nguyên database và credentials. Với pooler khác, đặt POSTGRES_BACKUP_URL trực tiếp. Không đổi POSTGRES_URL của ứng dụng.
