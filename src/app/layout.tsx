import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Figtree, Newsreader, Parisienne } from "next/font/google";
import "./globals.css";

const sans = Figtree({ variable: "--font-sans-face", subsets: ["latin"] });
const display = Newsreader({ variable: "--font-display-face", subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"] });
// Only the date night menu uses these, so they load when it is on screen.
const menu = Cormorant_Garamond({ variable: "--font-menu-face", subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], preload: false });
const script = Parisienne({ variable: "--font-script-face", subsets: ["latin"], weight: "400", preload: false });

export const metadata: Metadata = {
  title: { default: "More", template: "%s · More" },
  description: "More room for me. More time for us. Better days together.",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "More", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eee4" },
    { media: "(prefers-color-scheme: dark)", color: "#15171d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${display.variable} ${menu.variable} ${script.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
