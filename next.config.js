/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Build 102b: screens visited in the last minute open from memory when you go back to them (no reload);
    // saving anything clears this, so lists never show old data after a change
    staleTimes: { dynamic: 60 },
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};
module.exports = nextConfig;
