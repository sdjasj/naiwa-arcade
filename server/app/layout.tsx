import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "奶蛙摸鱼乐园 · 全球排行榜",
  description: "奶蛙摸鱼乐园的公开积分排行榜。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
