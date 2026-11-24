# Flipbook Capture: thiết kế

Ngày: 2026-11-24. Trạng thái: các mục mở đã chốt (mục 12, 13, 14); kiezroth xem lại mục 14 cùng kế hoạch `docs/superpowers/plans/2026-11-24-flipbook-capture.md`.

## 1. Mục đích

Flipbook Capture là app desktop để người dùng mở một video, xem chậm, tua chính xác tới từng 100ms hoặc từng frame, rồi chụp tay những khoảnh khắc quan trọng của một animation hoặc VFX. Các frame này được ghép thành ảnh flipbook có nhãn, kèm một file log thời gian.

**Người đọc flipbook là Claude.** Claude xem flipbook và log để hiểu chuyển động diễn ra thế nào theo thời gian (chẳng hạn tia lửa bùng ở 0ms, tan ở 420ms), rồi viết spec cho một AI khác sinh ảnh. Vì vậy mọi quyết định về xuất file đều ưu tiên hai điều: Claude đọc rõ từng ô sau khi ảnh bị thu nhỏ, và số liệu thời gian chính xác.

Việc chọn khoảnh khắc nào để chụp là phán đoán của người dùng, nên thao tác tay là luồng chính. Claude chỉ hỗ trợ qua MCP.

## 2. Mục tiêu, ngoài phạm vi, điều không được xảy ra

**Mục tiêu (bản đầu):**
- Nhập video, phát ở các tốc độ 0.1x, 0.25x, 0.5x, 1x.
- Tua tới và tua lùi bằng chuột trên thanh tiến trình và bằng phím, bước nhỏ nhất 100ms. Có thêm bước đi từng frame.
- Chụp frame bằng tay: phím T chụp cả khung hình, Ctrl+T chụp vùng đã chọn trên video.
- Danh sách frame đã chụp: chọn, xem ở khung xem, đặt tên, crop, xóa, nhảy video về ms của frame.
- Xuất flipbook: frame sắp theo ms, kích thước ô tùy chỉnh, nhãn ở góc trên bên phải, ảnh flipbook kèm log TXT và JSON, tùy chọn rút gọn ms.
- File dự án `.fbproj` chứa cả video và frame. Có New, Open, Save, Save As.
- MCP server chỉ đọc, giúp Claude lấy được dự án, frame và flipbook đã xuất.

**Bản hai (ngoài phạm vi bản đầu, nhưng kiến trúc phải để chỗ cho nó):** Claude điều khiển app đang mở qua MCP: tua tới ms, chụp, đặt tên, crop, xuất.

**Ngoài phạm vi:** cắt hoặc xuất video, âm thanh, timeline nhiều track, nhiều video trong một dự án, macOS và Linux, đồng bộ đám mây, tự động phát hiện khoảnh khắc quan trọng.

**Điều không được xảy ra (dù app vẫn chạy):**
- Ms ghi trong log lệch với frame người dùng đã thấy trên màn hình khi chụp.
- Ảnh chụp không đúng frame đang hiển thị (lệch một frame cũng tính là lỗi).
- Nhãn hoặc chi tiết ảnh không đọc được khi Claude nhận ảnh (cạnh dài khoảng 1568px).
- Mất frame đã chụp: tắt app khi chưa lưu, file dự án hỏng giữa lúc lưu.

## 3. Ràng buộc

- Chỉ chạy trên Windows (đã chọn; kiezroth chưa phản đối).
- Ứng dụng mới, không fork LosslessCut (kiezroth chốt).
- Electron + TypeScript, dùng ffmpeg/ffprobe đóng gói kèm app (kiezroth chọn cách A).
- Ctrl+T phải bắt được trong app. Đây là lý do loại phương án web app (trình duyệt luôn chiếm Ctrl+T).

## 4. Các cách đã cân nhắc

