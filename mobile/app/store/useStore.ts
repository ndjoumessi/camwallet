import { create } from 'zustand';
import { format } from 'date-fns';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  authApi,
  userApi,
  walletApi,
  transactionsApi,
  disputeApi,
  clearTokens,
  hasSession,
  ApiTransaction,
  ApiTransactionStatus,
  ApiTransactionType,
} from '../../src/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types exposés (conservés pour les écrans)
// ─────────────────────────────────────────────────────────────────────────────
export type TransactionType = 'sent' | 'received' | 'recharge' | 'withdrawal' | 'refund' | 'qr_payment';

export interface Transaction {
  id: string;
  type: TransactionType;
  name: string;
  amount: number; // en FCFA, signé (négatif = sortant)
  date: string;
  status: 'success' | 'pending' | 'failed';
  ref: string;
  motif?: string;
  // Champs bruts conservés pour l'écran de détail / la timeline / la règle 24h.
  createdAt: string; // ISO brut
  fee: number; // en FCFA (valeur absolue)
  rawType: ApiTransactionType; // type API d'origine (P2P, QR_PAYMENT, …)
  direction: 'in' | 'out';
  counterpartyName: string | null;
  counterpartyPhone: string | null;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  avatar: string;
  color: string;
}

export interface RecentContact {
  phone: string; // format +237...
  name: string;
  initials: string;
  color: string;
}

export interface User {
  id: string | null;
  name: string;
  phone: string;
  avatar: string;
  balance: number; // en FCFA
  verified: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de conversion (le backend manipule des centimes FCFA)
// ─────────────────────────────────────────────────────────────────────────────
const toFcfa = (centimes: number) => Math.round(centimes / 100);
const toCentimes = (fcfa: number) => Math.round(fcfa * 100);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const ini = parts.map((p) => p.charAt(0).toUpperCase()).join('');
  return ini || '?';
}

function mapStatus(s: ApiTransactionStatus): Transaction['status'] {
  if (s === 'COMPLETED') return 'success';
  if (s === 'PENDING' || s === 'PROCESSING') return 'pending';
  return 'failed';
}

function formatDate(iso: string): string {
  try {
    return format(new Date(iso), 'dd/MM/yyyy HH:mm');
  } catch {
    return iso;
  }
}

// Convertit une transaction API → forme attendue par l'UI (montant en FCFA signé).
function mapTransaction(t: ApiTransaction, meId: string | null): Transaction {
  const isIncoming = t.receiverId === meId;
  let type: TransactionType;
  if (t.type === 'RECHARGE') type = 'recharge';
  else if (t.type === 'WITHDRAWAL') type = 'withdrawal';
  else if (t.type === 'REFUND') type = 'refund';
  else if (t.type === 'QR_PAYMENT') type = isIncoming ? 'received' : 'qr_payment';
  else type = isIncoming ? 'received' : 'sent';

  let name: string;
  if (type === 'recharge') name = 'Recharge Mobile Money';
  else if (type === 'withdrawal') name = 'Retrait Mobile Money';
  else if (type === 'refund') name = 'Remboursement';
  else if (type === 'qr_payment') name = 'Paiement QR';
  else {
    const party = isIncoming ? t.sender : t.receiver;
    name = party?.fullName || party?.phone || '—';
  }

  const fcfa = toFcfa(t.amount);
  const outgoing = type === 'sent' || type === 'withdrawal' || type === 'qr_payment';
  const counterparty = isIncoming ? t.sender : t.receiver;

  return {
    id: t.id,
    type,
    name,
    amount: outgoing ? -fcfa : fcfa,
    date: formatDate(t.createdAt),
    status: mapStatus(t.status),
    ref: t.reference,
    motif: t.description ?? undefined,
    createdAt: t.createdAt,
    fee: toFcfa(t.fee ?? 0),
    rawType: t.type,
    direction: outgoing ? 'out' : 'in',
    counterpartyName: counterparty?.fullName ?? null,
    counterpartyPhone: counterparty?.phone ?? null,
  };
}

function errorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: string | string[] } | undefined;
    const m = data?.message;
    if (Array.isArray(m)) return m.join(', ');
    return m ?? e.message;
  }
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

const CONTACT_COLORS = ['#F5C542', '#3B82F6', '#FF4D6D', '#A78BFA', '#F97316', '#00C896', '#FFCC00'];

