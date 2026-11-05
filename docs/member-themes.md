# Theme lễ hội cho thành viên

## Dùng trên web

Mở tài khoản bằng avatar → Giao diện → chọn chủ đề. Có Mặc định cùng 8 theme:

- Halloween — 31/10: than, cam bí ngô, trắng ngà.
- Phụ nữ Việt Nam — 20/10: hồng trầm, đỏ rượu, hoa.
- Nhà giáo Việt Nam — 20/11: xanh bảng, kem phấn, vàng đồng, sách.
- Ngày của phái mạnh — 06/04: navy, xám sáng, đồng, vợt cầu.
- Giáng sinh — 24–25/12: xanh thông, cranberry, kem, cành thông.
- Tết Nguyên Đán: đỏ son, vàng, giấy ngà, hoa mai và lì xì.
- 30/4–1/5: đỏ, vàng, mặt trời và quốc kỳ.
- Quốc khánh — 02/09: đỏ trầm, vàng champagne, sen và quốc kỳ.

Chế độ Sáng / Tối / Theo thiết bị độc lập với chủ đề. Nút mặt trăng/mặt trời ở đầu trang đổi nhanh sáng/tối và chuyển sang lựa chọn thủ công. Danh sách chủ đề có vùng cuộn trên điện thoại; khi mở lại tài khoản, lựa chọn hiện tại được đưa vào vùng nhìn thấy.

Chủ đề lưu riêng cho trình duyệt, không đồng bộ tài khoản. Chưa tự đổi theo ngày lễ; ngày ghi trên banner là dịp lễ của chủ đề, không phải ngày hiện tại. Tết không gắn năm hoặc lịch âm cố định.

## Cấu trúc

