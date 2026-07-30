import { useEffect, useMemo } from 'react'
import { MapContainer, Polyline, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { RoutePoint } from '../lib/types'

interface RouteMapProps {
  route: RoutePoint[]
  /** Polyline color — typically the sport accent. */
  color: string
  /** Pixel height of the map container. */
  height: number
  /** When true, disables panning/zooming and clicks. Used for feed previews. */
  preview?: boolean
}

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Auto-fits the map view to the polyline bounds. Has to be a child of
 *  MapContainer so it can grab the map instance via useMap(). */
function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds) return
    map.fitBounds(bounds, { padding: [16, 16], animate: false })
  }, [map, bounds])
  return null
}

export function RouteMap({ route, color, height, preview = false }: RouteMapProps) {
  const coords = useMemo<[number, number][]>(
    () => route.map((p) => [p.latitude, p.longitude]),
    [route]
  )

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (coords.length < 2) return null
    return L.latLngBounds(coords.map(([lat, lon]) => L.latLng(lat, lon)))
  }, [coords])

  if (coords.length < 2) {
    return (
      <div
        className="rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-text-muted text-[12px]"
        style={{ height }}
      >
        No GPS route recorded
      </div>
    )
  }

  const start = coords[0]
  const end = coords[coords.length - 1]

  return (
    <div className="rounded-lg overflow-hidden border border-white/[0.06]" style={{ height }}>
      <MapContainer
        bounds={bounds ?? undefined}
        style={{ height: '100%', width: '100%', background: 'var(--app-map-bg, #0c0c0e)' }}
        zoomControl={!preview}
        scrollWheelZoom={!preview}
        dragging={!preview}
        doubleClickZoom={!preview}
        touchZoom={!preview}
        attributionControl={!preview}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <Polyline positions={coords} pathOptions={{ color, weight: 3.5, opacity: 0.95 }} />
        <CircleMarker
          center={start}
          radius={5}
          pathOptions={{ color: '#0b1f3a', weight: 1.5, fillColor: '#51CF66', fillOpacity: 1 }}
        />
        <CircleMarker
          center={end}
          radius={5}
          pathOptions={{ color: '#0b1f3a', weight: 1.5, fillColor: color, fillOpacity: 1 }}
        />
        <FitToBounds bounds={bounds} />
      </MapContainer>
    </div>
  )
}
