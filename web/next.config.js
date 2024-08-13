/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        "fluffy-train-7vvwjrgxgr2w59v-3000.app.github.dev",
      ],
    }
  },
  images: {
    domains: ["www.gravatar.com"],
  },
};

module.exports = nextConfig;
