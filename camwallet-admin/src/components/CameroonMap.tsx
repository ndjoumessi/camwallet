// Carte choroplèthe du Cameroun (heatmap des transactions par région).
// react-simple-maps + d3-scale, GeoJSON ADM1 embarqué (assets/cameroon-regions).
// Si le rendu échoue (lib absente / GeoJSON invalide), bascule sur une carte
// schématique dessinée à la main (10 régions positionnées).
import { Component, useState, type ReactNode } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { scaleLinear } from 'd3-scale'
import i18n from '../i18n'
import { toFcfa } from '../lib/api'
import geoData from '../assets/cameroon-regions.geo.json'

export interface GeoRegionDatum { name: string; city: string; transactions: number; volume: number }

// Couleurs (thème dark admin).
const NO_DATA = '#1e293b'  // région sans transaction
const GRAD_LO = '#1a4a3a'  // volume faible
const GRAD_HI = '#00C896'  // volume élevé (émeraude)
const HOVER = '#34D399'    // survol (émeraude clair — jamais jaune)
const STROKE = '#0A0F1E'
const TEXT = '#EEF2FF'
const MUTED = '#64748B'

// Le GeoJSON geoBoundaries nomme les régions en anglais → noms backend (fr).
const EN_TO_FR: Record<string, string> = {
  'Centre': 'Centre', 'Far North': 'Extrême-Nord', 'North': 'Nord', 'North-West': 'Nord-Ouest',
  'Adamaoua': 'Adamaoua', 'East': 'Est', 'South': 'Sud', 'South-West': 'Sud-Ouest',
  'West': 'Ouest', 'Littoral': 'Littoral',
}

const fmtFcfa = (centimes: number) => Math.round(toFcfa(centimes)).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA'

// Échelle de couleur partagée (carte + repli).
function makeColor(regions: GeoRegionDatum[]) {
  const maxVol = Math.max(1, ...regions.map((r) => r.volume))
  const scale = scaleLinear<string>().domain([0, maxVol]).range([GRAD_LO, GRAD_HI]).clamp(true)
  const fillFor = (d: GeoRegionDatum | null) => (d && d.transactions > 0 ? (scale(d.volume) as string) : NO_DATA)
  return { maxVol, scale, fillFor }
}

