import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Datei-Uploads laufen bewusst nicht durch den Server, sondern per Signed Upload URL
  // direkt vom Browser in den Supabase-Storage – dadurch gibt es keine Body-Size-Grenze
  // (weder von Next.js noch von Vercel) und damit auch kein 5-MB-Limit wie im Prototyp.
};

export default nextConfig;
