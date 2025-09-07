# Screenshot Redactor — PRD (P0: Fast Local Text Detection)

**Doc owner:** Nathan + Senior Dev  
**Repo:** `delboyy/screenshot-redactor`  
**Version:** 1.0  
**Last updated:** 2025-09-08 (Asia/Dubai)

---

## 0) Summary

**Problem:** Full Tesseract.js OCR is heavy and slow when we only need **text regions** for redaction.  
**Solution (P0):** Add a **detector-only OCR** pipeline running **client-side in a Web Worker** (ONNX Runtime Web + PP-OCR det), expose a simple **“Auto-detect text (beta)”** flow that suggests boxes, lets users tweak them, and applies the existing redaction modes (black/blur/pixelate).

**Non-goals (P0):** Cloud OCR, PII recognition/classification, face detection, bulk upload.

---

## 1) Goals & Success Criteria

### 1.1 Goals
- Detect visible text regions **without recognition** (polygons → rectangles).
- Keep everything **local, private, and offline-capable**.
- Provide a smooth, non-blocking UX (worker based), with review + apply flow.

### 1.2 Success Metrics (targets on a 1920×1080 screenshot)
- **P50 detection time:** ≤ **1.5s** on modern laptop (M1/modern i5).  
- **Warm runs:** ≤ **1.0s**.  
- **Coverage:** ≥ **95%** of visible text yields at least one suggested box.  
- **Stability:** No UI freezes or crashes; memory footprint stable across 10+ runs.  
- **Irreversibility:** Exported image has redactions baked into pixels and **no EXIF/IPTC/XMP**.

---

## 2) Users & Use Cases

- **Analyst / Creator:** Needs to quickly redact text in screenshots of dashboards, chats, emails, or invoices before sharing.
- **Workflow:** Upload → Auto-detect → Inspect/adjust → Apply redactions → Export.

---

## 3) Scope

### 3.1 In-Scope (P0)
- Button: **Auto-detect text (beta)**.
- Overlay preview of detected **polygons** (rendered as rectangles).
- Controls:
  - **Padding** slider (0–12 px).
  - **Merge nearby boxes** toggle + **distance** slider (0–12 px).
  - **Select all**, **Clear**, **Apply** to redactions (uses existing black/blur/pixelate).
- Worker that loads a **detector model once** and handles repeated requests.
- Geometry utilities: polygon→rect, inflate, non-max suppression/merge.
- Export hardening: ensure **pixel-level** redactions and **strip metadata**.

### 3.2 Out-of-Scope (P0 → P1 candidates)
- **PII recognition/classification** (emails/phones) to auto-choose boxes.
- **Face detection** and auto-blur.
- **Bulk upload/queue** + ZIP export.
- **Cloud boost** (FastAPI + PaddleOCR/Surya).  
- **Mobile capture** features beyond current baseline.

---

## 4) Requirements

### 4.1 Functional
1. **Detect:** Given the current canvas image, produce polygons for text regions.
2. **Preview:** Draw overlays aligned with the image (respect zoom/fit).
3. **Controls:** Padding, merge (IoU + distance), select/clear/apply.
4. **Apply:** Convert final rects into redaction shapes and commit to existing history stack.
5. **Export:** Save with redactions rendered into the pixel buffer; remove metadata.
6. **Errors:** Show non-blocking errors/toasts if detection fails; manual tools always available.

### 4.2 Non-Functional
- **Privacy:** No network calls; everything runs in browser by default.
- **Performance:** Budgets in §1.2; no main-thread blocking >16ms bursts.
- **Compatibility:** Latest Chrome/Edge/Firefox/Safari; WASM fallback if WebGL/WebGPU not available.
- **Accessibility:** Keyboard focus visible; controls labeled; sufficient color contrast; overlays not announced to screen readers (decorative).
- **Resilience:** Worker reuse; safe cleanup on route unmount; degrade gracefully if detection unsupported.
- **Maintainability:** Strict TypeScript, unit tests for geometry, smoke e2e.

---

## 5) System Design

### 5.1 Architecture (frontend-only)
- **UI (React/Next.js)** calls → **Detector Client** → posts **ImageBitmap** to → **OCR Web Worker** (ONNX Runtime Web + PP-OCR detector) → returns polygons → **Geometry utils** → rects → overlay/controls → **Redaction engine** (existing).

### 5.2 Data Flow
1. User clicks **Auto-detect**.  
2. Client converts the visible canvas to **ImageBitmap** (transferred, not copied).  
3. Worker runs detector **once-initialized**; returns `{ id, boxes: number[][] }`.  
4. Client converts polygons → rects; apply padding; **NMS/merge**.  
5. Overlay renders candidate rects for review.  
6. On **Apply**, create redaction shapes (respect current mode: black/blur/pixelate).  
7. On **Export**, ensure pixel buffer modified and **metadata stripped**.

