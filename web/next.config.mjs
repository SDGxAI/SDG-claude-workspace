/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Hochgeladene HTML-Dateien mit eingebetteten Base64-Bildern können
    // mehrere MB groß sein - Standard-Limit (1 MB) für Server Actions anheben.
    serverActions: {
      bodySizeLimit: "15mb",
    },
    // MiniCMS-Export: Twig.js (Prüfung der Vorlage) und sharp (WebP → PNG/JPG)
    // nicht bündeln, sondern direkt aus node_modules laden.
    serverComponentsExternalPackages: ["twig", "sharp"],
  },
};

export default nextConfig;
