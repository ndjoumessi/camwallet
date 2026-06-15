// Setup global pour les tests e2e.
// Remplace DATABASE_URL par DATABASE_TEST_URL si défini.
export default async function globalSetup() {
  if (process.env.DATABASE_TEST_URL) {
    process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
  }
}
