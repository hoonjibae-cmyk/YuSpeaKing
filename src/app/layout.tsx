import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: "유스피킹 | 목동유쌤영어",
  description: "초등 영어 스피킹 과제 제출 & AI 발음 평가",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "유스피킹" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1e3a75",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <div className="pointer-events-none fixed bottom-1 right-2 z-50 text-[10px] text-slate-300 select-none">
          목동유쌤영어 · v{APP_VERSION}
        </div>
      </body>
    </html>
  );
}
