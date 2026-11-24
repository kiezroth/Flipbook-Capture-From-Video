# Flipbook Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App desktop Windows để xem chậm video, chụp tay đúng từng frame, rồi xuất flipbook có nhãn kèm log thời gian cho Claude đọc; thêm MCP server chỉ đọc.

**Architecture:** Lõi thuần TypeScript (`src/core`) lo sắp xếp, thời gian, bố cục, log, đọc/ghi `.fbproj` và vẽ ảnh; app và MCP server dùng chung lõi này. Main process của Electron giữ tài liệu dự án, chạy ffmpeg/ffprobe, phục vụ video qua giao thức nội bộ có Range; renderer React chỉ hiển thị và gửi lệnh. Mọi thao tác đi qua một lớp lệnh (`DocCommand`, `PlaybackCommand`) để Undo và để bản hai nối ra ngoài.

**Tech Stack:** Electron (bản stable mới nhất), electron-vite, React 19, TypeScript, zustand, yazl/yauzl, @napi-rs/canvas, @modelcontextprotocol/sdk, ffmpeg/ffprobe (build gyan.dev), Vitest, Playwright `_electron`, electron-builder (NSIS x64).

**Spec:** `docs/superpowers/specs/2026-11-24-flipbook-capture-design.md` (đọc kèm, nhất là mục 13 và 14).

## Global Constraints

- Chỉ Windows x64. Code ở `D:\FCFV`.
- Code, comment, commit bằng tiếng Anh. Menu dùng nhãn tiếng Anh đúng như spec mục 5; thông báo và hộp thoại bằng tiếng Việt.
- Phím: Space phát/dừng; ←/→ ±100ms; Shift+←/→ ±1s; `,`/`.` ±1 frame; T chụp; Ctrl+T chụp vùng; Delete xóa frame; Ctrl+N/O/S/Shift+S/I/E/Z/Y như spec mục 5.
- Tốc độ phát chỉ có 0.1, 0.25, 0.5, 1.
- Ms của frame = `round((pts[i] − pts[0]) × 1000)`. Bảng PTS từ ffprobe là nguồn chuẩn duy nhất.
- Ảnh chụp luôn trích từ video gốc bằng ffmpeg, không từ màn hình, không từ proxy.
- `.fbproj` = zip, mọi entry lưu không nén (store), có ZIP64; gồm `project.json`, `video/<tên gốc>`, `frames/<id>.png`. Lưu qua file tạm rồi đổi tên.
- Mặc định xuất: ô 256×256, vừa khung giữ tỉ lệ, cột tự động, khoảng cách 4, cạnh dài tối đa 1568, hiện số/tên/ms, cỡ chữ 14, rút gọn ms bật. Cảnh báo khi cỡ chữ < 12 hoặc cạnh ô < 128.
- Nhãn: góc trên phải, chữ trắng, nền `rgba(0,0,0,0.6)`, đệm 4px, giãn dòng `round(1.25 × cỡ chữ)`, dòng số in đậm.
- MCP chỉ đọc, không ghi file nào, từ chối đường dẫn ngoài `--root`.

## Review Focus

1. **Lưu đè lên chính `.fbproj` đang phát video** (Ctrl+S sau khi Open) → lưu thành công, video phát tiếp ở đúng frame. Test ở Task 10.
2. **Video có PTS đầu khác 0 và có B-frame** (quay OBS, điện thoại) → frame đầu hiện 00:00.000, ảnh chụp đúng frame đang hiện. Fixture `offset_bframes.mp4`, test ở Task 5 và Task 11.
3. **Video quay điện thoại có metadata xoay 90°** → kích thước dự án là kích thước sau xoay, vùng chọn vẽ trên hình hiển thị cắt đúng chỗ trong ảnh chụp. Fixture `rotated.mp4`, test ở Task 4 và Task 5.
4. **Đường dẫn có dấu tiếng Việt và khoảng trắng** (`D:\Video hiệu ứng\chém.mp4`, `dự án.fbproj`) đi qua ffprobe, ffmpeg `subfile`, lưu/mở dự án và MCP → chạy bình thường. Test ở Task 6, Task 10 và Task 14.
5. **Giữ phím `.` hoặc → nhấn liên tục khi lần tua trước chưa xong** → dừng đúng ở frame cuối cùng được yêu cầu, không lệch một frame, số ms hiển thị khớp hình. Test ở Task 11.

---

## Cấu trúc file

```
package.json, tsconfig.json, electron.vite.config.ts, vite.mcp.config.ts,
vitest.config.ts, playwright.config.ts, electron-builder.yml
scripts/make-fixtures.ts        sinh video mẫu bằng ffmpeg (gọi từ test/global-setup.ts)
scripts/vendor-ffmpeg.ps1       chép ffmpeg.exe/ffprobe.exe vào vendor/ffmpeg
src/core/                       thuần TS, không import electron
  types.ts       Rect, VideoInfo, FrameRecord, ProjectFile, ExportSettings, DEFAULT_EXPORT
  ordering.ts    sắp xếp, đánh số, tên hiển thị
  timing.ts      tra bảng PTS, ms, bước tua, Δms
  layout.ts      chia trang, số cột, cảnh báo
  labels.ts      dòng nhãn và kích thước khung nhãn
  exportLog.ts   ExportLog, buildExportLog, formatLogTxt
  fbproj.ts      VideoSource, ffmpegInput, openFbproj, writeFbproj
  image.ts       crop, đặt vào ô, vẽ trang, thu nhỏ (@napi-rs/canvas)
  export.ts      exportFlipbook: ghi PNG trang + log TXT/JSON
src/shared/      commands.ts (DocCommand, PlaybackCommand, CommandResult), ipc.ts (FcApi, RendererState)
src/main/
  ffmpeg/paths.ts, ffmpeg/probe.ts, ffmpeg/extract.ts, ffmpeg/proxy.ts
  workspace.ts   thư mục làm việc, ghi liên tục, tìm phiên khôi phục
  document.ts    ProjectDocument: thực thi lệnh, Undo/Redo
  session.ts     ProjectSession: New/Open/Save/SaveAs/Import/đóng, hỏi lưu
  media-protocol.ts  fbvideo:// (Range) và fbwork://
  ipc.ts, menu.ts, index.ts
src/preload/index.ts             window.fc: FcApi
src/renderer/
  main.tsx, App.tsx, store.ts, keymap.ts, styles.css
  player/controller.ts, player/Player.tsx, player/Timeline.tsx, player/Transport.tsx, player/SelectionLayer.tsx
  viewer/FrameViewer.tsx, viewer/CropBox.tsx, viewer/LabelOverlay.tsx
  strip/FrameStrip.tsx, StatusBar.tsx
  dialogs/ExportDialog.tsx, dialogs/ConnectClaudeDialog.tsx, dialogs/Toast.tsx
src/mcp/server.ts, src/mcp/tools.ts
test/global-setup.ts, test/helpers/decodeIndex.ts, test/core/*, test/main/*, test/mcp/*
e2e/*.spec.ts
```

---

### Task 1: Khung dự án

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `test/core/smoke.test.ts`

**Interfaces:**
- Produces: script `npm run dev` (electron-vite dev), `npm test` (vitest run), `npm run e2e` (build rồi playwright test), `npm run build`. Alias `@core` → `src/core`, `@shared` → `src/shared` cho cả main, renderer và vitest.

- [ ] **Step 1:** `git init`, tạo `.gitignore` (`node_modules/`, `out/`, `dist/`, `vendor/`, `test/fixtures/gen/`, `test-results/`).
- [ ] **Step 2:** Dựng electron-vite với React + TS (main, preload, renderer). Cửa sổ 1400×900, nền tối, tiêu đề "Flipbook Capture". `contextIsolation: true`, `sandbox: false` cho preload.
- [ ] **Step 3:** Thêm Vitest (`environment: 'node'`, `globalSetup: test/global-setup.ts` tạo file rỗng ở task này) và test `smoke.test.ts` khẳng định `1 + 1 === 2`.
- [ ] **Step 4:** Chạy `npm test` → PASS; chạy `npm run dev` → cửa sổ trống mở lên, không lỗi console.
- [ ] **Step 5:** Commit `chore: scaffold electron-vite react app`.

---

### Task 2: Lõi — kiểu dữ liệu, sắp xếp, đánh số, thời gian

