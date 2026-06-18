// Carte choroplèthe du Cameroun (heatmap des transactions par région).
// react-simple-maps + d3-scale. GeoJSON des 10 régions EMBARQUÉ ci-dessous
// (aucun fetch, noms en français = clés directes des données API).
// Si le rendu échoue, repli sur une carte schématique dessinée à la main.
import { Component, useState, type ReactNode } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { scaleLinear } from 'd3-scale'
import i18n from '../i18n'
import { toFcfa } from '../lib/api'

export interface GeoRegionDatum { name: string; city: string; transactions: number; volume: number }

// Couleurs (thème dark admin).
const BG = '#0A0F1E'       // fond du conteneur
const NO_DATA = '#1e293b'  // région sans transaction
const GRAD_LO = '#1a4a3a'  // volume faible
const GRAD_HI = '#00C896'  // volume élevé (émeraude)
const HOVER = '#34D399'    // survol (émeraude clair)
const STROKE = '#00C896'
const TEXT = '#EEF2FF'
const MUTED = '#64748B'

// ── GeoJSON embarqué : 10 régions du Cameroun (coordonnées lon/lat) ──────────
const CAMEROON_REGIONS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Adamaoua' }, geometry: { type: 'Polygon', coordinates: [[[12.5, 6.5], [15.5, 6.5], [15.5, 8.5], [12.5, 8.5], [12.5, 6.5]]] } },
    { type: 'Feature', properties: { name: 'Centre' }, geometry: { type: 'Polygon', coordinates: [[[10.5, 3.2], [13.5, 3.2], [13.5, 6.5], [10.5, 6.5], [10.5, 3.2]]] } },
    { type: 'Feature', properties: { name: 'Est' }, geometry: { type: 'Polygon', coordinates: [[[13.5, 2.0], [16.2, 2.0], [16.2, 6.5], [13.5, 6.5], [13.5, 2.0]]] } },
    { type: 'Feature', properties: { name: 'Extrême-Nord' }, geometry: { type: 'Polygon', coordinates: [[[13.5, 10.0], [15.5, 10.0], [15.5, 13.0], [13.5, 13.0], [13.5, 10.0]]] } },
    { type: 'Feature', properties: { name: 'Littoral' }, geometry: { type: 'Polygon', coordinates: [[[9.0, 3.2], [10.5, 3.2], [10.5, 5.0], [9.0, 5.0], [9.0, 3.2]]] } },
    { type: 'Feature', properties: { name: 'Nord' }, geometry: { type: 'Polygon', coordinates: [[[12.5, 8.5], [15.5, 8.5], [15.5, 10.0], [12.5, 10.0], [12.5, 8.5]]] } },
    { type: 'Feature', properties: { name: 'Nord-Ouest' }, geometry: { type: 'Polygon', coordinates: [[[9.0, 5.5], [11.0, 5.5], [11.0, 7.0], [9.0, 7.0], [9.0, 5.5]]] } },
    { type: 'Feature', properties: { name: 'Ouest' }, geometry: { type: 'Polygon', coordinates: [[[9.8, 4.8], [11.0, 4.8], [11.0, 6.0], [9.8, 6.0], [9.8, 4.8]]] } },
    { type: 'Feature', properties: { name: 'Sud' }, geometry: { type: 'Polygon', coordinates: [[[10.0, 2.0], [13.5, 2.0], [13.5, 3.5], [10.0, 3.5], [10.0, 2.0]]] } },
    { type: 'Feature', properties: { name: 'Sud-Ouest' }, geometry: { type: 'Polygon', coordinates: [[[8.5, 3.8], [10.0, 3.8], [10.0, 5.5], [8.5, 5.5], [8.5, 3.8]]] } },
  ],
}
const REGION_NAMES = CAMEROON_REGIONS.features.map((f) => f.properties.name)

const fmtFcfa = (centimes: number) => Math.round(toFcfa(centimes)).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA'

// Échelle de couleur partagée (carte + repli). Toujours 10 régions : celles sans
// transaction prennent NO_DATA, les autres le gradient selon le volume.
function makeColor(regions: GeoRegionDatum[]) {
  const maxVol = Math.max(1, ...regions.map((r) => r.volume))
  const scale = scaleLinear<string>().domain([0, maxVol]).range([GRAD_LO, GRAD_HI]).clamp(true)
  const fillFor = (d: GeoRegionDatum | null | undefined) => (d && d.transactions > 0 ? (scale(d.volume) as string) : NO_DATA)
  return { maxVol, scale, fillFor }
}

