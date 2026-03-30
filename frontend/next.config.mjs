const standaloneEnabled = process.env.NEXT_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // NOTE: Must be explicitly false. In Next.js 14.2.x the build worker is
    // enabled unless this flag is truthy; setting it to true will *force* the
    // build worker on, which has caused Windows build hangs in this repo.
    webpackBuildWorker: false,
  },
  ...(standaloneEnabled ? { output: "standalone" } : {}),
};

export default nextConfig;
