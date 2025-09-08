// Lightweight shims so standalone `tsc` can typecheck app code without pulling Next's full types

declare module "next" {
  export type Metadata = unknown;
  export type NextConfig = unknown;
}

declare module "next/link" {
  const Link: (props: Record<string, unknown>) => JSX.Element;
  export default Link;
}

declare module "next/navigation" {
  export function useRouter(): { push: (url: string) => void };
}

declare module "next/font/google" {
  export function Geist(init?: Record<string, unknown>): { variable: string };
  export function Geist_Mono(init?: Record<string, unknown>): { variable: string };
}
