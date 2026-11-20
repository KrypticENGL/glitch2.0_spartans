import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import { Providers } from "@/components/shared/providers";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SURAKSHA — Flood evacuation & rescue coordination", template: "%s · SURAKSHA" },
  description: "Find flood shelters, explore evacuation routes and coordinate rescue in Bihar. Demonstration build with simulated data.",
  applicationName: "SURAKSHA",
  appleWebApp: { capable: true, title: "SURAKSHA", statusBarStyle: "default" },
  icons: { icon: "/favicon.ico", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#1B3034", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
