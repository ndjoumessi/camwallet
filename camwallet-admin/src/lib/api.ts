// ─────────────────────────────────────────────────────────────────────────────
// Client API du dashboard admin — fetch natif, Bearer + refresh auto sur 401.
// Les montants du backend sont des BigInt sérialisés en centimes de FCFA :
// on convertit en FCFA entiers à la frontière (voir toFcfa).
// ─────────────────────────────────────────────────────────────────────────────
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
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

// Décode le sous-rôle admin (claim `adminRole`) du token d'accès, pour le RBAC
// du dashboard (affichage/masquage des pages). Renvoie null si absent/illisible.
function decodeAccess(): Record<string, any> | null {
  const token = getAccess()
  if (!token) return null
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(part))))
  } catch {
    return null
  }
}
export function getAdminRole(): string | null {
  return decodeAccess()?.adminRole ?? null
}
// Id de l'admin connecté (claim `sub`) — pour masquer les actions sur soi-même.
export function getAdminId(): string | null {
  return decodeAccess()?.sub ?? null
}

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

// ── Retry avec backoff exponentiel (erreurs réseau et 5xx, hors auth) ────────
const RETRY_DELAYS_MS = [1000, 2000, 4000] // 3 tentatives après l'essai initial

// ── Requête générique ─────────────────────────────────────
async function request<T>(
  path: string,
  init: RequestInit = {},
  _authRetry = true,
  _networkRetry = 0,
): Promise<T> {
  const token = getAccess()
  const isAuthRoute = path.includes('/auth/')

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch (networkErr) {
    // Erreur réseau (pas de réponse) — retry si pas une route auth
    if (!isAuthRoute && _networkRetry < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[_networkRetry]))
      return request<T>(path, init, _authRetry, _networkRetry + 1)
    }
    throw networkErr
  }

  // Retry backoff sur 5xx (hors auth)
  if (!isAuthRoute && res.status >= 500 && _networkRetry < RETRY_DELAYS_MS.length) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[_networkRetry]))
    return request<T>(path, init, _authRetry, _networkRetry + 1)
  }

  if (res.status === 401 && _authRetry && !isAuthRoute) {
    refreshing = refreshing ?? refreshSession()
    const newToken = await refreshing
    refreshing = null
    if (newToken) return request<T>(path, init, false, 0)
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
  complianceScore: number
  kycDocument: {
    status: string
    submittedAt: string
    idFrontUrl: string | null
    idBackUrl: string | null
    selfieUrl: string | null
    reviewNote: string | null
    reviewedAt: string | null
  } | null
}

export interface AdminKyc {
  queue: AdminKycEntry[]
  counts: { pending: number; approvedToday: number; rejectedToday: number; resubmitRequired: number; approvalRate: number | null }
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
  // Champs enrichis (présents sur la liste transactions ; utiles à la modale détail)
  updatedAt?: string
  processedAt?: string | null
  operator?: string | null
  operatorRef?: string | null
  operatorStatus?: string | null
  failureReason?: string | null
  sender: { phone: string; fullName: string | null } | null
  receiver: { phone: string; fullName: string | null } | null
}

export interface Paginated<T> {
  data: T[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

// ── Endpoints ─────────────────────────────────────────────
// Connexion admin avec support 2FA TOTP. Si le compte a la 2FA active et
// qu'aucun code n'est fourni, le backend répond { requiresTOTP: true } sans
// émettre de token : on renvoie ce signal pour afficher l'étape TOTP.
export async function loginAdmin(
  email: string,
  password: string,
  totpCode?: string,
): Promise<{ requiresTOTP: boolean }> {
  const data = await request<AuthTokens & { requiresTOTP?: boolean }>('/auth/login-admin', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }),
  })
  if (data.requiresTOTP) return { requiresTOTP: true }
  saveTokens(data.accessToken, data.refreshToken)
  return { requiresTOTP: false }
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
  params: { page?: number; limit?: number; type?: string; status?: string; search?: string; from?: string; to?: string } = {},
) {
  return request<Paginated<AdminTransaction>>(`/admin/transactions${buildQuery(params)}`)
}

