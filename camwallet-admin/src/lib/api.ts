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

export function getUsers(params: { page?: number; limit?: number; search?: string } = {}) {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.limit) q.set('limit', String(params.limit))
  if (params.search) q.set('search', params.search)
  const qs = q.toString()
  return request<Paginated<AdminUser>>(`/admin/users${qs ? `?${qs}` : ''}`)
}

export function getTransactions(
  params: { page?: number; limit?: number; type?: string; status?: string } = {},
) {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.limit) q.set('limit', String(params.limit))
  if (params.type) q.set('type', params.type)
  if (params.status) q.set('status', params.status)
  const qs = q.toString()
  return request<Paginated<AdminTransaction>>(`/admin/transactions${qs ? `?${qs}` : ''}`)
}
