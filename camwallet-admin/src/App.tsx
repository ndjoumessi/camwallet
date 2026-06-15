import { useState, useEffect, useCallback, useMemo, createContext, useContext, type CSSProperties } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import {
  LayoutGrid, AlertTriangle, Users as UsersIcon, ClipboardCheck, Zap, Wallet,
  Landmark, TrendingUp, RefreshCw, LogOut, Search, Clock, CheckCircle2, XCircle,
  FileText, Siren, Info, Lock, ArrowUpRight, ArrowDownRight, ArrowRight,
  X, Check, ChevronUp, ChevronDown, ChevronsUpDown,
  ShieldAlert, ArrowLeftRight, Activity, Wifi, WifiOff,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import LoginPage from './LoginPage'
import {
  hasSession, logout, toFcfa, SessionExpiredError,
  getStats, getUsers, getTransactions, getTimeseries,
  getKyc, getAlerts, getAudit, reviewKyc, setUserStatus,
  getUserDetail, resetUserPin,
  getAnifAlerts, openAnifCase, closeAnifCase,
  getOperations, retryOperation, WebhookEvent,
  getHealthIntegrations,
  getOperatorRates, getSettings, updateSettings,
} from './lib/api'

// ── Design Tokens ────────────────────────────────────────
const C = {
  bg: '#0A0F1E', surface: '#111827', card: '#161D2F', border: '#1E2D45',
  green: '#00C896', greenDark: '#008F6A', greenLight: '#00C89618',
  blue: '#3B82F6', blueLight: '#3B82F615',
  yellow: '#F5C542', yellowLight: '#F5C54215',
  red: '#FF4D6D', redLight: '#FF4D6D15',
  purple: '#A78BFA', purpleLight: '#A78BFA15',
  text: '#EEF2FF', textMuted: '#64748B', textSoft: '#94A3B8',
  white: '#FFFFFF',
}

// ── Formatters ────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA'
const fmtM = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'k') + ' FCFA'

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
  PENDING: 'pending', SUBMITTED: 'review', APPROVED: 'approved', REJECTED: 'rejected',
}
const TX_STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'success', PENDING: 'pending', PROCESSING: 'pending',
  FAILED: 'failed', REFUNDED: 'flagged', CANCELLED: 'failed',
}
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

// Petit bandeau d'état (chargement / erreur / vide) partagé par les pages.
function StateRow({ loading, error, empty }: { loading: boolean; error: string | null; empty?: string }) {
  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Chargement…</div>
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
          setError(e instanceof Error ? e.message : 'Erreur de chargement')
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

// ── Status badges ─────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string, text: string, label: string, icon?: LucideIcon }> = {
    success: { bg: '#00C89618', text: C.green, label: 'Succès' },
    pending: { bg: C.yellowLight, text: '#B89000', label: 'En attente' },
    failed: { bg: C.redLight, text: C.red, label: 'Échoué' },
    flagged: { bg: '#A78BFA18', text: C.purple, label: 'Signalé', icon: Siren },
    verified: { bg: '#00C89618', text: C.green, label: 'Vérifié', icon: CheckCircle2 },
    blocked: { bg: C.redLight, text: C.red, label: 'Bloqué', icon: Lock },
    suspended: { bg: '#A78BFA18', text: C.purple, label: 'Suspendu' },
    approved: { bg: '#00C89618', text: C.green, label: 'Approuvé' },
    rejected: { bg: C.redLight, text: C.red, label: 'Rejeté' },
    review: { bg: C.yellowLight, text: '#B89000', label: 'Révision' },
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
    RECHARGE: { bg: C.yellowLight, text: '#B89000' },
    RETRAIT: { bg: C.purpleLight, text: C.purple },
  }
  const s = map[type] ?? { bg: '#333', text: '#888' }
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.text }}>
      {type}
    </span>
  )
}

// ── KPI Card ──────────────────────────────────────────────
function KPICard({ label, value, delta, deltaUp, icon: Icon, color = C.green, sub }: {
  label: string, value: string, delta?: string, deltaUp?: boolean, icon: LucideIcon, color?: string, sub?: string
}) {
  const TrendIcon = deltaUp ? ArrowUpRight : ArrowDownRight
  return (
    <div
      className="cw-card"
      style={{
        background: `linear-gradient(140deg, ${color}12 0%, ${C.card} 55%)`,
        border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{label}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
          borderRadius: 10, background: color + '1F', color, flexShrink: 0,
        }}><Icon size={18} /></span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: -0.5, marginBottom: 6 }}>{value}</div>
      {delta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: deltaUp ? C.green : C.red, fontWeight: 600 }}>
          <TrendIcon size={14} className={deltaUp ? 'cw-trend-up' : 'cw-trend-down'} />
          {delta} vs 30 j préc.
        </div>
      )}
      {sub && <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{sub}</div>}
    </div>
  )
}

