// Carte de répartition géographique du Cameroun (page Analytique).
// Primaire : OpenStreetMap via Leaflet (react-leaflet) — tuiles OSM assombries
// (filtre CSS) au thème dark CamWallet, polygones + cercles + marqueurs par
// région. Aucune clé API. Si Leaflet échoue, repli automatique sur une carte SVG
// d3-geo (vrais contours), elle-même repliée sur une carte schématique.
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Polygon, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
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
// 1) OpenStreetMap (Leaflet)
// ════════════════════════════════════════════════════════════════════════════
const CAMEROON_CENTER = { lat: 5.5, lng: 12.5 }
const MAP_ZOOM = 6
// Bornes géographiques SERRÉES du Cameroun pour fitBounds : SW côte atlantique
// (1.65, 8.4) → NE lac Tchad (13.1, 16.2). On cadre exactement le pays.
const CAMEROON_FIT_BOUNDS = { north: 13.1, south: 1.65, west: 8.4, east: 16.2 }

// Décalages manuels (degrés) de certains labels de régions du sud (petites, labels qui
// se chevauchent). Les régions absentes utilisent le centroïde exact.
const LABEL_OFFSETS: Record<string, { lat: number; lng: number }> = {
  'Littoral': { lat: -0.3, lng: -0.5 },
  'Ouest': { lat: 0.2, lng: -0.8 },
  'Sud-Ouest': { lat: -0.3, lng: -0.8 },
  'Nord-Ouest': { lat: 0.3, lng: -0.5 },
  'Centre': { lat: 0.0, lng: 0.5 },
  'Sud': { lat: -0.5, lng: 0.3 },
}

// GeoJSON distant des 10 régions (geoBoundaries CMR/ADM1, simplifié) — URL épinglée
// sur un commit (stable) et servie avec CORS (access-control-allow-origin: *). Les
// libellés sont en anglais : rattachés à nos noms FR par centroïde (canonicalRegionName).
// Si indisponible, repli silencieux sur les polygones embarqués (assets/cameroon-regions.geo.json).
// NB : media.githubusercontent.com doit figurer dans connect-src de la CSP (vercel.json).
const REMOTE_REGIONS_URL = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen/CMR/ADM1/geoBoundaries-CMR-ADM1_simplified.geojson'

interface RegionPoly { name: string; paths: { lat: number; lng: number }[][]; center: { lat: number; lng: number } }

// Vrai centroïde (pondéré par l'aire) de l'anneau le plus grand — garantit que le
// label tombe à l'intérieur de la masse principale de la région (pas décalé vers
// les sommets denses, comme le ferait une simple moyenne des points).
function ringCentroid(ring: { lat: number; lng: number }[]) {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]
    const cross = p.lng * q.lat - q.lng * p.lat
    a += cross; cx += (p.lng + q.lng) * cross; cy += (p.lat + q.lat) * cross
  }
  if (!a) { // anneau dégénéré → moyenne des sommets
    const m = ring.reduce((s, p) => ({ lat: s.lat + p.lat, lng: s.lng + p.lng }), { lat: 0, lng: 0 })
    return { lat: m.lat / ring.length, lng: m.lng / ring.length, area: 0 }
  }
  return { lat: cy / (3 * a), lng: cx / (3 * a), area: Math.abs(a / 2) }
}
function centroidOfPaths(paths: { lat: number; lng: number }[][]) {
  let best = { lat: 0, lng: 0, area: -1 }
  for (const ring of paths) {
    const c = ringCentroid(ring)
    if (c.area > best.area) best = c
  }
  return { lat: best.lat, lng: best.lng }
}

