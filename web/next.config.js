/** @type {import('next').NextConfig} */
const nextConfig = {
  serverActions: {
    allowedOrigins: [
      "fluffy-train-7vvwjrgxgr2w59v-3000.app.github.dev",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.gravatar.com",
      },
    ],
  },
};

module.exports = nextConfig;
