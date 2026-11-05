# Báo cáo thu tiền và ngày nghiệp vụ

Ngày và tháng nghiệp vụ thống nhất Asia/Ho_Chi_Minh trên backend và trình duyệt, không phụ thuộc múi giờ máy người dùng. Thời điểm sự kiện vẫn lưu TIMESTAMPTZ/ISO UTC; chỉ đổi múi giờ khi chọn ngày/tháng nghiệp vụ và hiển thị.

## Sổ tiền sân

KPI “Thu tiền sân ròng” dùng báo cáo từ backend, không cộng các phần paid theo ngày chơi:
- cashReceived: phần phải trả trừ tiền dư đã dùng, theo tháng settled_at.
- cashReversed: khoản thu ngoài tiền dư được đảo, theo tháng reversed_at.
- netCashReceived = cashReceived - cashReversed.
- creditUsed và creditRestored: tiền dư sử dụng/hoàn, hiển thị riêng; không cộng vào tiền thu mới.
- Khoản nạp trước chỉ tăng tài khoản tiền dư; không được tính thêm vào tiền sân đã thu.
- Đảo thanh toán là ghi nhận điều chỉnh sổ, không chứng minh có chuyển khoản hoàn tiền ngoài hệ thống.

Báo cáo dựa trên lịch sử thanh toán nên xóa buổi không xóa số thu gốc. Đảo ở tháng sau ghi giảm tháng sau; không viết lại tháng trước. Thu ròng có thể âm nếu tháng đó chủ yếu đảo khoản của tháng trước.

Khoản cũ đã trả có paid_at nhưng thiếu lịch sử phân bổ được báo riêng legacyPaidCount/legacyPaidAmount trong tháng paid_at. Không mặc định chúng là tiền thu mới. Khoản cũ thiếu cả paid_at được đếm riêng trên toàn bộ dữ liệu; không gán về tháng chơi hoặc ngày nâng cấp.

API admin: GET /api/basic/report?month=YYYY-MM. Bỏ month để lấy tháng hiện tại theo giờ Việt Nam. GET /api/basic trả monthlyReport cho admin để hiển thị KPI; không trả tổng báo cáo cho user. API báo cáo tháng dữ liệu cũ trong Công cụ giữ phạm vi riêng.

Sau khi đổi trạng thái thanh toán, sổ được tải lại từ backend để cả tiền dư và KPI cập nhật cùng lượt, thay vì chỉ cập nhật nhãn paid ở client.

## Ngày và giờ

public/business-time.js dùng chung trên Node/browser. Áp dụng cho ngày mặc định, chọn trận hôm nay, nhắc lịch, lọc lịch sắp tới và tháng báo cáo. Không cắt ngày từ toISOString cho ngày nghiệp vụ. So sánh lịch buổi (date/time lưu theo giờ Việt Nam) với dateTimeKey Việt Nam.

Tháng đầu vào phải hợp lệ từ 01 đến 12. Báo cáo dùng khoảng [00:00 ngày đầu tháng, 00:00 ngày đầu tháng sau) theo giờ Việt Nam, xử lý đúng ranh giới ngày, tháng, năm và tháng nhuận.

Không tự backfill lịch sử hoặc sửa dữ liệu production. Kiểm chứng bằng npm test trên database Docker riêng.

## Kiểm chứng bước 4 — 2026-11-05

npm test: 57/57 đạt trên Postgres Docker riêng, 0 skip/TODO. Bao gồm các test tiền trước đó, ranh giới tháng Việt Nam, tháng nhuận, trả tiền cho buổi tháng trước, đảo ở tháng sau, dữ liệu cũ thiếu thời điểm/phân bổ, timezone máy chạy, KPI và phân quyền API báo cáo. Container test đã được dọn. Chưa triển khai hoặc thay đổi dữ liệu production.
