import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import LoginPage from './LoginPage'
import {
  hasSession, logout, toFcfa, SessionExpiredError,
  getStats, getUsers, getTransactions, getTimeseries,
  getKyc, getAlerts, getAudit, reviewKyc, setUserStatus,
  getUserDetail, resetUserPin,
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
  const map: Record<string, { bg: string, text: string, label: string }> = {
    success: { bg: '#00C89618', text: C.green, label: 'Succès' },
    pending: { bg: C.yellowLight, text: '#B89000', label: 'En attente' },
    failed: { bg: C.redLight, text: C.red, label: 'Échoué' },
    flagged: { bg: '#A78BFA18', text: C.purple, label: '🚨 Signalé' },
    verified: { bg: '#00C89618', text: C.green, label: '✓ Vérifié' },
    blocked: { bg: C.redLight, text: C.red, label: '🔒 Bloqué' },
    suspended: { bg: '#A78BFA18', text: C.purple, label: 'Suspendu' },
    approved: { bg: '#00C89618', text: C.green, label: 'Approuvé' },
    rejected: { bg: C.redLight, text: C.red, label: 'Rejeté' },
    review: { bg: C.yellowLight, text: '#B89000', label: 'Révision' },
  }
  const s = map[status] ?? { bg: '#333', text: '#888', label: status }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, background: s.bg, color: s.text,
    }}>{s.label}</span>
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
function KPICard({ label, value, delta, deltaUp, icon, color = C.green, sub }: {
  label: string, value: string, delta?: string, deltaUp?: boolean, icon: string, color?: string, sub?: string
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: -0.5, marginBottom: 6 }}>{value}</div>
      {delta && (
        <div style={{ fontSize: 12, color: deltaUp ? C.green : C.red, fontWeight: 600 }}>
          {deltaUp ? '↑' : '↓'} {delta} vs 30 j préc.
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
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Vue d'ensemble</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>Données en temps réel — API CamWallet</p>
      </div>

      {(statsLoading || statsError) && <StateRow loading={statsLoading} error={statsError} />}

      {/* KPIs */}
      {stats && (
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        <KPICard label="Volume complété" value={fmt(toFcfa(stats.volume.completedAmount))} icon="💰"
          {...trendProps(stats.trends.volume)}
          sub={`Frais perçus : ${fmt(toFcfa(stats.volume.collectedFees))}`} />
        <KPICard label="Solde plateforme" value={fmt(toFcfa(stats.totalBalance))} icon="🏦" color={C.purple} />
        <KPICard label="Utilisateurs" value={stats.users.total.toLocaleString('fr-FR')} icon="👥" color={C.green}
          {...trendProps(stats.trends.users)}
          sub={stats.users.byRole.map((r) => `${r.count} ${r.role.toLowerCase()}`).join(' · ')} />
        <KPICard label="Transactions" value={stats.transactions.total.toLocaleString('fr-FR')} icon="⚡" color={C.blue}
          {...trendProps(stats.trends.transactions)}
          sub={`${stats.transactions.pending} en attente`} />
      </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Volume area chart */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>Volume de transactions</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
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
          <button style={{ fontSize: 12, color: C.green, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Voir tout →
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Réf.', 'Type', 'De', 'À', 'Montant', 'Statut', 'Date'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(tx => (
              <tr key={tx.id} style={{ borderTop: `1px solid ${C.border}` }}>
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
        {(recentLoading || recentError || recent.length === 0) && (
          <StateRow loading={recentLoading} error={recentError} empty={!recentLoading && !recentError ? 'Aucune transaction' : undefined} />
        )}
      </div>
    </div>
  )
}

function AlertsPage() {
  const { data, loading, error } = useFetch(() => getAlerts(), [])
  const alerts = data?.alerts ?? []
  const flagged = data?.flagged ?? []

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Alertes & Surveillance</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{alerts.length} alerte(s) active(s) — données en temps réel</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Alert cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {alerts.map(a => {
          const cfg = {
            error: { bg: C.redLight, border: C.red, icon: '🚨' },
            warn: { bg: C.yellowLight, border: C.yellow, icon: '⚠️' },
            info: { bg: C.blueLight, border: C.blue, icon: 'ℹ️' },
          }[a.type] ?? { bg: '#333', border: '#888', icon: '•' }
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: cfg.bg, borderLeft: `3px solid ${cfg.border}`, borderRadius: 12, padding: '14px 16px' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{cfg.icon}</span>
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
        <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>⚠️ Transactions signalées</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Réf.', 'Type', 'Montant', 'De', 'À', 'Statut', 'Date'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flagged.map(tx => (
              <tr key={tx.id} style={{ borderTop: `1px solid ${C.border}` }}>
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
  const u = data?.user

  const run = async (fn: () => Promise<unknown>) => {
    setActing(true)
    try {
      await fn()
      refetch()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action échouée')
    } finally {
      setActing(false)
    }
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: '#000A', zIndex: 50,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto',
  }
  const panel: React.CSSProperties = {
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
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer' }}>✕</button>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              <div>{label('Email')}<span style={{ color: C.text, fontSize: 13 }}>{u.email ?? '—'}</span></div>
              <div>{label('Ville')}<span style={{ color: C.text, fontSize: 13 }}>{u.city ?? '—'}</span></div>
              <div>{label('Naissance')}<span style={{ color: C.text, fontSize: 13 }}>{u.dateOfBirth ? fmtDate(u.dateOfBirth) : '—'}</span></div>
              <div>{label('Solde')}<span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>{fmt(toFcfa(u.wallet?.balance ?? 0))}</span></div>
              <div>{label('Dernière connexion')}<span style={{ color: C.text, fontSize: 13 }}>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</span></div>
              <div>{label('Inscrit le')}<span style={{ color: C.text, fontSize: 13 }}>{fmtDate(u.createdAt)}</span></div>
              <div>{label('Transactions')}<span style={{ color: C.text, fontSize: 13 }}>{data.stats.transactionsCount}</span></div>
              <div>{label('Total envoyé')}<span style={{ color: C.text, fontSize: 13 }}>{fmt(toFcfa(data.stats.totalSent))}</span></div>
              <div>{label('Total reçu')}<span style={{ color: C.text, fontSize: 13 }}>{fmt(toFcfa(data.stats.totalReceived))}</span></div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {u.role !== 'ADMIN' && (u.status === 'LOCKED' ? (
                <button disabled={acting} onClick={() => run(() => setUserStatus(u.id, 'ACTIVE'))}
                  style={{ fontSize: 12, color: C.green, background: C.greenLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>Débloquer</button>
              ) : (
                <button disabled={acting} onClick={() => run(() => setUserStatus(u.id, 'LOCKED'))}
                  style={{ fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>Bloquer</button>
              ))}
              <button disabled={acting} onClick={() => { if (confirm('Forcer la réinitialisation du PIN ?')) run(() => resetUserPin(u.id)) }}
                style={{ fontSize: 12, color: C.yellow, background: C.yellowLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}>Réinitialiser le PIN</button>
              {['PENDING', 'SUBMITTED'].includes(u.kycStatus) && (
                <>
                  <button disabled={acting} onClick={() => run(() => reviewKyc(u.id, 'APPROVED'))}
                    style={{ fontSize: 12, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>✓ Approuver KYC</button>
                  <button disabled={acting} onClick={() => run(() => reviewKyc(u.id, 'REJECTED'))}
                    style={{ fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>✕ Rejeter KYC</button>
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
  // Bloquer / réactiver un compte (action tracée côté backend dans l'AuditLog).
  const toggleBlock = async (u: { id: string; status: string }) => {
    setActing(u.id)
    try {
      await setUserStatus(u.id, u.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED')
      refetch()
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
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Utilisateurs</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{total} utilisateur{total > 1 ? 's' : ''} enregistré{total > 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', flex: 1, minWidth: 200 }}>
          <span>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher (nom ou téléphone)…"
            style={{ background: 'none', border: 'none', color: C.text, fontSize: 13, flex: 1, outline: 'none' }}
          />
        </div>
        {FILTERS.map(f => (
          <button
            key={f.key}
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: C.surface }}>
            <tr>
              {['Utilisateur', 'Téléphone', 'Solde', 'Statut', 'KYC', 'Inscrit', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} onClick={() => setSelected(u.id)}
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
                    <button onClick={() => setSelected(u.id)}
                      style={{ fontSize: 11, color: C.blue, background: C.blueLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                      Détails
                    </button>
                    {u.role === 'ADMIN' ? null : u.status === 'LOCKED' ? (
                      <button onClick={() => toggleBlock(u)} disabled={acting === u.id}
                        style={{ fontSize: 11, color: C.green, background: C.greenLight, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: acting === u.id ? 'wait' : 'pointer', fontWeight: 600 }}>
                        Débloquer
                      </button>
                    ) : (
                      <button onClick={() => toggleBlock(u)} disabled={acting === u.id}
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

  const decide = async (userId: string, decision: 'APPROVED' | 'REJECTED') => {
    setActing(userId)
    try {
      await reviewKyc(userId, decision)
      refetch()
    } finally {
      setActing(null)
    }
  }

  const stats = [
    { label: 'En attente', value: counts.pending, color: C.yellow, icon: '⏳' },
    { label: 'Approuvés (30j)', value: counts.approved30, color: C.green, icon: '✅' },
    { label: 'Rejetés (30j)', value: counts.rejected30, color: C.red, icon: '❌' },
  ]

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Vérification KYC</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>{counts.pending} demande(s) en attente</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span>{s.icon}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</div>
          </div>
        ))}
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
                  {k.kycDocument && <div style={{ color: C.blue, fontSize: 12, marginTop: 3, fontWeight: 600 }}>📄 Document soumis le {fmtDate(k.kycDocument.submittedAt)}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusBadge status={KYC_STATUS_BADGE[k.kycStatus] ?? k.kycStatus} />
                <button onClick={() => decide(k.id, 'APPROVED')} disabled={acting === k.id}
                  style={{ fontSize: 12, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: acting === k.id ? 'wait' : 'pointer', fontWeight: 700 }}>
                  ✓ Approuver
                </button>
                <button onClick={() => decide(k.id, 'REJECTED')} disabled={acting === k.id}
                  style={{ fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: acting === k.id ? 'wait' : 'pointer', fontWeight: 700 }}>
                  ✕ Rejeter
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

function TransactionsPage() {
  const [txFilter, setTxFilter] = useState('all')

  const { data, loading, error } = useFetch(
    () => getTransactions({ limit: 50, type: txFilter === 'all' ? undefined : TX_TYPE_FILTER[txFilter] }),
    [txFilter],
  )
  const txs = data?.data ?? []
  const total = data?.meta.total ?? 0

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
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

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: C.surface }}>
            <tr>
              {['Réf.', 'Type', 'De', 'À', 'Montant', 'Frais', 'Statut', 'Date'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.map(tx => (
              <tr key={tx.id} style={{ borderTop: `1px solid ${C.border}` }}>
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

  const kpis = stats
    ? [
        { label: 'Frais perçus', value: fmt(toFcfa(stats.volume.collectedFees)), icon: '💰', color: C.green },
        { label: 'Volume complété', value: fmt(toFcfa(stats.volume.completedAmount)), icon: '📈', color: C.blue, trend: stats.trends.volume },
        { label: 'Solde plateforme', value: fmt(toFcfa(stats.totalBalance)), icon: '🏦', color: C.purple },
        { label: 'Transactions', value: stats.transactions.total.toLocaleString('fr-FR'), icon: '⚡', color: C.yellow, trend: stats.trends.transactions },
      ]
    : []

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Finances & Revenus</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>Données en temps réel — API CamWallet</p>
      </div>

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* KPIs financiers (réels) */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
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

// ── Sidebar nav items ─────────────────────────────────────
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞', group: 'Vue générale' },
  { id: 'alerts', label: 'Alertes', icon: '⚠️', group: 'Vue générale' },
  { id: 'users', label: 'Utilisateurs', icon: '👥', group: 'Utilisateurs' },
  { id: 'kyc', label: 'Vérification KYC', icon: '📋', group: 'Utilisateurs' },
  { id: 'transactions', label: 'Transactions', icon: '⚡', group: 'Finances' },
  { id: 'finance', label: 'Finances & Revenus', icon: '💰', group: 'Finances' },
]

const GROUPS = ['Vue générale', 'Utilisateurs', 'Finances']

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(hasSession())
  const [activePage, setActivePage] = useState('dashboard')
  const [refreshNonce, setRefreshNonce] = useState(0)

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
      default: return <DashboardPage />
    }
  }

  return (
    <RefreshContext.Provider value={refreshNonce}>
    <div style={{ display: 'flex', height: '100vh', background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", color: C.text }}>
      {/* Sidebar */}
      <aside style={{ width: 230, background: C.surface, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Brand */}
        <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            ₩
          </div>
          <div>
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
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', padding: '8px 8px 4px' }}>
                {group}
              </div>
              {NAV.filter(n => n.group === group).map(item => (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                    borderRadius: 10, cursor: 'pointer', fontSize: 13, width: '100%', textAlign: 'left',
                    border: 'none', marginBottom: 2, transition: 'all 0.15s',
                    background: activePage === item.id ? C.green + '20' : 'none',
                    color: activePage === item.id ? C.green : C.textSoft,
                    fontWeight: activePage === item.id ? 700 : 400,
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge && (
                    <span style={{ fontSize: 10, background: C.blue + '25', color: C.blue, padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted }}>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>Admin Système</div>
          <div>Dernière synchro: 14h32</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.green, display: 'inline-block' }} />
            <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>API opérationnelle</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
            {NAV.find(n => n.id === activePage)?.label ?? 'Dashboard'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setRefreshNonce(n => n + 1)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'none', color: C.textSoft }}>
              🔄 Actualiser
            </button>
            <button
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'none', color: C.textSoft }}>
              ⎋ Déconnexion
            </button>
            <div style={{ width: 34, height: 34, borderRadius: 17, background: C.green + '20', border: `2px solid ${C.green}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: C.green, cursor: 'pointer' }}>
              A
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {renderPage()}
        </div>
      </main>
    </div>
    </RefreshContext.Provider>
  )
}
