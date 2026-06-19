import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const API_ORIGIN = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const BASE_URL = `${API_ORIGIN}/api/v1`;

const ACCESS_KEY = 'cw_access_token';
const REFRESH_KEY = 'cw_refresh_token';

// UUID v4 pour les clés d'idempotence. Math.random suffit ici : on a besoin
// d'unicité (pas d'imprévisibilité cryptographique). Une nouvelle clé est générée
// à chaque transaction initiée ; le retry réseau réutilise la même (config axios
// conservée), donc le serveur dédoublonne (cf. backend IdempotencyMiddleware).
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
// Header d'idempotence prêt à l'emploi pour un POST financier.
const idemHeaders = () => ({ headers: { 'Idempotency-Key': uuidv4() } });

// ─────────────────────────────────────────────────────────────────────────────
// Stockage des tokens — expo-secure-store, avec repli mémoire (ex: web/SSR)
// ─────────────────────────────────────────────────────────────────────────────
let memAccess: string | null = null;
let memRefresh: string | null = null;

async function persist(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* SecureStore indisponible : on garde la valeur en mémoire */
  }
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  memAccess = accessToken;
  memRefresh = refreshToken;
  await persist(ACCESS_KEY, accessToken);
  await persist(REFRESH_KEY, refreshToken);
}

export async function clearTokens(): Promise<void> {
  memAccess = null;
  memRefresh = null;
  try {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    /* no-op */
  }
}

async function getAccessToken(): Promise<string | null> {
  if (memAccess) return memAccess;
  try {
    memAccess = await SecureStore.getItemAsync(ACCESS_KEY);
  } catch {
    /* no-op */
  }
  return memAccess;
}

async function getRefreshToken(): Promise<string | null> {
  if (memRefresh) return memRefresh;
  try {
    memRefresh = await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    /* no-op */
  }
  return memRefresh;
}

export async function hasSession(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry avec backoff exponentiel (erreurs réseau et 5xx uniquement)
// Ne s'applique pas aux routes auth.
// ─────────────────────────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // 3 tentatives après l'essai initial

async function withRetry<T>(fn: () => Promise<T>, isAuthRoute: boolean): Promise<T> {
  if (isAuthRoute) return fn();

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      // Ne retry que si pas de réponse (réseau) ou 5xx — jamais les 4xx.
      const isRetryable = status === undefined || status >= 500;
      if (!isRetryable || attempt === RETRY_DELAYS_MS.length) throw err;
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Moniteur de qualité réseau (basé sur la latence mesurée + état de retry).
// Pensé pour les connexions lentes (2G/3G) : pas de module natif, on déduit la
// qualité du temps de réponse réel — plus pertinent que le type de radio.
// ─────────────────────────────────────────────────────────────────────────────
export type NetQuality = 'offline' | 'slow' | 'medium' | 'good';
export interface NetworkState { quality: NetQuality; latencyMs: number | null; retrying: boolean }

let netState: NetworkState = { quality: 'good', latencyMs: null, retrying: false };
const netListeners = new Set<(s: NetworkState) => void>();

function emitNet(patch: Partial<NetworkState>): void {
  netState = { ...netState, ...patch };
  netListeners.forEach((l) => l(netState));
}
// Seuils de latence (ms) : < 600 bon, < 1500 moyen, sinon lent.
function qualityForLatency(ms: number): NetQuality {
  return ms < 600 ? 'good' : ms < 1500 ? 'medium' : 'slow';
}
export function getNetworkState(): NetworkState {
  return netState;
}
export function subscribeNetwork(fn: (s: NetworkState) => void): () => void {
  netListeners.add(fn);
  fn(netState);
  return () => { netListeners.delete(fn); };
}

// ─────────────────────────────────────────────────────────────────────────────
// Instance axios + intercepteurs (Bearer + refresh automatique sur 401)
// ─────────────────────────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  // gzip : on accepte les réponses compressées (le backend a le middleware
  // `compression`). Réduit fortement le volume sur 2G/3G.
  headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  (config as any).metadata = { start: Date.now() };
  return config;
});

// Un seul refresh à la fois : les requêtes 401 concurrentes attendent la même promesse.
let refreshing: Promise<string | null> | null = null;