| Cách | Ưu | Nhược | Kết quả |
| --- | --- | --- | --- |
| **A. Electron + TypeScript + ffmpeg** | Chromium phát mượt ở 0.1x, tua nhanh; ffmpeg lấy frame gốc chính xác; có SDK MCP TypeScript chính thức; Ctrl+T dùng được | Bộ cài nặng (~150MB); HEVC, ProRes không phát trực tiếp | **Được chọn** |
| B. Python + PySide6 + PyAV | Giải mã từng frame chính xác, MCP Python viết nhanh | Phát chậm mượt và tua phải tự làm nhiều; đóng gói PyInstaller hay lỗi | Loại |
| C. Web app chạy trên máy | Nhẹ, không phải cài | Ctrl+T luôn mở tab mới, trang web không chặn được | Loại |
| Tauri (Rust) | Gọn hơn Electron | Phần MCP và ffmpeg phải tự nối nhiều hơn, không đem lại gì thêm | Loại sớm |
| Fork LosslessCut | Có sẵn trình phát và ffmpeg | Phần lõi (cắt video không render lại) không dùng tới; giấy phép GPL-2.0 | kiezroth bỏ |

## 5. Giao diện (bố cục B3, kiezroth đã duyệt)

```
┌ File  Edit  View  Help ───────────────────────────────────────────┐
│ ┌──────────── Video ────────────┐ ┌──────── Khung xem frame ────┐ │
│ │        [vùng chọn nét đứt]    │ │  ảnh frame đang chọn   [2  ]│ │
│ │                               │ │  (khung crop khi bật)  [tên]│ │
│ └───────────────────────────────┘ │                       [ms  ]│ │
│  Đang xem 1200ms                  └─────────────────────────────┘ │
│                                    [Crop] [Đặt tên] [Tới ms này] [Xóa]
│ ══════|════|═══════▼══════|══════════════  ← thanh tiến trình     │
│ 00:01.200 / 00:04.800 [-100ms][◀frame][▶][frame▶][+100ms]         │
│ [0.1x][0.25x][0.5x][1x]                                           │
│ ┌────┐┌────┐┌────┐┌────┐                                          │
│ │ 1  ││ 2  ││ 3  ││... │  ← dải frame, xếp theo ms                │
│ └────┘└────┘└────┘└────┘                                          │
│ T: chụp · Ctrl+T: chụp vùng · ←/→ ±100ms · , . từng frame  slash.fbproj *
└───────────────────────────────────────────────────────────────────┘
```

- **Phần trên:** video bên trái, khung xem frame bên phải, cùng kích thước để so sánh.
- **Không có nút chụp hay nút xuất trên màn hình** (kiezroth bỏ). Chụp chỉ bằng phím, xuất qua menu File.
- **Menu File:** New (Ctrl+N), Open (Ctrl+O), Save (Ctrl+S), Save As (Ctrl+Shift+S), Import Video (Ctrl+I), Export Flipbook (Ctrl+E), Exit. Import Video tách riêng khỏi Open: Open mở `.fbproj`, Import Video nạp video vào dự án đang mở (đề xuất của Claude, kiezroth không phản đối).
- **Menu Edit:** Undo (Ctrl+Z), Redo (Ctrl+Y), Xóa frame (Delete). Undo áp cho chụp, xóa, đổi tên, crop.
- **Thanh trạng thái:** bên trái ghi phím tắt, bên phải ghi tên dự án, có dấu `*` khi chưa lưu.
- **Thanh tiến trình:** vạch đỏ là vị trí đang xem, vạch xanh lá là những chỗ đã chụp, vạch xanh dương là frame đang chọn. Bấm vào vạch thì chọn frame đó.

## 6. Phát và tua

- **Tốc độ:** 0.1x, 0.25x, 0.5x, 1x. Nút đang bật được tô màu. Đổi tốc độ không làm dừng video.
- **Phím:**
  - Space: phát / dừng.
  - ← / →: lùi / tới 100ms.
  - `,` / `.`: lùi / tới một frame.
  - Shift + ← / →: lùi / tới 1 giây (Claude tự thêm).
