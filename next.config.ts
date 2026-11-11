import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@napi-rs/canvas'], // module natif : chargé tel quel côté serveur, jamais empaqueté
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
  sassOptions: {
    implementation: 'sass-embedded',
    includePaths: [path.join(__dirname, 'src')],
  },
};

export default nextConfig;
