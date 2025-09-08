declare module "@gutenye/ocr-browser" {
  export type Detector = {
    detect(image: ImageBitmap): Promise<{ boxes: number[][] }>;
  };
  const Ocr: {
    create(options?: unknown): Promise<Detector>;
  };
  export default Ocr;
}
