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
    domains: ["res.cloudinary.com"],
  },
};

module.exports = nextConfig;
