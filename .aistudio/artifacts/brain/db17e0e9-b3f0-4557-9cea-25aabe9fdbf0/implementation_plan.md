# OTTv2 — Tái Cấu Trúc Toàn Diện UX/UI, Kiến Trúc Giao Diện & Sự Kiện Halloween

Nâng cấp toàn diện giao diện và luồng trải nghiệm của nền tảng đấu trường AI cờ chiến thuật Oẳn Tù Tì (OTTv2) sang kiến trúc Component hiện đại, khắc phục triệt để các lỗi hiển thị chồng chéo, tối ưu cho lộ trình triển khai **Vercel + Render**, bảo toàn 100% thuật toán cùng dữ liệu hệ thống và ra mắt bộ giao diện đặc trưng mùa **Halloween** kèm công tắc chuyển đổi tức thì.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Giải đáp thắc mắc 1 — Hiện tại dự án đang dùng gì và tại sao nên chuyển sang React + TypeScript?**
> - **Hiện tại bạn đang dùng gì:** Phần giao diện đang viết bằng **HTML, CSS và JavaScript thuần (Vanilla JS)** không có công cụ quản lý trạng thái tự động (hơn 3.300 dòng lệnh điều khiển ẩn/hiện từng khối giao diện bằng tay). Khi số lượng tính năng tăng lên, cách làm này gây ra hàng loạt lỗi: các dòng chữ ngăn cách (*"đấu xếp hạng"*, *"hoặc"*) vẫn hiện lơ lửng khi sang trang khác, khung Đăng nhập dùng chung thẻ với khung Ghép trận khiến ô nhập liệu lúc ẩn lúc hiện, và khi bấm vào *Train Bot* hay vào trận thì người chơi bị văng sang một màn hình rời, mất thanh điều hướng.
> - **Đề xuất chuyển sang gì:** Xây dựng lại tầng giao diện bằng **React + TypeScript + Tailwind CSS (chạy trên Vite)**. Mọi khu vực (Tổng quan, Phòng Lab Bot, Ghép trận, Giải đấu, Phòng riêng, Xem 4 trận, Xem lại Replay) được tách thành các khối Component độc lập, tự động đồng bộ dữ liệu mà không bao giờ bị đè giao diện cũ.
> - **Bảo toàn 100% phần lõi của bạn:** Toàn bộ bộ máy luật cờ 9×9 tất định, trình chạy Python trong trình duyệt (Pyodide Web Worker), chuẩn hàm viết bot `get_next_move(my_player_id, game_state)`, cơ chế ký số chống gian lận P2P (ECDSA P-256) và toàn bộ máy chủ Backend đều được **giữ nguyên tương thích tuyệt đối**. Các code bot Python hiện có chạy ngay không cần sửa đổi.

> [!IMPORTANT]
> **Giải đáp thắc mắc 2 — Phối hợp phát triển ở Local và triển khai thực tế lên Vercel + Render**
> - **Khi triển khai thực tế (Production):** Giao diện React sau khi đóng gói sẽ triển khai cực nhẹ trên **Vercel**, còn máy chủ xử lý ghép trận, WebSocket, PostgreSQL và Redis giữ nguyên cấu trúc chuẩn để triển khai trên **Render**. Giao diện hỗ trợ cấu hình địa chỉ máy chủ Render qua biến môi trường khi deploy Vercel (hoặc nhập trực tiếp trong phần Cài đặt kết nối).
> - **Khi phát triển ở Local & chạy thử ngay:** Hệ thống đi kèm một lớp máy chủ nội bộ tương thích hoàn toàn chuẩn giao tiếp của bản Render ngay trong môi trường phát triển, giúp bạn chạy thử trọn vẹn mọi luồng (đăng ký, lưu bot, tìm trận, tạo giải đấu BTC, tính sao leo rank, xem lại Replay) ngay lập tức mà không bị kẹt lỗi mất kết nối khi chưa bật cụm Docker PostgreSQL/Redis riêng.

