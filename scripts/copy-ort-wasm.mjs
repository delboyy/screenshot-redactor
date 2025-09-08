#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const root = process.cwd();
  const srcDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  const dstDir = path.join(root, 'public', 'ort');
  await fs.mkdir(dstDir, { recursive: true });
  let files = [];
  try {
    files = await fs.readdir(srcDir);
  } catch (e) {
    console.warn('[copy-ort-wasm] source dir missing:', e?.message || e);
    return;
  }
  const assets = files.filter((f) => /\.(wasm|mjs)$/i.test(f));
  await Promise.all(assets.map((f) => fs.copyFile(path.join(srcDir, f), path.join(dstDir, f))));
  console.log(`[copy-ort-wasm] Copied ${assets.length} ORT assets (.wasm/.mjs) to /public/ort`);
}

main().catch((e) => console.warn('[copy-ort-wasm] Failed:', e?.message || e));