// Données pour une région nommée (0 par défaut → toutes les régions s'affichent).
function datumFor(byName: Map<string, GeoRegionDatum>, name: string): GeoRegionDatum {
  return byName.get(name) ?? { name, city: '', transactions: 0, volume: 0 }
}

// ── Carte choroplèthe (react-simple-maps) ───────────────────────────────────
function MapInner({ regions }: { regions: GeoRegionDatum[] }) {
  const [hover, setHover] = useState<{ datum: GeoRegionDatum; x: number; y: number } | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))
  const { maxVol, scale, fillFor } = makeColor(regions)
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, c: f === 0 ? NO_DATA : (scale(maxVol * f) as string) }))

  return (
    <div style={{ position: 'relative', background: BG, borderRadius: 12, padding: 8 }}>
      <ComposableMap
        projection="geoMercator"
        width={800}
        height={600}
        projectionConfig={{ center: [12.5, 5.5], scale: 2500 }}
        style={{ width: '100%', height: 'auto', background: BG }}
      >
        <Geographies geography={CAMEROON_REGIONS as any}>
          {({ geographies }: any) =>
            geographies.map((geo: any) => {
              const datum = datumFor(byName, geo.properties.name)
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fillFor(datum)}
                  stroke={STROKE}
                  strokeWidth={0.5}
                  onMouseEnter={(e: any) => setHover({ datum, x: e.clientX, y: e.clientY })}
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

function Tooltip({ hover }: { hover: { datum: GeoRegionDatum; x: number; y: number } | null }) {
  if (!hover) return null
  return (
    <div style={{ position: 'fixed', left: hover.x + 14, top: hover.y + 14, zIndex: 50, pointerEvents: 'none', background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, padding: '8px 11px', boxShadow: '0 10px 30px -10px #000A' }}>
      <div style={{ color: TEXT, fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{hover.datum.name}</div>
      <div style={{ color: '#94A3B8', fontSize: 11 }}>{i18n.t('analytics.tx_count', { n: hover.datum.transactions })}</div>
      <div style={{ color: hover.datum.transactions > 0 ? GRAD_HI : MUTED, fontSize: 12, fontWeight: 700 }}>{fmtFcfa(hover.datum.volume)}</div>
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
const SCHEMATIC: Record<string, { x: number; y: number }> = {
  'Extrême-Nord': { x: 52, y: 5 }, 'Nord': { x: 50, y: 20 }, 'Adamaoua': { x: 56, y: 35 },
  'Nord-Ouest': { x: 26, y: 49 }, 'Ouest': { x: 36, y: 57 }, 'Est': { x: 74, y: 52 },
  'Centre': { x: 53, y: 62 }, 'Littoral': { x: 33, y: 70 }, 'Sud-Ouest': { x: 18, y: 66 }, 'Sud': { x: 50, y: 82 },
}

function SchematicMap({ regions }: { regions: GeoRegionDatum[] }) {
  const [hover, setHover] = useState<{ datum: GeoRegionDatum; x: number; y: number } | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))
  const { maxVol, scale, fillFor } = makeColor(regions)
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, c: f === 0 ? NO_DATA : (scale(maxVol * f) as string) }))
  const TW = 17, TH = 9

  return (
    <div style={{ position: 'relative', background: BG, borderRadius: 12, padding: 8 }}>
      <svg viewBox="0 0 100 92" style={{ width: '100%', height: 'auto', maxHeight: 420 }}>
        {REGION_NAMES.map((name) => {
          const pos = SCHEMATIC[name]
          const datum = datumFor(byName, name)
          return (
            <g key={name}
              onMouseEnter={(e) => setHover({ datum, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}>
              <rect x={pos.x - TW / 2} y={pos.y - TH / 2} width={TW} height={TH} rx={1.5} fill={fillFor(datum)} stroke={STROKE} strokeWidth={0.4} />
              <text x={pos.x} y={pos.y + 1.4} textAnchor="middle" fontSize={2.4} fontWeight={700} fill={TEXT}>{name}</text>
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
  return (
    <GeoErrorBoundary regions={regions}>
      <MapInner regions={regions} />
    </GeoErrorBoundary>
  )
}