**Files:**
- Create: `src/core/types.ts`, `src/core/ordering.ts`, `src/core/timing.ts`
- Test: `test/core/ordering.test.ts`, `test/core/timing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  interface Rect { x: number; y: number; w: number; h: number }          // px, toạ độ hình đã xoay
  interface VideoInfo { fileName: string; codec: string; width: number; height: number;
    rotation: 0 | 90 | 180 | 270; fps: number; isVfr: boolean; durationMs: number;
    frameCount: number; startTimeSec: number }
  interface FrameRecord { id: string; ptsSec: number; ms: number; seq: number;
    baseName: string | null; region: Rect | null; crop: Rect | null } // crop theo toạ độ ảnh đã chụp
  interface ExportSettings { cellW: number; cellH: number; keepVideoAspect: boolean;
    fit: 'contain' | 'cover' | 'stretch'; columns: 'auto' | number; gap: number;
    maxLongEdge: number; showIndex: boolean; showName: boolean; showMs: boolean;
    fontSize: number; relativeMs: boolean; outDir: string | null; fileName: string | null }
  const DEFAULT_EXPORT: ExportSettings   // giá trị ở Global Constraints, keepVideoAspect=false
  interface ProjectFile { formatVersion: 1; video: VideoInfo | null; frames: FrameRecord[];
    nextSeq: number; selection: Rect | null; exportSettings: ExportSettings }
  // ordering.ts
  interface NumberedFrame extends FrameRecord { index: number; displayName: string }
  function sortFrames(f: FrameRecord[]): FrameRecord[]          // theo ptsSec, rồi seq
  function numberFrames(f: FrameRecord[]): NumberedFrame[]      // index bắt đầu từ 1
  function displayName(baseName: string | null, index: number): string
  // timing.ts  (pts: number[] tăng dần, đơn vị giây)
  function frameMs(pts: number[], i: number): number            // round((pts[i]-pts[0])*1000)
  function frameIndexAtMs(pts: number[], ms: number): number    // i lớn nhất có (pts[i]-pts[0])*1000 <= ms+1e-6, kẹp [0,n-1]
  function nearestFrameIndex(pts: number[], sec: number): number
  function stepByMs(pts: number[], current: number, deltaMs: number): number
  function snapTimelineMs(pts: number[], ms: number, free: boolean): number   // trả index
  function seekTargetSec(pts: number[], i: number, offsetSec: number): number // giữa i và i+1, trừ offset; frame cuối: pts[i]+0.001-offset
  function exportTimes(frames: NumberedFrame[], relative: boolean):
    { ms: number; deltaMs: number | null; sourceMs: number }[]
  ```

- [ ] **Step 1: Viết test thất bại**

```ts
// ordering.test.ts
const f = (id, ptsSec, seq, baseName = null) => ({ id, ptsSec, ms: Math.round(ptsSec*1000), seq, baseName, region: null, crop: null });
test('sorts by pts then capture order', () => {
  const out = numberFrames([f('c', 0.5, 3), f('a', 0.5, 1), f('b', 0.1, 2)]);
  expect(out.map(x => [x.id, x.index])).toEqual([['b',1],['a',2],['c',3]]);
});
test('inserting a frame renumbers later frames', () => {
  const out = numberFrames([f('a', 0, 1), f('b', 1, 2), f('n', 0.5, 3)]);
  expect(out.map(x => x.id)).toEqual(['a','n','b']);
  expect(out[2].index).toBe(3);
});
test('display name', () => {
  expect(displayName(null, 4)).toBe('4');
  expect(displayName('slash', 4)).toBe('slash-4');
  expect(displayName('', 4)).toBe('4');
});
// timing.test.ts
const cfr = Array.from({ length: 90 }, (_, i) => 1.5 + i / 30);     // PTS bắt đầu 1.5s
test('frame ms is relative to first frame', () => {
  expect(frameMs(cfr, 0)).toBe(0); expect(frameMs(cfr, 1)).toBe(33); expect(frameMs(cfr, 36)).toBe(1200);
});
test('100ms steps from any frame', () => {
  expect(stepByMs(cfr, 0, 100)).toBe(3); expect(stepByMs(cfr, 1, 100)).toBe(4);
  expect(stepByMs(cfr, 2, -100)).toBe(0); expect(stepByMs(cfr, 89, 100)).toBe(89);
  expect(stepByMs(cfr, 0, 1000)).toBe(30);
});
test('timeline snaps to 100ms unless free', () => {
  expect(snapTimelineMs(cfr, 1249, false)).toBe(36);   // 1200ms
  expect(snapTimelineMs(cfr, 1249, true)).toBe(37);    // 1233ms gần nhất
});
test('seek target is mid-frame minus offset', () => {
  expect(seekTargetSec(cfr, 3, 1.5)).toBeCloseTo(0.1 + 1/60, 6);
});
test('VFR lookup', () => {
  const vfr = [0, 0.033, 0.080, 0.100, 0.161];
  expect(frameIndexAtMs(vfr, 99)).toBe(2); expect(frameIndexAtMs(vfr, 100)).toBe(3);
});
test('export times: relative, delta, same-frame zero', () => {
  const n = numberFrames([f('a', 2.0, 1), f('b', 2.42, 2), f('c', 2.42, 3)]);
  expect(exportTimes(n, true)).toEqual([
    { ms: 0, deltaMs: null, sourceMs: 2000 }, { ms: 420, deltaMs: 420, sourceMs: 2420 }, { ms: 420, deltaMs: 0, sourceMs: 2420 }]);
  expect(exportTimes(n, false)[1].ms).toBe(2420);
});
```

`sourceMs` của frame là `FrameRecord.ms` (đã tính theo gốc thời gian ở Task 5); test dùng `ms = round(ptsSec*1000)` cho gọn.

- [ ] **Step 2:** `npx vitest run test/core` → FAIL (module chưa có).
- [ ] **Step 3:** Cài đặt các hàm trên. `frameIndexAtMs` và `nearestFrameIndex` dùng tìm kiếm nhị phân (bảng có thể vài trăm nghìn phần tử).
- [ ] **Step 4:** `npx vitest run test/core` → PASS.
- [ ] **Step 5:** Commit `feat(core): frame ordering, naming and timing math`.

---

### Task 3: Lõi — bố cục trang, nhãn, log xuất

**Files:**
- Create: `src/core/layout.ts`, `src/core/labels.ts`, `src/core/exportLog.ts`
- Test: `test/core/layout.test.ts`, `test/core/labels.test.ts`, `test/core/exportLog.test.ts`

**Interfaces:**
- Consumes: `NumberedFrame`, `exportTimes`, `ExportSettings`, `VideoInfo` (Task 2).
- Produces:
  ```ts
  interface PageLayout { index: number; width: number; height: number; rows: number; first: number; count: number }
  interface Layout { cols: number; rowsPerPage: number; pages: PageLayout[] }
  type LayoutError = { error: 'no-frames' } | { error: 'cell-too-large' } | { error: 'too-many-columns'; maxCols: number }
  function computeLayout(n: number, s: Pick<ExportSettings,'cellW'|'cellH'|'gap'|'maxLongEdge'|'columns'>): Layout | LayoutError
  function cellPosition(l: Layout, s: Pick<ExportSettings,'cellW'|'cellH'|'gap'>, i: number): { page: number; row: number; col: number; x: number; y: number } // i 0-based, page 1-based
  function exportWarnings(s: ExportSettings): string[]
  // labels.ts
  interface LabelLine { text: string; bold: boolean }
  function labelLines(f: { index: number; baseName: string | null; displayName: string; ms: number }, s: Pick<ExportSettings,'showIndex'|'showName'|'showMs'>): LabelLine[]
  function labelBox(lines: LabelLine[], fontSize: number, measure: (l: LabelLine) => number): { width: number; height: number; padding: 4; lineHeight: number }
  // exportLog.ts
  interface ExportLog { version: 1; project: string; video: { name: string; fps: number; isVfr: boolean; width: number; height: number };
    frameCount: number; pageCount: number; cell: { width: number; height: number; fit: string; gap: number; cols: number };
    timeMode: 'relative' | 'source'; totalMs: number; firstSourceMs: number; lastSourceMs: number;
    pages: { file: string; width: number; height: number }[];
    frames: { index: number; name: string; ms: number; deltaMs: number | null; sourceMs: number; page: number; row: number; col: number }[] }
  function buildExportLog(a: { projectName: string; video: VideoInfo; frames: NumberedFrame[]; layout: Layout; settings: ExportSettings; pageFiles: string[] }): ExportLog
  function formatLogTxt(log: ExportLog): string
  ```

Thuật toán số cột (spec mục 14): `maxCols = floor((L+gap)/(cellW+gap))`, `maxRows = floor((L+gap)/(cellH+gap))`. Cột tự động: nếu `n ≤ maxCols×maxRows` thì xét `c = 1..min(n,maxCols)` với `ceil(n/c) ≤ maxRows`, chọn `|W−H|` nhỏ nhất, hòa thì `c` lớn hơn; nếu không thì `c = maxCols`. `rowsPerPage = min(maxRows, ceil(n/c))`. Trang rộng `c·cellW+(c−1)·gap`, cao theo số hàng của chính trang đó.

- [ ] **Step 1: Viết test thất bại**

