# Thanh toán và hoàn tác tiền sân

## Quy tắc từ bước 3

Tất toán một người hoặc đánh dấu một phần là đã trả đều dùng tiền dư sẵn có, tối đa bằng phần tiền phải trả. Chia việc sử dụng tiền dư theo thứ tự ID phần tiền (thứ tự tạo), ghi riêng cho từng phần. Phần còn lại được coi là khoản thu ngoài tiền dư.

Mỗi lần trả được lưu trong basic_share_settlements: số tiền phải trả, tiền dư đã dùng, ID giao dịch trừ và thời điểm. Khi hoàn tác hoặc xóa buổi, hệ thống ghi giao dịch hoàn dương cho đúng số tiền đã dùng và đánh dấu lịch sử đã đảo. Không sửa hoặc xóa khoản trừ gốc. Lịch sử vẫn còn sau khi xóa buổi.

Mọi thao tác nạp, trừ, tất toán, hoàn tác và xóa buổi chạy trong transaction, dùng chung advisory lock theo thành viên (khách theo tên chuẩn hóa). Khi xóa buổi nhiều người, khóa theo thứ tự cố định. Lỗi ở bất kỳ phần nào rollback cả trạng thái, số dư và lịch sử.

Đánh dấu cùng trạng thái lặp lại không tạo giao dịch mới, không ghi đè ngày trả. Hoàn tác lặp không hoàn tiền hai lần. Tất toán lại người không còn khoản chưa trả vẫn trả lỗi như API cũ, không trừ thêm tiền. API nạp/trừ nhận requestId tùy chọn: cùng thành viên, mã và nội dung chỉ ghi một lần; tái dùng mã với nội dung khác bị từ chối. Form giữ cùng mã khi gửi lại sau lỗi mạng và chặn submit đồng thời. Sau khi nhận thành công, thao tác tiếp theo dùng mã mới. Client cũ không gửi mã vẫn coi mỗi request là giao dịch riêng; reload trang sẽ mất mã đang chờ trong form.

## Dữ liệu trước nâng cấp

Không tự gán khoản trừ cũ vào các phần tiền vì dữ liệu cũ không có liên kết để xác định chính xác. Khoản đã trả của thành viên thiếu lịch sử phân bổ sẽ bị từ chối hoàn tác hoặc xóa buổi, kèm thông báo cần đối soát. Việc đánh dấu lại cùng trạng thái giữ nguyên dữ liệu. Khoản khách cũ không có tài khoản tiền dư vẫn có thể mở lại.

Không tự backfill số tiền hoặc thay đổi số dư hiện hữu. Muốn xử lý khoản cũ cần đối chiếu dữ liệu thực tế và xây dựng điều chỉnh có chứng từ; không thêm receipt giả để vượt qua kiểm tra.

Để giữ lịch sử, không cho xóa thành viên đã có phần tiền hoặc giao dịch tiền dư. Có thể khóa thành viên qua trạng thái hoạt động; thành viên chưa có lịch sử vẫn xóa được.

## Schema và triển khai

Schema tài chính nằm trong migration 0002_payment_history.sql từ bước 5. Cần chạy npm run db:migrate trước khi khởi động; startup chỉ kiểm tra phiên bản. Migration thêm lịch sử và request_id nullable, không suy đoán phân bổ hoặc sửa số dư cũ. Xem [quy trình vận hành](database-operations.md).

Cần triển khai đồng bộ các instance backend; tránh chạy lẫn bản cũ (chưa lấy khóa tài chính) với bản mới. Tạo backup trước triển khai, thử trên database restore riêng, rồi kiểm tra npm test. Không chạy app khởi tạo trên database nguồn chỉ để thử migration.

Google Sheets chưa bao gồm bảng lịch sử này. Công cụ backup Postgres toàn database ở bước 1 tự bao gồm bảng mới sau khi app được triển khai.

## Kiểm chứng

Chạy npm test bằng Postgres Docker riêng. Giữ nguyên 5 kỳ vọng DEBT của bước 2; bổ sung kiểm tra phân bổ nhiều buổi, hoàn tác lặp/đồng thời, rollback đối ứng, giữ lịch sử khi xóa, khoản cũ thiếu dữ liệu và khởi tạo schema lặp.

Luồng đăng nhập không thay đổi.