- **Chuột trên thanh tiến trình:** bấm hoặc kéo để tua. Vị trí bắt về bội số 100ms. Giữ Alt khi kéo để tua tự do, khi đó vị trí bắt về frame gần nhất.
- **Hiển thị thời gian:** `mm:ss.mmm`. Giá trị hiển thị là thời điểm của frame đang thật sự hiện trên màn hình, không phải thời điểm con trỏ thời gian của trình phát.
- **Ở video 30fps, mỗi frame cách nhau khoảng 33ms.** Một bước 100ms nhảy qua khoảng 3 frame, nên mới cần thêm phím đi từng frame.

## 7. Chụp frame

- **T:** chụp cả khung hình của frame đang hiển thị.
- **Ctrl+T:** chụp vùng đã chọn. Người dùng kéo chuột trên video để vẽ hoặc sửa vùng chọn (hình chữ nhật nét đứt). Vùng chọn được giữ lại cho các lần Ctrl+T sau. Nếu chưa có vùng chọn mà bấm Ctrl+T, app báo cần vẽ vùng trước (Claude quyết).
- **Ảnh lấy từ video gốc ở độ phân giải gốc** (dùng ffmpeg), không chụp lại màn hình. Ms của frame là thời điểm trình bày (presentation timestamp) của frame đó, làm tròn về số nguyên ms.
- **Nhiều ảnh cùng một frame (kiezroth chốt):** được phép chụp cùng một frame nhiều lần với vùng khác nhau (ví dụ T cho toàn cảnh, Ctrl+T cho chi tiết). Các ảnh đó có cùng ms, Δms giữa chúng bằng 0, và khi sắp xếp thì ảnh chụp trước đứng trước. Chỉ bỏ qua (kèm thông báo ngắn) khi chụp trùng cả frame lẫn vùng.
- **Video không phát được trong Chromium** (HEVC, ProRes...): khi nhập, app tạo bản proxy H.264 chỉ để phát. Ảnh vẫn lấy từ video gốc (Claude quyết). Proxy phải giữ nguyên timestamp của video gốc. Tạo proxy có thanh tiến trình và nút hủy.
- **Xác định đúng frame đang hiển thị (Claude quyết):** khi nhập video, app dùng ffprobe dựng bảng PTS của mọi frame trong video gốc. Bảng này là nguồn chuẩn duy nhất về thời gian. Mỗi lần tua hay đi từng frame, app chọn một PTS trong bảng rồi đưa trình phát tới đó. Lúc dừng, frame đang hiển thị được đối chiếu với bảng (qua `requestVideoFrameCallback`). Khi chụp, ffmpeg trích đúng frame có PTS đó từ video gốc. Video có fps thay đổi (VFR) cũng phải đúng. Chụp chỉ thực hiện khi video đang dừng; bấm T lúc đang phát thì app dừng lại ở frame hiện tại rồi mới chụp.

## 8. Danh sách frame và khung xem

- Dải frame luôn sắp theo ms, cùng ms thì theo thứ tự chụp. Mỗi ô có ảnh nhỏ, số thứ tự, tên và ms.
- Bấm một ô (hoặc vạch của nó trên thanh tiến trình) thì frame đó hiện ở khung xem.
- **Khung xem** hiện nhãn ở góc trên bên phải, giống hệt lúc xuất. Có các nút:
  - Crop: hiện khung kéo trên ảnh. Crop không phá ảnh gốc: app giữ ảnh đã chụp và lưu thêm hình chữ nhật crop, nên sửa lại được.
  - Đặt tên.
  - Tới ms này: đưa video về đúng thời điểm của frame.
  - Xóa.
