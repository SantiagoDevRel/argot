import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside a monorepo with multiple lockfiles; pin the root
  // so Turbopack doesn't infer the wrong workspace.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