- public/theme.js: catalog duy nhất cho id, tên, bảng màu xem nhanh, lời chúc, ngày lễ và màu thanh trình duyệt. Render bộ chọn từ catalog; khôi phục tùy chọn trước CSS; theo dõi màu thiết bị và storage event giữa tab.
- public/tokens.css: màu mặc định và các token accent, chữ trên nút, thẻ công nợ, focus và overlay.
- public/themes.css: palette sáng/tối riêng cho 8 theme, trạng thái tài chính chung, banner và bộ chọn giao diện.
- public/themes/*-header.svg: 8 họa tiết vector cục bộ, không font/script hay URL ngoài.
- public/app.js: gọi AppTheme.mount() một lần và setView() khi vào thành viên/admin/đăng xuất.

localStorage["theme"] giữ khóa cũ, nhận light / dark / system. Không có giá trị hoặc giá trị không hợp lệ sẽ theo thiết bị. localStorage["member-theme"] nhận default, halloween, womens-day, teachers-day, mens-day, christmas, tet, reunification, national-day. Giá trị lạ về mặc định.

Khi storage bị chặn, vẫn đổi giao diện trong phiên hiện tại; tải lại không thể lưu lựa chọn. Chủ đề và chế độ hiển thị cập nhật giữa các tab cùng trình duyệt.

CSS lễ hội chỉ áp dụng khi html có data-app-view="member" và data-seasonal="true". Các popup nằm ngoài userSection cũng nhận đúng palette của thành viên. Admin và đăng nhập giữ palette mặc định cùng chế độ sáng/tối đã chọn. Trang giải đấu độc lập đọc được giá trị system của khóa chế độ chung; chưa áp dụng theme lễ hội. Manifest và icon cài PWA giữ bộ nhận diện mặc định; meta theme-color của trang chính đổi theo theme/vai trò/chế độ.

## Từ ảnh tham chiếu sang giao diện thật

8 ảnh preview đã tạo là tham chiếu màu, họa tiết và phong cách. Code giữ nội dung và nghiệp vụ hiện có; không dùng ảnh mockup làm nền hoặc đưa số liệu trong ảnh vào dữ liệu thật.

Header và thẻ công nợ có token riêng: Nhà giáo dùng nền xanh bảng với các thẻ màu kem; Giáng sinh, 6/4 và 30/4–1/5 có header màu riêng. Bản tối dùng màu nhấn sáng với chữ tối; bản sáng dùng màu nhấn đậm với chữ sáng. Màu xanh thành công, màu đỏ lỗi/công nợ được giữ riêng với màu trang trí. Badge có nhãn chữ, không chỉ dùng màu để phân biệt trạng thái.

## Kiểm chứng

    npm ci
    npm run test:ui

Cần Chrome được cài trên máy. Có thể dùng Edge bằng PLAYWRIGHT_CHANNEL=msedge, hoặc Chromium sau khi cài browser Playwright và đặt PLAYWRIGHT_CHANNEL=chromium.

Bộ test chạy HTML/CSS/JS thật trên HTTP server tĩnh chỉ lắng nghe loopback. API dùng dữ liệu demo giả lập; không khởi động server.js, không đọc .env, không kết nối DB, không gửi push và không gọi dịch vụ ngoài.

Kiểm tra đủ 8 theme × 2 chế độ, lưu lựa chọn/tải lại, sáng/tối theo thiết bị, tùy chọn cũ/không hợp lệ, storage bị chặn, đồng bộ giữa tab, bàn phím, vùng cuộn bộ chọn, phạm vi thành viên/admin/đăng nhập và giảm chuyển động. Kiểm tra QR, vote, thông báo và hồ sơ giải đấu ở các chiều rộng 320/375/390/430/1280px.

Đo tương phản chữ ở nút chính, badge công nợ/đã trả, header, tiêu đề mục và cả hai đầu gradient của thẻ công nợ. Ảnh app thật với dữ liệu demo được xuất vào test-results/<theme-id>-light.png và <theme-id>-dark.png; ảnh bộ chọn được lưu cho Halloween/Quốc khánh. Thư mục test-results được Git bỏ qua.

Đây là kiểm tra Chromium/Chrome ở viewport mô phỏng, chưa phải xác nhận trên thiết bị Safari/iOS thật.

## Thêm theme sau này

Thêm một mục trong catalog của theme.js với id, label, subtitle, banner, caption, colors và chrome [sáng, tối]. Bộ chọn tự render; không phải thêm radio bằng tay.

Khai báo palette có phạm vi html[data-app-view="member"][data-member-theme="<id>"] và phiên bản html.dark. Cấu hình --season-art trỏ tới SVG cục bộ. Khi header hoặc thẻ công nợ có nền khác trang, khai báo token chữ/nền tương ứng, kiểm tra on-accent và cả hai đầu gradient. Giữ màu trạng thái tài chính riêng, bổ sung id/nhãn vào kiểm thử hành vi.

Không cần migration hoặc endpoint mới.

## Ảnh kiểm chứng

Ảnh chụp Chrome từ ứng dụng chạy với API demo giả lập, không phải dữ liệu production. Mỗi chủ đề có ảnh sáng và tối:

- Halloween: [sáng](theme-previews/halloween-light.png) · [tối](theme-previews/halloween-dark.png).
- 20/10: [sáng](theme-previews/womens-day-light.png) · [tối](theme-previews/womens-day-dark.png).
- 20/11: [sáng](theme-previews/teachers-day-light.png) · [tối](theme-previews/teachers-day-dark.png).
- 6/4: [sáng](theme-previews/mens-day-light.png) · [tối](theme-previews/mens-day-dark.png).
- Giáng sinh: [sáng](theme-previews/christmas-light.png) · [tối](theme-previews/christmas-dark.png).
- Tết: [sáng](theme-previews/tet-light.png) · [tối](theme-previews/tet-dark.png).
- 30/4–1/5: [sáng](theme-previews/reunification-light.png) · [tối](theme-previews/reunification-dark.png).
- Quốc khánh: [sáng](theme-previews/national-day-light.png) · [tối](theme-previews/national-day-dark.png).

[Bộ chọn đủ theme](theme-previews/theme-picker-dark.png).
