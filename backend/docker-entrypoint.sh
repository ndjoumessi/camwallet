#!/bin/sh
set -e

echo "==> Prisma migrate deploy ..."
npx prisma migrate deploy

echo "==> Démarrage CamWallet API ..."
exec node dist/src/main
