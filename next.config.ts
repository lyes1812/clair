import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // exceljs (export Excel, routes serveur seulement) est chargé depuis node_modules au lieu d'être embarqué : sa dépendance unzipper
  // référence en option un client S3 jamais utilisé ici, que l'empaquetage ne doit pas chercher à résoudre.
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