- **Đánh số và tên:**
  - Số thứ tự là vị trí của frame sau khi sắp theo ms. Chèn thêm frame ở giữa thì số của các frame phía sau tăng lên.
  - Tên mặc định chính là số. Nếu người dùng đặt tên gốc (ví dụ `slash`), tên hiển thị là `slash-<số>`. Tên đặt riêng cho từng frame.

## 9. File dự án `.fbproj`

- **Chứa cả video** (kiezroth chốt), để mang sang máy khác vẫn mở được.
- Định dạng: file zip lưu không nén (video đã nén sẵn, lưu không nén cho nhanh), gồm:
  - `project.json`: phiên bản định dạng, thông tin video (tên gốc, fps, kích thước, độ dài, codec), danh sách frame (id, ms, tên gốc, hình chữ nhật vùng chụp, hình chữ nhật crop, thứ tự tạo), vùng chọn hiện tại, cài đặt xuất lần cuối.
  - `video/<tên gốc>`: bản chép video gốc.
  - `frames/<id>.png`: ảnh đã chụp, chưa crop.
  - Proxy (nếu có) không lưu vào file, khi mở lại thì tạo lại.
- **Lưu an toàn:** ghi ra file tạm cạnh file đích rồi mới đổi tên đè lên, để file dự án không bị hỏng giữa chừng.
- **Không giải nén video ra thư mục tạm (Claude quyết).** Vì entry video lưu không nén, app phát video thẳng từ trong file zip qua một giao thức nội bộ hỗ trợ đọc theo khoảng byte. Chỉ `project.json` và ảnh frame được giải nén vào thư mục làm việc.
- **Kích thước video (Claude quyết):** tối ưu cho clip tham khảo ngắn (dưới khoảng 1 phút, vài trăm MB), nhưng vẫn phải chạy được với video vài GB. Lưu, mở và tạo proxy với video lớn đều có thanh tiến trình. Không đủ dung lượng đĩa thì báo lỗi rõ ràng, không làm hỏng file đang có.
- New, Open hoặc thoát khi có thay đổi chưa lưu thì app hỏi Lưu / Không lưu / Hủy.
- **Khôi phục sau khi app bị tắt đột ngột (Claude quyết):** thư mục làm việc được ghi ngay mỗi khi có thay đổi (frame mới, đổi tên, crop, xóa). Lần mở app sau, nếu còn thư mục làm việc chưa lưu thì app đề nghị khôi phục.
- **Undo / Redo chỉ có trong phiên làm việc** (Claude quyết), không lưu vào `.fbproj`.
- **Import Video khi dự án đã có video (Claude quyết):** app hỏi có thay video không. Đồng ý thì video mới thay video cũ và toàn bộ frame cũ bị xóa, vì frame gắn với video cũ. Bấm New xong thì dự án trống, chỉ Import Video và Open dùng được cho tới khi có video.

## 10. Xuất flipbook (kiezroth đã duyệt hộp thoại và mẫu)

**Hộp thoại Export Flipbook:**

| Nhóm | Trường | Mặc định |
| --- | --- | --- |
| Ô | Kích thước ô (rộng × cao, px); tick "giữ theo tỉ lệ video" | 256 × 256 |
| Ô | Đặt ảnh trong ô: vừa khung giữ tỉ lệ / lấp đầy cắt mép / kéo giãn | Vừa khung giữ tỉ lệ |
| Ô | Số cột: tự động hoặc nhập số | Tự động |
| Ô | Khoảng cách giữa các ô (px) | 4 |
| Trang | Cạnh dài tối đa của một trang (px) | 1568 |
| Nhãn | Hiện số / tên / ms (tick riêng từng cái) | Cả ba |
| Nhãn | Cỡ chữ (px) | 14 |
| Thời gian | Rút gọn ms (frame đầu = 0) | Bật |
| Đầu ra | Thư mục, tên file | Thư mục của dự án, tên dự án |

