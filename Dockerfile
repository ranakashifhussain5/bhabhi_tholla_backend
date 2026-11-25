FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
# prisma generate reads DATABASE_URL via prisma.config.ts but never connects
# with it - a placeholder is enough to satisfy config validation at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# Driver-adapter Prisma client (@prisma/adapter-pg) talks to Postgres via the
# plain `pg` driver at runtime - no native query engine binary needed here,
# so the production image never needs the `prisma` CLI or @prisma/engines.
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