- **Quyết định đã xác nhận — Bộ Theme Sự kiện Halloween**: Phủ giao diện Halloween cho cả Sảnh điều khiển lẫn Bàn cờ thi đấu (quân cờ, ô mục tiêu thắng, vật cản theo tuần), đồng thời trang bị **nút bật/tắt 1 chạm** trên thanh công cụ để người chơi chuyển về giao diện Đấu trường Tiêu chuẩn bất cứ lúc nào.
- **Quyết định đã xác nhận — Tinh gọn Bố cục & Loại bỏ Luồng thừa**:
  - **Xóa bỏ quản lý Đội nhóm (Teams)** trên toàn bộ giao diện người dùng, chỉ giữ mô hình thi đấu cá nhân trực diện (dữ liệu bảng cũ trên máy chủ vẫn được giữ nguyên trong lược đồ để an toàn khi nâng cấp cơ sở dữ liệu).
  - **Xóa bỏ khung 3 bàn cờ phụ** bám bên phải màn hình thi đấu chính để không gian đấu 1v1 thoáng đãng và tập trung tối đa.
  - **Tách riêng chế độ Xem 4 trận** thành một màn hình Trung tâm Theo dõi độc lập dạng lưới 2×2.

---

## 1. Overview & Core Concept

- **What It Does**: Nền tảng thi đấu đối kháng cờ chiến thuật Oẳn Tù Tì 9×9 (OTTv2), nơi người chơi vừa có thể tự tay thi đấu trực tuyến, vừa có thể lập trình Bot AI bằng ngôn ngữ Python chạy trực tiếp trong trình duyệt để tranh tài tính điểm Elo và leo hạng qua các mùa giải hàng tuần (Sprint).
- **Target Audience / Persona**: Sinh viên công nghệ, lập trình viên yêu thích thuật toán AI/Game Theory, người chơi cờ chiến thuật đối kháng và Ban tổ chức (BTC) các giải đấu lập trình Bot.
- **Key Value**: Mang lại trải nghiệm liền mạch như một nền tảng eSports lập trình chuyên nghiệp: viết code Python — kiểm thử chiến thuật — ghép trận xếp hạng có kiểm chứng mật mã — theo dõi trực tiếp nhiều bàn đấu trên một không gian thống nhất, trực quan và đậm không khí sự kiện Halloween.

---

## 2. User Experience & Visual Design

### Key User Flows (Luồng Hoạt Động Đã Tối Ưu)

1. **Không gian Điều hướng Thống nhất & Tài khoản Tức thì**:
   - Thanh điều hướng dọc cố định bên trái (rộng 260px trên màn hình lớn, thu gọn thành ngăn kéo trên di động) gồm đúng 6 mục rõ nghĩa: **Tổng quan**, **Phòng Lab Bot**, **Ghép Trận Elo**, **Giải Đấu**, **Phòng Đấu Riêng**, và **Xem Trực Tiếp (4 Trận)**.
   - Tách hoàn toàn việc **Đăng nhập / Đăng ký / Hồ sơ** thành hộp thoại chuyên biệt mở ngay tại chỗ từ góc phải trên cùng, kèm bảng **Cài đặt Kết nối Máy chủ & Chuyển đổi Theme Halloween**, chấm dứt tình trạng phải rời màn hình đang thao tác để đăng nhập.
2. **Phòng Lab Bot (Train Bot & Thử Nghiệm Trực Tiếp)**:
   - Mở ngay trong khu vực làm việc chính với bố cục chia đôi cân đối: bên trái là Bàn cờ thử nghiệm 9×9 kèm điều khiển tốc độ (0ms – 1000ms), nút đi từng bước (Step), giới hạn thời gian TLE (50ms – 2000ms) và bảng nhật ký nước đi kèm mili-giây thực thi; bên phải là trình soạn thảo mã Python 3, bộ chọn Bot mẫu (Starter, Random, Greedy, Minimax), nút **Kiểm tra cú pháp** và **Lưu Bot lên tài khoản**.
   - Hỗ trợ thử nghiệm cả 4 kịch bản: *Bot của tôi vs AI mẫu*, *AI mẫu vs AI mẫu*, *Người chơi tự đánh vs Bot của tôi* để kiểm tra điểm yếu thuật toán, và thử nghiệm trước trên cả 4 loại bản đồ chướng ngại vật của Giải đấu.
3. **Ghép Trận Trực Tuyến & Xác Nhận Bot Rõ Ràng**:
   - Giao diện chọn chế độ thi đấu rõ ràng giữa **Đấu Bot Xếp Hạng (Tính điểm Elo)** và **Người Đấu Người (Đối kháng trực tiếp)**.
   - Hiển thị bộ đếm thời gian tìm trận và biên độ Elo đang mở rộng tự động. Khi ghép cặp thành công ở chế độ Bot đấu Bot, hệ thống mở bảng chuẩn bị cho phép chọn rõ nguồn Bot (Bot đã lưu trên tài khoản, Bot mẫu hoặc Bot đang soạn) và báo trạng thái sẵn sàng của cả hai bên trước khi khai cuộc.