**Quy tắc:**
- Frame được sắp theo ms trước khi đánh số và xếp vào lưới, từ trái sang phải rồi từ trên xuống dưới.
- Số cột tự động: chọn số cột sao cho trang gần vuông và không vượt cạnh dài tối đa.
- **Cạnh dài tối đa là giới hạn cứng.** Không đủ chỗ trên một trang thì tách thành `<tên>_p1.png`, `<tên>_p2.png`..., không bao giờ thu nhỏ ô để nhét vừa một trang. Nếu một ô đã lớn hơn cạnh dài tối đa thì báo lỗi trong hộp thoại, không xuất.
- Hộp thoại xem trước số trang và số cột. Nếu cỡ chữ nhãn nhỏ hơn 12px hoặc ô nhỏ hơn 128px thì hiện cảnh báo "Claude có thể không đọc rõ" (Claude quyết), nhưng vẫn cho xuất.
- **Crop trong xuất (Claude quyết):** ảnh được crop trước, rồi mới đặt vào ô theo cách đã chọn. Tick "giữ theo tỉ lệ video" dùng tỉ lệ của video gốc, không dùng tỉ lệ vùng crop. Ms của frame không đổi khi crop.
- **Nhãn ở góc trên bên phải mỗi ô:** dòng 1 là số (in đậm), dòng 2 là tên, dòng 3 là ms. Chữ trắng trên nền đen bán trong suốt.
- **Ms trên nhãn:** tick rút gọn thì ghi ms tính từ frame đầu, không tick thì ghi ms gốc trong video.

**File xuất:**
- `<tên>_p<N>.png`: các trang flipbook.
- `<tên>_log.txt`: phần đầu ghi video, fps, kích thước, số frame, số trang, kích thước ô, chế độ thời gian, tổng thời gian (frame cuối trừ frame đầu, kèm ms gốc đầu và cuối). Sau đó là bảng: `#`, Tên, ms, +Δms (cách frame trước), Source ms (ms gốc), Trang.
- `<tên>_log.json`: cùng nội dung ở dạng máy đọc được. Mỗi frame có thêm vị trí ô (trang, hàng, cột) để Claude ghép được nhãn với ô.
- Cột Source ms luôn có trong log, kể cả khi tick rút gọn.

## 11. MCP cho Claude

**Bản đầu: chỉ đọc, không cần app đang mở** (kiezroth chốt).
- Một MCP server chạy qua stdio, đi kèm bộ cài, đọc thẳng file `.fbproj` và thư mục xuất.
- Người dùng khai báo các thư mục gốc cho server quét (qua tham số khi chạy server hoặc một file cấu hình).
- **Các tool:**
  - `list_projects`: liệt kê các `.fbproj` trong thư mục gốc.
  - `list_exports`: liệt kê các lần xuất (nhận ra qua file `*_log.json`).
  - `get_project(path)`: thông tin video và danh sách frame (số, tên, ms, vùng crop).
  - `get_flipbook(log_path)`: trả về các trang PNG dưới dạng ảnh kèm nội dung log JSON.
  - `get_frame(project_path, index)`: trả về một frame (đã crop) ở độ phân giải gốc.
- Server không ghi gì vào file nào.
- **Đóng gói (Claude quyết):** server là một entrypoint Node riêng, chạy bằng chính file exe của app ở chế độ Node (`ELECTRON_RUN_AS_NODE=1`), nên không cần cài Node. Thư mục gốc truyền qua tham số `--root` (lặp lại được). App có mục Help > "Kết nối với Claude" hiện sẵn lệnh `claude mcp add ...` để chép.
- Server và app dùng chung một thư viện lõi để đọc `.fbproj` và log. Server không cần ffmpeg vì chỉ đọc PNG và JSON.
- Trang flipbook vốn không vượt 1568px nên trả nguyên. `get_frame` có tham số `max_size` (mặc định 1568) để thu nhỏ frame lớn trước khi trả.

