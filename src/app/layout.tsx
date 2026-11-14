import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Flash, Nav } from "@/components/client";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Track Program Manager",
  description: "Program management for Big Project tracks: milestones, dependencies, RAID and action items.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel p-3 md:flex print:hidden">
          <div className="mb-4 px-3 pt-1">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted">Big Project</div>
            <div className="text-base font-semibold">Track PM</div>
          </div>
          <Suspense>
            <Nav />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <details className="mb-4 md:hidden print:hidden">
            <summary className="cursor-pointer text-sm font-medium">Menu</summary>
            <Suspense>
              <Nav />
            </Suspense>
          </details>
          <Suspense>
            <Flash />
          </Suspense>
          {children}
        </main>
      </body>
    </html>
  );
}