const GUEST: User = {
  id: null,
  name: 'Invité',
  phone: '',
  avatar: '?',
  balance: 0,
  verified: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────
interface AppState {
  user: User;
  balance: number; // FCFA
  dailyLimit: number; // FCFA
  monthlyLimit: number; // FCFA
  showBalance: boolean;
  contacts: Contact[]; // conservé pour rétrocompatibilité
  recentContacts: RecentContact[]; // dérivés de l'historique API
  transactions: Transaction[];
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  historyPage: number;
  historyHasMore: boolean;
  historyLoading: boolean;

  // Détail transaction (écran partagé ouvert depuis Accueil / Historique / deep-link)
  selectedTransaction: Transaction | null;
  // Identifiants des transactions déjà contestées (pour masquer le bouton remboursement)
  disputedTxIds: string[];

  pinAttempts: number;
  pinBlocked: boolean;

  // Actions locales
  setBalance: (balance: number) => void;
  toggleShowBalance: () => void;
  addTransaction: (tx: Transaction) => void;
  setAuthenticated: (val: boolean) => void;
  setAuthentication: (val: boolean) => void;
  incrementPinAttempts: () => void;
  resetPinAttempts: () => void;

  // Actions API
  register: (phone: string, fullName?: string) => Promise<string>;
  verifyOtp: (userId: string, code: string) => Promise<void>;
  setPin: (userId: string, pin: string) => Promise<void>;
  login: (phone: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<boolean>;
  loadProfile: () => Promise<void>;
  fetchBalance: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  fetchHistoryPage: (page: number) => Promise<void>;
  resetHistory: () => void;
  sendMoney: (phone: string, amountFcfa: number, description?: string) => Promise<void>;

  // Détail transaction + contestations
  openTransaction: (tx: Transaction) => void;
  openTransactionById: (id: string) => Promise<void>;
  closeTransaction: () => void;
  fetchMyDisputes: () => Promise<void>;
  markDisputed: (txId: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  user: GUEST,
  balance: 0,
  dailyLimit: 0,
  monthlyLimit: 0,
  showBalance: true,
  contacts: [],
  recentContacts: [],
  transactions: [],
  isAuthenticated: false,
  loading: false,
  error: null,
  historyPage: 1,
  historyHasMore: true,
  historyLoading: false,
  selectedTransaction: null,
  disputedTxIds: [],
  pinAttempts: 0,
  pinBlocked: false,

  // ── Actions locales ────────────────────────────────────────────────────────
  setBalance: (balance) => set({ balance }),
  toggleShowBalance: () => set((s) => ({ showBalance: !s.showBalance })),
  addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions] })),
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setAuthentication: (val) => set({ isAuthenticated: val }),
  incrementPinAttempts: () =>
    set((s) => {
      const attempts = s.pinAttempts + 1;
      return { pinAttempts: attempts, pinBlocked: attempts >= 3 };
    }),
  resetPinAttempts: () => set({ pinAttempts: 0, pinBlocked: false }),

  // ── Inscription (3 étapes) ───────────────────────────────────────────────────
  register: async (phone, fullName) => {
    set({ loading: true, error: null });
    try {
      const res = await authApi.register(phone, fullName);
      return res.userId;
    } catch (e) {
      set({ error: errorMessage(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (userId, code) => {
    set({ loading: true, error: null });
    try {
      await authApi.verifyOtp(userId, code);
    } catch (e) {
      set({ error: errorMessage(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  setPin: async (userId, pin) => {
    set({ loading: true, error: null });
    try {
      await authApi.setPin(userId, pin);
      set({ isAuthenticated: true });
      await get().loadProfile();
      await Promise.all([get().fetchBalance(), get().fetchHistory()]);
    } catch (e) {
      set({ error: errorMessage(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  // ── Connexion ────────────────────────────────────────────────────────────────
  login: async (phone, pin) => {
    set({ loading: true, error: null });
    try {
      await authApi.login(phone, pin);
      set({ isAuthenticated: true });
      await get().loadProfile();
      await Promise.all([get().fetchBalance(), get().fetchHistory()]);
      get().resetPinAttempts();
    } catch (e) {
      set({ error: errorMessage(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await authApi.logout(); // invalide le refresh token côté serveur puis vide SecureStore
    set({
      isAuthenticated: false,
      user: GUEST,
      balance: 0,
      transactions: [],
      recentContacts: [],
      selectedTransaction: null,
      disputedTxIds: [],
      error: null,
    });
  },

  // Restaure une session existante (tokens en SecureStore) au démarrage.
  restoreSession: async () => {
    if (!(await hasSession())) return false;
    try {
      set({ isAuthenticated: true });
      await get().loadProfile();
      await Promise.all([get().fetchBalance(), get().fetchHistory()]);
      return true;
    } catch {
      await get().logout();
      return false;
    }
  },

  // ── Données ──────────────────────────────────────────────────────────────────
  loadProfile: async () => {
    const me = await userApi.getMe();
    const name = me.fullName || me.phone;
    const balance = me.wallet ? toFcfa(me.wallet.balance) : 0;
    set({
      user: {
        id: me.id,
        name,
        phone: me.phone,
        avatar: initials(name),
        balance,
        verified: me.kycStatus === 'APPROVED',
      },
      balance,
    });
  },

  fetchBalance: async () => {
    try {
      const b = await walletApi.getBalance();
      const fcfa = toFcfa(b.balance);
      set((s) => ({
        balance: fcfa,
        user: { ...s.user, balance: fcfa },
        dailyLimit: toFcfa(b.dailyLimit ?? 0),
        monthlyLimit: toFcfa(b.monthlyLimit ?? 0),
      }));
      void AsyncStorage.setItem('cw_cached_balance', String(fcfa));
    } catch (e) {
      // Mode hors ligne : charger le solde mis en cache
      const cached = await AsyncStorage.getItem('cw_cached_balance');
      if (cached !== null) {
        const fcfa = Number(cached);
        set((s) => ({
          balance: fcfa,
          user: { ...s.user, balance: fcfa },
          error: 'Mode hors ligne — solde affiché depuis le cache',
        }));
      }
    }
  },

  fetchHistory: async () => {
    const meId = get().user.id;
    const myPhone = get().user.phone;
    const res = await transactionsApi.getHistory(1, 50);

    // Dériver les contacts récents depuis les P2P (pas d'API contacts dédiée)
    const seen = new Set<string>();
    const recentContacts: RecentContact[] = [];
    for (const t of res.data) {
      if (t.type !== 'P2P') continue;
      const isIncoming = t.receiverId === meId;
      const party = isIncoming ? t.sender : t.receiver;
      if (!party?.phone || party.phone === myPhone) continue;
      if (seen.has(party.phone)) continue;
      seen.add(party.phone);
      const name = party.fullName || party.phone;
      recentContacts.push({
        phone: party.phone,
        name,
        initials: initials(name),
        color: CONTACT_COLORS[recentContacts.length % CONTACT_COLORS.length],
      });
      if (recentContacts.length >= 5) break;
    }

    set({ transactions: res.data.map((t) => mapTransaction(t, meId)), recentContacts });
    void get().fetchMyDisputes();
  },

  resetHistory: () => {
    set({ transactions: [], historyPage: 1, historyHasMore: true, historyLoading: false });
  },

  fetchHistoryPage: async (page: number) => {
    const { historyLoading, historyHasMore } = get();
    if (historyLoading || (!historyHasMore && page > 1)) return;
    const LIMIT = 20;
    set({ historyLoading: true });
    try {
      const meId = get().user.id;
      const res = await transactionsApi.getHistory(page, LIMIT);
      const newTxs = res.data.map((t) => mapTransaction(t, meId));
      const hasMore = res.data.length === LIMIT;
      if (page === 1) {
        set({ transactions: newTxs, historyPage: 1, historyHasMore: hasMore });
      } else {
        set((s) => ({
          transactions: [...s.transactions, ...newTxs],
          historyPage: page,
          historyHasMore: hasMore,
        }));
      }
    } catch {
      // échec silencieux — les données existantes restent affichées
    } finally {
      set({ historyLoading: false });
    }
  },

  // ── Détail transaction + contestations ──────────────────────────────────────
  openTransaction: (tx) => set({ selectedTransaction: tx }),

  // Ouvre le détail à partir d'un identifiant (deep-link notification). La
  // transaction est cherchée dans l'historique déjà chargé ; sinon on recharge
  // la première page avant de réessayer.
  openTransactionById: async (id) => {
    const found = get().transactions.find((t) => t.id === id);
    if (found) {
      set({ selectedTransaction: found });
      return;
    }
    await get().fetchHistoryPage(1);
    const after = get().transactions.find((t) => t.id === id);
    if (after) set({ selectedTransaction: after });
  },

  closeTransaction: () => set({ selectedTransaction: null }),

  fetchMyDisputes: async () => {
    try {
      const disputes = await disputeApi.getMine();
      set({ disputedTxIds: disputes.map((d) => d.transactionId) });
    } catch {
      // échec silencieux — le bouton remboursement reste disponible
    }
  },

  markDisputed: (txId) =>
    set((s) => ({ disputedTxIds: s.disputedTxIds.includes(txId) ? s.disputedTxIds : [...s.disputedTxIds, txId] })),

  // ── Paiement P2P ─────────────────────────────────────────────────────────────
  sendMoney: async (phone, amountFcfa, description) => {
    set({ loading: true, error: null });
    try {
      const meId = get().user.id;
      const tx = await transactionsApi.p2p(phone, toCentimes(amountFcfa), description);
      set((s) => ({ transactions: [mapTransaction(tx, meId), ...s.transactions] }));
      await get().fetchBalance();
    } catch (e) {
      set({ error: errorMessage(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },
}));
