declare module "vitest" {
  // Minimal shims to allow TS to type-check test files without installing types
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export function expect<T>(value: T): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
  };
}