// Si le nom distant n'est pas l'un de nos 10 noms FR, on le rattache à la région
// canonique dont la ville principale est la plus proche du centroïde (robuste aux
// libellés étrangers d'une source distante).
function canonicalRegionName(name: string, center: { lat: number; lng: number }): string {
  if (REGION_COORDS[name]) return name
  let best = name, bd = Infinity
  for (const [rn, c] of Object.entries(REGION_COORDS)) {
    const dx = c.lng - center.lng, dy = c.lat - center.lat, d = dx * dx + dy * dy
    if (d < bd) { bd = d; best = rn }
  }
  return best
}

// FeatureCollection (Polygon|MultiPolygon, coords [lng,lat]) → liste RegionPoly.
function featuresToRegions(fc: any): RegionPoly[] {
  const out: RegionPoly[] = []
  for (const f of fc?.features ?? []) {
    const geom = f?.geometry
    if (!geom) continue
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : []
    const paths: { lat: number; lng: number }[][] = []
    for (const poly of polys) for (const ring of poly) paths.push(ring.map(([lng, lat]: number[]) => ({ lat, lng })))
    if (!paths.length) continue
    const center = centroidOfPaths(paths)
    const rawName = f.properties?.name ?? f.properties?.NAME_1 ?? f.properties?.region ?? ''
    out.push({ name: canonicalRegionName(rawName, center), paths, center })
  }
  return out
}

// Décodeur TopoJSON minimal (arcs + delta + quantification) → FeatureCollection.
function topojsonToFC(topo: any): any {
  const obj = topo.objects[Object.keys(topo.objects)[0]]
  const t = topo.transform
  const decode = (arc: number[][]) => {
    let x = 0, y = 0
    return arc.map(([dx, dy]) => { x += dx; y += dy; return t ? [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]] : [x, y] })
  }
  const arcs = topo.arcs.map(decode)
  const getArc = (i: number) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i])
  const ring = (idxs: number[]) => { const c: number[][] = []; idxs.forEach((ai, k) => { const pts = getArc(ai); c.push(...(k > 0 ? pts.slice(1) : pts)) }); return c }
  const toGeom = (g: any) => g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.arcs.map(ring) } : g.type === 'MultiPolygon' ? { type: 'MultiPolygon', coordinates: g.arcs.map((rs: number[][]) => rs.map(ring)) } : null
  return { type: 'FeatureCollection', features: obj.geometries.map((g: any) => ({ type: 'Feature', properties: g.properties || {}, geometry: toGeom(g) })).filter((f: any) => f.geometry) }
}

// Polygones des régions : embarqués d'emblée, « surclassés » par la source distante
// si elle répond (sinon on garde l'embarqué — aucun affichage perdu).
function useRegionPolygons(): RegionPoly[] {
  const embedded = useMemo(() => featuresToRegions(geoData as any), [])
  const [polys, setPolys] = useState<RegionPoly[]>(embedded)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(REMOTE_REGIONS_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const fc = json?.type === 'Topology' ? topojsonToFC(json) : json
        const regs = featuresToRegions(fc)
        if (!cancelled && regs.length >= 10) setPolys(regs)
      } catch {
        /* repli silencieux : les polygones embarqués sont déjà affichés */
      }
    })()
    return () => { cancelled = true }
  }, [embedded])
  return polys
}

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

// Tuiles OpenStreetMap standard (usage conforme à la tile policy : attribution
// visible, trafic admin faible). Assombries par filtre CSS pour le thème dark.
// NB : tile.openstreetmap.org doit figurer dans img-src de la CSP (vercel.json).
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
const MAP_CSS = `
.cw-osm-wrap .leaflet-container{background:${BG};font-family:Inter,sans-serif}
.cw-osm-wrap .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.35)}
.cw-osm-wrap .leaflet-tile-container img{width:256.5px!important;height:256.5px!important}
.cw-osm-wrap .leaflet-control-attribution{background:rgba(13,17,23,.75);color:#64748B;font-size:10px}
.cw-osm-wrap .leaflet-control-attribution a{color:#94a3b8}
.cw-osm-wrap .cw-label{background:none;border:none;box-shadow:none;white-space:nowrap;pointer-events:none}
.cw-osm-wrap .cw-popup .leaflet-popup-content-wrapper{background:rgba(13,17,23,.95);border:1px solid rgba(0,200,150,.4);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.6);color:#e6edf3}
.cw-osm-wrap .cw-popup .leaflet-popup-content{margin:14px 16px;min-width:200px}
.cw-osm-wrap .cw-popup .leaflet-popup-tip{background:rgba(13,17,23,.95);border:1px solid rgba(0,200,150,.4)}
.cw-osm-wrap .cw-popup a.leaflet-popup-close-button{color:rgba(255,255,255,.6)}
`

