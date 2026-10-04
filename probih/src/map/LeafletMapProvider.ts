import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '@/domain/geo';
import type { MapPlaceMarker, MapProvider, RouteStyle } from './MapProvider';

const TILE_URL =
  (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const ROUTE_COLORS: Record<RouteStyle, { color: string; weight: number; opacity: number }> = {
  active: { color: '#4cc2ff', weight: 5, opacity: 0.95 },
  detail: { color: '#4cc2ff', weight: 5, opacity: 0.95 },
  history: { color: '#8b95a5', weight: 3, opacity: 0.55 },
};

const toL = (p: LatLng): L.LatLngExpression => [p.lat, p.lng];

function divIcon(html: string, size: number, className = ''): L.DivIcon {
  return L.divIcon({ html, className: `map-icon ${className}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Leaflet + raster tiles (OpenStreetMap data). No API key required. */
export class LeafletMapProvider implements MapProvider {
  private map: L.Map | null = null;
  private me: L.CircleMarker | null = null;
  private meAccuracy: L.Circle | null = null;
  private vehicle: L.Marker | null = null;
  private routes = new Map<string, L.LayerGroup>();
  private places = L.layerGroup();

  async initialize(container: HTMLElement, view: { center: LatLng; zoom: number }) {
    this.map = L.map(container, { zoomControl: false, attributionControl: true }).setView(toL(view.center), view.zoom);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(this.map);
    this.places.addTo(this.map);
  }

  destroy() {
    this.map?.remove();
    this.map = null;
    this.routes.clear();
    this.me = this.meAccuracy = null;
    this.vehicle = null;
    this.places = L.layerGroup();
  }

  showCurrentLocation(pos: LatLng | null, accuracyM?: number | null) {
    if (!this.map) return;
    if (!pos) {
      this.me?.remove();
      this.meAccuracy?.remove();
      this.me = this.meAccuracy = null;
      return;
    }
    if (!this.me) {
      this.meAccuracy = L.circle(toL(pos), { radius: accuracyM ?? 0, color: '#4cc2ff', weight: 1, fillOpacity: 0.08 }).addTo(this.map);
      this.me = L.circleMarker(toL(pos), { radius: 7, color: '#0b0d10', weight: 2, fillColor: '#4cc2ff', fillOpacity: 1 }).addTo(this.map);
    } else {
      this.me.setLatLng(toL(pos));
      this.meAccuracy?.setLatLng(toL(pos)).setRadius(accuracyM ?? 0);
    }
  }

  setVehicleMarker(pos: LatLng | null, heading?: number | null) {
    if (!this.map) return;
    if (!pos) {
      this.vehicle?.remove();
      this.vehicle = null;
      return;
    }
    const rot = heading != null && Number.isFinite(heading) ? heading : 0;
    const icon = divIcon(`<div class="vehicle-marker" style="transform:rotate(${rot}deg)">▲</div>`, 30);
    if (!this.vehicle) this.vehicle = L.marker(toL(pos), { icon, zIndexOffset: 1000 }).addTo(this.map);
    else this.vehicle.setLatLng(toL(pos)).setIcon(icon);
  }

  drawRoute(id: string, coords: LatLng[], style: RouteStyle, opts: { showEndpoints?: boolean } = {}) {
    if (!this.map) return;
    this.clearRoute(id);
    if (coords.length === 0) return;
    const group = L.layerGroup();
    if (coords.length > 1) L.polyline(coords.map(toL), { ...ROUTE_COLORS[style], lineCap: 'round', lineJoin: 'round' }).addTo(group);
    if (opts.showEndpoints) {
      L.marker(toL(coords[0]!), { icon: divIcon('<div class="endpoint endpoint-start"></div>', 16) }).addTo(group);
      if (coords.length > 1) L.marker(toL(coords[coords.length - 1]!), { icon: divIcon('<div class="endpoint endpoint-end"></div>', 16) }).addTo(group);
    }
    group.addTo(this.map);
    this.routes.set(id, group);
  }

  clearRoute(id: string) {
    this.routes.get(id)?.remove();
    this.routes.delete(id);
  }

  clearRoutes() {
    for (const id of [...this.routes.keys()]) this.clearRoute(id);
  }

  setPlaces(places: MapPlaceMarker[]) {
    this.places.clearLayers();
    for (const p of places) {
      L.marker([p.lat, p.lng], { icon: divIcon(`<div class="place-marker">${escapeHtml(p.icon)}</div>`, 32) })
        .bindTooltip(escapeHtml(p.name), { direction: 'top', offset: [0, -14] })
        .addTo(this.places);
    }
  }

  fitTo(coords: LatLng[], padding = 40) {
    if (!this.map || coords.length === 0) return;
    if (coords.length === 1) return this.panTo(coords[0]!, 15);
    this.map.fitBounds(L.latLngBounds(coords.map(toL)), { padding: [padding, padding] });
  }

  panTo(pos: LatLng, zoom?: number) {
    if (!this.map) return;
    if (zoom != null) this.map.setView(toL(pos), zoom);
    else this.map.panTo(toL(pos));
  }

  getCenter(): LatLng {
    const c = this.map?.getCenter();
    return { lat: c?.lat ?? 0, lng: c?.lng ?? 0 };
  }

  onLongPress(cb: (pos: LatLng) => void) {
    this.map?.on('contextmenu', (e: L.LeafletMouseEvent) => cb({ lat: e.latlng.lat, lng: e.latlng.lng }));
  }

  invalidateSize() {
    this.map?.invalidateSize();
  }
}

export function createMapProvider(): MapProvider {
  return new LeafletMapProvider();
}
