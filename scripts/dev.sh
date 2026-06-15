#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CamWallet — Démarrage rapide de l'environnement de développement local
# Usage : ./start.sh
# Orchestre : Docker (PostgreSQL + pgAdmin) → install → migrations → seed → API
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Se placer à la racine du dépôt (dossier du script)
cd "$(dirname "$0")"

BACKEND="backend"
CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

step() { echo -e "\n${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}! $1${RESET}"; }

# ─── 1. Pré-requis ────────────────────────────────────────────────────────────
step "Vérification des pré-requis"
command -v docker >/dev/null 2>&1 || { echo -e "${RED}✗ Docker introuvable — https://docs.docker.com/get-docker/${RESET}"; exit 1; }
command -v node   >/dev/null 2>&1 || { echo -e "${RED}✗ Node.js introuvable (v18+ requis)${RESET}"; exit 1; }
docker info >/dev/null 2>&1 || { echo -e "${RED}✗ Le démon Docker n'est pas démarré.${RESET}"; exit 1; }
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') · Node $(node -v)"

# Choisir `docker compose` (v2) ou `docker-compose` (v1)
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

# ─── 2. Fichier .env ──────────────────────────────────────────────────────────
step "Configuration (.env)"
if [ -f "$BACKEND/.env" ]; then
  ok "$BACKEND/.env présent"
else
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  warn "$BACKEND/.env créé depuis .env.example — pensez à le compléter si besoin"
fi

# ─── 3. Dépendances ───────────────────────────────────────────────────────────
step "Installation des dépendances backend"
if [ -d "$BACKEND/node_modules" ]; then
  ok "node_modules présent (saut de npm install — relancez avec ./start.sh --fresh pour réinstaller)"
else
  ( cd "$BACKEND" && npm install )
fi
if [ "${1:-}" = "--fresh" ]; then
  ( cd "$BACKEND" && npm install )
fi
( cd "$BACKEND" && npx prisma generate >/dev/null )
ok "Client Prisma généré"

# ─── 4. Base de données (Docker) ──────────────────────────────────────────────
step "Démarrage de PostgreSQL + pgAdmin"
$COMPOSE up -d
echo -n "  Attente de PostgreSQL "
until $COMPOSE exec -T postgres pg_isready -U camwallet -d camwallet_dev >/dev/null 2>&1; do
  echo -n "."; sleep 1
done
echo ""
ok "PostgreSQL prêt (localhost:5433) · pgAdmin (http://localhost:5050)"

# ─── 5. Migrations + seed ─────────────────────────────────────────────────────
step "Application des migrations Prisma"
( cd "$BACKEND" && npx prisma migrate dev --name init )
ok "Schéma synchronisé"

step "Insertion des données de test (seed)"
( cd "$BACKEND" && npm run prisma:seed )
ok "Données de test insérées"

# ─── 6. Démarrage de l'API ────────────────────────────────────────────────────
step "Démarrage de l'API CamWallet"
echo -e "${GREEN}"
echo "  ╭─────────────────────────────────────────────╮"
echo "  │  API      : http://localhost:3000/api/v1     │"
echo "  │  Swagger  : http://localhost:3000/api/docs   │"
echo "  │  pgAdmin  : http://localhost:5050            │"
echo "  │  Comptes  : PIN 123456 · +237677000001       │"
echo "  ╰─────────────────────────────────────────────╯"
echo -e "${RESET}"
exec bash -c "cd $BACKEND && npm run start:dev"