4. **Giải Đấu Leo Rank Theo Tuần (Ranked Weekly Sprints)**:
   - Hiển thị danh sách giải đấu kèm bộ lọc trạng thái rõ ràng; tài khoản Ban Tổ Chức (`is_admin`) có nút mở bảng tạo giải đấu mới và cấu hình chu kỳ 4 luật bàn cờ cho từng Sprint.
   - Trang chi tiết giải đấu thể hiện trực quan hành trình 5 bậc hạng (**Đồng → Bạc → Vàng → Cao Thủ → Thách Đấu**), số Sao hiện có, Điểm mùa giải, bản đồ chướng ngại vật của Sprint đang diễn ra, nút **Tìm trận chạy đà** (giai đoạn đăng ký) hoặc **Tìm trận Leo Rank** (giai đoạn thi đấu chính thức) và bảng xếp hạng công bố đúng khung giờ quy định.
5. **Màn Hình Thi Đấu 1v1 Tinh Gọn & Trình Phát Lại Replay**:
   - Loại bỏ hoàn toàn 3 bàn cờ phụ gây nhiễu. Màn hình trận đấu chỉ gồm Bàn cờ 9×9 cỡ lớn ở trung tâm, thanh thông tin đối đầu hai bên (Tên, Elo, số quân Đấm/Lá/Kéo còn lại, chỉ báo lượt đi, đếm ngược 10 giây nếu đối thủ rớt mạng), bảng tra cứu nhanh quy tắc ăn quân và cột Nhật ký nước đi.
   - Mọi trận đã hoàn tất trong Lịch sử hoặc Giải đấu đều có thể mở **Phòng Chiếu Replay** với thanh tua lượt đi, phát tự động 1×/2×/4× và trạng thái xác minh chữ ký mật mã.
6. **Trung Tâm Theo Dõi & Lưới Xem 4 Trận (Multi-Match Arena)**:
   - Cho phép nhập mã phòng xem trực tiếp 1 trận đấu bất kỳ hoặc chuyển sang **Chế độ Lưới 2×2 (4 Bàn Cờ)** để theo dõi đồng thời 4 phòng đấu trực tiếp (hoặc chạy mô phỏng 4 cặp đấu mẫu), hỗ trợ nhấp vào bất kỳ bàn nào để phóng lớn lên chế độ tiêu điểm.

### Visual Identity & Theme ("Halloween Blood Moon" & "Standard Arena")

- **Aesthetic Direction**: Phong cách **Dark Tactical Sanctuary** — kết hợp sự chuẩn xác, sắc lạnh của bảng điều khiển chiến thuật eSports với không khí huyền bí của đêm hội Halloween (lồng đèn bí ngô ấm áp trên nền đá đêm thẫm), đảm bảo độ tương phản chuẩn WCAG AA để người chơi nhìn bàn cờ và đọc code Python hàng giờ không mỏi mắt.
- **Color Palette & Mood (Quy tắc phân bổ 60-30-10)**:
  - **Bộ Theme Sự kiện Halloween (Mặc định)**:
    - `--background` (60% Nền chủ đạo): Đêm Huyền Thạch `#0C0A12` và `#120E1B` tạo chiều sâu tĩnh lặng.
    - `--surface` (30% Bề mặt cấu trúc & Ô bàn cờ): Đá Tím Khói `#1A1426`, ô cờ sáng `#261E36` / ô cờ tối `#191324`, đường viền mảnh `rgba(255, 255, 255, 0.08)`, chữ chính `#F5F3F7`, chữ phụ `#9E95B0`.
    - `--primary` & `--accent` (10% Điểm nhấn hành động & Tiêu điểm): Cam Lồng Đèn `#F97316` cho nút hành động chính & quân Phe 1; Tím Linh Hồn `#A855F7` cho quân Phe 2 & hiệu ứng thánh tích; Xanh Lục Bảo `#10B981` cho trạng thái hợp lệ; Đỏ Huyết Nguyệt `#EF4444` cho nước ăn quân và cảnh báo lỗi.
  - **Bộ Theme Đấu Trường Tiêu Chuẩn (Khi gạt nút tắt Halloween)**:
    - Nền Slate Đậm `#0F172A`, bề mặt `#1E293B`, điểm nhấn Xanh Chiến Thuật `#3B82F6` (Phe 1) đối đầu Đỏ Chuẩn `#EF4444` (Phe 2) và Vàng Hổ Phách `#F59E0B` cho ô chiến thắng.
