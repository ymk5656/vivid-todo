import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiveLingo — 스페인어 프리토킹",
  description: "AI와 함께하는 스페인어 발음 특화 학습",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="bg-gray-950 text-white min-h-screen">{children}</body>
    </html>
  );
}