```ts
const s = { cellW: 256, cellH: 256, gap: 4, maxLongEdge: 1568, columns: 'auto' as const };
test('10 frames fit one page, wider wins tie', () => {
  const l = computeLayout(10, s) as Layout;
  expect([l.cols, l.rowsPerPage, l.pages.length]).toEqual([4, 3, 1]);
  expect([l.pages[0].width, l.pages[0].height]).toEqual([1036, 776]);
});
test('40 frames split into pages, never shrinks cells', () => {
  const l = computeLayout(40, s) as Layout;
  expect(l.cols).toBe(6);
  expect(l.pages.map(p => [p.width, p.height, p.count])).toEqual([[1556, 1556, 36], [1556, 256, 4]]);
  expect(cellPosition(l, s, 36)).toMatchObject({ page: 2, row: 0, col: 0, x: 0, y: 0 });
  expect(cellPosition(l, s, 7)).toMatchObject({ page: 1, row: 1, col: 1, x: 260, y: 260 });
});
test('manual columns', () => {
  const l = computeLayout(10, { ...s, columns: 2 }) as Layout;
  expect([l.pages[0].width, l.pages[0].height]).toEqual([516, 1296]);
  expect(computeLayout(10, { ...s, columns: 7 })).toEqual({ error: 'too-many-columns', maxCols: 6 });
});
test('errors', () => {
  expect(computeLayout(0, s)).toEqual({ error: 'no-frames' });
  expect(computeLayout(3, { ...s, cellW: 1600, cellH: 200 })).toEqual({ error: 'cell-too-large' });
});
test('warnings', () => {
  expect(exportWarnings({ ...DEFAULT_EXPORT })).toEqual([]);
  expect(exportWarnings({ ...DEFAULT_EXPORT, fontSize: 11 })).toHaveLength(1);
  expect(exportWarnings({ ...DEFAULT_EXPORT, cellW: 127 })[0]).toContain('Claude có thể không đọc rõ');
});
test('label lines', () => {
  const all = { showIndex: true, showName: true, showMs: true };
  expect(labelLines({ index: 2, baseName: 'slash', displayName: 'slash-2', ms: 420 }, all))
    .toEqual([{ text: '2', bold: true }, { text: 'slash-2', bold: false }, { text: '420ms', bold: false }]);
  expect(labelLines({ index: 2, baseName: null, displayName: '2', ms: 420 }, all).map(l => l.text)).toEqual(['2', '420ms']);
  expect(labelLines({ index: 2, baseName: null, displayName: '2', ms: 0 }, { ...all, showIndex: false, showMs: true }).map(l => l.text)).toEqual(['0ms']);
});
test('label box size', () => {
  const b = labelBox([{ text: '2', bold: true }, { text: '420ms', bold: false }], 14, l => l.text.length * 8);
  expect(b).toEqual({ width: 48, height: 2 * 18 + 8, padding: 4, lineHeight: 18 });
});
test('log json and txt', () => {
  // 3 frame ở 2000, 2420, 2420ms; relativeMs bật; 1 trang
  const log = buildExportLog(/* dựng từ numberFrames + computeLayout(3, s) */);
  expect(log.totalMs).toBe(420); expect([log.firstSourceMs, log.lastSourceMs]).toEqual([2000, 2420]);
  expect(log.frames[1]).toEqual({ index: 2, name: '2', ms: 420, deltaMs: 420, sourceMs: 2420, page: 1, row: 0, col: 1 });
  const txt = formatLogTxt(log);
  expect(txt).toMatch(/^# \| Name \| ms \| \+Δms \| Source ms \| Page$/m);
  expect(txt).toContain('1 | 1 | 0 | — | 2000 | 1');
  expect(txt).toContain('3 | 3 | 420 | +0 | 2420 | 1');
  expect(txt).toContain('Total: 420ms (source 2000 → 2420)');
});
```

Phần đầu TXT gồm các dòng `Video:`, `FPS:` (ghi `(VFR)` khi isVfr), `Size:`, `Frames:`, `Pages:`, `Cell:`, `Time mode: relative (first frame = 0)` hoặc `source`, `Total:`; sau đó một dòng trống và bảng như test.

- [ ] **Step 2:** `npx vitest run test/core` → FAIL.
- [ ] **Step 3:** Cài đặt. `lineHeight = round(1.25 × fontSize)`; `width = max(measure) + 2·padding`; `height = lines × lineHeight + 2·padding`.
- [ ] **Step 4:** `npx vitest run test/core` → PASS.
- [ ] **Step 5:** Commit `feat(core): page layout, labels and export log`.

---

### Task 4: Video mẫu và ffprobe

**Files:**
- Create: `scripts/make-fixtures.ts`, `test/global-setup.ts`, `test/helpers/decodeIndex.ts`, `src/core/fbproj.ts` (chỉ `VideoSource` và `ffmpegInput`), `src/main/ffmpeg/paths.ts`, `src/main/ffmpeg/probe.ts`
- Test: `test/main/probe.test.ts`

**Interfaces:**
- Consumes: `VideoInfo` (Task 2), `VideoSource`/`ffmpegInput` (khai báo ở Task 6; task này tạm dùng `{ kind: 'file'; path }` và đặt `VideoSource` + `ffmpegInput` luôn vào `src/core/fbproj.ts`).
- Produces:
  ```ts
  type VideoSource = { kind: 'file'; path: string } | { kind: 'zipEntry'; zipPath: string; start: number; end: number; fileName: string }
  function ffmpegInput(src: VideoSource): string   // file → path; zipEntry → `subfile,,start,${start},end,${end},,:${zipPath}`
  function ffmpegPaths(): { ffmpeg: string; ffprobe: string }  // process.resourcesPath/ffmpeg khi đóng gói → FC_FFMPEG_DIR → PATH
  function probeVideo(src: VideoSource): Promise<VideoInfo>
  function readPtsTable(src: VideoSource): Promise<number[]>  // packet pts_time của stream v:0, sắp tăng, bỏ trùng
  function needsProxy(info: VideoInfo): boolean               // codec ∉ {h264, vp8, vp9, av1}
  function decodeIndex(png: Buffer, rotation?: 0 | 90): Promise<number>  // test helper
  const FIXTURES: Record<'cfr30'|'vfr'|'offset_bframes'|'rotated'|'hevc', string> // đường dẫn tuyệt đối
  ```

Video mẫu (sinh vào `test/fixtures/gen/` nếu chưa có). Lệnh gốc cho `cfr30.mp4` (640×360, 30fps, 3s), đã thử với ffmpeg 9:

```
ffmpeg -y -f lavfi -i color=c=0x404040:s=640x360:r=30:d=3 -vf "format=yuv420p,geq=lum='if(lt(Y,H/4),255*mod(floor(N/pow(2,floor(X*8/W))),2),64)':cb=128:cr=128,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='%{frame_num}':x=20:y=H/2:fontsize=96:fontcolor=white" -c:v libx264 -bf 0 -g 30 -crf 12 cfr30.mp4
```

- `offset_bframes.mp4`: như trên nhưng `-bf 3 -output_ts_offset 1.5`.
- `vfr.mp4`: 60 frame, thêm `setpts='(N*33+mod(N\,4)*7)/1000/TB'` vào đầu chuỗi lọc, `-fps_mode passthrough`.
- `rotated.mp4`: `ffmpeg -display_rotation 90 -i cfr30.mp4 -c copy rotated.mp4`.
- `hevc.mkv`: như cfr30 với `-c:v libx265`.

`decodeIndex`: đọc PNG bằng @napi-rs/canvas, lấy độ sáng tại tâm 8 ô ở `y = H/8`, `x = (b+0.5)·W/8`, ngưỡng 128, bit b có trọng số `2^b`. Với `rotation 90` thì dải ô nằm dọc mép phải sau khi xoay; helper xoay ảnh về −90° trước khi đọc.

- [ ] **Step 1: Viết test thất bại**

```ts
test('probe cfr', async () => {
  const v = await probeVideo({ kind: 'file', path: FIXTURES.cfr30 });
  expect(v).toMatchObject({ fileName: 'cfr30.mp4', codec: 'h264', width: 640, height: 360, rotation: 0, fps: 30, isVfr: false, frameCount: 90 });
  expect(v.durationMs).toBeGreaterThanOrEqual(2990);
});
test('pts table: offset start and b-frames are sorted', async () => {
  const pts = await readPtsTable({ kind: 'file', path: FIXTURES.offset_bframes });
  expect(pts).toHaveLength(90); expect(pts[0]).toBeCloseTo(1.5, 6);
  expect(frameMs(pts, 36)).toBe(1200);
});
test('vfr detected', async () => {
  const v = await probeVideo({ kind: 'file', path: FIXTURES.vfr });
  expect(v.isVfr).toBe(true);
  const pts = await readPtsTable({ kind: 'file', path: FIXTURES.vfr });
  expect(frameMs(pts, 3)).toBe(3 * 33 + 3 * 7);
});
test('rotated video reports display size', async () => {
  expect(await probeVideo({ kind: 'file', path: FIXTURES.rotated })).toMatchObject({ width: 360, height: 640, rotation: 90 });
});
test('proxy decision', async () => {
  expect(needsProxy(await probeVideo({ kind: 'file', path: FIXTURES.hevc }))).toBe(true);
  expect(needsProxy(await probeVideo({ kind: 'file', path: FIXTURES.cfr30 }))).toBe(false);
});
test('unreadable file gives a clear error', async () => {
  await expect(probeVideo({ kind: 'file', path: __filename })).rejects.toThrow(/không phải video|no video stream/i);
});
```

