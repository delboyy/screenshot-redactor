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
  
  // Optimize for Edge Runtime compatibility
  experimental: {
    esmExternals: true,
  },
};

export default nextConfig;
