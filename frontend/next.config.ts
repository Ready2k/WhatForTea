import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the production Docker image (copies only necessary files)
  output: "standalone",

  // Proxy /api/* → backend container so the browser never needs to know
  // the backend host, and CORS is a non-issue.
  async rewrites() {
    const apiUrl = process.env.API_URL ?? "http://api:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
