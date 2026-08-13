import type { NextConfig } from "next";

/** 앱인토스 .ait 패키징용 정적보내기 (scripts/build-ait.mjs 가 설정) */
const isAitBuild = process.env.AIT_BUILD === "1";

const nextConfig: NextConfig = {
  ...(isAitBuild
    ? {
        output: "export" as const,
        images: {
          unoptimized: true,
          remotePatterns: [
            { protocol: "https", hostname: "**.toss.im" },
            { protocol: "https", hostname: "static.toss.im" },
            { protocol: "https", hostname: "shopping-phinf.pstatic.net" },
          ],
        },
      }
    : {
        images: {
          remotePatterns: [
            { protocol: "https", hostname: "**.toss.im" },
            { protocol: "https", hostname: "static.toss.im" },
            { protocol: "https", hostname: "shopping-phinf.pstatic.net" },
          ],
        },
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
