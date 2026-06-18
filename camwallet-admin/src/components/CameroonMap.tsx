// Carte de répartition géographique du Cameroun (page Analytique).
// Primaire : Google Maps (@react-google-maps/api) — heatmap + marqueurs par
// région, thème dark CamWallet. Si VITE_GOOGLE_MAPS_API_KEY est absente ou que
// la lib échoue, repli automatique sur une carte SVG d3-geo (vrais contours),
// elle-même repliée sur une carte schématique. Aucune fonctionnalité perdue.
import { Component, useMemo, useState, type ReactNode } from 'react'
import { GoogleMap, useJsApiLoader, HeatmapLayer, Marker, InfoWindow } from '@react-google-maps/api'
import { geoMercator, geoPath } from 'd3-geo'
import { scaleLinear } from 'd3-scale'
import i18n from '../i18n'
import { toFcfa } from '../lib/api'
import geoData from '../assets/cameroon-regions.geo.json'

export interface GeoRegionDatum { name: string; city: string; transactions: number; volume: number }

// Couleurs (thème dark admin).
const BG = '#0A0F1E'
const NO_DATA = '#1e293b'
const GRAD_LO = '#1a4a3a'
const GRAD_HI = '#00C896'
const HOVER = '#34D399'
const STROKE = '#00C896'
const TEXT = '#EEF2FF'
const MUTED = '#64748B'

const fmtFcfa = (centimes: number) => Math.round(toFcfa(centimes)).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA'

function makeColor(regions: GeoRegionDatum[]) {
  const maxVol = Math.max(1, ...regions.map((r) => r.volume))
  const scale = scaleLinear<string>().domain([0, maxVol]).range([GRAD_LO, GRAD_HI]).clamp(true)
  const fillFor = (d: GeoRegionDatum) => (d.transactions > 0 ? (scale(d.volume) as string) : NO_DATA)
  return { maxVol, scale, fillFor }
}
function datumFor(byName: Map<string, GeoRegionDatum>, name: string): GeoRegionDatum {
  return byName.get(name) ?? { name, city: '', transactions: 0, volume: 0 }
}

// ════════════════════════════════════════════════════════════════════════════
// 1) Google Maps
// ════════════════════════════════════════════════════════════════════════════
const CAMEROON_CENTER = { lat: 5.5, lng: 12.3 }
const MAP_ZOOM = 6
const GMAPS_LIBRARIES: ('visualization')[] = ['visualization']

// Coordonnées (ville principale) de chaque région.
const REGION_COORDS: Record<string, { lat: number; lng: number }> = {
  'Littoral': { lat: 4.05, lng: 9.7 },
  'Centre': { lat: 3.86, lng: 11.52 },
  'Ouest': { lat: 5.47, lng: 10.42 },
  'Nord': { lat: 9.3, lng: 13.4 },
  'Extrême-Nord': { lat: 10.59, lng: 14.32 },
  'Adamaoua': { lat: 7.33, lng: 13.58 },
  'Est': { lat: 4.56, lng: 14.33 },
  'Sud': { lat: 2.93, lng: 11.1 },
  'Sud-Ouest': { lat: 4.15, lng: 9.23 },
  'Nord-Ouest': { lat: 5.95, lng: 10.15 },
}

// Style dark CamWallet.
const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#0A0F1E' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#00C896' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0F1E' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#00C896' }, { weight: 2 }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#00C896' }, { weight: 1 }] },
]

function GoogleCameroonMap({ apiKey, regions }: { apiKey: string; regions: GeoRegionDatum[] }) {
  const { isLoaded, loadError } = useJsApiLoader({ id: 'cw-gmaps', googleMapsApiKey: apiKey, libraries: GMAPS_LIBRARIES })
  const [selected, setSelected] = useState<string | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))

  if (loadError) return <SvgFallback regions={regions} />
  if (!isLoaded) return <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, background: BG, borderRadius: 12 }}>{i18n.t('common.loading')}</div>

  const g = (window as any).google
  // Marqueur : gris (0 tx), vert clair (1-50), émeraude + plus gros (50+).
  const iconFor = (tx: number) => {
    const color = tx === 0 ? '#64748B' : tx <= 50 ? '#34D399' : '#00C896'
    const scale = tx > 50 ? 12 : tx > 0 ? 9 : 6
    return { path: g.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 0.95, strokeColor: '#0A0F1E', strokeWeight: 1.5, scale }
  }
  // Heatmap pondérée par le volume.
  const heatmapData = Object.entries(REGION_COORDS)
    .map(([name, c]) => {
      const d = byName.get(name)
      return d && d.transactions > 0 ? { location: new g.maps.LatLng(c.lat, c.lng), weight: toFcfa(d.volume) } : null
    })
    .filter(Boolean) as any[]

  return (
    <div style={{ position: 'relative', background: BG, borderRadius: 12, padding: 8 }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '500px', borderRadius: 10, background: BG }}
        center={CAMEROON_CENTER}
        zoom={MAP_ZOOM}
        options={{ styles: MAP_STYLES as any, disableDefaultUI: true, zoomControl: true, backgroundColor: BG, gestureHandling: 'cooperative' }}
      >
        {heatmapData.length > 0 && (
          <HeatmapLayer data={heatmapData} options={{ radius: 45, opacity: 0.55, gradient: ['rgba(0,200,150,0)', 'rgba(26,74,58,0.6)', 'rgba(0,200,150,0.85)', '#00C896'] }} />
        )}
        {Object.entries(REGION_COORDS).map(([name, c]) => {
          const d = datumFor(byName, name)
          return <Marker key={name} position={c} icon={iconFor(d.transactions)} onClick={() => setSelected(name)} />
        })}
        {selected && (() => {
          const d = datumFor(byName, selected)
          return (
            <InfoWindow position={REGION_COORDS[selected]} onCloseClick={() => setSelected(null)}>
              <div style={{ minWidth: 150, fontFamily: 'Inter, sans-serif' }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#0A0F1E', marginBottom: 3 }}>{selected}</div>
                <div style={{ fontSize: 12, color: '#475569' }}>{i18n.t('analytics.tx_count', { n: d.transactions })}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#008F6A' }}>{fmtFcfa(d.volume)}</div>
              </div>
            </InfoWindow>
          )
        })()}
      </GoogleMap>
      <MarkerLegend />
    </div>
  )
}