// ── Carte choroplèthe (react-simple-maps) ───────────────────────────────────
function MapInner({ regions }: { regions: GeoRegionDatum[] }) {
  const [hover, setHover] = useState<{ datum: GeoRegionDatum | null; name: string; x: number; y: number } | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))
  const { maxVol, scale, fillFor } = makeColor(regions)
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, c: f === 0 ? NO_DATA : (scale(maxVol * f) as string) }))

  return (
    <div style={{ position: 'relative' }}>
      <ComposableMap
        projection="geoMercator"
        width={420}
        height={480}
        projectionConfig={{ center: [12.35, 7.35], scale: 2100 }}
        style={{ width: '100%', height: 'auto', background: 'transparent' }}
      >
        <Geographies geography={geoData as any}>
          {({ geographies }: any) =>
            geographies.map((geo: any) => {
              const fr = EN_TO_FR[geo.properties.name] ?? geo.properties.name
              const datum = byName.get(fr) ?? null
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fillFor(datum)}
                  stroke={STROKE}
                  strokeWidth={0.7}
                  onMouseEnter={(e: any) => setHover({ datum, name: fr, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e: any) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    default: { outline: 'none', transition: 'fill .2s' },
                    hover: { outline: 'none', fill: HOVER, cursor: 'pointer' },
                    pressed: { outline: 'none', fill: HOVER },
                  }}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>
      <Tooltip hover={hover} />
      <Legend steps={steps} maxVol={maxVol} />
    </div>
  )
}

function Tooltip({ hover }: { hover: { datum: GeoRegionDatum | null; name: string; x: number; y: number } | null }) {
  if (!hover) return null
  return (
    <div style={{ position: 'fixed', left: hover.x + 14, top: hover.y + 14, zIndex: 50, pointerEvents: 'none', background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, padding: '8px 11px', boxShadow: '0 10px 30px -10px #000A' }}>
      <div style={{ color: TEXT, fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{hover.name}</div>
      {hover.datum && hover.datum.transactions > 0 ? (
        <>
          <div style={{ color: '#94A3B8', fontSize: 11 }}>{i18n.t('analytics.tx_count', { n: hover.datum.transactions })}</div>
          <div style={{ color: GRAD_HI, fontSize: 12, fontWeight: 700 }}>{fmtFcfa(hover.datum.volume)}</div>
        </>
      ) : (
        <div style={{ color: MUTED, fontSize: 11 }}>{i18n.t('analytics.no_data')}</div>
      )}
    </div>
  )
}

function Legend({ steps, maxVol }: { steps: { f: number; c: string }[]; maxVol: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, justifyContent: 'center' }}>
      <span style={{ fontSize: 10, color: MUTED }}>{i18n.t('analytics.geo_legend_low')}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {steps.map((s, i) => <span key={i} title={s.f === 0 ? '0' : fmtFcfa(maxVol * s.f)} style={{ width: 26, height: 10, borderRadius: 2, background: s.c }} />)}
      </div>
      <span style={{ fontSize: 10, color: MUTED }}>{i18n.t('analytics.geo_legend_high')}</span>
    </div>
  )
}

// ── Repli : carte schématique dessinée à la main (positions approximatives) ──
// Disposition grossière du Cameroun (nord en haut), 10 régions en tuiles.
const SCHEMATIC: Record<string, { x: number; y: number }> = {
  'Extrême-Nord': { x: 52, y: 5 },
  'Nord': { x: 50, y: 20 },
  'Adamaoua': { x: 56, y: 35 },
  'Nord-Ouest': { x: 26, y: 49 },
  'Ouest': { x: 36, y: 57 },
  'Est': { x: 74, y: 52 },
  'Centre': { x: 53, y: 62 },
  'Littoral': { x: 33, y: 70 },
  'Sud-Ouest': { x: 18, y: 66 },
  'Sud': { x: 50, y: 82 },
}

function SchematicMap({ regions }: { regions: GeoRegionDatum[] }) {
  const [hover, setHover] = useState<{ datum: GeoRegionDatum | null; name: string; x: number; y: number } | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))
  const { maxVol, scale, fillFor } = makeColor(regions)
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, c: f === 0 ? NO_DATA : (scale(maxVol * f) as string) }))
  const TW = 17, TH = 9 // taille tuile (en % du viewBox)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox="0 0 100 92" style={{ width: '100%', height: 'auto', maxHeight: 420 }}>
        {Object.entries(SCHEMATIC).map(([name, pos]) => {
          const datum = byName.get(name) ?? null
          return (
            <g key={name}
              onMouseEnter={(e) => setHover({ datum, name, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}>
              <rect x={pos.x - TW / 2} y={pos.y - TH / 2} width={TW} height={TH} rx={1.5}
                fill={fillFor(datum)} stroke={STROKE} strokeWidth={0.4} />
              <text x={pos.x} y={pos.y + 1.4} textAnchor="middle" fontSize={2.6} fontWeight={700} fill={TEXT}>{name}</text>
            </g>
          )
        })}
      </svg>
      <Tooltip hover={hover} />
      <Legend steps={steps} maxVol={maxVol} />
    </div>
  )
}

// ── Frontière d'erreur : repli sur la carte schématique si la lib plante ────
class GeoErrorBoundary extends Component<{ regions: GeoRegionDatum[]; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <SchematicMap regions={this.props.regions} />
    return this.props.children
  }
}

export default function CameroonGeoMap({ regions }: { regions: GeoRegionDatum[] }) {
  // GeoJSON absent/vide → carte schématique.
  const ok = (geoData as any)?.features?.length > 0
  if (!ok) return <SchematicMap regions={regions} />
  return (
    <GeoErrorBoundary regions={regions}>
      <MapInner regions={regions} />
    </GeoErrorBoundary>
  )
}