**Bản hai (để sau):**
- App đang mở sẽ mở một cổng nội bộ chỉ nghe trên `127.0.0.1`, có token.
- MCP server gửi lệnh qua cổng đó: tua tới ms, đặt tốc độ, chụp, chụp vùng, đặt tên, crop, xóa, xuất, lưu.
- **Bản đầu cần chuẩn bị cho việc này:** mọi thao tác tay đi qua một lớp lệnh chung (chính lớp này cũng phục vụ Undo), để bản hai chỉ việc nối lớp lệnh đó ra ngoài.

## 12. Phần để người xây tự quyết (đã chốt 2026-11-24)

- **Giao diện:** React + TypeScript, build bằng electron-vite. State dự án nằm ở main process; renderer giữ bản sao (zustand) và gửi lệnh qua IPC.
- **Zip:** `yazl` để ghi (entry lưu không nén, hỗ trợ ZIP64), `yauzl` để đọc (đọc theo khoảng byte của entry không nén).
- **Vẽ flipbook, crop, thu nhỏ:** `@napi-rs/canvas` (N-API, chạy được cả trong Electron lẫn chế độ `ELECTRON_RUN_AS_NODE`), font Arial / Arial Bold của Windows.
- **ffmpeg:** bản build Windows có libx264 (gyan.dev) chép vào `vendor/ffmpeg/`, đóng gói qua `extraResources`. Khi dev, tìm theo `FC_FFMPEG_DIR` rồi tới PATH.
- **Bộ cài:** electron-builder, NSIS, Windows x64.
- **Kiểu dáng:** nền tối, font hệ thống, không dùng bộ icon (chữ và ký tự Unicode). Menu dùng đúng nhãn tiếng Anh trong mục 5, thông báo và hộp thoại bằng tiếng Việt.
- **Test:** Vitest cho lõi và cho phần main process chạy ffmpeg thật; Playwright (`_electron`) cho vài luồng đầu-cuối. Video mẫu sinh bằng ffmpeg: số frame in trên hình để người xem, kèm dải 8 ô đen/trắng mã hóa số frame dạng nhị phân để test đọc tự động.

## 13. Các quyết định Claude tự đưa ra (đã duyệt 2026-11-24)

- Shift + ← / → để tua 1 giây. Kéo thanh tiến trình bắt về bội số 100ms, giữ Alt để tua tự do.
- Bấm Ctrl+T khi chưa có vùng chọn thì báo cần vẽ vùng. Chụp trùng cả frame lẫn vùng thì bỏ qua.
- Bảng PTS từ ffprobe là nguồn chuẩn về thời gian; chỉ chụp khi video dừng.
- Phát video thẳng từ trong `.fbproj`, không giải nén video. Có thanh tiến trình cho video lớn.
- Ghi thư mục làm việc liên tục và đề nghị khôi phục sau khi app tắt đột ngột. Undo chỉ trong phiên.
- Import video lần hai thì hỏi thay video và xóa frame cũ.
- Cạnh dài 1568px là giới hạn cứng, cảnh báo khi chữ hoặc ô quá nhỏ. Crop trước rồi mới đặt vào ô.
- MCP chạy bằng exe của app ở chế độ Node, thư mục gốc qua `--root`, dùng chung thư viện lõi với app.
- Tạo proxy H.264 để phát video mà Chromium không đọc được.
- Crop không phá ảnh gốc. Menu Edit có Undo / Redo.
- `.fbproj` là zip không nén. Lưu qua file tạm.
- Tên app Flipbook Capture, code ở `D:\FCFV` (thư mục phiên làm việc hiện tại; bản spec cũ ở `D:\SE116\FlipbookCapture` không còn là nơi đặt code).

## 14. Chốt thêm khi lập kế hoạch (kiezroth xem lại)

Những chỗ spec chưa nói, Claude chốt để kế hoạch không bị mơ hồ:

