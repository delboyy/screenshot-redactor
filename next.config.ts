import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal webpack fallbacks for browser builds to avoid bundling Node core deps
  // Loosely type only the parts we access to avoid `any`
  webpack: (
    config: { resolve: { fallback?: Record<string, false | string> } },
    { isServer }: { isServer: boolean }
  ) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
  
  // Cross-origin isolation (COI) headers: enable only when explicitly requested.
  // COI ON improves WASM performance (SIMD/SAB) but blocks cross-origin assets
  // that do not set CORP/COEP.
  async headers() {
    if (process.env.NEXT_PUBLIC_COI !== '1') return [];
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
  
  // Optimize for Edge Runtime compatibility
  experimental: {
    esmExternals: true,
  },
};

export default nextConfig;
