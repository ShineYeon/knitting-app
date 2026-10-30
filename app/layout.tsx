import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "뜨개 카운터",
  description: "스마트한 뜨개질 단수 카운터 및 도안 뷰어",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "뜨개 카운터",
  },
};

// Next.js 최신 규격에 맞춘 viewport 설정
export const viewport: Viewport = {
  themeColor: "#f5f5f4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="apple-touch-icon" href="/icon.png" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}