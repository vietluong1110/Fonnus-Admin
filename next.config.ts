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
  // The Overview moved from `/dashboard` to `/` (ADR 0006). A permanent
  // redirect keeps a bookmark and a link in an old report working, and leaves
  // no page file behind under `src/app/dashboard/`.
  redirects: () => Promise.resolve([{ source: '/dashboard', destination: '/', permanent: true }]),
  // ADR 0011 decision 1: `src/contract/config/runtime-document.ts` is a byte
  // copy of the pipeline's contract file, and its one relative import reads
  // `'../domain/speakable.js'`. Turbopack gates the `.js` → `.ts` substitution
  // on `moduleResolution: nodenext`, and this repo is on `bundler`, so the
  // build fails with `Module not found` without this line — while `tsc` and
  // vitest resolve it unaided. The copied bytes cannot change (the contract
  // hashes pin them), so the resolution is fixed here instead. The key is the
  // exact specifier the copy uses, and nothing else in this repo has a
  // `domain/` directory, so it can match nothing but the copy.
  turbopack: { resolveAlias: { '../domain/speakable.js': './src/contract/domain/speakable.ts' } },
};

export default nextConfig;