function MarkerLegend() {
  const items = [
    { c: '#64748B', label: i18n.t('analytics.geo_legend_none') },
    { c: '#34D399', label: '1–50' },
    { c: '#00C896', label: '50+' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, justifyContent: 'center' }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: it.c }} /> {it.label}
        </span>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 2) Repli : carte SVG d3-geo (vrais contours)
// ════════════════════════════════════════════════════════════════════════════
const W = 800, H = 600

function SvgMap({ regions }: { regions: GeoRegionDatum[] }) {
  const [hover, setHover] = useState<{ datum: GeoRegionDatum; x: number; y: number } | null>(null)
  const byName = new Map(regions.map((r) => [r.name, r]))
  const { maxVol, scale, fillFor } = makeColor(regions)
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, c: f === 0 ? NO_DATA : (scale(maxVol * f) as string) }))

  const shapes = useMemo(() => {
    const projection = geoMercator().fitSize([W, H], geoData as any)
    const path = geoPath(projection)
    return (geoData as any).features.map((f: any) => ({ name: f.properties.name as string, d: path(f) ?? '', centroid: path.centroid(f) as [number, number] }))
  }, [])

  return (
    <div style={{ position: 'relative', background: BG, borderRadius: 12, padding: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: BG, display: 'block' }}>
        {shapes.map((s: any) => {
          const datum = datumFor(byName, s.name)
          return (
            <path key={s.name} d={s.d} fill={hover?.datum.name === s.name ? HOVER : fillFor(datum)} stroke={STROKE} strokeOpacity={0.5} strokeWidth={0.5}
              onMouseEnter={(e) => setHover({ datum, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
              onMouseLeave={() => setHover(null)} style={{ transition: 'fill .2s', cursor: 'pointer' }} />
          )
        })}
        {shapes.map((s: any) => (
          <text key={`l-${s.name}`} x={s.centroid[0]} y={s.centroid[1]} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill={TEXT} pointerEvents="none"
            style={{ paintOrder: 'stroke', stroke: '#0A0F1E', strokeWidth: 2.5, strokeLinejoin: 'round' }}>{s.name}</text>
        ))}
      </svg>
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

// ════════════════════════════════════════════════════════════════════════════
// 3) Repli ultime : carte schématique dessinée à la main
// ════════════════════════════════════════════════════════════════════════════
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
        {Object.entries(SCHEMATIC).map(([name, pos]) => {
          const datum = datumFor(byName, name)
          return (
            <g key={name} onMouseEnter={(e) => setHover({ datum, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
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

class FallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// Carte SVG + repli schématique.
function SvgFallback({ regions }: { regions: GeoRegionDatum[] }) {
  const hasGeo = (geoData as any)?.features?.length > 0
  if (!hasGeo) return <SchematicMap regions={regions} />
  return <FallbackBoundary fallback={<SchematicMap regions={regions} />}><SvgMap regions={regions} /></FallbackBoundary>
}

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

// Bandeau explicite quand la clé manque (au lieu d'un fond vide/vert), suivi de
// la carte SVG de secours pour conserver l'affichage des données.
function MissingKeyPanel({ regions }: { regions: GeoRegionDatum[] }) {
  return (
    <div style={{ background: BG, borderRadius: 12, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', marginBottom: 8, color: '#FBBF24', fontSize: 12.5, fontWeight: 600 }}>
        ⚠️ {i18n.t('analytics.geo_missing_key')}
      </div>
      <SvgFallback regions={regions} />
    </div>
  )
}

export default function CameroonGeoMap({ regions }: { regions: GeoRegionDatum[] }) {
  // Sans clé Google Maps → message explicite + carte SVG d3-geo (jamais de fond vert).
  if (!GMAPS_KEY) {
    console.error('[CameroonMap] VITE_GOOGLE_MAPS_API_KEY manquante : la carte Google Maps ne peut pas se charger. Repli sur la carte SVG. Définir la variable dans .env.local (dev) et dans Vercel (prod).')
    return <MissingKeyPanel regions={regions} />
  }
  // Avec clé → Google Maps ; si la lib plante, repli sur la carte SVG.
  return <FallbackBoundary fallback={<SvgFallback regions={regions} />}><GoogleCameroonMap apiKey={GMAPS_KEY} regions={regions} /></FallbackBoundary>
}
