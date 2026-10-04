import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, MapPin, Navigation, Play, Square } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { useMap } from '@/map/useMap';
import { haversineMeters, type GpsFix, type LatLng } from '@/domain/geo';
import { MIN_TRIP_KM, findFrequentRoutes, matchPlace } from '@/domain/trips';
import type { LineStringGeometry } from '@/domain/types';
import { TrackingError } from '@/tracking/locationProvider';
import type { FinishedTrip } from '@/tracking/tripRecorder';
import { navigationService } from '@/navigation/NavigationService';
import { formatClock, formatDuration, formatKm, formatNumber1, plural } from '@/ui/format';
import { Banner, Button, Sheet } from '@/ui/primitives';
import { cn } from '@/ui/cn';
import { PlaceForm } from '@/features/places/PlaceForm';

const KYIV: LatLng = { lat: 50.4501, lng: 30.5234 };
const geoToLatLng = (g: LineStringGeometry | null): LatLng[] => (g ? g.coordinates.map(([lng, lat]) => ({ lat, lng })) : []);

const ERROR_TEXT: Record<TrackingError['code'], string> = {
  permission_denied: 'Немає доступу до геолокації. Дозвольте його в налаштуваннях.',
  unavailable: 'GPS недоступний. Увімкніть геолокацію на телефоні.',
  background_unavailable: 'Фоновий запис недоступний — тримайте застосунок відкритим.',
  timeout: 'Слабкий GPS-сигнал.',
  unknown: 'Помилка геолокації.',
};

