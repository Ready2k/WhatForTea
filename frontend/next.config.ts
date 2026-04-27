import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the production Docker image (copies only necessary files)
  output: "standalone",

  // Allow larger image uploads — client resizes first but this is the safety net
  experimental: {
    middlewareClientMaxBodySize: 20 * 1024 * 1024, // 20MB
  },

  // Proxy /api/* → backend container so the browser never needs to know
  // the backend host, and CORS is a non-issue.
  async redirects() {
    return [{ source: '/dashboard', destination: '/', permanent: true }];
  },

  async rewrites() {
    const apiUrl = process.env.API_URL ?? "http://api:8000";
    const useAimock = process.env.USE_AIMOCK === "true";
    const aimockUrl = process.env.AIMOCK_URL ?? "http://aimock:5001";
    return [
      ...(useAimock
        ? [
            { source: "/api/v1/chat", destination: `${aimockUrl}/api/v1/chat` },
            { source: "/api/v1/chat/resume", destination: `${aimockUrl}/api/v1/chat` },
          ]
        : []),
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
