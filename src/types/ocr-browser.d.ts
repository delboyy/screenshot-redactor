declare module "@gutenye/ocr-browser" {
  export type Detector = {
    detect(image: ImageBitmap): Promise<{ boxes: number[][] }>;
  };
  export type OcrCreateOptions = {
    backend?: "wasm" | "webgl" | string;
    det?: boolean;
    rec?: boolean;
    models?: {
      detectionPath: string;
      recognitionPath: string;
      dictionaryPath: string;
    };
    onnxOptions?: unknown;
  };
  const Ocr: {
    create(options?: OcrCreateOptions): Promise<Detector>;
  };
  export default Ocr;
}