- **Thiết kế Bàn cờ & Quân cờ Đặc trưng Halloween**:
  - Hai ô mục tiêu chiến thắng góc chéo (`a1` và `i9`) được tạo hình nổi bật như hai **Ấn Lồng Đèn / Cổng Thánh Tích** giúp người chơi nhận diện mục tiêu chiếm đóng ngay lập tức.
  - Các ô bị chặn theo luật tuần (Chướng ngại trung tâm, Bàn vát góc, Hành lang vật cản) hiển thị họa tiết **Hắc Thạch Phong Ấn** rõ ràng thay vì chỉ đổi màu mờ nhạt.
  - Quân cờ **Đấm — Lá — Kéo** có vòng nhận diện phe sắc nét, kèm hiệu ứng viền sáng khi tới lượt và ký hiệu mũi tên mục tiêu rõ ràng cho các ô có thể di chuyển hoặc ăn quân.
- **Typography & Hierarchy**:
  - Phông tiêu đề & điều hướng: **Outfit** (mạnh mẽ, hiện đại, hỗ trợ tiếng Việt trọn vẹn).
  - Phông nội dung giao diện: **Plus Jakarta Sans** (rõ nét ở kích thước nhỏ 13px–15px).
  - Phông mã nguồn & số liệu: **JetBrains Mono** với chế độ số thẳng cột (`tabular-nums`) cho trình soạn thảo Python, điểm Elo, thời gian phản hồi mili-giây và tọa độ bàn cờ.
- **Component Styling & Layout**:
  - Thiết kế cho khung nhìn máy tính tiêu chuẩn 1440px và co giãn linh hoạt xuống máy tính bảng, điện thoại.
  - Chỉ sử dụng 1 tầng độ nổi cho các khung thông tin với viền mảnh tinh tế; thông tin phụ (thời gian, trạng thái, lượt đi, phiên bản bot) trình bày dạng chữ gọn gàng ngăn cách bằng dấu chấm giữa (`·`), không lạm dụng các hộp nhãn viên thuốc dày đặc.

### Interactive Feedback & Motion

- Chuyển động chọn quân, gợi ý đường đi và lật trang phản hồi nhanh dưới 180ms bằng thuộc tính tối ưu phần cứng (`transform`, `opacity`).
- Hiệu ứng xung kích ngắn khi ăn quân thành công hoặc khi chạm ô chiến thắng `a1`/`i9`, đi kèm âm thanh tổng hợp nhẹ nhàng qua Web Audio API (có nút bật/tắt tiếng trên thanh công cụ).
- Thay thế toàn bộ thông báo rời rạc bằng hệ thống Toast góc màn hình và khung trạng thái trực quan cho mọi tình huống: đang nạp runtime Python lần đầu, quá thời gian TLE, đối thủ rớt mạng đang đếm ngược 10 giây, hoặc lỗi cú pháp Python.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Tái cấu trúc giao diện sang React + TypeScript nhưng giữ nguyên lõi Engine & Worker độc lập**
  - *Chosen Approach*: Đóng gói lại toàn bộ tầng hiển thị bằng các Component React quản lý trạng thái tập trung, giao tiếp qua cầu nối sạch với bộ máy luật cờ tất định, Pyodide Worker và mô-đun mật mã P2P gốc.
  - *Why*: Triệt tiêu hoàn toàn lỗi rò rỉ trạng thái giao diện của hơn 3.300 dòng lệnh thao tác DOM thủ công, đồng thời đảm bảo kết quả ván đấu, mã băm trạng thái (FNV-1a / SHA-256) và chữ ký xác thực khớp 100% với máy chủ hiện tại.
  - *Alternatives Considered*: Chỉ sửa CSS trên nền HTML thuần cũ — tuy nhanh ban đầu nhưng rất dễ phát sinh lỗi ẩn/hiện chồng chéo mới mỗi khi mở rộng tính năng giải đấu.

