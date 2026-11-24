# Flipbook Capture

Flipbook Capture is a Windows desktop app for capturing frames of an animation or VFX clip by hand. You play the video slowly, step through it 100ms or one frame at a time, and capture the moments that matter. The app then exports them as labeled flipbook images plus a time log. The flipbooks and logs are meant for Claude to read, so it can see how the motion unfolds over time and write a spec from it.

A read-only MCP server is included so Claude can fetch projects, frames and exported flipbooks on its own.

- Spec (Vietnamese): [docs/superpowers/specs/2026-11-24-flipbook-capture-design.md](docs/superpowers/specs/2026-11-24-flipbook-capture-design.md)
- Implementation plan: [docs/superpowers/plans/2026-11-24-flipbook-capture.md](docs/superpowers/plans/2026-11-24-flipbook-capture.md)

The app's interface text is in Vietnamese. Where this guide names a button or message, the Vietnamese label is quoted with an English gloss.

## Contents

1. [Installing the app](#installing-the-app)
2. [Using the app](#using-the-app)
3. [Connecting Claude (MCP)](#connecting-claude-mcp)
4. [Running from source](#running-from-source)
5. [Running the tests](#running-the-tests)
6. [Building the installer](#building-the-installer)
7. [Data locations and environment variables](#data-locations-and-environment-variables)
8. [Source layout](#source-layout)
9. [Troubleshooting](#troubleshooting)

## Installing the app

1. Run `Flipbook Capture Setup <version>.exe`. After a [build](#building-the-installer), it is in `dist/`.
2. The installer is not code-signed, so Windows SmartScreen warns about it. Click **More info**, then **Run anyway**.
3. Choose an install folder. The default is `%LOCALAPPDATA%\Programs\Flipbook Capture`.

ffmpeg and ffprobe are bundled, so you don't need to install ffmpeg or Node.

The app runs on Windows 10/11 64-bit only.

## Using the app

### Screen layout

```
┌ File  Edit  View  Help ─────────────────────────────────────────┐
│ ┌──────── Video ────────┐  ┌────── Frame viewer ──────┐         │
│ │  (dashed selection)   │  │ export cell + label (TR) │         │
│ └───────────────────────┘  └──────────────────────────┘         │
│  Đang xem 1200ms        [Crop] [Đặt tên] [Tới ms này] [Xóa]     │
│ ══════|════|═══════▼══════  ← timeline                          │
│ 00:01.200 / 00:04.800  [-100ms][◀frame][▶][frame▶][+100ms]      │
│ [0.1x][0.25x][0.5x][1x]                                         │
│ [ 1 ][ 2 ][ 3 ] ...   ← captured frames, sorted by ms           │
│ T: chụp · Ctrl+T: chụp vùng · ...                  name.fbproj * │
└──────────────────────────────────────────────────────────────────┘
```

There is no capture button or export button on screen. You capture with the keyboard and export from the **File** menu.

### Basic workflow

1. **File > Import Video** (Ctrl+I) loads a video.
   - If Chromium can't play the video (HEVC, ProRes, …), the app makes an H.264 proxy for playback, with a progress bar and a cancel button ("Hủy").
   - Captures always come from the original video, never from the proxy.
2. Seek to the moment you want, with the keyboard or the mouse (see the shortcuts below).
3. Press **T** to capture the whole frame on screen. To capture part of it, drag on the video to draw a region, then press **Ctrl+T**.
4. Name, crop or delete frames in the frame viewer on the right.
5. **File > Save** (Ctrl+S) saves the project as a `.fbproj` file.
6. **File > Export Flipbook** (Ctrl+E) exports the flipbook images and logs.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward 100ms |
| Shift + ← / → | Back / forward 1 second |
| `,` / `.` | Back / forward one frame |
| T | Capture the whole frame on screen |
| Ctrl+T | Capture the region drawn on the video |
| Delete | Delete the selected frame |
| Ctrl+Z / Ctrl+Y | Undo / redo (capture, delete, rename, crop) |
| Ctrl+N / Ctrl+O | New project / open a `.fbproj` |
| Ctrl+S / Ctrl+Shift+S | Save / Save As |
| Ctrl+I | Import video |
| Ctrl+E | Export flipbook |

Capture and seek keys do nothing while you are typing in a text field (the rename field or the export dialog).

### Seeking with the mouse

- Click or drag on the timeline to seek. The position snaps to the nearest multiple of 100ms.
- Hold **Alt** while dragging to seek freely. The position then snaps to the nearest frame.
- Timeline markers:
  - **red**: the current position;
  - **green**: captured frames (click one to select that frame);
  - **blue**: the selected frame.

### Playback speed

Use the 0.1x / 0.25x / 0.5x / 1x buttons under the video, or the **View** menu. Changing speed does not pause the video.

### Displayed time

- The time is shown as `mm:ss.mmm`.
- It is the timestamp of the frame actually on screen, not the player's clock.
- The first frame of the video is always 0ms.

At 30fps, frames are about 33ms apart, so a 100ms step skips about 3 frames. Use `,` and `.` to move one frame at a time.

### Capturing frames

- **Source:** ffmpeg extracts the image from the original video at full resolution. Nothing is screen-captured.
- **Check before saving:** the app checks that the frame ffmpeg returns is the frame on screen. If it isn't, the app shows an error and saves nothing.
- **While playing:** pressing T pauses on the current frame first, then captures it.
- **Unconfirmed frame:** if the app can't confirm which frame is on screen, it shows "Không khớp frame, chưa thể chụp" ("frame mismatch, can't capture yet") under the video and blocks capture.
- **Ctrl+T with no region:** the app tells you to draw a region first. A region you draw is kept for later Ctrl+T captures.
- **Same frame more than once:** allowed, for example T for the full shot and Ctrl+T for a detail. These images share the same ms. Only an exact duplicate (same frame and same region) is skipped, with a short notice.

### Frame strip and frame viewer

- **Frame strip:** sorted by ms; frames with the same ms stay in capture order. Each item shows a thumbnail, its number, its name and its ms.
- **Selecting:** click an item, or its green marker on the timeline, to show it in the viewer.
- **What the viewer shows:** exactly the cell that will be exported, with the same cell size, fit mode and label.
- **Crop:**
  - drag the corners on the original image;
  - press Enter or "Áp dụng" (apply) to keep the crop, "Bỏ crop" (remove crop) to clear it, or Esc to cancel.
  - Cropping never changes the original image, so you can edit it again at any time.
- **"Đặt tên" (rename):** Enter saves and Esc cancels. Leave it empty to go back to the default name.
- **"Tới ms này" (go to this ms):** moves the video to that exact frame.
- **"Xóa" (delete):** deletes the frame. Undo works.
- **Numbering and names:**
  - The number is the frame's position after sorting by ms, so inserting a frame earlier renumbers the frames after it.
  - The default name is the number. With the base name `slash`, the name becomes `slash-<number>`.

### Exporting a flipbook

**File > Export Flipbook** (Ctrl+E) opens this dialog:

| Field | Default | Notes |
| --- | --- | --- |
| Cell size (width × height) | 256 × 256 | Tick "Giữ theo tỉ lệ video" (keep video aspect) to derive the height from the original video's aspect ratio |
| Image placement in the cell | Fit, keep aspect | Or fill and crop the edges, or stretch |
| Columns | Auto | Auto picks a column count that keeps the page close to square |
| Gap between cells | 4px | |
| Max long edge per page | 1568px | A hard limit: frames that don't fit go to another page |
| Show number / name / ms | All three | |
| Label font size | 14px | |
| Relative ms | On | First frame = 0ms |
| Folder, file name | The project's folder and name | |

The dialog previews the page count and the column count.

- **Warning:** a font smaller than 12px or a cell smaller than 128px shows "Claude có thể không đọc rõ" ("Claude may not read this clearly"). Export is still allowed.
- **Error:** a cell larger than the max long edge is an error. The **"Xuất"** (export) button is disabled.

**Exported files:**

- `<name>_p1.png`, `<name>_p2.png`, …: the flipbook pages.
  - Frames are sorted by ms and laid out left to right, then top to bottom.
  - Each cell has a label in its top-right corner: the number (bold), the name and the ms.
  - Cells are never shrunk to fit on one page.
- `<name>_log.txt`: a header with the video info, frame count, page count, cell size, time mode and total duration. Then a table with the columns `#`, Name, ms, +Δms, Source ms and Page.
- `<name>_log.json`: the same content in machine-readable form. Each frame also has its page, row and column, so a label can be matched to its cell.

The Source ms column (the frame's time in the original video) is always in the log, even with relative ms on.

### The `.fbproj` project file

- **What's inside:** a zip stored without compression, holding `project.json`, a copy of the original video and the captured frame images. You can move it to another machine and open it there.
- **Playback:** the video plays straight out of the file; it is never extracted.
- **Safe save:** the app writes a temporary file first, then replaces the old one. If the disk is full, you get an error and the existing file is left untouched.
- **Unsaved changes:** New, Open and quitting ask Save / Don't save / Cancel. The window title shows `*` while there are unsaved changes.
- **Importing a second video:** Import Video on a project that already has one asks whether to replace it. If you agree, all existing frames are deleted.
- **Recovery:** every change is written to a working folder right away. If the app is killed, it offers to recover your work the next time it starts.

## Connecting Claude (MCP)

The MCP server only reads files and never writes anything. The app doesn't need to be open. The server refuses any path outside the root folders you declare.

### Registering with Claude Code

1. In the app, open **Help > Kết nối với Claude** (connect to Claude).
2. Add or remove the root folders that hold your `.fbproj` files and exports.
3. Click **"Chép"** (copy) and paste the command into a terminal.

The command looks like this:

```powershell
claude mcp add flipbook-capture -e ELECTRON_RUN_AS_NODE=1 -- "C:\Users\<you>\AppData\Local\Programs\Flipbook Capture\Flipbook Capture.exe" "C:\Users\<you>\AppData\Local\Programs\Flipbook Capture\resources\mcp\server.cjs" --root "D:\Clips"
```

The server runs with the app's own exe in Node mode (`ELECTRON_RUN_AS_NODE=1`), so no Node install is needed. `--root` can be repeated.

Check the connection:

```powershell
claude mcp list
```

### Tools

| Tool | What it returns |
| --- | --- |
| `list_projects` | The `.fbproj` files under the roots |
| `list_exports` | Exports, found through their `*_log.json` files |
| `get_project(path)` | Video info and the frame list (number, name, ms, capture region, crop) |
| `get_flipbook(log_path)` | The log JSON plus every page as a PNG image |
| `get_frame(project_path, index, max_size)` | One frame, cropped. `index` starts at 1. Large images are downscaled to `max_size` (default 1568) |

### Running the MCP server from source

After `npm run build`, you can run the server with your local Node:

```powershell
node out/mcp/server.cjs --root "D:\Clips"
```

## Running from source

### Requirements

- Windows 10/11 x64.
- Node.js 24 or later (tested with Node 24.21 and npm 11).
- Git.
- An ffmpeg/ffprobe build with `libx264`, such as the "full" build from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/). Put it on PATH, or point `FC_FFMPEG_DIR` at the folder that contains `ffmpeg.exe` and `ffprobe.exe`.
- The Windows Arial fonts (`C:\Windows\Fonts\arial.ttf`, `arialbd.ttf`). The app uses them to draw labels, and the tests use them to print frame numbers on the sample videos.

Check ffmpeg:

```powershell
ffmpeg -hide_banner -encoders | Select-String libx264
```

### Install dependencies

```powershell
npm install
```

Electron's postinstall step sometimes fails to download its binary. If the app then reports that Electron is missing, run:

```powershell
node node_modules/electron/install.js
```

### Run in development mode

```powershell
npm run dev
```

This opens the app window, with hot reload for the UI.

### Build without packaging

```powershell
npm run build
```

The output goes to `out/`: `out/main`, `out/preload`, `out/renderer`, and the MCP server bundled into a single file, `out/mcp/server.cjs`.

## Running the tests

### Unit and integration tests (Vitest)

```powershell
npm test
```

- **Sample videos:** on the first run, the tests use ffmpeg to generate sample videos in `test/fixtures/gen/` (not committed). There are six:
  - 30fps;
  - variable frame rate;
  - B-frames with an offset start time;
  - rotation metadata;
  - HEVC;
  - trimmed with stream copy.
- **How frames are checked:** each frame shows its number, plus a band of 8 black/white blocks that encodes the number in binary. The tests read that band to check that a captured image is the right frame.
- **Real ffmpeg:** the tests run ffmpeg, so it must be set up as in [Requirements](#requirements).

Run a single test file:

```powershell
npx vitest run test/main/extract.test.ts
```

Type check:

```powershell
npx tsc --noEmit
```

### End-to-end tests (Playwright + Electron)

```powershell
npm run e2e
```

- This builds the app and runs the tests in `e2e/`. They launch the real app, import the sample videos, then seek, capture, save and export.
- They read pixels from the screen and from the captured images to confirm both show the same frame.
- The app's data goes to a temporary folder during the tests, so your real data is untouched.

Run a single file:

```powershell
npm run e2e -- e2e/capture.spec.ts
```

## Building the installer

1. Copy ffmpeg into `vendor/ffmpeg/` (this folder is not committed):

   ```powershell
   pwsh scripts/vendor-ffmpeg.ps1
   ```

   By default the script uses the ffmpeg found on PATH. To use the `bin` folder of a different build:

   ```powershell
   pwsh scripts/vendor-ffmpeg.ps1 -From "D:\Tools\ffmpeg\bin"
   ```

   The script downloads nothing. It:
   - checks that the build has `libx264`;
   - copies `ffmpeg.exe` and `ffprobe.exe`;
   - copies the DLLs too, if it is a shared build;
   - copies ffmpeg's LICENSE/README.

2. Build the installer:

   ```powershell
   npm run dist
   ```

   On the first run, electron-builder downloads Electron and NSIS for packaging. The output:
   - `dist/Flipbook Capture Setup <version>.exe`: the NSIS x64 installer.
   - `dist/win-unpacked/`: a runnable copy that needs no install, handy for a quick test.

To try the packaged MCP server without installing:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"; & "dist\win-unpacked\Flipbook Capture.exe" "dist\win-unpacked\resources\mcp\server.cjs" --root "D:\Clips"
```

Notes:
- The installer is not code-signed, and the app still uses the default Electron icon.
- The installer is about 245MB, mostly the full ffmpeg build.
- The bundled ffmpeg is a GPL build. Its license ships in `resources/ffmpeg` of the installed app.

## Data locations and environment variables

### Where the app keeps data

| Path | Contents |
| --- | --- |
| `%APPDATA%\Flipbook Capture\work\<id>\` | The working folder of the open project (frames, `project.json`), used for crash recovery. Deleted when you close the project normally |
| `%APPDATA%\Flipbook Capture\proxy-cache\` | H.264 proxies of videos Chromium can't play. Safe to delete; the app recreates them when needed |

### Environment variables

| Variable | Purpose |
| --- | --- |
| `FC_FFMPEG_DIR` | Folder with `ffmpeg.exe` and `ffprobe.exe` when running from source. The packaged app always uses its bundled ffmpeg |
| `ELECTRON_RUN_AS_NODE=1` | Runs the app's exe as Node; used for the MCP server |
| `FC_E2E`, `FC_E2E_USER_DATA`, `FC_E2E_ANSWERS`, `FC_E2E_SAVE_PATH`, `FC_E2E_OPEN_PATH`, `FC_E2E_VIDEO_PATH`, `FC_E2E_OUT_DIR` | End-to-end tests only: skip file pickers and prompts, use a temporary data folder |

## Source layout

```
src/core/       Pure TypeScript shared by the app and the MCP server:
                timing, ordering, page layout, labels, logs, .fbproj, drawing, export
src/main/       Electron main process: ffmpeg/ffprobe, project document and commands,
                session (open/save/recover), video protocol, IPC, menus
src/preload/    Safe bridge between main and the UI (window.fc), menu shortcuts
src/renderer/   React UI: player, timeline, frame strip, frame viewer, dialogs
src/shared/     Types and commands shared by main and the UI
src/mcp/        Read-only MCP server
scripts/        Sample video generator for tests, ffmpeg vendoring for packaging
test/           Vitest tests (core, main, mcp, renderer)
e2e/            Playwright tests that run the real app
docs/           Spec and implementation plan
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Không chạy được ffprobe" / "Không chạy được ffmpeg" (can't run ffprobe/ffmpeg) when running from source | Install a full ffmpeg build and add it to PATH, or set `FC_FFMPEG_DIR` |
| `npm run dev` says Electron isn't installed | Run `node node_modules/electron/install.js` |
| `vendor-ffmpeg.ps1` says `libx264` is missing | Use a "full" (GPL) ffmpeg build, not an "essentials" or LGPL build |
| A video doesn't play | The app makes an H.264 proxy automatically, with a progress bar. If you cancelled it, re-import the video to start it again |
| "Không khớp frame, chưa thể chụp" (frame mismatch, can't capture yet) | The app couldn't confirm the frame on screen. Step to another frame and back, or reopen the video |
| SmartScreen blocks the installer | The installer is unsigned. Click **More info**, then **Run anyway** |
| `claude mcp list` doesn't show `flipbook-capture` | Check the exe and `server.cjs` paths in the command, and that every `--root` folder exists |
