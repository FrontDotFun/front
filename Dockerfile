# Multi-stage build
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/solana/package.json packages/solana/
COPY packages/services/package.json packages/services/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile --prod=false

# Build
FROM deps AS build
COPY . .
RUN pnpm db:generate
RUN pnpm turbo build --filter=@front-protocol/api... --filter=@front-protocol/services...

# Production
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/package.json ./packages/database/
COPY --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --from=build /app/packages/solana/dist ./packages/solana/dist
COPY --from=build /app/packages/solana/package.json ./packages/solana/
COPY --from=build /app/packages/services/dist ./packages/services/dist
COPY --from=build /app/packages/services/package.json ./packages/services/
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"
EXPOSE 3001
CMD ["node", "packages/api/dist/server.js"]
