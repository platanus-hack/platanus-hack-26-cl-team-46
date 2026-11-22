import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Anti-clickjacking: nadie más puede meter Mayday en un iframe. Importa sobre todo por los
  // subdominios *.preview (código del usuario, mismo site). 'self' deja embeber nuestras propias páginas.
  // X-Frame-Options es el respaldo para navegadores que no entienden frame-ancestors.
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
