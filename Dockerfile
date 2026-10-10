# Multi-stage build for the self-hosted deploy shape: a single container
# running the Node backend, which also serves the already-built client
# (see server/src/index.ts's NODE_ENV=production block).
#
# Both stages use the same base image/tag so better-sqlite3's native binding,
# compiled in the build stage, is guaranteed to match the runtime stage's
# Node ABI/glibc — no separate `npm rebuild` needed in the runtime stage.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 falls back to compiling from source (node-gyp) when no
# prebuilt binary matches this platform/Node version — these are needed for
# that fallback to succeed rather than fail the whole build.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npm run build

# Drop devDependencies (typescript, vitest, tsx, tailwind, etc.) before
# copying node_modules into the runtime image — meaningfully smaller image,
# nothing at runtime needs them.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
