## Screenshot Redactor

Manual redaction MVP — privacy-first, entirely client-side.

Features
- Drag/drop/paste image upload
- Manual rectangle selection
- Redaction tools: Black bar, Blur (strong), Pixelate
- Undo/Redo history
- Export PNG/JPG/WEBP with optional EXIF stripping (JPEG)

Tech
- Next.js 14/15 + TypeScript + Tailwind
- HTML5 Canvas (direct pixel writes)
- `piexifjs` for EXIF removal (lazy-loaded)

Local dev
```bash
npm install
npm run dev
```

Privacy
- All processing happens in your browser. No image uploads.
