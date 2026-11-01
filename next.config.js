/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/tg', destination: '/tg/index.html' }];
  },
};

module.exports = nextConfig;