- [ ] **Step 2:** `npx vitest run test/main/probe.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt. `probeVideo` dùng `ffprobe -v error -print_format json -show_streams -show_format`; `rotation` lấy từ side data "Display Matrix" (ffprobe báo −90 nghĩa là xoay 90 theo chiều kim đồng hồ khi hiển thị; chuẩn hóa về 0/90/180/270), đổi chỗ width/height khi 90/270; `fps` = `avg_frame_rate`; `isVfr` khi `r_frame_rate ≠ avg_frame_rate` hoặc khoảng cách PTS lệch nhau quá 1ms; `startTimeSec` = `format.start_time`. `readPtsTable` dùng `-show_entries packet=pts_time -of csv=p=0`. Spawn với mảng tham số (không qua shell) để đường dẫn Unicode đi nguyên vẹn.
- [ ] **Step 4:** `npx vitest run test/main/probe.test.ts` → PASS (lần đầu sinh fixture mất vài giây).
- [ ] **Step 5:** Commit `feat(media): ffprobe video info and PTS table with fixtures`.

---

### Task 5: Trích đúng frame bằng ffmpeg

**Files:**
- Create: `src/main/ffmpeg/extract.ts`
- Test: `test/main/extract.test.ts`

**Interfaces:**
- Consumes: `VideoSource`, `ffmpegInput`, `ffmpegPaths`, `readPtsTable`, `FIXTURES`, `decodeIndex`.
- Produces:
  ```ts
  class FrameMismatchError extends Error { expectedSec: number; gotSec: number | null }
  function extractFrame(src: VideoSource, ptsSec: number, startTimeSec: number, region: Rect | null, outPng: string): Promise<void>
  ```

Lệnh (đã thử, spec mục 14): `ffmpeg -v info -hide_banner -copyts -ss <max(0, ptsSec − startTimeSec − 3)> -i <input> -vf "select='gte(t\,<ptsSec − 0.0001>)',showinfo[,crop=w:h:x:y]" -frames:v 1 -y <outPng>`. Lấy `pts_time:` **đầu tiên** trong stderr; lệch khỏi `ptsSec` quá 0.0005 thì xóa file ra và ném `FrameMismatchError`. ffmpeg tự xoay theo metadata trước bộ lọc, nên `crop` nhận toạ độ hình đã xoay. Ghi ra file tạm cạnh `outPng` rồi đổi tên.

- [ ] **Step 1: Viết test thất bại**

```ts
test.each(['cfr30', 'offset_bframes', 'vfr'] as const)('%s: every 7th frame decodes to its index', async (name) => {
  const src = { kind: 'file', path: FIXTURES[name] } as const;
  const pts = await readPtsTable(src); const info = await probeVideo(src);
  for (let i = 0; i < pts.length; i += 7) {
    const out = tmpPng(); await extractFrame(src, pts[i], info.startTimeSec, null, out);
    expect(await decodeIndex(readFileSync(out))).toBe(i);
  }
});
test('region crops the full-resolution frame', async () => {
  // vùng nửa trái, chứa ô bit 0..3
  const out = tmpPng(); await extractFrame(cfrSrc, cfrPts[5], 0, { x: 0, y: 0, w: 320, h: 180 }, out);
  const img = await loadImage(out); expect([img.width, img.height]).toEqual([320, 180]);
});
test('rotated video is captured upright', async () => {
  const out = tmpPng(); await extractFrame(rotSrc, rotPts[10], 0, null, out);
  const img = await loadImage(out); expect([img.width, img.height]).toEqual([360, 640]);
  expect(await decodeIndex(readFileSync(out), 90)).toBe(10);
});
test('pts not in video → mismatch, no file left', async () => {
  const out = tmpPng();
  await expect(extractFrame(cfrSrc, 99, 0, null, out)).rejects.toBeInstanceOf(FrameMismatchError);
  expect(existsSync(out)).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run test/main/extract.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt `extractFrame` theo lệnh ở trên.
- [ ] **Step 4:** `npx vitest run test/main/extract.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(media): exact frame extraction verified by showinfo`.

---

### Task 6: File `.fbproj`

**Files:**
- Modify: `src/core/fbproj.ts`
- Test: `test/core/fbproj.test.ts`

**Interfaces:**
- Consumes: `ProjectFile`, `VideoSource`, `extractFrame` (để test đọc video trong zip).
- Produces:
  ```ts
  class DiskFullError extends Error { neededBytes: number; freeBytes: number }
  class InvalidProjectError extends Error {}
  interface FbprojReader { path: string; project: ProjectFile; video: VideoSource & { kind: 'zipEntry' };
    readFrame(id: string): Promise<Buffer>; extractFramesTo(dir: string): Promise<void>;
    openVideoRange(start: number, endInclusive: number): Readable; close(): Promise<void> }
  function openFbproj(path: string): Promise<FbprojReader>
  function writeFbproj(target: string, a: { project: ProjectFile; video: VideoSource; framesDir: string },
    onProgress?: (written: number, total: number) => void): Promise<void>
  ```

`openFbproj`: yauzl `lazyEntries`, `autoClose: false`. Vị trí dữ liệu entry video = `relativeOffsetOfLocalHeader + 30 + nameLen + extraLen` đọc từ local header (đã thử với zip store ở bước khảo sát). `openVideoRange` dùng `entry` + `openReadStream({ start, end })`. Entry nén hoặc thiếu `project.json` → `InvalidProjectError`. `formatVersion` khác 1 → `InvalidProjectError` có thông báo phiên bản.

`writeFbproj`: yazl, mọi entry `compress: false`, `forceZip64Format` khi video > 4GB; ghi `<target>.tmp-<random>` trong cùng thư mục; trước khi ghi so `fs.promises.statfs` với tổng kích thước + 10MB, thiếu thì ném `DiskFullError` và không tạo file; lỗi giữa chừng (kể cả ENOSPC) thì xóa file tạm, file đích giữ nguyên; xong thì `rename` đè. Nguồn video `zipEntry` được đọc lại theo khoảng byte, không giải nén.

- [ ] **Step 1: Viết test thất bại**

```ts
test('round trip keeps project, frames and video bytes', async () => {
  await writeFbproj(target, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir });
  const r = await openFbproj(target);
  expect(r.project).toEqual(project);
  expect(await r.readFrame('f1')).toEqual(readFileSync(join(framesDir, 'f1.png')));
  expect(await streamToBuffer(r.openVideoRange(r.video.start, r.video.end - 1))).toEqual(readFileSync(FIXTURES.cfr30));
  expect(await streamToBuffer(r.openVideoRange(r.video.start + 100, r.video.start + 199))).toHaveLength(100);
  await r.close();
});
test('all entries stored, not deflated', async () => { /* đọc bằng yauzl, mọi entry.compressionMethod === 0 */ });
test('ffmpeg reads the video inside the project (unicode path)', async () => {
  const t = join(tmp, 'Thư mục có dấu', 'dự án.fbproj');
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir });
  const r = await openFbproj(t); const out = tmpPng();
  await extractFrame(r.video, cfrPts[12], 0, null, out);
  expect(await decodeIndex(readFileSync(out))).toBe(12); await r.close();
});
test('resave from zip source onto the same path', async () => {
  const r = await openFbproj(target);
  await writeFbproj(target + '.2', { project, video: r.video, framesDir }); await r.close();
  expect((await openFbproj(target + '.2')).project).toEqual(project);
});
test('failure mid-write leaves original untouched and no temp file', async () => {
  const before = readFileSync(target);
  await expect(writeFbproj(target, { project, video: { kind: 'file', path: 'missing.mp4' }, framesDir })).rejects.toThrow();
  expect(readFileSync(target)).toEqual(before);
  expect(readdirSync(dirname(target)).filter(n => n.includes('.tmp-'))).toEqual([]);
});
test('not enough disk → DiskFullError before writing', async () => { /* mock statfs trả bavail nhỏ */ });
test('rejects non-project zip', async () => { await expect(openFbproj(randomZip)).rejects.toBeInstanceOf(InvalidProjectError); });
```

- [ ] **Step 2:** `npx vitest run test/core/fbproj.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** `npx vitest run test/core/fbproj.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(core): fbproj stored zip read/write with safe save`.

---

### Task 7: Vẽ ảnh và xuất flipbook

**Files:**
- Create: `src/core/image.ts`, `src/core/export.ts`
- Test: `test/core/image.test.ts`, `test/core/export.test.ts`

**Interfaces:**
- Consumes: Task 2, 3 (`numberFrames`, `exportTimes`, `computeLayout`, `cellPosition`, `labelLines`, `labelBox`, `buildExportLog`, `formatLogTxt`).
- Produces:
  ```ts
  function cropImage(png: Buffer, crop: Rect | null): Promise<Image | Canvas>
  function drawFitted(ctx: SKRSContext2D, img: Image | Canvas, cell: Rect, fit: ExportSettings['fit']): void
  function drawLabel(ctx: SKRSContext2D, lines: LabelLine[], cell: Rect, fontSize: number): void   // góc trên phải
  function resizeToMax(png: Buffer, maxSize: number): Promise<Buffer>  // giữ tỉ lệ, không phóng to
  interface ExportRequest { projectName: string; video: VideoInfo; frames: FrameRecord[]; readFrame: (id: string) => Promise<Buffer>;
    settings: ExportSettings; outDir: string; fileName: string }
  interface ExportResult { pages: string[]; logTxt: string; logJson: string }
  function exportFlipbook(r: ExportRequest): Promise<ExportResult>   // ném lỗi LayoutError dạng Error có .layoutError
  ```

Font: `GlobalFonts.registerFromPath('C:/Windows/Fonts/arial.ttf', 'FC Arial')` và `arialbd.ttf` (bold). Nền ô và nền trang đen (`#000`). Ô vẽ ở `cellPosition`. "cover" cắt mép đều hai bên; "contain" căn giữa. Tên file: `<fileName>_p<N>.png`, `<fileName>_log.txt`, `<fileName>_log.json`. Ghi xong mọi file mới trả về (ghi tạm rồi đổi tên từng file).

- [ ] **Step 1: Viết test thất bại**

```ts
test('crop applied before fitting', async () => {
  const c = await cropImage(png640x360, { x: 0, y: 0, w: 320, h: 180 }); expect([c.width, c.height]).toEqual([320, 180]);
});
test('resizeToMax', async () => {
  const b = await resizeToMax(png3000x1000, 1568); const i = await loadImage(b); expect([i.width, i.height]).toEqual([1568, 523]);
  expect(await resizeToMax(png640x360, 1568)).toEqual(png640x360);
});
test('export writes pages, logs and labels', async () => {
  const r = await exportFlipbook({ ...req, frames: tenFramesFromCfr30, fileName: 'slash' });
  expect(r.pages.map(p => basename(p))).toEqual(['slash_p1.png']);
  const page = await loadImage(r.pages[0]); expect([page.width, page.height]).toEqual([1036, 776]);
  const log = JSON.parse(readFileSync(r.logJson, 'utf8')) as ExportLog;
  expect(log.frames).toHaveLength(10); expect(log.frames[0]).toMatchObject({ ms: 0, deltaMs: null, page: 1, row: 0, col: 0 });
  // nhãn: góc trên phải ô đầu có pixel trắng và nền tối, góc trên trái không có
  expect(maxLuma(page, { x: 256 - 30, y: 2, w: 28, h: 20 })).toBeGreaterThan(200);
});
test('43 frames → two pages (36 + 7), cells keep size', async () => {
  const r = await exportFlipbook({ ...req, frames: fortyThreeFrames });
  expect(r.pages).toHaveLength(2); expect((await loadImage(r.pages[1])).height).toBe(516);
});
test('cell larger than max edge → error, nothing written', async () => {
  await expect(exportFlipbook({ ...req, settings: { ...DEFAULT_EXPORT, cellW: 1600 } })).rejects.toThrow(/cell-too-large/);
  expect(readdirSync(req.outDir)).toEqual([]);
});
```

- [ ] **Step 2:** `npx vitest run test/core/image.test.ts test/core/export.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** Chạy lại → PASS. Mở một `slash_p1.png` sinh ra để xem bằng mắt (Read tool) rằng nhãn rõ.
- [ ] **Step 5:** Commit `feat(core): flipbook page rendering and export files`.

---

### Task 8: Tài liệu dự án, lớp lệnh, Undo, thư mục làm việc

**Files:**
- Create: `src/shared/commands.ts`, `src/main/workspace.ts`, `src/main/document.ts`
- Test: `test/main/document.test.ts`, `test/main/workspace.test.ts`

**Interfaces:**
- Consumes: `ProjectFile`, `FrameRecord`, `frameMs`, `extractFrame` (tiêm vào, test dùng bản giả).
- Produces:
  ```ts
  // shared/commands.ts
  type DocCommand =
    | { type: 'captureFrame'; frameIndex: number; useSelection: boolean }
    | { type: 'deleteFrame'; id: string }
    | { type: 'renameFrame'; id: string; baseName: string | null }
    | { type: 'setCrop'; id: string; crop: Rect | null }
    | { type: 'setSelection'; rect: Rect | null }
    | { type: 'setExportSettings'; settings: ExportSettings }
  type PlaybackCommand =
    | { type: 'togglePlay' } | { type: 'seekMs'; ms: number } | { type: 'stepMs'; deltaMs: number }
    | { type: 'stepFrame'; delta: number } | { type: 'setSpeed'; speed: 0.1 | 0.25 | 0.5 | 1 } | { type: 'gotoFrame'; id: string }
  type CommandResult = { ok: true; frameId?: string } | { ok: false; reason: 'no-video' | 'no-selection' | 'duplicate' | 'mismatch' | 'not-found'; message: string }
  // workspace.ts
  interface SessionMeta { videoOrigin: { kind: 'file'; path: string } | { kind: 'fbproj'; path: string } | null; savedPath: string | null; dirty: boolean }
  class Workspace { static create(root: string): Promise<Workspace>; static findRecoverable(root: string): Promise<{ dir: string; meta: SessionMeta; project: ProjectFile }[]>;
    static adopt(dir: string): Workspace; readonly dir: string; readonly framesDir: string;
    write(project: ProjectFile, meta: SessionMeta): Promise<void>; dispose(): Promise<void> }
  // document.ts
  interface DocState { project: ProjectFile; dirty: boolean; canUndo: boolean; canRedo: boolean }
  class ProjectDocument extends EventEmitter /* 'changed' */ {
    constructor(o: { workspace: Workspace; pts: number[]; video: VideoInfo; source: VideoSource; project?: ProjectFile;
      extract: typeof extractFrame; newId?: () => string })
    readonly state: DocState
    execute(cmd: DocCommand): Promise<CommandResult>; undo(): void; redo(): void; markSaved(): void }
  ```

Quy tắc: `captureFrame` ghi PNG vào `workspace.framesDir/<id>.png`, `ptsSec = pts[frameIndex]`, `ms = frameMs(pts, frameIndex)`, `seq = nextSeq++`. `useSelection` mà `selection === null` → `no-selection` ("Hãy kéo chuột trên video để vẽ vùng trước khi bấm Ctrl+T."). Cùng `ptsSec` và cùng `region` (cả hai null tính là cùng) → `duplicate`, không gọi ffmpeg. `FrameMismatchError` → `mismatch`. Undo/Redo áp cho capture, delete, rename, crop; `setSelection` và `setExportSettings` làm dirty nhưng không vào lịch sử. Undo capture giữ lại file PNG để Redo. Mỗi lần đổi trạng thái gọi `workspace.write` (ghi `project.json` và `session.json` qua file tạm + đổi tên) rồi phát `changed`.

- [ ] **Step 1: Viết test thất bại**

```ts
test('capture, duplicate, second region on same frame', async () => {
  expect(await doc.execute({ type: 'captureFrame', frameIndex: 36, useSelection: false })).toMatchObject({ ok: true });
  expect(doc.state.project.frames[0]).toMatchObject({ ms: 1200, seq: 1, region: null });
  expect(await doc.execute({ type: 'captureFrame', frameIndex: 36, useSelection: false })).toMatchObject({ ok: false, reason: 'duplicate' });
  await doc.execute({ type: 'setSelection', rect: { x: 10, y: 10, w: 100, h: 50 } });
  expect(await doc.execute({ type: 'captureFrame', frameIndex: 36, useSelection: true })).toMatchObject({ ok: true });
  expect(fakeExtract).toHaveBeenCalledTimes(2);
});
test('ctrl+T without selection', async () => {
  expect(await doc.execute({ type: 'captureFrame', frameIndex: 0, useSelection: true })).toMatchObject({ ok: false, reason: 'no-selection' });
});
test('undo/redo covers capture, rename, crop, delete', async () => {
  // capture → rename 'slash' → setCrop → delete; undo 4 lần về rỗng, redo 4 lần về trạng thái cuối
});
test('dirty tracking', async () => { /* execute → dirty; markSaved → không dirty; setSelection → dirty */ });
test('workspace persists every change and is recoverable', async () => {
  await doc.execute(capture36);
  const found = await Workspace.findRecoverable(root);
  expect(found[0].project.frames).toHaveLength(1); expect(found[0].meta.dirty).toBe(true);
});
test('disposed workspace is not offered for recovery', async () => { await ws.dispose(); expect(await Workspace.findRecoverable(root)).toEqual([]); });
```

- [ ] **Step 2:** `npx vitest run test/main/document.test.ts test/main/workspace.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt. Lịch sử là hai ngăn xếp `{ do(): void; undo(): void }`; lệnh mới xóa ngăn Redo.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5:** Commit `feat(main): project document with command layer, undo and autosave`.

---

### Task 9: Proxy H.264

**Files:**
- Create: `src/main/ffmpeg/proxy.ts`
- Test: `test/main/proxy.test.ts`

**Interfaces:**
- Consumes: `ffmpegInput`, `ffmpegPaths`, `readPtsTable`, `probeVideo`.
- Produces:
  ```ts
  function proxyCachePath(cacheDir: string, key: string): string  // key = sha1(fileName + size + mtime) hoặc sha1(fbproj path + entry start + size)
  function makeProxy(src: VideoSource, out: string, o: { durationMs: number; onProgress?: (f: number) => void; signal?: AbortSignal }): Promise<void>
  ```

Lệnh: `ffmpeg -v error -copyts -i <input> -map 0:v:0 -an -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -fps_mode passthrough -progress pipe:1 -y <out.tmp.mp4>`; tiến độ = `out_time_us / (durationMs·1000)`. Hủy → kill tiến trình, xóa file tạm, ném `AbortError`. Xong → đổi tên.

- [ ] **Step 1: Viết test thất bại**

```ts
test('proxy keeps source PTS', async () => {
  for (const name of ['hevc', 'vfr'] as const) {
    const src = { kind: 'file', path: FIXTURES[name] } as const; const out = tmpMp4();
    await makeProxy(src, out, { durationMs: 3000 });
    const a = await readPtsTable(src); const b = await readPtsTable({ kind: 'file', path: out });
    expect(b.length).toBe(a.length); b.forEach((t, i) => expect(t).toBeCloseTo(a[i], 3));
    expect((await probeVideo({ kind: 'file', path: out })).codec).toBe('h264');
  }
});
test('progress reported and reaches 1', async () => { /* onProgress nhận dãy tăng, giá trị cuối ≥ 0.99 */ });
test('cancel removes partial file', async () => {
  const ac = new AbortController(); const p = makeProxy(hevcSrc, out, { durationMs: 3000, signal: ac.signal, onProgress: () => ac.abort() });
  await expect(p).rejects.toThrow(/abort/i); expect(readdirSync(dirname(out))).toEqual([]);
});
```

- [ ] **Step 2:** `npx vitest run test/main/proxy.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5:** Commit `feat(media): H.264 playback proxy that preserves timestamps`.

---

### Task 10: Nối main process — giao thức video, phiên dự án, IPC, menu

**Files:**
- Create: `src/main/media-protocol.ts`, `src/main/session.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/shared/ipc.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `test/main/media-protocol.test.ts`, `test/main/session.test.ts`, `playwright.config.ts`, `e2e/helpers.ts`, `e2e/project.spec.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 4–9.
- Produces:
  ```ts
  // media-protocol.ts
  function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null
  function registerMediaSchemes(): void            // gọi trước app.ready: fbvideo, fbwork với { standard, secure, stream, supportFetchAPI }
  function installMediaHandlers(get: () => { video: VideoSource | null; proxyPath: string | null; framesDir: string | null }): void
  // fbvideo://current/?v=<n> → 206 + Content-Range/Accept-Ranges/Content-Type, 416 khi range sai
  // fbwork://frames/<id>.png → PNG trong framesDir
  // session.ts
  type Ask = (kind: 'unsaved' | 'replaceVideo' | 'recover', detail?: string) => Promise<'save' | 'discard' | 'cancel' | 'yes' | 'no'>
  class ProjectSession extends EventEmitter /* 'state', 'toast', 'progress' */ {
    constructor(o: { workRoot: string; cacheDir: string; ask: Ask; pickSavePath: () => Promise<string | null>; pickOpenPath: () => Promise<string | null>;
      pickVideoPath: () => Promise<string | null>; releaseVideo: () => Promise<void> })
    readonly doc: ProjectDocument | null; readonly filePath: string | null
    newProject(): Promise<void>; open(path?: string): Promise<void>; importVideo(path?: string): Promise<void>
    save(): Promise<boolean>; saveAs(): Promise<boolean>; confirmClose(): Promise<boolean>; recoverOnStartup(): Promise<void> }
  // shared/ipc.ts
  interface RendererState { filePath: string | null; projectName: string; dirty: boolean; canUndo: boolean; canRedo: boolean;
    project: ProjectFile | null; video: { url: string; pts: number[]; info: VideoInfo } | null; busy: { label: string; progress: number; cancellable: boolean } | null }
  interface FcApi { getState(): Promise<RendererState>; onState(cb: (s: RendererState) => void): () => void;
    execute(c: DocCommand): Promise<CommandResult>; undo(): void; redo(): void;
    onPlayback(cb: (c: PlaybackCommand) => void): () => void; onMenu(cb: (m: 'export' | 'connectClaude') => void): () => void;
    onToast(cb: (t: { kind: 'info' | 'error'; text: string }) => void): () => void;
    exportFlipbook(s: ExportSettings): Promise<{ ok: true; files: string[] } | { ok: false; message: string }>;
    cancelBusy(): void; reportVideoError(): void }
  ```

Quy tắc phiên (spec mục 9 và 14):
- `open`: hỏi lưu nếu dirty; `openFbproj`, giải nén frame vào workspace mới, `probeVideo` + `readPtsTable` trên `zipEntry`, tạo proxy nếu `needsProxy`.
- `importVideo` khi đã có video: hỏi `replaceVideo`; đồng ý thì xóa hết frame. Sau New thì chỉ Import Video và Open dùng được (menu disable các mục còn lại).
- `save` khi chưa có `filePath` → `saveAs`. Khi lưu đè lên file nguồn video đang mở: ghi tạm xong → `releaseVideo()` (renderer bỏ `src`, đóng reader yauzl) → đổi tên → mở lại reader → phát `state` với `url` mới (`?v=` tăng) để renderer nạp lại và quay về frame cũ. `DiskFullError` → toast "Không đủ dung lượng đĩa: cần X, còn Y. File cũ không bị thay đổi."
- `confirmClose` cho New, Open, thoát cửa sổ: `save`/`discard`/`cancel`.
- `recoverOnStartup`: có workspace dirty → hỏi `recover`; video gốc mất → `pickVideoPath`.
- `reportVideoError` (thẻ `<video>` lỗi khi nạp) → tạo proxy dù codec nằm trong danh sách cho phép.
- Menu: File (New, Open, Save, Save As, Import Video, Export Flipbook, Exit), Edit (Undo, Redo, Xóa frame), View (0.1x, 0.25x, 0.5x, 1x dạng radio), Help (Kết nối với Claude). Phím tắt đúng Global Constraints. Thanh tiêu đề: `<tên dự án>[*] — Flipbook Capture`.
- Import Video làm dự án dirty. Dự án chưa lưu tên là `Untitled`.
- Khi `FC_E2E=1`: `globalThis.__fc = { session }` để Playwright gọi `importVideo(path)`/`open(path)` không qua hộp thoại; `ask` trả lời theo `FC_E2E_ANSWERS` (JSON); `pickSavePath` trả `FC_E2E_SAVE_PATH`; thư mục xuất mặc định lấy `FC_E2E_OUT_DIR` nếu có.

- [ ] **Step 1: Viết test thất bại**

```ts
// media-protocol.test.ts
test('parseRange', () => {
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
  expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
  expect(parseRange(null, 1000)).toBeNull();
});
// session.test.ts (ProjectSession với ask/pick giả, không cần Electron)
test('save, reopen, save over the open file while its video stream is open', async () => {
  await s.importVideo(FIXTURES.cfr30); await s.doc!.execute(capture36);
  pickSave.mockResolvedValue(join(tmp, 'dự án.fbproj')); await s.save();
  await s.open(join(tmp, 'dự án.fbproj'));
  const held = openVideoStreamFromSession(s);          // giữ một luồng đọc như trình phát
  await s.doc!.execute({ type: 'renameFrame', id: s.doc!.state.project.frames[0].id, baseName: 'slash' });
  expect(await s.save()).toBe(true);
  expect(releaseVideo).toHaveBeenCalled();
  expect((await openFbproj(join(tmp, 'dự án.fbproj'))).project.frames[0].baseName).toBe('slash');
});
test('import over existing video asks and clears frames', async () => { /* ask → 'yes' → frames = [] ; ask → 'no' → giữ nguyên */ });
test('unsaved changes: cancel keeps project open', async () => { /* ask → 'cancel' → newProject không đổi gì */ });
test('recover after crash', async () => { /* tạo session, capture, bỏ không dispose; session mới recoverOnStartup → 'yes' → có 1 frame, dirty */ });
```

```ts
// e2e/project.spec.ts
test('import video, title shows dirty marker, Ctrl+S saves', async () => {
  const { app, win } = await launch({ FC_E2E_SAVE_PATH: join(tmp, 'clip.fbproj') });
  await app.evaluate(async (_e, p) => (globalThis as any).__fc.session.importVideo(p), FIXTURES.cfr30);
  await expect(win.locator('video')).toHaveJSProperty('readyState', 4);
  await expect.poll(() => win.title()).toBe('Untitled* — Flipbook Capture');   // Import làm dự án dirty
  await win.keyboard.press('Control+S');
  await expect.poll(() => win.title()).toBe('clip — Flipbook Capture');
});
```

- [ ] **Step 2:** `npx vitest run test/main/media-protocol.test.ts test/main/session.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt các module trên; renderer tạm thời chỉ có `<video src={state.video.url}>` để e2e chạy được.
- [ ] **Step 4:** Chạy vitest → PASS. `npm run e2e -- e2e/project.spec.ts` → PASS.
- [ ] **Step 5:** Commit `feat(main): media protocol, project session, IPC and menus`.

---

### Task 11: Trình phát chính xác từng frame

**Files:**
- Create: `src/renderer/store.ts`, `src/renderer/keymap.ts`, `src/renderer/player/controller.ts`, `src/renderer/player/Player.tsx`, `src/renderer/player/Timeline.tsx`, `src/renderer/player/Transport.tsx`, `src/renderer/player/SelectionLayer.tsx`
- Test: `test/renderer/keymap.test.ts`, `e2e/player.spec.ts`

**Interfaces:**
- Consumes: `FcApi`, `RendererState`, `PlaybackCommand`, `DocCommand`, timing (`stepByMs`, `snapTimelineMs`, `seekTargetSec`, `nearestFrameIndex`, `frameMs`).
- Produces:
  ```ts
  type AppAction = { kind: 'playback'; cmd: PlaybackCommand } | { kind: 'capture'; useSelection: boolean } | { kind: 'deleteSelectedFrame' }
  function keyToAction(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; inEditable: boolean; modalOpen: boolean }): AppAction | null
  class PlayerController {
    constructor(video: HTMLVideoElement, pts: number[])
    calibrate(): Promise<void>                    // đo offsetSec = pts[0] − mediaTime của frame đầu
    readonly displayedIndex: number               // frame đã được rVFC xác nhận
    readonly targetIndex: number                  // đích đang chờ (bằng displayedIndex khi rảnh)
    execute(cmd: PlaybackCommand): Promise<void>
    pauseAndSettle(): Promise<number>             // dừng, chờ rVFC, trả displayedIndex
    verified: boolean                             // false khi lệch sau 1 lần tua lại → chặn chụp
    onChange(cb: (s: { displayedIndex: number; playing: boolean; speed: number; verified: boolean }) => void): () => void }
  ```

Quy tắc:
- Mọi bước tua tính từ `targetIndex` (không phải frame đang hiện), nên nhấn `.` 10 lần nhanh → đích +10. Các lần tua nối tiếp gộp lại: chỉ tua tới đích mới nhất, chờ `requestVideoFrameCallback`, so `nearestFrameIndex(pts, mediaTime + offsetSec)` với đích; lệch thì tua lại một lần, vẫn lệch thì `verified = false` và hiện "Không khớp frame, chưa thể chụp".
- Khi phát: mỗi callback rVFC cập nhật `displayedIndex`. Dừng (Space) → dừng tại frame đang hiện, đặt `targetIndex = displayedIndex`.
- Đổi tốc độ không dừng video; nút tốc độ đang bật được tô màu. Video luôn `muted`.
- Thời gian hiển thị `mm:ss.mmm` từ `frameMs(pts, displayedIndex)`, kèm "Đang xem <ms>ms" dưới video.
- Timeline: bấm/kéo → `snapTimelineMs(…, free = altKey)`; vạch đỏ đang xem, xanh lá các frame đã chụp, xanh dương frame đang chọn; bấm vạch xanh lá chọn frame đó (không tua).
- `SelectionLayer`: kéo chuột trên video vẽ/sửa hình chữ nhật nét đứt, đổi toạ độ màn hình → toạ độ video theo `VideoInfo.width/height` (hình đã xoay), thả chuột gửi `setSelection`.
- `keyToAction` trả `null` khi `inEditable` hoặc `modalOpen`. `T` (không Ctrl) → capture toàn khung; `Ctrl+T` → capture vùng; ←/→ ±100ms; Shift+←/→ ±1000ms; `,`/`.` ±1 frame; Space togglePlay; Delete → xóa frame đang chọn.

- [ ] **Step 1: Viết test thất bại**

```ts
// keymap.test.ts
const k = (key, o = {}) => keyToAction({ key, ctrlKey: false, shiftKey: false, altKey: false, inEditable: false, modalOpen: false, ...o });
test('keys', () => {
  expect(k('ArrowRight')).toEqual({ kind: 'playback', cmd: { type: 'stepMs', deltaMs: 100 } });
  expect(k('ArrowLeft', { shiftKey: true })).toEqual({ kind: 'playback', cmd: { type: 'stepMs', deltaMs: -1000 } });
  expect(k('.')).toEqual({ kind: 'playback', cmd: { type: 'stepFrame', delta: 1 } });
  expect(k('t')).toEqual({ kind: 'capture', useSelection: false });
  expect(k('T', { shiftKey: true })).toEqual({ kind: 'capture', useSelection: false });
  expect(k('t', { ctrlKey: true })).toEqual({ kind: 'capture', useSelection: true });
  expect(k(' ')).toEqual({ kind: 'playback', cmd: { type: 'togglePlay' } });
});
test('typing in a field or dialog never triggers shortcuts', () => {
  expect(k('t', { inEditable: true })).toBeNull(); expect(k('ArrowRight', { modalOpen: true })).toBeNull();
});
```

```ts
// e2e/player.spec.ts — readDisplayed(): vẽ <video> lên canvas trong renderer rồi giải mã dải bit
test.each(['cfr30', 'offset_bframes', 'vfr'])('%s: frame steps land exactly', async (name) => {
  await importVideo(FIXTURES[name]);
  await expect(win.getByTestId('time')).toHaveText('00:00.000');
  for (let i = 0; i < 10; i++) await win.keyboard.press('.');      // nhấn liên tục, không chờ
  await expect.poll(() => readDisplayed(win)).toBe(10);
  await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(ptsOf(name), 10)));
  await win.keyboard.press('ArrowRight');                           // +100ms
  await expect.poll(() => readDisplayed(win)).toBe(stepByMs(ptsOf(name), 10, 100));
});
test('play at 0.1x then pause shows a verified frame matching the clock', async () => {
  await win.getByRole('button', { name: '0.1x' }).click(); await win.keyboard.press(' ');
  await win.waitForTimeout(1500); await win.keyboard.press(' ');
  const shown = await readDisplayed(win);
  await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(cfrPts, shown)));
});
test('timeline click snaps to 100ms; alt-drag snaps to frame', async () => { /* bấm ở 41% của 3000ms → 1200ms (frame 36) */ });
```

- [ ] **Step 2:** `npx vitest run test/renderer/keymap.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt controller, component và keymap. Gắn `keydown` ở `window` (capture phase), `preventDefault` khi có action.
- [ ] **Step 4:** Vitest → PASS; `npm run e2e -- e2e/player.spec.ts` → PASS.
- [ ] **Step 5:** Commit `feat(ui): frame-accurate player, timeline and shortcuts`.

---

### Task 12: Chụp, dải frame, khung xem

**Files:**
- Create: `src/renderer/strip/FrameStrip.tsx`, `src/renderer/viewer/FrameViewer.tsx`, `src/renderer/viewer/CropBox.tsx`, `src/renderer/viewer/LabelOverlay.tsx`, `src/renderer/StatusBar.tsx`, `src/renderer/dialogs/Toast.tsx`, `src/renderer/dialogs/BusyOverlay.tsx` (hiện `RendererState.busy`: nhãn, thanh tiến trình, nút Hủy khi `cancellable` → `cancelBusy()`)
- Modify: `src/renderer/App.tsx` (bố cục B3), `src/renderer/store.ts`
- Test: `e2e/capture.spec.ts`

**Interfaces:**
- Consumes: `PlayerController.pauseAndSettle`, `verified`, `keyToAction`, `FcApi.execute/undo/redo`, `numberFrames`, `labelLines`, `labelBox`, `DEFAULT_EXPORT`.
- Produces: store field `selectedFrameId: string | null`; `data-testid`: `strip-item` (mỗi ô), `viewer-label`, `time`, `toast`.

Quy tắc:
- Luồng chụp: action `capture` → `pauseAndSettle()` → nếu `!verified` thì toast lỗi → `execute({ type: 'captureFrame', frameIndex, useSelection })` → kết quả `ok:false` hiện toast với `message`. Chụp xong chọn frame mới.
- Dải frame dùng `numberFrames`; mỗi ô có ảnh nhỏ (`fbwork://frames/<id>.png`, áp crop bằng CSS `object-view-box` hoặc canvas), số, tên hiển thị, ms. Tự cuộn tới frame đang chọn.
- Khung xem: ảnh (đã crop) + `LabelOverlay` dùng `labelLines`/`labelBox` với cài đặt xuất hiện tại, đo chữ bằng canvas cùng font "Arial"; tỉ lệ nhãn theo tỉ lệ hiển thị so với ô xuất. Ô nhập Đặt tên (Enter lưu, rỗng → null). Crop: bật `CropBox` trên ảnh gốc chưa crop, kéo 4 góc, Enter/nút Áp dụng gửi `setCrop`, nút Bỏ crop gửi `null`. "Tới ms này" → `gotoFrame`. Xóa → `deleteFrame`.
- Thanh trạng thái: trái `T: chụp · Ctrl+T: chụp vùng · ←/→ ±100ms · , . từng frame`, phải tên dự án + `*` khi dirty.
- Không có nút chụp hay nút xuất trên màn hình.

- [ ] **Step 1: Viết test e2e thất bại**

```ts
test('T captures exactly the displayed frame, also while playing', async () => {
  await importVideo(FIXTURES.offset_bframes);
  for (let i = 0; i < 37; i++) await win.keyboard.press('.');
  await win.keyboard.press('t');
  await expect(win.getByTestId('strip-item')).toHaveCount(1);
  expect(await decodeIndex(await capturedPng(app, 0))).toBe(37);
  await expect(win.getByTestId('strip-item').first()).toContainText('1233ms');
  await win.keyboard.press(' '); await win.waitForTimeout(400); await win.keyboard.press('t');   // đang phát
  const shown = await readDisplayed(win);
  expect(await decodeIndex(await capturedPng(app, 1))).toBe(shown);
});
test('Ctrl+T without selection shows hint; with selection captures region', async () => {
  await win.keyboard.press('Control+t'); await expect(win.getByTestId('toast')).toContainText('vẽ vùng');
  await dragOnVideo(win, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }); await win.keyboard.press('Control+t');
  expect(await pngSize(await capturedPng(app, 1))).toEqual([320, 180]);
});
test('rotated video: region drawn on screen matches captured region', async () => {
  await importVideo(FIXTURES.rotated); await dragOnVideo(win, { x: 0, y: 0 }, { x: 1, y: 0.5 }); await win.keyboard.press('Control+t');
  expect(await pngSize(await capturedPng(app, 0))).toEqual([360, 320]);
});
test('duplicate capture is skipped with a notice', async () => { /* T hai lần cùng frame → 1 ô, toast */ });
test('rename, crop, delete, undo, redo, goto', async () => {
  // đặt tên 'slash' → ô hiện 'slash-1'; crop → nhãn khung xem vẫn ở góc trên phải; Delete → 0 ô; Ctrl+Z → 1 ô; Ctrl+Y → 0 ô
  // chụp ở frame 10, tua tới frame 50, bấm "Tới ms này" → readDisplayed = 10
});
test('typing T in the name field does not capture', async () => { /* focus ô tên, gõ 'tt' → số ô không đổi */ });
```

- [ ] **Step 2:** `npm run e2e -- e2e/capture.spec.ts` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** Chạy lại → PASS; chạy thêm `e2e/project.spec.ts` và `e2e/player.spec.ts` → vẫn PASS.
- [ ] **Step 5:** Commit `feat(ui): capture flow, frame strip and frame viewer`.

---

### Task 13: Hộp thoại Export Flipbook

**Files:**
- Create: `src/renderer/dialogs/ExportDialog.tsx`, `src/renderer/dialogs/exportForm.ts`
- Modify: `src/main/ipc.ts` (handler `exportFlipbook` gọi `core/export.ts`)
- Test: `test/renderer/exportForm.test.ts`, `e2e/export.spec.ts`

**Interfaces:**
- Consumes: `computeLayout`, `exportWarnings`, `ExportSettings`, `FcApi.exportFlipbook`, `setExportSettings`.
- Produces: `function aspectLockedHeight(cellW: number, video: VideoInfo): number` trong `exportForm.ts` = `round(cellW × height / width)`.

Quy tắc: các trường và mặc định đúng bảng spec mục 10 (thư mục mặc định = thư mục chứa `.fbproj`, chưa lưu thì Documents; tên = tên dự án, chưa lưu thì "flipbook"). Xem trước "N trang · C cột" cập nhật khi gõ. `LayoutError` → hiện lỗi, nút Xuất bị khóa. Cảnh báo hiện màu vàng, vẫn cho xuất. Mở bằng Ctrl+E / File > Export Flipbook; không có frame → toast "Chưa có frame nào để xuất". Xuất xong: lưu cài đặt vào dự án (`setExportSettings`), toast có đường dẫn file đầu tiên.

- [ ] **Step 1: Viết test thất bại**

```ts
test('aspect lock', () => { expect(aspectLockedHeight(256, { width: 640, height: 360 } as VideoInfo)).toBe(144); });
```

```ts
// e2e/export.spec.ts
test('export 10 frames with defaults', async () => {
  await importVideo(FIXTURES.cfr30); await captureEvery(win, 3, 10);   // 10 frame cách nhau 3 frame
  await win.keyboard.press('Control+e');
  await expect(win.getByTestId('export-preview')).toHaveText('1 trang · 4 cột');
  await win.getByLabel('Cỡ chữ').fill('11'); await expect(win.getByTestId('export-warning')).toContainText('Claude có thể không đọc rõ');
  await win.getByLabel('Cỡ chữ').fill('14'); await win.getByRole('button', { name: 'Xuất' }).click();
  const log = JSON.parse(readFileSync(join(outDir, 'flipbook_log.json'), 'utf8'));
  expect(log.frames.map(f => f.sourceMs)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  expect(existsSync(join(outDir, 'flipbook_p1.png'))).toBe(true);
});
test('cell wider than max edge blocks export', async () => { /* rộng 1600 → nút Xuất disabled, có thông báo lỗi */ });
```

- [ ] **Step 2:** Chạy vitest và e2e → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** Chạy lại → PASS. Đọc ảnh `flipbook_p1.png` sinh ra bằng Read tool để tự kiểm nhãn đọc được.
- [ ] **Step 5:** Commit `feat(ui): export flipbook dialog`.

---

### Task 14: MCP server chỉ đọc

**Files:**
- Create: `src/mcp/server.ts`, `src/mcp/tools.ts`, `vite.mcp.config.ts`
- Test: `test/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `openFbproj`, `numberFrames`, `cropImage`, `resizeToMax`, `ExportLog`.
- Produces:
  ```ts
  function parseRoots(argv: string[]): string[]                // các giá trị --root, chuẩn hóa tuyệt đối; rỗng → lỗi khi khởi động
  function createServer(roots: string[]): McpServer            // name 'flipbook-capture'
  function resolveInsideRoots(roots: string[], p: string): string   // ném lỗi "Đường dẫn nằm ngoài thư mục gốc"
  ```

Tool (đúng tên spec mục 11): `list_projects()` → `[{ path, name, frameCount, video }]` quét đệ quy `*.fbproj`, bỏ `node_modules` và thư mục ẩn, tối đa sâu 6; `list_exports()` → `[{ logPath, project, frameCount, pageCount, pages }]` từ `*_log.json`; `get_project(path)` → JSON `{ video, frames: [{ index, name, ms, region, crop }] }`; `get_flipbook(log_path)` → nội dung text là log JSON + mỗi trang một `image` (base64 PNG, trả nguyên); `get_frame(project_path, index, max_size = 1568)` → ảnh đã crop rồi `resizeToMax`. `index` 1-based theo `numberFrames`; ngoài khoảng → lỗi rõ ràng. Mọi đường dẫn qua `resolveInsideRoots` (so sánh sau `realpath`, không phân biệt hoa thường). Không ghi file nào.

Build: `vite.mcp.config.ts` build `src/mcp/server.ts` thành một file `out/mcp/server.cjs` gộp mọi thư viện JS, chỉ để `@napi-rs/canvas` là external.

- [ ] **Step 1: Viết test thất bại** (client trong bộ nhớ bằng `InMemoryTransport.createLinkedPair()` của SDK)

```ts
test('lists projects and exports under roots', async () => {
  const r = await call('list_projects', {});
  expect(r.map(p => basename(p.path))).toEqual(['dự án.fbproj']);
  expect((await call('list_exports', {}))[0]).toMatchObject({ frameCount: 3, pageCount: 1 });
});
test('get_flipbook returns pages as images plus log', async () => {
  const res = await client.callTool({ name: 'get_flipbook', arguments: { log_path: logPath } });
  expect(res.content.filter(c => c.type === 'image')).toHaveLength(1);
  expect(JSON.parse(res.content.find(c => c.type === 'text').text).frames).toHaveLength(3);
});
test('get_frame applies crop and max_size', async () => {
  const res = await client.callTool({ name: 'get_frame', arguments: { project_path: proj, index: 2, max_size: 100 } });
  const img = await loadImage(Buffer.from(res.content[0].data, 'base64'));
  expect(Math.max(img.width, img.height)).toBe(100);           // frame 2 có crop 320×180 → 100×56
  expect(img.height).toBe(56);
});
test('rejects paths outside roots', async () => {
  const res = await client.callTool({ name: 'get_project', arguments: { path: 'C:/Windows/win.ini' } });
  expect(res.isError).toBe(true); expect(res.content[0].text).toContain('ngoài thư mục gốc');
});
test('never writes', async () => { /* chụp mtime + danh sách file của root trước/sau mọi lời gọi → bằng nhau */ });
```

- [ ] **Step 2:** `npx vitest run test/mcp` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** `npx vitest run test/mcp` → PASS. Build `npx vite build -c vite.mcp.config.ts`, rồi chạy thử bằng Node: `node out/mcp/server.cjs --root <thư mục test>` với một thông điệp `initialize` + `tools/list` qua stdin → thấy 5 tool.
- [ ] **Step 5:** Commit `feat(mcp): read-only MCP server for projects and flipbooks`.

---

### Task 15: Đóng gói và "Kết nối với Claude"

**Files:**
- Create: `scripts/vendor-ffmpeg.ps1`, `electron-builder.yml`, `src/renderer/dialogs/ConnectClaudeDialog.tsx`
- Modify: `package.json` (script `dist`), `src/main/ipc.ts` (trả `{ exePath, serverPath, roots }`)
- Test: `test/main/connect-command.test.ts`

**Interfaces:**
- Produces: `function claudeAddCommand(a: { exePath: string; serverPath: string; roots: string[] }): string` trong `src/main/connect.ts`.

Quy tắc:
- `vendor-ffmpeg.ps1 [-From <dir>]`: chép `ffmpeg.exe` và `ffprobe.exe` từ `-From` (mặc định thư mục chứa `ffmpeg` trên PATH) vào `vendor/ffmpeg/`, in phiên bản, báo lỗi nếu build thiếu `libx264`.
- `electron-builder.yml`: appId `dev.kiezroth.flipbookcapture`, productName `Flipbook Capture`, `win.target: nsis` x64, `extraResources: vendor/ffmpeg → ffmpeg`, thêm `out/mcp/server.cjs` vào `extraResources` dưới `mcp/server.cjs`, `asarUnpack: node_modules/@napi-rs/**`.
- Lệnh hiện trong hộp thoại (người dùng sửa được danh sách thư mục gốc, mặc định thư mục của dự án đang mở hoặc Documents), có nút Chép:

```
claude mcp add flipbook-capture -e ELECTRON_RUN_AS_NODE=1 -- "<exePath>" "<resources>\mcp\server.cjs" --root "<dir1>" --root "<dir2>"
```

  Nếu server cần `@napi-rs/canvas` nằm trong `app.asar.unpacked`, `server.cjs` đặt `module.paths` tới `<resources>\app.asar.unpacked\node_modules` trước khi `require`.

- [ ] **Step 1: Viết test thất bại**

```ts
test('command quotes paths with spaces and repeats --root', () => {
  expect(claudeAddCommand({ exePath: 'C:\\Program Files\\Flipbook Capture\\Flipbook Capture.exe',
    serverPath: 'C:\\Program Files\\Flipbook Capture\\resources\\mcp\\server.cjs', roots: ['D:\\Clips', 'D:\\Video hiệu ứng'] }))
  .toBe('claude mcp add flipbook-capture -e ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\Flipbook Capture\\Flipbook Capture.exe" "C:\\Program Files\\Flipbook Capture\\resources\\mcp\\server.cjs" --root "D:\\Clips" --root "D:\\Video hiệu ứng"');
});
```

- [ ] **Step 2:** `npx vitest run test/main/connect-command.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt hàm, hộp thoại, script và cấu hình đóng gói.
- [ ] **Step 4:** Kiểm:
  - `npx vitest run` (toàn bộ) → PASS; `npm run e2e` → PASS.
  - `pwsh scripts/vendor-ffmpeg.ps1` rồi `npm run dist` → có `dist/Flipbook Capture Setup <ver>.exe`.
  - Cài vào máy, mở app, Import `cfr30.mp4`, chụp 3 frame, Save, Export → ra file; chạy lệnh từ hộp thoại "Kết nối với Claude", rồi `claude mcp list` thấy `flipbook-capture` ở trạng thái connected; gọi `list_projects` thấy dự án vừa lưu.
  - Chạy app đã cài trên máy không có ffmpeg trong PATH (đổi PATH tạm) → Import vẫn chạy (dùng ffmpeg đóng gói).
- [ ] **Step 5:** Commit `build: windows installer, bundled ffmpeg and Claude MCP connect dialog`.
