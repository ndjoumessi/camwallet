import { create } from 'zustand';

export type TransactionType = 'sent' | 'received' | 'recharge' | 'withdrawal';

export interface Transaction {
  id: string;
  type: TransactionType;
  name: string;
  amount: number;
  date: string;
  status: 'success' | 'pending' | 'failed';
  ref: string;
  motif?: string;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  avatar: string;
  color: string;
}

export interface User {
  name: string;
  phone: string;
  avatar: string;
  balance: number;
  verified: boolean;
}

interface AppState {
  user: User;
  balance: number;
  showBalance: boolean;
  contacts: Contact[];
  transactions: Transaction[];
  isAuthenticated: boolean;
  pinAttempts: number;
  pinBlocked: boolean;

  // Actions
  setBalance: (balance: number) => void;
  toggleShowBalance: () => void;
  addTransaction: (tx: Transaction) => void;
  setAuthenticated: (val: boolean) => void;
  incrementPinAttempts: () => void;
  resetPinAttempts: () => void;
  setAuthentication: (val: boolean) => void;
}

const CONTACTS: Contact[] = [
  { id: 1, name: 'Marie Ngono', phone: '670 112 233', avatar: 'MN', color: '#F5C542' },
  { id: 2, name: 'Paul Biya Jr', phone: '655 443 322', avatar: 'PB', color: '#3B82F6' },
  { id: 3, name: 'Awa Fanta', phone: '699 887 766', avatar: 'AF', color: '#FF4D6D' },
  { id: 4, name: 'Sylvain Kotto', phone: '677 554 411', avatar: 'SK', color: '#A78BFA' },
  { id: 5, name: 'Rodrigue Mbé', phone: '681 234 567', avatar: 'RM', color: '#F97316' },
];

const TRANSACTIONS: Transaction[] = [
  { id: 'tx1', type: 'received', name: 'Marie Ngono', amount: 15000, date: "Aujourd'hui, 14h32", status: 'success', ref: 'TX_A1B2C3D4' },
  { id: 'tx2', type: 'sent', name: 'Supermarché Mahima', amount: -8500, date: "Aujourd'hui, 11h05", status: 'success', ref: 'TX_E5F6G7H8' },
  { id: 'tx3', type: 'recharge', name: 'MTN Mobile Money', amount: 50000, date: 'Hier, 09h20', status: 'success', ref: 'TX_I9J0K1L2' },
  { id: 'tx4', type: 'sent', name: 'Paul Biya Jr', amount: -5000, date: 'Hier, 08h00', status: 'success', ref: 'TX_M3N4O5P6' },
  { id: 'tx5', type: 'received', name: 'Awa Fanta', amount: 12000, date: 'Lun. 23 juin', status: 'success', ref: 'TX_Q7R8S9T0' },
  { id: 'tx6', type: 'withdrawal', name: 'Retrait Orange Money', amount: -20000, date: 'Lun. 23 juin', status: 'success', ref: 'TX_U1V2W3X4' },
  { id: 'tx7', type: 'sent', name: 'Boutique Centre Ville', amount: -3200, date: 'Dim. 22 juin', status: 'success', ref: 'TX_Y5Z6A7B8' },
  { id: 'tx8', type: 'received', name: 'Sylvain Kotto', amount: 7500, date: 'Sam. 21 juin', status: 'success', ref: 'TX_C9D0E1F2' },
];

export const useStore = create<AppState>((set) => ({
  user: {
    name: 'Jean-Paul Mbarga',
    phone: '691 234 567',
    avatar: 'JM',
    balance: 87450,
    verified: true,
  },
  balance: 87450,
  showBalance: true,
  contacts: CONTACTS,
  transactions: TRANSACTIONS,
  isAuthenticated: false,
  pinAttempts: 0,
  pinBlocked: false,

  setBalance: (balance) => set({ balance }),
  toggleShowBalance: () => set((s) => ({ showBalance: !s.showBalance })),
  addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions] })),
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  incrementPinAttempts: () =>
    set((s) => {
      const attempts = s.pinAttempts + 1;
      return { pinAttempts: attempts, pinBlocked: attempts >= 3 };
    }),
  resetPinAttempts: () => set({ pinAttempts: 0, pinBlocked: false }),
  setAuthentication: (val) => set({ isAuthenticated: val }),
}));
