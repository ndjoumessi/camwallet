import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import LoginPage from './LoginPage'
import {
  hasSession, logout, toFcfa, SessionExpiredError,
  getStats, getUsers, getTransactions,
  type AdminStats, type AdminUser, type AdminTransaction,
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

// ── Mock Data ─────────────────────────────────────────────
const VOLUME_DATA = [
  { date: 'Jan', volume: 12500000, tx: 3240, users: 180 },
  { date: 'Fév', volume: 18700000, tx: 4870, users: 310 },
  { date: 'Mar', volume: 22300000, tx: 5920, users: 480 },
  { date: 'Avr', volume: 19800000, tx: 5100, users: 520 },
  { date: 'Mai', volume: 28400000, tx: 7340, users: 690 },
  { date: 'Juin', volume: 34200000, tx: 8870, users: 840 },
  { date: 'Juil', volume: 41500000, tx: 10720, users: 1020 },
]

const REVENUE_DATA = [
  { date: 'Jan', commissions: 125000, retraits: 62000, abonnements: 40000 },
  { date: 'Fév', commissions: 187000, retraits: 93500, abonnements: 60000 },
  { date: 'Mar', commissions: 223000, retraits: 111500, abonnements: 80000 },
  { date: 'Avr', commissions: 198000, retraits: 99000, abonnements: 80000 },
  { date: 'Mai', commissions: 284000, retraits: 142000, abonnements: 100000 },
  { date: 'Juin', commissions: 342000, retraits: 171000, abonnements: 120000 },
  { date: 'Juil', commissions: 415000, retraits: 207500, abonnements: 140000 },
]

const TRANSACTIONS = [
  { id: 'TX001', type: 'P2P', from: 'Marie Ngono', to: 'Jean-Paul Mbarga', amount: 15000, status: 'success', date: '14/06/2026 14:32', risk: 'low' },
  { id: 'TX002', type: 'QR', from: 'Rodrigue Mbé', to: 'Supermarché Mahima', amount: 8500, status: 'success', date: '14/06/2026 11:05', risk: 'low' },
  { id: 'TX003', type: 'RECHARGE', from: 'MTN MoMo', to: 'Awa Fanta', amount: 50000, status: 'pending', date: '14/06/2026 09:20', risk: 'med' },
  { id: 'TX004', type: 'RETRAIT', from: 'Sylvain Kotto', to: 'Orange Money', amount: 20000, status: 'success', date: '13/06/2026 16:45', risk: 'low' },
  { id: 'TX005', type: 'P2P', from: 'Unknown User', to: 'Paul Biya Jr', amount: 95000, status: 'flagged', date: '13/06/2026 15:10', risk: 'high' },
  { id: 'TX006', type: 'QR', from: 'Alice Bello', to: 'Restaurant Ngon', amount: 12500, status: 'success', date: '13/06/2026 13:22', risk: 'low' },
  { id: 'TX007', type: 'RECHARGE', from: 'Orange Money', to: 'Claude Fonkou', amount: 100000, status: 'failed', date: '13/06/2026 10:00', risk: 'med' },
  { id: 'TX008', type: 'P2P', from: 'Thierry Ndi', to: 'Christine Samba', amount: 5000, status: 'success', date: '12/06/2026 18:30', risk: 'low' },
]

const KYC_QUEUE = [
  { id: 'K001', name: 'Rodrigue Mbé', phone: '681234567', submitted: '14/06/2026', type: 'CNI + Selfie', status: 'pending' },
  { id: 'K002', name: 'Christine Samba', phone: '674445566', submitted: '13/06/2026', type: 'Passeport + Selfie', status: 'pending' },
  { id: 'K003', name: 'Thierry Ndi', phone: '699876543', submitted: '12/06/2026', type: 'CNI + Selfie', status: 'review' },
  { id: 'K004', name: 'Claude Fonkou', phone: '655123456', submitted: '11/06/2026', type: 'CNI + Selfie', status: 'pending' },
]

const ALERTS = [
  { id: 'A001', type: 'error', title: 'Activité suspecte détectée', desc: 'TX005 — 95 000 FCFA vers compte inconnu', time: 'Il y a 2 min' },
  { id: 'A002', type: 'warn', title: 'KYC expiré', desc: '3 utilisateurs avec documents expirés', time: 'Il y a 15 min' },
  { id: 'A003', type: 'warn', title: 'Solde opérateur bas', desc: 'Réserve MTN MoMo < 500 000 FCFA', time: 'Il y a 1h' },
  { id: 'A004', type: 'info', title: 'Webhook OM retardé', desc: 'Délai moyen webhook Orange Money: 4.2s', time: 'Il y a 3h' },
]

// ── Formatters ────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA'
const fmtM = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'k') + ' FCFA'

