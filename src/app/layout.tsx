import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { CommandPalette, Flash, MobileNav, Nav, SearchButton } from "@/components/client";
import { DEMO_MODE } from "@/lib/paths";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Track PM", template: "%s · Track PM" },
  description: "Program management for Big Project tracks: milestones, dependencies, RAID and action items.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-3 py-5 md:flex print:hidden">
          <div className="mb-7 flex items-center gap-2.5 px-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#2a78d6] to-[#1c5cab] text-sm font-bold text-white shadow">
              TP
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">Track PM</div>
              <div className="text-[11px] text-sidebar-ink/70">Big Project</div>
            </div>
          </div>
          <Suspense>
            <Nav />
          </Suspense>
          <div className="mt-auto px-3 text-[11px] text-sidebar-ink/60">
            {process.env.NEXT_PUBLIC_BUILD_SHA ? (
              <span className="font-mono" title="Commit this build was made from">
                build {process.env.NEXT_PUBLIC_BUILD_SHA}
              </span>
            ) : (
              <span>Local workspace</span>
            )}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
          <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-background/85 px-4 backdrop-blur md:px-8">
            <Suspense>
              <MobileNav />
            </Suspense>
            <SearchButton />
          </header>
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-8">
            {DEMO_MODE && (
              <div className="mb-5 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
                <b>Read-only demo</b> with fictional data. This is a static snapshot, so filters, edits, imports and sync
                are turned off. Run the app locally to use it for real.
              </div>
            )}
            <Suspense>
              <Flash />
            </Suspense>
            {children}
          </main>
        </div>
        <Suspense>
          <CommandPalette />
        </Suspense>
      </body>
    </html>
  );
}
