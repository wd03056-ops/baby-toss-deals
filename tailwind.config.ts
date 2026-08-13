import type { Config } from "tailwindcss";

/**
 * Premium Soft Slate — 눈이 편안한 오프화이트 + 샴페인 골드 포인트
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        baby: {
          bg: "#F8F9FB",
          card: "#FFFFFF",
          border: "#E2E8F0",
          butter: "#C5A059",
          cta: "#1E293B",
          gold: "#C5A059",
          bronze: "#B8860B",
          ink: "#0F172A",
          mute: "#475569",
        },
      },
      boxShadow: {
        "baby-sm":
          "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
        baby: "0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04)",
        "baby-md":
          "0 4px 8px rgba(15, 23, 42, 0.05), 0 12px 24px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
