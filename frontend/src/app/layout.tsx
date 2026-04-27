import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "../styles/tokens.css";
import { Providers } from "@/components/providers";
import { ShellUI } from "@/components/ShellUI";

const jakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "What's for Tea?",
  description: "AI-powered recipe manager and kitchen assistant",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WhatsForTea",
  },
  icons: [
    { rel: "icon", url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
    { rel: "icon", url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { rel: "apple-touch-icon", url: "/icons/apple-touch-icon.png" },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Prevent zoom on input focus (important for cooking mode UX)
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jakartaSans.variable} suppressHydrationWarning>
      <head>
        {/* Set theme class before first paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(t===null&&d))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-100 antialiased font-sans">
        <Providers>
          <div className="min-h-screen pb-16 md:pb-0 md:pl-[220px]">
            {children}
          </div>
          <ShellUI />
          {/* Release version info */}
          <div className="fixed bottom-16 md:bottom-2 left-2 z-40 p-1 pointer-events-none">
            <span className="text-[10px] font-mono text-gray-300 dark:text-gray-600 select-none opacity-50 hover:opacity-100 transition-opacity">
              {process.env.NEXT_PUBLIC_RELEASE_ID || 'dev'}
            </span>
          </div>
        </Providers>
      </body>
    </html>
  );
}