- **Decision 2: Kiến trúc Kết nối Linh hoạt cho lộ trình Local -> Vercel + Render**
  - *Chosen Approach*: Hỗ trợ cấu hình URL máy chủ động (tự động nhận biến môi trường khi deploy trên Vercel để gọi sang Render, cho phép đổi URL trong phần Cài đặt, và tự động chuyển về máy chủ tích hợp sẵn khi chạy thử nội bộ).
  - *Why*: Giúp bạn vừa kiểm thử đầy đủ mọi tính năng ngay lập tức ở môi trường phát triển, vừa sẵn sàng đẩy mã nguồn giao diện lên Vercel và dịch vụ máy chủ lên Render mà không phải sửa lại mã nguồn kết nối.
  - *Alternatives Considered*: Cố định cứng một địa chỉ cổng máy chủ — gây lỗi mất kết nối ngay khi đưa lên môi trường đám mây hoặc chạy thử nhanh.

- **Decision 3: Giải phóng Màn hình Thi đấu 1v1 và Tách biệt Trung tâm Xem 4 Trận**
  - *Chosen Approach*: Đưa bàn cờ 1v1 về bố cục tập trung (Bàn cờ lớn + Thông tin 2 kỳ thủ + Nhật ký nước đi), chuyển tính năng theo dõi nhiều phòng sang mục **Xem Trực Tiếp** riêng biệt với lưới 2×2.
  - *Why*: Trong trận đấu xếp hạng căng thẳng, 3 bàn cờ phụ trống rỗng chiếm mất 30% diện tích màn hình gây thu nhỏ bàn cờ chính và làm phân tán sự tập trung của người chơi.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                     GIAO DIỆN NGƯỜI DÙNG (REACT + VITE SPA)                  │
│              (Triển khai Vercel · Hỗ trợ Dual-Theme Halloween/Chuẩn)         │
├──────────────────┬───────────────────────────────────────────────────────────┤
│ Thanh Điều Hướng │              KHÔNG GIAN LÀM VIỆC CHÍNH                    │
│  • Tổng quan     │  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │
│  • Phòng Lab Bot │  │ Tổng Quan &     │ │ Phòng Lab Bot   │ │ Ghép Trận    │ │
│  • Ghép Trận Elo │  │ Lịch Sử Trận    │ │ (Soạn Python +  │ │ Elo (Bot/PvP │ │
│  • Giải Đấu      │  │ + Bảng Xếp Hạng │ │  Bàn Cờ Thử)    │ │ + Chọn Bot)  │ │
│  • Phòng Riêng   │  └────────┬────────┘ └────────┬────────┘ └──────┬───────┘ │
│  • Xem 4 Trận    │  ┌────────┴────────┐ ┌────────┴────────┐ ┌──────┴───────┐ │
│                  │  │ Giải Đấu Sprint │ │ Bàn Đấu Chính   │ │ Phòng Chiếu  │ │
│ Thanh Đầu Trang  │  │ (Leo Sao, Luật  │ │ 1v1 & Lưới Xem  │ │ Replay & Xác │ │
│  • Bật/Tắt Theme │  │  Tuần, Quản Trị)│ │ 4 Trận Độc Lập  │ │ Minh Chữ Ký  │ │
│  • Hộp Tài Khoản │  └────────┬────────┘ └────────┬────────┘ └──────┬───────┘ │
└──────────────────┴───────────┼───────────────────┼─────────────────┼─────────┘
                               │                   │                 │
                               ▼                   ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     TẦNG LÕI TRÌNH DUYỆT (BẢO TOÀN 100%)                     │
