# ─── Stage 1 : Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 2 : Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# OpenSSL requis par Prisma sur Alpine (détection libssl)
RUN apk add --no-cache openssl

# Utilisateur non-root
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs

# Dépendances production uniquement
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Client Prisma généré + CLI (prisma est en devDependencies, absent après --omit=dev)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Artefacts compilés et migrations
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

# Script de démarrage
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Ownership nestjs sur tout ce que Prisma doit pouvoir écrire au runtime
RUN chown -R nestjs:nodejs /app/node_modules/@prisma \
 && chown -R nestjs:nodejs /app/node_modules/.prisma \
 && chown -R nestjs:nodejs /app/node_modules/prisma \
 && chown -R nestjs:nodejs /app/dist \
 && chown -R nestjs:nodejs /app/prisma \
 && chown nestjs:nodejs /app/docker-entrypoint.sh

USER nestjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
