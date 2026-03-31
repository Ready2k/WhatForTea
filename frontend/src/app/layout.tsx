import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "What's for Tea?",
  description: "Locally-hosted recipe manager and kitchen assistant",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Prevent zoom on input focus (important for cooking mode UX)
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased font-sans">
        <Providers>
          <div className="min-h-screen pb-16">
            {children}
          </div>
          <Nav />
        </Providers>
      </body>
    </html>
  );
}