// ── Chart tooltip ─────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
      <div style={{ color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{typeof p.value === 'number' && p.value > 1000 ? fmtM(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

// ── Pages ────────────────────────────────────────────────
function DashboardPage() {
  // Sources indépendantes : l'échec de l'une n'efface pas l'autre.
  const { data: stats, loading: statsLoading, error: statsError } = useFetch(() => getStats(), [])
  const { data: recentData, loading: recentLoading, error: recentError } = useFetch(
    () => getTransactions({ limit: 5 }), [],
  )
  const recent = recentData?.data ?? []

  // Séries temporelles réelles (volume, frais, tx, users) selon la période.
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d')
  const { data: ts } = useFetch(() => getTimeseries(period), [period])
  const chart = (ts?.series ?? []).map((p) => ({
    date: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`,
    volume: toFcfa(p.volume),
    fees: toFcfa(p.fees),
    tx: p.transactions,
    users: p.users,
  }))
  const PERIODS: { key: '7d' | '30d' | '90d'; label: string }[] = [
    { key: '7d', label: '7 j' },
    { key: '30d', label: '30 j' },
    { key: '90d', label: '90 j' },
  ]

  const donut = (stats?.transactions.byType ?? []).map((t) => ({
    name: TX_TYPE_LABEL[t.type] ?? t.type,
    value: t.count,
    color: TX_TYPE_COLOR[t.type] ?? C.textMuted,
  }))

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Vue d'ensemble</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>Données en temps réel — API CamWallet</p>
      </div>

      {(statsLoading || statsError) && <StateRow loading={statsLoading} error={statsError} />}

      {/* KPIs */}
      {stats && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 24 }}>
        <KPICard label="Volume complété" value={fmt(toFcfa(stats.volume.completedAmount))} icon={Wallet}
          {...trendProps(stats.trends.volume)}
          sub={`Frais perçus : ${fmt(toFcfa(stats.volume.collectedFees))}`} />
        <KPICard label="Solde plateforme" value={fmt(toFcfa(stats.totalBalance))} icon={Landmark} color={C.purple} />
        <KPICard label="Utilisateurs" value={stats.users.total.toLocaleString('fr-FR')} icon={UsersIcon} color={C.green}
          {...trendProps(stats.trends.users)}
          sub={stats.users.byRole.map((r) => `${r.count} ${r.role.toLowerCase()}`).join(' · ')} />
        <KPICard label="Transactions" value={stats.transactions.total.toLocaleString('fr-FR')} icon={Zap} color={C.blue}
          {...trendProps(stats.trends.transactions)}
          sub={`${stats.transactions.pending} en attente`} />
      </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Volume area chart */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>Volume de transactions</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  className="cw-chip"
                  onClick={() => setPeriod(p.key)}
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
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="gradVol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.green} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={11} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={v => (v / 1000000).toFixed(0) + 'M'} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="volume" stroke={C.green} strokeWidth={2} fill="url(#gradVol)" name="Volume" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Donut */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Répartition des types</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <PieChart width={130} height={130}>
              <Pie data={donut} cx={60} cy={60} innerRadius={40} outerRadius={60} dataKey="value" paddingAngle={2}>
                {donut.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
            </PieChart>
            <div style={{ flex: 1 }}>
              {donut.length === 0 && <span style={{ fontSize: 12, color: C.textMuted }}>Aucune transaction</span>}
              {donut.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, color: C.textSoft }}>{d.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue & Users row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Revenue bar */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Revenus (frais perçus) par jour</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chart} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={10} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="fees" fill={C.green} radius={[3, 3, 0, 0]} name="Frais" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* User growth */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Activité (utilisateurs &amp; transactions)</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={10} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="users" stroke={C.purple} strokeWidth={2} dot={{ fill: C.purple, r: 3 }} name="Utilisateurs" />
              <Line type="monotone" dataKey="tx" stroke={C.blue} strokeWidth={2} strokeDasharray="4 2" dot={{ fill: C.blue, r: 3 }} name="Transactions" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent transactions */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>Transactions récentes</h3>
          <button className="cw-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.green, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Voir tout <ArrowRight size={14} />
          </button>
        </div>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Réf.', 'Type', 'De', 'À', 'Montant', 'Statut', 'Date'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(tx => (
              <tr key={tx.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '10px 12px', color: C.textSoft, fontFamily: 'monospace', fontSize: 12 }}>{tx.reference}</td>
                <td style={{ padding: '10px 12px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.sender, 'Opérateur')}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.receiver, 'Opérateur')}</td>
                <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{fmt(toFcfa(tx.amount))}</td>
                <td style={{ padding: '10px 12px' }}><StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} /></td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 12 }}>{fmtDate(tx.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {(recentLoading || recentError || recent.length === 0) && (
          <StateRow loading={recentLoading} error={recentError} empty={!recentLoading && !recentError ? 'Aucune transaction' : undefined} />
        )}
      </div>

      {/* Widget santé intégrations */}
      <HealthWidget />
    </div>
  )
}

function HealthWidget() {
  const { data, loading, error } = useFetch(getHealthIntegrations, [])
  const integrations = data?.integrations ?? []

  const dot = (status: string) => {
    if (status === 'UP') return C.green
    if (status === 'DOWN') return C.red
    if (status === 'SIMULATED') return C.yellow
    return C.textMuted
  }
  const label = (status: string) => {
    if (status === 'UP') return 'Opérationnel'
    if (status === 'DOWN') return 'Hors ligne'
    if (status === 'SIMULATED') return 'Simulé'
    return 'Inconnu'
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Activity size={16} color={C.green} />
        <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>Santé des intégrations</span>
        {data?.checkedAt && (
          <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}>
            Vérifié le {fmtDate(data.checkedAt)}
          </span>
        )}
      </div>
      {loading && <StateRow loading error={null} />}
      {error && <div style={{ color: C.red, fontSize: 12 }}>{error}</div>}
      {integrations.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {integrations.map(i => (
            <div key={i.name} style={{ background: C.surface, border: `1px solid ${dot(i.status)}30`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: dot(i.status), flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{i.name}</span>
              </div>
              <div style={{ fontSize: 12, color: dot(i.status), fontWeight: 600, marginBottom: 4 }}>{label(i.status)}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>{i.txCount24h} tx / 24h</div>
              {i.note && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontStyle: 'italic' }}>{i.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AlertsPage() {
  const { data, loading, error } = useFetch(() => getAlerts(), [])
  const alerts = data?.alerts ?? []
  const flagged = data?.flagged ?? []

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Alertes & Surveillance</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{alerts.length} alerte(s) active(s) — données en temps réel</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Alert cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {alerts.map(a => {
          const cfg = {
            error: { bg: C.redLight, border: C.red, icon: Siren },
            warn: { bg: C.yellowLight, border: C.yellow, icon: AlertTriangle },
            info: { bg: C.blueLight, border: C.blue, icon: Info },
          }[a.type] ?? { bg: '#333', border: '#888', icon: Info }
          const AlertIcon = cfg.icon
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: cfg.bg, borderLeft: `3px solid ${cfg.border}`, borderRadius: 12, padding: '14px 16px' }}>
              <AlertIcon size={18} color={cfg.border} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{a.title}</div>
                <div style={{ color: C.textSoft, fontSize: 12 }}>{a.desc}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Flagged transactions (échecs + gros montants, 7 derniers jours) */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
          <AlertTriangle size={16} color={C.yellow} /> Transactions signalées
        </h3>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Réf.', 'Type', 'Montant', 'De', 'À', 'Statut', 'Date'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flagged.map(tx => (
              <tr key={tx.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '10px 12px', color: C.textSoft, fontFamily: 'monospace', fontSize: 12 }}>{tx.reference}</td>
                <td style={{ padding: '10px 12px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                <td style={{ padding: '10px 12px', color: C.yellow, fontWeight: 700 }}>{fmt(toFcfa(tx.amount))}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.sender, 'Opérateur')}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{partyLabel(tx.receiver, 'Opérateur')}</td>
                <td style={{ padding: '10px 12px' }}><StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} /></td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 12 }}>{fmtDate(tx.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && !error && flagged.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: C.textMuted }}>Aucune transaction signalée</div>
        )}
      </div>
    </div>
  )
}

// ── Vue détail utilisateur (modal) ────────────────────────
function UserDetailModal({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, refetch } = useFetch(() => getUserDetail(userId), [userId])
  const [acting, setActing] = useState(false)
  const toast = useToast()
  const u = data?.user

  const run = async (fn: () => Promise<unknown>, okMsg = 'Action effectuée') => {
    setActing(true)
    try {
      await fn()
      refetch()
      onChanged()
      toast(okMsg, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action échouée', 'error')
    } finally {
      setActing(false)
    }
  }

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: '#000A', zIndex: 50,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto',
  }
  const panel: CSSProperties = {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16,
    width: 'min(820px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 24,
  }
  const label = (t: string) => <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{t}</div>
  const photo = (src: string, cap: string) => (
    <a href={src} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
      <img src={src} alt={cap} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}` }} />
      <div style={{ fontSize: 10, color: C.textMuted, textAlign: 'center', marginTop: 4 }}>{cap}</div>
    </a>
  )

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Détail utilisateur</h2>
          <button className="cw-iconbtn" onClick={onClose} aria-label="Fermer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 9, background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {(loading || error) && <StateRow loading={loading} error={error} />}

        {u && data && (
          <>
            {/* En-tête */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, overflow: 'hidden', background: C.green + '20', border: `2px solid ${C.green}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.green, flexShrink: 0 }}>
                {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(u.fullName)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 16 }}>{u.fullName ?? 'Sans nom'}</div>
                <div style={{ color: C.textSoft, fontFamily: 'monospace', fontSize: 13 }}>{u.phone}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <StatusBadge status={USER_STATUS_BADGE[u.status] ?? u.status} />
                  <StatusBadge status={KYC_STATUS_BADGE[u.kycStatus] ?? u.kycStatus} />
                </div>
              </div>
            </div>

            {/* Infos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div>{label('Email')}<span style={{ color: C.text, fontSize: 13 }}>{u.email ?? '—'}</span></div>
              <div>{label('Ville')}<span style={{ color: C.text, fontSize: 13 }}>{u.city ?? '—'}</span></div>
              <div>{label('Naissance')}<span style={{ color: C.text, fontSize: 13 }}>{u.dateOfBirth ? fmtDate(u.dateOfBirth) : '—'}</span></div>
              <div>{label('Solde')}<span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>{fmt(toFcfa(u.wallet?.balance ?? 0))}</span></div>
              <div>{label('Dernière connexion')}<span style={{ color: C.text, fontSize: 13 }}>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</span></div>
              <div>{label('Inscrit le')}<span style={{ color: C.text, fontSize: 13 }}>{fmtDate(u.createdAt)}</span></div>
              <div>{label('Transactions')}<span style={{ color: C.text, fontSize: 13 }}>{data.stats.transactionsCount}</span></div>
              <div>{label('Total envoyé')}<span style={{ color: C.text, fontSize: 13 }}>{fmt(toFcfa(data.stats.totalSent))}</span></div>
              <div>{label('Total reçu')}<span style={{ color: C.text, fontSize: 13 }}>{fmt(toFcfa(data.stats.totalReceived))}</span></div>
              {data.stats.monthlyVolume !== undefined && (
                <div>{label('Volume 30j')}<span style={{ color: C.text, fontSize: 13 }}>{fmt(toFcfa(data.stats.monthlyVolume))}</span></div>
              )}
              {data.stats.anifRisk && (
                <div>{label('Score ANIF')}<span style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: data.stats.anifRisk === 'Élevé' ? C.red : data.stats.anifRisk === 'Moyen' ? C.yellow : C.green,
                }}>{data.stats.anifRisk}</span></div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {u.role !== 'ADMIN' && (u.status === 'LOCKED' ? (
                <button className="cw-btn" disabled={acting} onClick={() => run(() => setUserStatus(u.id, 'ACTIVE'), 'Compte débloqué')}
                  style={{ fontSize: 12, color: C.green, background: C.greenLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>Débloquer</button>
              ) : (
                <button className="cw-btn" disabled={acting} onClick={() => run(() => setUserStatus(u.id, 'LOCKED'), 'Compte bloqué')}
                  style={{ fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>Bloquer</button>
              ))}
              <button className="cw-btn" disabled={acting} onClick={() => { if (confirm('Forcer la réinitialisation du PIN ?')) run(() => resetUserPin(u.id), 'PIN réinitialisé') }}
                style={{ fontSize: 12, color: C.yellow, background: C.yellowLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>Réinitialiser le PIN</button>
              {['PENDING', 'SUBMITTED'].includes(u.kycStatus) && (
                <>
                  <button className="cw-btn" disabled={acting} onClick={() => run(() => reviewKyc(u.id, 'APPROVED'), 'KYC approuvé')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}><Check size={14} /> Approuver KYC</button>
                  <button className="cw-btn" disabled={acting} onClick={() => run(() => reviewKyc(u.id, 'REJECTED'), 'KYC rejeté')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}><X size={14} /> Rejeter KYC</button>
                </>
              )}
            </div>

            {/* Document KYC */}
            <h3 style={{ color: C.text, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Document KYC</h3>
            {u.kycDocument ? (
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {photo(u.kycDocument.idFrontUrl, 'CNI recto')}
                {photo(u.kycDocument.idBackUrl, 'CNI verso')}
                {photo(u.kycDocument.selfieUrl, 'Selfie')}
              </div>
            ) : (
              <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 20 }}>Aucun document soumis</div>
            )}

            {/* Transactions */}
            <h3 style={{ color: C.text, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Transactions récentes</h3>
            <div style={{ marginBottom: 20 }}>
              {data.transactions.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>Aucune transaction</div>}
              {data.transactions.map((tx) => (
                <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} />
                    <span style={{ color: C.textSoft }}>{partyLabel(tx.sender, 'Opérateur')} → {partyLabel(tx.receiver, 'Opérateur')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} />
                    <span style={{ color: C.text, fontWeight: 600 }}>{fmt(toFcfa(tx.amount))}</span>
                    <span style={{ color: C.textMuted }}>{fmtDate(tx.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Audit */}
            <h3 style={{ color: C.text, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Journal d'audit</h3>
            <div>
              {data.audit.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>Aucune action enregistrée</div>}
              {data.audit.map((a) => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textSoft }}>{a.action}{a.metadata?.note ? ` — ${a.metadata.note}` : ''}</span>
                  <span style={{ color: C.textMuted }}>{(a.user?.email ?? 'admin')} · {fmtDate(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function UsersPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const debouncedSearch = useDebounced(search.trim(), 350)

  // Recherche + filtre statut côté serveur.
  const { data, loading, error, refetch } = useFetch(
    () => getUsers({ limit: 50, search: debouncedSearch || undefined, status: USER_STATUS_FILTER[filter] }),
    [debouncedSearch, filter],
  )
  const users = data?.data ?? []
  const total = data?.meta.total ?? 0

  const [acting, setActing] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const toast = useToast()
  // Tri client sur les lignes chargées.
  const [sort, setSort] = useState<{ key: 'balance' | 'createdAt'; dir: 1 | -1 } | null>(null)
  const sortedUsers = useMemo(() => {
    if (!sort) return users
    const v = (u: typeof users[number]) =>
      sort.key === 'balance' ? Number(u.wallet?.balance ?? 0) : new Date(u.createdAt).getTime()
    return [...users].sort((a, b) => (v(a) - v(b)) * sort.dir)
  }, [users, sort])
  const toggleSort = (key: 'balance' | 'createdAt') =>
    setSort((s) => (s?.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  // Bloquer / réactiver un compte (action tracée côté backend dans l'AuditLog).
  const toggleBlock = async (u: { id: string; status: string }) => {
    setActing(u.id)
    try {
      await setUserStatus(u.id, u.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED')
      refetch()
      toast(u.status === 'LOCKED' ? 'Compte débloqué' : 'Compte bloqué', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action échouée', 'error')
    } finally {
      setActing(null)
    }
  }

  const FILTERS: { key: string; label: string }[] = [
    { key: 'all', label: 'Tous' },
    { key: 'verified', label: 'Actifs' },
    { key: 'suspended', label: 'Suspendus' },
    { key: 'blocked', label: 'Bloqués' },
  ]

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Utilisateurs</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{total} utilisateur{total > 1 ? 's' : ''} enregistré{total > 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', flex: 1, minWidth: 200 }}>
          <Search size={16} color={C.textMuted} style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher (nom ou téléphone)…"
            aria-label="Rechercher un utilisateur"
            style={{ background: 'none', border: 'none', color: C.text, fontSize: 13, flex: 1, outline: 'none' }}
          />
        </div>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className="cw-chip"
            onClick={() => setFilter(f.key)}
            style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontWeight: filter === f.key ? 700 : 500,
              background: filter === f.key ? C.green : C.card,
              border: `1px solid ${filter === f.key ? C.green : C.border}`,
              color: filter === f.key ? '#fff' : C.textSoft,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: C.surface }}>
            <tr>
              {([
                { h: 'Utilisateur' }, { h: 'Téléphone' }, { h: 'Solde', sk: 'balance' as const },
                { h: 'Statut' }, { h: 'KYC' }, { h: 'Inscrit', sk: 'createdAt' as const }, { h: 'Actions' },
              ]).map(({ h, sk }) => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>
                  {sk ? (
                    <button className="cw-link" onClick={() => toggleSort(sk)} aria-label={`Trier par ${h}`}
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
                      <div style={{ color: C.text, fontWeight: 600 }}>{u.fullName ?? 'Sans nom'}</div>
                      <div style={{ color: C.textMuted, fontSize: 11 }}>{u.email ?? `ID: ${u.id.slice(0, 8)}`}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 14px', color: C.textSoft, fontFamily: 'monospace' }}>{u.phone}</td>
                <td style={{ padding: '12px 14px', color: C.text, fontWeight: 600 }}>{toFcfa(u.wallet?.balance ?? 0).toLocaleString('fr-FR')}</td>
                <td style={{ padding: '12px 14px' }}><StatusBadge status={USER_STATUS_BADGE[u.status] ?? u.status} /></td>
                <td style={{ padding: '12px 14px' }}><StatusBadge status={KYC_STATUS_BADGE[u.kycStatus] ?? u.kycStatus} /></td>
                <td style={{ padding: '12px 14px', color: C.textMuted, fontSize: 12 }}>{fmtDate(u.createdAt)}</td>
                <td style={{ padding: '12px 14px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="cw-btn" onClick={() => setSelected(u.id)}
                      style={{ fontSize: 11, color: C.blue, background: C.blueLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                      Détails
                    </button>
                    {u.role === 'ADMIN' ? null : u.status === 'LOCKED' ? (
                      <button className="cw-btn" onClick={() => toggleBlock(u)} disabled={acting === u.id}
                        style={{ fontSize: 11, color: C.green, background: C.greenLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: acting === u.id ? 'wait' : 'pointer', fontWeight: 600 }}>
                        Débloquer
                      </button>
                    ) : (
                      <button className="cw-btn" onClick={() => toggleBlock(u)} disabled={acting === u.id}
                        style={{ fontSize: 11, color: C.red, background: C.redLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: acting === u.id ? 'wait' : 'pointer', fontWeight: 600 }}>
                        Bloquer
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && !error && users.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Aucun utilisateur trouvé</div>
        )}
        <StateRow loading={loading} error={error} />
      </div>

      {selected && (
        <UserDetailModal userId={selected} onClose={() => setSelected(null)} onChanged={refetch} />
      )}
    </div>
  )
}

function KYCPage() {
  const { data, loading, error, refetch } = useFetch(() => getKyc(), [])
  const queue = data?.pending ?? []
  const counts = data?.counts ?? { pending: 0, approved30: 0, rejected30: 0 }
  const [acting, setActing] = useState<string | null>(null)
  const toast = useToast()

  const decide = async (userId: string, decision: 'APPROVED' | 'REJECTED') => {
    setActing(userId)
    try {
      await reviewKyc(userId, decision)
      refetch()
      toast(decision === 'APPROVED' ? 'KYC approuvé' : 'KYC rejeté', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action échouée', 'error')
    } finally {
      setActing(null)
    }
  }

  const stats: { label: string; value: number; color: string; icon: LucideIcon }[] = [
    { label: 'En attente', value: counts.pending, color: C.yellow, icon: Clock },
    { label: 'Approuvés (30j)', value: counts.approved30, color: C.green, icon: CheckCircle2 },
    { label: 'Rejetés (30j)', value: counts.rejected30, color: C.red, icon: XCircle },
  ]

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Vérification KYC</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{counts.pending} demande(s) en attente</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stats.map(s => {
          const Icon = s.icon
          return (
          <div key={s.label} className="cw-card" style={{ background: `linear-gradient(140deg, ${s.color}12 0%, ${C.card} 55%)`, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: s.color + '1F', color: s.color }}><Icon size={16} /></span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</div>
          </div>
          )
        })}
      </div>

      {/* Queue */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {queue.map(k => (
          <div key={k.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 24, background: C.blue + '20', border: `2px solid ${C.blue}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: C.blue }}>
                  {initials(k.fullName)}
                </div>
                <div>
                  <div style={{ color: C.text, fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{k.fullName ?? 'Sans nom'}</div>
                  <div style={{ color: C.textMuted, fontSize: 12 }}>{k.phone} · Inscrit le {fmtDate(k.createdAt)}</div>
                  {k.kycDocument && <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.blue, fontSize: 12, marginTop: 3, fontWeight: 600 }}><FileText size={13} /> Document soumis le {fmtDate(k.kycDocument.submittedAt)}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={KYC_STATUS_BADGE[k.kycStatus] ?? k.kycStatus} />
                <button className="cw-btn" onClick={() => decide(k.id, 'APPROVED')} disabled={acting === k.id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: acting === k.id ? 'wait' : 'pointer', fontWeight: 700 }}>
                  <Check size={14} /> Approuver
                </button>
                <button className="cw-btn" onClick={() => decide(k.id, 'REJECTED')} disabled={acting === k.id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: acting === k.id ? 'wait' : 'pointer', fontWeight: 700 }}>
                  <X size={14} /> Rejeter
                </button>
              </div>
            </div>

            {/* Prévisualisation des photos KYC */}
            {k.kycDocument ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {([['idFrontUrl', 'CNI recto'], ['idBackUrl', 'CNI verso'], ['selfieUrl', 'Selfie']] as const).map(([key, cap]) => (
                  <a key={key} href={k.kycDocument![key]} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                    <img src={k.kycDocument![key]} alt={cap}
                      style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}` }} />
                    <div style={{ fontSize: 10, color: C.textMuted, textAlign: 'center', marginTop: 4 }}>{cap}</div>
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ color: C.textMuted, fontSize: 12, marginTop: 10 }}>Aucun document soumis</div>
            )}
          </div>
        ))}
        {!loading && !error && queue.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Aucune demande KYC en attente</div>
        )}
      </div>
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
      <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Taux de succès par opérateur</h3>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} barSize={36}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="name" stroke={C.textMuted} fontSize={12} />
          <YAxis stroke={C.textMuted} fontSize={11} domain={[0, 100]} tickFormatter={v => v + '%'} />
          <Tooltip content={<ChartTooltip />} formatter={(v: number) => v + '%'} />
          <Bar dataKey="taux" name="Taux de succès" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function TransactionsPage() {
  const [txFilter, setTxFilter] = useState('all')

  const { data, loading, error } = useFetch(
    () => getTransactions({ limit: 50, type: txFilter === 'all' ? undefined : TX_TYPE_FILTER[txFilter] }),
    [txFilter],
  )
  const txs = data?.data ?? []
  const total = data?.meta.total ?? 0

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Transactions</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{total} transaction{total > 1 ? 's' : ''} au total</p>
        </div>
      </div>

      {/* Type filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'P2P', 'QR', 'RECHARGE', 'RETRAIT'].map(f => (
          <button
            key={f}
            className="cw-chip"
            onClick={() => setTxFilter(f)}
            style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              background: txFilter === f ? C.green : C.card,
              border: `1px solid ${txFilter === f ? C.green : C.border}`,
              color: txFilter === f ? '#fff' : C.textSoft, fontWeight: txFilter === f ? 700 : 500,
            }}
          >
            {f === 'all' ? 'Toutes' : f}
          </button>
        ))}
      </div>

      {/* Widget taux de succès par opérateur */}
      <OperatorRatesWidget />

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
        <table style={{ width: '100%', minWidth: 780, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: C.surface }}>
            <tr>
              {['Réf.', 'Type', 'De', 'À', 'Montant', 'Frais', 'Statut', 'Date'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.map(tx => (
              <tr key={tx.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '11px 14px', color: C.textSoft, fontFamily: 'monospace', fontSize: 12 }}>{tx.reference}</td>
                <td style={{ padding: '11px 14px' }}><TxTypeBadge type={TX_TYPE_LABEL[tx.type] ?? tx.type} /></td>
                <td style={{ padding: '11px 14px', color: C.text }}>{partyLabel(tx.sender, 'Opérateur')}</td>
                <td style={{ padding: '11px 14px', color: C.text }}>{partyLabel(tx.receiver, 'Opérateur')}</td>
                <td style={{ padding: '11px 14px', color: C.text, fontWeight: 700 }}>{fmt(toFcfa(tx.amount))}</td>
                <td style={{ padding: '11px 14px', color: C.textMuted }}>{fmt(toFcfa(tx.fee))}</td>
                <td style={{ padding: '11px 14px' }}><StatusBadge status={TX_STATUS_BADGE[tx.status] ?? tx.status} /></td>
                <td style={{ padding: '11px 14px', color: C.textMuted, fontSize: 12 }}>{fmtDate(tx.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && !error && txs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Aucune transaction</div>
        )}
        <StateRow loading={loading} error={error} />
      </div>
    </div>
  )
}

function FinancePage() {
  const { data: stats, loading, error } = useFetch(() => getStats(), [])

  const byType = (stats?.transactions.byType ?? []).map((t) => ({
    name: TX_TYPE_LABEL[t.type] ?? t.type,
    volume: toFcfa(t.volume),
    count: t.count,
    color: TX_TYPE_COLOR[t.type] ?? C.textMuted,
  }))

  const kpis: { label: string; value: string; icon: LucideIcon; color: string; trend?: number | null }[] = stats
    ? [
        { label: 'Frais perçus', value: fmt(toFcfa(stats.volume.collectedFees)), icon: Wallet, color: C.green },
        { label: 'Volume complété', value: fmt(toFcfa(stats.volume.completedAmount)), icon: TrendingUp, color: C.blue, trend: stats.trends.volume },
        { label: 'Solde plateforme', value: fmt(toFcfa(stats.totalBalance)), icon: Landmark, color: C.purple },
        { label: 'Transactions', value: stats.transactions.total.toLocaleString('fr-FR'), icon: Zap, color: C.yellow, trend: stats.trends.transactions },
      ]
    : []

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Finances & Revenus</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>Données en temps réel — API CamWallet</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* KPIs financiers (réels) */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 24 }}>
          {kpis.map((s) => (
            <KPICard key={s.label} label={s.label} value={s.value} icon={s.icon} color={s.color} {...trendProps(s.trend)} />
          ))}
        </div>
      )}

      {/* Volume par type de transaction (réel) */}
      {stats && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 20 }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Volume par type de transaction</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byType}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" stroke={C.textMuted} fontSize={11} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k')} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="volume" name="Volume" radius={[4, 4, 0, 0]}>
                {byType.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Détail par type (réel) */}
      {stats && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Détail par type</h3>
          {byType.length === 0 && <div style={{ color: C.textMuted, fontSize: 13 }}>Aucune transaction</div>}
          {byType.map((d) => (
            <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                <span style={{ color: C.textMuted, fontSize: 12 }}>· {d.count} tx</span>
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
  const statusLabel = wh.processed ? 'Traité' : wh.error ? 'Erreur' : 'En attente'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        <button
          onClick={() => setOpen(v => !v)}
          title="Voir payload"
          style={{ fontSize: 10, background: C.border, color: C.textMuted, border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
        >
          {open ? '▲ payload' : '▼ payload'}
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

function OperationsPage() {
  const [page, setPage] = useState(1)
  const [operator, setOperator] = useState('')
  const [activeTab, setActiveTab] = useState<'ops' | 'webhooks'>('ops')
  const showToast = useContext(ToastContext)
  const { data, loading, error, refetch } = useFetch(
    () => getOperations(page, 20, operator || undefined),
    [page, operator],
  )

  const handleRetry = async (id: string) => {
    try {
      await retryOperation(id)
      showToast('Opération relancée')
      refetch()
    } catch {
      showToast('Échec de la relance', 'error')
    }
  }

  const ops = data?.data ?? []
  const webhooks = data?.webhookEvents ?? []
  const stats = data?.stats

  const txStatusColor = (s: string) =>
    s === 'COMPLETED' ? C.green : s === 'PENDING' || s === 'PROCESSING' ? C.yellow : C.red

  const opLabel = (type: string) => (type === 'ORANGE_MONEY' ? 'Orange Money' : type === 'MTN_MOMO' ? 'MTN MoMo' : type ?? '—')

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Recharges 7j', value: fmt(toFcfa(stats?.rechargeTotal ?? 0)), sub: `${stats?.rechargeCount ?? 0} op.`, color: C.green },
          { label: 'Retraits 7j', value: fmt(toFcfa(stats?.withdrawalTotal ?? 0)), sub: `${stats?.withdrawalCount ?? 0} op.`, color: C.purple },
          { label: 'Webhooks en attente', value: String(stats?.pendingWebhooks ?? 0), sub: 'non traités', color: (stats?.pendingWebhooks ?? 0) > 0 ? C.red : C.green },
        ].map(k => (
          <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 20px', minWidth: 160 }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <select
          value={operator}
          onChange={e => { setOperator(e.target.value); setPage(1) }}
          style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, alignSelf: 'flex-start' }}
        >
          <option value="">Tous les opérateurs</option>
          <option value="ORANGE_MONEY">Orange Money</option>
          <option value="MTN_MOMO">MTN MoMo</option>
        </select>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
        {(['ops', 'webhooks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              padding: '8px 16px', color: activeTab === t ? C.green : C.textMuted,
              borderBottom: activeTab === t ? `2px solid ${C.green}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'ops' ? `Opérations (${data?.total ?? 0})` : `Callbacks webhook (${webhooks.length})`}
          </button>
        ))}
      </div>

      <StateRow loading={loading} error={error} />

      {activeTab === 'ops' && (
        <>
          {ops.length === 0 && !loading && !error && (
            <StateRow empty="Aucune opération" />
          )}
          {ops.length > 0 && (
            <div className="cw-tablewrap">
              <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Date', 'Type', 'Utilisateur', 'Montant', 'Opérateur', 'Statut', 'Ref. opérateur', 'Tentatives', 'Action'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: C.textMuted, fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ops.map(op => (
                    <tr key={op.id} style={{ borderBottom: `1px solid ${C.border}20` }}>
                      <td style={{ padding: '9px 10px', color: C.textMuted, whiteSpace: 'nowrap' }}>{fmtDate(op.createdAt)}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: op.type === 'RECHARGE' ? C.yellow + '20' : C.purple + '20', color: op.type === 'RECHARGE' ? C.yellow : C.purple, padding: '2px 8px', borderRadius: 6 }}>
                          {op.type === 'RECHARGE' ? 'Recharge' : 'Retrait'}
                        </span>
                      </td>
                      <td style={{ padding: '9px 10px', color: C.text }}>{partyLabel(op.sender, '—')}</td>
                      <td style={{ padding: '9px 10px', fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{fmt(toFcfa(op.amount))}</td>
                      <td style={{ padding: '9px 10px', color: C.textMuted, fontSize: 11 }}>{opLabel(op.operator ?? '')}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: txStatusColor(op.status) }}>{op.status}</span>
                      </td>
                      <td style={{ padding: '9px 10px', color: C.textMuted, fontSize: 11, fontFamily: 'monospace' }}>{op.operatorRef ?? '—'}</td>
                      <td style={{ padding: '9px 10px', color: op.retryCount > 0 ? C.yellow : C.textMuted, textAlign: 'center' }}>{op.retryCount}</td>
                      <td style={{ padding: '9px 10px' }}>
                        {op.status === 'PENDING' && (
                          <button
                            onClick={() => handleRetry(op.id)}
                            style={{ fontSize: 11, background: C.yellow + '20', color: C.yellow, border: `1px solid ${C.yellow}40`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            ↺ Relancer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data?.total ?? 0) > 20 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '6px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', color: C.textSoft, cursor: 'pointer' }}>Préc.</button>
              <span style={{ color: C.textMuted, fontSize: 13, alignSelf: 'center' }}>Page {page} · {data?.total} opérations</span>
              <button disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', color: C.textSoft, cursor: 'pointer' }}>Suiv.</button>
            </div>
          )}
        </>
      )}

      {activeTab === 'webhooks' && (
        <>
          {webhooks.length === 0 && !loading && <StateRow empty="Aucun événement webhook" />}
          {webhooks.length > 0 && (
            <div className="cw-tablewrap">
              <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Date réception', 'Opérateur', 'Événement', 'Statut / Payload'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: C.textMuted, fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map(wh => (
                    <tr key={wh.id} style={{ borderBottom: `1px solid ${C.border}20`, verticalAlign: 'top' }}>
                      <td style={{ padding: '9px 10px', color: C.textMuted, whiteSpace: 'nowrap' }}>{fmtDate(wh.createdAt)}</td>
                      <td style={{ padding: '9px 10px', color: C.text }}>{opLabel(wh.operator)}</td>
                      <td style={{ padding: '9px 10px', color: C.textMuted, fontFamily: 'monospace', fontSize: 11 }}>{wh.eventType}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <WebhookPayloadCell wh={wh} />
                        {wh.processedAt && (
                          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>Traité le {fmtDate(wh.processedAt)}</div>
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
    </div>
  )
}

// ── Page : Conformité ANIF ────────────────────────────────
function ANIFPage() {
  const { data, loading, error, refetch } = useFetch(getAnifAlerts, [])
  const showToast = useContext(ToastContext)
  const [openingCase, setOpeningCase] = useState<string | null>(null)
  const [caseReason, setCaseReason] = useState('')
  const [closingId, setClosingId] = useState<string | null>(null)
  const [resolutionText, setResolutionText] = useState('')

  const handleOpenCase = async (txId: string) => {
    if (!caseReason.trim()) {
      showToast('Saisissez un motif', 'error')
      return
    }
    try {
      await openAnifCase(txId, caseReason)
      showToast('Dossier ANIF ouvert')
      setOpeningCase(null)
      setCaseReason('')
      refetch()
    } catch {
      showToast('Échec ouverture dossier', 'error')
    }
  }

  const handleCloseCase = async (caseId: string) => {
    if (!resolutionText.trim()) {
      showToast('Saisissez une résolution', 'error')
      return
    }
    try {
      await closeAnifCase(caseId, resolutionText)
      showToast('Dossier clôturé')
      setClosingId(null)
      setResolutionText('')
      refetch()
    } catch {
      showToast('Échec clôture dossier', 'error')
    }
  }

  const highValue = data?.highValue ?? []
  const frequent = data?.frequentSenders ?? []
  const cases = data?.cases ?? []

  const THRESHOLD_FCFA = 500_000

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      {/* En-tête */}
      <div style={{ background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 12, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldAlert size={20} color={C.red} />
        <div>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Conformité ANIF — Lutte anti-blanchiment</div>
          <div style={{ color: C.textMuted, fontSize: 12 }}>Seuil de déclaration : {THRESHOLD_FCFA.toLocaleString('fr-FR')} FCFA · Données des 30 derniers jours</div>
        </div>
      </div>

      <StateRow loading={loading} error={error} />

      {/* Transactions à montant élevé */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontWeight: 700, color: C.text, fontSize: 14, marginBottom: 10 }}>
          Transactions &gt; {THRESHOLD_FCFA.toLocaleString('fr-FR')} FCFA ({highValue.length})
        </div>
        {highValue.length === 0 && !loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Aucune transaction au-dessus du seuil.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Date', 'Expéditeur', 'Bénéficiaire', 'Montant', 'Type', 'Statut', 'Action'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {highValue.map(tx => (
                <tr key={tx.id} style={{ borderBottom: `1px solid ${C.border}20` }}>
                  <td style={{ padding: '8px 10px', color: C.textMuted }}>{fmtDate(tx.createdAt)}</td>
                  <td style={{ padding: '8px 10px', color: C.text }}>{partyLabel(tx.sender, '—')}</td>
                  <td style={{ padding: '8px 10px', color: C.text }}>{partyLabel(tx.receiver, '—')}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 800, color: C.red }}>{fmt(toFcfa(tx.amount))}</td>
                  <td style={{ padding: '8px 10px', color: C.textMuted }}>{tx.type}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ color: tx.status === 'COMPLETED' ? C.green : C.yellow, fontWeight: 600, fontSize: 11 }}>{tx.status}</span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {openingCase === tx.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          autoFocus
                          value={caseReason}
                          onChange={e => setCaseReason(e.target.value)}
                          placeholder="Motif..."
                          style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
                        />
                        <button onClick={() => handleOpenCase(tx.id)} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>OK</button>
                        <button onClick={() => setOpeningCase(null)} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setOpeningCase(tx.id)}
                        style={{ fontSize: 11, background: C.red + '15', color: C.red, border: `1px solid ${C.red}40`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                      >
                        Ouvrir dossier
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Émetteurs fréquents */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontWeight: 700, color: C.text, fontSize: 14, marginBottom: 10 }}>
          Émetteurs fréquents (&gt; 10 tx / 24h) ({frequent.length})
        </div>
        {frequent.length === 0 && !loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Aucun comportement anormal détecté.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {frequent.map(s => (
              <div key={s.senderId} style={{ background: C.card, border: `1px solid ${C.yellow}30`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <AlertTriangle size={18} color={C.yellow} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.text, fontWeight: 700 }}>{s.fullName ?? s.phone}</div>
                  <div style={{ color: C.textMuted, fontSize: 12 }}>{s.phone}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: C.yellow, fontWeight: 800 }}>{s.count} transactions / 24h</div>
                  <div style={{ color: C.textMuted, fontSize: 12 }}>Total : {fmt(toFcfa(s.totalAmount))}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dossiers ouverts */}
      <div>
        <div style={{ fontWeight: 700, color: C.text, fontSize: 14, marginBottom: 10 }}>
          Dossiers d'enquête ouverts ({cases.length})
        </div>
        {cases.length === 0 && !loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Aucun dossier ouvert.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cases.map(c => (
              <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{c.action}</div>
                    <div style={{ color: C.textMuted, fontSize: 12, marginTop: 3 }}>{c.details}</div>
                    {c.user && <div style={{ color: C.textSoft, fontSize: 11, marginTop: 4 }}>{c.user.fullName ?? c.user.phone}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                    <div style={{ color: C.textMuted, fontSize: 11 }}>{fmtDate(c.createdAt)}</div>
                    {closingId === c.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          autoFocus
                          value={resolutionText}
                          onChange={e => setResolutionText(e.target.value)}
                          placeholder="Résolution..."
                          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '4px 8px', fontSize: 12, width: 180 }}
                        />
                        <button onClick={() => handleCloseCase(c.id)} style={{ background: C.green, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Confirmer</button>
                        <button onClick={() => { setClosingId(null); setResolutionText('') }} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setClosingId(c.id); setResolutionText('') }}
                        style={{ fontSize: 11, background: C.green + '15', color: C.green, border: `1px solid ${C.green}40`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                      >
                        Clôturer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AuditPage() {
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [resource, setResource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filterParams, setFilterParams] = useState<{ action?: string; actorId?: string; resource?: string; from?: string; to?: string }>({})

  const { data, loading, error } = useFetch(() => getAudit(filterParams), [filterParams])
  const entries = data ?? []

  const applyFilters = () => {
    setFilterParams({
      action: action.trim() || undefined,
      actorId: actorId.trim() || undefined,
      resource: resource.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    })
  }

  const inputStyle: CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, color: C.text,
    borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none',
  }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Journal d'audit</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{entries.length} entrée(s) — traçabilité des actions admin</p>
      </div>

      {/* Filtres */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Action</label>
            <input value={action} onChange={e => setAction(e.target.value)} placeholder="ex: USER_BLOCKED" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>ID Acteur</label>
            <input value={actorId} onChange={e => setActorId(e.target.value)} placeholder="UUID acteur" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Ressource</label>
            <input value={resource} onChange={e => setResource(e.target.value)} placeholder="ex: User" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Du</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Au</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
          </div>
          <button
            onClick={applyFilters}
            style={{ padding: '7px 18px', background: C.green, border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Filtrer
          </button>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="cw-tablewrap">
          <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>
                {['Date', 'Acteur', 'Action', 'Ressource', 'Détails'].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="cw-row" style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(e.createdAt)}</td>
                  <td style={{ padding: '10px 14px', color: C.text, fontSize: 12 }}>{e.user?.email ?? e.user?.fullName ?? 'Système'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, background: C.blue + '20', color: C.blue, padding: '2px 8px', borderRadius: 6 }}>{e.action}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.textSoft, fontSize: 12 }}>{e.resource ?? '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 11 }}>
                    {e.metadata ? JSON.stringify(e.metadata).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(loading || error || entries.length === 0) && (
          <StateRow loading={loading} error={error} empty={!loading && !error ? 'Aucune entrée d\'audit' : undefined} />
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

  // Initialise le formulaire dès que les données arrivent
  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const fields: { key: string; label: string }[] = [
    { key: 'daily_limit_fcfa', label: 'Limite journalière (FCFA)' },
    { key: 'monthly_limit_fcfa', label: 'Limite mensuelle (FCFA)' },
    { key: 'p2p_fee_rate', label: 'Taux frais P2P (%)' },
    { key: 'session_duration_minutes', label: 'Durée session (minutes)' },
    { key: 'anif_threshold_fcfa', label: 'Seuil déclaration ANIF (FCFA)' },
  ]

  const handleSave = async () => {
    try {
      await updateSettings(form)
      setSaved(true)
      showToast('Paramètres sauvegardés', 'success')
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde', 'error')
    }
  }

  const inputStyle: CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, color: C.text,
    borderRadius: 8, padding: '9px 12px', fontSize: 14, outline: 'none', width: '100%',
  }

  return (
    <div className="cw-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Paramètres système</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>Configuration globale de la plateforme CamWallet</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {!loading && (
        <>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
            <h3 style={{ color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Limites & Frais</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              {fields.map(f => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>{f.label}</label>
                  <input
                    value={form[f.key] ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={inputStyle}
                    placeholder="Non défini"
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={handleSave}
                style={{ padding: '9px 22px', background: C.green, border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                Sauvegarder
              </button>
              {saved && <span style={{ color: C.green, fontSize: 13, fontWeight: 600 }}>Paramètres sauvegardés</span>}
            </div>
          </div>

          {/* Section informative */}
          <div style={{ background: C.blueLight, border: `1px solid ${C.blue}30`, borderRadius: 14, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Info size={18} color={C.blue} />
              <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Credentials API</span>
            </div>
            <p style={{ color: C.textSoft, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              Les credentials API sont gérés via les variables d'environnement du serveur. Contactez l'administrateur système pour une rotation.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sidebar nav items ─────────────────────────────────────
const NAV: { id: string; label: string; icon: LucideIcon; group: string; badge?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, group: 'Vue générale' },
  { id: 'alerts', label: 'Alertes', icon: AlertTriangle, group: 'Vue générale' },
  { id: 'users', label: 'Utilisateurs', icon: UsersIcon, group: 'Utilisateurs' },
  { id: 'kyc', label: 'Vérification KYC', icon: ClipboardCheck, group: 'Utilisateurs' },
  { id: 'transactions', label: 'Transactions', icon: Zap, group: 'Finances' },
  { id: 'finance', label: 'Finances & Revenus', icon: Wallet, group: 'Finances' },
  { id: 'operations', label: 'Recharges & Retraits', icon: ArrowLeftRight, group: 'Finances' },
  { id: 'anif', label: 'Conformité ANIF', icon: ShieldAlert, group: 'Conformité' },
  { id: 'audit', label: 'Journal Audit', icon: FileText, group: 'Conformité' },
  { id: 'settings', label: 'Paramètres', icon: Settings, group: 'Conformité' },
]

const GROUPS = ['Vue générale', 'Utilisateurs', 'Finances', 'Conformité']

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(hasSession())
  const [activePage, setActivePage] = useState('dashboard')
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

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardPage />
      case 'alerts': return <AlertsPage />
      case 'users': return <UsersPage />
      case 'kyc': return <KYCPage />
      case 'transactions': return <TransactionsPage />
      case 'finance': return <FinancePage />
      case 'operations': return <OperationsPage />
      case 'anif': return <ANIFPage />
      case 'audit': return <AuditPage />
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
            <div style={{ fontSize: 11, color: C.textMuted }}>Admin Panel</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
          {GROUPS.map(group => (
            <div key={group}>
              <div className="cw-compact-hide" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', padding: '8px 8px 4px' }}>
                {group}
              </div>
              {NAV.filter(n => n.group === group).map(item => {
                const Icon = item.icon
                const active = activePage === item.id
                return (
                <button
                  key={item.id}
                  className="cw-nav-btn"
                  onClick={() => setActivePage(item.id)}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
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
                  <span className="cw-navlabel" style={{ flex: 1 }}>{item.label}</span>
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

        {/* Footer */}
        <div className="cw-compact-hide" style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted }}>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>Admin Système</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.green, display: 'inline-block' }} />
            <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>API opérationnelle</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
            {NAV.find(n => n.id === activePage)?.label ?? 'Dashboard'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="cw-btn"
              onClick={() => setRefreshNonce(n => n + 1)}
              aria-label="Actualiser les données"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'none', color: C.textSoft }}>
              <RefreshCw size={14} /> <span className="cw-topbar-label">Actualiser</span>
            </button>
            <button
              className="cw-btn"
              onClick={handleLogout}
              aria-label="Se déconnecter"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'none', color: C.textSoft }}>
              <LogOut size={14} /> <span className="cw-topbar-label">Déconnexion</span>
            </button>
            <div style={{ width: 34, height: 34, borderRadius: 17, background: C.green + '20', border: `2px solid ${C.green}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: C.green, flexShrink: 0 }}>
              A
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
