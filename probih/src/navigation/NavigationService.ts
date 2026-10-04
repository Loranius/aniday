import { Capacitor } from '@capacitor/core';
import type { LatLng } from '@/domain/geo';

export type RouteKind = 'fastest' | 'shortest' | 'alternative';

export interface RouteOption {
  kind: RouteKind;
  distanceKm: number;
  durationSeconds: number;
  geometry: LatLng[];
}

/**
 * Routing is delegated to an external provider (Google Maps, Mapbox, OSRM, …).
 * The app never computes road routes itself.
 */
export interface NavigationService {
  readonly name: string;
  /** False when the provider can only hand off to an external app. */
  readonly supportsInAppRoutes: boolean;
  getRoutes(from: LatLng, to: LatLng, kinds?: RouteKind[]): Promise<RouteOption[]>;
  /** Opens turn-by-turn navigation (external app). */
  startNavigation(to: LatLng, label?: string): Promise<void>;
}

/**
 * Working fallback without any API key: hands the destination to the installed navigation
 * app (Google Maps / Waze / OsmAnd via Android intent). In-app route options require
 * plugging in a real routing provider that implements getRoutes().
 */
export class ExternalAppNavigationService implements NavigationService {
  readonly name = 'Зовнішній навігатор';
  readonly supportsInAppRoutes = false;

  async getRoutes(): Promise<RouteOption[]> {
    return [];
  }

  async startNavigation(to: LatLng): Promise<void> {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`;
    // In the Android app Capacitor hands non-app URLs to the system (ACTION_VIEW → Maps app).
    if (Capacitor.isNativePlatform()) window.location.href = url;
    else window.open(url, '_blank', 'noopener');
  }
}

export const navigationService: NavigationService = new ExternalAppNavigationService();
