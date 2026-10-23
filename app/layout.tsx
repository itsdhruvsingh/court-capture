import type { Metadata, Viewport } from "next";
import { Roboto_Mono } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeScript";

const mono = Roboto_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Court Capture", template: "%s · Court Capture" },
  description: "District Court and Delhi High Court records — parties, advocates, hearings and orders, with AI summaries.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0a0a0b", colorScheme: "dark light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet" />
      </head>
      <body className={mono.variable}>
        {/* data-theme is set here before hydration to avoid a flash; the server HTML has none. */}
        <div className="cc-root" suppressHydrationWarning>
          <ThemeScript />
          {children}
        </div>
      </body>
    </html>
  );
}
