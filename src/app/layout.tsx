import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Flash, Nav } from "@/components/client";
import { DEMO_MODE } from "@/lib/paths";
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
          {process.env.NEXT_PUBLIC_BUILD_SHA && (
            <div className="mt-auto px-3 pb-1 font-mono text-[10px] text-muted" title="Commit this build was made from">
              build {process.env.NEXT_PUBLIC_BUILD_SHA}
            </div>
          )}
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <details className="mb-4 md:hidden print:hidden">
            <summary className="cursor-pointer text-sm font-medium">Menu</summary>
            <Suspense>
              <Nav />
            </Suspense>
          </details>
          {DEMO_MODE && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <b>Read-only demo</b> with fictional data. A static snapshot, so filters, edits, imports and sync are
              disabled. Run the app locally to use it for real.
            </div>
          )}
          <Suspense>
            <Flash />
          </Suspense>
          {children}
        </main>
      </body>
    </html>
  );
}
