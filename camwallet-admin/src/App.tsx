import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext, Fragment, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import i18n from './i18n'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LabelList, Sector,
} from 'recharts'
import {
  LayoutGrid, AlertTriangle, Users as UsersIcon, ClipboardCheck, Zap, Wallet,
  Landmark, TrendingUp, RefreshCw, LogOut, Search, Clock, CheckCircle2, XCircle,
  FileText, Siren, Info, Lock, ArrowUpRight, ArrowDownRight, ArrowRight,
  X, Check, ChevronUp, ChevronDown, ChevronsUpDown,
  ShieldAlert, ArrowLeftRight, Activity, Wifi, WifiOff,
  Settings, Shield, Loader2, Plus, Pencil, Eye, RotateCcw,
  Copy, Smartphone, ArrowDownToLine, ArrowUpFromLine, Percent,
  LifeBuoy, Send, MessageSquare, Trash2, ArrowLeft, Award,
  type LucideIcon,
} from 'lucide-react'
import LoginPage from './LoginPage'
import { generatePdfReport, generateMultiSectionReport } from './lib/pdf'
import CameroonGeoMap from './components/CameroonMap'
import {
  hasSession, logout, toFcfa, SessionExpiredError, getAdminRole,
  getStats, getUsers, getUserStats, getTransactions, getTimeseries, AdminTransaction, AdminUser,
  getKyc, getAlerts, getAlertsTimeline, getAudit, getAuditStats, reviewKyc, analyzeKyc, setUserStatus,
  getUserDetail, resetUserPin,
  getAnifAlerts, openAnifCase, closeAnifCase, assignAnifCase, getAnifStats,
  getOperations, retryOperation, WebhookEvent, AdminOperation,
  getHealthIntegrations,
  getOperatorRates, getSettings, updateSettings,
  getAnalyticsRetention, getAnalyticsAcquisition, getTopMerchants, getTopUsers,
  getAnalyticsHeatmap, getKycFunnel, getAnalyticsGeo, getVolumeByType, getEmailAlertHistory,
  downloadUsersCSV, downloadTransactionsCSV,
  AdminNote, getAdminNotes, addAdminNote, deleteAdminNote,
  setup2FA, verify2FA, disable2FA, get2FAStatus,
  AdminTeamMember, getAdminTeam, getMemberActivity, setAdminRole, setAdminPassword,
  createAdminOperator, deleteAdmin, setAdminStatus, getAdminId,
  getSseTicket, API_ORIGIN,
  getSupportStats, getSupportTickets, getSupportTicket, updateSupportTicket, addSupportMessage, createSupportTicket, deleteSupportTicket,
  SupportTicket, SupportTicketDetail,
} from './lib/api'

// ── Design Tokens ────────────────────────────────────────
const C = {
  bg: '#0A0F1E', surface: '#111827', card: '#161D2F', border: '#1E2D45',
  green: '#00C896', greenDark: '#008F6A', greenLight: '#00C89618',
  blue: '#3B82F6', blueLight: '#3B82F615',
  yellow: '#F5C542', yellowLight: '#F5C54215',
  orange: '#FB923C', orangeLight: '#FB923C18',
  amber: '#B89000',
  cyan: '#22D3EE',
  red: '#FF4D6D', redLight: '#FF4D6D15',
  purple: '#A78BFA', purpleLight: '#A78BFA15',
  text: '#EEF2FF', textMuted: '#64748B', textSoft: '#94A3B8',
  white: '#FFFFFF',
}

// ── Formatters ────────────────────────────────────────────
// Sépare les milliers par une VRAIE espace. toLocaleString('fr-FR') utilise une
// espace fine insécable (U+202F/U+00A0) qu'on normalise pour respecter le format
// demandé : « 1 250 000 FCFA » (espace simple, jamais de virgule).
const groupFr = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')
// Montant déjà en FCFA entiers → « 1 250 000 FCFA ».
const fmt = (n: number) => groupFr(n) + ' FCFA'
// Helper principal : montant en CENTIMES → « 1 250 000 FCFA ».
const formatFCFA = (centimes: number) => fmt(toFcfa(centimes))
// Forme courte pour axes/labels compacts.
const fmtM = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'k') + ' FCFA'
// Couleur sémantique d'un montant signé (négatif = rouge, positif = vert).
const amountColor = (n: number) => (n < 0 ? C.red : n > 0 ? C.green : C.text)

// Convertit une variation backend (%) en props delta/deltaUp du KPICard (#8).
const trendProps = (t: number | null | undefined) =>
  t == null ? {} : { delta: `${Math.abs(t)} %`, deltaUp: t >= 0 }

// ── Mapping enums backend → clés des badges UI ────────────
const USER_STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'verified', SUSPENDED: 'suspended', LOCKED: 'blocked', DELETED: 'rejected',
}
// clé de filtre UI → statut backend (filtrage côté serveur)
const USER_STATUS_FILTER: Record<string, string> = {
  verified: 'ACTIVE', suspended: 'SUSPENDED', blocked: 'LOCKED',
}
const KYC_STATUS_BADGE: Record<string, string> = {
  PENDING: 'pending', SUBMITTED: 'review', APPROVED: 'approved', REJECTED: 'rejected', RESUBMIT_REQUIRED: 'flagged',
}
const KYC_STATUS_COLOR: Record<string, string> = {
  PENDING: C.textMuted, SUBMITTED: C.yellow, APPROVED: C.green, REJECTED: C.red, RESUBMIT_REQUIRED: C.purple,
}
const TX_STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'success', PENDING: 'pending', PROCESSING: 'pending',
  FAILED: 'failed', REFUNDED: 'flagged', CANCELLED: 'failed',
}
// Niveau de risque (dérivé du volume 30j) → couleur.
const RISK_META: Record<string, { color: string }> = {
  'Bas': { color: '#00C896' },
  'Moyen': { color: C.orange },
  'Élevé': { color: '#FF4D6D' },
}
const USER_ROLE_LABEL: Record<string, string> = { USER: 'Utilisateur', MERCHANT: 'Marchand', ADMIN: 'Admin' }
// enum backend → libellé court attendu par TxTypeBadge
const TX_TYPE_LABEL: Record<string, string> = {
  P2P: 'P2P', QR_PAYMENT: 'QR', RECHARGE: 'RECHARGE', WITHDRAWAL: 'RETRAIT', REFUND: 'REFUND',
}
// libellé court (bouton filtre) → enum backend
const TX_TYPE_FILTER: Record<string, string> = {
  P2P: 'P2P', QR: 'QR_PAYMENT', RECHARGE: 'RECHARGE', RETRAIT: 'WITHDRAWAL',
}
const TX_TYPE_COLOR: Record<string, string> = {
  P2P: C.blue, QR_PAYMENT: C.green, RECHARGE: C.yellow, WITHDRAWAL: C.purple, REFUND: C.red,
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

const initials = (name?: string | null) =>
  name ? name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : '?'

const partyLabel = (
  p: { fullName: string | null; phone: string } | null,
  fallback: string,
) => (p ? p.fullName ?? p.phone : fallback)

// Temps relatif court en français : « à l'instant », « il y a 2 h », « il y a 3 j ».
const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return i18n.t('relative_time.now')
  if (min < 60) return i18n.t('relative_time.min', { count: min })
  const h = Math.floor(min / 60)
  if (h < 24) return i18n.t('relative_time.hour', { count: h })
  const d = Math.floor(h / 24)
  if (d < 30) return i18n.t('relative_time.day', { count: d })
  const mo = Math.floor(d / 30)
  return mo < 12 ? i18n.t('relative_time.month', { count: mo }) : i18n.t('relative_time.year', { count: Math.floor(mo / 12) })
}

// Métadonnées d'affichage des opérateurs mobiles (couleur de marque + sigle).
const OPERATOR_META: Record<string, { label: string; color: string; short: string }> = {
  ORANGE_MONEY: { label: 'Orange Money', color: '#FF7900', short: 'OM' },
  MTN_MOMO: { label: 'MTN MoMo', color: '#FFCC00', short: 'MTN' },
  CAMPAY: { label: 'CamPay', color: '#3B82F6', short: 'CP' },
}

// Pastille opérateur : sigle coloré dans un carré + nom complet.
function OperatorBadge({ operator }: { operator: string | null }) {
  const m = operator ? OPERATOR_META[operator] : undefined
  if (!m) return <span style={{ color: C.textMuted, fontSize: 12 }}>—</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, background: m.color + '22', color: m.color, fontSize: 9, fontWeight: 900, letterSpacing: '-0.02em' }}>{m.short}</span>
      <span style={{ color: C.textSoft, fontSize: 12, whiteSpace: 'nowrap' }}>{m.label}</span>
    </span>
  )
}

// Badge de niveau de risque (Bas / Moyen / Élevé) avec pastille colorée.
const RISK_KEY: Record<string, string> = { 'Bas': 'low', 'Moyen': 'medium', 'Élevé': 'high' }
function RiskBadge({ level }: { level?: string }) {
  const m = (level && RISK_META[level]) || RISK_META['Bas']
  const lbl = i18n.t('risk.' + (RISK_KEY[level ?? 'Bas'] ?? 'low'))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: m.color + '1F', color: m.color }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: m.color }} />{lbl}
    </span>
  )
}

// Cellule utilisateur : avatar à initiales coloré + nom (téléphone en second).
// Jamais « — » seul : utilise le fallback (« Opérateur ») quand la partie est absente.
function UserCell({ party, fallback = i18n.t('common.operator') }: { party: { fullName: string | null; phone: string } | null; fallback?: string }) {
  if (!party) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: C.textMuted }}>
        <span style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: C.surface, color: C.textMuted }}><Smartphone size={13} /></span>
        <span style={{ fontSize: 13 }}>{fallback}</span>
      </span>
    )
  }
  const name = party.fullName ?? party.phone
  const hasName = !!party.fullName
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: C.green + '22', color: C.green }}>{initials(name)}</span>
      <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{name}</span>
        {hasName && <span style={{ color: C.textMuted, fontSize: 11 }}>{party.phone}</span>}
      </span>
    </span>
  )
}

// Référence monospace copiable au clic (icône + feedback « copié »).
function CopyableRef({ value, truncate }: { value: string; truncate?: number }) {
  const [copied, setCopied] = useState(false)
  const display = truncate && value.length > truncate ? value.slice(0, truncate) + '…' : value
  const copy = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }
  return (
    <button
      onClick={copy}
      title={`Copier : ${value}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: 12, color: C.textSoft }}
    >
      <span>{display}</span>
      {copied ? <Check size={12} color={C.green} /> : <Copy size={12} color={C.textMuted} />}
    </button>
  )
}

// Génère un rapport PDF de marque (jsPDF + AutoTable, cf. lib/pdf.ts) et le
// télécharge directement. Signature historique conservée (title, columns, rows)
// pour les appelants existants (Finance, ANIF, détail transaction…). Les pages
// Transactions / KYC / Audit appellent generatePdfReport() directement pour
// bénéficier des filtres, statistiques et totaux.
function exportPdfReport(title: string, columns: string[], rows: (string | number)[][]): boolean {
  const slug = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return generatePdfReport({
    title,
    columns,
    rows,
    filename: `${slug || 'rapport'}-camwallet-${new Date().toISOString().slice(0, 10)}.pdf`,
  })
}

// Export CSV généré côté client (séparateur « ; » pour Excel FR, BOM UTF-8).
function downloadCsv(filename: string, columns: string[], rows: (string | number)[][]): void {
  const esc = (s: any) => `"${String(s).replace(/"/g, '""')}"`
  const csv = [columns, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Mini sparkline (area) pour les KPI — sans axes ni grille.
function Sparkline({ data, color = C.green }: { data: number[]; color?: string }) {
  if (!data.length) return null
  const chartData = data.map((v, i) => ({ i, v }))
  const id = `spark-${color.replace('#', '')}`
  return (
    <ResponsiveContainer width="100%" height={34}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Petit bandeau d'état (chargement / erreur / vide) partagé par les pages.
function StateRow({ loading, error, empty }: { loading: boolean; error: string | null; empty?: string }) {
  const { t } = useTranslation()
  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>{t('common.loading')}</div>
  if (error) return <div style={{ textAlign: 'center', padding: 40, color: C.red }}>{error}</div>
  if (empty) return <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>{empty}</div>
  return null
}

// Signal global de rafraîchissement : le bouton « Actualiser » incrémente ce
// nonce ; chaque useFetch monté le surveille et recharge, sans démonter les
// pages (l'état UI — recherche, filtre, scroll — est donc préservé).
const RefreshContext = createContext(0)

// ── Toasts (feedback d'action : succès / erreur) ──────────
type Toast = { id: number; msg: string; type: 'success' | 'error' }
const ToastContext = createContext<(msg: string, type?: 'success' | 'error') => void>(() => {})
const useToast = () => useContext(ToastContext)
let toastSeq = 0

function ToastHost({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 200, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map((t) => {
        const ok = t.type === 'success'
        const Icon = ok ? CheckCircle2 : XCircle
        return (
          <div
            key={t.id}
            className="cw-toast"
            role="status"
            aria-live="polite"
            onClick={() => dismiss(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              minWidth: 240, maxWidth: 360, padding: '12px 14px', borderRadius: 12,
              background: C.surface, border: `1px solid ${ok ? C.green : C.red}55`,
              boxShadow: '0 10px 30px -10px #000A', color: C.text, fontSize: 13, fontWeight: 600,
            }}
          >
            <Icon size={18} color={ok ? C.green : C.red} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{t.msg}</span>
            <X size={15} color={C.textMuted} />
          </div>
        )
      })}
    </div>
  )
}

// Hook de chargement partagé : centralise loading / error / annulation et
// expose refetch(). Chaque source est indépendante — l'échec de l'une
// n'efface pas les données de l'autre.
function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const refreshNonce = useContext(RefreshContext)
  const [localNonce, setLocalNonce] = useState(0)
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e) => {
        if (alive && !(e instanceof SessionExpiredError))
          setError(e instanceof Error ? e.message : i18n.t('common.error_loading'))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // fn est volontairement hors deps (recréée à chaque rendu) ; les nonces forcent le refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshNonce, localNonce])

  return { data, loading, error, refetch: () => setLocalNonce((n) => n + 1) }
}

// Valeur debouncée (utilisée pour la recherche serveur).
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

// ── SSE temps réel ────────────────────────────────────────
// Flux en 2 étapes pour éviter que le JWT transite dans l'URL (loggée côté
// serveur, visible dans l'historique browser et les headers Referer) :
// 1. POST /admin/sse-ticket (Authorization: Bearer JWT) → ticket opaque 60s
// 2. GET  /admin/events?ticket=<opaque>  (ticket single-use)
function useLiveEvents(onEvent: (e: { type: string; payload?: any }) => void) {
  useEffect(() => {
    let source: EventSource | null = null
    let cancelled = false

    // Étape 1 : obtenir un ticket opaque via l'API JSON classique (JWT en header)
    getSseTicket()
      .then(({ ticket }) => {
        if (cancelled) return
        // Étape 2 : ouvrir le flux SSE avec le ticket (pas de JWT dans l'URL)
        source = new EventSource(`${API_ORIGIN}/api/v1/admin/events?ticket=${encodeURIComponent(ticket)}`)
        source.onmessage = (event) => {
          try { onEvent(JSON.parse(event.data)) } catch { /* ignorer */ }
        }
        // EventSource gère la reconnexion automatiquement — pas d'action nécessaire.
      })
      .catch(() => { /* Pas de SSE si le ticket échoue (ex: non connecté) */ })

    return () => {
      cancelled = true
      source?.close()
    }
  }, [onEvent])
}

// ── Status badges ─────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string, text: string, label: string, icon?: LucideIcon }> = {
    success: { bg: '#00C89618', text: C.green, label: t('status.success') },
    pending: { bg: C.yellowLight, text: C.amber, label: t('status.pending') },
    failed: { bg: C.redLight, text: C.red, label: t('status.failed') },
    flagged: { bg: '#A78BFA18', text: C.purple, label: t('status.flagged'), icon: Siren },
    verified: { bg: '#00C89618', text: C.green, label: t('status.verified'), icon: CheckCircle2 },
    blocked: { bg: C.redLight, text: C.red, label: t('status.blocked'), icon: Lock },
    suspended: { bg: '#A78BFA18', text: C.purple, label: t('status.suspended') },
    approved: { bg: '#00C89618', text: C.green, label: t('status.approved') },
    rejected: { bg: C.redLight, text: C.red, label: t('status.rejected') },
    review: { bg: C.yellowLight, text: C.amber, label: t('status.review') },
  }
  const s = map[status] ?? { bg: '#333', text: '#888', label: status }
  const Icon = s.icon
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, background: s.bg, color: s.text,
    }}>{Icon && <Icon size={11} />}{s.label}</span>
  )
}

function TxTypeBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string, text: string }> = {
    P2P: { bg: C.blueLight, text: C.blue },
    QR: { bg: C.greenLight, text: C.green },
    RECHARGE: { bg: C.yellowLight, text: C.amber },
    RETRAIT: { bg: C.purpleLight, text: C.purple },
  }
  const s = map[type] ?? { bg: '#333', text: '#888' }
  const lbl = type === 'RECHARGE' ? i18n.t('tx_type.recharge') : type === 'RETRAIT' ? i18n.t('tx_type.retrait') : type
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.text }}>
      {lbl}
    </span>
  )
}

// ── KPI Card ──────────────────────────────────────────────
function KPICard({ label, value, delta, deltaUp, icon: Icon, color = C.green, sub, spark, badge }: {
  label: string, value: string, delta?: string, deltaUp?: boolean, icon: LucideIcon, color?: string, sub?: string,
  spark?: number[], badge?: number
}) {
  const { t } = useTranslation()
  const TrendIcon = deltaUp ? ArrowUpRight : ArrowDownRight
  return (
    <div
      className="cw-card"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{label}</span>
        <span style={{
          position: 'relative',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
          borderRadius: 10, background: color + '1F', color, flexShrink: 0,
        }}>
          <Icon size={18} />
          {!!badge && badge > 0 && (
            <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: C.yellow, color: '#1A1206', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>
          )}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: C.text, letterSpacing: -0.5, marginBottom: 6 }}>{value}</div>
      {delta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: deltaUp ? C.green : C.red, fontWeight: 600 }}>
          <TrendIcon size={14} className={deltaUp ? 'cw-trend-up' : 'cw-trend-down'} />
          {delta} {t('common.vs_prev_30d')}
        </div>
      )}
      {sub && <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{sub}</div>}
      {spark && spark.length > 1 && <div style={{ marginTop: 10 }}><Sparkline data={spark} color={color} /></div>}
    </div>
  )
}

// ── Chart tooltip ─────────────────────────────────────────
// Les séries monétaires (volume/fees/amount) sont formatées en FCFA ; les
// comptages (tx/users/count) restent des entiers groupés.
const MONEY_KEYS = new Set(['volume', 'fees', 'amount', 'revenue', 'recharge', 'withdrawal'])
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, boxShadow: '0 10px 30px -12px rgba(0,0,0,.6)' }}>
      {label != null && <div style={{ color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color ?? p.payload?.color, flexShrink: 0 }} />
          <span style={{ color: C.textSoft }}>{p.name}</span>
          <strong style={{ marginLeft: 'auto', color: C.text }}>
            {MONEY_KEYS.has(p.dataKey) ? fmt(p.value) : groupFr(p.value)}
          </strong>
        </div>
      ))}
    </div>
  )
}

// Forme active du donut : segment survolé agrandi (+6px de rayon externe).
const renderDonutActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6}
      startAngle={startAngle} endAngle={endAngle} fill={fill} />
  )
}

