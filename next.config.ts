import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Dockerfile's runtime stage copies `.next/standalone` and nothing else:
  // standalone traces the modules the server actually needs, so the image needs
  // no `pnpm install --prod` stage.
  output: "standalone",
  // The lockup is the only image and it is an SVG, which the optimizer passes
  // through untouched anyway. Turning it off removes the optimizer route — and
  // with it the `sharp` question — from the deployed image.
  images: { unoptimized: true },
};

export default nextConfig;
