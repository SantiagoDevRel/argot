import type { NextConfig } from "next";
const nextConfig: NextConfig = { outputFileTracingExcludes: { "*": ["./etl/**"] } };
export default nextConfig;
