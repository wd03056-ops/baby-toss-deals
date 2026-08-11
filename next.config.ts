import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.toss.im" },
      { protocol: "https", hostname: "static.toss.im" },
      { protocol: "https", hostname: "shopping-phinf.pstatic.net" },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