### 5.3 Key Components & Files (proposed)
```
/docs/PRD-P0-Detector-OCR.md           # this doc
/src/workers/ocrWorker.ts              # module worker (detector only)
/src/lib/ocr/detectorClient.ts         # worker wrapper & request/response mgmt
/src/lib/ocr/geom.ts                   # polygon->rect, padding, NMS/merge
/src/components/AutoDetectPanel.tsx    # UI controls + overlay
/src/types/worker.d.ts                 # worker TS declarations
```

### 5.4 Types / Contracts

**Worker request**
```ts
type OcrDetectReq = {
  id: string;
  imageBitmap: ImageBitmap; // transferred
};
```

**Worker response**
```ts
type OcrDetectRes =
  | { id: string; ok: true; boxes: number[][] }  // each is [x1,y1,x2,y2,...]
  | { id: string; ok: false; error: string };
```

**Internal rect**
```ts
type Rect = { x: number; y: number; width: number; height: number };
```

**AutoDetectPanel props**
```ts
type AutoDetectPanelProps = {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onApply(rects: Rect[]): void;
};
```

### 5.5 Runtime & Headers
- Prefer **WASM** backend for compatibility; optional **WebGL** where available.
- Consider **cross-origin isolation** (COOP/COEP) if using multi-threaded/SAB builds later. Ship headers enabled by default, with comments explaining tradeoffs. If breaking third-party embeds, allow an env flag to disable.

---

## 6) UX Details

- **Button:** “Auto-detect text (beta)”.  
- **While running:** spinner + cancellable state (disable repeated clicks).  
- **Overlay:** thin outlines with semi-transparent fill; no pointer capture; always aligned to the image container; scales with zoom.  
- **Controls:**  
  - Padding (0–12 px) with live preview updates.  
  - Merge **toggle** + Distance slider (0–12 px) and a conservative default IoU (e.g., 0.2–0.3).  
  - Select all / Clear / Apply.  
- **Keyboard:** `A` = Auto-detect, `Enter` = Apply, `Esc` = Clear overlay.  
- **Empty states / Errors:** Clear copy; keep manual tools available.

---

## 7) Performance Budgets & Telemetry

- **Detection time budgets:** P50 ≤ 1.5s (first run), ≤ 1.0s (warm).  
- **CPU/Memory:** Close ImageBitmap in worker after inference; reuse loaded model.  
- **Main thread:** no blocking > 16ms; all inference off-main.  
- **Instrumentation (optional):** simple timings via `performance.now()`; log to console in dev; no analytics by default.

---

## 8) Risks & Mitigations

- **Model size / cold start:** Cache worker & model; show spinner; consider lazy-init on first hover.  
- **Safari/WebGL quirks:** Default to WASM; feature-detect and fall back cleanly.  
- **Overlay misalignment:** Tie overlay to the same transform/zoom used by canvas; use a single parent container for both.  
- **False positives/negatives:** Provide manual tools; let users tweak padding/merge; allow clearing.  
- **Reversibility concern:** Ensure pixel buffer is altered and metadata removed on export.

---

## 9) Milestones & Tickets (P0)

- **P0-1:** Install deps & TS/Next config (COOP/COEP headers scaffold).  
- **P0-2:** Web Worker with detector-only OCR (polygons).  
- **P0-3:** Client wrapper to call worker (ImageBitmap transfer; promise map).  
- **P0-4:** Geometry utils (poly→rect, inflate, NMS/merge).  
- **P0-5:** AutoDetectPanel UI + overlay + controls.  
- **P0-6:** Wire into editor page; apply to existing redaction actions.  
- **P0-7:** Tests (Vitest unit tests; optional Playwright smoke test).  
- **P0-8:** Export hardening (irreversibility + EXIF stripping).

**Definition of Done:**  
- “Auto-detect text (beta)” available and stable; overlays accurate and aligned; apply commits redactions; exports are irreversible; tests green.

---

## 10) Appendix

### 10.1 Test Images
- Include 3 fixtures in `tests/fixtures/`:
  - `chat.png` (messaging UI)
  - `invoice.png` (dense text + numbers)
  - `dashboard.png` (charts + labels)

### 10.2 Test Plan (condensed)
- Load each fixture → run auto-detect → confirm >95% coverage visually.  
- Change padding/merge sliders → overlays update; no crashes.  
- Apply → export PNG → verify areas are truly redacted (visual + pixel check).  
- Repeat detection 10× in one session → no memory growth; warm times stay ≤ 1.0s.

---

**Notes**  
- Future (P1): Face detection (client-only), optional PII recognition (toggle), bulk upload/queue with progress, optional cloud boost.
