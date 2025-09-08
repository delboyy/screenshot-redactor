#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const projectRoot = process.cwd();
  const srcDir = path.join(projectRoot, 'node_modules', '@gutenye', 'ocr-models', 'assets');
  const dstDir = path.join(projectRoot, 'public', 'ocr-assets');
  try {
    await fs.mkdir(dstDir, { recursive: true });
  } catch {}

  let entries = [];
  try {
    entries = await fs.readdir(srcDir);
  } catch (e) {
    // Models not present (e.g., partial install) — no-op
    return;
  }

  const copyList = entries.filter((f) => /\.(onnx|txt)$/i.test(f));
  await Promise.all(
    copyList.map(async (name) => {
      const from = path.join(srcDir, name);
      const to = path.join(dstDir, name);
      await fs.copyFile(from, to);
    })
  );
  // eslint-disable-next-line no-console
  console.log(`[copy-ocr-assets] Copied ${copyList.length} files to /public/ocr-assets`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.warn('[copy-ocr-assets] Failed:', e?.message || e);
});