async function refreshSession(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    // axios "nu" (pas l'instance) pour éviter la boucle d'intercepteurs.
    const { data } = await axios.post<AuthTokens>(`${BASE_URL}/auth/refresh`, {
      refreshToken,
    });
    await saveTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

api.interceptors.response.use(
  (response) => {
    // Mesure de latence → qualité réseau (réinitialise l'état de retry).
    const start = (response.config as any)?.metadata?.start as number | undefined;
    if (start) emitNet({ quality: qualityForLatency(Date.now() - start), latencyMs: Date.now() - start, retrying: false });
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean; _retryCount?: number })
      | undefined;

    const isAuthRoute = original?.url?.includes('/auth/');

    // ── Retry backoff sur erreurs réseau ou 5xx (hors auth) ──────────────
    if (!isAuthRoute && original) {
      const status = error.response?.status;
      const isRetryable = status === undefined || status >= 500;
      const retryCount = original._retryCount ?? 0;
      if (isRetryable && retryCount < RETRY_DELAYS_MS.length) {
        original._retryCount = retryCount + 1;
        // Signale à l'UI une connexion lente + tentative en cours.
        emitNet({ quality: 'slow', retrying: true });
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[retryCount]));
        return api(original);
      }
      // Échec réseau définitif (pas de réponse) → hors ligne.
      if (status === undefined) emitNet({ quality: 'offline', retrying: false });
    }

    // ── Refresh sur 401 ───────────────────────────────────────────────────
    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;
      refreshing = refreshing ?? refreshSession();
      const newToken = await refreshing;
      refreshing = null;

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Types (alignés sur les réponses du backend — montants en centimes FCFA)
// ─────────────────────────────────────────────────────────────────────────────
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type ApiTransactionType =
  | 'P2P'
  | 'QR_PAYMENT'
  | 'RECHARGE'
  | 'WITHDRAWAL'
  | 'REFUND';

export type ApiTransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED';

export interface ApiParty {
  phone: string;
  fullName: string | null;
}

export interface ApiTransaction {
  id: string;
  reference: string;
  type: ApiTransactionType;
  status: ApiTransactionStatus;
  amount: number;
  fee: number;
  senderId: string | null;
  receiverId: string | null;
  description: string | null;
  createdAt: string;
  sender: ApiParty | null;
  receiver: ApiParty | null;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface BalanceResponse {
  balance: number;
  currency: string;
  dailyLimit: number;
  monthlyLimit: number;
  isActive: boolean;
}

export interface MeResponse {
  id: string;
  phone: string;
  phoneCode: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  city: string | null;
  role: string;
  status: string;
  kycStatus: string;
  createdAt: string;
  wallet: { balance: number; currency: string; isActive: boolean } | null;
  stats: { transactionsCount: number; totalSent: number; totalReceived: number };
}

export interface UpdateProfilePayload {
  fullName?: string;
  email?: string;
  city?: string;
  dateOfBirth?: string;
}

export type MobileOperator = 'ORANGE_MONEY' | 'MTN_MOMO';

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (phone: string, fullName?: string) =>
    api
      .post<{ message: string; userId: string }>('/auth/register', { phone, fullName })
      .then((r) => r.data),

  verifyOtp: (userId: string, code: string) =>
    api
      .post<{ message: string; userId: string }>('/auth/verify-otp', { userId, code })
      .then((r) => r.data),

  async setPin(userId: string, pin: string): Promise<AuthTokens> {
    const { data } = await api.post<AuthTokens>('/auth/set-pin', { userId, pin });
    await saveTokens(data.accessToken, data.refreshToken);
    return data;
  },

  async login(phone: string, pin: string): Promise<AuthTokens> {
    const { data } = await api.post<AuthTokens>('/auth/login', { phone, pin });
    await saveTokens(data.accessToken, data.refreshToken);
    return data;
  },

  // Déclenche l'envoi d'un OTP SMS pour réinitialiser le PIN.
  requestPinReset: (phone: string) =>
    api
      .post<{ message: string; userId: string }>('/auth/pin-reset/request', { phone })
      .then((r) => r.data),

  // Invalide le refresh token côté serveur, puis supprime les tokens locaux.
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Si le serveur est injoignable, on déconnecte quand même localement.
    }
    await clearTokens();
  },

  changePin: (currentPin: string, newPin: string) =>
    api
      .patch<{ message: string }>('/auth/change-pin', { currentPin, newPin })
      .then((r) => r.data),

  // Vérifie le PIN courant sans reconnexion (étape 1 du changement de PIN).
  verifyPin: (pin: string) =>
    api.post<{ valid: boolean }>('/auth/verify-pin', { pin }).then((r) => r.data),
};

