declare module "onnxruntime-web" {
  // Minimal surface used in the worker; broaden as needed
  export const env: {
    wasm: { wasmPaths?: string | Record<string, string> };
  };
  const mod: unknown;
  export default mod;
}

