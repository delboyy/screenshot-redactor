// Minimal constructor augmentation so TS accepts:
// new Worker(new URL('./path', import.meta.url), { type: 'module' })
// Requires "lib": ["WebWorker"] in tsconfig to provide Worker/WorkerOptions types.

declare global {
  interface WorkerConstructor {
    new (url: URL, options?: WorkerOptions): Worker;
  }
}

export {};

