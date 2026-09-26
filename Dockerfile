# One image, one container: the built web client and the API behind it.
#
# Build context is the repository root (see docker-compose.yml).
# No `# syntax=` directive: pulling the external dockerfile frontend image
# fails on this network, and the built-in one supports everything used here.

# --- web client ---------------------------------------------------------------
# `vue-tsc` runs inside `npm run build`, so a type error fails the image build.
FROM node:24-alpine AS web
WORKDIR /build
COPY front-end/package.json front-end/package-lock.json ./
RUN npm ci
COPY front-end/ ./
RUN npm run build

# --- API ----------------------------------------------------------------------
FROM node:24-alpine AS api
WORKDIR /build
COPY back-end/package.json back-end/package-lock.json ./
RUN npm ci
COPY back-end/ ./
# --omit=dev keeps the toolchain (typescript/esbuild types) out of the image;
# only mysql2 is needed at runtime, and it stays external to the bundle.
RUN npm run build && npm prune --omit=dev

# --- runtime ------------------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

# mysql2 stays external to the esbuild bundle, so node_modules ships too.
COPY --from=api --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=api --chown=node:node /build/node_modules ./node_modules
COPY --from=api --chown=node:node /build/dist ./dist
COPY --from=web --chown=node:node /build/dist ./public

USER node
EXPOSE 80
CMD ["node", "dist/server.js"]