- **Gốc thời gian:** ms của frame = PTS của frame trừ PTS của frame đầu tiên trong video, làm tròn về số nguyên. Frame đầu luôn là 0ms, giống trình phát thông thường. Video có PTS đầu khác 0 hoặc có B-frame vẫn bắt đầu ở 00:00.000.
- **Đồng bộ trình phát với bảng PTS:** khi nạp video, app đo độ lệch giữa `mediaTime` của Chromium và PTS trong bảng một lần, rồi dùng độ lệch đó cho mọi lần tua. Tua tới frame i thì đặt `currentTime` vào giữa frame i và frame i+1, sau đó đối chiếu bằng `requestVideoFrameCallback`. Lệch thì tua lại một lần; vẫn lệch thì chặn chụp và báo lỗi.
- **Tua 100ms:** lấy ms của frame đang hiển thị cộng/trừ 100, rồi hiện frame có PTS lớn nhất không vượt thời điểm đó. Kéo thanh tiến trình bắt về bội số 100ms theo cùng quy tắc.
- **Kiểm tra ảnh chụp:** ffmpeg trích frame kèm bộ lọc `showinfo`; PTS ffmpeg báo về phải khớp PTS trong bảng, không khớp thì báo lỗi, không lưu ảnh.
- **ffmpeg đọc video trong `.fbproj`:** qua giao thức `subfile` của ffmpeg (khoảng byte của entry video), nên chụp và tạo proxy cũng không cần giải nén.
- **Lưu đè lên chính file đang phát:** app ghi file tạm, dừng và đóng mọi luồng đọc file cũ, đổi tên, rồi mở lại video ở đúng frame đang xem.
- **Video xoay (quay điện thoại):** kích thước video trong dự án là kích thước sau khi xoay; vùng chọn và crop tính theo hình đang hiển thị, ảnh chụp cũng đã xoay.
- **Cần proxy khi nào:** codec không thuộc h264, vp8, vp9, av1, hoặc thẻ `<video>` báo lỗi khi nạp. Proxy giữ PTS gốc (`-copyts`, `-fps_mode passthrough`), lưu trong thư mục cache của app.
- **Khôi phục:** thư mục làm việc nằm ở `%APPDATA%\Flipbook Capture\work\<id>\`, ghi kèm đường dẫn video gốc hoặc file `.fbproj` nguồn. Nếu video không còn ở đó, app nhờ người dùng chỉ lại file video.
- **Bố cục trang xuất:** không có lề ngoài; khoảng cách chỉ nằm giữa các ô. Mọi trang cùng số cột, chiều cao mỗi trang theo số hàng của trang đó. Số cột tự động: nếu vừa một trang thì chọn số cột cho chênh lệch rộng và cao nhỏ nhất (bằng nhau thì lấy nhiều cột hơn); nếu không vừa thì dùng số cột và số hàng tối đa. Tên file luôn có `_p<N>`, kể cả khi chỉ có một trang.
- **Δms của frame đầu:** ghi `—` trong TXT, `null` trong JSON.
- **Kiểm tra ảnh chụp (chi tiết đã thử với ffmpeg 9):** với `-copyts`, giá trị `-ss` vẫn tính từ đầu file, nên vị trí tua thô phải là `PTS − start_time − 3 giây` (không âm); tính theo PTS tuyệt đối sẽ tua quá frame cần lấy.
- **Nhãn:** dòng nào bị bỏ tick thì không vẽ; dòng tên bị bỏ khi frame chưa có tên gốc (vì tên mặc định trùng số); nền đen độ mờ 0.6, đệm 4px, giãn dòng 1.25 lần cỡ chữ. Khung xem dùng cùng hàm tính nhãn với lúc xuất.
- **Đặt tên:** tên gốc gắn với từng frame; để trống thì quay về tên mặc định là số.
- **MCP:** server từ chối mọi đường dẫn nằm ngoài các thư mục `--root`.
- **Menu View:** chọn tốc độ phát (0.1x, 0.25x, 0.5x, 1x).
