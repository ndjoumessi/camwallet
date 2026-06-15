#!/usr/bin/env bash
# CamWallet — Backup PostgreSQL
#
# Usage : ./scripts/backup.sh
# Cron  : 0 2 * * * /opt/camwallet/backend/scripts/backup.sh >> /var/log/camwallet-backup.log 2>&1
#
# Variables d'environnement (depuis .env ou l'environnement système) :
#   DATABASE_URL     — URL de connexion PostgreSQL (format standard)
#   BACKUP_DIR       — Répertoire de destination (défaut: /var/backups/camwallet)
#   BACKUP_KEEP_DAYS — Nombre de jours à conserver (défaut: 30)
#
# Pour Supabase/Neon : pointer DATABASE_URL vers DIRECT_DATABASE_URL (connexion
# directe, pas le pooler) car pg_dump ne supporte pas le mode transaction pooling.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/var/backups/camwallet}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="camwallet_${TIMESTAMP}.sql.gz"
TARGET="${BACKUP_DIR}/${FILENAME}"

if [ -z "${DATABASE_URL:-}" ]; then
  # Charger .env si présent (dev local)
  ENV_FILE="$(dirname "$0")/../.env"
  if [ -f "$ENV_FILE" ]; then
    set -o allexport
    source "$ENV_FILE"
    set +o allexport
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[ERREUR] DATABASE_URL non défini" >&2
  exit 1
fi

# Pour pg_dump avec un pooler, utiliser DIRECT_DATABASE_URL si disponible.
DB_URL="${DIRECT_DATABASE_URL:-${DATABASE_URL}}"

# ─── Backup ───────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Démarrage backup → ${TARGET}"
pg_dump --no-password --format=plain "$DB_URL" | gzip -9 > "$TARGET"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup terminé — $(du -sh "$TARGET" | cut -f1)"

# ─── Rotation ─────────────────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "camwallet_*.sql.gz" -mtime "+${KEEP_DAYS}" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Rotation : ${DELETED} ancien(s) backup(s) supprimé(s)"
fi
