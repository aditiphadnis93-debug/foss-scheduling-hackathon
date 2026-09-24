import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import Rail from "@/components/shell/Rail";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "AIQuity for Efficient Courts",
  description: "A causelist that gives the court its day back, and shows the judge why.",
};

// Set the theme before first paint so there is no flash (see Next docs: preventing flash before hydration).
const THEME_SCRIPT = `try{var t=localStorage.getItem("ocl.theme");if(t==="dark"){document.documentElement.dataset.theme="dark"}if(localStorage.getItem("ocl.rail")==="collapsed"){document.documentElement.dataset.rail="collapsed"}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${sora.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full overflow-x-hidden">
        <Rail />
        <main className="app-main min-h-screen min-w-0">
          <div className="mx-auto w-full min-w-0 max-w-[1280px] px-4 pb-24 pt-6 sm:px-6 md:pt-8 lg:px-10">{children}</div>
        </main>
      </body>
    </html>
  );
}
