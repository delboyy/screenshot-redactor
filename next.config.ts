import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal webpack fallbacks for browser builds to avoid bundling Node core deps
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
  
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
