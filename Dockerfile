# The console. Build context is the repository root:
#
#   docker build -t fonnus-admin:local .
#
# The build needs egress to fonts.googleapis.com once — `next/font` downloads the
# three faces (Baloo 2, Be Vietnam Pro, IBM Plex Sans) at build time.
#
# No HEALTHCHECK here — compose owns it, so the same image can be probed
# differently on a laptop and on the VPS.

# ---- build stage ----
FROM node:22-bookworm-slim AS build
# Must match package.json's packageManager field — the image installs pnpm before
# that file is copied, so the version cannot be read from it.
RUN npm i -g pnpm@11.5.0
WORKDIR /opt/fonnus-admin
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY public ./public
COPY src ./src
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime ----
# No prod-deps stage: `output: 'standalone'` traces the modules the server needs
# and writes them into .next/standalone/node_modules, so there is nothing to install.
FROM node:22-bookworm-slim AS runtime
WORKDIR /opt/fonnus-admin
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The standalone server reads HOSTNAME and PORT. Docker injects HOSTNAME=<container
# id> into every container, which would leave the server bound to a name that
# resolves to nothing; an ENV in the image outranks that injection.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /opt/fonnus-admin/.next/standalone ./
COPY --from=build --chown=node:node /opt/fonnus-admin/.next/static ./.next/static
COPY --from=build --chown=node:node /opt/fonnus-admin/public ./public
USER node
CMD ["node", "server.js"]
