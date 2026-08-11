import type { Config } from "tailwindcss";

/**
 * Warm & Neutral (감성 베이지) — baby 컬러 팔레트
 * Tailwind v4는 globals.css @theme도 함께 사용합니다.
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
          bg: "#FDFBF7",
          card: "#FFFFFF",
          border: "#E8E2D9",
          butter: "#F4E0A5",
          cta: "#D99B82",
          ink: "#332E2B",
          mute: "#7A726A",
        },
      },
      boxShadow: {
        "baby-sm":
          "0 1px 2px rgba(51, 46, 43, 0.04), 0 4px 12px rgba(51, 46, 43, 0.06)",
        "baby":
          "0 2px 4px rgba(51, 46, 43, 0.04), 0 8px 20px rgba(51, 46, 43, 0.08)",
        "baby-md":
          "0 4px 8px rgba(51, 46, 43, 0.05), 0 12px 28px rgba(51, 46, 43, 0.1)",
      },
    },
  },
  plugins: [],
};

export default config;
