# Code-signing des mises à jour OTA (expo-updates)

Les bundles OTA servis par EAS Update sont **signés** : le runtime `expo-updates`
rejette tout bundle qui n'est pas signé par notre clé privée. Cela ferme la faille
« unsigned OTA code execution » — un serveur d'updates ou un canal compromis ne peut
plus pousser de code JS malveillant dans l'app en production.

## Pièces

| Fichier | Versionné ? | Rôle |
|---|---|---|
| `certs/certificate.pem` | ✅ oui | Certificat auto-signé embarqué dans le build ; le runtime l'utilise pour **vérifier** la signature des updates. Public. |
| `keys/private-key.pem` | ❌ **jamais** | Clé privée qui **signe** les updates à la publication. Secret. |
| `keys/public-key.pem` | ❌ non | Clé publique (dérivable du certificat). |

`app.json` → `expo.updates` :
```json
"codeSigningCertificate": "./certs/certificate.pem",
"codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" }
```

`keys/` et `*.pem` sont gitignorés (sauf `certs/certificate.pem`). **Ne jamais committer
`keys/private-key.pem`.** Validité du certificat : 10 ans (rotation à prévoir avant 2036).

## Publier une mise à jour signée

La clé privée doit être présente sous `keys/private-key.pem` au moment du `eas update` ;
elle est alors utilisée automatiquement pour signer.

```bash
# canal production
eas update --channel production --message "..."
# canal preview (builds internes)
eas update --channel preview --message "..."
```

Cloisonnement : chaque profil de build EAS épingle son canal (`production` → `production`,
`preview` → `preview`, voir `eas.json`). Un build prod ne tire donc que les updates du canal
`production` — un bundle de test ne peut pas atteindre la prod.

## En CI (la clé n'est pas dans le repo)

Stocker le contenu de `keys/private-key.pem` dans un secret (EAS env var ou secret CI)
nommé `EXPO_UPDATES_PRIVATE_KEY`, puis le restaurer avant `eas update` :

```bash
mkdir -p keys
printf '%s' "$EXPO_UPDATES_PRIVATE_KEY" > keys/private-key.pem
eas update --channel "$CHANNEL" --message "$MSG"
rm -f keys/private-key.pem   # ne pas laisser traîner
```

> Importer le secret une fois :
> `eas secret:create --scope project --name EXPO_UPDATES_PRIVATE_KEY --type file --value keys/private-key.pem`

## Rotation de la clé

1. Regénérer : `npx expo-updates codesigning:generate --key-output-directory keys --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name "CamWallet"`
2. `npx expo-updates codesigning:configure --certificate-input-directory=certs --key-input-directory=keys`
3. Republier un **build natif** (le nouveau certificat doit être embarqué) avant de signer
   les updates avec la nouvelle clé — sinon les anciens builds rejetteront les nouveaux updates.
4. Mettre à jour le secret CI `EXPO_UPDATES_PRIVATE_KEY`.
