import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { RoleProvider, RoleSwitcher } from "@/components/role";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Court Planner",
  description: "Scheduling Justice: a live picture of the court for judges and court masters",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <RoleProvider>
          <header className="sticky top-0 z-20 border-b border-line bg-card/85 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link href="/" className="flex items-baseline gap-2">
                <span className="text-[17px] font-semibold tracking-tight">Court Planner</span>
                <span className="text-[13px] text-mut">Scheduling Justice</span>
              </Link>
              <div className="flex items-center gap-4">
                <Link href="/story" className="text-sm text-mut hover:text-acc">How it was built</Link>
                <RoleSwitcher />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-5 pb-24 pt-8">{children}</main>
        </RoleProvider>
      </body>
    </html>
  );
}