// Label texte non interactif (divIcon centré sur la position).
function textIcon(html: string) {
  return L.divIcon({ className: 'cw-label', html: `<div style="transform:translate(-50%,-50%);display:inline-block">${html}</div>`, iconSize: [0, 0] })
}

// Cadrage initial sur les bornes du Cameroun + expose l'instance pour le zoom custom.
function MapInit({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    const b = CAMEROON_FIT_BOUNDS
    // Le conteneur peut ne pas avoir sa taille finale au montage (fitBounds
    // retomberait au zoom max) : on recalcule la taille avant de cadrer.
    const fit = () => { map.invalidateSize(); map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [20, 20] }) }
    fit()
    const t = setTimeout(fit, 150)
    onReady(map)
    return () => clearTimeout(t)
  }, [map])
  return null
}

function OsmCameroonMap({ regions }: { regions: GeoRegionDatum[] }) {
  const [map, setMap] = useState<L.Map | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const polys = useRegionPolygons()
  const byName = new Map(regions.map((r) => [r.name, r]))
  const zoomBy = (delta: number) => { if (map) map.setZoom(map.getZoom() + delta) }

  // Échelle de couleur des cercles (#1a4a3a à 0 tx → #00C896 au max).
  const maxVol = Math.max(1, ...regions.map((r) => r.volume))
  const circleColor = scaleLinear<string>().domain([0, maxVol]).range([GRAD_LO, GRAD_HI]).clamp(true)
  // Rayon proportionnel au volume : 20 km (1+ tx) → 80 km (max). Sans data : 15 km.
  const radiusFor = (d: GeoRegionDatum) => (d.transactions === 0 ? 15000 : 20000 + (Math.min(d.volume, maxVol) / maxVol) * 60000)
  // Marqueur (ville) : gris (0 tx), vert clair (1-50), émeraude + plus gros (50+).
  const markerStyle = (tx: number) => ({ color: tx === 0 ? '#64748B' : tx <= 50 ? '#34D399' : '#00C896', radius: tx > 50 ? 12 : tx > 0 ? 9 : 6 })

  return (
    <div style={{ position: 'relative', background: BG, borderRadius: 12, padding: 8 }}>
      <div className="cw-osm-wrap" style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(0, 200, 150, 0.15)', boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)' }}>
        <style>{MAP_CSS}</style>
        {/* Contrôle de zoom custom, aux couleurs du thème */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[{ s: '+', d: 1 }, { s: '−', d: -1 }].map(({ s, d }) => (
            <button key={s} onClick={() => zoomBy(d)} aria-label={d > 0 ? i18n.t('analytics.map_zoom_in', { defaultValue: 'Zoom avant' }) : i18n.t('analytics.map_zoom_out', { defaultValue: 'Zoom arrière' })}
              style={{ width: 32, height: 32, borderRadius: 8, background: '#161d2f', border: '1px solid rgba(0,200,150,0.3)', color: '#00C896', fontSize: 18, fontWeight: 700, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>{s}</button>
          ))}
        </div>
        <MapContainer
          center={[CAMEROON_CENTER.lat, CAMEROON_CENTER.lng]}
          zoom={MAP_ZOOM}
          minZoom={5}
          maxZoom={10}
          zoomSnap={0.25}
          zoomControl={false}
          scrollWheelZoom={false}
          style={{ width: '100%', height: 'clamp(420px, 68vh, 640px)', background: BG }}
        >
          <MapInit onReady={setMap} />
          <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} maxZoom={19} />
          {/* Frontières régionales : polygones émeraude fins ; fill subtil si data, hover = accentué. */}
          {polys.map((rp) => {
            const d = datumFor(byName, rp.name)
            const isHover = hovered === rp.name
            return (
              <Polygon key={`poly-${rp.name}`} positions={rp.paths.map((ring) => ring.map((p) => [p.lat, p.lng] as [number, number]))}
                eventHandlers={{ mouseover: () => setHovered(rp.name), mouseout: () => setHovered((h) => (h === rp.name ? null : h)) }}
                pathOptions={{ color: STROKE, opacity: isHover ? 0.9 : 0.5, weight: isHover ? 2 : 1, fillColor: STROKE, fillOpacity: isHover ? 0.15 : d.transactions > 0 ? 0.08 : 0.02 }}>
                <RegionPopup name={rp.name} d={d} />
              </Polygon>
            )
          })}
          {/* Label « Cameroun » discret au centre du pays */}
          <Marker position={[7.0, 12.5]} interactive={false} icon={textIcon(`<div style="font-size:16px;font-weight:700;color:#00C896;letter-spacing:1.5px;text-transform:uppercase;opacity:.28;text-shadow:0 1px 4px rgba(0,0,0,.9)">${i18n.t('analytics.map_country', { defaultValue: 'Cameroun' })}</div>`)} />
          {/* Labels des régions au centroïde (décalage manuel pour les régions du sud). */}
          {polys.map((rp) => {
            const off = LABEL_OFFSETS[rp.name]
            const pos: [number, number] = off ? [rp.center.lat + off.lat, rp.center.lng + off.lng] : [rp.center.lat, rp.center.lng]
            return <Marker key={`lbl-${rp.name}`} position={pos} interactive={false} icon={textIcon(`<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.75);text-shadow:0 1px 3px rgba(0,0,0,.95)">${rp.name}</div>`)} />
          })}
          {/* Cercles par région (rayon + teinte selon le volume) — non interactifs. */}
          {Object.entries(REGION_COORDS).map(([name, c]) => {
            const d = datumFor(byName, name)
            return (
              <Circle key={`c-${name}`} center={[c.lat, c.lng]} radius={radiusFor(d)} interactive={false}
                pathOptions={{ fillColor: d.transactions === 0 ? '#64748B' : (circleColor(d.volume) as string), fillOpacity: hovered === name ? 0.7 : 0.4, color: STROKE, weight: 2, opacity: 0.9 }} />
            )
          })}
          {/* Marqueur ville cliquable → popup dark */}
          {Object.entries(REGION_COORDS).map(([name, c]) => {
            const d = datumFor(byName, name)
            const st = markerStyle(d.transactions)
            return (
              <CircleMarker key={`m-${name}`} center={[c.lat, c.lng]} radius={st.radius}
                pathOptions={{ fillColor: st.color, fillOpacity: 0.95, color: '#0d1117', weight: 1.5 }}>
                <RegionPopup name={name} d={d} />
              </CircleMarker>
            )
          })}
        </MapContainer>
        <MarkerLegend />
      </div>
    </div>
  )
}

