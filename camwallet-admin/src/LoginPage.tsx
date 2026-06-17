import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { loginAdmin } from './lib/api'

// Palette alignée sur App.tsx
const C = {
  bg: '#0A0F1E', surface: '#111827', card: '#161D2F', border: '#1E2D45',
  green: '#00C896', red: '#FF4D6D', redLight: '#FF4D6D15',
  text: '#EEF2FF', textMuted: '#64748B', textSoft: '#94A3B8',
}

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('admin@camwallet.cm')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totpRequired, setTotpRequired] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await loginAdmin(email.trim(), password, totpRequired ? totpCode.trim() : undefined)
      if (res.requiresTOTP) {
        // 2FA activée : on passe à l'étape de saisie du code TOTP.
        setTotpRequired(true)
        setLoading(false)
        return
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.error_fallback'))
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
            <div style={{ fontSize: 11, color: C.textMuted }}>{t('nav.admin_panel')}</div>
          </div>
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 6 }}>{t('login.title')}</h1>
        <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 22 }}>
          {t('login.subtitle')}
        </p>

        <label style={{ fontSize: 12, color: C.textSoft, fontWeight: 600, display: 'block', marginBottom: 6 }}>
          {t('login.label_email')}
        </label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@camwallet.cm" autoComplete="username"
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        <label style={{ fontSize: 12, color: C.textSoft, fontWeight: 600, display: 'block', marginBottom: 6 }}>
          {t('login.label_password')}
        </label>
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <input
            type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="current-password"
            disabled={totpRequired}
            style={{ ...inputStyle, paddingRight: 44, opacity: totpRequired ? 0.6 : 1 }}
          />
          <button
            type="button" onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t('login.hide_password') : t('login.show_password')}
            disabled={totpRequired}
            style={{
              position: 'absolute', top: 0, bottom: 0, right: 6, margin: 'auto',
              height: 32, width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', color: C.textMuted,
              cursor: totpRequired ? 'not-allowed' : 'pointer', padding: 0,
            }}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {totpRequired && (
          <>
            <label style={{ fontSize: 12, color: C.textSoft, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              {t('login.label_totp')}
            </label>
            <input
              type="text" inputMode="numeric" value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456" autoComplete="one-time-code" autoFocus
              style={{ ...inputStyle, marginBottom: 20, letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
            />
          </>
        )}

        {error && (
          <div style={{
            background: C.redLight, border: `1px solid ${C.red}40`, color: C.red,
            borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {(() => {
          const disabled = loading || !email || !password || (totpRequired && totpCode.length !== 6)
          return (
            <button
              className="cw-btn"
              type="submit" disabled={disabled}
              style={{
                width: '100%', background: disabled ? C.green + '60' : C.green,
                border: 'none', borderRadius: 10, padding: '12px', color: '#fff',
                fontWeight: 700, fontSize: 14,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? t('login.submit_loading') : totpRequired ? t('login.submit_verify') : t('login.submit')}
            </button>
          )
        })()}
      </form>
    </div>
  )
}
