#!/usr/bin/env bash
# Migration production CamWallet — à exécuter depuis la racine du monorepo
# Prérequis : DIRECT_DATABASE_URL défini dans l'environnement
#
# Usage :
#   DIRECT_DATABASE_URL="postgresql://..." bash scripts/migrate-prod.sh
#
# Sur Railway, ce script est exécuté automatiquement via docker-entrypoint.sh
# au démarrage du conteneur. Utilisez-le manuellement pour des migrations urgentes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"

if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
  echo "ERREUR : DIRECT_DATABASE_URL non défini." >&2
  exit 1
fi

echo "==> CamWallet — Migration production"
echo "==> Cible : ${DIRECT_DATABASE_URL%%@*}@***"

cd "$BACKEND_DIR"

echo "==> prisma migrate deploy ..."
npx prisma migrate deploy

echo "==> Migration terminée avec succès."
