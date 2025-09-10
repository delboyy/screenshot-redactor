import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { dev, isServer }) => {
    // Optimize for cloud deployment and Web Workers
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
      
      // Add specific handling for Tesseract.js in workers
      config.resolve.alias = {
        ...config.resolve.alias,
        'tesseract.js/src/worker': 'tesseract.js/dist/worker.min.js',
      };
    }

    // Optimize chunks for better loading
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          tesseract: {
            test: /[\\/]node_modules[\\/]tesseract\.js[\\/]/,
            name: 'tesseract',
            chunks: 'all',
            priority: 10,
          },
        },
      },
    };

    return config;
  },
  
  // Headers for Cross-Origin Isolation (required for SharedArrayBuffer in workers)
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
