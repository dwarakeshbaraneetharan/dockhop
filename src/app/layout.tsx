import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DockHop",
  description:
    "Plans Citi Bike routes with swap points so a long ride never crosses the free-ride limit.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "DockHop", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  // The map handles its own zoom, and pinch-zooming the chrome breaks the layout.
  maximumScale: 1,
  viewportFit: "cover",
};

// Typed explicitly rather than with Next's generated LayoutProps, which only
// exists after a build and so breaks a typecheck on a clean checkout.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
