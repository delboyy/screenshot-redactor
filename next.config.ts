import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  
  // Cross-Origin Isolation headers: keep enabled by default for Web Workers
  // These headers (COEP/COOP) enable cross-origin isolation, which is required
  // for features like SharedArrayBuffer and some WebAssembly SIMD paths.
  // Tradeoff: they can block cross-origin iframes/resources unless those
  // resources opt-in (e.g., via CORP/COEP). Disable with care if you rely on
  // embedding third-party content that can’t be configured.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
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
