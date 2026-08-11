import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="ko" className="h-full">
      <head>
        <meta charSet="utf-8" />
        {/* 구글 폰트 직접 로드 (한글: Noto Sans KR, 영문: Nunito, Fredoka) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Noto+Sans+KR:wght@400;500;700&family=Nunito:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "'Noto Sans KR', 'Nunito', sans-serif" }} className="min-h-full antialiased">
        {children}
      </body>
    </html>
  );
}