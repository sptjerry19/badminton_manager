# Backlog: các mục trong bản demo UI/UX chưa làm được

Bản demo tham chiếu: https://boho-tarot-07163411.figma.site/

Giao diện đã được làm lại theo demo (token màu, font Be Vietnam Pro, dark mode, khung mobile cho thành viên, sidebar và tab cho admin, bottom sheet, toast). Các mục dưới đây **cần thêm backend hoặc dữ liệu** nên mới làm phần khung, hoặc chưa làm.

Ký hiệu: 🔴 cần backend mới · 🟡 cần mở rộng API hoặc DB · 🟢 chỉ cần frontend

---

## 1. Bảng xếp hạng thành viên (BXH theo điểm) 🔴

**Hiện trạng:** tab BXH (cả user và admin) mới hiển thị màn "Đang phát triển" kèm card luật tính điểm. Thẻ "Hạng của bạn" ở Trang chủ đang hiện "Sắp ra mắt".

**Cần làm:**
- [ ] Bảng `match_results` (match_id, session_id/match_date, round, court, team_a[], team_b[], winner, score_a, score_b, created_by, created_at).
- [ ] Bảng hoặc view `member_points` (member_id, match_id, delta, reason: cùng level / gặp đội mạnh hơn / gặp đội yếu hơn).
- [ ] Luật điểm, so theo **tổng level 2 người** của mỗi đội:
  - Thắng: mạnh hơn +20 · cùng level +10 · yếu hơn +5
  - Thua: yếu hơn −20 · cùng level −10 · mạnh hơn −5
  - Chốt lại: "cùng level" là bằng tuyệt đối hay chênh ±1? Khách giao lưu (GL) không có trên BXH, nhưng trận có GL vẫn tính điểm cho thành viên?
- [ ] API: `GET /api/rankings?period=month|quarter|year|all`, `GET /api/rankings/:memberId` (hồ sơ điểm).
- [ ] UI BXH: filter chip theo kỳ, podium top 3 (vàng/bạc/đồng), danh sách hạng có ▲▼ thay đổi hạng, dòng "BẠN" được highlight. CSS mẫu có trong demo: `.podium`, `.ranking-row`, `.move`.
- [ ] Thẻ "Hạng của bạn #N · X điểm ▲k" ở Trang chủ.

## 2. Nhập kết quả trận (Admin, phần Xếp trận tự động) 🔴

**Hiện trạng:** card trận đã hiển thị Sân, Đội 1 VS Đội 2, tổng level và nhãn "Đội mạnh/yếu hơn", nhưng **chưa nhập được kết quả**.

**Cần làm:**
- [ ] Bấm chọn đội thắng hoặc nhập tỉ số (21–17) trên card trận.
- [ ] Xem trước điểm: "Đội 1 +20 · Đội 2 −5".
- [ ] Trạng thái trận Chưa đấu / Đã có kết quả, nút "Sửa kết quả" / hủy kết quả.
- [ ] Toast "Đã lưu kết quả · BXH được cộng điểm".
- [ ] `generated_matches` hiện chỉ lưu đội và level; cần thêm id ổn định cho từng trận để gắn kết quả.
- [ ] Danh sách "Ngồi chờ" khi load lại theo ngày đang rỗng (API `/api/matches` không trả `waiting`). Cần lưu kèm khi generate.

## 3. Hồ sơ điểm cá nhân 🔴 (phụ thuộc mục 1–2)

- [ ] Header: avatar, level, hạng, tổng điểm.
- [ ] 4 ô thống kê: Số trận / Thắng / Thua / Tỷ lệ thắng, kèm chuỗi thắng hiện tại.
- [ ] Biểu đồ biến động điểm (3 tháng).
- [ ] Lịch sử trận: đồng đội, đối thủ, nhãn so level, điểm +/−.
- [ ] "Đồng đội ăn ý nhất", "Đối thủ khó nhằn nhất".

## 4. Giao lưu trong mục Vote 🟡

**Đã làm:** admin thêm giao lưu vào từng buổi vote (tên, level, trạng thái), có gợi ý khách cũ theo tên và tự điền level. Chip GL có tag riêng; bấm chip để đổi Tham gia/Không. Đếm "N thành viên + M giao lưu". Khi bấm "Tính tiền", khách giao lưu được đưa sẵn vào form Nhập tiền.

