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

Chế độ Sáng / Tối / Theo thiết bị độc lập với chủ đề. Nút mặt trăng/mặt trời ở đầu trang đổi nhanh sáng/tối sang lựa chọn thủ công; không tắt chế độ tự động theo lịch lễ hội. Danh sách chủ đề có vùng cuộn trên điện thoại; khi mở lại tài khoản, lựa chọn hiện tại được đưa vào vùng nhìn thấy.

Chọn **Tự động theo lịch** để áp dụng lịch chung của nhóm theo giờ Việt Nam. Người mới chưa lưu lựa chọn sẽ dùng chế độ này. Lựa chọn thủ công đã lưu vẫn được giữ và ưu tiên hơn lịch; chọn lại Tự động để quay về lịch chung. Sáng/tối vẫn độc lập với lịch lễ hội.

Chủ đề lưu riêng cho trình duyệt, không đồng bộ tài khoản. Ngày trên banner là dịp lễ của chủ đề, không phải ngày hiện tại. Tết được admin đặt khoảng ngày dương cụ thể theo từng năm; ứng dụng không tự quy đổi âm lịch.

## Cấu trúc

- public/theme-calendar.js: bộ xử lý khoảng ngày dùng chung giữa Node và browser, múi giờ Asia/Ho_Chi_Minh.
- src/theme-config.js: endpoint chỉ trả lịch đã kiểm tra và giờ server; không trả toàn bộ env.
- public/theme.js: catalog duy nhất cho id, tên, bảng màu xem nhanh, lời chúc, ngày lễ và màu thanh trình duyệt. Render bộ chọn từ catalog; khôi phục tùy chọn trước CSS; theo dõi màu thiết bị và storage event giữa tab.
- public/tokens.css: màu mặc định và các token accent, chữ trên nút, thẻ công nợ, focus và overlay.
- public/themes.css: palette sáng/tối riêng cho 8 theme, trạng thái tài chính chung, banner và bộ chọn giao diện.
- public/themes/*-header.svg: 8 họa tiết vector cục bộ, không font/script hay URL ngoài.
- public/app.js: gọi AppTheme.mount() một lần và setView() khi vào thành viên/admin/đăng xuất.

localStorage["theme"] giữ khóa cũ, nhận light / dark / system. Không có giá trị hoặc giá trị không hợp lệ sẽ theo thiết bị. localStorage["member-theme"] nhận auto, default, halloween, womens-day, teachers-day, mens-day, christmas, tet, reunification, national-day. Giá trị lạ quay về auto. Nếu không có lịch đang hiệu lực, auto dùng theme mặc định.

Khi storage bị chặn, vẫn đổi giao diện trong phiên hiện tại; tải lại không thể lưu lựa chọn. Chủ đề và chế độ hiển thị cập nhật giữa các tab cùng trình duyệt.

CSS lễ hội chỉ áp dụng khi html có data-app-view="member" và data-seasonal="true". Các popup nằm ngoài userSection cũng nhận đúng palette của thành viên. Admin và đăng nhập giữ palette mặc định cùng chế độ sáng/tối đã chọn. Trang giải đấu độc lập đọc được giá trị system của khóa chế độ chung; chưa áp dụng theme lễ hội. Manifest và icon cài PWA giữ bộ nhận diện mặc định; meta theme-color của trang chính đổi theo theme/vai trò/chế độ.

## Admin cấu hình lịch trong env

Toàn bộ mốc ngày nằm trong biến môi trường, không có lịch mặc định giấu trong JavaScript. Điền các biến sau trong .env khi chạy local, hoặc trong Environment Variables của môi trường deploy:

~~~dotenv
THEME_HALLOWEEN_START=10-24
THEME_HALLOWEEN_END=11-10
THEME_WOMENS_DAY_START=10-15
THEME_WOMENS_DAY_END=10-24
THEME_TEACHERS_DAY_START=11-10
THEME_TEACHERS_DAY_END=12-01
THEME_MENS_DAY_START=04-01
THEME_MENS_DAY_END=04-10
THEME_CHRISTMAS_START=12-15
THEME_CHRISTMAS_END=01-02
THEME_TET_START=2027-01-25
THEME_TET_END=2027-02-20
THEME_REUNIFICATION_START=04-24
THEME_REUNIFICATION_END=05-05
THEME_NATIONAL_DAY_START=08-26
THEME_NATIONAL_DAY_END=09-06
~~~

- MM-DD lặp lại hằng năm. START bao gồm ngày đó; END không bao gồm ngày đó.
- Ví dụ Halloween chạy từ 00:00 ngày 24/10 đến trước 00:00 ngày 10/11; ngay ngày 10/11 chuyển sang Nhà giáo, đến hết 30/11.
- END nhỏ hơn START ở dạng MM-DD là lịch qua năm; ví dụ Noel 15/12 đến hết 01/01.
- YYYY-MM-DD là một khoảng ngày cụ thể, không lặp sang năm khác. Hai mốc phải cùng định dạng; END của lịch ngày đầy đủ phải sau START.
- Khoảng Tết trong ví dụ chỉ là thời gian mở theme minh họa. Admin chỉnh hai ngày dương theo lịch Tết của từng năm, không cần đổi code.
- Để trống cả START/END sẽ tắt theme đó trong chế độ tự động. Nếu chưa cấu hình biến nào, auto dùng Mặc định. Các theme vẫn chọn thủ công được.
- Khi chồng lịch, khoảng có ngày START thực tế gần nhất được ưu tiên. Nếu trùng START, ưu tiên lịch YYYY-MM-DD; nếu vẫn trùng, thứ tự cố định là Halloween, 20/10, 20/11, 6/4, Noel, Tết, 30/4–1/5, 2/9.
- Mốc 02-29 chỉ hoạt động trong năm có đủ cả hai ngày bắt đầu/kết thúc; không tự dời sang ngày khác.
- Điền thiếu một mốc hoặc ngày không tồn tại: bỏ riêng lịch sai, ghi cảnh báo tên biến vào log; các lịch hợp lệ và chọn thủ công vẫn hoạt động.

Sau khi đổi env, chạy **npm run theme:check** trong đúng môi trường, rồi restart server hoặc redeploy (với Vercel). Bộ kiểm tra trả exit code 1 nếu có cấu hình sai và không in secret. Không có form chỉnh env ngay trong trang admin.

Trang web lấy lịch và giờ server trước khi mở giao diện thành viên, tránh chọn sai theme do timezone hoặc đồng hồ thiết bị. Khi giữ trang mở, tự cập nhật tại nửa đêm Việt Nam, đọc lại lịch mỗi 5 phút khi tab đang hiển thị, và kiểm tra lại khi quay về tab. Sửa env cần restart/redeploy trước khi lịch mới có hiệu lực.

Endpoint đặt Cache-Control: no-store và chỉ xuất version, múi giờ, giờ server, cờ hợp lệ cùng id/start/end của lịch; không xuất mật khẩu, DB URL hoặc secret khác. Nếu tải lịch lỗi hoặc quá 3 giây: dùng lịch hợp lệ đã tải trong phiên; nếu chưa có, dùng Mặc định và cho phép chọn thủ công. Không lưu lịch server vào localStorage để tránh dùng cấu hình cũ sau lần mở mới.

## Từ ảnh tham chiếu sang giao diện thật

8 ảnh preview đã tạo là tham chiếu màu, họa tiết và phong cách. Code giữ nội dung và nghiệp vụ hiện có; không dùng ảnh mockup làm nền hoặc đưa số liệu trong ảnh vào dữ liệu thật.

Header và thẻ công nợ có token riêng: Nhà giáo dùng nền xanh bảng với các thẻ màu kem; Giáng sinh, 6/4 và 30/4–1/5 có header màu riêng. Bản tối dùng màu nhấn sáng với chữ tối; bản sáng dùng màu nhấn đậm với chữ sáng. Màu xanh thành công, màu đỏ lỗi/công nợ được giữ riêng với màu trang trí. Badge có nhãn chữ, không chỉ dùng màu để phân biệt trạng thái.

## Kiểm chứng

    npm ci
    npm run test:theme
    npm run test:ui

Cần Chrome được cài trên máy. Có thể dùng Edge bằng PLAYWRIGHT_CHANNEL=msedge, hoặc Chromium sau khi cài browser Playwright và đặt PLAYWRIGHT_CHANNEL=chromium.

Bộ test chạy HTML/CSS/JS thật trên HTTP server tĩnh chỉ lắng nghe loopback. API dùng dữ liệu demo giả lập; không khởi động server.js, không đọc .env, không kết nối DB, không gửi push và không gọi dịch vụ ngoài.

Kiểm tra engine lịch, env và endpoint bằng Node; mô phỏng nửa đêm Việt Nam, timezone/đồng hồ thiết bị khác, lịch qua năm, cấu hình hỏng, timeout và cập nhật lịch. Kiểm tra đủ 8 theme × 2 chế độ, lưu lựa chọn/tải lại, sáng/tối theo thiết bị, tùy chọn cũ/không hợp lệ, storage bị chặn, đồng bộ giữa tab, bàn phím, vùng cuộn bộ chọn, phạm vi thành viên/admin/đăng nhập và giảm chuyển động. Kiểm tra QR, vote, thông báo và hồ sơ giải đấu ở các chiều rộng 320/375/390/430/1280px.

Đo tương phản chữ ở nút chính, badge công nợ/đã trả, header, tiêu đề mục và cả hai đầu gradient của thẻ công nợ. Ảnh app thật với dữ liệu demo được xuất vào test-results/<theme-id>-light.png và <theme-id>-dark.png; ảnh bộ chọn được lưu cho Halloween/Quốc khánh. Thư mục test-results được Git bỏ qua.

Đây là kiểm tra Chromium/Chrome ở viewport mô phỏng, chưa phải xác nhận trên thiết bị Safari/iOS thật.

## Thêm theme sau này

Thêm một mục trong catalog của theme.js với id, label, subtitle, banner, caption, colors và chrome [sáng, tối]. Bộ chọn tự render; không phải thêm radio bằng tay. Nếu theme mới tham gia lịch tự động, thêm id/env prefix vào definitions của theme-calendar.js và bổ sung cặp START/END trong .env.example.

Khai báo palette có phạm vi html[data-app-view="member"][data-member-theme="<id>"] và phiên bản html.dark. Cấu hình --season-art trỏ tới SVG cục bộ. Khi header hoặc thẻ công nợ có nền khác trang, khai báo token chữ/nền tương ứng, kiểm tra on-accent và cả hai đầu gradient. Giữ màu trạng thái tài chính riêng, bổ sung id/nhãn vào kiểm thử hành vi.

Không cần migration. Có thêm GET /api/theme-config để đọc lịch từ env và giờ server, không cần đăng nhập.

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

[Chế độ tự động theo lịch Việt Nam](theme-previews/automatic-vietnam-calendar.png).
