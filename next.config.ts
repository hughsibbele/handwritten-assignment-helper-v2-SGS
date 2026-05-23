import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // M4.11d: legacy /setup wizard merged into /teacher/setup. Permanent
  // redirect catches any teacher bookmarks pointing at the old path.
  async redirects() {
    return [
      {
        source: "/setup",
        destination: "/teacher/setup",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