**Chưa làm:**
- [ ] **Thành viên tự "Dẫn theo giao lưu"** từ card vote (demo: link "+ Dẫn theo giao lưu" sau khi bấm "Có tham gia"). Hiện API `POST /api/sessions/:id/guests` chỉ cho admin. Cần mở cho user và ghi lại người dẫn.
- [ ] Lưu **giới tính** của GL (bảng `session_participants` chưa có cột).
- [ ] Lưu **"đi cùng ai"** (người dẫn) và hiển thị "GL · Minh" trên chip, "đi cùng bạn" ở phía user.
- [ ] **Xóa hẳn** GL khỏi buổi (hiện chỉ chuyển sang "Không").
- [ ] Gợi ý khách cũ đang lấy từ 30 buổi vote gần nhất ở client. Nên có API danh bạ khách riêng.

## 5. Sổ nợ / Nhập tiền 🟡

- [ ] Nút **"Hoàn tác"** sau khi bấm "Đã hoàn thành" cho một người (chưa có API hoàn tác tất toán).
- [ ] Nút **"Xuất báo cáo"** ở đầu trang Sổ nợ (demo có; báo cáo CSV hiện chỉ có cho dữ liệu cũ ở Công cụ).
- [ ] KPI "Đã thu tháng này **↑ 12% so tháng trước**": chưa so sánh với tháng trước.
- [ ] KPI "Đã thu tháng này" hiện tính theo **ngày buổi chơi** thuộc tháng này, không theo ngày bấm đã trả (chưa lưu thời điểm thanh toán của từng phần).
- [ ] Demo làm tròn "mỗi người trả" lên 1.000đ. Hệ thống hiện chia chính xác đến đồng (giữ logic cũ). Cần quyết định có làm tròn không.
- [ ] Sửa buổi đã lưu (hiện chỉ xóa rồi nhập lại).

## 6. Thông báo 🟡

- [ ] Trạng thái **đã đọc / chưa đọc** đang lưu ở `localStorage` theo thiết bị. Muốn đồng bộ nhiều thiết bị thì cần bảng `notice_reads`.
- [ ] Nút "Đọc hết" (demo có).
- [ ] Phân loại thông báo theo icon (lịch chơi / nhắc nợ / kết quả trận / giải đấu). Hiện mọi thông báo dùng icon chuông vì bảng `notices` chỉ có nội dung.
- [ ] Thông báo tự động "Kết quả trận đã cập nhật · +20 điểm" (phụ thuộc mục 2).

## 7. Giải đấu 🟢/🟡

**Đã làm:** đổi màu, font và token của module giải đấu sang theme mới (cả trang nhúng lẫn trang `/tournament`), hỗ trợ dark mode cho phần nhúng.

**Chưa làm (giữ nguyên cấu trúc module cũ `tournament-panel.js`):**
- [ ] Hero card giải "ĐANG MỞ ĐĂNG KÝ · Giải Hè 2025 · số VĐV / nội dung / cặp" kiểu demo.
- [ ] Segmented "Của tôi / Lịch đấu / Bảng giải" phía user theo layout demo.
- [ ] Card "Cặp đôi của bạn" (avatar đôi, tổng level, Hợp lệ), nút "Chọn đồng đội…" viền nét đứt.
- [ ] Admin: KPI (VĐV / cặp đôi / trận), card cài đặt dạng toggle, rule tổng level dạng chip.
- [ ] Trang `/tournament` độc lập chưa có dark mode.

## 8. Khác 🟢

- [ ] Trang đăng nhập: demo hiện số liệu thật ("18 thành viên · 42 buổi · 286 trận"). Hiện để chữ tĩnh vì chưa có API thống kê công khai.
- [ ] Ảnh nền sân cầu ở trang đăng nhập đang lấy từ Unsplash (hotlink). Nên tải về `public/` để chạy được offline (PWA).
- [ ] Màn **Style guide** (demo có ở Công cụ) chưa đưa vào app.
- [ ] Tab **"Trận" (Games)** placeholder cũ đã được bỏ khỏi menu admin vì không có chức năng.

---

### Thay đổi backend nhỏ đã thực hiện cùng đợt UI
- `listVoteSessions` (src/postgres.js) trả thêm `guest` (true nếu `participant_type = 'GL'`) và `level` cho từng người trong buổi vote, để UI phân biệt khách giao lưu và giữ đúng level khi đổi trạng thái.
