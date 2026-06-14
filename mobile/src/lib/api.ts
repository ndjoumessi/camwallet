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
// Instance axios + intercepteurs (Bearer + refresh automatique sur 401)
// ─────────────────────────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    const isAuthRoute = original?.url?.includes('/auth/');
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
  role: string;
  status: string;
  kycStatus: string;
  wallet: { balance: number; currency: string; isActive: boolean } | null;
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

  logout: () => clearTokens(),
};

export const userApi = {
  getMe: () => api.get<MeResponse>('/users/me').then((r) => r.data),
};

export const walletApi = {
  getBalance: () => api.get<BalanceResponse>('/wallets/balance').then((r) => r.data),

  recharge: (amount: number, operator: MobileOperator, phone?: string) =>
    api.post('/wallets/recharge', { amount, operator, phone }).then((r) => r.data),

  withdraw: (amount: number, operator: MobileOperator, phone?: string) =>
    api.post('/wallets/withdraw', { amount, operator, phone }).then((r) => r.data),
};

export const transactionsApi = {
  getHistory: (page = 1, limit = 20) =>
    api
      .get<Paginated<ApiTransaction>>('/transactions/history', { params: { page, limit } })
      .then((r) => r.data),

  p2p: (phone: string, amount: number, description?: string) =>
    api
      .post<ApiTransaction>('/transactions/p2p', { phone, amount, description })
      .then((r) => r.data),
};

export default api;
