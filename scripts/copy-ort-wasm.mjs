#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const root = process.cwd();
  const srcDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  const dstDir = path.join(root, 'public', 'onnx');
  await fs.mkdir(dstDir, { recursive: true });
  let files = [];
  try {
    files = await fs.readdir(srcDir);
  } catch (e) {
    console.warn('[copy-ort-wasm] source dir missing:', e?.message || e);
    return;
  }
  const wasm = files.filter((f) => f.endsWith('.wasm'));
  await Promise.all(wasm.map((f) => fs.copyFile(path.join(srcDir, f), path.join(dstDir, f))));
  console.log(`[copy-ort-wasm] Copied ${wasm.length} wasm files to /public/onnx`);
}

main().catch((e) => console.warn('[copy-ort-wasm] Failed:', e?.message || e));