function RegionPopup({ name, d }: { name: string; d: GeoRegionDatum }) {
  return (
    <Popup className="cw-popup">
      <div style={{ color: '#00C896', fontWeight: 700, fontSize: 14, marginBottom: 8, paddingRight: 18 }}>📍 {name}</div>
      <div style={{ color: '#e6edf3', fontSize: 13, marginBottom: 6 }}>🔄 {i18n.t('analytics.tx_count', { n: d.transactions })}</div>
      <div style={{ color: '#00C896', fontSize: 18, fontWeight: 800 }}>💰 {fmtFcfa(d.volume)}</div>
      {d.city && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 8 }}>{i18n.t('analytics.geo_main_city', { city: d.city, defaultValue: `Ville : ${d.city}` })}</div>}
    </Popup>
  )
}

function MarkerLegend() {
  const items = [
    { c: '#64748B', label: i18n.t('analytics.geo_legend_none') },
    { c: '#34D399', label: '1–50' },
    { c: '#00C896', label: '50+' },
  ]
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, zIndex: 1000,
      background: 'rgba(13, 17, 23, 0.9)', border: '1px solid rgba(0, 200, 150, 0.2)',
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      borderRadius: 12, padding: 16, fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: '#8b949e', marginBottom: 10 }}>
        {i18n.t('analytics.geo_legend_title', { defaultValue: 'Transactions' })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e6edf3' }}>
            <span style={{ width: 11, height: 11, borderRadius: 6, background: it.c, boxShadow: `0 0 8px ${it.c}66` }} /> {it.label}
          </span>
        ))}
      </div>
      <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.07)', marginTop: 10, paddingTop: 8, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#8b949e' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: 4, background: '#3f4754' }} />
          <span style={{ width: 11, height: 11, borderRadius: 7, background: '#00C896' }} />
        </span>
        {i18n.t('analytics.geo_legend_size', { defaultValue: 'Taille = volume' })}
      </div>
    </div>
  )
}