// ── Mapping enums backend → clés des badges UI ────────────
const USER_STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'verified', SUSPENDED: 'suspended', LOCKED: 'blocked', DELETED: 'rejected',
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

function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, { bg: string, text: string }> = {
    low: { bg: '#00C89618', text: C.green },
    med: { bg: C.yellowLight, text: '#B89000' },
    high: { bg: C.redLight, text: C.red },
  }
  const s = map[risk] ?? { bg: '#333', text: '#888' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.text }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: s.text, display: 'inline-block' }} />
      {risk === 'low' ? 'Faible' : risk === 'med' ? 'Moyen' : 'Élevé'}
    </span>
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
      <div style={{ fontSize: 26, fontWeight: 900, color: C.text, letterSpacing: -0.5, marginBottom: 6 }}>{value}</div>
      {delta && (
        <div style={{ fontSize: 12, color: deltaUp ? C.green : C.red, fontWeight: 600 }}>
          {deltaUp ? '↑' : '↓'} {delta} vs mois dernier
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
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [recent, setRecent] = useState<AdminTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([getStats(), getTransactions({ limit: 5 })])
      .then(([s, tx]) => {
        if (!alive) return
        setStats(s)
        setRecent(tx.data)
      })
      .catch((e) => {
        if (alive && !(e instanceof SessionExpiredError))
          setError(e instanceof Error ? e.message : 'Erreur de chargement')
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

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

      {(loading || error) && <StateRow loading={loading} error={error} />}

      {/* KPIs */}
      {stats && (
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        <KPICard label="Volume complété" value={fmt(toFcfa(stats.volume.completedAmount))} icon="💰"
          sub={`Frais perçus : ${fmt(toFcfa(stats.volume.collectedFees))}`} />
        <KPICard label="Solde plateforme" value={fmt(toFcfa(stats.totalBalance))} icon="🏦" color={C.purple} />
        <KPICard label="Utilisateurs" value={stats.users.total.toLocaleString('fr-FR')} icon="👥"
          sub={stats.users.byRole.map((r) => `${r.count} ${r.role.toLowerCase()}`).join(' · ')} />
        <KPICard label="Transactions" value={stats.transactions.total.toLocaleString('fr-FR')} icon="⚡" color={C.blue}
          sub={`${stats.transactions.pending} en attente`} />
      </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Volume area chart */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>Volume de transactions <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>· démo</span></h3>
            <select style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, fontSize: 12, padding: '4px 8px', cursor: 'pointer' }}>
              <option>7 derniers mois</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={VOLUME_DATA}>
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
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Revenus par source <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>· démo</span></h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={REVENUE_DATA} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={10} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="commissions" fill={C.green} radius={[3, 3, 0, 0]} name="Commissions" />
              <Bar dataKey="retraits" fill={C.blue} radius={[3, 3, 0, 0]} name="Retraits" />
              <Bar dataKey="abonnements" fill={C.yellow} radius={[3, 3, 0, 0]} name="Abonnements" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* User growth */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Croissance utilisateurs <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>· démo</span></h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={VOLUME_DATA}>
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
      </div>
    </div>
  )
}

function AlertsPage() {
  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Alertes & Surveillance</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>4 alertes actives — Dernière mise à jour: il y a 2 min</p>
      </div>

      {/* Alert cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {ALERTS.map(a => {
          const cfg = {
            error: { bg: C.redLight, border: C.red, icon: '🚨', tColor: C.red },
            warn: { bg: C.yellowLight, border: C.yellow, icon: '⚠️', tColor: '#B89000' },
            info: { bg: C.blueLight, border: C.blue, icon: 'ℹ️', tColor: C.blue },
          }[a.type] ?? { bg: '#333', border: '#888', icon: '•', tColor: '#888' }
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: cfg.bg, borderLeft: `3px solid ${cfg.border}`, borderRadius: 12, padding: '14px 16px' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{cfg.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{a.title}</div>
                <div style={{ color: C.textSoft, fontSize: 12 }}>{a.desc}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <span style={{ color: C.textMuted, fontSize: 11 }}>{a.time}</span>
                <button style={{ fontSize: 11, color: cfg.tColor, background: 'none', border: `1px solid ${cfg.border}`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>
                  Traiter
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Suspicious transactions */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
        <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>⚠️ Transactions signalées</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Réf.', 'Montant', 'De', 'Date', 'Risque', 'Action'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', padding: '0 12px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TRANSACTIONS.filter(t => t.risk !== 'low').map(tx => (
              <tr key={tx.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '10px 12px', color: C.textSoft, fontFamily: 'monospace', fontSize: 12 }}>{tx.id}</td>
                <td style={{ padding: '10px 12px', color: C.yellow, fontWeight: 700 }}>{fmt(tx.amount)}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{tx.from}</td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 12 }}>{tx.date}</td>
                <td style={{ padding: '10px 12px' }}><RiskBadge risk={tx.risk} /></td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={{ fontSize: 11, color: C.green, background: C.greenLight, border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>Approuver</button>
                    <button style={{ fontSize: 11, color: C.red, background: C.redLight, border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>Bloquer</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  // Recherche côté serveur, debouncée.
  useEffect(() => {
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      getUsers({ limit: 50, search: search.trim() || undefined })
        .then((res) => {
          if (!alive) return
          setUsers(res.data)
          setTotal(res.meta.total)
          setError(null)
        })
        .catch((e) => {
          if (alive && !(e instanceof SessionExpiredError))
            setError(e instanceof Error ? e.message : 'Erreur de chargement')
        })
        .finally(() => alive && setLoading(false))
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [search])

  // Filtre par statut, côté client, sur le statut mappé.
  const filtered = users.filter((u) => filter === 'all' || USER_STATUS_BADGE[u.status] === filter)

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
              {['Utilisateur', 'Téléphone', 'Solde', 'Statut', 'KYC', 'Inscrit'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 14px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} style={{ borderTop: `1px solid ${C.border}` }}>
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
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Aucun utilisateur trouvé</div>
        )}
        <StateRow loading={loading} error={error} />
      </div>
    </div>
  )
}

function KYCPage() {
  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Vérification KYC</h1>
          <p style={{ color: C.textMuted, fontSize: 13 }}>{KYC_QUEUE.length} demandes en attente</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 12, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: C.card, border: `1px solid ${C.border}`, color: C.textSoft, fontWeight: 600 }}>
            Filtrer par date
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'En attente', value: '4', color: C.yellow, icon: '⏳' },
          { label: 'Approuvés (30j)', value: '142', color: C.green, icon: '✅' },
          { label: 'Rejetés (30j)', value: '18', color: C.red, icon: '❌' },
          { label: 'Taux validation', value: '88.7%', color: C.blue, icon: '📊' },
        ].map(s => (
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
        {KYC_QUEUE.map(k => (
          <div key={k.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 24, background: C.blue + '20', border: `2px solid ${C.blue}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: C.blue }}>
                  {k.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <div style={{ color: C.text, fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{k.name}</div>
                  <div style={{ color: C.textMuted, fontSize: 12 }}>+237 {k.phone} · Soumis le {k.submitted}</div>
                  <div style={{ color: C.blue, fontSize: 12, marginTop: 3, fontWeight: 600 }}>📄 {k.type}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusBadge status={k.status} />
                <button style={{ fontSize: 12, color: '#fff', background: C.green, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>
                  ✓ Approuver
                </button>
                <button style={{ fontSize: 12, color: C.red, background: C.redLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>
                  ✕ Rejeter
                </button>
                <button style={{ fontSize: 12, color: C.blue, background: C.blueLight, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>
                  👁 Documents
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TransactionsPage() {
  const [txs, setTxs] = useState<AdminTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [txFilter, setTxFilter] = useState('all')

  useEffect(() => {
    let alive = true
    setLoading(true)
    getTransactions({ limit: 50, type: txFilter === 'all' ? undefined : TX_TYPE_FILTER[txFilter] })
      .then((res) => {
        if (!alive) return
        setTxs(res.data)
        setTotal(res.meta.total)
        setError(null)
      })
      .catch((e) => {
        if (alive && !(e instanceof SessionExpiredError))
          setError(e instanceof Error ? e.message : 'Erreur de chargement')
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [txFilter])

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
  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Finances & Revenus</h1>
        <p style={{ color: C.textMuted, fontSize: 13 }}>Juillet 2026 — Vue financière complète</p>
      </div>

      {/* Revenue KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Commissions (mois)', value: '415 000 FCFA', delta: '+22%', icon: '💰', color: C.green },
          { label: 'Frais de retrait', value: '207 500 FCFA', delta: '+18%', icon: '🏧', color: C.blue },
          { label: 'Abonnements Pro', value: '140 000 FCFA', delta: '+40%', icon: '⭐', color: C.yellow },
          { label: 'Solde plateforme', value: '28,4M FCFA', delta: '+31%', icon: '🏦', color: C.purple },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
              <span>{s.icon}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color, marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>↑ {s.delta} vs mois dernier</div>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 20 }}>
        <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Évolution des revenus</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={REVENUE_DATA}>
            <defs>
              {[['gradComm', C.green], ['gradRet', C.blue], ['gradAbo', C.yellow]].map(([id, color]) => (
                <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color as string} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color as string} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="date" stroke={C.textMuted} fontSize={11} />
            <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Area type="monotone" dataKey="commissions" stroke={C.green} fill="url(#gradComm)" name="Commissions" />
            <Area type="monotone" dataKey="retraits" stroke={C.blue} fill="url(#gradRet)" name="Retraits" />
            <Area type="monotone" dataKey="abonnements" stroke={C.yellow} fill="url(#gradAbo)" name="Abonnements" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Operator balances */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
        <h3 style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Soldes opérateurs</h3>
        {[
          { name: 'MTN Mobile Money', ussd: '*126#', balance: 4200000, limit: 10000000, color: C.yellow, icon: '📲' },
          { name: 'Orange Money', ussd: '*144#', balance: 6800000, limit: 10000000, color: '#FF6600', icon: '🟠' },
        ].map(op => (
          <div key={op.name} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>{op.icon}</span>
                <div>
                  <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{op.name}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{op.ussd}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: op.color, fontWeight: 700, fontSize: 15 }}>{(op.balance / 1000000).toFixed(1)}M FCFA</div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>/ {(op.limit / 1000000).toFixed(0)}M max</div>
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: op.color, width: `${(op.balance / op.limit) * 100}%`, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sidebar nav items ─────────────────────────────────────
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞', group: 'Vue générale' },
  { id: 'alerts', label: 'Alertes', icon: '⚠️', badge: 4, group: 'Vue générale' },
  { id: 'users', label: 'Utilisateurs', icon: '👥', group: 'Utilisateurs' },
  { id: 'kyc', label: 'Vérification KYC', icon: '📋', badge: 4, group: 'Utilisateurs' },
  { id: 'transactions', label: 'Transactions', icon: '⚡', group: 'Finances' },
  { id: 'finance', label: 'Finances & Revenus', icon: '💰', group: 'Finances' },
]

const GROUPS = ['Vue générale', 'Utilisateurs', 'Finances']

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(hasSession())
  const [activePage, setActivePage] = useState('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)

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
              onClick={() => setRefreshKey(k => k + 1)}
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
        <div key={refreshKey} style={{ flex: 1, overflow: 'hidden' }}>
          {renderPage()}
        </div>
      </main>
    </div>
  )
}
