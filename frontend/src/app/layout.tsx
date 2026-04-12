import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ShellUI } from "@/components/ShellUI";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set theme class before first paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(t===null&&d))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white antialiased font-sans">
        <Providers>
          <div className="min-h-screen pb-16">
            {children}
          </div>
          <ShellUI />
          {/* Release version info */}
          <div className="fixed bottom-16 left-2 z-40 p-1">
            <span className="text-[10px] font-mono text-gray-300 dark:text-gray-600 select-none opacity-50 hover:opacity-100 transition-opacity">
              {process.env.NEXT_PUBLIC_RELEASE_ID || 'dev'}
            </span>
          </div>
        </Providers>
      </body>
    </html>
  );
}
