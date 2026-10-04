import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { BackgroundGeolocationPlugin, Location as BgLocation } from '@capacitor-community/background-geolocation';
import type { GpsFix } from '@/domain/geo';
import { TrackingError, type LocationProvider, type WatchOptions } from './locationProvider';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

function fromBg(l: BgLocation): GpsFix {
  return {
    lat: l.latitude,
    lng: l.longitude,
    timestamp: l.time ?? Date.now(),
    accuracy: l.accuracy,
    speed: l.speed,
    heading: l.bearing,
  };
}

function fromWeb(p: GeolocationPosition): GpsFix {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    timestamp: p.timestamp,
    accuracy: p.coords.accuracy,
    speed: p.coords.speed,
    heading: p.coords.heading,
  };
}

function webError(e: GeolocationPositionError): TrackingError {
  if (e.code === e.PERMISSION_DENIED) return new TrackingError('permission_denied', 'Доступ до геолокації заборонено');
  if (e.code === e.TIMEOUT) return new TrackingError('timeout', 'GPS не відповідає');
  return new TrackingError('unavailable', 'Геолокація недоступна');
}

/**
 * Phone GPS.
 * - Android app: foreground-service watcher (keeps recording with the screen off; shows a notification).
 * - Browser (dev / desktop): navigator.geolocation, foreground only.
 */
export class PhoneLocationProvider implements LocationProvider {
  readonly source = 'phone' as const;
  readonly supportsBackground = Capacitor.isNativePlatform();

  async watch(onFix: (f: GpsFix) => void, onError: (e: TrackingError) => void, opts: WatchOptions) {
    if (Capacitor.isNativePlatform()) {
      // Android 13+: without this the "trip is being recorded" notification is hidden
      // (tracking itself still works), so ask once but never block on it.
      await LocalNotifications.requestPermissions().catch(() => undefined);
      const id = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: opts.backgroundTitle,
          backgroundMessage: opts.backgroundMessage,
          requestPermissions: true,
          stale: false,
          distanceFilter: opts.distanceFilterM,
        },
        (location, error) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') onError(new TrackingError('permission_denied', 'Доступ до геолокації заборонено'));
            else onError(new TrackingError('unavailable', error.message || 'Геолокація недоступна'));
            return;
          }
          if (location) onFix(fromBg(location));
        },
      );
      return async () => BackgroundGeolocation.removeWatcher({ id });
    }

    if (!('geolocation' in navigator)) throw new TrackingError('unavailable', 'Цей пристрій не підтримує геолокацію');
    const id = navigator.geolocation.watchPosition(
      (p) => onFix(fromWeb(p)),
      (e) => onError(webError(e)),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30_000 },
    );
    return async () => navigator.geolocation.clearWatch(id);
  }

  async getCurrent(): Promise<GpsFix> {
    if (Capacitor.isNativePlatform()) {
      try {
        let perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') perm = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (perm.location === 'denied') throw new TrackingError('permission_denied', 'Доступ до геолокації заборонено');
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 });
        return fromWeb(p as unknown as GeolocationPosition);
      } catch (e) {
        if (e instanceof TrackingError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (/disabled|not enabled/i.test(msg)) throw new TrackingError('unavailable', 'Увімкніть геолокацію на телефоні');
        throw new TrackingError('unknown', msg);
      }
    }
    if (!('geolocation' in navigator)) throw new TrackingError('unavailable', 'Цей пристрій не підтримує геолокацію');
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(fromWeb(p)),
        (e) => reject(webError(e)),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      ),
    );
  }

  async openSettings() {
    if (Capacitor.isNativePlatform()) await BackgroundGeolocation.openSettings();
  }
}
