import type { LatLng } from '@/domain/geo';

export interface MapPlaceMarker {
  id: string;
  name: string;
  icon: string;
  lat: number;
  lng: number;
}

export type RouteStyle = 'active' | 'history' | 'detail';

/**
 * The only surface the app uses to talk to a map SDK. Business logic never imports
 * Leaflet (or Google/Mapbox) directly, so the SDK can be swapped without touching screens.
 */
export interface MapProvider {
  initialize(container: HTMLElement, view: { center: LatLng; zoom: number }): Promise<void>;
  destroy(): void;
  /** Phone position with accuracy circle. */
  showCurrentLocation(pos: LatLng | null, accuracyM?: number | null): void;
  /** Vehicle marker (from any VehicleLocation source). */
  setVehicleMarker(pos: LatLng | null, heading?: number | null): void;
  drawRoute(id: string, coords: LatLng[], style: RouteStyle, opts?: { showEndpoints?: boolean }): void;
  clearRoute(id: string): void;
  clearRoutes(): void;
  setPlaces(places: MapPlaceMarker[]): void;
  fitTo(coords: LatLng[], padding?: number): void;
  panTo(pos: LatLng, zoom?: number): void;
  getCenter(): LatLng;
  onLongPress(cb: (pos: LatLng) => void): void;
  invalidateSize(): void;
}