// Bandeau d'insight : surface immédiatement le « quoi » de la carte
// (volume total, activité, régions couvertes, région dominante).
function GeoStats({ regions }: { regions: GeoRegionDatum[] }) {
  const active = regions.filter((r) => r.transactions > 0)
  const totalVol = regions.reduce((s, r) => s + r.volume, 0)
  const totalTx = regions.reduce((s, r) => s + r.transactions, 0)
  const top = [...active].sort((a, b) => b.volume - a.volume)[0]
  const share = top && totalVol > 0 ? Math.round((top.volume / totalVol) * 100) : 0

  const tiles = [
    { label: i18n.t('analytics.geo_stat_volume', { defaultValue: 'Volume total' }), value: fmtFcfa(totalVol), sub: '', accent: true },
    { label: i18n.t('analytics.geo_stat_tx', { defaultValue: 'Transactions' }), value: totalTx.toLocaleString('fr-FR'), sub: '', accent: false },
    { label: i18n.t('analytics.geo_stat_regions', { defaultValue: 'Régions actives' }), value: `${active.length}/${regions.length}`, sub: '', accent: false },
    { label: i18n.t('analytics.geo_stat_top', { defaultValue: 'Région en tête' }), value: top?.name ?? '—', sub: top ? i18n.t('analytics.geo_stat_share', { pct: share, defaultValue: `${share}% du volume` }) : '', accent: false },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
      {tiles.map((t) => (
        <div key={t.label} style={{ background: 'linear-gradient(180deg, #131a2b, #0f1524)', border: '1px solid #1E2D45', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: MUTED, marginBottom: 6 }}>{t.label}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: t.accent ? GRAD_HI : TEXT, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.value}</div>
          {t.sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{t.sub}</div>}
        </div>
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

function MapChooser({ regions }: { regions: GeoRegionDatum[] }) {
  // OpenStreetMap (Leaflet) ; si la lib plante, repli sur la carte SVG.
  return <FallbackBoundary fallback={<SvgFallback regions={regions} />}><OsmCameroonMap regions={regions} /></FallbackBoundary>
}

export default function CameroonGeoMap({ regions }: { regions: GeoRegionDatum[] }) {
  // Couche d'insight (KPI) au-dessus de la carte, quelle que soit la variante rendue.
  return (
    <div>
      <GeoStats regions={regions} />
      <MapChooser regions={regions} />
    </div>
  )
}
