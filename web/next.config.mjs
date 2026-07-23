/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Hochgeladene HTML-Dateien mit eingebetteten Base64-Bildern können
    // mehrere MB groß sein - Standard-Limit (1 MB) für Server Actions anheben.
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
