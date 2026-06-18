// Carte choroplèthe du Cameroun (heatmap des transactions par région).
// react-simple-maps + d3-scale, GeoJSON ADM1 embarqué (assets/cameroon-regions).
// Si le rendu échoue (lib absente / GeoJSON invalide), bascule sur des barres.
import { Component, useState, type ReactNode } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { scaleLinear } from 'd3-scale'
import i18n from '../i18n'
import { toFcfa } from '../lib/api'
import geoData from '../assets/cameroon-regions.geo.json'

export interface GeoRegionDatum { name: string; city: string; transactions: number; volume: number }

// Couleurs (alignées sur les design tokens admin).
const GREY = '#1E2D45'
const EMERALD = '#00C896'
const BORDER = '#0A0F1E'
const TEXT = '#EEF2FF'
const MUTED = '#64748B'

// Le GeoJSON geoBoundaries nomme les régions en anglais → noms backend (fr).
const EN_TO_FR: Record<string, string> = {
  'Centre': 'Centre', 'Far North': 'Extrême-Nord', 'North': 'Nord', 'North-West': 'Nord-Ouest',
  'Adamaoua': 'Adamaoua', 'East': 'Est', 'South': 'Sud', 'South-West': 'Sud-Ouest',
  'West': 'Ouest', 'Littoral': 'Littoral',
}

const fmtFcfa = (centimes: number) => Math.round(toFcfa(centimes)).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA'

// ── Repli : liste de barres (réutilise l'ancien rendu) ──────────────────────
function GeoBars({ regions }: { regions: GeoRegionDatum[] }) {
  if (!regions.length) return <div style={{ color: MUTED, fontSize: 13 }}>{i18n.t('analytics.no_data')}</div>
  const max = Math.max(1, ...regions.map((r) => toFcfa(r.volume)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {regions.map((r) => (
        <div key={r.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: '#94A3B8' }}>{r.name} <span style={{ color: MUTED }}>· {i18n.t('analytics.tx_count', { n: r.transactions })}</span></span>
            <span style={{ color: EMERALD, fontWeight: 700 }}>{fmtFcfa(r.volume)}</span>
          </div>
          <div style={{ height: 8, background: GREY, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round((toFcfa(r.volume) / max) * 100)}%`, background: '#3B82F6', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Carte choroplèthe ───────────────────────────────────────────────────────
function MapInner({ regions }: { regions: GeoRegionDatum[] }) {
  const [hover, setHover] = useState<{ datum: GeoRegionDatum | null; name: string; x: number; y: number } | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))
  const maxVol = Math.max(1, ...regions.map((r) => r.volume))
  const color = scaleLinear<string>().domain([0, maxVol]).range(['#243049', EMERALD]).clamp(true)

  // Paliers de légende.
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, c: f === 0 ? '#243049' : color(maxVol * f) as string }))

  return (
    <div style={{ position: 'relative' }}>
      <ComposableMap projection="geoMercator" projectionConfig={{ center: [12.7, 5.7], scale: 1900 }} height={360} style={{ width: '100%', height: 'auto' }}>
        <Geographies geography={geoData as any}>
          {({ geographies }: any) =>
            geographies.map((geo: any) => {
              const fr = EN_TO_FR[geo.properties.name] ?? geo.properties.name
              const datum = byName.get(fr) ?? null
              const fill = datum ? (color(datum.volume) as string) : GREY
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fill}
                  stroke={BORDER}
                  strokeWidth={0.6}
                  onMouseEnter={(e: any) => setHover({ datum, name: fr, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e: any) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    default: { outline: 'none', transition: 'fill .2s' },
                    hover: { outline: 'none', fill: '#F5C542', cursor: 'pointer' },
                    pressed: { outline: 'none' },
                  }}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Tooltip suspendu au curseur (position fixe par rapport au viewport) */}
      {hover && (
        <div style={{ position: 'fixed', left: hover.x + 14, top: hover.y + 14, zIndex: 50, pointerEvents: 'none', background: '#111827', border: `1px solid ${GREY}`, borderRadius: 8, padding: '8px 11px', boxShadow: '0 10px 30px -10px #000A' }}>
          <div style={{ color: TEXT, fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{hover.name}</div>
          {hover.datum ? (
            <>
              <div style={{ color: '#94A3B8', fontSize: 11 }}>{i18n.t('analytics.tx_count', { n: hover.datum.transactions })}</div>
              <div style={{ color: EMERALD, fontSize: 12, fontWeight: 700 }}>{fmtFcfa(hover.datum.volume)}</div>
            </>
          ) : (
            <div style={{ color: MUTED, fontSize: 11 }}>{i18n.t('analytics.no_data')}</div>
          )}
        </div>
      )}

      {/* Légende : 5 paliers gris → émeraude */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 10, color: MUTED }}>{i18n.t('analytics.geo_legend_low')}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {steps.map((s, i) => <span key={i} title={s.f === 0 ? '0' : fmtFcfa(maxVol * s.f)} style={{ width: 26, height: 10, borderRadius: 2, background: s.c }} />)}
        </div>
        <span style={{ fontSize: 10, color: MUTED }}>{i18n.t('analytics.geo_legend_high')}</span>
      </div>
    </div>
  )
}

// ── Frontière d'erreur : repli sur les barres si la carte plante ────────────
class GeoErrorBoundary extends Component<{ regions: GeoRegionDatum[]; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <GeoBars regions={this.props.regions} />
    return this.props.children
  }
}

export default function CameroonGeoMap({ regions }: { regions: GeoRegionDatum[] }) {
  // Garde-fou supplémentaire : GeoJSON vide → barres.
  const ok = (geoData as any)?.features?.length > 0
  if (!ok) return <GeoBars regions={regions} />
  return (
    <GeoErrorBoundary regions={regions}>
      <MapInner regions={regions} />
    </GeoErrorBoundary>
  )
}