export function MapScreen() {
  const { bundle, recorder, tripRecorder, locationProvider, repo, actions, online } = useAppData();
  const navigate = useNavigate();
  const lastTrip = bundle?.trips[0];
  const initialCenter = lastTrip?.end_lat != null && lastTrip.end_lng != null ? { lat: lastTrip.end_lat, lng: lastTrip.end_lng } : KYIV;
  const { containerRef, map } = useMap({ center: initialCenter, zoom: 13 });
  const [locError, setLocError] = useState<TrackingError | null>(null);
  const [follow, setFollow] = useState(true);
  const [finished, setFinished] = useState<FinishedTrip | null>(null);
  const [newPlaceAt, setNewPlaceAt] = useState<LatLng | null>(null);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const recording = recorder.status === 'recording' || recorder.status === 'starting';
  const vehicleId = bundle?.vehicle.id;

  // Saved places
  useEffect(() => {
    map?.setPlaces((bundle?.places ?? []).map((p) => ({ id: p.id, name: p.name, icon: p.icon, lat: p.latitude, lng: p.longitude })));
  }, [map, bundle?.places]);

  useEffect(() => {
    map?.onLongPress((pos) => setNewPlaceAt(pos));
  }, [map]);

  // Recent trips (when not recording)
  const recentIds = useMemo(() => (bundle?.trips ?? []).filter((t) => t.is_valid).slice(0, 5).map((t) => t.id), [bundle?.trips]);
  useEffect(() => {
    if (!map || recording) return;
    let cancelled = false;
    const local = Object.fromEntries((bundle?.trips ?? []).filter((t) => t.route_geometry).map((t) => [t.id, t.route_geometry]));
    const missing = recentIds.filter((id) => !local[id]);
    (online && repo && missing.length ? repo.getTripGeometries(missing).catch(() => ({})) : Promise.resolve({})).then((remote) => {
      if (cancelled) return;
      const all: Record<string, LineStringGeometry | null | undefined> = { ...local, ...remote };
      recentIds.forEach((id) => map.drawRoute(`recent-${id}`, geoToLatLng(all[id] ?? null), 'history'));
    });
    return () => {
      cancelled = true;
      recentIds.forEach((id) => map.clearRoute(`recent-${id}`));
    };
  }, [map, recentIds, recording, repo, online, bundle?.trips]);

  // Live vehicle location (phone today; OBD / tracker later) via realtime
  useEffect(() => {
    if (!map || !repo || !vehicleId || recording) return;
    let active = true;
    repo
      .latestLocation(vehicleId)
      .then((l) => active && l && map.setVehicleMarker({ lat: l.latitude, lng: l.longitude }, l.heading))
      .catch(() => undefined);
    const unsub = repo.subscribeLocations(vehicleId, (l) => map.setVehicleMarker({ lat: l.latitude, lng: l.longitude }, l.heading));
    return () => {
      active = false;
      unsub();
    };
  }, [map, repo, vehicleId, recording]);

  // Active trip route
  const fixes = recorder.trip?.fixes;
  useEffect(() => {
    if (!map) return;
    if (!fixes || fixes.length === 0) {
      map.clearRoute('active');
      return;
    }
    map.drawRoute('active', fixes, 'active', { showEndpoints: true });
  }, [map, fixes]);

  useEffect(() => {
    const f = recorder.lastFix;
    if (!map || !f) return;
    map.setVehicleMarker(f, f.heading);
    map.showCurrentLocation(null);
    if (follow && recording) map.panTo(f);
  }, [map, recorder.lastFix, follow, recording]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const locate = useCallback(async () => {
    setLocError(null);
    try {
      const f = await locationProvider.getCurrent();
      map?.showCurrentLocation(f, f.accuracy);
      map?.panTo(f, 15);
      setFollow(true);
    } catch (e) {
      setLocError(e instanceof TrackingError ? e : new TrackingError('unknown', String(e)));
    }
  }, [locationProvider, map]);

  // Show the phone position once when the map opens (asks for permission the first time).
  useEffect(() => {
    if (map && !recording) void locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  async function finish() {
    const result = await tripRecorder.finish();
    if (!result) return;
    if (result.trip.distance_km < MIN_TRIP_KM) {
      setFinished(result);
      return;
    }
    const saved = await actions.saveTrip(result);
    navigate(`/trips/${saved.id}`);
  }

  const error = recorder.error ?? locError;
  const elapsed = recorder.trip ? (tick - recorder.trip.startedAt) / 1000 : 0;
  const speedKmh = liveSpeedKmh(recorder.lastFix, recorder.trip?.fixes);

  // Navigation suggestions from history
  const fromPlaceId = recorder.lastFix && bundle ? matchPlace(recorder.lastFix.lat, recorder.lastFix.lng, bundle.places) : null;
  const frequent = useMemo(() => findFrequentRoutes(bundle?.trips ?? [], 2, 10), [bundle?.trips]);
  const placeName = (id: string) => bundle?.places.find((p) => p.id === id);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0 z-0" onPointerDown={() => recording && setFollow(false)} />

      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[500] p-3">
        <div className="pointer-events-auto mx-auto flex max-w-2xl flex-col gap-2">
          {error && (
            <Banner
              tone="error"
              action={
                error.code === 'permission_denied' && locationProvider.openSettings ? (
                  <button className="shrink-0 text-accent" onClick={() => void locationProvider.openSettings?.()}>
                    Налаштування
                  </button>
                ) : undefined
              }
            >
              {ERROR_TEXT[error.code]}
            </Banner>
          )}
          {recording && recorder.signal === 'lost' && <Banner tone="warn">GPS-сигнал втрачено. Запис продовжиться, щойно сигнал з’явиться.</Banner>}
          {recording && recorder.signal === 'weak' && <Banner tone="warn">Слабкий GPS-сигнал — неточні точки відкидаються.</Banner>}
          {recording && !recorder.backgroundSupported && (
            <Banner>У браузері запис іде лише поки сторінка відкрита. Фоновий запис — в Android-застосунку.</Banner>
          )}
          {!online && <Banner tone="warn">Офлайн: поїздка збережеться на телефоні й синхронізується пізніше.</Banner>}
        </div>
      </div>

      {/* FABs sit in the same column as the panel, so they never overlap it whatever its height. */}
      <div className="pointer-events-none absolute inset-x-0 z-[500] px-3" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.75rem)' }}>
        <div className="pointer-events-auto mb-3 ml-auto flex w-12 flex-col gap-2">
          <MapFab label="Моє місце" onClick={locate}>
            <Crosshair size={22} />
          </MapFab>
          <MapFab label="Додати місце" onClick={() => setNewPlaceAt(map?.getCenter() ?? null)}>
            <MapPin size={22} />
          </MapFab>
          <MapFab label="Маршрути" onClick={() => setRoutesOpen(true)}>
            <Navigation size={22} />
          </MapFab>
        </div>
        <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-line bg-surface/95 p-3 backdrop-blur">
          {recorder.status === 'interrupted' && recorder.trip ? (
            <div>
              <div className="text-sm">
                Поїздку перервано · {formatKm(recorder.liveDistanceKm, 1)} · {plural(recorder.trip.fixes.length, ['точка', 'точки', 'точок'])}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => void tripRecorder.resume()}>
                  Продовжити
                </Button>
                <Button onClick={() => void finish()}>Завершити</Button>
              </div>
            </div>
          ) : recording ? (
            <div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <LiveStat label="Відстань" value={`${formatNumber1(recorder.liveDistanceKm)} км`} />
                <LiveStat label="Час" value={formatClock(elapsed)} />
                <LiveStat label="Швидкість, км/год" value={speedKmh != null ? String(Math.round(speedKmh)) : '—'} />
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted">
                <SignalDot signal={recorder.signal} />
                {recorder.signal === 'searching' ? 'Пошук GPS…' : recorder.signal === 'good' ? 'GPS: добре' : recorder.signal === 'weak' ? 'GPS: слабкий' : 'GPS: немає сигналу'}
              </div>
              <Button variant="danger" size="lg" className="mt-3 w-full" onClick={() => void finish()}>
                <Square size={18} /> Завершити поїздку
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full" onClick={() => void actions.startTrip()}>
              <Play size={20} /> Почати поїздку
            </Button>
          )}
        </div>
      </div>

      <Sheet open={!!finished} onClose={() => setFinished(null)} title="Дуже коротка поїздка">
        {finished && (
          <div className="space-y-4">
            <p className="text-muted">
              Записано лише {Math.round(finished.trip.distance_km * 1000)} м. Схоже, авто не рухалось або не було GPS. Зберегти поїздку?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  await actions.discardTrip();
                  setFinished(null);
                }}
              >
                Видалити
              </Button>
              <Button
                onClick={async () => {
                  const saved = await actions.saveTrip(finished);
                  setFinished(null);
                  navigate(`/trips/${saved.id}`);
                }}
              >
                Зберегти
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!newPlaceAt} onClose={() => setNewPlaceAt(null)} title="Нове місце">
        {newPlaceAt && (
          <PlaceForm
            initial={newPlaceAt}
            onSubmit={async (p) => {
              await actions.addPlace(p);
              setNewPlaceAt(null);
            }}
          />
        )}
      </Sheet>

      <Sheet open={routesOpen} onClose={() => setRoutesOpen(false)} title="Куди їдемо?">
        {bundle && bundle.places.length === 0 ? (
          <p className="text-muted">Додайте збережені місця (кнопка 📍 або довге натискання на карті).</p>
        ) : (
          <ul className="divide-y divide-line">
            {bundle?.places.map((p) => {
              const hist = frequent.find((r) => r.endPlaceId === p.id && (!fromPlaceId || r.startPlaceId === fromPlaceId));
              const from = hist ? placeName(hist.startPlaceId) : null;
              return (
                <li key={p.id}>
                  <button
                    className="flex min-h-16 w-full items-center gap-3 py-2 text-left"
                    onClick={() => void navigationService.startNavigation({ lat: p.latitude, lng: p.longitude }, p.name)}
                  >
                    <span className="text-2xl">{p.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p.name}</span>
                      {hist && from && (
                        <span className="block text-sm text-muted">
                          {from.icon} {from.name} → {p.icon} {p.name}: {formatKm(hist.avgDistanceKm, 1)} · ~{formatDuration(hist.avgDurationSeconds)}
                        </span>
                      )}
                    </span>
                    <Navigation size={18} className="text-accent" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          Оцінка — з вашої історії поїздок. Маршрут будує {navigationService.name.toLowerCase()} (Google Maps / інший встановлений).
        </p>
      </Sheet>
    </div>
  );
}

/** Device speed when reported; otherwise derived from the last two stored fixes. */
function liveSpeedKmh(last: GpsFix | null, fixes: GpsFix[] | undefined): number | null {
  if (last?.speed != null && last.speed >= 0) return last.speed * 3.6;
  const a = fixes?.[fixes.length - 2];
  const b = fixes?.[fixes.length - 1];
  if (!a || !b) return null;
  const dt = (b.timestamp - a.timestamp) / 1000;
  if (dt <= 0 || dt > 15 || Date.now() - b.timestamp > 15_000) return null;
  return (haversineMeters(a, b) / dt) * 3.6;
}

function MapFab({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="grid h-12 w-12 place-items-center rounded-full border border-line bg-surface text-fg shadow-lg active:scale-95">
      {children}
    </button>
  );
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular whitespace-nowrap text-xl font-semibold">{value}</div>
    </div>
  );
}

function SignalDot({ signal }: { signal: string }) {
  return (
    <span
      className={cn(
        'h-2 w-2 rounded-full',
        signal === 'good' && 'bg-ok',
        signal === 'weak' && 'bg-soon',
        signal === 'lost' && 'bg-due',
        signal === 'searching' && 'animate-pulse bg-muted',
      )}
    />
  );
}
