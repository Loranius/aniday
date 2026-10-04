import { preferencesStore } from '@/data/storage';
import { PhoneLocationProvider } from './phoneLocationProvider';
import { TripRecorder } from './tripRecorder';
import type { GpsFix } from '@/domain/geo';

/** App-wide singletons: a trip must outlive screen changes. */
export const locationProvider = new PhoneLocationProvider();

let liveSink: ((fix: GpsFix, vehicleId: string) => void) | null = null;
export function setLiveLocationSink(fn: ((fix: GpsFix, vehicleId: string) => void) | null) {
  liveSink = fn;
}

export const tripRecorder = new TripRecorder({
  provider: locationProvider,
  store: preferencesStore,
  onLiveLocation: (fix, vehicleId) => liveSink?.(fix, vehicleId),
});
