# Kiểm thử luồng tiền

## Chạy test

Yêu cầu Node >=22, dependency đã cài và Docker đang chạy với image postgres:17 (tải bằng docker pull postgres:17 nếu chưa có).

    npm run test:money
    npm test

test:money chạy các test nghiệp vụ tiền. npm test chạy thêm test công cụ backup của bước 1. Không cần URL database, không cần .env.

Runner tạo container và database Postgres 17 mới, chỉ mở cổng loopback; credentials ngẫu nhiên chỉ truyền qua môi trường. Database trong tmpfs được hủy khi container dừng ở cuối lệnh, kể cả test thất bại. Không đọc hay khôi phục dữ liệu production. Không chạy trực tiếp file integration test; file tự từ chối trước khi import tầng DB nếu thiếu URL local có tên và định dạng riêng. Không truyền URL từ ngoài vào runner.

## Phạm vi

Test gọi hàm nghiệp vụ thật trong src/postgres.js và dùng schema do migration tạo; initializeDatabase chỉ kiểm tra phiên bản. Bao phủ:
- Chia tiền không mất phần dư; tổng nhỏ hơn số người; loại người trùng và từ chối đầu vào sai.
- Rollback tạo buổi khi ghi phần tiền lỗi.
- Nạp/trừ tiền dư, từ chối trừ quá số dư.
- Tất toán đủ/thiếu tiền dư, theo nhiều buổi, khách giao lưu, lặp và đồng thời.
- Rollback tất toán nếu ghi trừ tiền thất bại.
- Đánh dấu trả, hoàn tác, xóa buổi và đối ứng tiền dư.

Hai test cạnh tranh dùng trigger và advisory lock trong DB kiểm thử để dừng các khoản trừ trước INSERT. Chỉ mở cổng khi cả hai tác vụ đang chờ khóa PostgreSQL, nên không cần giả lập query hoặc dựa vào độ trễ ngẫu nhiên. Trigger này chỉ tồn tại trong database kiểm thử; không sửa schema ứng dụng.

## Lỗi còn mở ở bước 2

Ở bước 2, các test DEBT đã tái hiện 5 lỗi bằng assertion cho hành vi đúng. Bước 3 đã sửa các lỗi này, giữ nguyên kỳ vọng test. npm test trả exit 1 nếu lỗi tái xuất hiện; không skip, không TODO và không đảo assertion để coi lỗi là đạt.

- DEBT-01: hai yêu cầu trừ thủ công có thể cùng đọc số dư cũ.
- DEBT-02: tất toán và trừ thủ công có thể sử dụng trùng tiền dư.
- DEBT-03: mở lại phần tiền chưa hoàn khoản tiền dư đã dùng.
- DEBT-04: xóa buổi chưa hoàn khoản tiền dư liên quan.
- DEBT-05: đánh dấu đã trả lặp ghi đè ngày thanh toán.

Khi sửa bước 3, giữ nguyên kỳ vọng nghiệp vụ của các test này. Cơ chế khóa, ghi đối ứng và liên kết giao dịch có thể thay đổi; chỉ sửa harness nếu cách điều phối không còn phù hợp. Không xóa test để đưa kết quả về xanh.

Không bao phủ xác thực HTTP, UI, báo cáo tháng hay dữ liệu lịch sử production trong đợt này.

## Kết quả kiểm chứng ngày 2026-11-05

Đã chạy npm test trên container Postgres 17 mới với dữ liệu giả: 26 test, 21 đạt, 5 thất bại (DEBT-01 đến DEBT-05), 0 skip và 0 TODO. Trong đó có 6 test backup và 20 test luồng tiền. Exit code 1 phản ánh các lỗi nghiệp vụ còn mở, không phải lỗi khởi tạo database. Container kiểm thử đã dừng và dữ liệu thử đã được dọn. Chưa thay đổi mã nghiệp vụ hoặc dữ liệu production trong bước 2.