export const getKyc = () => request<AdminKyc>('/admin/kyc')

export const getAlerts = () => request<AdminAlerts>('/admin/alerts')

export function getAudit(params: { action?: string; actorId?: string; resource?: string; from?: string; to?: string; take?: number } = {}) {
  return request<AdminAuditEntry[]>(`/admin/audit${buildQuery(params)}`)
}

export interface OperatorRate { name: string; total: number; completed: number; rate: number }
export interface OperatorRatesResponse { operators: OperatorRate[]; period: string }
export const getOperatorRates = () => request<OperatorRatesResponse>('/admin/stats/operator-rates')

export function reviewKyc(userId: string, decision: 'APPROVED' | 'REJECTED' | 'RESUBMIT_REQUIRED', comment?: string) {
  return request(`/admin/kyc/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, comment }),
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

// ── ANIF ──────────────────────────────────────────────────

export interface AnifHighValueTx {
  id: string
  amount: number
  createdAt: string
  sender: { fullName: string | null; phone: string } | null
  receiver: { fullName: string | null; phone: string } | null
  type: string
  status: string
}

export interface AnifFrequentSender {
  senderId: string
  count: number
  totalAmount: number
  phone: string
  fullName: string | null
}

export interface AnifCase {
  id: string
  action: string
  details: string | null
  createdAt: string
  user: { fullName: string | null; phone: string } | null
}

export interface AnifAlertsResponse {
  highValue: AnifHighValueTx[]
  frequentSenders: AnifFrequentSender[]
  cases: AnifCase[]
}

export const getAnifAlerts = () =>
  request<AnifAlertsResponse>('/admin/anif/alerts')

export const openAnifCase = (transactionId: string, reason: string) =>
  request<{ ok: boolean }>('/admin/anif/cases', {
    method: 'POST',
    body: JSON.stringify({ transactionId, reason }),
  })

export function closeAnifCase(caseId: string, resolution: string) {
  return request(`/admin/anif/cases/${caseId}/close`, {
    method: 'PATCH',
    body: JSON.stringify({ resolution }),
  })
}

// ── Opérations OM/MoMo ────────────────────────────────────

export interface AdminOperation {
  id: string
  type: string
  amount: number
  fee: number
  status: string
  operatorRef: string | null
  operator: string | null
  createdAt: string
  sender: { fullName: string | null; phone: string } | null
  receiver: { fullName: string | null; phone: string } | null
  retryCount: number
}

export interface WebhookEvent {
  id: string
  operator: string
  eventType: string
  payload: Record<string, any>
  processed: boolean
  processedAt: string | null
  error: string | null
  createdAt: string
}

export interface OperationsChartPoint {
  date: string // YYYY-MM-DD
  recharge: number // centimes (volume complété)
  withdrawal: number // centimes
}

export interface OperationsResponse {
  data: AdminOperation[]
  total: number
  page: number
  limit: number
  stats: {
    rechargeCount: number
    rechargeTotal: number
    rechargeTrend: number | null
    withdrawalCount: number
    withdrawalTotal: number
    withdrawalTrend: number | null
    pendingWebhooks: number
    successRate: number | null
  }
  chart: OperationsChartPoint[]
  webhookEvents: WebhookEvent[]
}

export const getOperations = (
  page = 1,
  limit = 20,
  params: { operator?: string; status?: string; type?: string; search?: string; period?: string } = {},
) =>
  request<OperationsResponse>(
    '/admin/operations' + buildQuery({ page, limit, ...params }),
  )

export const retryOperation = (id: string) =>
  request<{ ok: boolean }>(`/admin/operations/${id}/retry`, { method: 'POST' })

// ── Santé des intégrations ────────────────────────────────

export interface IntegrationStatus {
  name: string
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN' | 'SIMULATED'
  latency: number | null // ms (ping réel passerelle), null si non mesuré
  txCount24h: number | null // transactions via l'opérateur sur 24h
  lastSuccess: string | null // timestamp dernière transaction réussie
  uptime: number | null // % de succès sur 24h
  pendingWebhooks?: number
  note?: string
}

export interface HealthIntegrationsResponse {
  integrations: IntegrationStatus[]
  stalePendingTx?: number
  checkedAt: string
}

export const getHealthIntegrations = () =>
  request<HealthIntegrationsResponse>('/admin/health/integrations')

// ── Paramètres système ────────────────────────────────────

export interface SystemSettings { [key: string]: string }
export const getSettings = () => request<SystemSettings>('/admin/settings')
export function updateSettings(updates: Record<string, string>) {
  return request('/admin/settings', { method: 'PATCH', body: JSON.stringify({ updates }) })
}

// ── Export CSV ────────────────────────────────────────────

export async function downloadUsersCSV(): Promise<void> {
  const token = getAccess()
  const res = await fetch(`${BASE_URL}/admin/export/users`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Export échoué')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'utilisateurs.csv'; a.click()
  URL.revokeObjectURL(url)
}

export async function downloadTransactionsCSV(): Promise<void> {
  const token = getAccess()
  const res = await fetch(`${BASE_URL}/admin/export/transactions`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Export échoué')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'transactions.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ── Notes internes ────────────────────────────────────────

export interface AdminNote { id: string; content: string; createdAt: string; author: { fullName: string | null; email: string | null } }
export const getAdminNotes = (userId: string) => request<AdminNote[]>(`/admin/users/${userId}/notes`)
export const addAdminNote = (userId: string, content: string) => request<AdminNote>(`/admin/users/${userId}/notes`, { method: 'POST', body: JSON.stringify({ content }) })
export const deleteAdminNote = (noteId: string) => request(`/admin/notes/${noteId}`, { method: 'DELETE' })

// ── 2FA ───────────────────────────────────────────────────

export const setup2FA = () => request<{ otpauthUrl: string; secret: string }>('/auth/2fa/setup', { method: 'POST' })
export const verify2FA = (code: string) => request<{ ok: boolean }>('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) })
export const disable2FA = (code: string) => request<{ ok: boolean }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) })
export const get2FAStatus = () => request<{ totpEnabled: boolean }>('/auth/2fa/status')

// ── SSE : ticket opaque (évite JWT dans l'URL) ───────────
export const getSseTicket = () => request<{ ticket: string }>('/admin/sse-ticket', { method: 'POST' })

// ── Équipe admin ──────────────────────────────────────────

export interface AdminTeamMember {
  id: string
  email: string | null
  fullName: string | null
  adminRole: string | null
  status: string
  lastLoginAt: string | null
  createdAt: string
}
export const getAdminTeam = () => request<AdminTeamMember[]>('/admin/team')
export const setAdminRole = (userId: string, adminRole: string | null) =>
  request(`/admin/team/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ adminRole }) })
// Définit le mot de passe de connexion par-utilisateur d'un admin (SUPER_ADMIN).
export const setAdminPassword = (userId: string, password: string) =>
  request(`/admin/team/${userId}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
// Crée un opérateur admin (SUPER_ADMIN).
export const createAdminOperator = (body: { fullName: string; email: string; adminRole: string; password: string }) =>
  request<AdminTeamMember>('/admin/team', { method: 'POST', body: JSON.stringify(body) })
// Supprime un opérateur admin (SUPER_ADMIN).
export const deleteAdmin = (userId: string) =>
  request(`/admin/team/${userId}`, { method: 'DELETE' })
// Active / désactive un opérateur admin (SUPER_ADMIN).
export const setAdminStatus = (userId: string, active: boolean) =>
  request(`/admin/team/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ active }) })
