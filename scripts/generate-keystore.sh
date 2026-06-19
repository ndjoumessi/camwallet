#!/usr/bin/env bash
# Génère le keystore de signature release CamWallet (à faire UNE fois, en local).
#
# Usage :
#   ./scripts/generate-keystore.sh
#   # → te demande un mot de passe (utilise le même pour store et clé, ou adapte).
#
# Ensuite, encode-le en base64 et renseigne les secrets GitHub :
#   base64 -i camwallet-release.keystore | tr -d '\n' | pbcopy   # macOS → presse-papier
#   # (Linux : base64 -w0 camwallet-release.keystore)
#
# Secrets à créer dans GitHub → Settings → Secrets and variables → Actions :
#   ANDROID_KEYSTORE_BASE64    = la sortie base64 ci-dessus
#   ANDROID_KEYSTORE_PASSWORD  = le mot de passe du keystore
#   ANDROID_KEY_ALIAS          = camwallet
#   ANDROID_KEY_PASSWORD       = le mot de passe de la clé
#
# ⚠️ Ne JAMAIS committer le .keystore ni les mots de passe. Garde une sauvegarde
#    sûre du keystore : le perdre = impossible de mettre à jour l'app sur le Play Store.
set -euo pipefail

OUT="${1:-camwallet-release.keystore}"

if [ -f "$OUT" ]; then
  echo "❌ $OUT existe déjà — abandon (ne pas écraser un keystore de production)."
  exit 1
fi

keytool -genkey -v \
  -keystore "$OUT" \
  -alias camwallet \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -dname "CN=CamWallet, OU=Mobile, O=CamWallet, L=Douala, S=Littoral, C=CM"

echo
echo "✅ Keystore généré : $OUT"
echo "   Encode-le : base64 -i $OUT | tr -d '\\n'   (macOS)  /  base64 -w0 $OUT  (Linux)"
echo "   puis colle le résultat dans le secret GitHub ANDROID_KEYSTORE_BASE64."
