import type { Metadata, Viewport } from "next";
import { Nunito, Fredoka, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 1. 라틴 폰트
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// 2. 한글 폰트 추가 (Noto Sans KR)
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"], // Next.js가 한글 글꼴도 자동 최적화해 줍니다.
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "아이특가 - 오늘의 추천 유아용품",
  description:
    "토스쇼핑 쉐어링크 기반 아기용품 베스트 TOP 20과 하루특가 추천 앱",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FFF0F5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${nunito.variable} ${fredoka.variable} ${notoSansKr.variable} h-full`}
    >
      {/* font-sans 기본 글꼴에 notoSansKr이 먼저 적용되도록 지정 */}
      <body className={`${notoSansKr.className} min-h-full antialiased`}>
        {children}
      </body>
    </html>
  );
}