/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: ['localhost:3000']
    }
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        '@google/generative-ai': '@google/generative-ai'
      });
    }
    return config;
  }
};

export default nextConfig;

