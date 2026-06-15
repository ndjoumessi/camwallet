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

# Utilisateur non-root
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs

# Dépendances production uniquement
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Client Prisma généré (depuis le builder)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Artefacts compilés et migrations
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --chown=nestjs:nodejs prisma ./prisma

# Script de démarrage
COPY --chown=nestjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nestjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
