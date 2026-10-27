import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Excel reste côté Node : ne pas inclure le lecteur S3 optionnel d'unzipper dans le bundle.
  serverExternalPackages: ["exceljs"],
  // Dépôt de fichiers DSN par action serveur : 4 Mo par fichier, 24 fichiers au plus.
  experimental: { serverActions: { bodySizeLimit: "100mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
