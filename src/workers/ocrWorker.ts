/// <reference lib="webworker" />

// Enhanced OCR worker with better text processing for PII detection
// Message protocol:
// - init: { type: 'init' }
// - run: { type: 'run', payload: { imageBitmapDataURL: string } }
// - response: { type: 'result', payload: { words: Array<WordBox> } }

import { createWorker } from "tesseract.js";

type RunPayload = {
  imageBitmapDataURL: string;
};

export type WordBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

export type LineBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

type TesseractWorker = {
  loadLanguage: (lang: string) => Promise<void>;
  initialize: (lang: string) => Promise<void>;
  recognize: (
    image: string | ImageBitmap | HTMLCanvasElement | HTMLImageElement,
    options?: Record<string, unknown>
  ) => Promise<{
    data: { words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> };
  }>;
  terminate?: () => Promise<void>;
};

let ocrWorker: TesseractWorker | null = null;
const DEBUG_OCR = true; // Enable for debugging

async function decodeBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  return bmp;
}

async function ensureWorker(): Promise<TesseractWorker> {
  if (!ocrWorker) {
    const w = await createWorker();
    // Cast to our narrow interface to avoid DOM Worker name conflicts
    ocrWorker = w as unknown as TesseractWorker;
    await ocrWorker.loadLanguage("eng");
    await ocrWorker.initialize("eng");
    // Set global parameters (PSM, OEM, preserve spaces)
    try {
      const anyWorker = w as unknown as { setParameters?: (p: Record<string, unknown>) => Promise<void> };
      await anyWorker.setParameters?.({
        tessedit_pageseg_mode: 6,
        preserve_interword_spaces: 1,
        oem: 1,
      });
    } catch {}
  }
  return ocrWorker;
}

// Enhanced text processing for better PII detection
function processTextForPii(text: string): string {
  return text
    // Normalize whitespace
    .replace(/\s+/g, " ")
    // Fix common OCR character substitutions
    .replace(/[0O]/g, (match, offset, string) => {
      // Context-aware O/0 replacement
      const context = string.slice(Math.max(0, offset - 3), offset + 4);
      if (/\d/.test(context)) return "0"; // Numbers context
      if (/@|\.com|\.org|\.net/.test(context)) return "o"; // Email/URL context
      return match;
    })
    .replace(/[1l|I]/g, (match, offset, string) => {
      // Context-aware 1/l/I replacement
      const context = string.slice(Math.max(0, offset - 3), offset + 4);
      if (/\d|@/.test(context)) return "1"; // Numbers or email context
      return match;
    })
    // Fix common punctuation issues
    .replace(/[.,;]\s*@/g, "@") // Remove punctuation before @
    .replace(/@\s*[.,;]/g, "@") // Remove punctuation after @
    .trim();
}

// Function to extract potential PII tokens from OCR text
type OcrBBox = { x0: number; y0: number; x1: number; y1: number };
type OcrWordCandidate = { text: string; bbox: OcrBBox; confidence: number };
type PiiCandidate = { text: string; bbox: OcrBBox; confidence: number };

function extractPiiCandidates(words: Array<OcrWordCandidate>): Array<PiiCandidate> {
  const candidates: Array<PiiCandidate> = [];
  
  // Single words that might be PII
  words.forEach(word => {
    const processed = processTextForPii(word.text);
    if (processed.length > 3) { // Skip very short words
      candidates.push({
        text: processed,
        bbox: word.bbox,
        confidence: word.confidence
      });
    }
  });
  
  // Multi-word combinations for emails, URLs, etc.
  for (let i = 0; i < words.length - 1; i++) {
    // Try combinations of 2-4 consecutive words
    for (let len = 2; len <= Math.min(4, words.length - i); len++) {
      const wordGroup = words.slice(i, i + len);
      const combinedText = wordGroup.map(w => w.text).join(" ");
      const processed = processTextForPii(combinedText);
      
      // Create combined bounding box
      const bboxes = wordGroup.map(w => w.bbox);
      const combinedBbox: OcrBBox = {
        x0: Math.min(...bboxes.map(b => b.x0)),
        y0: Math.min(...bboxes.map(b => b.y0)),
        x1: Math.max(...bboxes.map(b => b.x1)),
        y1: Math.max(...bboxes.map(b => b.y1))
      };
      
      const avgConfidence = wordGroup.reduce((sum, w) => sum + w.confidence, 0) / wordGroup.length;
      
      candidates.push({
        text: processed,
        bbox: combinedBbox,
        confidence: avgConfidence
      });
    }
  }
  
  return candidates;
}

