import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "运单异常管理 V3",
  description: "录单→扫描品控→异常上报→分级审批→执行联动",
  other: {
    google: "notranslate",
  },
};

export default function RootLayout(props: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      translate="no"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="h-full overflow-hidden bg-canvas-50 text-ink-900">
        <AppShell>{props.children}</AppShell>
      </body>
    </html>
  );
}