export const userApi = {
  getMe: () => api.get<MeResponse>('/users/me').then((r) => r.data),

  updateProfile: (payload: UpdateProfilePayload) =>
    api.patch<MeResponse>('/users/profile', payload).then((r) => r.data),

  // Upload de la photo de profil (multipart). `uri` provient d'expo-image-picker.
  uploadAvatar: (uri: string) => {
    const form = new FormData();
    const name = uri.split('/').pop() ?? 'avatar.jpg';
    const ext = (name.split('.').pop() ?? 'jpg').toLowerCase();
    const type = ext === 'png' ? 'image/png' : 'image/jpeg';
    // RN FormData accepte { uri, name, type }.
    form.append('file', { uri, name, type } as any);
    return api
      .post<{ avatarUrl: string }>('/users/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  registerPushToken: (pushToken: string) =>
    api.post('/users/push-token', { pushToken }).then((r) => r.data),

  deleteAccount: () =>
    api.delete<{ ok: boolean }>('/users/me').then((r) => r.data),
};

export interface KycStatusResponse {
  kycStatus: string;
  document: { status: string; reviewNote: string | null; submittedAt: string; reviewedAt: string | null } | null;
}

export const kycApi = {
  getStatus: () => api.get<KycStatusResponse>('/kyc/status').then((r) => r.data),

  // Soumet les 3 photos (URIs expo-camera) en multipart.
  submit: (uris: { idFront: string; idBack: string; selfie: string }) => {
    const form = new FormData();
    (['idFront', 'idBack', 'selfie'] as const).forEach((key) => {
      form.append(key, { uri: uris[key], name: `${key}.jpg`, type: 'image/jpeg' } as any);
    });
    return api
      .post<{ status: string }>('/kyc/submit', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

export const walletApi = {
  getBalance: () => api.get<BalanceResponse>('/wallets/balance').then((r) => r.data),

  recharge: (amount: number, operator: MobileOperator, phone?: string) =>
    api.post('/wallets/recharge', { amount, operator, phone }, idemHeaders()).then((r) => r.data),

  withdraw: (amount: number, operator: MobileOperator, phone?: string) =>
    api.post('/wallets/withdraw', { amount, operator, phone }, idemHeaders()).then((r) => r.data),
};

export const transactionsApi = {
  getHistory: (page = 1, limit = 20) =>
    api
      .get<Paginated<ApiTransaction>>('/transactions/history', { params: { page, limit } })
      .then((r) => r.data),

  p2p: (phone: string, amount: number, description?: string) =>
    api
      .post<ApiTransaction>('/transactions/p2p', { phone, amount, description }, idemHeaders())
      .then((r) => r.data),
};

export interface MerchantPeriodStats {
  count: number;
  amount: number;
  fees: number;
}

export interface MerchantStatsResponse {
  balance: number;
  day: MerchantPeriodStats;
  week: { count: number; amount: number };
  month: { count: number; amount: number };
}

export interface MerchantTransaction {
  id: string;
  type: ApiTransactionType;
  amount: number;
  fee: number;
  status: ApiTransactionStatus;
  description: string | null;
  createdAt: string;
  sender: ApiParty | null;
}

export const merchantApi = {
  getStats: () =>
    api.get<MerchantStatsResponse>('/merchant/stats').then((r) => r.data),

  getTransactions: (page = 1, limit = 20) =>
    api
      .get<Paginated<MerchantTransaction>>('/merchant/transactions', { params: { page, limit } })
      .then((r) => r.data),
};

export interface DisputeResponse {
  id: string;
  status: string;
  message: string;
}

// Contestation telle que renvoyée par GET /disputes/me (avec la transaction liée).
export interface MyDispute {
  id: string;
  transactionId: string;
  reason: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  transaction: ApiTransaction | null;
}

export const disputeApi = {
  open: (transactionId: string, reason: string) =>
    api
      .post<DisputeResponse>('/disputes', { transactionId, reason })
      .then((r) => r.data),

  // Liste les contestations de l'utilisateur courant.
  getMine: () => api.get<MyDispute[]>('/disputes/me').then((r) => r.data),
};

export interface LoyaltyBalance {
  points: number;
  level: { key: string; label: string; emoji: string };
  nextLevel: { key: string; label: string; emoji: string; at: number } | null;
  pointsToNext: number;
  progress: number; // 0-100
  // Seuils configurés (depuis l'admin) — l'affichage des paliers est dynamique.
  levels: { key: string; label: string; emoji: string; min: number }[];
}
export interface LoyaltyEvent {
  id: string;
  points: number;
  reason: string;
  createdAt: string;
  amountCentimes?: number | null; // montant de la transaction source (centimes), null si N/A
}

export const loyaltyApi = {
  // Solde de points + niveau + progression vers le palier suivant.
  getBalance: () => api.get<LoyaltyBalance>('/loyalty/balance').then((r) => r.data),
  // Historique des gains de points.
  getHistory: () => api.get<LoyaltyEvent[]>('/loyalty/history').then((r) => r.data),
};

export default api;