self.addEventListener("message", async (e: MessageEvent) => {
  const { type, payload } = e.data || {};
  try {
    if (type === "init") {
      await ensureWorker();
      postMessage({ type: "ready" });
      return;
    }
    if (type === "run") {
      const { imageBitmapDataURL } = payload as RunPayload;
      const w = await ensureWorker();

      // Decode image and create downscaled canvas (OCR space)
      const bmp = await decodeBitmap(imageBitmapDataURL);
      const origW = bmp.width;
      const origH = bmp.height;
      const maxW = 1024;
      const scale = Math.min(1, maxW / origW);
      const ocrW = Math.max(1, Math.round(origW * scale));
      const ocrH = Math.max(1, Math.round(origH * scale));
      const canvas = new OffscreenCanvas(ocrW, ocrH);
      const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = "high"; } catch {}
      ctx.drawImage(bmp, 0, 0, ocrW, ocrH);

      // Run OCR with enhanced character whitelist for PII
      let result = await w.recognize(canvas as unknown as HTMLCanvasElement, {
        tessedit_pageseg_mode: 6,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._-:+/\\()[]{}#%?=&~*'\"\n ",
        preserve_interword_spaces: 1,
        oem: 1,
      });
      
      if ((!result.data?.words || result.data.words.length < 3) && DEBUG_OCR) {
        // Fallback with different PSM
        result = await w.recognize(canvas as unknown as HTMLCanvasElement, {
          tessedit_pageseg_mode: 7,
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._-:+/\\()[]{}#%?=&~*'\"\n ",
          preserve_interword_spaces: 1,
          oem: 1,
        });
      }

      const scaleX = origW / ocrW;
      const scaleY = origH / ocrH;

      const tWords = (result.data.words || []).map((w: { text?: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }) => ({
        text: w.text || "",
        conf: w.confidence ?? 0,
        bbox: { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 },
      }));

      type TLine = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number };
      const rawLines = (result.data as unknown as { lines?: TLine[] }).lines || [];
      const lines = rawLines.map((ln) => {
        const lb = ln.bbox;
        // words overlapping this line bbox
        const words = tWords
          .filter((w) => {
            const top = Math.max(w.bbox.y, lb.y0);
            const bottom = Math.min(w.bbox.y + w.bbox.h, lb.y1);
            const inter = Math.max(0, bottom - top);
            const refH = Math.max(1, Math.min(w.bbox.h, lb.y1 - lb.y0));
            return inter / refH > 0.5;
          })
          .sort((a, b) => a.bbox.x - b.bbox.x);
        const joinedParts: string[] = [];
        const spans: { start: number; end: number; wordIdx: number }[] = [];
        let cursor = 0;
        // estimate mean char width before join (non-space tokens only)
        const nonSpaceCharsPre = words.reduce((acc, w) => acc + (w.text || "").trim().length, 0) || 1;
        const meanCharWidth = Math.max(1, (lb.x1 - lb.x0) / nonSpaceCharsPre);
        words.forEach((w, idx) => {
          const token = (w.text || "").trim();
          const start = cursor;
          joinedParts.push(token);
          cursor += token.length;
          spans.push({ start, end: start + token.length, wordIdx: idx });
          if (idx < words.length - 1) {
            const next = words[idx + 1];
            const gapToNext = next.bbox.x - (w.bbox.x + w.bbox.w);
            const gapSpaces = gapToNext > meanCharWidth * 2.5 ? 2 : 1;
            joinedParts.push(gapSpaces === 2 ? "  " : " ");
            cursor += gapSpaces;
          }
        });
        const joined = joinedParts.join("");
        if (DEBUG_OCR) console.log("OCR line:", joined);
        
        return {
          words,
          joined,
          spans,
          meanCharWidth,
        };
      });

      // Extract PII candidates from all detected words
      const allWords = result.data.words || [];
      const piiCandidates = extractPiiCandidates(allWords.map(w => ({
        text: w.text || "",
        bbox: w.bbox,
        confidence: w.confidence ?? 0
      })));

      if (DEBUG_OCR) {
        console.log("PII Candidates found:", piiCandidates.length);
        piiCandidates.forEach(candidate => {
          console.log(`Candidate: "${candidate.text}" (confidence: ${candidate.confidence})`);
        });
      }

      const ocrResult = { 
        width: ocrW, 
        height: ocrH, 
        scaleX, 
        scaleY, 
        lines,
        piiCandidates // Add PII candidates to the result
      };
      
      postMessage({ type: "result", payload: { ocr: ocrResult } });
      return;
    }
  } catch (err) {
    postMessage({ type: "error", payload: { message: (err as Error).message } });
  }
});

export {}; // make this a module