// ── Pages ────────────────────────────────────────────────
function DashboardPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { t } = useTranslation()
  // Sources indépendantes : l'échec de l'une n'efface pas l'autre.
  const { data: stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useFetch(() => getStats(), [])
  const { data: recentData, loading: recentLoading, error: recentError, refetch: refetchRecent } = useFetch(
    () => getTransactions({ limit: 5 }), [],
  )
  const recent = recentData?.data ?? []

  // Séries temporelles réelles (volume, frais, tx, users) selon la période.
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d')
  const { data: ts } = useFetch(() => getTimeseries(period), [period])
  // Volume groupé par type (sélecteur indépendant) + répartition géographique.
  const [volPeriod, setVolPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const { data: volType } = useFetch(() => getVolumeByType(volPeriod), [volPeriod])
  const { data: dashGeo } = useFetch(() => getAnalyticsGeo(), [])
  // Série 7 j fixe pour les sparklines des KPI (indépendante du sélecteur).
  const { data: ts7 } = useFetch(() => getTimeseries('7d'), [])
  const spark7 = ts7?.series ?? []
  const sparkVolume = spark7.map((p) => toFcfa(p.volume))
  const sparkBalance: number[] = [] // pas de série de solde historique
  const sparkUsers = spark7.map((p) => p.users)
  const sparkTx = spark7.map((p) => p.transactions)
  // Transaction sélectionnée → modale détail (clic sur une ligne récente).
  const [selectedTx, setSelectedTx] = useState<AdminTransaction | null>(null)

  // ── Flux SSE temps réel ────────────────────────────────
  const [liveCount, setLiveCount] = useState(0)
  const [lastEvent, setLastEvent] = useState<{ type: string; time: string } | null>(null)

  const handleLiveEvent = useCallback((event: { type: string; payload?: any }) => {
    if (event.type === 'ping') return
    setLiveCount(c => c + 1)
    setLastEvent({ type: event.type, time: new Date().toLocaleTimeString('fr-FR') })
    refetchStats()
    refetchRecent()
  }, [refetchStats, refetchRecent])

  useLiveEvents(handleLiveEvent)

  // Données de graphes mémoïsées : recalcul uniquement quand la source change
  // (évite de tout recalculer à chaque rendu, ex. hover donut, événements SSE).
  const chart = useMemo(() => (ts?.series ?? []).map((p) => ({
    date: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`,
    volume: toFcfa(p.volume),
    fees: toFcfa(p.fees),
    tx: p.transactions,
    users: p.users,
  })), [ts])
  const PERIODS: { key: '7d' | '30d' | '90d'; label: string }[] = [
    { key: '7d', label: t('dashboard.period_7d') },
    { key: '30d', label: t('dashboard.period_30d') },
    { key: '90d', label: t('dashboard.period_90d') },
  ]

  const donut = useMemo(() => (stats?.transactions.byType ?? []).map((tp) => ({
    name: TX_TYPE_LABEL[tp.type] ?? tp.type,
    value: tp.count,
    color: TX_TYPE_COLOR[tp.type] ?? C.textMuted,
  })), [stats])
  const donutTotal = useMemo(() => donut.reduce((s, d) => s + d.value, 0), [donut])
  // Volume par type (centimes → FCFA) pour le BarChart coloré.
  const volByType = useMemo(() => (stats?.transactions.byType ?? []).map((tp) => ({
    name: TX_TYPE_LABEL[tp.type] ?? tp.type,
    volume: toFcfa(tp.volume),
    color: TX_TYPE_COLOR[tp.type] ?? C.textMuted,
  })), [stats])

  // Volume groupé par type sur la période (BarChart groupé).
  const volTypeData = useMemo(() => (volType?.series ?? []).map((p) => ({
    date: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`,
    P2P: toFcfa(p.P2P), QR: toFcfa(p.QR_PAYMENT), RECHARGE: toFcfa(p.RECHARGE), WITHDRAWAL: toFcfa(p.WITHDRAWAL),
  })), [volType])
  // Tendance des revenus : moyenne mobile (fenêtre 3) sur les frais.
  const chartTrend = useMemo(() => chart.map((c, i, arr) => {
    const w = arr.slice(Math.max(0, i - 2), i + 1)
    return { ...c, trend: Math.round(w.reduce((s, x) => s + x.fees, 0) / w.length) }
  }), [chart])
  // Taux de succès (jauge) depuis byStatus.
  const stByStatus = (s: string) => stats?.transactions.byStatus.find((x) => x.status === s)?.count ?? 0
  const okCount = stByStatus('COMPLETED')
  const koCount = stByStatus('FAILED') + stByStatus('CANCELLED')
  const successRate = okCount + koCount > 0 ? Math.round((okCount / (okCount + koCount)) * 100) : null
  const VOL_PERIODS: ('7d' | '30d' | '90d')[] = ['7d', '30d', '90d']
  const GEO_MAX = Math.max(1, ...(dashGeo?.regions ?? []).map((r) => toFcfa(r.volume)))

  // Transactions par heure (agrégées depuis la heatmap dow×heure) → heures de pointe.
  const { data: heat } = useFetch(() => getAnalyticsHeatmap(), [])
  const byHour = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: String(h).padStart(2, '0') + 'h', count: 0 }))
    for (const c of heat?.cells ?? []) if (c.hour >= 0 && c.hour < 24) buckets[c.hour].count += c.count
    return buckets
  }, [heat])
  const hourPeak = useMemo(() => byHour.reduce((m, b) => (b.count > m.count ? b : m), byHour[0]), [byHour])
  // Donut interactif (segment survolé agrandi) + légende cliquable du BarChart groupé.
  const [activeDonut, setActiveDonut] = useState<number | undefined>(undefined)
  const [hiddenVol, setHiddenVol] = useState<Set<string>>(new Set())
  const toggleVol = useCallback((k: string) => setHiddenVol((prev) => {
    const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n
  }), [])
  const VOL_SERIES = [
    { k: 'P2P', label: TX_TYPE_LABEL['P2P'], color: TX_TYPE_COLOR['P2P'] ?? C.blue },
    { k: 'QR', label: TX_TYPE_LABEL['QR_PAYMENT'], color: TX_TYPE_COLOR['QR_PAYMENT'] ?? C.green },
    { k: 'RECHARGE', label: TX_TYPE_LABEL['RECHARGE'], color: TX_TYPE_COLOR['RECHARGE'] ?? C.yellow },
    { k: 'WITHDRAWAL', label: TX_TYPE_LABEL['WITHDRAWAL'], color: TX_TYPE_COLOR['WITHDRAWAL'] ?? C.purple },
  ]

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{t('dashboard.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{t('dashboard.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.greenLight, border: `1px solid ${C.green}40`, borderRadius: 20, padding: '4px 12px', fontSize: 12, color: C.green, flexShrink: 0 }}>
          <div className="cw-live-dot" style={{ width: 8, height: 8, borderRadius: 4, background: C.green, animation: 'pulse 2s infinite' }} />
          {t('dashboard.live')}{liveCount > 0 && ` · ${liveCount}`}
          {lastEvent && <span style={{ color: C.textMuted, marginLeft: 4 }}>{lastEvent.type} {lastEvent.time}</span>}
        </div>
      </div>

      {(statsLoading || statsError) && <StateRow loading={statsLoading} error={statsError} />}

      {/* KPIs */}
      {stats && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 24 }}>
        <KPICard label={t('dashboard.kpi_volume')} value={formatFCFA(stats.volume.completedAmount)} icon={Wallet}
          {...trendProps(stats.trends.volume)} spark={sparkVolume}
          sub={t('dashboard.kpi_fees_sub', { value: formatFCFA(stats.volume.collectedFees) })} />
        <KPICard label={t('dashboard.kpi_balance')} value={formatFCFA(stats.totalBalance)} icon={Landmark} color={C.purple} spark={sparkBalance} />
        <KPICard label={t('dashboard.kpi_users')} value={stats.users.total.toLocaleString('fr-FR')} icon={UsersIcon} color={C.green}
          {...trendProps(stats.trends.users)} spark={sparkUsers}
          sub={stats.users.byRole.map((r) => `${r.count} ${r.role.toLowerCase()}`).join(' · ')} />
        <KPICard label={t('dashboard.kpi_transactions')} value={stats.transactions.total.toLocaleString('fr-FR')} icon={Zap} color={C.blue}
          {...trendProps(stats.trends.transactions)} spark={sparkTx} badge={stats.transactions.pending}
          sub={t('dashboard.kpi_pending_sub', { count: stats.transactions.pending })} />
      </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Volume par type — barres colorées */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('dashboard.chart_volume')}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={volByType} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="name" stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={{ stroke: C.border }} />
              <YAxis stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} width={42}
                tickFormatter={v => v >= 1_000_000 ? (v / 1_000_000).toFixed(0) + 'M' : (v / 1000).toFixed(0) + 'k'} />
              <Tooltip cursor={{ fill: C.greenLight }} content={<ChartTooltip />} />
              <Bar dataKey="volume" name={t('dashboard.chart_series_volume')} radius={[6, 6, 0, 0]} maxBarSize={56}>
                {volByType.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {volByType.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>{t('dashboard.chart_no_tx')}</div>}
        </div>

        {/* Donut répartition par type — total au centre + légende inline avec % */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('dashboard.chart_donut')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', width: 144, height: 144, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} cx="50%" cy="50%" innerRadius={48} outerRadius={70} dataKey="value"
                    paddingAngle={donut.length > 1 ? 3 : 0} stroke="none"
                    activeIndex={activeDonut} activeShape={renderDonutActiveShape}
                    onMouseEnter={(_, i) => setActiveDonut(i)} onMouseLeave={() => setActiveDonut(undefined)}
                    animationBegin={0} animationDuration={800}>
                    {donut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: C.text, lineHeight: 1 }}>{groupFr(donutTotal)}</span>
                <span style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('dashboard.chart_donut_total')}</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {donut.length === 0 && <span style={{ fontSize: 12, color: C.textMuted }}>{t('dashboard.chart_no_tx')}</span>}
              {donut.map((d, i) => {
                const pct = donutTotal ? Math.round((d.value / donutTotal) * 100) : 0
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, color: C.textSoft }}>{d.name}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{d.value}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: C.text, width: 38, textAlign: 'right' }}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Volume groupé par type — BarChart groupé + sélecteur de période */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{t('dashboard.chart_vol_by_type')}</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {VOL_PERIODS.map((p) => (
              <button key={p} onClick={() => setVolPeriod(p)} aria-pressed={volPeriod === p}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontWeight: volPeriod === p ? 700 : 500, background: volPeriod === p ? C.green : C.surface, border: `1px solid ${volPeriod === p ? C.green : C.border}`, color: volPeriod === p ? '#fff' : C.textMuted }}>
                {t('dashboard.period_' + p)}
              </button>
            ))}
          </div>
        </div>
        {/* Légende interactive : clic pour masquer/afficher une série */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {VOL_SERIES.map((s) => {
            const off = hiddenVol.has(s.k)
            return (
              <button key={s.k} onClick={() => toggleVol(s.k)} aria-pressed={!off}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${C.border}`, background: C.surface, color: off ? C.textMuted : C.text, opacity: off ? 0.5 : 1 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} /> {s.label}
              </button>
            )
          })}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={volTypeData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={{ stroke: C.border }} />
            <YAxis stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} width={40}
              tickFormatter={(v) => v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k'} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: C.greenLight }} />
            {VOL_SERIES.map((s) => (
              <Bar key={s.k} dataKey={s.k} name={s.label} fill={s.color} radius={[3, 3, 0, 0]}
                hide={hiddenVol.has(s.k)} animationBegin={0} animationDuration={800} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        {volTypeData.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>{t('dashboard.chart_no_tx')}</div>}
      </div>

      {/* Transactions par heure (heures de pointe) — AreaChart 24h, gradient émeraude */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('dashboard.chart_by_hour', { defaultValue: 'Transactions par heure' })}</h2>
          {hourPeak && hourPeak.count > 0 && (
            <span style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('dashboard.chart_peak', { hour: hourPeak.label, count: hourPeak.count, defaultValue: `Pic : ${hourPeak.label} (${hourPeak.count})` })}</span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={byHour} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.45} />
                <stop offset="100%" stopColor={C.green} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" stroke={C.textMuted} fontSize={9} tickLine={false} axisLine={{ stroke: C.border }} interval={2} />
            <YAxis stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.green, strokeWidth: 1 }} />
            <Area type="monotone" dataKey="count" name={i18n.t('dashboard.chart_series_tx', { defaultValue: 'Transactions' })}
              stroke={C.green} strokeWidth={2} fill="url(#hourGrad)" animationBegin={0} animationDuration={800} />
          </AreaChart>
        </ResponsiveContainer>
        {byHour.every((b) => b.count === 0) && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>{t('dashboard.chart_no_tx')}</div>}
      </div>

      {/* Taux de succès (jauge) + Répartition géographique */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 12, alignSelf: 'flex-start' }}>{t('dashboard.gauge_title')}</h2>
          {(() => {
            const R = 52, CIRC = 2 * Math.PI * R, pct = successRate ?? 0
            const col = successRate == null ? C.textMuted : successRate >= 95 ? C.green : successRate >= 80 ? C.yellow : C.red
            return (
              <div style={{ position: 'relative', width: 140, height: 140 }}>
                <svg width={140} height={140}>
                  <circle cx={70} cy={70} r={R} stroke={C.border} strokeWidth={12} fill="none" />
                  <circle cx={70} cy={70} r={R} stroke={col} strokeWidth={12} fill="none" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)} transform="rotate(-90 70 70)"
                    style={{ transition: 'stroke-dashoffset .6s ease' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: col, lineHeight: 1 }}>{successRate == null ? '—' : `${successRate}%`}</span>
                  <span style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{t('dashboard.gauge_sub')}</span>
                </div>
              </div>
            )
          })()}
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 10 }}>{okCount.toLocaleString('fr-FR')} ✓ · {koCount.toLocaleString('fr-FR')} ✕</div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('dashboard.geo_title')}</h2>
          {(dashGeo?.regions ?? []).length === 0 ? <div style={{ fontSize: 12, color: C.textMuted }}>{t('dashboard.chart_no_tx')}</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {(dashGeo?.regions ?? []).slice(0, 6).map((r) => (
                <div key={r.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: C.textSoft }}>{r.name} <span style={{ color: C.textMuted }}>· {t('analytics.tx_count', { n: r.transactions })}</span></span>
                    <span style={{ color: C.green, fontWeight: 700 }}>{formatFCFA(r.volume)}</span>
                  </div>
                  <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((toFcfa(r.volume) / GEO_MAX) * 100)}%`, background: C.blue, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Programme de fidélité — total distribué + répartition par niveau */}
      {stats?.loyalty && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Award size={16} color={C.yellow} /> {i18n.t('x.loyalty.title', { defaultValue: 'Programme de fidélité' })}
            </h2>
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.loyalty.total_distributed', { defaultValue: 'Points distribués' })}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{stats.loyalty.totalDistributed.toLocaleString('fr-FR')}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.loyalty.members', { defaultValue: 'Membres' })}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{stats.loyalty.members.toLocaleString('fr-FR')}</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            {stats.loyalty.byLevel.map((lv: { key: string; label: string; emoji: string; count: number }) => (
              <div key={lv.key} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>{lv.emoji}</span>
                <div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{lv.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{lv.count.toLocaleString('fr-FR')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Évolution temporelle — sélecteur de période */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 4 }}>
        <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{t('dashboard.evolution')}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className="cw-chip"
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontWeight: period === p.key ? 700 : 500,
                background: period === p.key ? C.green : C.surface,
                border: `1px solid ${period === p.key ? C.green : C.border}`,
                color: period === p.key ? '#fff' : C.textMuted,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Revenus par jour — ligne fine + points + gradient sous la courbe */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('dashboard.chart_revenue')}</h2>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={chartTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.green} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={{ stroke: C.border }} />
              <YAxis stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} width={38}
                tickFormatter={v => v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k'} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="fees" name={t('dashboard.chart_series_fees')} stroke={C.green} strokeWidth={1.5}
                fill="url(#gradRev)" dot={{ fill: C.green, r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="trend" name={t('dashboard.chart_series_trend')} stroke={C.yellow} strokeWidth={1.5}
                fill="none" strokeDasharray="5 3" dot={false} activeDot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Activité utilisateurs — area gradient émeraude */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('dashboard.chart_activity')}</h2>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradAct" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.green} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={{ stroke: C.border }} />
              <YAxis stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="users" name={t('dashboard.chart_series_users')} stroke={C.green} strokeWidth={2}
                fill="url(#gradAct)" dot={{ fill: C.green, r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="tx" name={t('dashboard.chart_series_tx')} stroke={C.blue} strokeWidth={1.5}
                fill="none" strokeDasharray="4 2" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent transactions */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{t('dashboard.recent_tx')}</h2>
          <button className="cw-link" onClick={() => onNavigate?.('transactions')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.green, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            {t('dashboard.see_all')} <ArrowRight size={14} />
          </button>
        </div>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {[t('alerts.col_ref'), t('alerts.col_type'), t('alerts.col_from'), t('alerts.col_to'), t('alerts.col_amount'), t('alerts.col_status'), t('alerts.col_date')].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(tx => (
              <tr key={tx.id} className="cw-row" onClick={() => setSelectedTx(tx)} style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <td style={{ padding: '10px 12px', color: C.textSoft, fontFamily: 'monospace', fontSize: 12 }}>{tx.reference.slice(0, 10)}…</td>
                <td style={{ padding: '10px 12px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                <td style={{ padding: '10px 12px', color: C.text }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: (TX_TYPE_COLOR[tx.type] ?? C.textMuted) + '22', color: TX_TYPE_COLOR[tx.type] ?? C.textMuted }}>
                      {initials(tx.sender?.fullName ?? tx.sender?.phone)}
                    </span>
                    {partyLabel(tx.sender, t('common.operator'))}
                  </div>
                </td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.receiver, t('common.operator'))}</td>
                <td style={{ padding: '10px 12px', color: TX_TYPE_COLOR[tx.type] ?? C.text, fontWeight: 700 }}>{formatFCFA(tx.amount)}</td>
                <td style={{ padding: '10px 12px' }}><StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} /></td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(tx.createdAt)}>{relativeTime(tx.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {(recentLoading || recentError || recent.length === 0) && (
          <StateRow loading={recentLoading} error={recentError} empty={!recentLoading && !recentError ? t('dashboard.no_recent_tx') : undefined} />
        )}
      </div>

      {/* Widget santé intégrations */}
      <HealthWidget />

      {selectedTx && (
        <TransactionDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} onRetried={() => { setSelectedTx(null); refetchRecent() }} />
      )}
    </div>
  )
}

// Couleur sémantique d'un statut d'intégration.
const HEALTH_COLOR: Record<string, string> = {
  UP: C.green, DEGRADED: C.orange, SIMULATED: C.orange, DOWN: C.red, UNKNOWN: C.textMuted,
}
// Couleur de la latence selon les seuils (<50ms vert, 50–200 orange, >200 rouge).
const latencyColor = (ms: number) => (ms < 50 ? C.green : ms <= 200 ? C.orange : C.red)

function HealthWidget() {
  const { data, loading, error } = useFetch(getHealthIntegrations, [])
  const integrations = data?.integrations ?? []

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Activity size={16} color={C.green} />
        <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{i18n.t('health.title')}</span>
        {data?.checkedAt && (
          <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}>
            {i18n.t('health.checked_at', { date: relativeTime(data.checkedAt) })}
          </span>
        )}
      </div>
      {loading && <StateRow loading error={null} />}
      {error && <div style={{ color: C.red, fontSize: 12 }}>{error}</div>}
      {integrations.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {integrations.map(i => {
            const color = HEALTH_COLOR[i.status] ?? C.textMuted
            const hasMetrics = i.txCount7d != null
            return (
              <div key={i.name} style={{ background: C.surface, border: `1px solid ${color}30`, borderRadius: 10, padding: '14px 16px' }}>
                {/* En-tête : pastille + nom + latence */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ position: 'relative', display: 'inline-flex', width: 10, height: 10, flexShrink: 0 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: color }} />
                    {i.status === 'UP' && <span style={{ position: 'absolute', inset: 0, borderRadius: 5, background: color, opacity: 0.5, animation: 'cwPulse 1.8s ease-out infinite' }} />}
                  </span>
                  <span style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{i.name}</span>
                  {i.latency != null && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: latencyColor(i.latency) }}>{i.latency} ms</span>
                  )}
                </div>

                {/* Statut */}
                <div style={{ fontSize: 12, color, fontWeight: 600, marginBottom: hasMetrics ? 10 : 4 }}>{i18n.t('health_status.' + i.status)}</div>

                {hasMetrics ? (
                  <>
                    {/* Tx 7j + dernière activité */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textMuted, marginBottom: 8 }}>
                      <span dangerouslySetInnerHTML={{ __html: i18n.t('health.tx_7d', { count: i.txCount7d, interpolation: { escapeValue: false } }) }} />
                      <span>{i.lastSuccess ? relativeTime(i.lastSuccess) : i18n.t('common.none')}</span>
                    </div>
                    {/* Uptime + barre de progression */}
                    {i.uptime != null && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textMuted, marginBottom: 3 }}>
                          <span>{i18n.t('health.up')} 7j</span>
                          <span style={{ fontWeight: 700, color: i.uptime >= 95 ? C.green : i.uptime >= 70 ? C.orange : C.red }}>{i.uptime} %</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
                          <div style={{ width: `${i.uptime}%`, height: '100%', borderRadius: 3, background: i.uptime >= 95 ? C.green : i.uptime >= 70 ? C.orange : C.red, transition: 'width .4s' }} />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  i.note && <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>{i.note}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Niveau d'alerte → libellé + couleur (error=Critique, warn=Avertissement, info=Info).
const ALERT_LEVEL: Record<string, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  error: { label: 'alert_level.error', color: C.red, bg: C.redLight, icon: Siren },
  warn: { label: 'alert_level.warn', color: C.orange, bg: C.orangeLight, icon: AlertTriangle },
  info: { label: 'alert_level.info', color: C.blue, bg: C.blueLight, icon: Info },
}

function AlertsPage() {
  const { data, loading, error, refetch } = useFetch(() => getAlerts(), [])
  const { data: timeline, refetch: refetchTl } = useFetch(() => getAlertsTimeline(), [])
  const alerts = data?.alerts ?? []
  const flagged = data?.flagged ?? []
  const toast = useToast()
  const [levelFilter, setLevelFilter] = useState('')
  // État « lu » persisté localement (par id d'alerte).
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('cw_alerts_read') || '[]')) } catch { return new Set() }
  })
  const persistRead = (s: Set<string>) => { setReadIds(s); localStorage.setItem('cw_alerts_read', JSON.stringify([...s])) }

  // Rafraîchissement temps réel via SSE.
  useLiveEvents(useCallback((ev: { type: string }) => { if (ev.type !== 'ping') { refetch(); refetchTl() } }, [refetch, refetchTl]))

  const filtered = levelFilter ? alerts.filter((a) => a.type === levelFilter) : alerts
  const unread = alerts.filter((a) => !readIds.has(a.id)).length
  const counts = { error: alerts.filter(a => a.type === 'error').length, warn: alerts.filter(a => a.type === 'warn').length, info: alerts.filter(a => a.type === 'info').length }
  const tlData = (timeline?.series ?? []).map((p) => ({ label: p.label, failed: p.failed, highValue: p.highValue }))

  const markAllRead = () => { persistRead(new Set(alerts.map((a) => a.id))); toast(i18n.t('x.al.marked_all'), 'success') }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>
            {i18n.t('x.al.title')}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: C.green, background: C.greenLight, border: `1px solid ${C.green}40`, borderRadius: 20, padding: '3px 10px' }}>
              <span className="cw-live-dot" style={{ width: 7, height: 7, borderRadius: 4, background: C.green, animation: 'pulse 2s infinite' }} /> {i18n.t('x.al.realtime')}
            </span>
          </h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.al.subtitle', { unread, total: alerts.length })}</p>
        </div>
        <button className="cw-btn" disabled={!unread} onClick={markAllRead}
          style={{ fontSize: 13, color: unread ? C.green : C.textMuted, background: unread ? C.greenLight : C.surface, border: `1px solid ${unread ? C.green + '40' : C.border}`, borderRadius: 8, padding: '8px 16px', cursor: unread ? 'pointer' : 'default', fontWeight: 600 }}>
          {i18n.t('x.al.mark_all')}
        </button>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Graphe : alertes par heure sur 24h */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('x.al.per_hour')}</h2>
          <div style={{ display: 'flex', gap: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSoft }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.red }} />{i18n.t('x.al.leg_failures')}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSoft }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.orange }} />{i18n.t('x.al.leg_highvalue')}</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={tlData} margin={{ top: 6, right: 8, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} interval={2} />
            <YAxis stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
            <Tooltip cursor={{ fill: C.redLight }} content={<ChartTooltip />} />
            <Bar dataKey="failed" name={i18n.t('x.al.leg_failures')} stackId="a" fill={C.red} radius={[0, 0, 0, 0]} maxBarSize={18} />
            <Bar dataKey="highValue" name={i18n.t('x.al.leg_highvalue')} stackId="a" fill={C.orange} radius={[3, 3, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filtre par niveau */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setLevelFilter('')} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontWeight: levelFilter === '' ? 700 : 500, background: levelFilter === '' ? C.green : C.card, border: `1px solid ${levelFilter === '' ? C.green : C.border}`, color: levelFilter === '' ? '#fff' : C.textSoft }}>{i18n.t('x.al.all_count', { count: alerts.length })}</button>
        {(['error', 'warn', 'info'] as const).map((lvl) => { const m = ALERT_LEVEL[lvl]; return (
          <button key={lvl} onClick={() => setLevelFilter(levelFilter === lvl ? '' : lvl)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontWeight: levelFilter === lvl ? 700 : 500, background: levelFilter === lvl ? m.color : m.bg, border: `1px solid ${levelFilter === lvl ? m.color : m.color + '40'}`, color: levelFilter === lvl ? '#fff' : m.color }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: levelFilter === lvl ? '#fff' : m.color }} />{i18n.t(m.label)} ({counts[lvl]})
          </button>
        )})}
      </div>

      {/* Alert cards (3 niveaux) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {filtered.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 24, color: C.textMuted, fontSize: 13 }}>{i18n.t('x.al.no_active')}</div>}
        {filtered.map(a => {
          const m = ALERT_LEVEL[a.type] ?? ALERT_LEVEL.info
          const AlertIcon = m.icon
          const isRead = readIds.has(a.id)
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: m.bg, border: `1px solid ${m.color}40`, borderRadius: 12, padding: '14px 16px', opacity: isRead ? 0.6 : 1 }}>
              <AlertIcon size={18} color={m.color} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: m.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i18n.t(m.label)}</span>
                  <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{a.title}</span>
                </div>
                <div style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>{a.desc}</div>
              </div>
              {!isRead && (
                <button onClick={() => persistRead(new Set([...readIds, a.id]))} title={i18n.t('x.al.mark_read')}
                  style={{ flexShrink: 0, background: 'none', border: 'none', color: m.color, cursor: 'pointer', padding: 4, borderRadius: 6 }}><Check size={16} /></button>
              )}
            </div>
          )
        })}
      </div>

      {/* Flagged transactions (échecs + gros montants, 7 derniers jours) */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
          <AlertTriangle size={16} color={C.yellow} /> {i18n.t('x.al.flagged')}
        </h2>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {[i18n.t('x.al.col_ref'), i18n.t('x.al.col_type'), i18n.t('x.al.col_amount'), i18n.t('x.al.col_from'), i18n.t('x.al.col_to'), i18n.t('x.al.col_status'), i18n.t('x.al.col_date')].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flagged.map(tx => (
              <tr key={tx.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '10px 12px', color: C.textSoft, fontFamily: 'monospace', fontSize: 12 }}>{tx.reference}</td>
                <td style={{ padding: '10px 12px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                <td style={{ padding: '10px 12px', color: C.yellow, fontWeight: 700 }}>{formatFCFA(tx.amount)}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.sender, i18n.t('common.operator'))}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.receiver, i18n.t('common.operator'))}</td>
                <td style={{ padding: '10px 12px' }}><StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} /></td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 12 }}>{fmtDate(tx.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && !error && flagged.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: C.textMuted }}>{i18n.t('x.al.no_flagged')}</div>
        )}
      </div>
    </div>
  )
}

