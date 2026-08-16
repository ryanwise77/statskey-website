import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useAuth } from '../lib/auth'
import { usePublicRoutes, useSavedRoutes } from '../lib/data/useRoutes'
import { formatDistance, formatDuration } from '../lib/format'
import { deleteRoute, newId, saveRoute } from '../lib/writers'
import { RouteMap } from '../components/RouteMap'
import {
  sportAccentColor,
  sportDisplayName,
  type RouteDifficulty,
  type RoutePoint,
  type SavedRoute,
} from '../lib/types'
import { confirmDialog } from '../lib/ui/dialogs'

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
const DEFAULT_CENTER: [number, number] = [40.73061, -73.935242]

const SPORTS = ['running', 'walking', 'cycling', 'hiking', 'trailRunning', 'roadCycling']
const DIFFICULTIES: RouteDifficulty[] = ['easy', 'moderate', 'hard', 'expert']

interface PlannerPoint {
  latitude: number
  longitude: number
}

export function TrainingRoutes() {
  const { user, profile } = useAuth()
  const saved = useSavedRoutes(user?.uid)
  const publicRoutes = usePublicRoutes(12)
  const [points, setPoints] = useState<PlannerPoint[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sport, setSport] = useState('running')
  const [difficulty, setDifficulty] = useState<RouteDifficulty>('moderate')
  const [isPublic, setIsPublic] = useState(false)
  const [requestedCenter, setRequestedCenter] = useState<[number, number] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const distance = useMemo(() => routeDistanceMiles(points), [points])
  const estimatedDuration = useMemo(() => estimateDuration(distance, sport, difficulty), [distance, sport, difficulty])
  const accent = sportAccentColor(sport)

  function addPoint(point: PlannerPoint) {
    setPoints((prev) => [...prev, point])
    setSuccess(null)
  }

  function undoPoint() {
    setPoints((prev) => prev.slice(0, -1))
  }

  function clearRoute() {
    setPoints([])
    setSuccess(null)
    setError(null)
  }

  function closeLoop() {
    setPoints((prev) => {
      if (prev.length < 3 || samePoint(prev[0], prev[prev.length - 1])) return prev
      return [...prev, prev[0]]
    })
  }

  function makeOutAndBack() {
    setPoints((prev) => {
      if (prev.length < 2) return prev
      return [...prev, ...prev.slice(0, -1).reverse()]
    })
  }

  function centerOnUser() {
    if (!navigator.geolocation) {
      setError('Location is not available in this browser.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRequestedCenter([pos.coords.latitude, pos.coords.longitude])
        setError(null)
      },
      (err) => setError(err.message)
    )
  }

  async function savePlannedRoute() {
    if (!user) return
    if (points.length < 2) {
      setError('Plot at least two points before saving.')
      return
    }
    if (!name.trim()) {
      setError('Name the route before saving.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const route: SavedRoute = {
        id: newId(),
        name: name.trim(),
        description: description.trim(),
        sportType: sport,
        createdBy: user.uid,
        creatorName: profile?.name || user.displayName || user.email || '',
        routePoints: toRoutePoints(points, estimatedDuration),
        distance,
        elevationGain: 0,
        elevationLoss: 0,
        estimatedDuration,
        difficulty,
        isPublic,
        rating: 0,
        ratingCount: 0,
        timesCompleted: 0,
        createdAt: new Date(),
      }
      await saveRoute(user.uid, route)
      setSuccess(`Saved "${route.name}" to your routes.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function exportDraftGPX() {
    if (points.length < 2) {
      setError('Plot at least two points before exporting GPX.')
      return
    }
    downloadGPX({
      id: 'draft',
      name: name.trim() || 'StatsKey Route',
      description: description.trim(),
      sportType: sport,
      createdBy: user?.uid ?? '',
      creatorName: profile?.name || user?.displayName || user?.email || '',
      routePoints: toRoutePoints(points, estimatedDuration),
      distance,
      elevationGain: 0,
      elevationLoss: 0,
      estimatedDuration,
      difficulty,
      isPublic: false,
      rating: 0,
      ratingCount: 0,
      timesCompleted: 0,
      createdAt: new Date(),
    })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Route Builder</h1>
          <p className="text-text-secondary text-[14px] mt-1">
            Click the map to plot a training route, then save it to your route library.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" onClick={centerOnUser}>Use my location</button>
          <button className="btn btn-secondary" onClick={exportDraftGPX} disabled={points.length < 2}>Export GPX</button>
          <button className="btn btn-primary" onClick={savePlannedRoute} disabled={saving || points.length < 2}>
            {saving ? 'Saving…' : 'Save route'}
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <section className="panel p-0 overflow-hidden">
          <RouteBuilderMap
            points={points}
            color={accent}
            requestedCenter={requestedCenter}
            onAddPoint={addPoint}
          />
        </section>

        <aside className="space-y-4">
          <section className="panel space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <RouteStat label="Distance" value={formatDistance(distance)} />
              <RouteStat label="Est. time" value={estimatedDuration > 0 ? formatDuration(estimatedDuration) : '--'} />
              <RouteStat label="Points" value={points.length} />
            </div>

            <div className="grid gap-3">
              <Field label="Route name">
                <input
                  className="input"
                  placeholder="e.g. Prospect Park tempo loop"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sport">
                  <select className="input" value={sport} onChange={(e) => setSport(e.target.value)}>
                    {SPORTS.map((s) => (
                      <option key={s} value={s}>{sportDisplayName(s)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Difficulty">
                  <select
                    className="input"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as RouteDifficulty)}
                  >
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>{difficultyLabel(d)}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Surface, workout intent, water stops, traffic notes…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-[13px] text-text-secondary">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Share to public route discovery
            </label>

            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary" onClick={undoPoint} disabled={points.length === 0}>Undo</button>
              <button className="btn btn-secondary" onClick={closeLoop} disabled={points.length < 3}>Close loop</button>
              <button className="btn btn-secondary" onClick={makeOutAndBack} disabled={points.length < 2}>Out & back</button>
              <button className="btn btn-ghost" onClick={clearRoute} disabled={points.length === 0}>Clear</button>
            </div>

            {error && <div className="error-banner">{error}</div>}
            {success && <div className="success-banner text-[13px]">{success}</div>}
          </section>

          <section className="panel">
            <h2 className="card-title">How to plot</h2>
            <ol className="mt-3 space-y-2 text-[13px] text-text-secondary list-decimal list-inside">
              <li>Click the start, turns, and finish.</li>
              <li>Use loop or out-and-back helpers when they fit.</li>
              <li>Save the route, or export GPX for another device.</li>
            </ol>
          </section>
        </aside>
      </div>

      <RouteLibrary title="My routes" state={saved} canDelete uid={user?.uid} />
      <RouteLibrary title="Discover" state={publicRoutes} emptyText="No public routes yet." />
    </div>
  )
}

function RouteBuilderMap({
  points,
  color,
  requestedCenter,
  onAddPoint,
}: {
  points: PlannerPoint[]
  color: string
  requestedCenter: [number, number] | null
  onAddPoint: (point: PlannerPoint) => void
}) {
  const positions = points.map((p) => [p.latitude, p.longitude] as [number, number])

  return (
    <MapContainer
      center={requestedCenter ?? DEFAULT_CENTER}
      zoom={12}
      style={{ height: 'min(68vh, 620px)', minHeight: 440, width: '100%', background: 'var(--app-map-bg, #0c0c0e)' }}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
      <PlannerMapEvents onAddPoint={onAddPoint} />
      <PlannerMapController points={points} requestedCenter={requestedCenter} />
      {positions.length >= 2 && <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.95 }} />}
      {positions.map((position, idx) => (
        <CircleMarker
          key={`${position[0]}-${position[1]}-${idx}`}
          center={position}
          radius={idx === 0 || idx === positions.length - 1 ? 6 : 4}
          pathOptions={{
            color: '#0b1f3a',
            weight: 1.5,
            fillColor: idx === 0 ? '#51CF66' : idx === positions.length - 1 ? color : '#0b1f3a',
            fillOpacity: 1,
          }}
        />
      ))}
      {points.length === 0 && (
        <div className="leaflet-top leaflet-left pointer-events-none">
          <div className="m-3 rounded-xl border border-white/[0.08] bg-black/70 px-3 py-2 text-[12px] text-text-secondary backdrop-blur">
            Click anywhere on the map to start plotting.
          </div>
        </div>
      )}
    </MapContainer>
  )
}

function PlannerMapEvents({ onAddPoint }: { onAddPoint: (point: PlannerPoint) => void }) {
  useMapEvents({
    click(e) {
      onAddPoint({ latitude: e.latlng.lat, longitude: e.latlng.lng })
    },
  })
  return null
}

function PlannerMapController({
  points,
  requestedCenter,
}: {
  points: PlannerPoint[]
  requestedCenter: [number, number] | null
}) {
  const map = useMap()

  useEffect(() => {
    if (requestedCenter) map.setView(requestedCenter, Math.max(map.getZoom(), 14))
  }, [map, requestedCenter])

  useEffect(() => {
    if (points.length < 2) return
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p.latitude, p.longitude)))
    map.fitBounds(bounds, { padding: [32, 32], animate: false })
  }, [map, points])

  return null
}

function RouteLibrary({
  title,
  state,
  emptyText = 'No saved routes yet.',
  canDelete = false,
  uid,
}: {
  title: string
  state: { routes: SavedRoute[]; loading: boolean; error: string | null }
  emptyText?: string
  canDelete?: boolean
  uid?: string
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="card-title">{title}</h2>
        <span className="text-[12px] text-text-muted">{state.routes.length} routes</span>
      </div>
      {state.error ? (
        <div className="error-banner">{state.error}</div>
      ) : state.loading ? (
        <div className="panel text-[13px] text-text-muted">Loading routes…</div>
      ) : state.routes.length === 0 ? (
        <div className="panel text-[13px] text-text-muted">{emptyText}</div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {state.routes.map((route) => (
            <RouteCard key={route.id} route={route} canDelete={canDelete} uid={uid} />
          ))}
        </div>
      )}
    </section>
  )
}

function RouteCard({ route, canDelete, uid }: { route: SavedRoute; canDelete?: boolean; uid?: string }) {
  const accent = sportAccentColor(route.sportType)

  async function remove() {
    if (!uid) return
    const confirmed = await confirmDialog({
      title: `Delete route "${route.name}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    await deleteRoute(uid, route.id).catch(() => {})
  }

  return (
    <article className="panel space-y-3">
      <RouteMap route={route.routePoints} color={accent} height={140} preview />
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display font-bold text-[17px] tracking-[-0.01em]">{route.name}</h3>
          <span className="text-[11px] text-text-muted whitespace-nowrap">{sportDisplayName(route.sportType)}</span>
        </div>
        {route.description && (
          <p className="text-[12px] text-text-secondary mt-1 line-clamp-2">{route.description}</p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <RouteStat label="Distance" value={formatDistance(route.distance)} />
        <RouteStat label="Est. time" value={formatDuration(route.estimatedDuration)} />
        <RouteStat label="Difficulty" value={difficultyLabel(route.difficulty)} />
      </div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-text-muted">{route.isPublic ? 'Public' : 'Private'}</span>
        <div className="flex items-center gap-3">
          {canDelete && (
            <button className="text-red-300 hover:underline" onClick={remove}>Delete</button>
          )}
          <button className="link" onClick={() => downloadGPX(route)}>Export GPX</button>
        </div>
      </div>
    </article>
  )
}

function RouteStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-display font-bold text-[16px] tracking-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">{label}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function toRoutePoints(points: PlannerPoint[], estimatedDuration: number): RoutePoint[] {
  const startedAt = Date.now()
  const totalDistance = routeDistanceMiles(points)
  let elapsed = 0
  return points.map((point, idx) => {
    if (idx > 0 && totalDistance > 0) {
      const segment = distanceMiles(points[idx - 1], point)
      elapsed += estimatedDuration * (segment / totalDistance)
    }
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: 0,
      timestamp: new Date(startedAt + elapsed * 1000),
      speed: 0,
    }
  })
}

function routeDistanceMiles(points: PlannerPoint[]): number {
  let distance = 0
  for (let i = 1; i < points.length; i += 1) {
    distance += distanceMiles(points[i - 1], points[i])
  }
  return distance
}

function distanceMiles(a: PlannerPoint, b: PlannerPoint): number {
  const earthRadiusMeters = 6_371_000
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return (earthRadiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))) / 1609.344
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

function estimateDuration(distanceMiles: number, sport: string, difficulty: RouteDifficulty): number {
  const basePace = sportPaceSecondsPerMile(sport)
  const difficultyMultiplier: Record<RouteDifficulty, number> = {
    easy: 0.95,
    moderate: 1,
    hard: 1.08,
    expert: 1.15,
  }
  return Math.round(distanceMiles * basePace * difficultyMultiplier[difficulty])
}

function sportPaceSecondsPerMile(sport: string): number {
  switch (sport) {
    case 'walking': return 20 * 60
    case 'cycling':
    case 'roadCycling': return 4.5 * 60
    case 'hiking': return 22 * 60
    case 'trailRunning': return 10.5 * 60
    case 'running':
    default: return 8.5 * 60
  }
}

function difficultyLabel(difficulty: RouteDifficulty): string {
  switch (difficulty) {
    case 'easy': return 'Easy'
    case 'moderate': return 'Moderate'
    case 'hard': return 'Hard'
    case 'expert': return 'Expert'
  }
}

function samePoint(a: PlannerPoint, b: PlannerPoint): boolean {
  return Math.abs(a.latitude - b.latitude) < 0.000001 && Math.abs(a.longitude - b.longitude) < 0.000001
}

function downloadGPX(route: SavedRoute) {
  const gpx = toGPX(route)
  const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(route.name || 'statskey-route')}.gpx`
  link.click()
  URL.revokeObjectURL(url)
}

function toGPX(route: SavedRoute): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="StatsKey">',
    '  <trk>',
    `    <name>${escapeXml(route.name)}</name>`,
    '    <trkseg>',
  ]
  for (const point of route.routePoints) {
    lines.push(`      <trkpt lat="${point.latitude}" lon="${point.longitude}">`)
    lines.push(`        <ele>${point.altitude}</ele>`)
    lines.push(`        <time>${point.timestamp.toISOString()}</time>`)
    lines.push('      </trkpt>')
  }
  lines.push('    </trkseg>', '  </trk>', '</gpx>')
  return `${lines.join('\n')}\n`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case "'": return '&apos;'
      case '"': return '&quot;'
      default: return ch
    }
  })
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'statskey-route'
}
