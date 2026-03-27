# Inside Success TV — Premiere Pro Plugin

A CEP (Common Extensibility Platform) panel that brings the full AI cut-sheet pipeline + **Multicam AI Edit** directly into Adobe Premiere Pro.

---

## What it does

| Feature | Description |
|---------|-------------|
| **Multicam AI Edit** | Scans your open sequence, sends track/clip layout to Claude, gets suggested cut points, lets you approve/reject each one, then applies razor cuts or markers |
| Audio Upload & Transcribe | Browse & upload an audio file, compress with FFmpeg, transcribe with Rev AI |
| AI Cut Sheet | Generate a structured cut sheet via Claude / GPT-4 / Gemini |
| XML Timeline Import | Import the AI-generated Premiere Pro XML timeline into your open project |

---

## For Editors — How to Get the Plugin

### Send editors this ZIP

Package and share the entire `premiere-plugin/` folder as a ZIP file. Editors:

1. Unzip anywhere (Desktop is fine)
2. Double-click `install.bat` → Run as Administrator
3. Restart Premiere Pro
4. Open: **Window → Extensions → Inside Success TV — Cut Sheet**
5. Enter the API URL from their team lead in the "Backend" field

That's it. No coding needed.

---

## How to Use Multicam AI Edit (for editors)

1. Open a sequence in Premiere Pro that has multiple camera tracks (V1, V2, etc.)
2. In the plugin panel, scroll to **"Multicam AI Edit"**
3. Click **"Scan Active Sequence"** — reads all tracks and clips
4. Optionally type editing instructions (e.g. "remove dead air, prefer wide shots")
5. Click **"Analyze with Claude"** — Claude reviews the timeline and suggests cuts
6. A list of suggested cut points appears with timecodes and reasons
7. **Check or uncheck** each suggestion (high-confidence cuts are pre-checked)
8. Click **"Apply Selected Cuts"** to make razor cuts, OR **"Markers Only"** to add markers without cutting (safe preview)

**Markers Only mode** is great for reviewing Claude's suggestions before committing to cuts.

---

## Requirements

- Adobe Premiere Pro 2019 (v13.0) or later
- The backend API running (URL provided by your team lead)

---

## Installation

### Windows (for editors)

1. Right-click `install.bat` → **Run as Administrator**
2. Restart Premiere Pro
3. **Window → Extensions → Inside Success TV — Cut Sheet**

### macOS

```bash
bash install.sh
```
Restart Premiere Pro, then **Window → Extensions → Inside Success TV — Cut Sheet**.

### Manual install

1. Copy this entire `premiere-plugin/` folder to:
   - **Windows:** `%APPDATA%\Adobe\CEP\extensions\com.insidesuccesstv.cutsheet\`
   - **macOS:**   `~/Library/Application Support/Adobe/CEP/extensions/com.insidesuccesstv.cutsheet/`

2. Download `CSInterface.js` from the [CEP Resources repo](https://github.com/Adobe-CEP/CEP-Resources/tree/master/CEP_12.x) and place it in the plugin root.

3. Enable unsigned extensions:
   - **Windows (registry):**
     ```
     HKEY_CURRENT_USER\Software\Adobe\CSXS.11
     PlayerDebugMode = 1  (REG_SZ)
     ```
   - **macOS (Terminal):**
     ```bash
     defaults write com.adobe.CSXS.11 PlayerDebugMode 1
     ```

4. Restart Premiere Pro.

---

## File structure

```
premiere-plugin/
├── CSXS/
│   └── manifest.xml        ← CEP extension manifest
├── css/
│   └── styles.css          ← Panel styles (adapts to PP dark/light theme)
├── js/
│   ├── api.js              ← Backend API client (including multicam endpoint)
│   └── main.js             ← Panel logic, multicam scan/suggest/apply flow
├── jsx/
│   └── host.jsx            ← ExtendScript bridge: reads sequences, applies cuts, adds markers
├── index.html              ← Panel UI
├── install.bat             ← Windows one-click installer
├── install.sh              ← macOS installer
└── README.md
```

---

## Distributing to 20+ editors

**Option A — Share a download link:**
1. Zip the `premiere-plugin/` folder
2. Upload to Google Drive, Dropbox, or any file share
3. Send the link to editors with these instructions:
   - Download and unzip
   - Run `install.bat` as Administrator
   - Restart Premiere Pro
   - Enter the API URL in the panel

**Option B — Shared network drive:**
1. Put the `premiere-plugin/` folder on a shared drive
2. Editors run `install.bat` directly from the network path

---

## Configuration

- The **Backend URL** field in the panel defaults to `http://localhost:8000`
- Click **Save** to persist it; click **Test Connection** to verify
- The backend URL is shared by all features (cut sheet, multicam, B-roll)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Panel not visible in Window menu | Re-run installer as Administrator; verify `PlayerDebugMode = 1` in registry |
| "Backend unreachable" | Start the backend (`uvicorn app.main:app --reload` in `backend/`) or check the URL |
| "No active sequence" on Scan | Click on a sequence tab in Premiere to make it active first |
| Cuts not applying | Some Premiere versions restrict ExtendScript razor; use "Markers Only" and cut manually |
| Import XML fails | Make sure a project is open before importing |
| `CSInterface.js` missing | Download from CEP Resources repo and place in the plugin root |
| Panel shows blank white | Open Chrome DevTools at `http://localhost:7777` (CEP debug port) |

---

## CEP Debug Console

Navigate to `http://localhost:7777` in Chrome while Premiere Pro is running with the panel open to access DevTools for debugging.
