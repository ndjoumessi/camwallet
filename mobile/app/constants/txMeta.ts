import { Colors } from './theme';

export interface TxMeta {
  label: string;
  icon: string;
  amountColor: string;
  badgeBg: string;
  badgeText: string;
}

const TX: Record<string, TxMeta> = {
  received:   { label: 'Reçu',          icon: 'arrow-down',         amountColor: Colors.primary,   badgeBg: '#008F6A', badgeText: '#FFFFFF' },
  recharge:   { label: 'Recharge',      icon: 'flash',              amountColor: Colors.primary,   badgeBg: '#00C896', badgeText: '#FFFFFF' },
  refund:     { label: 'Remboursement', icon: 'arrow-undo-outline', amountColor: Colors.blue,      badgeBg: '#1E3A5F', badgeText: '#60A5FA' },
  sent:       { label: 'Envoyé',        icon: 'arrow-up',           amountColor: Colors.textSoft,  badgeBg: '#2D3748', badgeText: '#94A3B8' },
  withdrawal: { label: 'Retrait',       icon: 'cash-outline',       amountColor: '#FB923C',        badgeBg: '#7C2D12', badgeText: '#FB923C' },
  qr_payment: { label: 'QR Payment',   icon: 'qr-code-outline',    amountColor: Colors.blue,      badgeBg: '#1E3A5F', badgeText: '#60A5FA' },
};

const FALLBACK: TxMeta = {
  label: 'Transaction', icon: 'swap-horizontal-outline',
  amountColor: Colors.textSoft, badgeBg: '#2D3748', badgeText: '#94A3B8',
};

export const txMeta = (type: string): TxMeta => TX[type] ?? FALLBACK;
