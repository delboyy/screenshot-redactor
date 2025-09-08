## Screenshot Redactor

Privacy-first, entirely client-side redaction. Now with “Auto-detect text (beta)” powered by a lightweight detector running in a Web Worker.

### Features
- Upload via drag/drop, click, or paste from clipboard
- Manual rectangle selection with Undo/Redo
- Redaction tools: Black bar, Blur, Pixelate (destructive pixel writes)
- Auto-detect text (beta): suggest boxes, tweak padding/merge, apply
- Export PNG/JPG/WEBP; JPEG EXIF stripping supported

### How It Works
- Frontend-only Next.js app with TypeScript
- Canvas-based redactions (pixels overwritten on the client)
- Lightweight, local-only text box suggestion using a heuristic detector (no ONNX, no web workers required)

### Getting Started
Prereqs: Node 18+ (LTS), pnpm or npm

Install deps and copy model/runtime assets:
```bash
npm install
<!-- No postinstall needed for detector assets -->
```

Run the app:
```bash
npm run dev
```

Type check and lint locally:
```bash
npm run typecheck   # standalone tsc over app code
npm run lint:ci     # eslint flat-config, no warnings allowed
```

Build for production:
```bash
npm run build
npm start
```

### Environment & Headers
- By default, we do not enable cross-origin isolation. To opt in (for potential WASM performance features), set:
  - `NEXT_PUBLIC_COI=1` (adds COOP/COEP headers). Ensure all assets are same-origin or CORP-enabled.

### Auto‑Detect Text (Beta)
- The UI panel appears above the canvas. Click “Auto-detect text (beta)” to run detection in a Web Worker.
- Tune padding (0–12 px) and optionally merge nearby boxes by distance/IoU.
- Apply uses the currently selected redaction tool (Black/Blur/Pixelate) for each suggested box.

### Export Hardening
- Exports are rendered from the canvas into a fresh buffer (PNG/JPEG/WEBP), so redactions are baked into pixels.
- Optional EXIF stripping for JPEG via `piexifjs`.
- In development, we run lightweight irreversibility checks and warn if a tool looks reversible.

### Notable Files
- Worker + detector client
  - `src/workers/ocrWorker.ts` — detector-only OCR worker (loads once, re-used)
  - `src/lib/ocr/detectorClient.ts` — downscales, transfers `ImageBitmap`, correlates responses
- Geometry & overlays
  - `src/lib/ocr/geom.ts` — polygon→rect, inflate, NMS/merge (unit tests included)
  - `src/components/AutoDetectPanel.tsx` — detection UI and overlay
- Redaction & export
  - `src/components/redactor/ManualRedactor.tsx` — canvas tools, apply effects, export
  - `src/lib/export/validate.ts` — dev-only irreversibility checks
  - `src/lib/export/metadata.ts` — dev-only metadata marker checks

### CI / Vercel
- Vercel `buildCommand` runs `npm run typecheck && npm run lint:ci && next build` to fail fast on types/lint.
- Postinstall scripts copy detector and ORT assets to `public/` for same-origin loading.

### Troubleshooting
- “Auto-detect failed…”: Try reloading the page; the heuristic runs locally without extra assets.
- If detection is slow on first run: model cold start; warm runs are faster.
- COEP errors: disable COI (`NEXT_PUBLIC_COI` unset) or host all assets same-origin with proper CORP headers.

### Privacy
All processing stays in your browser. No image uploads or analytics by default.
