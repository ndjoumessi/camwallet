import { useState } from 'react'
import { loginAdmin } from './lib/api'

// Palette alignée sur App.tsx
const C = {
  bg: '#0A0F1E', surface: '#111827', card: '#161D2F', border: '#1E2D45',
  green: '#00C896', red: '#FF4D6D', redLight: '#FF4D6D15',
  text: '#EEF2FF', textMuted: '#64748B', textSoft: '#94A3B8',
}

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('admin@camwallet.cm')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await loginAdmin(email.trim(), password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la connexion')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 14, outline: 'none',
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: C.bg, fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <form onSubmit={submit} style={{
        width: 360, background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 18, padding: '32px 28px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, background: C.green,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 900, color: '#fff',
          }}>₩</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>
              Cam<span style={{ color: C.green }}>Wallet</span>
            </div>
            <div style={{ fontSize: 11, color: C.textMuted }}>Admin Panel</div>
          </div>
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 6 }}>Connexion</h1>
        <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 22 }}>
          Accès réservé aux administrateurs.
        </p>

        <label style={{ fontSize: 12, color: C.textSoft, fontWeight: 600, display: 'block', marginBottom: 6 }}>
          Email
        </label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@camwallet.cm" autoComplete="username"
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        <label style={{ fontSize: 12, color: C.textSoft, fontWeight: 600, display: 'block', marginBottom: 6 }}>
          Mot de passe
        </label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••" autoComplete="current-password"
          style={{ ...inputStyle, marginBottom: 20 }}
        />

        {error && (
          <div style={{
            background: C.redLight, border: `1px solid ${C.red}40`, color: C.red,
            borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit" disabled={loading || !email || !password}
          style={{
            width: '100%', background: loading || !email || !password ? C.green + '60' : C.green,
            border: 'none', borderRadius: 10, padding: '12px', color: '#fff',
            fontWeight: 700, fontSize: 14,
            cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
