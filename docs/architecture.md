# Ranh giới module sau bước 6

## Kết nối và transaction

src/db/client.js tạo duy nhất một pool và một AsyncLocalStorage. query() chọn client đang thuộc transaction hiện tại; withTransaction() tạo transaction ngoài cùng, các lời gọi lồng nhau tái sử dụng nó. Mọi module tài chính import trực tiếp lớp này.

src/postgres.js giữ API xuất tương thích cho server.js, tournament.js và notification.js. Các hàm tiền được import và xuất lại, không tạo pool thứ hai. Module tài chính không import ngược facade nên không có vòng phụ thuộc.

Một số hàm vẫn quản lý client/transaction trực tiếp, gồm tạo buổi tiền sân và các luồng dữ liệu cũ. Đợt tách module không đổi cách commit/rollback của chúng. Không giả định rằng một hàm dùng pool.connect() riêng sẽ tự tham gia withTransaction() bên ngoài.

## Tài chính

- values.js: chuyển đổi số, chuẩn hóa tên, thời điểm ISO, tháng hợp lệ và chia phần tiền.
- locks.js: khóa transaction theo thành viên/tên khách. Khóa nhiều người theo thứ tự cố định.
- credits.js: nạp/trừ, chống gửi trùng, số dư và tổng hợp tài khoản.
- ledger.js: buổi tiền sân, phần chia, phân bổ thanh toán, hoàn tác, xóa buổi và giữ lịch sử.
- reports.js: tổng hợp sự kiện thu/đảo và dữ liệu cũ chưa đủ thông tin theo tháng Việt Nam.

Quan hệ phụ thuộc: ledger dùng credits/locks/values và db/client; credits dùng locks/values và db/client; reports dùng values/business-time và db/client. Lịch sử thanh toán là nguồn đối chiếu; không suy đoán từ trạng thái paid hiện tại để viết lại các sự kiện.

## Phần giữ trong facade

Thành viên, vote, dữ liệu công nợ cũ, snapshot Sheets, nhắc lịch và thông báo vẫn ở src/postgres.js. Luồng giải đấu giữ cấu trúc hiện có. Có thể tách tiếp theo miền khi có thay đổi cần thiết và test bảo vệ; không xem file này là đã hoàn toàn nhỏ hóa.

Không sửa migration đã có checksum khi chỉ tách module. Không đổi route HTTP, hình dạng response hoặc thêm dependency npm trong bước này.

## Kiểm chứng ranh giới

Giữ các test tiền/báo cáo/migration trước đó. Thêm test gọi transaction từ facade, thực hiện nạp/trả/đọc báo cáo qua các module rồi cố ý lỗi: không được commit một phần hoặc đọc lệch ngữ cảnh. Kiểm tra cả trường hợp commit thành công và liên kết vote của buổi tiền sân.

Tài liệu nghiệp vụ: [thanh toán](payment-ledger.md), [báo cáo](monthly-report.md), [vận hành DB](database-operations.md).
