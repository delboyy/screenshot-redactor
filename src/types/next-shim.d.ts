// Lightweight shims so standalone `tsc` can typecheck app code without pulling Next's full types

declare module "next" {
  export type Metadata = any;
  export type NextConfig = any;
}

declare module "next/link" {
  const Link: any;
  export default Link;
}

declare module "next/navigation" {
  export function useRouter(): { push: (url: string) => void };
}

declare module "next/font/google" {
  export function Geist(init?: any): { variable: string };
  export function Geist_Mono(init?: any): { variable: string };
}

