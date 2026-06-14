// ─────────────────────────────────────────────────────────────────────────────
// Client API du dashboard admin — fetch natif, Bearer + refresh auto sur 401.
// Les montants du backend sont des BigInt sérialisés en centimes de FCFA :
// on convertit en FCFA entiers à la frontière (voir toFcfa).
// ─────────────────────────────────────────────────────────────────────────────
const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const BASE_URL = `${API_ORIGIN}/api/v1`

const ACCESS_KEY = 'cw_admin_access'
const REFRESH_KEY = 'cw_admin_refresh'

// ── Tokens (localStorage) ─────────────────────────────────
export function saveTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_KEY, accessToken)
  localStorage.setItem(REFRESH_KEY, refreshToken)
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
export function hasSession(): boolean {
  return localStorage.getItem(ACCESS_KEY) !== null
}
const getAccess = () => localStorage.getItem(ACCESS_KEY)
const getRefresh = () => localStorage.getItem(REFRESH_KEY)

// Erreur levée quand la session n'est plus valide → l'app redirige vers le login.
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expirée')
    this.name = 'SessionExpiredError'
  }
}

// ── Conversion centimes → FCFA ────────────────────────────
export const toFcfa = (centimes: number) => Math.round(centimes / 100)

// ── Refresh (un seul à la fois) ───────────────────────────
let refreshing: Promise<string | null> | null = null

async function refreshSession(): Promise<string | null> {
  const refreshToken = getRefresh()
  if (!refreshToken) return null
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) throw new Error('refresh failed')
    const data = (await res.json()) as AuthTokens
    saveTokens(data.accessToken, data.refreshToken)
    return data.accessToken
  } catch {
    clearTokens()
    return null
  }
}

// ── Requête générique ─────────────────────────────────────
async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccess()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  if (res.status === 401 && retry && !path.includes('/auth/')) {
    refreshing = refreshing ?? refreshSession()
    const newToken = await refreshing
    refreshing = null
    if (newToken) return request<T>(path, init, false)
    // Plus de session valide : on prévient l'app (redirection vers le login).
    window.dispatchEvent(new Event('cw-session-expired'))
    throw new SessionExpiredError()
  }

  if (!res.ok) {
    let message = `Erreur ${res.status}`
    try {
      const body = await res.json()
      message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? message
    } catch {
      /* corps non-JSON */
    }
    throw new Error(message)
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

// ── Types (alignés sur les réponses backend) ──────────────
export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AdminStats {
  // Variation en % (30j vs 30j précédents) ; null si pas de base de comparaison.
  trends: { users: number | null; transactions: number | null; volume: number | null }
  users: { total: number; byRole: { role: string; count: number }[] }
  transactions: {
    total: number
    pending: number
    byType: { type: string; count: number; volume: number }[] // volume en centimes
    byStatus: { status: string; count: number }[]
  }
  volume: { completedAmount: number; collectedFees: number } // centimes
  totalBalance: number // centimes
}

export interface AdminKycEntry {
  id: string
  phone: string
  fullName: string | null
  kycStatus: string
  createdAt: string
  kycDocument: {
    status: string
    submittedAt: string
    idFrontUrl: string
    idBackUrl: string
    selfieUrl: string
  } | null
}

export interface AdminKyc {
  pending: AdminKycEntry[]
  counts: { pending: number; approved30: number; rejected30: number }
}

export interface AdminAlert {
  id: string
  type: 'error' | 'warn' | 'info'
  title: string
  desc: string
}

export interface AdminAlerts {
  alerts: AdminAlert[]
  flagged: AdminTransaction[]
}

export interface AdminAuditEntry {
  id: string
  action: string
  resource: string | null
  metadata: Record<string, any> | null
  createdAt: string
  user: { fullName: string | null; email: string | null } | null
}

export interface AdminUser {
  id: string
  phone: string
  fullName: string | null
  email: string | null
  role: string
  status: string
  kycStatus: string
  createdAt: string
  wallet: { balance: number; currency: string } | null // balance en centimes
}

export interface AdminTransaction {
  id: string
  reference: string
  type: string
  status: string
  amount: number // centimes
  fee: number // centimes
  senderId: string | null
  receiverId: string | null
  description: string | null
  createdAt: string
  sender: { phone: string; fullName: string | null } | null
  receiver: { phone: string; fullName: string | null } | null
}

export interface Paginated<T> {
  data: T[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

// ── Endpoints ─────────────────────────────────────────────
export async function loginAdmin(email: string, password: string): Promise<void> {
  const data = await request<AuthTokens>('/auth/login-admin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  saveTokens(data.accessToken, data.refreshToken)
}

export const logout = () => clearTokens()

export const getStats = () => request<AdminStats>('/admin/stats')

export interface TimeseriesPoint {
  date: string // YYYY-MM-DD
  volume: number // centimes
  fees: number // centimes
  transactions: number
  users: number
}
export interface AdminTimeseries {
  period: string
  days: number
  series: TimeseriesPoint[]
}

export const getTimeseries = (period: '7d' | '30d' | '90d') =>
  request<AdminTimeseries>(`/admin/stats/timeseries?period=${period}`)

// Construit une query string en ignorant les valeurs vides/undefined.
function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

export function getUsers(
  params: { page?: number; limit?: number; search?: string; status?: string } = {},
) {
  return request<Paginated<AdminUser>>(`/admin/users${buildQuery(params)}`)
}

export function getTransactions(
  params: { page?: number; limit?: number; type?: string; status?: string } = {},
) {
  return request<Paginated<AdminTransaction>>(`/admin/transactions${buildQuery(params)}`)
}

export const getKyc = () => request<AdminKyc>('/admin/kyc')

export const getAlerts = () => request<AdminAlerts>('/admin/alerts')

export const getAudit = () => request<AdminAuditEntry[]>('/admin/audit')

export function reviewKyc(userId: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
  return request(`/admin/kyc/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, note }),
  })
}

export function setUserStatus(userId: string, status: 'ACTIVE' | 'LOCKED' | 'SUSPENDED') {
  return request(`/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function resetUserPin(userId: string) {
  return request(`/admin/users/${userId}/reset-pin`, { method: 'POST' })
}

export interface AdminUserDetail {
  user: AdminUser & {
    avatarUrl: string | null
    dateOfBirth: string | null
    city: string | null
    lastLoginAt: string | null
    kycDocument: {
      idFrontUrl: string
      idBackUrl: string
      selfieUrl: string
      status: string
      reviewNote: string | null
      reviewedAt: string | null
      submittedAt: string
    } | null
  }
  transactions: AdminTransaction[]
  audit: AdminAuditEntry[]
  stats: { transactionsCount: number; totalSent: number; totalReceived: number }
}

export const getUserDetail = (id: string) =>
  request<AdminUserDetail>(`/admin/users/${id}`)