│  ┌────────────────────────┐ ┌──────────────────────┐ ┌─────────────────────┐ │
│  │ Bộ Máy Luật Cờ OTTv2   │ │ Sandbox Python Bot   │ │ Đồng Thuận & Mạng   │ │
│  │ • Bàn 9x9, Seed PRNG   │ │ • Pyodide Web Worker │ │ • Chữ ký P-256      │ │
│  │ • Ô thắng a1/i9, Luật  │ │ • Chặn mạng, Đo TLE  │ │ • Commit-Reveal-Ack │ │
│  │   khắc chế & Vật cản   │ │ • 4 Bot mẫu tích hợp │ │ • WebRTC & PeerJS   │ │
│  └────────────────────────┘ └──────────────────────┘ └─────────────────────┘ │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ REST API (/api/*) & WebSocket (/ws)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     TẦNG MÁY CHỦ & DỮ LIỆU HỆ THỐNG                          │
│  ┌───────────────────────────────────┐ ┌───────────────────────────────────┐ │
│  │ Chế Độ Production (Render)        │ │ Chế Độ Local / Preview Tích Hợp   │ │
│  │ • Máy chủ Node.js + WebSocket     │ │ • Máy chủ API & WS tương thích    │ │
│  │ • PostgreSQL (Tài khoản, Elo,     │ │   cùng giao thức để kiểm thử      │ │
│  │   Phiên bản Bot, Giải đấu, Sao,   │ │   trọn vẹn mọi luồng ngay tại chỗ │ │
│  │   Replay JSON, Tranh chấp)        │ │   khi chưa nối máy chủ từ xa      │ │
│  │ • Redis (Hàng chờ ghép trận Elo)  │ │                                   │ │
│  └───────────────────────────────────┘ └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State (Các Dữ Liệu Quan Trọng Được Bảo Toàn)

- **Tài khoản & Điểm Xếp hạng (`users`)**: Mã định danh, email, mật khẩu mã hóa `scrypt`, tên hiển thị, điểm Elo (mặc định 1200, tính theo hệ số FIDE K=20 cho các trận Bot đấu Bot), quyền quản trị BTC (`is_admin`) và phiên bản Bot đang kích hoạt.
- **Kho Phiên bản Mã Bot (`user_bot_versions`)**: Lưu trữ mã nguồn Python 3 của người chơi, mã băm kiểm chứng `SHA-256` và số phiên bản để đảm bảo tính toàn vẹn khi đưa vào trận đấu giải.
- **Trận Đấu, Bằng Chứng Ký Số & Replay (`matches`, `match_results`)**: Seed khởi tạo bàn cờ, loại trận (`human` hoặc `bot`), luật chướng ngại vật áp dụng, khóa công khai phiên P-256 của 2 người chơi, chữ ký xác nhận kết quả cuối trận, biến động Elo trước/sau trận và toàn bộ dữ liệu nước đi định dạng `ottv2-replay-v1` để phát lại.
- **Hệ Thống Giải Đấu Leo Rank (`tournaments`, `tournament_entries`, `tournament_sprint_standings`)**: Lịch trình đóng đăng ký và kết thúc giải, danh sách 4 luật bản đồ theo từng Sprint 7 ngày (`standard`, `center_blockers`, `clipped_corners`, `corridor`), bậc hạng 5 cấp (Đồng, Bạc, Vàng, Cao Thủ, Thách Đấu), số Sao tích lũy (ngưỡng thăng hạng 10/20/30/40 sao), Điểm mùa giải ở bậc Thách Đấu và bảng tổng kết từng Sprint.
- **Trọng Tài Tranh Chấp & Ngắt Kết Nối (`match_disputes`, `disconnect_claims`)**: Lưu biên bản đối chiếu chữ ký từng lượt khi có bất đồng trạng thái và cơ chế xử lý tự động khi một bên mất kết nối quá 10 giây.

### Interactive Component & State Mapping

- **Quản lý Giao diện & Sự kiện Halloween**: Lưu lựa chọn giao diện (`halloween` hoặc `standard`) và cấu hình âm thanh vào bộ nhớ trình duyệt; cập nhật bộ biến màu và trang trí bàn cờ tức thì mà không làm gián đoạn ván đấu hay phiên chạy Pyodide đang mở.
- **Hộp thoại Xác thực & Kết nối**: Kiểm tra định dạng email và độ dài mật khẩu (tối thiểu 10 ký tự theo quy chuẩn máy chủ); lưu phiên đăng nhập JWT đồng bộ cho cả REST API lẫn kết nối WebSocket; tự động làm mới thông tin Elo và trạng thái giải đấu ngay sau khi đăng nhập hoặc kết thúc trận.
- **Phòng Lab Bot & Pyodide Worker**: Quản lý vòng đời nạp trình thông dịch Python bất đồng bộ (hiển thị tiến trình tải lần đầu rõ ràng), khóa nút tránh bấm đúp khi đang kiểm tra cú pháp, bắt lỗi ngoại lệ Python hoặc lỗi vượt ngưỡng thời gian TLE để báo dòng lỗi cụ thể cho người lập trình.
- **Điều phối Ghép trận & Thi đấu**: Đồng bộ chặt chẽ các giai đoạn `Đang tìm đối thủ` -> `Ghép thành công / Chọn Bot sẵn sàng` -> `Thiết lập kênh truyền P2P & Khóa phiên` -> `Đang thi đấu (Commit - Reveal - Ack)` -> `Ký xác nhận kết quả & Cập nhật Elo/Sao`, kèm nút hủy tìm trận an toàn và xử lý khôi phục khi rớt mạng ngắn hạn.