// ── Vue détail utilisateur (modal) ────────────────────────
function UserDetailModal({ userId, onClose, onChanged, zIndex = 50 }: { userId: string; onClose: () => void; onChanged: () => void; zIndex?: number }) {
  const { data, loading, error, refetch } = useFetch(() => getUserDetail(userId), [userId])
  const [acting, setActing] = useState(false)
  const [confirmingPinReset, setConfirmingPinReset] = useState(false)
  const [tab, setTab] = useState<'profil' | 'tx' | 'kyc' | 'audit'>('profil')
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null)
  const toast = useToast()
  const u = data?.user

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Notes internes
  const { data: notes, loading: notesLoading, refetch: refetchNotes } = useFetch(
    () => getAdminNotes(userId), [userId],
  )
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setAddingNote(true)
    try {
      await addAdminNote(userId, noteText.trim())
      setNoteText('')
      refetchNotes()
      toast(i18n.t('x.ud.note_added'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error')
    } finally {
      setAddingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    if (!window.confirm(i18n.t('x.ud.note_delete_confirm', { defaultValue: 'Supprimer cette note ?' }))) return
    try {
      await deleteAdminNote(noteId)
      refetchNotes()
      toast(i18n.t('x.ud.note_deleted'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.ud.note_delete_failed', { defaultValue: 'Échec de la suppression de la note' }), 'error')
    }
  }

  const run = async (fn: () => Promise<unknown>, okMsg = i18n.t('x.ud.action_done')) => {
    setActing(true)
    try {
      await fn()
      refetch()
      onChanged()
      toast(okMsg, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('common.action_failed'), 'error')
    } finally {
      setActing(false)
    }
  }

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: '#000A', zIndex,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto',
  }
  const panel: CSSProperties = {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16,
    width: 'min(820px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 24,
  }
  const label = (t: string) => <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{t}</div>
  const photoTile = (src: string, cap: string) => (
    <button onClick={() => setLightbox({ url: src, alt: cap })} style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
      {/* loading lazy + fond placeholder (fondu à l'arrivée de l'image) */}
      <img src={src} alt={cap} loading="lazy" decoding="async"
        onLoad={(e) => { (e.currentTarget.style.filter = 'none'); (e.currentTarget.style.opacity = '1') }}
        style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, filter: 'blur(8px)', opacity: 0.6, transition: 'filter .3s, opacity .3s' }} />
      <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 4 }}>{cap}</div>
    </button>
  )
  const sectionTitle = (t: string): CSSProperties => ({ color: C.text, fontSize: 13, fontWeight: 700, marginBottom: 10 })

  const TABS: { key: 'profil' | 'tx' | 'kyc' | 'audit'; label: string }[] = [
    { key: 'profil', label: i18n.t('x.ud.tab_profile') },
    { key: 'tx', label: i18n.t('x.ud.tab_tx') },
    { key: 'kyc', label: i18n.t('x.ud.tab_kyc') },
    { key: 'audit', label: i18n.t('x.ud.tab_audit') },
  ]

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{i18n.t('x.ud.title')}</h2>
          <button className="cw-iconbtn" onClick={onClose} aria-label={i18n.t('common.close')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 9, background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {(loading || error) && <StateRow loading={loading} error={error} />}

        {u && data && (
          <>
            {/* En-tête : grand avatar + nom + téléphone + badges statut/KYC/rôle */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, overflow: 'hidden', background: C.green + '20', border: `2px solid ${C.green}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: C.green, flexShrink: 0 }}>
                {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(u.fullName)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 17 }}>{u.fullName ?? i18n.t('common.no_name')}</div>
                <div style={{ color: C.textSoft, fontFamily: 'monospace', fontSize: 13 }}>{u.phone}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                  <StatusBadge status={USER_STATUS_BADGE[u.status] ?? u.status} />
                  <StatusBadge status={KYC_STATUS_BADGE[u.kycStatus] ?? u.kycStatus} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: C.blueLight, color: C.blue }}>{i18n.t('roles.' + (u.role === 'USER' ? 'user' : u.role === 'MERCHANT' ? 'merchant' : 'admin'))}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.ud.label_member_since')}</div>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{relativeTime(u.createdAt)}</div>
              </div>
            </div>

            {/* Actions (masquées en lecture seule) */}
            {!isReadOnly() && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {u.role !== 'ADMIN' && (u.status === 'LOCKED' ? (
                <button className="cw-btn" disabled={acting} onClick={() => run(() => setUserStatus(u.id, 'ACTIVE'), i18n.t('x.ud.account_unblocked'))}
                  style={{ fontSize: 12, color: C.green, background: C.greenLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.ud.unblock')}</button>
              ) : (
                <button className="cw-btn" disabled={acting} onClick={() => run(() => setUserStatus(u.id, 'LOCKED'), i18n.t('x.ud.account_blocked'))}
                  style={{ fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.ud.block')}</button>
              ))}
              {confirmingPinReset ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.yellowLight, border: `1px solid ${C.yellow}60`, borderRadius: 8, padding: '4px 6px 4px 10px' }}>
                  <span style={{ fontSize: 12, color: C.amber, fontWeight: 600 }}>{i18n.t('common.confirm_question')}</span>
                  <button className="cw-btn" disabled={acting} onClick={() => { setConfirmingPinReset(false); run(() => resetUserPin(u.id), i18n.t('x.ud.pin_reset_ok')) }}
                    style={{ fontSize: 12, color: '#1A1206', background: C.yellow, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>{i18n.t('common.yes')}</button>
                  <button className="cw-btn" onClick={() => setConfirmingPinReset(false)}
                    style={{ fontSize: 12, color: C.textSoft, background: 'none', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('common.cancel')}</button>
                </div>
              ) : (
                <button className="cw-btn" disabled={acting} onClick={() => setConfirmingPinReset(true)}
                  style={{ fontSize: 12, color: C.amber, background: C.yellowLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.ud.reset_pin')}</button>
              )}
              {['PENDING', 'SUBMITTED'].includes(u.kycStatus) && (
                <>
                  <button className="cw-btn" disabled={acting} onClick={() => { if (window.confirm(i18n.t('x.ud.kyc_confirm_approve', { defaultValue: 'Approuver ce dossier KYC ?' }))) run(() => reviewKyc(u.id, 'APPROVED'), i18n.t('x.ud.kyc_approved')) }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}><Check size={14} /> {i18n.t('x.ud.approve_kyc')}</button>
                  <button className="cw-btn" disabled={acting} onClick={() => { if (window.confirm(i18n.t('x.ud.kyc_confirm_reject', { defaultValue: 'Rejeter ce dossier KYC ?' }))) run(() => reviewKyc(u.id, 'REJECTED'), i18n.t('x.ud.kyc_rejected')) }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}><X size={14} /> {i18n.t('x.ud.reject_kyc')}</button>
                </>
              )}
            </div>
            )}

            {/* Onglets */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
              {TABS.map((tb) => (
                <button key={tb.key} onClick={() => setTab(tb.key)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 16px',
                  color: tab === tb.key ? C.green : C.textMuted,
                  borderBottom: tab === tb.key ? `2px solid ${C.green}` : '2px solid transparent', marginBottom: -1,
                }}>{tb.label}</button>
              ))}
            </div>

            {/* Tab Profil */}
            {tab === 'profil' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
                  <div>{label(i18n.t('x.ud.label_email'))}<span style={{ color: C.text, fontSize: 13 }}>{u.email ?? '—'}</span></div>
                  <div>{label(i18n.t('x.ud.label_city'))}<span style={{ color: C.text, fontSize: 13 }}>{u.city ?? '—'}</span></div>
                  <div>{label(i18n.t('x.ud.label_dob'))}<span style={{ color: C.text, fontSize: 13 }}>{u.dateOfBirth ? fmtDate(u.dateOfBirth) : '—'}</span></div>
                  <div>{label(i18n.t('x.ud.label_balance'))}<span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>{formatFCFA(u.wallet?.balance ?? 0)}</span></div>
                  <div>{label(i18n.t('x.ud.label_last_login'))}<span style={{ color: C.text, fontSize: 13 }}>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</span></div>
                  <div>{label(i18n.t('x.ud.label_member_since'))}<span style={{ color: C.text, fontSize: 13 }}>{fmtDate(u.createdAt)}</span></div>
                  <div>{label(i18n.t('x.ud.label_tx_count'))}<span style={{ color: C.text, fontSize: 13 }}>{data.stats.transactionsCount}</span></div>
                  <div>{label(i18n.t('x.ud.label_total_sent'))}<span style={{ color: C.text, fontSize: 13 }}>{formatFCFA(data.stats.totalSent)}</span></div>
                  <div>{label(i18n.t('x.ud.label_total_received'))}<span style={{ color: C.text, fontSize: 13 }}>{formatFCFA(data.stats.totalReceived)}</span></div>
                  {data.stats.monthlyVolume !== undefined && (
                    <div>{label(i18n.t('x.ud.label_volume_30d'))}<span style={{ color: C.text, fontSize: 13 }}>{formatFCFA(data.stats.monthlyVolume)}</span></div>
                  )}
                  {data.stats.anifRisk && (
                    <div>{label(i18n.t('x.ud.label_risk_score'))}<RiskBadge level={data.stats.anifRisk} /></div>
                  )}
                </div>

                {/* Notes internes */}
                <h3 style={sectionTitle('')}>{i18n.t('x.ud.notes_section')}</h3>
                <div style={{ marginBottom: 12 }}>
                  {notesLoading && <div style={{ color: C.textMuted, fontSize: 12 }}>{i18n.t('common.loading')}</div>}
                  {!notesLoading && (!notes || notes.length === 0) && (
                    <div style={{ color: C.textMuted, fontSize: 12 }}>{i18n.t('x.ud.notes_none')}</div>
                  )}
                  {(notes ?? []).map((n: AdminNote) => (
                    <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderTop: `1px solid ${C.border}`, fontSize: 12, gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.text, marginBottom: 2 }}>{n.content}</div>
                        <div style={{ color: C.textMuted, fontSize: 11 }}>{n.author.email ?? n.author.fullName ?? 'Admin'} · {fmtDate(n.createdAt)}</div>
                      </div>
                      {!isReadOnly() && <button className="cw-iconbtn" onClick={() => handleDeleteNote(n.id)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: '2px 4px', borderRadius: 6, flexShrink: 0 }} aria-label={i18n.t('user_detail.notes_delete_aria')}><X size={14} /></button>}
                    </div>
                  ))}
                </div>
                {!isReadOnly() && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote() } }} placeholder={i18n.t('x.ud.notes_placeholder')} aria-label={i18n.t('x.ud.notes_aria')} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
                    <button onClick={handleAddNote} disabled={addingNote || !noteText.trim()} style={{ padding: '8px 14px', background: C.green, border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, cursor: addingNote || !noteText.trim() ? 'not-allowed' : 'pointer', opacity: !noteText.trim() ? 0.6 : 1 }}>{i18n.t('x.ud.notes_add')}</button>
                  </div>
                )}
              </>
            )}

            {/* Tab Transactions */}
            {tab === 'tx' && (
              <div>
                {data.transactions.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>{i18n.t('x.ud.no_tx')}</div>}
                {data.transactions.map((tx) => (
                  <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} />
                      <span style={{ color: C.textSoft }}>{partyLabel(tx.sender, i18n.t('common.operator'))} → {partyLabel(tx.receiver, i18n.t('common.operator'))}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} />
                      <span style={{ color: TX_TYPE_COLOR[tx.type] ?? C.text, fontWeight: 700 }}>{formatFCFA(tx.amount)}</span>
                      <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }} title={fmtDate(tx.createdAt)}>{relativeTime(tx.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab KYC */}
            {tab === 'kyc' && (
              <div>
                {u.kycDocument ? (
                  <>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                      {photoTile(u.kycDocument.idFrontUrl, i18n.t('x.ud.kyc_id_front'))}
                      {photoTile(u.kycDocument.idBackUrl, i18n.t('x.ud.kyc_id_back'))}
                      {photoTile(u.kycDocument.selfieUrl, i18n.t('x.ud.kyc_selfie'))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                      <div>{label(i18n.t('x.ud.label_kyc_status'))}<StatusBadge status={KYC_STATUS_BADGE[u.kycStatus] ?? u.kycStatus} /></div>
                      <div>{label(i18n.t('x.ud.label_submitted_at'))}<span style={{ color: C.text, fontSize: 13 }}>{u.kycDocument.submittedAt ? fmtDate(u.kycDocument.submittedAt) : '—'}</span></div>
                      {u.kycDocument.reviewedAt && <div>{label(i18n.t('x.ud.label_decided_at'))}<span style={{ color: C.text, fontSize: 13 }}>{fmtDate(u.kycDocument.reviewedAt)}</span></div>}
                    </div>
                    {u.kycDocument.reviewNote && (
                      <div style={{ marginTop: 12, padding: '10px 12px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                        {label(i18n.t('x.ud.label_review_note'))}<span style={{ color: C.textSoft, fontSize: 12 }}>{u.kycDocument.reviewNote}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: C.textMuted, fontSize: 12 }}>{i18n.t('x.ud.no_kyc_doc')}</div>
                )}
              </div>
            )}

            {/* Tab Audit */}
            {tab === 'audit' && (
              <div>
                {data.audit.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>{i18n.t('x.ud.no_audit')}</div>}
                {data.audit.map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `1px solid ${C.border}`, fontSize: 12, gap: 8 }}>
                    <span style={{ color: C.textSoft }}>{auditActionLabel(a.action)}{a.metadata?.note ? ` — ${a.metadata.note}` : ''}</span>
                    <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{(a.user?.email ?? 'admin')} · {relativeTime(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {lightbox && <KYCLightbox url={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </div>
  )
}

function UsersPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [kycFilter, setKycFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState('') // appliqué côté client (dérivé)
  const debouncedSearch = useDebounced(search.trim(), 350)

  // Recherche + filtres statut/KYC/rôle côté serveur.
  const { data, loading, error, refetch } = useFetch(
    () => getUsers({
      limit: 50,
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
      kycStatus: kycFilter || undefined,
      role: roleFilter || undefined,
    }),
    [debouncedSearch, statusFilter, kycFilter, roleFilter],
  )
  const { data: ustats } = useFetch(() => getUserStats(), [])
  const allUsers = data?.data ?? []
  // Filtre risque (dérivé) appliqué sur les lignes chargées.
  const users = riskFilter ? allUsers.filter((u) => u.riskLevel === riskFilter) : allUsers
  const total = data?.meta.total ?? 0

  const [acting, setActing] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [blockConfirm, setBlockConfirm] = useState<string | null>(null)
  const [pinConfirm, setPinConfirm] = useState<string | null>(null)
  const toast = useToast()

  // Tri client sur les lignes chargées.
  const [sort, setSort] = useState<{ key: 'balance' | 'createdAt'; dir: 1 | -1 } | null>(null)
  const sortedUsers = useMemo(() => {
    if (!sort) return users
    const v = (u: AdminUser) =>
      sort.key === 'balance' ? Number(u.wallet?.balance ?? 0) : new Date(u.createdAt).getTime()
    return [...users].sort((a, b) => (v(a) - v(b)) * sort.dir)
  }, [users, sort])
  const toggleSort = (key: 'balance' | 'createdAt') =>
    setSort((s) => (s?.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  // Export CSV filtré : exactement les lignes affichées (filtres + tri appliqués).
  const handleExportCsv = () => {
    downloadCsv(
      'utilisateurs-camwallet.csv',
      [i18n.t('x.users.csv_name'), i18n.t('x.users.csv_phone'), i18n.t('x.users.csv_email'), i18n.t('x.users.csv_balance'), i18n.t('x.users.csv_status'), i18n.t('x.users.csv_kyc'), i18n.t('x.users.csv_risk'), i18n.t('x.users.csv_role'), i18n.t('x.users.csv_registered')],
      sortedUsers.map((u) => [
        u.fullName ?? '—', u.phone, u.email ?? '—',
        toFcfa(Number(u.wallet?.balance ?? 0)).toLocaleString('fr-FR'),
        u.status, u.kycStatus, u.riskLevel ?? 'Bas', i18n.t('roles.' + (u.role === 'USER' ? 'user' : u.role === 'MERCHANT' ? 'merchant' : 'admin')), fmtDate(u.createdAt),
      ]),
    )
    toast(i18n.t('x.users.csv_exported'), 'success')
  }
  const handleExportPdf = () => {
    const ok = exportPdfReport(
      i18n.t('x.users.pdf_title'),
      [i18n.t('x.users.csv_name'), i18n.t('x.users.csv_phone'), i18n.t('x.users.csv_balance'), i18n.t('x.users.csv_status'), i18n.t('x.users.csv_kyc'), i18n.t('x.users.csv_risk'), i18n.t('x.users.csv_registered')],
      sortedUsers.map((u) => [
        u.fullName ?? '—', u.phone, toFcfa(Number(u.wallet?.balance ?? 0)).toLocaleString('fr-FR'),
        u.status, u.kycStatus, u.riskLevel ?? 'Bas', fmtDate(u.createdAt),
      ]),
    )
    toast(ok ? i18n.t('common.pdf_opened') : i18n.t('common.popup_blocked'), ok ? 'success' : 'error')
  }

  // Bloquer / réactiver un compte (action tracée côté backend dans l'AuditLog).
  const toggleBlock = async (u: { id: string; status: string }) => {
    setActing(u.id)
    try {
      await setUserStatus(u.id, u.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED')
      refetch()
      toast(u.status === 'LOCKED' ? i18n.t('x.users.account_unblocked') : i18n.t('x.users.account_blocked'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('common.action_failed'), 'error')
    } finally {
      setActing(null)
    }
  }
  const doResetPin = async (id: string) => {
    setActing(id)
    try {
      await resetUserPin(id)
      toast(i18n.t('x.users.pin_reset_ok'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.users.pin_reset_failed', { defaultValue: 'Échec de la réinitialisation du PIN' }), 'error')
    } finally {
      setActing(null); setPinConfirm(null)
    }
  }

  // Couleur du solde selon le montant (centimes).
  const balanceColor = (c: number) => (c <= 0 ? C.textMuted : toFcfa(c) >= 100_000 ? C.green : C.text)

  const stats = ustats
  const statCards: { label: string; value: string; sub: string; icon: LucideIcon; color: string; trend?: number | null }[] = stats ? [
    { label: i18n.t('x.users.stat_total'), value: stats.total.toLocaleString('fr-FR'), sub: i18n.t('x.users.stat_new', { count: stats.newToday }), icon: UsersIcon, color: C.blue, trend: stats.trends.total },
    { label: i18n.t('x.users.stat_active'), value: stats.activeToday.toLocaleString('fr-FR'), sub: i18n.t('x.users.stat_active_sub'), icon: Activity, color: C.green },
    { label: i18n.t('x.users.stat_kyc'), value: stats.kycApproved.toLocaleString('fr-FR'), sub: i18n.t('x.users.stat_kyc_sub'), icon: ClipboardCheck, color: C.purple, trend: stats.trends.kycApproved },
    { label: i18n.t('x.users.stat_merchants'), value: stats.merchants.toLocaleString('fr-FR'), sub: i18n.t('x.users.stat_merchants_sub'), icon: Landmark, color: C.yellow, trend: stats.trends.merchants },
  ] : []

  const inputStyle: CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('users.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.users.subtitle', { total, shown: sortedUsers.length })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cw-btn" onClick={handleExportCsv}
            style={{ fontSize: 13, color: C.green, background: C.greenLight, border: `1px solid ${C.green}40`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.common.export_csv')}</button>
          <button className="cw-btn" onClick={handleExportPdf}
            style={{ fontSize: 13, color: C.blue, background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('common.export_pdf')}</button>
        </div>
      </div>

      {/* Cartes de synthèse */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statCards.map((s) => { const Icon = s.icon; const TrendIcon = (s.trend ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{s.value}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.sub}</span>
              {s.trend != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 700, color: s.trend >= 0 ? C.green : C.red }}>
                  <TrendIcon size={12} />{Math.abs(s.trend)} %
                </span>
              )}
            </div>
          </div>
        )})}
      </div>

      {/* Filtres avancés */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} color={C.textMuted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={i18n.t('x.users.search_ph')}
            aria-label={i18n.t('x.users.search_aria')} style={{ ...inputStyle, width: '100%', paddingLeft: 34 }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.users.all_status')}</option>
          <option value="ACTIVE">{i18n.t('x.users.st_active')}</option>
          <option value="SUSPENDED">{i18n.t('x.users.st_suspended')}</option>
          <option value="LOCKED">{i18n.t('x.users.st_locked')}</option>
        </select>
        <select value={kycFilter} onChange={e => setKycFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.users.all_kyc')}</option>
          <option value="APPROVED">{i18n.t('x.users.kyc_approved')}</option>
          <option value="SUBMITTED">{i18n.t('x.users.kyc_pending')}</option>
          <option value="REJECTED">{i18n.t('x.users.kyc_rejected')}</option>
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.users.all_roles')}</option>
          <option value="USER">{i18n.t('roles.user')}</option>
          <option value="MERCHANT">{i18n.t('roles.merchant')}</option>
        </select>
        <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.users.all_risks')}</option>
          <option value="Bas">{i18n.t('x.users.risk_low')}</option>
          <option value="Moyen">{i18n.t('x.users.risk_medium')}</option>
          <option value="Élevé">{i18n.t('x.users.risk_high')}</option>
        </select>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: C.surface }}>
            <tr>
              {([
                { h: i18n.t('x.users.col_user') }, { h: i18n.t('x.users.col_email') }, { h: i18n.t('x.users.col_balance'), sk: 'balance' as const },
                { h: i18n.t('x.users.col_kyc') }, { h: i18n.t('x.users.col_risk') }, { h: i18n.t('x.users.col_registered'), sk: 'createdAt' as const }, { h: i18n.t('x.users.col_status') }, { h: i18n.t('x.users.col_actions') },
              ]).map(({ h, sk }) => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>
                  {sk ? (
                    <button className="cw-link" onClick={() => toggleSort(sk)} aria-label={i18n.t('x.users.sort_by', { col: h })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, fontWeight: 600, color: sort?.key === sk ? C.green : C.textMuted }}>
                      {h}{sort?.key === sk ? (sort.dir === -1 ? <ChevronDown size={13} /> : <ChevronUp size={13} />) : <ChevronsUpDown size={13} style={{ opacity: 0.45 }} />}
                    </button>
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map(u => (
              <tr key={u.id} className="cw-row" onClick={() => setSelected(u.id)}
                style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 16, background: C.green + '20', border: `2px solid ${C.green}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: C.green, flexShrink: 0 }}>
                      {initials(u.fullName)}
                    </div>
                    <div>
                      <div style={{ color: C.text, fontWeight: 600 }}>{u.fullName ?? i18n.t('common.no_name')}</div>
                      <div style={{ color: C.textMuted, fontSize: 11, fontFamily: 'monospace' }}>{u.phone}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 14px', color: C.textSoft, fontSize: 12 }}>{u.email ?? '—'}</td>
                <td style={{ padding: '12px 14px', color: balanceColor(u.wallet?.balance ?? 0), fontWeight: 700 }}>{formatFCFA(u.wallet?.balance ?? 0)}</td>
                <td style={{ padding: '12px 14px' }}>
                  <StatusBadge status={KYC_STATUS_BADGE[u.kycStatus] ?? u.kycStatus} />
                  {u.kycStatus === 'APPROVED' && u.kycReviewedAt && (
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{fmtDate(u.kycReviewedAt)}</div>
                  )}
                </td>
                <td style={{ padding: '12px 14px' }}><RiskBadge level={u.riskLevel} /></td>
                <td style={{ padding: '12px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(u.createdAt)}>{relativeTime(u.createdAt)}</td>
                <td style={{ padding: '12px 14px' }}><StatusBadge status={USER_STATUS_BADGE[u.status] ?? u.status} /></td>
                <td style={{ padding: '12px 14px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="cw-btn" onClick={() => setSelected(u.id)}
                      style={{ fontSize: 11, color: C.blue, background: C.blueLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                      {i18n.t('x.users.see_detail')}
                    </button>
                    {!isReadOnly() && u.role !== 'ADMIN' && (acting === u.id ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textMuted, padding: '4px 10px' }}>
                        <Loader2 size={12} className="cw-spin" /> …
                      </span>
                    ) : (
                      <>
                        {u.status === 'LOCKED' ? (
                          <button className="cw-btn" onClick={() => toggleBlock(u)}
                            style={{ fontSize: 11, color: C.green, background: C.greenLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.ud.unblock')}</button>
                        ) : blockConfirm === u.id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.redLight, border: `1px solid ${C.red}50`, borderRadius: 6, padding: '2px 4px 2px 8px' }}>
                            <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>{i18n.t('x.users.block_q')}</span>
                            <button className="cw-btn" onClick={() => { setBlockConfirm(null); toggleBlock(u) }} style={{ fontSize: 11, color: '#fff', background: C.red, border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }}>{i18n.t('common.yes')}</button>
                            <button className="cw-btn" onClick={() => setBlockConfirm(null)} aria-label={i18n.t('common.cancel')} style={{ fontSize: 11, color: C.textSoft, background: 'none', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer' }}>✕</button>
                          </span>
                        ) : (
                          <button className="cw-btn" onClick={() => setBlockConfirm(u.id)}
                            style={{ fontSize: 11, color: C.red, background: C.redLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.ud.block')}</button>
                        )}
                        {pinConfirm === u.id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.yellowLight, border: `1px solid ${C.yellow}60`, borderRadius: 6, padding: '2px 4px 2px 8px' }}>
                            <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>{i18n.t('x.users.reset_q')}</span>
                            <button className="cw-btn" onClick={() => doResetPin(u.id)} style={{ fontSize: 11, color: '#1A1206', background: C.yellow, border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }}>{i18n.t('common.yes')}</button>
                            <button className="cw-btn" onClick={() => setPinConfirm(null)} aria-label={i18n.t('common.cancel')} style={{ fontSize: 11, color: C.textSoft, background: 'none', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer' }}>✕</button>
                          </span>
                        ) : (
                          <button className="cw-btn" onClick={() => setPinConfirm(u.id)}
                            style={{ fontSize: 11, color: C.amber, background: C.yellowLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.users.reset_pin')}</button>
                        )}
                      </>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && !error && sortedUsers.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>{i18n.t('x.users.no_users')}</div>
        )}
        <StateRow loading={loading} error={error} />
      </div>

      {selected && (
        <UserDetailModal userId={selected} onClose={() => setSelected(null)} onChanged={refetch} />
      )}
    </div>
  )
}

// ── Lightbox plein écran pour les photos KYC ───────────────
function KYCLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <button className="cw-iconbtn" onClick={onClose} style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', display: 'flex', padding: 6 }}><X size={24} /></button>
      <img src={url} alt={alt} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 24px 80px rgba(0,0,0,.7)' }} />
    </div>
  )
}

// ── Modal détail KYC ────────────────────────────────────────
function KYCDetailModal({ entry, onClose, onDecision, onRefresh }: { entry: AdminKycEntry; onClose: () => void; onDecision: () => void; onRefresh: () => void }) {
  const [comment, setComment] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  // Résultat IA local : initialisé depuis le document, mis à jour après une
  // relance manuelle pour refléter le verdict sans recharger toute la file.
  const [aiOverride, setAiOverride] = useState<{ aiScore: number | null; aiSuggestion: string | null; aiIssues: string[]; aiAnalyzedAt: string | null } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const toast = useToast()

  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'RESUBMIT_REQUIRED', overrideComment?: string) => {
    const finalComment = (overrideComment ?? comment).trim()
    if (decision !== 'APPROVED' && !finalComment) {
      toast(i18n.t('x.kycd.comment_required'), 'error')
      return
    }
    // Confirmation avant une décision KYC irréversible.
    const confirmMsg = decision === 'APPROVED'
      ? i18n.t('x.kycd.confirm_approve', { defaultValue: 'Approuver ce dossier KYC ?' })
      : decision === 'REJECTED'
        ? i18n.t('x.kycd.confirm_reject', { defaultValue: 'Rejeter ce dossier KYC ?' })
        : i18n.t('x.kycd.confirm_resubmit', { defaultValue: 'Demander une nouvelle soumission ?' })
    if (!window.confirm(confirmMsg)) return
    setActing(decision)
    try {
      await reviewKyc(entry.id, decision, finalComment || undefined)
      const msg =
        decision === 'APPROVED' ? i18n.t('x.kycd.approved_for', { name: entry.fullName ?? entry.phone }) :
        decision === 'REJECTED' ? i18n.t('x.kycd.rejected_reason', { reason: finalComment }) :
        i18n.t('x.kycd.resubmit_for', { name: entry.fullName ?? entry.phone })
      toast(msg, 'success')
      onDecision()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error')
    } finally { setActing(null) }
  }

  const doc = entry.kycDocument
  const score = entry.complianceScore ?? 0
  const scoreColor = score >= 80 ? C.green : score >= 50 ? C.yellow : C.red
  const statusColor = KYC_STATUS_COLOR[entry.kycStatus] ?? C.textMuted

  const photos: { key: 'idFrontUrl' | 'idBackUrl' | 'selfieUrl'; label: string }[] = [
    { key: 'idFrontUrl', label: i18n.t('x.kyc.id_front') },
    { key: 'idBackUrl', label: i18n.t('x.kyc.id_back') },
    { key: 'selfieUrl', label: i18n.t('x.kyc.selfie') },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 660, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 28 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 46, height: 46, borderRadius: 23, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, background: statusColor + '22', color: statusColor }}>{initials(entry.fullName)}</span>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{entry.fullName ?? '—'}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{entry.phone} · {i18n.t('x.kycd.registered_on', { date: fmtDate(entry.createdAt) })}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <StatusBadge status={KYC_STATUS_BADGE[entry.kycStatus] ?? entry.kycStatus} />
                {doc?.submittedAt && <span style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.kycd.submitted_on', { date: fmtDate(doc.submittedAt) })}</span>}
              </div>
            </div>
          </div>
          <button className="cw-iconbtn" onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 8 }}><X size={20} /></button>
        </div>

        {/* Photos */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{i18n.t('x.kycd.documents')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {photos.map(({ key, label }) => {
              const url = doc?.[key]
              return (
                <div key={key}>
                  {url ? (
                    <button onClick={() => setLightboxUrl(url)} title={i18n.t('common.enlarge', { defaultValue: 'Agrandir' })} style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', cursor: 'zoom-in', background: 'none', padding: 0, display: 'block' }}>
                      <img src={url} alt={label} loading="lazy" decoding="async"
                        onLoad={(e) => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.opacity = '1' }}
                        style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block', background: C.surface, filter: 'blur(8px)', opacity: 0.6, transition: 'filter .3s, opacity .3s' }} />
                    </button>
                  ) : (
                    <div style={{ height: 130, border: `1px dashed ${C.border}`, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: C.textMuted, fontSize: 12 }}>
                      <FileText size={22} opacity={0.4} /><span>{i18n.t('common.none')}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 11, fontWeight: 700, color: url ? C.green : C.red }}>
                    {url ? <Check size={12} /> : <X size={12} />} {label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Score conformité */}
        <div style={{ background: C.surface, borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{i18n.t('x.kycd.score')}</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: scoreColor }}>{score}%</span>
          </div>
          <div style={{ height: 7, background: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 4, transition: 'width .4s ease' }} />
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {photos.map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: doc?.[key] ? C.green : C.textMuted, fontWeight: 600 }}>
                {doc?.[key] ? <Check size={12} /> : <X size={12} opacity={0.5} />} {label}
              </div>
            ))}
          </div>
        </div>

        {/* Pré-validation IA (Claude Vision) */}
        {doc && (() => {
          // Valeurs effectives : override local (après relance) sinon document.
          const ai = aiOverride ?? {
            aiScore: typeof doc.aiScore === 'number' ? doc.aiScore : null,
            aiSuggestion: doc.aiSuggestion ?? null,
            aiIssues: Array.isArray(doc.aiIssues) ? doc.aiIssues : [],
            aiAnalyzedAt: doc.aiAnalyzedAt ?? null,
          }

          const runAnalysis = async () => {
            setAnalyzing(true)
            try {
              const res = await analyzeKyc(entry.id)
              setAiOverride(res)
              toast(`Analyse IA : ${res.aiSuggestion ?? '—'} · ${res.aiScore ?? '—'}/100`, 'success')
              onRefresh()
            } catch (e) {
              toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error')
            } finally { setAnalyzing(false) }
          }

          // Dossier non encore analysé (ex. documents de démo) → relance manuelle.
          if (!ai.aiAnalyzedAt) {
            return (
              <div style={{ background: C.surface, borderRadius: 12, padding: '14px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: C.textMuted }}>🤖 Aucune pré-validation IA pour ce dossier.</span>
                <button onClick={runAnalysis} disabled={analyzing || !!acting}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1px solid ${C.blue}40`, background: C.blue + '15', color: C.blue, fontWeight: 700, fontSize: 12.5, cursor: analyzing ? 'wait' : 'pointer', opacity: analyzing ? .6 : 1 }}>
                  <RotateCcw size={13} /> {analyzing ? 'Analyse en cours…' : 'Lancer l\'analyse IA'}
                </button>
              </div>
            )
          }

          const sug = ai.aiSuggestion as 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW' | null
          const meta = sug === 'APPROVE' ? { label: 'IA : Approuver ✅', color: C.green }
            : sug === 'REJECT' ? { label: 'IA : Rejeter ❌', color: C.red }
            : { label: 'IA : Révision 🔍', color: C.yellow }
          const issues: string[] = ai.aiIssues

          return (
            <div style={{ background: meta.color + '0F', border: `1px solid ${meta.color}30`, borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: issues.length ? 10 : 0 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: meta.color }}>{meta.label}</span>
                {ai.aiScore !== null && <span style={{ fontSize: 13, fontWeight: 800, color: meta.color }}>Score IA : {ai.aiScore}/100</span>}
              </div>
              {issues.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, color: C.textSoft, fontSize: 12, lineHeight: 1.6 }}>
                  {issues.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {(sug === 'APPROVE' || sug === 'REJECT') && (
                  <button
                    onClick={() => sug === 'APPROVE'
                      ? decide('APPROVED')
                      : decide('REJECTED', issues.length ? issues.join(' ; ') : 'Rejet sur recommandation IA')}
                    disabled={!!acting}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: 'none', background: meta.color, color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: acting ? 'wait' : 'pointer', opacity: acting ? .6 : 1 }}>
                    <Check size={13} /> Appliquer la suggestion IA
                  </button>
                )}
                <button onClick={runAnalysis} disabled={analyzing || !!acting}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.textSoft, fontWeight: 700, fontSize: 12.5, cursor: analyzing ? 'wait' : 'pointer', opacity: analyzing ? .6 : 1 }}>
                  <RotateCcw size={13} /> {analyzing ? 'Analyse…' : 'Relancer'}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Note précédente */}
        {doc?.reviewNote && (
          <div style={{ background: C.yellow + '0F', border: `1px solid ${C.yellow}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.yellow, marginBottom: 4 }}>
              {i18n.t('x.kycd.prev_note')}{doc.reviewedAt ? ` · ${fmtDate(doc.reviewedAt)}` : ''}
            </div>
            <div style={{ fontSize: 13, color: C.text }}>{doc.reviewNote}</div>
          </div>
        )}

        {/* Commentaire */}
        <div style={{ marginBottom: 22 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            {i18n.t('x.kycd.comment')} <span style={{ color: C.textMuted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{i18n.t('x.kycd.comment_hint')}</span>
          </label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
            placeholder={i18n.t('x.kycd.comment_ph')}
            style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 10, padding: '10px 12px', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <button onClick={() => decide('APPROVED')} disabled={!!acting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 8px', borderRadius: 10, border: 'none', background: C.green, color: '#fff', fontWeight: 700, fontSize: 13, cursor: acting ? 'wait' : 'pointer', opacity: acting ? .6 : 1 }}>
            <Check size={15} /> {acting === 'APPROVED' ? i18n.t('x.kycd.in_progress') : i18n.t('x.kycd.approve')}
          </button>
          <button onClick={() => decide('REJECTED')} disabled={!!acting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 8px', borderRadius: 10, border: `1px solid ${C.red}40`, background: C.red + '15', color: C.red, fontWeight: 700, fontSize: 13, cursor: acting ? 'wait' : 'pointer', opacity: acting ? .6 : 1 }}>
            <X size={15} /> {acting === 'REJECTED' ? i18n.t('x.kycd.in_progress') : i18n.t('x.kycd.reject')}
          </button>
          <button onClick={() => decide('RESUBMIT_REQUIRED')} disabled={!!acting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 8px', borderRadius: 10, border: `1px solid ${C.purple}40`, background: C.purple + '15', color: C.purple, fontWeight: 700, fontSize: 13, cursor: acting ? 'wait' : 'pointer', opacity: acting ? .6 : 1 }}>
            <RotateCcw size={14} /> {acting === 'RESUBMIT_REQUIRED' ? i18n.t('x.kycd.in_progress') : i18n.t('x.kycd.resubmit')}
          </button>
        </div>
      </div>
      {lightboxUrl && <KYCLightbox url={lightboxUrl} alt={i18n.t('x.kycd.doc_alt')} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}

function KYCPage() {
  const { data, loading, error, refetch } = useFetch(() => getKyc(), [])
  // Tolérant aux deux formes de réponse : { queue, counts } (v2.9.2+) ou tableau brut (ancien backend).
  const queue: AdminKycEntry[] = Array.isArray(data) ? data : data?.queue ?? []
  const counts = data?.counts ?? { pending: 0, approvedToday: 0, rejectedToday: 0, resubmitRequired: 0, approvalRate: null }
  // « — » quand le taux n'est pas calculable (aucune révision) ou absent de la réponse.
  const approvalRateLabel = counts.approvalRate == null ? '—' : counts.approvalRate + ' %'
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AdminKycEntry | null>(null)
  const toast = useToast()

  const filtered = queue.filter((k) => {
    if (filterStatus !== 'all' && k.kycStatus !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(k.fullName?.toLowerCase().includes(q) || k.phone?.includes(q))) return false
    }
    return true
  })

  const stats: { label: string; value: string | number; color: string; icon: LucideIcon }[] = [
    { label: i18n.t('x.kyc.stat_pending'), value: counts.pending, color: C.yellow, icon: Clock },
    { label: i18n.t('x.kyc.stat_approved_today'), value: counts.approvedToday, color: C.green, icon: CheckCircle2 },
    { label: i18n.t('x.kyc.stat_rejected_today'), value: counts.rejectedToday, color: C.red, icon: XCircle },
    { label: i18n.t('x.kyc.stat_rate'), value: approvalRateLabel, color: C.blue, icon: TrendingUp },
  ]

  const STATUS_FILTERS = [
    { label: i18n.t('x.kyc.filter_all'), value: 'all' },
    { label: i18n.t('x.kyc.filter_submitted'), value: 'SUBMITTED' },
    { label: i18n.t('x.kyc.filter_approved'), value: 'APPROVED' },
    { label: i18n.t('x.kyc.filter_rejected'), value: 'REJECTED' },
    { label: i18n.t('x.kyc.filter_resubmit'), value: 'RESUBMIT_REQUIRED' },
  ]

  // Export PDF des dossiers KYC affichés (stats : taux d'approbation, temps
  // moyen de traitement, score IA moyen).
  const handleExportKycPdf = () => {
    const withScore = filtered.filter((k) => typeof k.kycDocument?.aiScore === 'number')
    const avgAi = withScore.length ? Math.round(withScore.reduce((s, k) => s + (k.kycDocument!.aiScore as number), 0) / withScore.length) : null
    const reviewed = filtered.filter((k) => k.kycDocument?.submittedAt && k.kycDocument?.reviewedAt)
    const avgHours = reviewed.length ? Math.round(reviewed.reduce((s, k) => s + (new Date(k.kycDocument!.reviewedAt as string).getTime() - new Date(k.kycDocument!.submittedAt).getTime()), 0) / reviewed.length / 3_600_000) : null
    const ok = generatePdfReport({
      title: i18n.t('x.kyc.pdf_title'),
      subtitle: i18n.t('x.kyc.pdf_count', { count: filtered.length }),
      stats: [
        { label: i18n.t('x.kyc.pdf_approval_rate'), value: approvalRateLabel },
        { label: i18n.t('x.kyc.pdf_avg_time'), value: avgHours == null ? '—' : i18n.t('x.kyc.pdf_hours', { h: avgHours }) },
        { label: i18n.t('x.kyc.pdf_avg_score'), value: avgAi == null ? '—' : `${avgAi} / 100` },
      ],
      columns: [i18n.t('x.kyc.pdf_col_user'), i18n.t('x.kyc.pdf_col_status'), i18n.t('x.kyc.pdf_col_score'), i18n.t('x.kyc.pdf_col_submitted'), i18n.t('x.kyc.pdf_col_decided')],
      rows: filtered.map((k) => [
        `${k.fullName ?? '—'} (${k.phone})`,
        i18n.t('kyc_status.' + k.kycStatus),
        typeof k.kycDocument?.aiScore === 'number' ? `${k.kycDocument.aiScore}/100` : '—',
        k.kycDocument?.submittedAt ? fmtDate(k.kycDocument.submittedAt) : '—',
        k.kycDocument?.reviewedAt ? fmtDate(k.kycDocument.reviewedAt) : '—',
      ]),
      filename: `kyc-camwallet-${new Date().toISOString().slice(0, 10)}.pdf`,
    })
    toast(ok ? i18n.t('common.pdf_opened') : i18n.t('common.popup_blocked'), ok ? 'success' : 'error')
  }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('kyc.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.kyc.subtitle', { count: counts.pending })}</p>
        </div>
        <button className="cw-btn" onClick={handleExportKycPdf} disabled={!filtered.length}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.blue, background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 8, padding: '8px 16px', cursor: filtered.length ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
          <FileText size={14} /> {i18n.t('common.export_pdf')}
        </button>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 22 }}>
        {stats.map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
          </div>
        )})}
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setFilterStatus(f.value)}
              style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${filterStatus === f.value ? C.blue : C.border}`, background: filterStatus === f.value ? C.blue + '15' : C.surface, color: filterStatus === f.value ? C.blue : C.textSoft, fontWeight: filterStatus === f.value ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.textMuted, pointerEvents: 'none' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={i18n.t('x.kyc.search_ph')}
            style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, fontSize: 12, outline: 'none', width: 210 }} />
        </div>
      </div>

      {/* Table */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
          <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>
                {[i18n.t('x.kyc.col_user'), i18n.t('x.kyc.col_submitted'), i18n.t('x.kyc.col_status'), i18n.t('x.kyc.col_score'), i18n.t('x.kyc.col_docs'), i18n.t('x.kyc.col_actions')].map((h) => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => {
                const doc = k.kycDocument
                const score = k.complianceScore ?? 0
                const scoreColor = score >= 80 ? C.green : score >= 50 ? C.yellow : C.red
                const statusColor = KYC_STATUS_COLOR[k.kycStatus] ?? C.textMuted
                return (
                  <tr key={k.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, background: statusColor + '20', color: statusColor }}>{initials(k.fullName)}</span>
                        <div>
                          <div style={{ fontWeight: 700, color: C.text }}>{k.fullName ?? '—'}</div>
                          <div style={{ fontSize: 11, color: C.textMuted }}>{k.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', color: C.textMuted, fontSize: 12 }}>{doc?.submittedAt ? fmtDate(doc.submittedAt) : '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', background: statusColor + '20', color: statusColor }}>
                        <span style={{ width: 5, height: 5, borderRadius: 3, background: statusColor, flexShrink: 0 }} />
                        {i18n.t('kyc_status.' + k.kycStatus)}
                      </span>
                      {doc?.aiAnalyzedAt && (() => {
                        const sug = doc.aiSuggestion
                        const m = sug === 'APPROVE' ? { e: '✅', c: C.green } : sug === 'REJECT' ? { e: '❌', c: C.red } : { e: '🔍', c: C.yellow }
                        return (
                          <div title={`Suggestion IA${typeof doc.aiScore === 'number' ? ` · ${doc.aiScore}/100` : ''}`}
                            style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', background: m.c + '18', color: m.c }}>
                            {m.e} IA{typeof doc.aiScore === 'number' ? ` ${doc.aiScore}` : ''}
                          </div>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '12px 14px', minWidth: 130 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor, minWidth: 32 }}>{score} %</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['idFrontUrl', 'idBackUrl', 'selfieUrl'] as const).map((key, i) => (
                          <span key={key} title={[i18n.t('x.kyc.id_front'), i18n.t('x.kyc.id_back'), i18n.t('x.kyc.selfie')][i]}
                            style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', background: doc?.[key] ? C.green + '20' : C.border + '80', color: doc?.[key] ? C.green : C.textMuted }}>
                            {doc?.[key] ? <Check size={11} /> : <X size={10} />}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <button onClick={() => setSelected(k)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: C.blue, background: C.blue + '15', border: `1px solid ${C.blue}30`, borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>
                        <Eye size={13} /> {i18n.t('x.kyc.see_detail')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>
            {search || filterStatus !== 'all' ? i18n.t('x.kyc.no_results') : i18n.t('x.kyc.no_queue')}
          </div>
        )}
      </div>

      {selected && (
        <KYCDetailModal entry={selected} onClose={() => setSelected(null)} onDecision={() => { setSelected(null); refetch() }} onRefresh={refetch} />
      )}
    </div>
  )
}

function OperatorRatesWidget() {
  const { data, loading } = useFetch(getOperatorRates, [])
  const operators = data?.operators ?? []
  const chartData = operators.map(o => ({
    name: o.name === 'ORANGE_MONEY' ? 'Orange Money' : o.name === 'MTN_MOMO' ? 'MTN MoMo' : o.name,
    taux: Math.round(o.rate * 100) / 100,
  }))

  if (loading || chartData.length === 0) return null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 16 }}>
      <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{i18n.t('finance.operator_rates')}</h2>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} barSize={36}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="name" stroke={C.textMuted} fontSize={12} />
          <YAxis stroke={C.textMuted} fontSize={11} domain={[0, 100]} tickFormatter={v => v + '%'} />
          <Tooltip content={<ChartTooltip />} formatter={(v: number) => v + '%'} />
          <Bar dataKey="taux" name={i18n.t('finance.op_success_rate')} fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Sélecteur de période réutilisable (7j / 30j / 90j [+ Personnalisée]).
function PeriodTabs({ value, onChange, withCustom }: { value: string; onChange: (v: string) => void; withCustom?: boolean }) {
  const opts = withCustom ? ['7d', '30d', '90d', 'custom'] : ['7d', '30d', '90d']
  const label: Record<string, string> = { '7d': i18n.t('dashboard.period_7d'), '30d': i18n.t('dashboard.period_30d'), '90d': i18n.t('dashboard.period_90d'), custom: i18n.t('x.audit.custom') }
  return (
    <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3, gap: 2 }}>
      {opts.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={{
          fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', border: 'none',
          background: value === o ? C.green : 'transparent', color: value === o ? '#fff' : C.textSoft,
        }}>{label[o]}</button>
      ))}
    </div>
  )
}

function TransactionsPage() {
  const [txFilter, setTxFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('')
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'custom'>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounced(searchRaw.trim(), 350)
  const [amountMinRaw, setAmountMinRaw] = useState('')
  const [amountMaxRaw, setAmountMaxRaw] = useState('')
  const amountMin = useDebounced(amountMinRaw.trim(), 400)
  const amountMax = useDebounced(amountMaxRaw.trim(), 400)
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [selectedTx, setSelectedTx] = useState<AdminTransaction | null>(null)
  // Sélection en masse (export de la sélection).
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Bornes de dates dérivées de la période (ou personnalisées).
  const range = useMemo(() => {
    if (period === 'custom') return { from: customFrom || undefined, to: customTo || undefined }
    const days = period === '90d' ? 90 : period === '30d' ? 30 : 7
    return { from: new Date(Date.now() - days * 86400000).toISOString(), to: undefined }
  }, [period, customFrom, customTo])

  // Période du graphe : 7/30/90 (le mode « custom » retombe sur 30j pour l'aire).
  const chartPeriod: '7d' | '30d' | '90d' = period === 'custom' ? '30d' : period

  const { data: stats } = useFetch(() => getStats(), [])
  const { data: ts } = useFetch(() => getTimeseries(chartPeriod), [chartPeriod])
  const { data, loading, error, refetch } = useFetch(
    () => getTransactions({
      limit: 50,
      type: txFilter === 'all' ? undefined : TX_TYPE_FILTER[txFilter],
      status: statusFilter || undefined,
      search: search || undefined,
      from: range.from,
      to: range.to,
      amountMin: amountMin || undefined,
      amountMax: amountMax || undefined,
    }),
    [txFilter, statusFilter, search, range.from, range.to, amountMin, amountMax],
  )
  const txs = data?.data ?? []
  const total = data?.meta.total ?? 0

  // Cartes de synthèse (agrégats globaux issus de /admin/stats).
  const byType = (t: string) => stats?.transactions.byType.find((x) => x.type === t)
  const p2p = byType('P2P')
  const qr = byType('QR_PAYMENT')
  const byStatus = (s: string) => stats?.transactions.byStatus.find((x) => x.status === s)?.count ?? 0
  const completed = byStatus('COMPLETED')
  const failed = byStatus('FAILED') + byStatus('CANCELLED')
  const successRate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : null

  const statCards: { label: string; value: string; sub: string; icon: LucideIcon; color: string }[] = stats ? [
    { label: i18n.t('x.tx.stat_total'), value: stats.transactions.total.toLocaleString('fr-FR'), sub: i18n.t('x.tx.stat_completed_amount', { value: formatFCFA(stats.volume.completedAmount) }), icon: ArrowLeftRight, color: C.blue },
    { label: i18n.t('x.tx.stat_p2p'), value: (p2p?.count ?? 0).toLocaleString('fr-FR'), sub: formatFCFA(p2p?.volume ?? 0), icon: ArrowRight, color: C.blue },
    { label: i18n.t('x.tx.stat_qr'), value: (qr?.count ?? 0).toLocaleString('fr-FR'), sub: formatFCFA(qr?.volume ?? 0), icon: Zap, color: C.green },
    { label: i18n.t('x.tx.stat_rate'), value: successRate == null ? '—' : successRate + ' %', sub: i18n.t('x.tx.stat_rate_sub', { completed, failed }), icon: Percent, color: successRate == null ? C.textMuted : successRate >= 95 ? C.green : C.red },
  ] : []

  const areaData = (ts?.series ?? []).map((p) => ({ date: p.date.slice(5), volume: toFcfa(p.volume) }))

  const handleExportTransactions = async () => {
    setExporting(true)
    try {
      await downloadTransactionsCSV()
      toast(i18n.t('x.tx.exported'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.tx.export_failed'), 'error')
    } finally {
      setExporting(false)
    }
  }

  // Libellé lisible de la période sélectionnée (pour le sous-titre du rapport).
  const periodLabel = period === 'custom'
    ? `${customFrom || '…'} → ${customTo || '…'}`
    : period === '7d' ? i18n.t('dashboard.period_7d') : period === '30d' ? i18n.t('dashboard.period_30d') : i18n.t('dashboard.period_90d')

  // Export PDF des transactions actuellement affichées (filtres + totaux).
  const handleExportTxPdf = () => {
    const filters: { label: string; value: string }[] = []
    if (txFilter !== 'all') filters.push({ label: i18n.t('x.tx.pdf_type'), value: TX_TYPE_LABEL[TX_TYPE_FILTER[txFilter]] ?? txFilter })
    if (statusFilter) filters.push({ label: i18n.t('x.tx.pdf_status'), value: statusFilter })
    if (search) filters.push({ label: i18n.t('common.search'), value: search })
    if (amountMin || amountMax) filters.push({ label: i18n.t('x.tx.pdf_amount'), value: `${amountMin || '0'} – ${amountMax || '∞'} FCFA` })

    const volume = txs.reduce((s, tx) => s + tx.amount, 0)
    const fees = txs.reduce((s, tx) => s + tx.fee, 0)

    const ok = generatePdfReport({
      title: i18n.t('x.tx.pdf_title'),
      subtitle: i18n.t('x.tx.pdf_period', { value: periodLabel }),
      filters,
      orientation: 'landscape',
      columns: [i18n.t('x.tx.pdf_ref'), i18n.t('x.tx.pdf_type'), i18n.t('x.tx.pdf_from'), i18n.t('x.tx.pdf_to'), i18n.t('x.tx.pdf_amount'), i18n.t('x.tx.pdf_fees'), i18n.t('x.tx.pdf_status'), i18n.t('x.tx.pdf_date')],
      rows: txs.map((tx) => [
        tx.reference,
        TX_TYPE_LABEL[tx.type] ?? tx.type,
        partyLabel(tx.sender, i18n.t('common.operator')),
        partyLabel(tx.receiver, i18n.t('common.operator')),
        toFcfa(tx.amount).toLocaleString('fr-FR'),
        toFcfa(tx.fee).toLocaleString('fr-FR'),
        tx.status,
        fmtDate(tx.createdAt),
      ]),
      totals: [
        { label: i18n.t('x.tx.pdf_total_count'), value: txs.length.toLocaleString('fr-FR') },
        { label: i18n.t('x.tx.pdf_total_volume'), value: formatFCFA(volume) },
        { label: i18n.t('x.tx.pdf_total_fees'), value: formatFCFA(fees) },
      ],
      filename: `transactions-camwallet-${new Date().toISOString().slice(0, 10)}.pdf`,
    })
    toast(ok ? i18n.t('common.pdf_opened') : i18n.t('common.popup_blocked'), ok ? 'success' : 'error')
  }

  const inputStyle: CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('transactions.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.tx.subtitle', { count: total })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cw-btn" onClick={handleExportTransactions} disabled={exporting}
            style={{ fontSize: 13, color: C.green, background: C.greenLight, border: `1px solid ${C.green}40`, borderRadius: 8, padding: '8px 16px', cursor: exporting ? 'wait' : 'pointer', fontWeight: 600 }}>{i18n.t('common.export_csv')}</button>
          <button className="cw-btn" onClick={handleExportTxPdf}
            style={{ fontSize: 13, color: C.blue, background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('common.export_pdf')}</button>
        </div>
      </div>

      {/* Cartes de synthèse */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statCards.map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{s.sub}</div>
          </div>
        )})}
      </div>

      {/* Graphe volume (aire émeraude) */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('x.tx.chart_volume')}</h2>
          <PeriodTabs value={chartPeriod} onChange={(v) => setPeriod(v as any)} />
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={areaData} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="txVol" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C.green} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} width={48}
              tickFormatter={(v) => (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v))} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="volume" name="Volume" stroke={C.green} strokeWidth={2} fill="url(#txVol)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', 'P2P', 'QR', 'RECHARGE', 'RETRAIT'].map(f => (
            <button key={f} className="cw-chip" onClick={() => setTxFilter(f)} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              background: txFilter === f ? C.green : C.card, border: `1px solid ${txFilter === f ? C.green : C.border}`,
              color: txFilter === f ? '#fff' : C.textSoft, fontWeight: txFilter === f ? 700 : 500,
            }}>{f === 'all' ? i18n.t('x.tx.all_types') : f}</button>
          ))}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.tx.all_statuses')}</option>
          <option value="COMPLETED">{i18n.t('x.tx.st_completed')}</option>
          <option value="PENDING">{i18n.t('x.tx.st_pending')}</option>
          <option value="FAILED">{i18n.t('x.tx.st_failed')}</option>
        </select>
        <PeriodTabs value={period} onChange={(v) => setPeriod(v as any)} withCustom />
        {period === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle} />
            <span style={{ color: C.textMuted }}>→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
          </>
        )}
        <input type="number" inputMode="numeric" value={amountMinRaw} onChange={(e) => setAmountMinRaw(e.target.value)} placeholder={i18n.t('x.tx.amount_min')} style={{ ...inputStyle, width: 120 }} />
        <input type="number" inputMode="numeric" value={amountMaxRaw} onChange={(e) => setAmountMaxRaw(e.target.value)} placeholder={i18n.t('x.tx.amount_max')} style={{ ...inputStyle, width: 120 }} />
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={15} color={C.textMuted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder={i18n.t('x.tx.search_ph')}
            style={{ ...inputStyle, width: '100%', paddingLeft: 34 }} />
        </div>
      </div>

      {/* Barre de sélection en masse */}
      {picked.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 14px', background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{i18n.t('x.tx.selected', { count: picked.size })}</span>
          <button onClick={() => {
            const rows = txs.filter((t) => picked.has(t.id))
            downloadCsv('transactions-selection.csv', [i18n.t('x.tx.pdf_ref'), i18n.t('x.tx.pdf_type'), i18n.t('x.tx.pdf_from'), i18n.t('x.tx.pdf_to'), i18n.t('x.tx.pdf_amount'), i18n.t('x.tx.pdf_fees'), i18n.t('x.tx.pdf_status'), i18n.t('x.tx.pdf_date')],
              rows.map((tx) => [tx.reference, TX_TYPE_LABEL[tx.type] ?? tx.type, partyLabel(tx.sender, i18n.t('common.operator')), partyLabel(tx.receiver, i18n.t('common.operator')), toFcfa(tx.amount).toLocaleString('fr-FR'), toFcfa(tx.fee).toLocaleString('fr-FR'), tx.status, fmtDate(tx.createdAt)]))
            toast(i18n.t('x.tx.selection_exported'), 'success')
          }} style={{ fontSize: 12, color: C.blue, background: C.card, border: `1px solid ${C.blue}40`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.tx.export_selection')}</button>
          <button onClick={() => setPicked(new Set())} style={{ fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>{i18n.t('x.tx.clear')}</button>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: C.surface }}>
            <tr>
              <th style={{ width: 36, padding: '12px 0 12px 14px' }}></th>
              {[i18n.t('x.tx.col_ref'), i18n.t('x.tx.col_type'), i18n.t('x.tx.col_from'), i18n.t('x.tx.col_to'), i18n.t('x.tx.col_amount'), i18n.t('x.tx.col_fees'), i18n.t('x.tx.col_status'), i18n.t('x.tx.col_date')].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.map(tx => {
              const tColor = TX_TYPE_COLOR[tx.type] ?? C.text
              return (
              <tr key={tx.id} className="cw-row" onClick={() => setSelectedTx(tx)} style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <td style={{ padding: '11px 0 11px 14px' }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={picked.has(tx.id)} onChange={() => togglePick(tx.id)} aria-label={i18n.t('x.tx.select_aria')} style={{ cursor: 'pointer', accentColor: C.green }} />
                </td>
                <td style={{ padding: '11px 14px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CopyableRef value={tx.reference} truncate={10} />
                    {tx.resolved && <CheckCircle2 size={13} color={C.green} aria-label={i18n.t('x.tx.resolved_aria')} />}
                  </div>
                </td>
                <td style={{ padding: '11px 14px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                <td style={{ padding: '11px 14px' }}><UserCell party={tx.sender} /></td>
                <td style={{ padding: '11px 14px' }}><UserCell party={tx.receiver} /></td>
                <td style={{ padding: '11px 14px', color: tColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatFCFA(tx.amount)}</td>
                <td style={{ padding: '11px 14px', color: C.textMuted }}>{tx.fee > 0 ? formatFCFA(tx.fee) : '—'}</td>
                <td style={{ padding: '11px 14px' }}><StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} /></td>
                <td style={{ padding: '11px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(tx.createdAt)}>{relativeTime(tx.createdAt)}</td>
              </tr>
            )})}
          </tbody>
        </table>
        </div>
        {!loading && !error && txs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>{i18n.t('x.tx.no_tx')}</div>
        )}
        <StateRow loading={loading} error={error} />
      </div>

      {selectedTx && (
        <TransactionDetailModal
          tx={selectedTx}
          onClose={() => setSelectedTx(null)}
          onRetried={() => { setSelectedTx(null); refetch() }}
        />
      )}
    </div>
  )
}

// Modale de détail d'une transaction (timeline, infos, JSON technique, relance).
function TransactionDetailModal({ tx, onClose, onRetried }: { tx: AdminTransaction; onClose: () => void; onRetried: () => void }) {
  const toast = useToast()
  const [retrying, setRetrying] = useState(false)
  const [showTicket, setShowTicket] = useState(false)
  // Équipe chargée à l'ouverture (nécessaire au formulaire de ticket pour l'assignation).
  const { data: team } = useFetch(() => getAdminTeam(), [])

  const phase = TX_STATUS_BADGE[tx.status] ?? tx.status
  const failed = phase === 'failed'
  const pending = phase === 'pending'
  const isOperatorTx = tx.type === 'RECHARGE' || tx.type === 'WITHDRAWAL'
  // Relance possible uniquement pour une recharge/retrait opérateur en attente.
  const canRetry = tx.status === 'PENDING' && isOperatorTx

  // Client rattaché à la transaction : l'émetteur en priorité, sinon le destinataire
  // (cas d'une recharge opérateur où l'émetteur est null).
  const ticketClient = tx.senderId
    ? { id: tx.senderId, fullName: tx.sender?.fullName ?? null, phone: tx.sender?.phone ?? '' }
    : tx.receiverId
      ? { id: tx.receiverId, fullName: tx.receiver?.fullName ?? null, phone: tx.receiver?.phone ?? '' }
      : null
  // Contexte pré-rempli pour un ticket ouvert depuis cette transaction.
  const ticketInitial = ticketClient ? {
    client: ticketClient,
    title: i18n.t('x.txd.ticket_title', { ref: tx.reference }),
    category: 'PAYMENT',
    description: i18n.t('x.txd.ticket_desc', { ref: tx.reference, type: TX_TYPE_LABEL[tx.type] ?? tx.type, amount: formatFCFA(tx.amount), status: tx.status, date: fmtDate(tx.createdAt) }),
  } : undefined

  // Timeline avec horodatages réels : created → processing → final.
  const finalTime = tx.processedAt ?? tx.updatedAt ?? null
  const steps: { label: string; state: 'done' | 'active' | 'failed' | 'future'; at: string | null }[] = failed
    ? [{ label: i18n.t('x.txd.step_created'), state: 'done', at: tx.createdAt }, { label: i18n.t('x.txd.step_processing'), state: 'done', at: tx.updatedAt ?? null }, { label: i18n.t('x.txd.step_failed'), state: 'failed', at: finalTime }]
    : pending
      ? [{ label: i18n.t('x.txd.step_created'), state: 'done', at: tx.createdAt }, { label: i18n.t('x.txd.step_active'), state: 'active', at: tx.updatedAt ?? null }, { label: i18n.t('x.txd.step_completed'), state: 'future', at: null }]
      : [{ label: i18n.t('x.txd.step_created'), state: 'done', at: tx.createdAt }, { label: i18n.t('x.txd.step_processing'), state: 'done', at: tx.updatedAt ?? null }, { label: i18n.t('x.txd.step_completed'), state: 'done', at: finalTime }]

  const stepColor = (s: string) => (s === 'failed' ? C.red : s === 'future' ? C.textMuted : s === 'active' ? C.yellow : C.green)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await retryOperation(tx.id)
      toast(i18n.t('x.txd.op_relaunched'), 'success')
      onRetried()
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.txd.retry_failed'), 'error')
    } finally {
      setRetrying(false)
    }
  }

  // Reçu PDF imprimable de la transaction.
  const handleReceipt = () => {
    const ok = exportPdfReport(
      i18n.t('x.txd.receipt_title', { ref: tx.reference }),
      [i18n.t('x.txd.field'), i18n.t('x.txd.value')],
      [
        [i18n.t('x.txd.row_ref'), tx.reference],
        [i18n.t('x.txd.row_type'), TX_TYPE_LABEL[tx.type] ?? tx.type],
        [i18n.t('x.txd.row_status'), tx.status],
        [i18n.t('x.txd.row_sender'), partyLabel(tx.sender, i18n.t('common.operator'))],
        [i18n.t('x.txd.row_receiver'), partyLabel(tx.receiver, i18n.t('common.operator'))],
        [i18n.t('x.txd.row_amount'), formatFCFA(tx.amount)],
        [i18n.t('x.txd.row_fees'), formatFCFA(tx.fee)],
        ...(tx.operator ? [[i18n.t('x.txd.row_operator'), OPERATOR_META[tx.operator]?.label ?? tx.operator] as [string, string]] : []),
        ...(tx.operatorRef ? [[i18n.t('x.txd.row_op_ref'), tx.operatorRef] as [string, string]] : []),
        [i18n.t('x.txd.row_created'), fmtDate(tx.createdAt)],
        ...(finalTime ? [[i18n.t('x.txd.row_processed'), fmtDate(finalTime)] as [string, string]] : []),
      ],
    )
    toast(ok ? i18n.t('x.txd.receipt_opened') : i18n.t('common.popup_blocked'), ok ? 'success' : 'error')
  }

  const tColor = TX_TYPE_COLOR[tx.type] ?? C.text
  const partyCard = (title: string, party: { fullName: string | null; phone: string } | null) => (
    <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</div>
      <UserCell party={party} />
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: 580, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ArrowLeftRight size={18} color={C.green} />
            <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{i18n.t('x.txd.title')}</h2>
          </div>
          <button className="cw-iconbtn" onClick={onClose} aria-label={i18n.t('common.close')} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 4, borderRadius: 6 }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Montant + statut */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 900, color: tColor, letterSpacing: -0.5 }}>{formatFCFA(tx.amount)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <CopyableRef value={tx.reference} truncate={14} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <StatusBadge status={phase} />
              <TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} />
            </div>
          </div>

          {/* Timeline avec horodatages */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            {steps.map((s, i, arr) => (
              <Fragment key={s.label}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 92 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 6, background: stepColor(s.state) }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: s.state === 'future' ? C.textMuted : C.textSoft }}>{s.label}</span>
                  <span style={{ fontSize: 10, color: C.textMuted, textAlign: 'center' }}>{s.at ? fmtDate(s.at) : '—'}</span>
                </div>
                {i < arr.length - 1 && <span style={{ flex: 1, height: 2, marginTop: 5, background: arr[i].state === 'done' ? C.green : C.border }} />}
              </Fragment>
            ))}
          </div>

          {/* Émetteur / Destinataire */}
          <div style={{ display: 'flex', gap: 12 }}>
            {partyCard(i18n.t('tx_detail.row_sender'), tx.sender)}
            {partyCard(i18n.t('tx_detail.row_receiver'), tx.receiver)}
          </div>

          {/* Frais */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: C.border, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {([
              [i18n.t('x.txd.label_fees'), tx.fee > 0 ? formatFCFA(tx.fee) : i18n.t('x.txd.fees_none')],
              [i18n.t('x.txd.label_id'), tx.id],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} style={{ background: C.card, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600, wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Soldes émetteur avant / après (capturés dans la transaction ACID) */}
          {tx.senderBalanceBefore != null && tx.senderBalanceAfter != null && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{i18n.t('x.txd.sender_balance')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.txd.before')}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.textSoft }}>{formatFCFA(tx.senderBalanceBefore)}</div>
                </div>
                <ArrowRight size={16} color={C.textMuted} />
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.txd.after')}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: tx.senderBalanceAfter < tx.senderBalanceBefore ? C.red : C.green }}>{formatFCFA(tx.senderBalanceAfter)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Section opérateur (recharge/retrait OM/MoMo) */}
          {isOperatorTx && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{i18n.t('x.txd.mm_op')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('x.txd.operator')}</span>
                  <OperatorBadge operator={tx.operator ?? null} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('x.txd.op_ref')}</span>
                  {tx.operatorRef ? <CopyableRef value={tx.operatorRef} truncate={20} /> : <span style={{ color: C.textMuted, fontSize: 12 }}>—</span>}
                </div>
                {tx.operatorStatus && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('x.txd.op_status')}</span>
                    <span style={{ fontSize: 12, color: C.textSoft, fontFamily: 'monospace' }}>{tx.operatorStatus}</span>
                  </div>
                )}
                {tx.failureReason && (
                  <div style={{ fontSize: 12, color: C.red, marginTop: 2 }}>⚠ {tx.failureReason}</div>
                )}
              </div>
            </div>
          )}

          {/* Données techniques (JSON brut) */}
          <details>
            <summary style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer' }}>{i18n.t('x.txd.tech_data')}</summary>
            <pre style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, fontSize: 11.5, color: C.textSoft, overflowX: 'auto', margin: '8px 0 0' }}>{JSON.stringify(tx, null, 2)}</pre>
          </details>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="cw-btn" onClick={handleReceipt}
              style={{ fontSize: 13, color: C.blue, background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>
              {i18n.t('x.txd.receipt_pdf')}
            </button>
            {!isReadOnly() && ticketClient && (
              <button className="cw-btn" onClick={() => setShowTicket(true)}
                style={{ fontSize: 13, color: C.purple, background: C.purple + '18', border: `1px solid ${C.purple}40`, borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>
                {i18n.t('x.txd.open_ticket')}
              </button>
            )}
            {!isReadOnly() && canRetry && (
              <button className="cw-btn" onClick={handleRetry} disabled={retrying}
                style={{ fontSize: 13, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '9px 18px', cursor: retrying ? 'wait' : 'pointer', fontWeight: 700 }}>
                {retrying ? i18n.t('x.txd.retrying') : i18n.t('x.txd.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
      {showTicket && ticketInitial && (
        <NewTicketModal
          team={team ?? []}
          initial={ticketInitial}
          zIndex={320}
          onClose={() => setShowTicket(false)}
          onCreated={(id) => { setShowTicket(false); toast(i18n.t('x.txd.ticket_created', { ref: tx.reference }), 'success'); void id }}
        />
      )}
    </div>
  )
}

function FinancePage() {
  const { data: stats, loading, error } = useFetch(() => getStats(), [])
  // Séries 30 j pour les sparklines des KPI.
  const { data: ts } = useFetch(() => getTimeseries('30d'), [])
  const series = ts?.series ?? []
  const sparkFees = series.map((p) => toFcfa(p.fees))
  const sparkVol = series.map((p) => toFcfa(p.volume))
  const sparkTx = series.map((p) => p.transactions)

  const byType = (stats?.transactions.byType ?? []).map((t) => ({
    name: TX_TYPE_LABEL[t.type] ?? t.type,
    volume: toFcfa(t.volume),
    count: t.count,
    color: TX_TYPE_COLOR[t.type] ?? C.textMuted,
  }))

  const kpis: { label: string; value: string; icon: LucideIcon; color: string; trend?: number | null; spark: number[] }[] = stats
    ? [
        { label: i18n.t('x.fin.kpi_fees'), value: formatFCFA(stats.volume.collectedFees), icon: Wallet, color: C.green, spark: sparkFees },
        { label: i18n.t('x.fin.kpi_volume'), value: formatFCFA(stats.volume.completedAmount), icon: TrendingUp, color: C.blue, trend: stats.trends.volume, spark: sparkVol },
        { label: i18n.t('x.fin.kpi_balance'), value: formatFCFA(stats.totalBalance), icon: Landmark, color: C.purple, spark: [] },
        { label: i18n.t('x.fin.kpi_tx'), value: stats.transactions.total.toLocaleString('fr-FR'), icon: Zap, color: C.yellow, trend: stats.trends.transactions, spark: sparkTx },
      ]
    : []

  const exportBtn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: C.surface, color: C.textSoft }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('finance.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('finance.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cw-btn" style={exportBtn} disabled={!byType.length}
            onClick={() => downloadCsv('finances-camwallet.csv', [i18n.t('x.fin.col_type'), i18n.t('x.fin.col_tx'), i18n.t('x.fin.col_volume')], byType.map((d) => [d.name, d.count, d.volume]))}>
            <FileText size={14} /> {i18n.t('common.export_csv')}
          </button>
          <button className="cw-btn" style={exportBtn} disabled={!byType.length}
            onClick={() => exportPdfReport(i18n.t('x.fin.pdf_title'), [i18n.t('x.fin.col_type'), i18n.t('x.fin.col_tx'), i18n.t('x.fin.col_volume2')], byType.map((d) => [d.name, d.count, fmt(d.volume)]))}>
            <FileText size={14} /> {i18n.t('common.export_pdf')}
          </button>
        </div>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* KPIs financiers avec sparklines */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
          {kpis.map((s) => {
            const Icon = s.icon
            const TrendIcon = (s.trend ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight
            return (
              <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{s.label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: s.color + '1F', color: s.color }}><Icon size={16} /></span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{s.value}</div>
                {s.trend != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: s.trend >= 0 ? C.green : C.red, fontWeight: 600, marginTop: 4 }}>
                    <TrendIcon size={13} /> {Math.abs(s.trend)} %
                  </div>
                )}
                {s.spark.length > 1 && <div style={{ marginTop: 10 }}><Sparkline data={s.spark} color={s.color} /></div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Volume par type — barres horizontales avec valeurs en bout de barre */}
      {stats && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 20 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{i18n.t('x.fin.by_type')}</h2>
          <ResponsiveContainer width="100%" height={Math.max(180, byType.length * 56)}>
            <BarChart data={byType} layout="vertical" margin={{ top: 4, right: 96, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v) => (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k')} />
              <YAxis type="category" dataKey="name" stroke={C.textMuted} fontSize={12} width={88} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: C.greenLight }} content={<ChartTooltip />} />
              <Bar dataKey="volume" name={i18n.t('x.fin.series_volume')} radius={[0, 6, 6, 0]} maxBarSize={34}>
                {byType.map((d, i) => <Cell key={i} fill={d.color} />)}
                <LabelList dataKey="volume" position="right" formatter={(v: number) => fmt(v)} style={{ fill: C.text, fontSize: 11, fontWeight: 700 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Détail par type (réel) */}
      {stats && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{i18n.t('x.fin.detail_by_type')}</h2>
          {byType.length === 0 && <div style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.fin.no_tx')}</div>}
          {byType.map((d) => (
            <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                <span style={{ color: C.textMuted, fontSize: 12 }}>· {i18n.t('x.fin.tx_count', { count: d.count })}</span>
              </div>
              <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>{fmt(d.volume)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page : Recharges & Retraits OM/MoMo ──────────────────
function WebhookPayloadCell({ wh }: { wh: WebhookEvent }) {
  const [open, setOpen] = useState(false)
  const statusColor = wh.processed ? C.green : wh.error ? C.red : C.yellow
  const statusLabel = wh.processed ? i18n.t('x.ops.wh_processed') : wh.error ? i18n.t('x.ops.wh_error') : i18n.t('x.ops.wh_pending')
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        <button
          onClick={() => setOpen(v => !v)}
          title={i18n.t('x.ops.wh_see_payload')}
          style={{ fontSize: 10, background: C.border, color: C.textMuted, border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
        >
          {open ? i18n.t('x.ops.wh_payload_hide') : i18n.t('x.ops.wh_payload_show')}
        </button>
      </div>
      {wh.error && <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>{wh.error}</div>}
      {open && (
        <pre style={{
          marginTop: 6, padding: 8, borderRadius: 6,
          background: C.bg, border: `1px solid ${C.border}`,
          fontSize: 10, color: C.textMuted,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto',
        }}>
          {JSON.stringify(wh.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

const OP_ORANGE = C.orange // orange retraits (graphe + montants)

function OperationsPage() {
  const [page, setPage] = useState(1)
  const [operator, setOperator] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounced(searchRaw.trim(), 350)
  const [activeTab, setActiveTab] = useState<'ops' | 'webhooks'>('ops')
  const showToast = useContext(ToastContext)
  const { data, loading, error, refetch } = useFetch(
    () => getOperations(page, 20, {
      operator: operator || undefined,
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      search: search || undefined,
      period,
    }),
    [page, operator, statusFilter, typeFilter, search, period],
  )

  // Sélection en masse + détail au clic.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkRetrying, setBulkRetrying] = useState(false)
  const [detailOp, setDetailOp] = useState<AdminOperation | null>(null)
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Tout changement de filtre ramène à la première page.
  useEffect(() => { setPage(1); setPicked(new Set()) }, [operator, statusFilter, typeFilter, search, period])

  const handleRetry = async (id: string) => {
    try {
      await retryOperation(id)
      showToast(i18n.t('x.ops.op_relaunched'))
      refetch()
    } catch (e) {
      showToast(e instanceof Error ? e.message : i18n.t('x.ops.retry_failed'), 'error')
    }
  }

  const handleBulkRetry = async () => {
    setBulkRetrying(true)
    const ids = [...picked]
    let ok = 0, ko = 0
    for (const id of ids) {
      try { await retryOperation(id); ok++ } catch { ko++ }
    }
    setBulkRetrying(false); setPicked(new Set()); refetch()
    showToast(i18n.t('x.ops.bulk_done', { ok, ko: ko ? i18n.t('x.ops.bulk_ko', { count: ko }) : '' }), ko ? 'error' : 'success')
  }

  const ops = data?.data ?? []
  const webhooks = data?.webhookEvents ?? []
  const stats = data?.stats
  const pendingWebhooks = stats?.pendingWebhooks ?? 0
  // L'« utilisateur » d'une opération : le bénéficiaire pour une recharge,
  // l'émetteur pour un retrait (l'autre partie étant l'opérateur mobile).
  const opUser = (op: AdminOperation) => (op.type === 'RECHARGE' ? op.receiver : op.sender)

  const chartData = (data?.chart ?? []).map((c) => ({ date: c.date.slice(5), recharge: toFcfa(c.recharge), withdrawal: toFcfa(c.withdrawal) }))

  const successRate = stats?.successRate ?? null
  const statCards: { label: string; value: string; sub: string; icon: LucideIcon; color: string; trend?: number | null; badge?: number }[] = [
    { label: i18n.t('x.ops.kpi_recharges'), value: formatFCFA(stats?.rechargeTotal ?? 0), sub: i18n.t('x.ops.ops_count', { count: stats?.rechargeCount ?? 0 }), icon: ArrowDownToLine, color: C.green, trend: stats?.rechargeTrend },
    { label: i18n.t('x.ops.kpi_withdrawals'), value: formatFCFA(stats?.withdrawalTotal ?? 0), sub: i18n.t('x.ops.ops_count', { count: stats?.withdrawalCount ?? 0 }), icon: ArrowUpFromLine, color: OP_ORANGE, trend: stats?.withdrawalTrend },
    { label: i18n.t('x.ops.kpi_webhooks'), value: String(pendingWebhooks), sub: i18n.t('x.ops.not_processed'), icon: Wifi, color: pendingWebhooks > 0 ? C.red : C.green, badge: pendingWebhooks },
    { label: i18n.t('x.ops.kpi_rate'), value: successRate == null ? '—' : successRate + ' %', sub: i18n.t('x.ops.last_7d'), icon: Percent, color: successRate == null ? C.textMuted : successRate >= 95 ? C.green : C.red },
  ]

  const inputStyle: CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }
  const opTypeColor = (type: string) => (type === 'RECHARGE' ? C.green : OP_ORANGE)

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('x.ops.title')}</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.ops.subtitle')}</p>
      </div>

      {/* Cartes de synthèse */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statCards.map((k) => { const Icon = k.icon; const TrendIcon = (k.trend ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight; return (
          <div key={k.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{k.label}</span>
              <span style={{ position: 'relative', display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: k.color + '1F', color: k.color, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={15} />
                {!!k.badge && k.badge > 0 && (
                  <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: C.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{k.badge}</span>
                )}
              </span>
            </div>
            <div style={{ fontSize: 21, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{k.value}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{k.sub}</span>
              {k.trend != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 700, color: k.trend >= 0 ? C.green : C.red }}>
                  <TrendIcon size={12} />{Math.abs(k.trend)} %
                </span>
              )}
            </div>
          </div>
        )})}
      </div>

      {/* Graphe recharges vs retraits (7 jours) */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('x.ops.chart_title')}</h2>
          <div style={{ display: 'flex', gap: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSoft }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.green }} />{i18n.t('x.ops.recharges')}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSoft }}><span style={{ width: 10, height: 10, borderRadius: 2, background: OP_ORANGE }} />{i18n.t('x.ops.withdrawals')}</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 6, right: 8, left: 4, bottom: 0 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} width={48}
              tickFormatter={(v) => (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v))} />
            <Tooltip cursor={{ fill: C.greenLight }} content={<ChartTooltip />} />
            <Bar dataKey="recharge" name={i18n.t('x.ops.recharges')} fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Bar dataKey="withdrawal" name={i18n.t('x.ops.withdrawals')} fill={OP_ORANGE} radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={operator} onChange={e => setOperator(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.ops.all_operators')}</option>
          <option value="ORANGE_MONEY">Orange Money</option>
          <option value="MTN_MOMO">MTN MoMo</option>
          <option value="CAMPAY">CamPay</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.ops.all_types')}</option>
          <option value="RECHARGE">{i18n.t('x.ops.type_recharge')}</option>
          <option value="WITHDRAWAL">{i18n.t('x.ops.type_withdrawal')}</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.ops.all_statuses')}</option>
          <option value="COMPLETED">{i18n.t('x.ops.st_completed')}</option>
          <option value="PENDING">{i18n.t('x.ops.st_pending')}</option>
          <option value="PROCESSING">{i18n.t('x.ops.st_processing')}</option>
          <option value="FAILED">{i18n.t('x.ops.st_failed')}</option>
        </select>
        <PeriodTabs value={period} onChange={(v) => setPeriod(v as any)} />
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} color={C.textMuted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder={i18n.t('x.ops.search_ph')}
            style={{ ...inputStyle, width: '100%', paddingLeft: 34 }} />
        </div>
      </div>

      {/* Alerte seuil d'échec (> 10 %) */}
      {successRate != null && (100 - successRate) > 10 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '12px 16px', background: C.redLight, border: `1px solid ${C.red}40`, borderRadius: 10 }}>
          <Siren size={18} color={C.red} />
          <span style={{ fontSize: 13, color: C.text }}><strong style={{ color: C.red }}>{i18n.t('x.ops.fail_alert_strong', { rate: 100 - successRate })}</strong>{i18n.t('x.ops.fail_alert_rest')}</span>
        </div>
      )}

      {/* Barre de relance en masse */}
      {picked.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 14px', background: C.yellowLight, border: `1px solid ${C.yellow}40`, borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{i18n.t('x.ops.selected', { count: picked.size })}</span>
          {!isReadOnly() && (
            <button onClick={handleBulkRetry} disabled={bulkRetrying} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.amber, background: C.card, border: `1px solid ${C.yellow}60`, borderRadius: 8, padding: '6px 12px', cursor: bulkRetrying ? 'wait' : 'pointer', fontWeight: 600 }}>
              <RotateCcw size={13} /> {bulkRetrying ? i18n.t('x.ops.bulk_retrying') : i18n.t('x.ops.bulk_retry')}
            </button>
          )}
          <button onClick={() => setPicked(new Set())} style={{ fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>{i18n.t('x.tx.clear')}</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
        {(['ops', 'webhooks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              padding: '8px 16px', color: activeTab === t ? C.green : C.textMuted,
              borderBottom: activeTab === t ? `2px solid ${C.green}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'ops' ? i18n.t('x.ops.tab_ops', { count: data?.total ?? 0 }) : i18n.t('x.ops.tab_webhooks', { count: webhooks.length })}
            {t === 'webhooks' && pendingWebhooks > 0 && (
              <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: C.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{pendingWebhooks}</span>
            )}
          </button>
        ))}
      </div>

      <StateRow loading={loading} error={error} />

      {activeTab === 'ops' && (
        <>
          {ops.length === 0 && !loading && !error && (
            <StateRow empty={i18n.t('x.ops.no_ops')} />
          )}
          {ops.length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            <div className="cw-tablewrap">
              <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: C.surface }}>
                  <tr>
                    <th style={{ width: 34, padding: '12px 0 12px 12px' }}></th>
                    {[i18n.t('x.ops.col_date'), i18n.t('x.ops.col_type'), i18n.t('x.ops.col_user'), i18n.t('x.ops.col_operator'), i18n.t('x.ops.col_amount'), i18n.t('x.ops.col_status'), i18n.t('x.ops.col_op_ref'), i18n.t('x.ops.col_tries'), i18n.t('x.ops.col_action')].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '12px 12px', color: C.textMuted, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ops.map(op => { const retriable = op.status === 'PENDING' || op.status === 'FAILED'; return (
                    <tr key={op.id} className="cw-row" onClick={() => setDetailOp(op)} style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                      <td style={{ padding: '10px 0 10px 12px' }} onClick={(e) => e.stopPropagation()}>
                        {retriable && <input type="checkbox" checked={picked.has(op.id)} onChange={() => togglePick(op.id)} aria-label={i18n.t('x.ops.select_aria')} style={{ cursor: 'pointer', accentColor: C.yellow }} />}
                      </td>
                      <td style={{ padding: '10px 12px', color: C.textMuted, whiteSpace: 'nowrap', fontSize: 12 }} title={fmtDate(op.createdAt)}>{relativeTime(op.createdAt)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: opTypeColor(op.type) + '20', color: opTypeColor(op.type), padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                          {op.type === 'RECHARGE' ? i18n.t('x.ops.type_recharge') : i18n.t('x.ops.type_withdrawal')}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}><UserCell party={opUser(op)} /></td>
                      <td style={{ padding: '10px 12px' }}><OperatorBadge operator={op.operator ?? null} /></td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: opTypeColor(op.type), whiteSpace: 'nowrap' }}>{formatFCFA(op.amount)}</td>
                      <td style={{ padding: '10px 12px' }}><StatusBadge status={TX_STATUS_BADGE[op.status] ?? op.status} /></td>
                      <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>{op.operatorRef ? <CopyableRef value={op.operatorRef} truncate={14} /> : <span style={{ color: C.textMuted }}>—</span>}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {op.retryCount > 0
                          ? <span style={{ fontSize: 11, fontWeight: 800, background: C.redLight, color: C.red, borderRadius: 10, padding: '2px 8px' }}>{op.retryCount}</span>
                          : <span style={{ color: C.textMuted }}>0</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                        {!isReadOnly() && retriable && (
                          <button
                            onClick={() => handleRetry(op.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: C.yellow + '20', color: C.amber, border: `1px solid ${C.yellow}40`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}
                          >
                            <RotateCcw size={11} /> {i18n.t('x.ops.retry')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
            </div>
          )}
          {(data?.total ?? 0) > 20 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '6px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', color: C.textSoft, cursor: 'pointer' }}>{i18n.t('x.ops.prev')}</button>
              <span style={{ color: C.textMuted, fontSize: 13, alignSelf: 'center' }}>{i18n.t('x.ops.page_info', { page, total: data?.total })}</span>
              <button disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', color: C.textSoft, cursor: 'pointer' }}>{i18n.t('x.ops.next')}</button>
            </div>
          )}
        </>
      )}

      {activeTab === 'webhooks' && (
        <>
          {webhooks.length === 0 && !loading && <StateRow empty={i18n.t('x.ops.no_webhooks')} />}
          {webhooks.length > 0 && (
            <div className="cw-tablewrap">
              <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {[i18n.t('x.ops.wh_date'), i18n.t('x.ops.wh_operator'), i18n.t('x.ops.wh_event'), i18n.t('x.ops.wh_status')].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: C.textMuted, fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map(wh => (
                    <tr key={wh.id} style={{ borderBottom: `1px solid ${C.border}20`, verticalAlign: 'top' }}>
                      <td style={{ padding: '9px 10px', color: C.textMuted, whiteSpace: 'nowrap' }}>{fmtDate(wh.createdAt)}</td>
                      <td style={{ padding: '9px 10px' }}><OperatorBadge operator={wh.operator} /></td>
                      <td style={{ padding: '9px 10px', color: C.textMuted, fontFamily: 'monospace', fontSize: 11 }}>{wh.eventType}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <WebhookPayloadCell wh={wh} />
                        {wh.processedAt && (
                          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{i18n.t('x.ops.wh_processed_on', { date: fmtDate(wh.processedAt) })}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {detailOp && (
        <TransactionDetailModal
          tx={{ ...detailOp, reference: detailOp.operatorRef ?? detailOp.id } as unknown as AdminTransaction}
          onClose={() => setDetailOp(null)}
          onRetried={() => { setDetailOp(null); refetch() }}
        />
      )}
    </div>
  )
}

// ── Page : Conformité ANIF ────────────────────────────────
// Score de risque (0-100) d'une transaction suspecte selon le type d'alerte.
function anifRiskScore(kind: 'highvalue' | 'unusual' | 'smurfing' | 'frequency', amountFcfa: number, thresholdFcfa: number): number {
  if (kind === 'smurfing') return 88
  if (kind === 'frequency') return 64
  if (kind === 'unusual') return 74 // juste sous le seuil = évasion probable
  // highvalue : croît avec le multiple du seuil
  const ratio = thresholdFcfa > 0 ? amountFcfa / thresholdFcfa : 1
  return Math.min(100, Math.round(45 + ratio * 18))
}
const riskBand = (s: number) => (s >= 80 ? { key: 'critique', label: 'x.anif.band_critical', color: C.red } : s >= 50 ? { key: 'eleve', label: 'x.anif.band_high', color: C.orange } : { key: 'moyen', label: 'x.anif.band_medium', color: C.yellow })

function ANIFPage() {
  const { data, loading, error, refetch } = useFetch(getAnifAlerts, [])
  const { data: anifStats } = useFetch(getAnifStats, [])
  const { data: settings, refetch: refetchSettings } = useFetch(getSettings, [])
  const { data: team } = useFetch(getAdminTeam, [])
  const toast = useToast()
  const [riskFilter, setRiskFilter] = useState('')
  const [period, setPeriod] = useState<'7d' | '30d'>('30d')
  const [caseStatusFilter, setCaseStatusFilter] = useState('')
  const [caseInput, setCaseInput] = useState<{ txId: string; reason: string } | null>(null)
  const [closing, setClosing] = useState<{ id: string; resolution: string; report: string } | null>(null)

  const thresholdFcfa = Number(settings?.anif_threshold_fcfa ?? 500000)
  const freqMax = Number(settings?.anif_frequency_max ?? 10)

  // Liste unifiée des transactions suspectes (montant élevé + sous-seuil) avec score.
  const periodCut = Date.now() - (period === '7d' ? 7 : 30) * 86400000
  const suspects = useMemo(() => {
    const hv = (data?.highValue ?? []).map((tx) => ({ tx, kind: 'highvalue' as const }))
    const un = (data?.unusualAmounts ?? []).map((tx) => ({ tx, kind: 'unusual' as const }))
    return [...hv, ...un]
      .filter((s) => new Date(s.tx.createdAt).getTime() >= periodCut)
      .map((s) => ({ ...s, score: anifRiskScore(s.kind, toFcfa(s.tx.amount), thresholdFcfa) }))
      .sort((a, b) => b.score - a.score)
  }, [data, period, thresholdFcfa, periodCut])
  const filteredSuspects = riskFilter ? suspects.filter((s) => riskBand(s.score).key === riskFilter) : suspects

  const frequent = data?.frequentSenders ?? []
  const smurfing = data?.smurfing ?? []
  const allCases = data?.cases ?? []
  // Dossiers : on présente les ouvertures, statut dérivé des clôtures.
  const closedRefs = new Set(allCases.filter((c) => c.action === 'ANIF_CASE_CLOSE').map((c) => c.resource).filter(Boolean))
  const openCases = allCases.filter((c) => c.action === 'ANIF_CASE_OPEN').map((c) => ({
    ...c,
    status: closedRefs.has(`AuditLog:${c.id}`) ? 'Clôturé' : 'Ouvert',
  }))
  const visibleCases = caseStatusFilter ? openCases.filter((c) => c.status === caseStatusFilter) : openCases

  // Donut : répartition par type d'alerte.
  const donut = [
    { name: i18n.t('x.anif.t_highvalue'), value: data?.highValue?.length ?? 0, color: C.red },
    { name: i18n.t('x.anif.t_smurfing'), value: smurfing.length, color: C.orange },
    { name: i18n.t('x.anif.t_frequency'), value: frequent.length, color: C.yellow },
    { name: i18n.t('x.anif.t_subthreshold'), value: data?.unusualAmounts?.length ?? 0, color: C.purple },
  ].filter((d) => d.value > 0)
  const donutTotal = donut.reduce((s, d) => s + d.value, 0)

  // BarChart : alertes (suspects) par jour sur 30j.
  const byDay = useMemo(() => {
    const m = new Map<string, number>()
    suspects.forEach((s) => { const k = s.tx.createdAt.slice(0, 10); m.set(k, (m.get(k) ?? 0) + 1) })
    const out = []
    const days = period === '7d' ? 7 : 30
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      out.push({ date: d.slice(5), alerts: m.get(d) ?? 0 })
    }
    return out
  }, [suspects, period])

  const handleOpenCase = async () => {
    if (!caseInput?.reason.trim()) { toast(i18n.t('x.anif.reason_required'), 'error'); return }
    try { await openAnifCase(caseInput.txId, caseInput.reason); toast(i18n.t('x.anif.case_opened'), 'success'); setCaseInput(null); refetch() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
  }
  const handleClose = async () => {
    if (!closing?.resolution.trim()) { toast(i18n.t('x.anif.resolution_required'), 'error'); return }
    try { await closeAnifCase(closing.id, closing.resolution, closing.report || undefined); toast(i18n.t('x.anif.case_closed'), 'success'); setClosing(null); refetch() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.anif.close_failed', { defaultValue: 'Échec de la clôture du dossier' }), 'error') }
  }
  const handleAssign = async (caseId: string, analystId: string) => {
    if (!analystId) return
    try { await assignAnifCase(caseId, analystId); toast(i18n.t('x.anif.case_assigned'), 'success'); refetch() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
  }
  const handleReport = (c: any) => {
    const meta = c.metadata ?? {}
    const ok = exportPdfReport(i18n.t('x.anif.report_title', { ref: meta.caseRef ?? c.id.slice(0, 8) }), [i18n.t('x.anif.field'), i18n.t('x.anif.value')], [
      [i18n.t('x.anif.r_case_ref'), meta.caseRef ?? '—'], [i18n.t('x.anif.r_tx'), meta.reference ?? '—'],
      [i18n.t('x.anif.r_amount'), meta.amount ? formatFCFA(Number(meta.amount)) : '—'], [i18n.t('x.anif.r_reason'), meta.reason ?? '—'],
      [i18n.t('x.anif.r_opened'), fmtDate(c.createdAt)], [i18n.t('x.anif.r_status'), c.status],
    ])
    toast(ok ? i18n.t('x.anif.report_generated') : i18n.t('x.anif.popup_blocked'), ok ? 'success' : 'error')
  }
  const toggleRule = async (key: string, on: boolean) => {
    try { await updateSettings({ [key]: on ? 'on' : 'off' }); refetchSettings(); toast(i18n.t('x.anif.rule_updated'), 'success') }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
  }
  const saveThreshold = async (val: string) => {
    try { await updateSettings({ anif_threshold_fcfa: val }); refetchSettings(); toast(i18n.t('x.anif.threshold_updated'), 'success') }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
  }

  // Export du rapport de conformité ANIF (PDF multi-sections : stats, alertes,
  // dossiers, règles). Construit à partir des données déjà chargées dans la page.
  const handleExportAnifReport = () => {
    const periodLabel = period === '7d' ? i18n.t('x.anif.period_7d', { defaultValue: '7 derniers jours' }) : i18n.t('x.anif.period_30d', { defaultValue: '30 derniers jours' })
    const stats = anifStats ? [
      { label: i18n.t('x.anif.kpi_active'), value: String(anifStats.activeAlerts) },
      { label: i18n.t('x.anif.kpi_open'), value: String(anifStats.openCases) },
      { label: i18n.t('x.anif.kpi_over'), value: String(anifStats.overThreshold30d) },
      { label: i18n.t('x.anif.kpi_resolution'), value: anifStats.resolutionRate == null ? '—' : anifStats.resolutionRate + ' %' },
    ] : []
    const typeLabel = (kind: string) => kind === 'highvalue' ? i18n.t('x.anif.t_highvalue') : i18n.t('x.anif.t_subthreshold')
    const alertRows = suspects.map((s) => [
      s.tx.id.slice(0, 8),
      s.tx.sender?.fullName ?? s.tx.sender?.phone ?? '—',
      formatFCFA(toFcfa(s.tx.amount)),
      typeLabel(s.kind),
      `${s.score} (${i18n.t(riskBand(s.score).label)})`,
      fmtDate(s.tx.createdAt),
    ])
    const caseRows = openCases.map((c) => {
      const meta = c.metadata ?? {}
      return [
        meta.caseRef ?? c.id.slice(0, 8),
        meta.assignedToName ?? meta.assignedTo ?? '—',
        c.status,
        fmtDate(c.createdAt),
      ]
    })
    const ruleRows = RULES.map((r) => [
      r.label,
      settings?.[r.key] === 'off' ? i18n.t('x.anif.rule_off', { defaultValue: 'Désactivée' }) : i18n.t('x.anif.rule_on', { defaultValue: 'Active' }),
      r.desc,
    ])
    const ok = generateMultiSectionReport({
      title: i18n.t('x.anif.pdf_title', { defaultValue: 'Rapport de Conformité ANIF' }),
      subtitle: i18n.t('x.anif.pdf_subtitle', { period: periodLabel, defaultValue: `Période : ${periodLabel}` }),
      stats,
      sections: [
        { title: i18n.t('x.anif.pdf_sec_alerts', { defaultValue: 'Alertes suspectes' }), columns: [i18n.t('x.anif.c_ref', { defaultValue: 'Référence' }), i18n.t('x.anif.c_user', { defaultValue: 'Utilisateur' }), i18n.t('x.anif.c_amount', { defaultValue: 'Montant' }), i18n.t('x.anif.c_type', { defaultValue: 'Type' }), i18n.t('x.anif.c_risk', { defaultValue: 'Risque' }), i18n.t('x.anif.c_date', { defaultValue: 'Date' })], rows: alertRows, empty: i18n.t('x.anif.pdf_no_alerts', { defaultValue: 'Aucune alerte sur la période.' }) },
        { title: i18n.t('x.anif.pdf_sec_cases', { defaultValue: 'Dossiers d\'enquête' }), columns: [i18n.t('x.anif.c_ref', { defaultValue: 'Référence' }), i18n.t('x.anif.c_assignee', { defaultValue: 'Assigné' }), i18n.t('x.anif.c_status', { defaultValue: 'Statut' }), i18n.t('x.anif.c_opened', { defaultValue: 'Ouvert le' })], rows: caseRows, empty: i18n.t('x.anif.pdf_no_cases', { defaultValue: 'Aucun dossier ouvert.' }) },
        { title: i18n.t('x.anif.pdf_sec_rules', { defaultValue: 'Règles de détection actives' }), columns: [i18n.t('x.anif.c_rule', { defaultValue: 'Règle' }), i18n.t('x.anif.c_state', { defaultValue: 'Statut' }), i18n.t('x.anif.c_threshold', { defaultValue: 'Seuil' })], rows: ruleRows },
      ],
      filename: `rapport-anif-${new Date().toISOString().slice(0, 10)}.pdf`,
    })
    toast(ok ? i18n.t('x.anif.report_generated') : i18n.t('x.anif.popup_blocked'), ok ? 'success' : 'error')
  }

  const statCards = anifStats ? [
    { label: i18n.t('x.anif.kpi_active'), value: anifStats.activeAlerts.toLocaleString('fr-FR'), icon: Siren, color: C.red },
    { label: i18n.t('x.anif.kpi_open'), value: anifStats.openCases.toLocaleString('fr-FR'), icon: FileText, color: C.orange },
    { label: i18n.t('x.anif.kpi_over'), value: anifStats.overThreshold30d.toLocaleString('fr-FR'), icon: TrendingUp, color: C.purple },
    { label: i18n.t('x.anif.kpi_resolution'), value: anifStats.resolutionRate == null ? '—' : anifStats.resolutionRate + ' %', icon: CheckCircle2, color: C.green },
  ] : []

  const RULES = [
    { key: 'anif_rule_highvalue', label: i18n.t('x.anif.rule_highvalue'), desc: i18n.t('x.anif.rule_highvalue_desc', { value: groupFr(thresholdFcfa) }), editable: 'threshold' as const },
    { key: 'anif_rule_smurfing', label: i18n.t('x.anif.rule_smurfing'), desc: i18n.t('x.anif.rule_smurfing_desc') },
    { key: 'anif_rule_frequency', label: i18n.t('x.anif.rule_frequency'), desc: i18n.t('x.anif.rule_frequency_desc', { max: freqMax }), editable: 'freq' as const },
  ]
  const inputStyle: CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13 }

  return (
    <div className="cw-page" style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>
            <ShieldAlert size={22} color={C.red} /> {i18n.t('x.anif.title')}
          </h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.anif.subtitle')}</p>
        </div>
        <button onClick={handleExportAnifReport}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.green, color: '#04130E', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <FileText size={16} /> {i18n.t('x.anif.btn_export_report', { defaultValue: 'Exporter rapport ANIF' })}
        </button>
      </div>

      <StateRow loading={loading} error={error} />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statCards.map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{s.value}</div>
          </div>
        )})}
      </div>

      {/* Graphes : alertes/jour + répartition par type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('x.anif.alerts_per_day')}</h2>
            <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3, gap: 2 }}>
              {(['7d', '30d'] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: period === p ? C.green : 'transparent', color: period === p ? '#fff' : C.textSoft }}>{p === '7d' ? i18n.t('dashboard.period_7d') : i18n.t('dashboard.period_30d')}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byDay} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={false} width={26} allowDecimals={false} />
              <Tooltip cursor={{ fill: C.redLight }} content={<ChartTooltip />} />
              <Bar dataKey="alerts" name={i18n.t('x.anif.alerts')} fill={C.red} radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{i18n.t('x.anif.by_type')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut.length ? donut : [{ name: '—', value: 1, color: C.border }]} cx="50%" cy="50%" innerRadius={46} outerRadius={68} dataKey="value" paddingAngle={donut.length > 1 ? 3 : 0} stroke="none">
                    {(donut.length ? donut : [{ color: C.border }]).map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{donutTotal}</span>
                <span style={{ fontSize: 10, color: C.textMuted }}>{i18n.t('x.anif.alerts')}</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {donut.length === 0 && <span style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('x.anif.no_alert')}</span>}
              {donut.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, color: C.textSoft }}>{d.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tableau de bord alertes (transactions suspectes scorées) */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', flexWrap: 'wrap' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('x.anif.suspects', { count: filteredSuspects.length })}</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setRiskFilter('')} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: riskFilter === '' ? 700 : 500, background: riskFilter === '' ? C.green : C.surface, border: `1px solid ${riskFilter === '' ? C.green : C.border}`, color: riskFilter === '' ? '#fff' : C.textSoft }}>{i18n.t('x.anif.all')}</button>
            {[{ k: 'critique', l: 'x.anif.band_critical', c: C.red }, { k: 'eleve', l: 'x.anif.band_high', c: C.orange }, { k: 'moyen', l: 'x.anif.band_medium', c: C.yellow }].map((b) => (
              <button key={b.k} onClick={() => setRiskFilter(riskFilter === b.k ? '' : b.k)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: riskFilter === b.k ? 700 : 500, background: riskFilter === b.k ? b.c : b.c + '18', border: `1px solid ${b.c}40`, color: riskFilter === b.k ? '#fff' : b.c }}>{i18n.t(b.l)}</button>
            ))}
          </div>
        </div>
        <div className="cw-tablewrap">
          <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>{[i18n.t('x.anif.col_score'), i18n.t('x.anif.col_sender'), i18n.t('x.anif.col_receiver'), i18n.t('x.anif.col_amount'), i18n.t('x.anif.col_type'), i18n.t('x.anif.col_date'), i18n.t('x.anif.col_action')].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filteredSuspects.map(({ tx, score, kind }) => { const band = riskBand(score); return (
                <tr key={tx.id + kind} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ minWidth: 34, textAlign: 'center', fontSize: 12, fontWeight: 800, color: band.color, background: band.color + '20', borderRadius: 6, padding: '2px 6px' }}>{score}</span>
                      <span style={{ fontSize: 11, color: band.color, fontWeight: 600 }}>{i18n.t(band.label)}</span>
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px' }}><UserCell party={tx.sender} /></td>
                  <td style={{ padding: '11px 14px' }}><UserCell party={tx.receiver} /></td>
                  <td style={{ padding: '11px 14px', fontWeight: 800, color: C.red, whiteSpace: 'nowrap' }}>{formatFCFA(tx.amount)}</td>
                  <td style={{ padding: '11px 14px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                  <td style={{ padding: '11px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(tx.createdAt)}>{relativeTime(tx.createdAt)}</td>
                  <td style={{ padding: '11px 14px' }} onClick={(e) => e.stopPropagation()}>
                    {!isReadOnly() && (caseInput?.txId === tx.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input autoFocus value={caseInput.reason} onChange={(e) => setCaseInput({ txId: tx.id, reason: e.target.value })} placeholder={i18n.t('x.anif.reason_ph')} style={{ ...inputStyle, padding: '5px 8px', fontSize: 12, width: 140 }} />
                        <button onClick={handleOpenCase} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>OK</button>
                        <button onClick={() => setCaseInput(null)} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setCaseInput({ txId: tx.id, reason: '' })} style={{ fontSize: 11, fontWeight: 600, background: C.red + '15', color: C.red, border: `1px solid ${C.red}40`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{i18n.t('x.anif.open_case')}</button>
                    ))}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        {filteredSuspects.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 30, color: C.textMuted, fontSize: 13 }}>{i18n.t('x.anif.no_suspects')}</div>}
      </div>

      {/* Règles de détection configurables */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
        <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{i18n.t('x.anif.rules')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {RULES.map((r) => { const on = (settings?.[r.key] ?? 'on') === 'on'; return (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                <div style={{ color: C.textMuted, fontSize: 12 }}>{r.desc}</div>
              </div>
              {r.editable === 'threshold' && (
                <input type="number" defaultValue={thresholdFcfa} onBlur={(e) => { if (Number(e.target.value) !== thresholdFcfa) saveThreshold(String(Math.max(0, Number(e.target.value) || 0))) }} style={{ ...inputStyle, width: 110, textAlign: 'right' }} disabled={isReadOnly()} />
              )}
              {r.editable === 'freq' && (
                <input type="number" defaultValue={freqMax} onBlur={(e) => { if (Number(e.target.value) !== freqMax) updateSettings({ anif_frequency_max: String(Math.max(1, Number(e.target.value) || 10)) }).then(() => refetchSettings()) }} style={{ ...inputStyle, width: 80, textAlign: 'right' }} disabled={isReadOnly()} />
              )}
              <button disabled={isReadOnly()} onClick={() => toggleRule(r.key, !on)} aria-label={i18n.t('x.anif.toggle_aria')} style={{ position: 'relative', width: 44, height: 24, borderRadius: 12, border: 'none', cursor: isReadOnly() ? 'default' : 'pointer', background: on ? C.green : C.border, transition: 'background .2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left .2s' }} />
              </button>
            </div>
          )})}
        </div>
      </div>

      {/* Dossiers d'enquête */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <h2 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.t('x.anif.cases', { count: visibleCases.length })}</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {['', 'Ouvert', 'Clôturé'].map((st) => (
              <button key={st || 'all'} onClick={() => setCaseStatusFilter(st)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: caseStatusFilter === st ? 700 : 500, background: caseStatusFilter === st ? C.green : C.surface, border: `1px solid ${caseStatusFilter === st ? C.green : C.border}`, color: caseStatusFilter === st ? '#fff' : C.textSoft }}>{st ? (st === 'Ouvert' ? i18n.t('x.anif.st_open') : i18n.t('x.anif.st_closed')) : i18n.t('x.anif.all_cases')}</button>
            ))}
          </div>
        </div>
        {visibleCases.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.anif.no_cases')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', paddingLeft: 22 }}>
            <div style={{ position: 'absolute', left: 6, top: 8, bottom: 8, width: 2, background: C.border }} />
            {visibleCases.map((c: any) => {
              const meta = c.metadata ?? {}
              const isClosed = c.status === 'Clôturé'
              return (
              <div key={c.id} style={{ position: 'relative', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px' }}>
                <span style={{ position: 'absolute', left: -22, top: 16, width: 13, height: 13, borderRadius: 7, background: isClosed ? C.green : C.red, border: `3px solid ${C.bg}` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{meta.caseRef ?? i18n.t('x.anif.case_default')}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isClosed ? C.green : C.red, background: (isClosed ? C.green : C.red) + '20', borderRadius: 10, padding: '2px 8px' }}>{c.status === 'Clôturé' ? i18n.t('x.anif.st_closed') : i18n.t('x.anif.st_open')}</span>
                    </div>
                    <div style={{ color: C.textMuted, fontSize: 12, marginTop: 3 }}>{meta.reason ?? c.details ?? '—'}{meta.amount ? ` · ${formatFCFA(Number(meta.amount))}` : ''}</div>
                    <div style={{ color: C.textSoft, fontSize: 11, marginTop: 3 }}>{i18n.t('x.anif.opened_rel', { rel: relativeTime(c.createdAt) })}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    {!isReadOnly() && !isClosed && (
                      <select defaultValue="" onChange={(e) => handleAssign(c.id, e.target.value)} style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}>
                        <option value="">{i18n.t('x.anif.assign_to')}</option>
                        {(team ?? []).map((m) => <option key={m.id} value={m.id}>{m.fullName ?? m.email}</option>)}
                      </select>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleReport(c)} style={{ fontSize: 11, color: C.blue, background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.anif.report_pdf')}</button>
                      {!isReadOnly() && !isClosed && (closing?.id === c.id ? null : (
                        <button onClick={() => setClosing({ id: c.id, resolution: '', report: '' })} style={{ fontSize: 11, background: C.green + '15', color: C.green, border: `1px solid ${C.green}40`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.anif.close_case')}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {closing?.id === c.id && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input autoFocus value={closing.resolution} onChange={(e) => setClosing({ ...closing, resolution: e.target.value })} placeholder={i18n.t('x.anif.resolution_ph')} style={{ ...inputStyle, fontSize: 12 }} />
                    <textarea value={closing.report} onChange={(e) => setClosing({ ...closing, report: e.target.value })} placeholder={i18n.t('x.anif.report_ph')} rows={2} style={{ ...inputStyle, fontSize: 12, resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleClose} style={{ fontSize: 12, background: C.green, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 }}>{i18n.t('x.anif.confirm_close')}</button>
                      <button onClick={() => setClosing(null)} style={{ fontSize: 12, color: C.textMuted, background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>{i18n.t('common.cancel')}</button>
                    </div>
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}

// Couleur sémantique d'une action d'audit (BLOCKED=rouge, APPROVED=vert, …).
// Catégorie sémantique d'une action d'audit → couleur (Sécurité/KYC/Finance/Admin).
const AUDIT_CYAN = C.cyan
const auditCategory = (action: string): { key: string; label: string; color: string } => {
  const a = (action || '').toUpperCase()
  if (/KYC/.test(a)) return { key: 'kyc', label: i18n.t('audit_cat.kyc'), color: C.purple }
  if (/TRANSACTION|WITHDRAWAL|OPERATION|RECHARGE|DISPUTE|ANIF/.test(a)) return { key: 'finance', label: i18n.t('audit_cat.finance'), color: AUDIT_CYAN }
  if (/LOGIN|BLOCK|LOCK|PIN_RESET|STATUS|SUSPEND/.test(a)) return { key: 'security', label: i18n.t('audit_cat.security'), color: C.red }
  if (/ADMIN|ROLE|PASSWORD|SETTINGS|CREATE|DELETE/.test(a)) return { key: 'admin', label: i18n.t('audit_cat.admin'), color: C.blue }
  return { key: 'other', label: i18n.t('audit_cat.other'), color: C.textMuted }
}
const auditActionColor = (action: string): string => auditCategory(action).color
// Libellé lisible d'une action d'audit (clé brute → label i18n). Repli : la clé
// en minuscules, underscores remplacés par des espaces (ex. « DISPUTE_OPEN » → « dispute open »).
const auditActionLabel = (action: string): string => {
  const key = (action || '').toUpperCase()
  return i18n.t('audit_action.' + key, { defaultValue: key.toLowerCase().replace(/_/g, ' ') })
}
const AUDIT_CATEGORIES = [
  { key: 'security', label: 'audit_cat.security', color: C.red },
  { key: 'kyc', label: 'audit_cat.kyc', color: C.purple },
  { key: 'finance', label: 'audit_cat.finance', color: AUDIT_CYAN },
  { key: 'admin', label: 'audit_cat.admin', color: C.blue },
]

function AuditPage() {
  const today = new Date().toISOString().slice(0, 10)
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
  const [preset, setPreset] = useState<'today' | '7d' | '30d' | 'custom'>('7d')
  const [actorSearch, setActorSearch] = useState('')
  const [resource, setResource] = useState('')
  const [customFrom, setCustomFrom] = useState(today)
  const [customTo, setCustomTo] = useState(today)
  const [category, setCategory] = useState('') // filtre catégorie (client)
  const debResource = useDebounced(resource.trim(), 350)
  const debActor = useDebounced(actorSearch.trim().toLowerCase(), 300)

  const range = useMemo(() => {
    if (preset === 'today') return { from: today, to: today }
    if (preset === '7d') return { from: ago(7), to: today }
    if (preset === '30d') return { from: ago(30), to: today }
    return { from: customFrom, to: customTo }
  }, [preset, customFrom, customTo, today])

  const { data, loading, error } = useFetch(
    () => getAudit({ resource: debResource || undefined, from: range.from, to: range.to, take: 200 }),
    [debResource, range.from, range.to],
  )
  const { data: stats } = useFetch(() => getAuditStats(), [])
  const all = data ?? []
  // Filtres client : catégorie + recherche acteur par email.
  const entries = all.filter((e) => {
    if (category && auditCategory(e.action).key !== category) return false
    if (debActor) {
      const hay = `${e.user?.email ?? ''} ${e.user?.fullName ?? ''}`.toLowerCase()
      if (!hay.includes(debActor)) return false
    }
    return true
  })

  const inputStyle: CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13 }
  const statCards = stats ? [
    { label: i18n.t('x.audit.kpi_actions'), value: stats.total30d.toLocaleString('fr-FR'), icon: FileText, color: C.blue },
    { label: i18n.t('x.audit.kpi_critical'), value: stats.criticalActions.toLocaleString('fr-FR'), icon: ShieldAlert, color: C.red },
    { label: i18n.t('x.audit.kpi_actors'), value: stats.uniqueActors.toLocaleString('fr-FR'), icon: UsersIcon, color: C.green },
    { label: i18n.t('x.audit.kpi_last'), value: stats.lastAction ? relativeTime(stats.lastAction.at) : '—', sub: stats.lastAction?.action ? auditActionLabel(stats.lastAction.action) : undefined, icon: Clock, color: C.purple },
  ] : []

  // Filtres appliqués (affichés en haut du rapport PDF).
  const presetLabel = preset === 'today' ? i18n.t('x.audit.preset_today') : preset === '7d' ? i18n.t('x.audit.preset_7d') : preset === '30d' ? i18n.t('x.audit.preset_30d') : `${range.from} → ${range.to}`
  const handleExportAuditPdf = () => {
    const filters: { label: string; value: string }[] = [{ label: i18n.t('x.audit.pdf_period'), value: presetLabel }]
    if (category) filters.push({ label: i18n.t('x.audit.pdf_category'), value: auditCategory(category).label })
    if (debActor) filters.push({ label: i18n.t('x.audit.pdf_actor'), value: actorSearch.trim() })
    if (debResource) filters.push({ label: i18n.t('x.audit.pdf_resource'), value: resource.trim() })
    generatePdfReport({
      title: i18n.t('x.audit.pdf_title'),
      subtitle: i18n.t('x.audit.pdf_count', { count: entries.length }),
      filters,
      orientation: 'landscape',
      columns: [i18n.t('x.audit.csv_actor'), i18n.t('x.audit.csv_action'), i18n.t('x.audit.csv_cat'), i18n.t('x.audit.csv_resource'), i18n.t('x.audit.csv_ip'), i18n.t('x.audit.csv_date')],
      rows: entries.map((e) => [
        e.user?.email ?? e.user?.fullName ?? i18n.t('x.audit.system'),
        auditActionLabel(e.action),
        auditCategory(e.action).label,
        e.resource ?? '—',
        e.ipAddress ?? '—',
        fmtDate(e.createdAt),
      ]),
      filename: `audit-camwallet-${new Date().toISOString().slice(0, 10)}.pdf`,
    })
  }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('x.audit.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.audit.subtitle', { count: entries.length })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cw-btn" disabled={!entries.length}
            onClick={() => downloadCsv('audit-camwallet.csv', [i18n.t('x.audit.csv_date'), i18n.t('x.audit.csv_actor'), i18n.t('x.audit.csv_role'), i18n.t('x.audit.csv_action'), i18n.t('x.audit.csv_cat'), i18n.t('x.audit.csv_resource'), i18n.t('x.audit.csv_ip'), i18n.t('x.audit.csv_details')],
              entries.map((e) => [fmtDate(e.createdAt), e.user?.email ?? e.user?.fullName ?? i18n.t('x.audit.system'), e.user?.adminRole ?? e.user?.role ?? '', e.action, auditCategory(e.action).label, e.resource ?? '', e.ipAddress ?? '', e.metadata ? JSON.stringify(e.metadata) : '']))}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: `1px solid ${C.green}40`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: C.greenLight, color: C.green }}>
            <FileText size={14} /> {i18n.t('common.export_csv')}
          </button>
          <button className="cw-btn" disabled={!entries.length} onClick={handleExportAuditPdf}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: `1px solid ${C.blue}40`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: entries.length ? 'pointer' : 'not-allowed', background: C.blueLight, color: C.blue }}>
            <FileText size={14} /> {i18n.t('common.export_pdf')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statCards.map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{s.value}</div>
            {(s as any).sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontFamily: 'monospace' }}>{(s as any).sub}</div>}
          </div>
        )})}
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Catégories colorées */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setCategory('')} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: category === '' ? 700 : 500, background: category === '' ? C.green : C.card, border: `1px solid ${category === '' ? C.green : C.border}`, color: category === '' ? '#fff' : C.textSoft }}>{i18n.t('x.audit.all')}</button>
          {AUDIT_CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setCategory(category === c.key ? '' : c.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: category === c.key ? 700 : 500, background: category === c.key ? c.color : c.color + '18', border: `1px solid ${category === c.key ? c.color : c.color + '40'}`, color: category === c.key ? '#fff' : c.color }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: category === c.key ? '#fff' : c.color }} />{i18n.t(c.label)}
            </button>
          ))}
        </div>
        <input value={actorSearch} onChange={(e) => setActorSearch(e.target.value)} placeholder={i18n.t('x.audit.actor_ph')} style={{ ...inputStyle, minWidth: 160 }} />
        <input value={resource} onChange={(e) => setResource(e.target.value)} placeholder={i18n.t('x.audit.resource_ph')} style={{ ...inputStyle, minWidth: 160 }} />
        <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3, gap: 2 }}>
          {([['today', i18n.t('x.audit.today')], ['7d', i18n.t('x.audit.p7d')], ['30d', i18n.t('x.audit.p30d')]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', border: 'none', background: preset === k ? C.green : 'transparent', color: preset === k ? '#fff' : C.textSoft }}>{l}</button>
          ))}
          <button onClick={() => setPreset('custom')} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', border: 'none', background: preset === 'custom' ? C.green : 'transparent', color: preset === 'custom' ? '#fff' : C.textSoft }}>{i18n.t('x.audit.custom')}</button>
        </div>
        {preset === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
          </>
        )}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
          <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>
                {[i18n.t('x.audit.col_actor'), i18n.t('x.audit.col_action'), i18n.t('x.audit.col_resource'), i18n.t('x.audit.col_ip'), i18n.t('x.audit.col_date')].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const cat = auditCategory(e.action)
                const actorName = e.user?.fullName ?? e.user?.email ?? i18n.t('x.audit.system')
                return (
                <tr key={e.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: (e.user ? C.green : C.textMuted) + '22', color: e.user ? C.green : C.textMuted }}>{e.user ? initials(actorName) : 'SYS'}</span>
                      <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
                        <span style={{ color: C.text, fontSize: 12.5, fontWeight: 600 }}>{e.user?.email ?? i18n.t('x.audit.system')}</span>
                        {e.user?.adminRole && <span style={{ color: C.textMuted, fontSize: 11 }}>{i18n.t('roles.' + e.user.adminRole)}</span>}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, background: cat.color + '20', color: cat.color, padding: '3px 9px', borderRadius: 6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 3, background: cat.color }} />{auditActionLabel(e.action)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.textSoft, fontSize: 12, fontFamily: 'monospace' }}>{e.resource ?? '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 11 }}>
                    <div>{e.ipAddress ?? '—'}</div>
                    {e.userAgent && <div title={e.userAgent} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.userAgent}</div>}
                  </td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(e.createdAt)}>{relativeTime(e.createdAt)}</td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        {(loading || error || entries.length === 0) && (
          <StateRow loading={loading} error={error} empty={!loading && !error ? i18n.t('x.audit.no_entries') : undefined} />
        )}
      </div>
    </div>
  )
}

function SettingsPage() {
  const { data, loading, error } = useFetch(getSettings, [])
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const showToast = useContext(ToastContext)
  const toast = useToast()

  // 2FA
  const { data: twoFAStatus, refetch: refetch2FA } = useFetch(get2FAStatus, [])
  const [twoFASetup, setTwoFASetup] = useState<{ otpauthUrl: string; secret: string } | null>(null)
  const [twoFACode, setTwoFACode] = useState('')
  const [twoFAActing, setTwoFAActing] = useState(false)

  const handleSetup2FA = async () => {
    setTwoFAActing(true)
    try {
      const result = await setup2FA()
      setTwoFASetup(result)
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.set.twofa_error'), 'error')
    } finally {
      setTwoFAActing(false)
    }
  }

  const handleVerify2FA = async () => {
    setTwoFAActing(true)
    try {
      await verify2FA(twoFACode)
      setTwoFASetup(null)
      setTwoFACode('')
      refetch2FA()
      toast(i18n.t('x.set.twofa_enabled'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.set.twofa_invalid'), 'error')
    } finally {
      setTwoFAActing(false)
    }
  }

  const handleDisable2FA = async () => {
    setTwoFAActing(true)
    try {
      await disable2FA(twoFACode)
      setTwoFACode('')
      refetch2FA()
      toast(i18n.t('x.set.twofa_disabled'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.set.twofa_invalid'), 'error')
    } finally {
      setTwoFAActing(false)
    }
  }

  // Intégrations (test de connexion) + impact ANIF + historique modifs.
  const { data: health, refetch: refetchHealth, loading: healthLoading } = useFetch(getHealthIntegrations, [])
  const { data: anifImpact } = useFetch(getAnifStats, [])
  const { data: history, refetch: refetchHistory } = useFetch(() => getAudit({ action: 'SETTINGS_UPDATE', take: 10 }), [])
  const { data: emailAlerts } = useFetch(() => getEmailAlertHistory(), [])

  // Initialise le formulaire dès que les données arrivent
  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const num = (k: string, def = 0) => Number(form[k] ?? def)
  const setVal = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: String(v) }))
  const dirtyKeys = data ? Object.keys(form).filter((k) => form[k] !== data[k]) : []
  const dirty = dirtyKeys.length > 0

  const handleSave = async () => {
    try {
      await updateSettings(form)
      setSaved(true)
      showToast(i18n.t('x.set.saved'), 'success')
      refetchHistory()
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      showToast(e instanceof Error ? e.message : i18n.t('x.set.save_error'), 'error')
    }
  }

  // Enregistrement dédié des paramètres de fidélité (validation d'ordre + confirmation).
  const saveLoyalty = async () => {
    const silver = num('loyalty_silver_threshold', 100)
    const gold = num('loyalty_gold_threshold', 500)
    const platinum = num('loyalty_platinum_threshold', 1000)
    const pts = ['loyalty_points_per_1000_fcfa', 'loyalty_points_recharge', 'loyalty_points_kyc'].map((k) => num(k))
    if (!(silver > 0 && gold > silver && platinum > gold) || ![silver, gold, platinum].every(Number.isInteger)) {
      showToast(i18n.t('x.set.loyalty_invalid', { defaultValue: 'Seuils invalides : Argent < Or < Platine (entiers positifs).' }), 'error'); return
    }
    if (!pts.every((n) => Number.isInteger(n) && n >= 0)) {
      showToast(i18n.t('x.set.loyalty_points_invalid', { defaultValue: 'Les règles de points doivent être des entiers ≥ 0.' }), 'error'); return
    }
    if (!window.confirm(i18n.t('x.set.loyalty_confirm', { defaultValue: 'Enregistrer les paramètres du programme de fidélité ?' }))) return
    try {
      // Valeurs par défaut si la clé n'a jamais été enregistrée (évite d'envoyer '').
      const defs: Record<string, number> = {
        loyalty_silver_threshold: 100, loyalty_gold_threshold: 500, loyalty_platinum_threshold: 1000,
        loyalty_points_per_1000_fcfa: 1, loyalty_points_recharge: 5, loyalty_points_kyc: 10,
      }
      await updateSettings(Object.fromEntries(Object.keys(defs).map((k) => [k, String(num(k, defs[k]))])))
      showToast(i18n.t('x.set.saved'), 'success')
      refetchHistory()
    } catch (e) {
      showToast(e instanceof Error ? e.message : i18n.t('x.set.save_error'), 'error')
    }
  }

  const inputStyle: CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 12px', fontSize: 14, width: '100%' }
  const card: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 20 }
  const h2: CSSProperties = { color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 18 }

  // Ligne slider : libellé + valeur + range.
  const SliderRow = ({ k, label, min, max, step, fmt }: { k: string; label: string; min: number; max: number; step: number; fmt?: (n: number) => string }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>{label}</label>
        <span style={{ fontSize: 13, color: C.green, fontWeight: 800 }}>{fmt ? fmt(num(k)) : num(k)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={num(k)} disabled={isReadOnly()} onChange={(e) => setVal(k, e.target.value)} style={{ width: '100%', accentColor: C.green, cursor: isReadOnly() ? 'default' : 'pointer' }} />
    </div>
  )
  // Ligne toggle on/off.
  const ToggleRow = ({ k, label, desc }: { k: string; label: string; desc: string }) => { const on = (form[k] ?? 'off') === 'on'; return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ color: C.textMuted, fontSize: 12 }}>{desc}</div>
      </div>
      <button disabled={isReadOnly()} onClick={() => setVal(k, on ? 'off' : 'on')} aria-label={label} style={{ position: 'relative', width: 44, height: 24, borderRadius: 12, border: 'none', cursor: isReadOnly() ? 'default' : 'pointer', background: on ? C.green : C.border, flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left .15s' }} />
      </button>
    </div>
  )}

  return (
    <div className="cw-page" style={{ padding: 24, paddingBottom: dirty ? 90 : 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('x.set.title')}</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.set.subtitle')}</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {!loading && (
        <>
          {/* Limites & Frais — sliders */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.limits')}</h2>
            {SliderRow({ k: "daily_limit_fcfa", label: i18n.t('x.set.daily_limit'), min: 0, max: 2_000_000, step: 50_000, fmt: fmt })}
            {SliderRow({ k: "monthly_limit_fcfa", label: i18n.t('x.set.monthly_limit'), min: 0, max: 20_000_000, step: 500_000, fmt: fmt })}
            {SliderRow({ k: 'p2p_fee_rate', label: i18n.t('x.set.p2p_fee'), min: 0, max: 5, step: 0.1, fmt: (n: number) => n + ' %' })}
          </div>

          {/* Programme de fidélité — seuils de niveaux + règles de gain */}
          <div style={card}>
            <h2 style={{ ...h2, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Award size={16} color={C.yellow} /> {i18n.t('x.set.loyalty_title', { defaultValue: 'Programme de fidélité' })}
            </h2>

            <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
              {i18n.t('x.set.loyalty_thresholds', { defaultValue: 'Seuils des niveaux (points)' })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
              {[
                { k: '', label: '🥉 ' + i18n.t('x.set.loyalty_bronze', { defaultValue: 'Bronze' }), def: 0, fixed: true },
                { k: 'loyalty_silver_threshold', label: '🥈 ' + i18n.t('x.set.loyalty_silver', { defaultValue: 'Argent' }), def: 100 },
                { k: 'loyalty_gold_threshold', label: '🥇 ' + i18n.t('x.set.loyalty_gold', { defaultValue: 'Or' }), def: 500 },
                { k: 'loyalty_platinum_threshold', label: '💎 ' + i18n.t('x.set.loyalty_platinum', { defaultValue: 'Platine' }), def: 1000 },
              ].map((lv) => (
                <div key={lv.label}>
                  <label style={{ display: 'block', fontSize: 12, color: C.textMuted, fontWeight: 600, marginBottom: 6 }}>{lv.label}</label>
                  {lv.fixed ? (
                    <input type="number" value={0} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
                  ) : (
                    <input type="number" min={1} value={num(lv.k, lv.def)} disabled={isReadOnly()} onChange={(e) => setVal(lv.k, e.target.value)} style={inputStyle} />
                  )}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
              {i18n.t('x.set.loyalty_rules', { defaultValue: 'Règles de gain' })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
              {[
                { k: 'loyalty_points_per_1000_fcfa', label: i18n.t('x.set.loyalty_per_1000', { defaultValue: 'Points / 1000 FCFA envoyés' }), def: 1 },
                { k: 'loyalty_points_recharge', label: i18n.t('x.set.loyalty_recharge', { defaultValue: 'Points par recharge' }), def: 5 },
                { k: 'loyalty_points_kyc', label: i18n.t('x.set.loyalty_kyc', { defaultValue: 'Points KYC approuvé' }), def: 10 },
              ].map((r) => (
                <div key={r.k}>
                  <label style={{ display: 'block', fontSize: 12, color: C.textMuted, fontWeight: 600, marginBottom: 6 }}>{r.label}</label>
                  <input type="number" min={0} value={num(r.k, r.def)} disabled={isReadOnly()} onChange={(e) => setVal(r.k, e.target.value)} style={inputStyle} />
                </div>
              ))}
            </div>

            <button onClick={saveLoyalty} disabled={isReadOnly()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.green, color: '#04130E', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: isReadOnly() ? 'not-allowed' : 'pointer', opacity: isReadOnly() ? 0.5 : 1 }}>
              <CheckCircle2 size={16} /> {i18n.t('x.set.loyalty_save', { defaultValue: 'Enregistrer la fidélité' })}
            </button>
          </div>

          {/* Seuils ANIF — avec aperçu d'impact */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.anif_thresholds')}</h2>
            {SliderRow({ k: "anif_threshold_fcfa", label: i18n.t('x.set.anif_threshold'), min: 100_000, max: 5_000_000, step: 50_000, fmt: fmt })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <Info size={16} color={C.blue} />
              <span style={{ fontSize: 12, color: C.textSoft }}>
                {i18n.t('x.set.anif_impact_pre')}<strong style={{ color: C.text }}>{anifImpact?.overThreshold30d ?? '—'}</strong>{i18n.t('x.set.anif_impact_post')}
              </span>
            </div>
          </div>

          {/* Sécurité */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.security')}</h2>
            {SliderRow({ k: 'session_duration_minutes', label: i18n.t('x.set.session'), min: 5, max: 120, step: 5, fmt: (n: number) => n + ' min' })}
            {ToggleRow({ k: "require_2fa", label: i18n.t('x.set.require_2fa'), desc: i18n.t('x.set.require_2fa_desc') })}
          </div>

          {/* Vérification KYC (IA) */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.kyc_section')}</h2>
            {ToggleRow({ k: "kyc_auto_approve", label: i18n.t('x.set.kyc_auto_approve'), desc: i18n.t('x.set.kyc_auto_approve_desc', { threshold: form['kyc_auto_approve_threshold'] ?? '95' }) })}
            {SliderRow({ k: "kyc_auto_approve_threshold", label: i18n.t('x.set.kyc_threshold'), min: 70, max: 100, step: 1, fmt: (n: number) => n + ' / 100' })}
          </div>

          {/* Notifications */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.notifications')}</h2>
            {ToggleRow({ k: "notify_kyc_submitted", label: i18n.t('x.set.notify_kyc'), desc: i18n.t('x.set.notify_kyc_desc') })}
            {ToggleRow({ k: "notify_high_value", label: i18n.t('x.set.notify_high'), desc: i18n.t('x.set.notify_high_desc') })}
            {ToggleRow({ k: "notify_failed_payment", label: i18n.t('x.set.notify_failed'), desc: i18n.t('x.set.notify_failed_desc') })}
          </div>

          {/* Alertes email automatiques */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.email_alerts')}</h2>
            {ToggleRow({ k: "email_alerts_enabled", label: i18n.t('x.set.email_master'), desc: i18n.t('x.set.email_master_desc') })}
            <div style={{ padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
              <label style={{ display: 'block', fontSize: 12, color: C.textMuted, fontWeight: 600, marginBottom: 6 }}>{i18n.t('x.set.email_recipient')}</label>
              <input type="email" value={form['alert_email'] ?? ''} disabled={isReadOnly()} placeholder={i18n.t('x.set.alert_email_ph', { defaultValue: 'alertes@exemple.cm' })}
                onChange={(e) => setVal('alert_email', e.target.value)}
                style={{ width: '100%', maxWidth: 360, background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 12px', fontSize: 13 }} />
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{i18n.t('x.set.email_recipient_desc')}</div>
            </div>
            {ToggleRow({ k: "email_alert_high_value", label: i18n.t('x.set.email_high'), desc: i18n.t('x.set.email_high_desc') })}
            {ToggleRow({ k: "email_alert_failure_rate", label: i18n.t('x.set.email_failure'), desc: i18n.t('x.set.email_failure_desc') })}
            {ToggleRow({ k: "email_alert_signups", label: i18n.t('x.set.email_signups'), desc: i18n.t('x.set.email_signups_desc') })}
            {ToggleRow({ k: "email_alert_kyc_score", label: i18n.t('x.set.email_kyc'), desc: i18n.t('x.set.email_kyc_desc') })}
            {ToggleRow({ k: "email_alert_admin_failed", label: i18n.t('x.set.email_admin'), desc: i18n.t('x.set.email_admin_desc') })}

            {/* Historique des 10 dernières alertes envoyées */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, marginBottom: 8 }}>{i18n.t('x.set.email_history')}</div>
              {(emailAlerts ?? []).length === 0 ? (
                <div style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('x.set.email_history_empty')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(emailAlerts ?? []).map((a) => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.text }}>
                        <Siren size={13} color={C.yellow} />
                        {a.detail || a.kind} {a.value ? <strong style={{ color: C.yellow }}>· {a.value}</strong> : null}
                      </span>
                      <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{relativeTime(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Intégrations — statut + test de connexion */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ ...h2, marginBottom: 0 }}>{i18n.t('x.set.integrations')}</h2>
              <button onClick={() => refetchHealth()} disabled={healthLoading} style={{ fontSize: 12, color: C.blue, background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 }}>
                {healthLoading ? i18n.t('x.set.testing') : i18n.t('x.set.test_connections')}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {(health?.integrations ?? []).map((i) => { const col = HEALTH_COLOR[i.status] ?? C.textMuted; return (
                <div key={i.name} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 5, background: col, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, color: C.text, fontWeight: 600 }}>{i.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{i18n.t('health_status.' + i.status)}{i.latency != null ? ` · ${i.latency}ms` : ''}</span>
                </div>
              )})}
            </div>
          </div>

          {/* Historique des modifications */}
          <div style={card}>
            <h2 style={h2}>{i18n.t('x.set.history')}</h2>
            {(history ?? []).length === 0 && <div style={{ fontSize: 13, color: C.textMuted }}>{i18n.t('x.set.no_history')}</div>}
            {(history ?? []).map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
                <span style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, background: C.purple + '22', color: C.purple }}>{initials(e.user?.email ?? 'SYS')}</span>
                <span style={{ color: C.textSoft, flex: 1 }}>{e.user?.email ?? i18n.t('x.audit.system')} — {e.metadata ? Object.keys((e.metadata as any).updates ?? e.metadata).join(', ') : i18n.t('x.set.settings_word')}</span>
                <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }} title={fmtDate(e.createdAt)}>{relativeTime(e.createdAt)}</span>
              </div>
            ))}
          </div>

          {/* Barre de sauvegarde sticky */}
          {dirty && !isReadOnly() && (
            <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 40, display: 'flex', alignItems: 'center', gap: 14, background: C.card, border: `1px solid ${C.green}60`, borderRadius: 12, padding: '12px 18px', boxShadow: '0 12px 40px -12px rgba(0,0,0,.6)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.text, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: C.yellow }} />{i18n.t('x.set.unsaved', { count: dirtyKeys.length })}
              </span>
              <button onClick={() => data && setForm(data)} style={{ fontSize: 13, color: C.textSoft, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('common.cancel')}</button>
              <button onClick={handleSave} style={{ fontSize: 13, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}>{saved ? i18n.t('x.set.saved_btn') : i18n.t('x.set.save_btn')}</button>
            </div>
          )}

          {/* Banniere mot de passe expire */}
          {data && data['admin_password_expired'] === 'true' && (
            <div style={{ background: '#FF4D6D15', border: `1px solid ${C.red}40`, borderRadius: 14, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>{i18n.t('x.set.pwd_expired')}</span>
            </div>
          )}

          {/* Section 2FA */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
            <h2 style={{ color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{i18n.t('x.set.twofa_title')}</h2>
            {twoFAStatus?.totpEnabled ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 12, color: C.green, background: C.greenLight, padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>{i18n.t('x.set.twofa_active')}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={twoFACode} onChange={e => setTwoFACode(e.target.value)} placeholder={i18n.t('x.set.twofa_disable_ph')} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 12px', fontSize: 14, width: 220 }} />
                  <button onClick={handleDisable2FA} disabled={twoFAActing || !twoFACode.trim()} style={{ padding: '9px 18px', background: C.redLight, border: 'none', borderRadius: 8, color: C.red, fontWeight: 700, fontSize: 13, cursor: twoFAActing ? 'wait' : 'pointer' }}>{i18n.t('x.set.twofa_disable_btn')}</button>
                </div>
              </div>
            ) : twoFASetup ? (
              <div>
                <p style={{ color: C.textSoft, fontSize: 13, marginBottom: 14 }}>{i18n.t('x.set.twofa_scan')}</p>
                <div style={{ display: 'inline-block', background: '#fff', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                  <QRCodeSVG value={twoFASetup.otpauthUrl} size={200} level="M" />
                </div>
                <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'monospace', background: C.surface, padding: '6px 10px', borderRadius: 6, marginBottom: 14, wordBreak: 'break-all' }}>{i18n.t('x.set.twofa_secret')} {twoFASetup.secret}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={twoFACode} onChange={e => setTwoFACode(e.target.value)} placeholder={i18n.t('x.set.twofa_verify_ph')} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 12px', fontSize: 14, width: 220 }} />
                  <button onClick={handleVerify2FA} disabled={twoFAActing || !twoFACode.trim()} style={{ padding: '9px 18px', background: C.green, border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, cursor: twoFAActing ? 'wait' : 'pointer' }}>{i18n.t('x.set.twofa_activate')}</button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ color: C.textSoft, fontSize: 13, marginBottom: 14 }}>{i18n.t('x.set.twofa_not_set')}</p>
                <button onClick={handleSetup2FA} disabled={twoFAActing} style={{ padding: '9px 18px', background: C.blueLight, border: `1px solid ${C.blue}40`, borderRadius: 8, color: C.blue, fontWeight: 700, fontSize: 13, cursor: twoFAActing ? 'wait' : 'pointer' }}>{i18n.t('x.set.twofa_setup')}</button>
              </div>
            )}
          </div>

          {/* Section informative */}
          <div style={{ background: C.blueLight, border: `1px solid ${C.blue}30`, borderRadius: 14, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Info size={18} color={C.blue} />
              <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{i18n.t('x.set.api_creds')}</span>
            </div>
            <p style={{ color: C.textSoft, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              {i18n.t('x.set.api_creds_body')}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// Génère un mot de passe temporaire fort (12 caractères, sans ambigus).
function genTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const sym = '!@#$%&*'
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  let p = ''
  for (let i = 0; i < 11; i++) p += chars[arr[i] % chars.length]
  return p + sym[arr[11] % sym.length]
}

// Modal de création d'un opérateur admin (SUPER_ADMIN).
function AddOperatorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [adminRole, setRole] = useState('SUPPORT_OPERATOR')
  const [password, setPassword] = useState(() => genTempPassword())
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (fullName.trim().length < 2) { toast(i18n.t('x.opmod.name_required'), 'error'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast(i18n.t('x.opmod.email_invalid'), 'error'); return }
    if (password.length < 8) { toast(i18n.t('x.opmod.pwd_short'), 'error'); return }
    setBusy(true)
    try {
      await createAdminOperator({ fullName: fullName.trim(), email: email.trim(), adminRole, password })
      toast(i18n.t('x.opmod.operator_created'), 'success')
      onCreated(); onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error')
    } finally { setBusy(false) }
  }

  const field: CSSProperties = { width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none' }
  const labelStyle: CSSProperties = { fontSize: 11, color: C.textSoft, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{i18n.t('x.opmod.add_title')}</h2>
          <button onClick={onClose} className="cw-iconbtn" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>{i18n.t('x.opmod.name_label')}</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={i18n.t('x.opmod.name_ph')} style={field} autoFocus />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>{i18n.t('x.opmod.email_label')}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={i18n.t('x.opmod.email_ph')} style={field} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>{i18n.t('x.opmod.role_label')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ROLE_ORDER.map((r) => {
              const sel = adminRole === r
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={sel}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%',
                    padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    background: sel ? ROLE_COLORS[r] + '14' : C.surface,
                    border: `1px solid ${sel ? ROLE_COLORS[r] : C.border}`,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0, background: ROLE_COLORS[r] }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: sel ? ROLE_COLORS[r] : C.text }}>{i18n.t('roles.' + r)}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{i18n.t('roles.desc_' + r)}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>{i18n.t('x.opmod.temp_pwd')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...field, fontFamily: 'monospace', letterSpacing: 1 }} />
            <button onClick={() => setPassword(genTempPassword())} title={i18n.t('x.opmod.regen')} className="cw-btn" style={{ flexShrink: 0, padding: '0 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.textSoft, cursor: 'pointer' }}><RefreshCw size={15} /></button>
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{i18n.t('x.opmod.pwd_hint')}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="cw-btn" style={{ padding: '9px 16px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', color: C.textSoft, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{i18n.t('common.cancel')}</button>
          <button onClick={submit} disabled={busy} className="cw-btn" style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: C.green, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .6 : 1 }}>{i18n.t('x.opmod.create')}</button>
        </div>
      </div>
    </div>
  )
}

function EditOperatorModal({ member, onClose, onSaved }: { member: AdminTeamMember; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState(member.adminRole ?? 'SUPPORT_OPERATOR')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const handleSave = async () => {
    setSaving(true)
    try { await setAdminRole(member.id, role); toast(i18n.t('x.opmod.role_updated'), 'success'); onSaved(); onClose() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error') }
    finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{i18n.t('x.opmod.edit_title')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: C.surface, borderRadius: 10, marginBottom: 20 }}>
          <span style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, background: (ROLE_COLORS[role] ?? C.green) + '22', color: ROLE_COLORS[role] ?? C.green }}>{initials(member.fullName ?? member.email)}</span>
          <div>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{member.fullName ?? '—'}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{member.email}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textSoft, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{i18n.t('x.opmod.role_label')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {ROLE_ORDER.map((r) => {
            const sel = role === r
            return (
              <button key={r} type="button" onClick={() => setRole(r)} aria-pressed={sel}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: sel ? ROLE_COLORS[r] + '14' : C.surface, border: `1px solid ${sel ? ROLE_COLORS[r] : C.border}` }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0, background: ROLE_COLORS[r] }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: sel ? ROLE_COLORS[r] : C.text }}>{i18n.t('roles.' + r)}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{i18n.t('roles.desc_' + r)}</div>
                </div>
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', color: C.textSoft, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{i18n.t('common.cancel')}</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: C.green, color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .6 : 1 }}>{saving ? i18n.t('x.opmod.saving') : i18n.t('x.opmod.save')}</button>
        </div>
      </div>
    </div>
  )
}

// Panneau d'activité d'un opérateur (chargé à l'expansion).
function MemberActivityPanel({ userId }: { userId: string }) {
  const { data, loading } = useFetch(() => getMemberActivity(userId), [userId])
  if (loading) return <div style={{ padding: '14px 18px', color: C.textMuted, fontSize: 12 }}>{i18n.t('common.loading')}</div>
  if (!data) return null
  return (
    <div style={{ padding: '14px 18px', background: C.bg, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
      {/* Connexion */}
      <div>
        <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{i18n.t('x.opmod.last_login')}</div>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{data.lastLoginAt ? fmtDate(data.lastLoginAt) : i18n.t('x.opmod.never')}</div>
        {data.lastLoginIp && <div style={{ fontSize: 12, color: C.textMuted, fontFamily: 'monospace', marginTop: 2 }}>IP {data.lastLoginIp}</div>}
      </div>
      {/* Stats 30j */}
      <div>
        <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{i18n.t('x.opmod.stats_30d')}</div>
        <div style={{ display: 'flex', gap: 18 }}>
          <div><div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{data.stats.actions30d}</div><div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.opmod.actions')}</div></div>
          <div><div style={{ fontSize: 18, fontWeight: 900, color: C.purple }}>{data.stats.kycHandled}</div><div style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.opmod.kyc_handled')}</div></div>
        </div>
      </div>
      {/* Activité récente */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{i18n.t('x.opmod.recent_5')}</div>
        {data.recent.length === 0 && <div style={{ fontSize: 12, color: C.textMuted }}>{i18n.t('x.opmod.no_actions')}</div>}
        {data.recent.map((a) => { const cat = auditCategory(a.action); return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color + '20', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>{auditActionLabel(a.action)}</span>
            <span style={{ color: C.textMuted, fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.resource ?? '—'}</span>
            <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{relativeTime(a.createdAt)}</span>
          </div>
        )})}
      </div>
    </div>
  )
}

function TeamPage() {
  const { t } = useTranslation()
  const { data: members, loading, error, refetch } = useFetch(getAdminTeam, [])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toast = useToast()
  const myId = getAdminId()
  const isSuper = (() => { const r = getAdminRole(); return !r || r === 'SUPER_ADMIN' })()
  const [showAdd, setShowAdd] = useState(false)
  const [showPerms, setShowPerms] = useState(false)
  const [editTarget, setEditTarget] = useState<AdminTeamMember | null>(null)
  const list = members ?? []

  const todayStr = new Date().toDateString()
  const connectedToday = list.filter((m) => m.lastLoginAt && new Date(m.lastLoginAt).toDateString() === todayStr).length
  const activeRoles = new Set(list.map((m) => m.adminRole).filter(Boolean)).size
  const lastActivity = list.map((m) => m.lastLoginAt).filter(Boolean).sort().slice(-1)[0] as string | undefined

  const handleSetPassword = async (m: AdminTeamMember) => {
    const pwd = window.prompt(i18n.t('x.team.pwd_prompt', { who: m.email ?? i18n.t('x.team.this_admin') }), genTempPassword())
    if (pwd == null) return
    if (pwd.length < 8) { toast(i18n.t('x.team.pwd_short'), 'error'); return }
    try { await setAdminPassword(m.id, pwd); toast(i18n.t('x.team.pwd_set'), 'success') }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error') }
  }
  const handleToggleStatus = async (m: AdminTeamMember) => {
    const activate = m.status !== 'ACTIVE'
    try { await setAdminStatus(m.id, activate); toast(activate ? i18n.t('x.team.reactivated') : i18n.t('x.team.deactivated'), 'success'); refetch() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error') }
  }
  const handleDelete = async (m: AdminTeamMember) => {
    if (!window.confirm(i18n.t('x.team.delete_confirm', { who: m.fullName ?? m.email ?? i18n.t('x.team.this_operator') }))) return
    try { await deleteAdmin(m.id); toast(i18n.t('x.team.operator_deleted'), 'success'); refetch() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.error'), 'error') }
  }

  const stats: { label: string; value: string; icon: LucideIcon; color: string }[] = [
    { label: i18n.t('x.team.kpi_total'), value: String(list.length), icon: UsersIcon, color: C.green },
    { label: i18n.t('x.team.kpi_today'), value: String(connectedToday), icon: Activity, color: C.blue },
    { label: i18n.t('x.team.kpi_roles'), value: String(activeRoles), icon: Shield, color: C.purple },
    { label: i18n.t('x.team.kpi_last'), value: lastActivity ? fmtDate(lastActivity) : '—', icon: Clock, color: C.yellow },
  ]
  const iconBtn = (color: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, border: `1px solid ${C.border}`, borderRadius: 7, background: C.surface, color, cursor: 'pointer' })

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('x.team.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.team.subtitle')}</p>
        </div>
        {isSuper && (
          <button onClick={() => setShowAdd(true)} className="cw-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', borderRadius: 8, background: C.green, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            <Plus size={16} /> {i18n.t('x.team.add_operator')}
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 22 }}>
        {stats.map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 19, fontWeight: 900, color: C.text }}>{s.value}</div>
          </div>
        )})}
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Table opérateurs */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
        <div className="cw-tablewrap">
          <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>
                {[i18n.t('x.team.col_operator'), i18n.t('x.team.col_email'), i18n.t('x.team.col_role'), i18n.t('x.team.col_last_login'), i18n.t('x.team.col_status'), i18n.t('x.team.col_actions')].map((h) => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const color = ROLE_COLORS[m.adminRole ?? ''] ?? C.textMuted
                const active = m.status === 'ACTIVE'
                const isSelf = m.id === myId
                const isOpen = expanded.has(m.id)
                return (
                  <Fragment key={m.id}>
                  <tr className="cw-row" onClick={() => toggleExpand(m.id)} style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {isOpen ? <ChevronUp size={14} color={C.textMuted} /> : <ChevronDown size={14} color={C.textMuted} />}
                        <span style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: color + '22', color }}>{initials(m.fullName ?? m.email)}</span>
                        <span style={{ color: C.text, fontWeight: 600 }}>{m.fullName ?? '—'}{isSelf && <span style={{ color: C.textMuted, fontWeight: 400, fontSize: 11 }}>{i18n.t('x.team.you')}</span>}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', color: C.textSoft }}>{m.email ?? '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', background: color + '20', color }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
                        {m.adminRole ? i18n.t('roles.' + m.adminRole) : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', color: C.textMuted, fontSize: 12 }}>{m.lastLoginAt ? fmtDate(m.lastLoginAt) : i18n.t('x.team.never')}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: active ? C.green : C.red }}>
                        <span style={{ width: 7, height: 7, borderRadius: 4, background: active ? C.green : C.red }} />{active ? i18n.t('x.team.active') : i18n.t('x.team.inactive')}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {isSuper && !isSelf && (
                          <button onClick={() => setEditTarget(m)} title={i18n.t('x.team.edit_role')} style={iconBtn(C.blue)}><Pencil size={14} /></button>
                        )}
                        <button onClick={() => handleSetPassword(m)} title={i18n.t('x.team.set_pwd')} style={iconBtn(C.textSoft)}><Lock size={14} /></button>
                        {isSuper && !isSelf && (
                          <button onClick={() => handleToggleStatus(m)} title={active ? i18n.t('x.team.deactivate') : i18n.t('x.team.reactivate')} style={iconBtn(active ? C.yellow : C.green)}>{active ? <WifiOff size={14} /> : <Wifi size={14} />}</button>
                        )}
                        {isSuper && !isSelf && (
                          <button onClick={() => handleDelete(m)} title={i18n.t('x.team.delete')} style={iconBtn(C.red)}><X size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, borderTop: `1px solid ${C.border}` }}>
                        <MemberActivityPanel userId={m.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {!loading && !error && list.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>{i18n.t('x.team.no_operators')}</div>
        )}
      </div>

      {/* Permissions par rôle (dépliable) */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <button onClick={() => setShowPerms((v) => !v)} className="cw-btn" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontWeight: 700, fontSize: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Shield size={16} color={C.green} /> {i18n.t('x.team.perms_by_role')}</span>
          {showPerms ? <ChevronUp size={18} color={C.textMuted} /> : <ChevronDown size={18} color={C.textMuted} />}
        </button>
        {showPerms && (
          <div className="cw-tablewrap" style={{ borderTop: `1px solid ${C.border}` }}>
            <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: C.textMuted, fontWeight: 600 }}>{i18n.t('x.team.role')}</th>
                  {NAV.map((n) => <th key={n.id} style={{ padding: '10px 8px', color: C.textMuted, fontWeight: 600, fontSize: 11 }}>{t(`nav.${n.id}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROLE_ORDER.map((r) => (
                  <tr key={r} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', background: ROLE_COLORS[r] + '20', color: ROLE_COLORS[r] }}>{i18n.t('roles.' + r)}</span>
                    </td>
                    {NAV.map((n) => (
                      <td key={n.id} style={{ padding: '10px 8px', textAlign: 'center' }}>
                        {canAccess(r, n.id) ? <Check size={15} color={C.green} /> : <span style={{ color: C.textMuted, opacity: .4 }}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddOperatorModal onClose={() => setShowAdd(false)} onCreated={refetch} />}
      {editTarget && <EditOperatorModal member={editTarget} onClose={() => setEditTarget(null)} onSaved={refetch} />}
    </div>
  )
}

// ── Support & Tickets ─────────────────────────────────────
const TICKET_CAT: Record<string, { label: string; color: string }> = {
  PAYMENT: { label: 'x.sup.cat_payment', color: C.blue }, ACCOUNT: { label: 'x.sup.cat_account', color: C.purple },
  KYC: { label: 'x.sup.cat_kyc', color: '#EC4899' }, TECHNICAL: { label: 'x.sup.cat_technical', color: C.cyan }, OTHER: { label: 'x.sup.cat_other', color: C.textMuted },
}
const TICKET_PRIO: Record<string, { label: string; color: string }> = {
  CRITICAL: { label: 'x.sup.prio_critical', color: C.red }, HIGH: { label: 'x.sup.prio_high', color: C.orange },
  MEDIUM: { label: 'x.sup.prio_medium', color: C.yellow }, LOW: { label: 'x.sup.prio_low', color: C.textMuted },
}
const TICKET_STATUS: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'x.sup.st_open', color: C.blue }, IN_PROGRESS: { label: 'x.sup.st_in_progress', color: C.orange },
  RESOLVED: { label: 'x.sup.st_resolved', color: C.green }, CLOSED: { label: 'x.sup.st_closed', color: C.textMuted },
}
const fmtDuration = (ms: number) => {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h${min % 60 ? ' ' + (min % 60) + 'min' : ''}`
  return `${Math.floor(h / 24)}j ${h % 24}h`
}
function Pill({ meta }: { meta: { label: string; color: string } }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, background: meta.color + '20', color: meta.color, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: 3, background: meta.color }} />{i18n.t(meta.label)}</span>
}

function SupportPage() {
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [category, setCategory] = useState('')
  const [assignee, setAssignee] = useState('')
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounced(searchRaw.trim(), 350)
  const [selected, setSelected] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [viewUser, setViewUser] = useState<string | null>(null)

  const { data, loading, error, refetch } = useFetch(
    () => getSupportTickets({ limit: 50, status: status || undefined, priority: priority || undefined, category: category || undefined, assignedTo: assignee || undefined, search: search || undefined }),
    [status, priority, category, assignee, search],
  )
  const { data: stats, refetch: refetchStats } = useFetch(() => getSupportStats(), [])
  const { data: team } = useFetch(() => getAdminTeam(), [])
  const tickets = data?.data ?? []
  const total = data?.meta.total ?? 0
  const refreshAll = () => { refetch(); refetchStats() }

  const statCards = stats ? [
    { label: i18n.t('x.sup.kpi_open'), value: stats.open.toLocaleString('fr-FR'), sub: i18n.t('x.sup.kpi_unassigned', { count: stats.openUnassigned }), icon: LifeBuoy, color: C.blue },
    { label: i18n.t('x.sup.kpi_in_progress'), value: stats.inProgress.toLocaleString('fr-FR'), sub: i18n.t('x.sup.kpi_processing'), icon: MessageSquare, color: C.orange },
    { label: i18n.t('x.sup.kpi_resolved_today'), value: stats.resolvedToday.toLocaleString('fr-FR'), sub: i18n.t('x.sup.kpi_closed_today'), icon: CheckCircle2, color: C.green },
    { label: i18n.t('x.sup.kpi_avg'), value: stats.avgResolutionMs == null ? '—' : fmtDuration(stats.avgResolutionMs), sub: i18n.t('x.sup.kpi_avg_sub'), icon: Clock, color: C.purple },
  ] : []
  const inputStyle: CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}><LifeBuoy size={22} color={C.green} /> {i18n.t('x.sup.title')}</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('x.sup.subtitle', { count: total })}</p>
        </div>
        {!isReadOnly() && (
          <button onClick={() => setShowNew(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', borderRadius: 8, background: C.green, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}><Plus size={16} /> {i18n.t('x.sup.new_ticket')}</button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statCards.map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="cw-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: s.color + '1F', color: s.color, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></span>
            </div>
            <div style={{ fontSize: 21, fontWeight: 900, color: C.text, letterSpacing: -0.4 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{s.sub}</div>
          </div>
        )})}
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.sup.all_statuses')}</option>
          {Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{i18n.t(v.label)}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.sup.all_priorities')}</option>
          {Object.entries(TICKET_PRIO).map(([k, v]) => <option key={k} value={k}>{i18n.t(v.label)}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.sup.all_categories')}</option>
          {Object.entries(TICKET_CAT).map(([k, v]) => <option key={k} value={k}>{i18n.t(v.label)}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={inputStyle}>
          <option value="">{i18n.t('x.sup.all_assignees')}</option>
          <option value="unassigned">{i18n.t('x.sup.unassigned_opt')}</option>
          {(team ?? []).map((m) => <option key={m.id} value={m.id}>{m.fullName ?? m.email}</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} color={C.textMuted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder={i18n.t('x.sup.search_ph')} style={{ ...inputStyle, width: '100%', paddingLeft: 34 }} />
        </div>
      </div>

      {/* Liste */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
          <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>{[i18n.t('x.sup.col_ref'), i18n.t('x.sup.col_client'), i18n.t('x.sup.col_subject'), i18n.t('x.sup.col_category'), i18n.t('x.sup.col_priority'), i18n.t('x.sup.col_status'), i18n.t('x.sup.col_assigned'), i18n.t('x.sup.col_created'), i18n.t('x.sup.col_activity')].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {tickets.map((tk) => (
                <tr key={tk.id} className="cw-row" onClick={() => setSelected(tk.id)} style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                  <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontSize: 12, color: C.textSoft, fontWeight: 700 }}>{tk.reference}</td>
                  <td style={{ padding: '11px 14px' }}><UserCell party={tk.user ? { fullName: tk.user.fullName, phone: tk.user.phone } : null} /></td>
                  <td style={{ padding: '11px 14px', color: C.text, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.title}</td>
                  <td style={{ padding: '11px 14px' }}><Pill meta={TICKET_CAT[tk.category] ?? TICKET_CAT.OTHER} /></td>
                  <td style={{ padding: '11px 14px' }}><Pill meta={TICKET_PRIO[tk.priority] ?? TICKET_PRIO.MEDIUM} /></td>
                  <td style={{ padding: '11px 14px' }}><Pill meta={TICKET_STATUS[tk.status] ?? TICKET_STATUS.OPEN} /></td>
                  <td style={{ padding: '11px 14px' }}>
                    {tk.assignee ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={tk.assignee.fullName ?? tk.assignee.email ?? ''}>
                        <span style={{ width: 24, height: 24, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, background: C.green + '22', color: C.green }}>{initials(tk.assignee.fullName ?? tk.assignee.email)}</span>
                      </span>
                    ) : <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>{i18n.t('x.sup.unassigned')}</span>}
                  </td>
                  <td style={{ padding: '11px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(tk.createdAt)}>{relativeTime(tk.createdAt)}</td>
                  <td style={{ padding: '11px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }} title={fmtDate(tk.updatedAt)}>{relativeTime(tk.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && tickets.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>{i18n.t('x.sup.no_tickets')}</div>}
        <StateRow loading={loading} error={error} />
      </div>

      {selected && <TicketDetailModal ticketId={selected} team={team ?? []} onClose={() => setSelected(null)} onChanged={refreshAll} onViewUser={setViewUser} />}
      {showNew && <NewTicketModal team={team ?? []} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); refreshAll(); setSelected(id) }} />}
      {/* z-index 70 : au-dessus de la modale ticket (60) ; fermer la fiche ramène au ticket. */}
      {viewUser && <UserDetailModal userId={viewUser} onClose={() => setViewUser(null)} onChanged={() => {}} zIndex={70} />}
    </div>
  )
}

// Modale détail ticket : infos client, assignation, statut/priorité, fil de messages.
function TicketDetailModal({ ticketId, team, onClose, onChanged, onViewUser }: { ticketId: string; team: AdminTeamMember[]; onClose: () => void; onChanged: () => void; onViewUser: (id: string) => void }) {
  const { data: tk, loading, refetch } = useFetch(() => getSupportTicket(ticketId), [ticketId])
  const toast = useToast()
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const myId = getAdminId()
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight }, [tk?.messages?.length])

  const patch = async (dto: { status?: string; priority?: string; assignedTo?: string | null }, msg: string) => {
    try { await updateSupportTicket(ticketId, dto); toast(msg, 'success'); refetch(); onChanged() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
  }
  const send = async () => {
    if (!reply.trim()) return
    setSending(true)
    try { await addSupportMessage(ticketId, reply.trim(), internal); setReply(''); setInternal(false); refetch(); onChanged() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
    finally { setSending(false) }
  }
  // Suppression définitive réservée au SUPER_ADMIN (action destructive + auditée).
  const isSuper = (() => { const r = getAdminRole(); return !r || r === 'SUPER_ADMIN' })()
  const [deleting, setDeleting] = useState(false)
  const del = async () => {
    if (!tk) return
    if (!window.confirm(i18n.t('x.sup.delete_confirm', { ref: tk.reference }))) return
    setDeleting(true)
    try { await deleteSupportTicket(ticketId); toast(i18n.t('x.sup.deleted', { ref: tk.reference }), 'success'); onChanged(); onClose() }
    catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.sup.delete_failed', { defaultValue: 'Échec de la suppression du ticket' }), 'error'); setDeleting(false) }
  }

  const overlay: CSSProperties = { position: 'fixed', inset: 0, background: '#000A', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }
  const panel: CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, width: 'min(760px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }
  const inputStyle: CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13 }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {loading || !tk ? <div style={{ padding: 30 }}><StateRow loading={loading} error={null} /></div> : (
          <>
            {/* Header */}
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 800, color: C.green }}>{tk.reference}</span>
                    <Pill meta={TICKET_STATUS[tk.status] ?? TICKET_STATUS.OPEN} />
                    <Pill meta={TICKET_PRIO[tk.priority] ?? TICKET_PRIO.MEDIUM} />
                    <Pill meta={TICKET_CAT[tk.category] ?? TICKET_CAT.OTHER} />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{tk.title}</div>
                </div>
                <button onClick={onClose} aria-label={i18n.t('common.close')} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 4 }}><X size={20} /></button>
              </div>
              {/* Client + assignation + actions */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: C.green + '22', color: C.green }}>{initials(tk.user?.fullName ?? tk.user?.phone)}</span>
                  <div>
                    <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{tk.user?.fullName ?? tk.user?.phone}</div>
                    <button onClick={() => onViewUser(tk.userId)} style={{ fontSize: 11, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{i18n.t('x.sup.view_client')}</button>
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                {!isReadOnly() && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <select value={tk.assignedTo ?? ''} onChange={(e) => patch({ assignedTo: e.target.value || null }, i18n.t('x.sup.assign_updated'))} style={inputStyle}>
                      <option value="">{i18n.t('x.sup.unassigned')}</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.fullName ?? m.email}</option>)}
                    </select>
                    {tk.assignedTo !== myId && <button onClick={() => patch({ assignedTo: myId }, i18n.t('x.sup.taken'))} style={{ fontSize: 12, color: C.green, background: C.greenLight, border: `1px solid ${C.green}40`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.sup.assign_self')}</button>}
                  </div>
                )}
              </div>
              {/* Barre d'actions ticket — ouverte à tous les rôles admin (statut,
                  priorité). Seule la suppression reste réservée au SUPER_ADMIN.
                  L'opérateur Support reste en lecture seule ailleurs (cf. isReadOnly). */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                {tk.status !== 'IN_PROGRESS' && tk.status !== 'RESOLVED' && tk.status !== 'CLOSED' && <button onClick={() => patch({ status: 'IN_PROGRESS' }, i18n.t('x.sup.taken_short'))} style={{ fontSize: 12, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orange}40`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.sup.take_charge')}</button>}
                {tk.status !== 'RESOLVED' && tk.status !== 'CLOSED' && <button onClick={() => patch({ status: 'RESOLVED' }, i18n.t('x.sup.resolved'))} style={{ fontSize: 12, color: C.green, background: C.greenLight, border: `1px solid ${C.green}40`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.sup.resolve')}</button>}
                {tk.status !== 'CLOSED' && <button onClick={() => patch({ status: 'CLOSED' }, i18n.t('x.sup.closed'))} style={{ fontSize: 12, color: C.textSoft, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('x.sup.close')}</button>}
                <span style={{ width: 1, height: 22, background: C.border }} />
                <span style={{ fontSize: 11, color: C.textMuted }}>{i18n.t('x.sup.priority')}</span>
                <select value={tk.priority} onChange={(e) => patch({ priority: e.target.value }, i18n.t('x.sup.prio_updated'))} style={inputStyle}>
                  {Object.entries(TICKET_PRIO).map(([k, v]) => <option key={k} value={k}>{i18n.t(v.label)}</option>)}
                </select>
                {isSuper && (
                  <>
                    <div style={{ flex: 1 }} />
                    <button onClick={del} disabled={deleting} title={i18n.t('x.sup.delete_title')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.red, background: C.redLight, border: `1px solid ${C.red}40`, borderRadius: 8, padding: '7px 12px', cursor: deleting ? 'wait' : 'pointer', fontWeight: 600 }}>
                      <Trash2 size={14} /> {deleting ? i18n.t('x.sup.deleting') : i18n.t('x.sup.delete')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Fil de messages (chat) */}
            <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 200 }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.textSoft }}>{tk.description}</div>
              {tk.messages.map((m) => {
                const mine = m.authorRole === 'ADMIN'
                const bg = m.internal ? C.yellowLight : mine ? C.greenLight : C.surface
                const border = m.internal ? C.yellow + '50' : mine ? C.green + '40' : C.border
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '78%', background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '9px 13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: mine ? C.green : C.text }}>{m.author?.fullName ?? m.author?.email ?? (mine ? i18n.t('x.sup.support_word') : i18n.t('x.sup.client_word'))}</span>
                        <span style={{ fontSize: 10, color: C.textMuted }}>{mine ? (m.author?.adminRole ? i18n.t('roles.' + m.author.adminRole) : i18n.t('x.sup.admin_word')) : i18n.t('x.sup.client_word')}</span>
                        {m.internal && <span style={{ fontSize: 9, fontWeight: 800, color: C.amber, background: C.yellow + '25', borderRadius: 5, padding: '1px 6px' }}>{i18n.t('x.sup.internal_note')}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, textAlign: 'right' }} title={fmtDate(m.createdAt)}>{relativeTime(m.createdAt)}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Zone de réponse — ouverte à tous les rôles admin, y compris
                l'opérateur Support (lecture seule ailleurs). */}
            {(
              <div style={{ borderTop: `1px solid ${C.border}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={internal ? i18n.t('x.sup.reply_internal_ph') : i18n.t('x.sup.reply_ph')} rows={2}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
                  style={{ ...inputStyle, width: '100%', resize: 'vertical', background: internal ? C.yellowLight : C.surface }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setInternal((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: internal ? C.amber : C.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    <span style={{ position: 'relative', width: 34, height: 18, borderRadius: 9, background: internal ? C.yellow : C.border }}><span style={{ position: 'absolute', top: 2, left: internal ? 18 : 2, width: 14, height: 14, borderRadius: 7, background: '#fff', transition: 'left .15s' }} /></span>
                    {i18n.t('x.sup.internal_toggle')}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button onClick={send} disabled={sending || !reply.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#fff', background: reply.trim() ? C.green : C.border, border: 'none', borderRadius: 8, padding: '8px 18px', cursor: reply.trim() ? 'pointer' : 'default', fontWeight: 700 }}><Send size={14} /> {sending ? i18n.t('x.sup.sending') : i18n.t('x.sup.send')}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Modale de création d'un ticket.
function NewTicketModal({ team, onClose, onCreated, initial, zIndex = 70 }: { team: AdminTeamMember[]; onClose: () => void; onCreated: (id: string) => void; initial?: { client?: { id: string; fullName: string | null; phone: string }; title?: string; description?: string; category?: string; priority?: string }; zIndex?: number }) {
  const toast = useToast()
  const [clientSearch, setClientSearch] = useState('')
  const debSearch = useDebounced(clientSearch.trim(), 350)
  const { data: clientResults } = useFetch(() => (debSearch ? getUsers({ limit: 6, search: debSearch }) : Promise.resolve(null)), [debSearch])
  // Valeurs initiales (ex. ticket ouvert depuis une transaction : client + contexte pré-remplis).
  const [client, setClient] = useState<{ id: string; fullName: string | null; phone: string } | null>(initial?.client ?? null)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'OTHER')
  const [priority, setPriority] = useState(initial?.priority ?? 'MEDIUM')
  const [assignedTo, setAssignedTo] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!client) { toast(i18n.t('x.sup.select_client'), 'error'); return }
    if (!title.trim() || !description.trim()) { toast(i18n.t('x.sup.title_desc_required'), 'error'); return }
    setSaving(true)
    try {
      const t = await createSupportTicket({ userId: client.id, title: title.trim(), description: description.trim(), category, priority, assignedTo: assignedTo || undefined })
      toast(i18n.t('x.sup.created'), 'success'); onCreated((t as any).id)
    } catch (e) { toast(e instanceof Error ? e.message : i18n.t('x.common.failure'), 'error') }
    finally { setSaving(false) }
  }
  const inputStyle: CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, width: '100%' }
  const label = (s: string) => <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>{s}</label>

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000A', zIndex, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, width: 'min(540px, 100%)', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{i18n.t('x.sup.new_title')}</h2>
          <button onClick={onClose} aria-label={i18n.t('common.close')} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            {label(i18n.t('x.sup.client'))}
            {client ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.green}40`, borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ width: 26, height: 26, borderRadius: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: C.green + '22', color: C.green }}>{initials(client.fullName ?? client.phone)}</span>
                <span style={{ flex: 1, fontSize: 13, color: C.text }}>{client.fullName ?? client.phone}<span style={{ color: C.textMuted, fontSize: 11 }}> · {client.phone}</span></span>
                <button onClick={() => setClient(null)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}><X size={14} /></button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder={i18n.t('x.sup.client_search_ph')} style={inputStyle} />
                {(clientResults?.data?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
                    {clientResults!.data.map((u) => (
                      <button key={u.id} onClick={() => { setClient({ id: u.id, fullName: u.fullName, phone: u.phone }); setClientSearch('') }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, padding: '8px 12px', cursor: 'pointer' }}>
                        <span style={{ width: 24, height: 24, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, background: C.green + '22', color: C.green }}>{initials(u.fullName ?? u.phone)}</span>
                        <span style={{ fontSize: 13, color: C.text }}>{u.fullName ?? i18n.t('common.no_name')}<span style={{ color: C.textMuted, fontSize: 11 }}> · {u.phone}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>{label(i18n.t('x.sup.ticket_title'))}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={i18n.t('x.sup.title_ph')} style={inputStyle} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>{label(i18n.t('x.sup.category'))}<select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>{Object.entries(TICKET_CAT).map(([k, v]) => <option key={k} value={k}>{i18n.t(v.label)}</option>)}</select></div>
            <div style={{ flex: 1 }}>{label(i18n.t('x.sup.priority_l'))}<select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>{Object.entries(TICKET_PRIO).map(([k, v]) => <option key={k} value={k}>{i18n.t(v.label)}</option>)}</select></div>
          </div>
          <div>{label(i18n.t('x.sup.assign_opt'))}<select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={inputStyle}><option value="">{i18n.t('x.sup.leave_unassigned')}</option>{team.map((m) => <option key={m.id} value={m.id}>{m.fullName ?? m.email}</option>)}</select></div>
          <div>{label(i18n.t('x.sup.description'))}<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder={i18n.t('x.sup.desc_ph')} style={{ ...inputStyle, resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ fontSize: 13, color: C.textSoft, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>{i18n.t('common.cancel')}</button>
            <button onClick={submit} disabled={saving} style={{ fontSize: 13, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '9px 20px', cursor: saving ? 'wait' : 'pointer', fontWeight: 700 }}>{saving ? i18n.t('x.sup.creating') : i18n.t('x.sup.create')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar nav items ─────────────────────────────────────
// `id` sert aussi de clé i18n : le libellé est résolu via t(`nav.${id}`) et le
// groupe via t(`nav.group_${group}`). Voir src/locales/*.json (section « nav »).
// ── Page Analytique (tableau de bord analytique avancé) ───────────────────
const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] // dow 0 = dimanche

function AnalyticsPage() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const { data: ret } = useFetch(() => getAnalyticsRetention(), [])
  const { data: acq } = useFetch(() => getAnalyticsAcquisition(period), [period])
  const { data: heat } = useFetch(() => getAnalyticsHeatmap(), [])
  const { data: funnel } = useFetch(() => getKycFunnel(), [])
  const { data: topU } = useFetch(() => getTopUsers(10), [])
  const { data: topM } = useFetch(() => getTopMerchants(10), [])
  const { data: geo } = useFetch(() => getAnalyticsGeo(), [])

  const card: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px' }
  const h2: CSSProperties = { fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 14 }

  // KPI cards.
  const kpis = [
    { label: i18n.t('analytics.retention_7d'), value: ret ? `${ret.retention7d} %` : '—', sub: ret ? i18n.t('analytics.active_users', { n: ret.active7d }) : '', color: C.green },
    { label: i18n.t('analytics.retention_30d'), value: ret ? `${ret.retention30d} %` : '—', sub: ret ? i18n.t('analytics.active_users', { n: ret.active30d }) : '', color: C.blue },
    { label: i18n.t('analytics.avg_tx'), value: ret ? formatFCFA(ret.avgPerTransaction) : '—', sub: i18n.t('analytics.avg_tx_sub'), color: C.purple },
    { label: i18n.t('analytics.avg_user'), value: ret ? formatFCFA(ret.avgPerUser) : '—', sub: i18n.t('analytics.avg_user_sub'), color: C.blue },
    { label: i18n.t('analytics.avg_day'), value: ret ? formatFCFA(ret.avgPerDay) : '—', sub: i18n.t('analytics.avg_day_sub'), color: C.yellow },
  ]

  // Inscriptions cumulées (LineChart).
  const acqData = (acq?.series ?? []).map((p) => ({ date: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`, signups: p.signups, cumulative: p.cumulative }))

  // Activité par jour de semaine (agrégée depuis la heatmap).
  const byWeekday = WEEKDAYS.map((name, dow) => ({ name, count: (heat?.cells ?? []).filter((c) => c.dow === dow).reduce((s, c) => s + c.count, 0) }))

  // Heatmap heure × jour : grille + intensité relative au max.
  const cellMap = new Map((heat?.cells ?? []).map((c) => [`${c.dow}-${c.hour}`, c.count]))
  const maxCell = Math.max(1, ...(heat?.cells ?? []).map((c) => c.count))

  // Entonnoir KYC.
  const funnelSteps = funnel ? [
    { label: i18n.t('analytics.funnel_pending'), value: funnel.pending + funnel.submitted + funnel.approved + funnel.rejected, color: C.textMuted },
    { label: i18n.t('analytics.funnel_submitted'), value: funnel.submitted + funnel.approved + funnel.rejected, color: C.yellow, rate: funnel.submittedRate },
    { label: i18n.t('analytics.funnel_approved'), value: funnel.approved, color: C.green, rate: funnel.approvedRate },
  ] : []
  const funnelMax = Math.max(1, ...funnelSteps.map((s) => s.value))

  const PERIODS: ('7d' | '30d' | '90d')[] = ['7d', '30d', '90d']
  const TopTable = ({ title, rows }: { title: string; rows: { fullName: string | null; phone: string; volume: number; count: number }[] }) => (
    <div style={card}>
      <div style={h2}>{title}</div>
      {rows.length === 0 ? <div style={{ color: C.textMuted, fontSize: 13, padding: '8px 0' }}>{i18n.t('analytics.no_data')}</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.phone + i} style={{ borderTop: i ? `1px solid ${C.border}` : 'none' }}>
                <td style={{ padding: '8px 0', color: C.textMuted, width: 22 }}>{i + 1}</td>
                <td style={{ padding: '8px 0' }}>
                  <div style={{ color: C.text, fontWeight: 600 }}>{r.fullName ?? '—'}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{r.phone}</div>
                </td>
                <td style={{ padding: '8px 0', textAlign: 'right', color: C.textMuted, fontSize: 11 }}>{i18n.t('analytics.tx_count', { n: r.count })}</td>
                <td style={{ padding: '8px 0', textAlign: 'right', color: C.green, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatFCFA(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{i18n.t('analytics.title')}</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{i18n.t('analytics.subtitle')}</p>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
        {kpis.map((k) => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: k.color, letterSpacing: -0.5 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Acquisition (inscriptions cumulées) */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={h2}>{i18n.t('analytics.acquisition_title')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {PERIODS.map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${period === p ? C.green : C.border}`, background: period === p ? C.greenLight : 'transparent', color: period === p ? C.green : C.textSoft, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {i18n.t('dashboard.period_' + p)}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={acqData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={{ stroke: C.border }} />
            <YAxis stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} width={40} />
            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.textSoft }} />
            <Line type="monotone" dataKey="cumulative" name={i18n.t('analytics.signups_cumulative')} stroke={C.green} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="signups" name={i18n.t('analytics.signups_daily')} stroke={C.blue} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Activité par jour de semaine + Funnel KYC */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={card}>
          <div style={h2}>{i18n.t('analytics.weekday_title')}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byWeekday} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="name" stroke={C.textMuted} fontSize={11} tickLine={false} axisLine={{ stroke: C.border }} />
              <YAxis stroke={C.textMuted} fontSize={10} tickLine={false} axisLine={false} width={32} />
              <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.textSoft }} cursor={{ fill: C.greenLight }} />
              <Bar dataKey="count" name={i18n.t('analytics.tx_label')} radius={[4, 4, 0, 0]}>
                {byWeekday.map((_, i) => <Cell key={i} fill={C.green} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <div style={h2}>{i18n.t('analytics.funnel_title')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            {funnelSteps.map((s) => (
              <div key={s.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: C.textSoft }}>{s.label}{typeof s.rate === 'number' ? <span style={{ color: C.textMuted }}> · {s.rate} %</span> : null}</span>
                  <span style={{ color: C.text, fontWeight: 700 }}>{s.value.toLocaleString('fr-FR')}</span>
                </div>
                <div style={{ height: 12, background: C.border, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((s.value / funnelMax) * 100)}%`, background: s.color, borderRadius: 6, transition: 'width .3s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Heatmap heure × jour */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={h2}>{i18n.t('analytics.heatmap_title')}</div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, minWidth: 640 }}>
            <div style={{ display: 'flex', gap: 3, paddingLeft: 30 }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ width: 22, textAlign: 'center', fontSize: 8, color: C.textMuted }}>{h % 3 === 0 ? h : ''}</div>
              ))}
            </div>
            {WEEKDAYS.map((name, dow) => (
              <div key={dow} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <div style={{ width: 27, fontSize: 10, color: C.textMuted }}>{name}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = cellMap.get(`${dow}-${h}`) ?? 0
                  const intensity = v === 0 ? 0 : 0.15 + 0.85 * (v / maxCell)
                  return <div key={h} title={`${name} ${h}h — ${v}`} style={{ width: 22, height: 16, borderRadius: 3, background: v === 0 ? C.border + '60' : `rgba(0,200,150,${intensity})` }} />
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>{i18n.t('analytics.heatmap_hint')}</div>
      </div>

      {/* Top utilisateurs / marchands */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
        <TopTable title={i18n.t('analytics.top_users_title')} rows={topU?.users ?? []} />
        <TopTable title={i18n.t('analytics.top_merchants_title')} rows={topM?.merchants ?? []} />
      </div>

      {/* Répartition géographique — carte choroplèthe du Cameroun */}
      <div style={card}>
        <div style={h2}>{i18n.t('analytics.geo_title')}</div>
        <CameroonGeoMap regions={geo?.regions ?? []} />
      </div>
    </div>
  )
}

const NAV: { id: string; icon: LucideIcon; group: string; badge?: string }[] = [
  { id: 'dashboard', icon: LayoutGrid, group: 'overview' },
  { id: 'analytics', icon: Activity, group: 'overview' },
  { id: 'alerts', icon: AlertTriangle, group: 'overview' },
  { id: 'support', icon: LifeBuoy, group: 'overview' },
  { id: 'users', icon: UsersIcon, group: 'users' },
  { id: 'kyc', icon: ClipboardCheck, group: 'users' },
  { id: 'transactions', icon: Zap, group: 'finances' },
  { id: 'finance', icon: Wallet, group: 'finances' },
  { id: 'operations', icon: ArrowLeftRight, group: 'finances' },
  { id: 'anif', icon: ShieldAlert, group: 'compliance' },
  { id: 'audit', icon: FileText, group: 'compliance' },
  { id: 'team', icon: Shield, group: 'compliance' },
  { id: 'settings', icon: Settings, group: 'compliance' },
]

const GROUPS = ['overview', 'users', 'finances', 'compliance']

// ── RBAC : pages visibles selon le sous-rôle admin (claim JWT adminRole) ──
// '*' = toutes les pages. Un rôle inconnu/absent retombe sur l'accès complet
// (le compte admin configuré est SUPER_ADMIN ; le backend garde l'autorité).
const ROLE_PAGES: Record<string, string[] | '*'> = {
  SUPER_ADMIN: '*',
  ADMIN: ['dashboard', 'analytics', 'alerts', 'support', 'users', 'kyc', 'transactions', 'finance', 'operations', 'anif', 'audit'],
  COMPLIANCE_OFFICER: ['anif', 'audit'],
  SUPPORT_OPERATOR: ['support', 'users', 'transactions'],
  FINANCE_OFFICER: ['analytics', 'finance', 'operations'],
  KYC_OFFICER: ['kyc'],
}
// Ordre d'affichage des rôles, du plus au moins privilégié (selects, modal, matrice).
const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_OFFICER', 'FINANCE_OFFICER', 'KYC_OFFICER', 'SUPPORT_OPERATOR']
// Couleurs de badge par rôle (hex exacts demandés).
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: '#00C896',
  ADMIN: '#3B82F6',
  COMPLIANCE_OFFICER: '#8B5CF6',
  SUPPORT_OPERATOR: '#F59E0B',
  FINANCE_OFFICER: '#06B6D4',
  KYC_OFFICER: '#EC4899',
}
function canAccess(role: string | null, page: string): boolean {
  const allowed = ROLE_PAGES[role ?? ''] ?? '*'
  return allowed === '*' || allowed.includes(page)
}
// SUPPORT_OPERATOR : accès en lecture seule (aucune action sur Utilisateurs/Transactions).
function isReadOnly(): boolean {
  return getAdminRole() === 'SUPPORT_OPERATOR'
}

// Sélecteur de langue FR | EN (header). Persiste le choix dans localStorage
// (clé « lang », lue au démarrage par src/i18n.ts) et bascule i18next à chaud.
function LangToggle() {
  const { i18n } = useTranslation()
  const current = (i18n.language || 'fr').split('-')[0]
  const change = (lng: 'fr' | 'en') => {
    if (lng === current) return
    localStorage.setItem('lang', lng)
    i18n.changeLanguage(lng)
  }
  return (
    <div role="group" aria-label="Langue / Language" style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {(['fr', 'en'] as const).map((lng) => {
        const active = current === lng
        return (
          <button
            key={lng}
            type="button"
            onClick={() => change(lng)}
            aria-pressed={active}
            style={{
              padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: active ? C.green + '20' : 'none',
              color: active ? C.green : C.textMuted,
            }}
          >
            {lng.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const { t } = useTranslation()
  const [authed, setAuthed] = useState(hasSession())
  // Sous-rôle admin (RBAC) lu depuis le token ; recalculé à chaque (dé)connexion.
  const adminRole = useMemo(() => getAdminRole(), [authed])
  const visibleNav = useMemo(() => NAV.filter((n) => canAccess(adminRole, n.id)), [adminRole])
  // Badge sidebar : nombre de tickets ouverts non assignés (rafraîchi périodiquement).
  const { data: supportBadge } = useFetch(() => (authed && canAccess(adminRole, 'support') ? getSupportStats() : Promise.resolve(null)), [authed, adminRole])
  const supportUnassigned = supportBadge?.openUnassigned ?? 0
  // Page par défaut = première page autorisée pour le rôle.
  const [activePage, setActivePage] = useState(() => {
    const role = getAdminRole()
    return NAV.find((n) => canAccess(role, n.id))?.id ?? 'dashboard'
  })
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastSeq
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const handleLogout = useCallback(() => {
    logout()
    setAuthed(false)
  }, [])

  // Session expirée (refresh impossible) → retour au login.
  useEffect(() => {
    const onExpired = () => handleLogout()
    window.addEventListener('cw-session-expired', onExpired)
    return () => window.removeEventListener('cw-session-expired', onExpired)
  }, [handleLogout])

  // RBAC : après connexion (le rôle n'est connu qu'une fois authentifié), si la
  // page active n'est pas autorisée pour le rôle, basculer sur la première page
  // permise. Évite qu'un admin restreint atterrisse sur une page masquée.
  useEffect(() => {
    if (authed && !canAccess(adminRole, activePage)) {
      const first = NAV.find((n) => canAccess(adminRole, n.id))
      if (first) setActivePage(first.id)
    }
  }, [authed, adminRole, activePage])

  // ── SSE global : toasts pour les événements temps réel ──
  const handleGlobalEvent = useCallback((event: { type: string; payload?: any }) => {
    if (event.type === 'transaction') showToast(i18n.t('live_events.new_transaction'))
    if (event.type === 'user') showToast(i18n.t('live_events.new_user'))
    if (event.type === 'kyc') showToast(i18n.t('live_events.new_kyc'))
  }, [showToast])

  useLiveEvents(handleGlobalEvent)

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />
  }

  // Page effective : si la page active n'est pas autorisée (ex. juste après une
  // connexion restreinte), on rend la première page permise — pas de flash.
  const effectivePage = canAccess(adminRole, activePage) ? activePage : (visibleNav[0]?.id ?? activePage)

  const renderPage = () => {
    switch (effectivePage) {
      case 'dashboard': return <DashboardPage onNavigate={setActivePage} />
      case 'analytics': return <AnalyticsPage />
      case 'alerts': return <AlertsPage />
      case 'support': return <SupportPage />
      case 'users': return <UsersPage />
      case 'kyc': return <KYCPage />
      case 'transactions': return <TransactionsPage />
      case 'finance': return <FinancePage />
      case 'operations': return <OperationsPage />
      case 'anif': return <ANIFPage />
      case 'audit': return <AuditPage />
      case 'team': return <TeamPage />
      case 'settings': return <SettingsPage />
      default: return <DashboardPage />
    }
  }

  return (
    <RefreshContext.Provider value={refreshNonce}>
    <ToastContext.Provider value={showToast}>
    <div className="cw-shell" style={{ display: 'flex', height: '100vh', background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", color: C.text }}>
      {/* Sidebar */}
      <aside className="cw-sidebar" style={{ width: 230, background: C.surface, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Brand */}
        <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            ₩
          </div>
          <div className="cw-compact-hide">
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
              Cam<span style={{ color: C.green }}>Wallet</span>
            </div>
            <div style={{ fontSize: 11, color: C.textMuted }}>{t('nav.admin_panel')}</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
          {GROUPS.filter(group => visibleNav.some(n => n.group === group)).map(group => (
            <div key={group}>
              <div className="cw-compact-hide" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', padding: '8px 8px 4px' }}>
                {t(`nav.group_${group}`)}
              </div>
              {visibleNav.filter(n => n.group === group).map(item => {
                const Icon = item.icon
                const active = activePage === item.id
                return (
                <button
                  key={item.id}
                  className="cw-nav-btn"
                  onClick={() => setActivePage(item.id)}
                  aria-current={active ? 'page' : undefined}
                  title={t(`nav.${item.id}`)}
                  style={{
                    position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px',
                    borderRadius: 10, cursor: 'pointer', fontSize: 13, width: '100%', textAlign: 'left',
                    border: 'none', marginBottom: 2,
                    background: active ? C.green + '20' : 'none',
                    color: active ? C.green : C.textSoft,
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {active && <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 3, borderRadius: 3, background: C.green }} />}
                  <Icon size={18} style={{ flexShrink: 0 }} />
                  <span className="cw-navlabel" style={{ flex: 1 }}>{t(`nav.${item.id}`)}</span>
                  {item.id === 'support' && supportUnassigned > 0 && (
                    <span className="cw-nav-badge" style={{ fontSize: 10, background: C.red, color: '#fff', minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {supportUnassigned}
                    </span>
                  )}
                  {item.badge && (
                    <span className="cw-nav-badge" style={{ fontSize: 10, background: C.blue + '25', color: C.blue, padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>
                      {item.badge}
                    </span>
                  )}
                </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Retour à la landing opérateurs — lien discret, séparé de la nav, tous rôles */}
        <a
          href="/"
          title={t('nav.back_home')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: `1px solid ${C.border}`, color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 500, textDecoration: 'none', transition: 'color .15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#fff' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.35)' }}
        >
          <ArrowLeft size={14} />
          <span className="cw-navlabel">{t('nav.back_home')}</span>
        </a>

        {/* Footer */}
        <div className="cw-compact-hide" style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted }}>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{t('nav.admin_system')}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.green, display: 'inline-block' }} />
            <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>{t('nav.api_operational')}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
            {NAV.some(n => n.id === effectivePage) ? t(`nav.${effectivePage}`) : t('nav.dashboard')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LangToggle />
            <button
              className="cw-btn"
              onClick={() => setRefreshNonce(n => n + 1)}
              aria-label={t('topbar.refresh_aria')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'none', color: C.textSoft }}>
              <RefreshCw size={14} /> <span className="cw-topbar-label">{t('common.refresh')}</span>
            </button>
            <button
              className="cw-btn"
              onClick={handleLogout}
              aria-label={t('topbar.logout_aria')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'none', color: C.textSoft }}>
              <LogOut size={14} /> <span className="cw-topbar-label">{t('topbar.logout')}</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="cw-compact-hide" style={{ textAlign: 'right', lineHeight: 1.25 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Admin</div>
                {adminRole && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: ROLE_COLORS[adminRole] ?? C.textMuted }}>
                    {i18n.t('roles.' + adminRole)}
                  </div>
                )}
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 17, background: (ROLE_COLORS[adminRole ?? ''] ?? C.green) + '20', border: `2px solid ${ROLE_COLORS[adminRole ?? ''] ?? C.green}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: ROLE_COLORS[adminRole ?? ''] ?? C.green, flexShrink: 0 }}>
                A
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {renderPage()}
        </div>
      </main>

      <ToastHost toasts={toasts} dismiss={dismissToast} />
    </div>
    </ToastContext.Provider>
    </RefreshContext.Provider>
  )
}
