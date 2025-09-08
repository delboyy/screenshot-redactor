declare module "onnxruntime-web" {
  // Minimal surface used in the worker; broadened to include threading flags
  export const env: {
    wasm: {
      wasmPaths?: string | Record<string, string>;
      numThreads?: number;
      proxy?: boolean;
    };
    versions?: { common?: string };
  };
  const mod: unknown;
  export default mod;
}
