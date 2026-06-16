// Dictionnaire de traduction FR → EN des messages d'erreur de l'API.
//
// Les exceptions sont levées en français partout dans le code (langue de
// référence du projet). Le `I18nExceptionFilter` traduit le message à la
// volée vers l'anglais quand le client envoie `Accept-Language: en`.
//
// Deux types d'entrées :
//   - clé EXACTE → traduction (cas général, message statique)
//   - clé se terminant par « : » → préfixe, pour les messages interpolés
//     (ex. « Initiation du paiement CamPay échouée : <détail opérateur> »).
//     Le filtre fait alors un match par préfixe et conserve le suffixe.

export const ERROR_MESSAGES_EN: Record<string, string> = {
  // --- Générique ---
  'Erreur interne du serveur': 'Internal server error',

  // --- Auth / session ---
  'Accès refusé': 'Access denied',
  'Accès réservé aux administrateurs': 'Administrators only',
  'Accès réservé aux commerçants': 'Merchants only',
  'Identifiants administrateur invalides': 'Invalid administrator credentials',
  'Connexion administrateur indisponible': 'Administrator login unavailable',
  'Session administrateur expirée': 'Administrator session expired',
  'Session expirée — reconnectez-vous': 'Session expired — please sign in again',
  'Refresh token invalide ou expiré': 'Invalid or expired refresh token',
  'Refresh token manquant': 'Missing refresh token',
  'Origine non autorisée': 'Origin not allowed',

  // --- OTP / PIN ---
  'Code OTP incorrect': 'Incorrect OTP code',
  'Code OTP invalide ou expiré': 'Invalid or expired OTP code',
  'PIN actuel incorrect': 'Current PIN is incorrect',
  'PIN incorrect': 'Incorrect PIN',
  'Ce PIN a déjà été utilisé récemment. Choisissez un PIN différent.':
    'This PIN was used recently. Please choose a different PIN.',
  'Trop de tentatives. Demandez un nouveau code.': 'Too many attempts. Please request a new code.',
  'Erreur envoi SMS. Réessayez.': 'Failed to send SMS. Please try again.',

  // --- 2FA / TOTP ---
  '2FA non activée': '2FA is not enabled',
  'Aucune configuration 2FA en cours': 'No 2FA setup in progress',
  "Désactivez la 2FA existante avant d'en configurer une nouvelle":
    'Disable the existing 2FA before setting up a new one',
  'Code TOTP invalide': 'Invalid TOTP code',
  'Code TOTP invalide ou expiré': 'Invalid or expired TOTP code',

  // --- Inscription / profil ---
  'Ce numéro est déjà enregistré': 'This phone number is already registered',
  'Cet email est déjà utilisé': 'This email is already in use',
  'Numéro introuvable': 'Phone number not found',
  'Utilisateur introuvable': 'User not found',
  'Destinataire introuvable': 'Recipient not found',

  // --- Portefeuille / transactions ---
  'Solde insuffisant': 'Insufficient balance',
  'Montant invalide': 'Invalid amount',
  'Portefeuille introuvable': 'Wallet not found',
  'Portefeuille désactivé': 'Wallet is disabled',
  'Transaction introuvable': 'Transaction not found',
  "Vous ne pouvez pas vous envoyer de l'argent": 'You cannot send money to yourself',
  'Numéro mobile money requis pour la recharge': 'A mobile money number is required to top up',
  'Non autorisé à contester cette transaction': 'You are not allowed to dispute this transaction',

  // --- QR ---
  'QR Code déjà utilisé': 'QR code already used',
  'QR Code expiré': 'QR code expired',
  'QR Code invalide ou expiré': 'Invalid or expired QR code',

  // --- KYC / uploads ---
  'Aucun fichier fourni': 'No file provided',
  'Format non supporté (PNG, JPEG ou WEBP attendu)': 'Unsupported format (PNG, JPEG or WEBP expected)',
  'Trois images requises : CNI recto, CNI verso et selfie':
    'Three images required: ID front, ID back and selfie',

  // --- Admin / opérations / ANIF ---
  'Opération introuvable': 'Operation not found',
  'Seules les opérations PENDING peuvent être relancées': 'Only PENDING operations can be retried',
  'Dossier ANIF introuvable ou déjà traité': 'ANIF case not found or already processed',
  'Note introuvable ou non autorisé': 'Note not found or not authorized',
  'Seul un SUPER_ADMIN peut modifier les rôles': 'Only a SUPER_ADMIN can change roles',
  'Un admin ne peut pas modifier son propre rôle': 'An admin cannot change their own role',
  "La cible n'est pas un compte administrateur": 'The target is not an administrator account',
  'Seul un SUPER_ADMIN peut définir un mot de passe': 'Only a SUPER_ADMIN can set a password',
  'Décision KYC invalide': 'Invalid KYC decision',
  'Seul un SUPER_ADMIN peut créer un opérateur': 'Only a SUPER_ADMIN can create an operator',
  'Seul un SUPER_ADMIN peut supprimer un opérateur': 'Only a SUPER_ADMIN can delete an operator',
  'Seul un SUPER_ADMIN peut modifier le statut': 'Only a SUPER_ADMIN can change the status',
  'Un admin ne peut pas se supprimer lui-même': 'An admin cannot delete themselves',
  'Un admin ne peut pas se désactiver lui-même': 'An admin cannot deactivate themselves',
  'Compte administrateur désactivé': 'Administrator account is disabled',

  // --- Validation de champs ---
  'content est requis': 'content is required',
  'resolution est requis': 'resolution is required',
  'transactionId et reason sont requis': 'transactionId and reason are required',
  'updates est requis (objet clé→valeur)': 'updates is required (key→value object)',

  // --- Webhooks / opérateurs ---
  'Signature webhook CamPay invalide': 'Invalid CamPay webhook signature',
  'Signature webhook Orange Money invalide': 'Invalid Orange Money webhook signature',
  'Signature webhook Orange Money manquante': 'Missing Orange Money webhook signature',
  'Token webhook MTN MoMo invalide': 'Invalid MTN MoMo webhook token',
  'Token webhook MTN MoMo manquant': 'Missing MTN MoMo webhook token',
  'Montant webhook CamPay incohérent avec la transaction':
    'CamPay webhook amount inconsistent with the transaction',

  // --- Préfixes (messages interpolés) ---
  'Authentification CamPay échouée : ': 'CamPay authentication failed: ',
  'Initiation du paiement CamPay échouée : ': 'CamPay payment initiation failed: ',
  'Initiation du retrait CamPay échouée : ': 'CamPay withdrawal initiation failed: ',
  'Vérification statut CamPay échouée : ': 'CamPay status check failed: ',
  'Rôle invalide : ': 'Invalid role: ',
};
