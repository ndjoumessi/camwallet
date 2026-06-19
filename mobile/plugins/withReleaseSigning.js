/**
 * Config plugin Expo : injecte une configuration de signature "release" dans
 * android/app/build.gradle lors du `expo prebuild`.
 *
 * Pourquoi un plugin et pas un build.gradle commité ? Le dossier android/ est
 * géré par CNG (gitignored, régénéré par `expo prebuild --clean`) — éditer
 * build.gradle dans le repo serait écrasé à chaque prebuild. Le plugin applique
 * la même config au moment de la génération, de façon idempotente.
 *
 * Les valeurs sont lues depuis l'environnement au moment du build Gradle
 * (CI GitHub Actions) :
 *   ANDROID_KEYSTORE_PATH (défaut "release.keystore"), ANDROID_KEYSTORE_PASSWORD,
 *   ANDROID_KEY_ALIAS (défaut "camwallet"), ANDROID_KEY_PASSWORD.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_SIGNING = `        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: "camwallet"
            keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: ""
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('ANDROID_KEYSTORE_PATH')) return cfg; // déjà appliqué (idempotent)

    // 1) Ajoute un signingConfig "release" juste après l'ouverture du bloc signingConfigs.
    gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}\n${RELEASE_SIGNING}`);

    // 2) Bascule le buildType "release" sur ce keystore (sinon le template utilise debug).
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+)signingConfigs\.debug/,
      '$1signingConfigs.release',
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
