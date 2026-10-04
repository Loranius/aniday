import type { GpsFix } from '@/domain/geo';
import type { LocationSource } from '@/domain/types';

export type TrackingErrorCode =
  | 'permission_denied'
  | 'unavailable' // location services off / no provider
  | 'background_unavailable' // works only while the app is in the foreground
  | 'timeout'
  | 'unknown';

export class TrackingError extends Error {
  constructor(
    public code: TrackingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface WatchOptions {
  /** Notification text shown while tracking in the background (Android foreground service). */
  backgroundTitle: string;
  backgroundMessage: string;
  /** Metres the device must move before a new fix is delivered. */
  distanceFilterM: number;
}

export interface LocationProvider {
  readonly source: LocationSource;
  /** True when updates continue with the screen off / app in background. */
  readonly supportsBackground: boolean;
  watch(onFix: (fix: GpsFix) => void, onError: (e: TrackingError) => void, opts: WatchOptions): Promise<() => Promise<void>>;
  getCurrent(): Promise<GpsFix>;
  openSettings?(): Promise<void>;
}
