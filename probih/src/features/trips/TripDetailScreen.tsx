import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppData } from '@/app/appDataContext';
import { useMap } from '@/map/useMap';
import type { LineStringGeometry } from '@/domain/types';
import { formatDate, formatDuration, formatKm, formatNumber1, formatTime } from '@/ui/format';
import { Banner, Button, Card, EmptyState, Field, PageHeader, Stat, Textarea } from '@/ui/primitives';
import { BackLink } from '@/ui/BackLink';
import { tripTitle } from './tripLabels';

export function TripDetailScreen() {
  const { id } = useParams();
  const { bundle, repo, actions } = useAppData();
  const trip = bundle?.trips.find((t) => t.id === id);
  const [geometry, setGeometry] = useState<LineStringGeometry | null>(trip?.route_geometry ?? null);
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const [saved, setSaved] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const { containerRef, map } = useMap({
    center: { lat: trip?.start_lat ?? 50.45, lng: trip?.start_lng ?? 30.52 },
    zoom: 13,
  });

  useEffect(() => {
    if (!trip || trip.route_geometry || !repo) return;
    repo
      .getTripGeometry(trip.id)
      .then(setGeometry)
      .catch(() => setGeoError(true));
  }, [trip, repo]);

  useEffect(() => {
    if (!map || !trip) return;
    const coords = geometry?.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? [];
    const pts = coords.length
      ? coords
      : [trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng } : null, trip.end_lat != null && trip.end_lng != null ? { lat: trip.end_lat, lng: trip.end_lng } : null].filter(
          (x): x is { lat: number; lng: number } => !!x,
        );
    map.drawRoute('detail', pts, 'detail', { showEndpoints: true });
    map.fitTo(pts, 30);
  }, [map, geometry, trip]);

  if (!bundle) return null;
  if (!trip) return <EmptyState icon="🤷" title="Поїздку не знайдено" action={<BackLink to="/trips" />} />;

  return (
    <div>
      <PageHeader back={<BackLink to="/trips" label="Поїздки" />} title={tripTitle(trip, bundle.places)} subtitle={formatDate(trip.started_at)} />
      <div ref={containerRef} className="relative z-0 mt-2 h-64 overflow-hidden rounded-2xl border border-line sm:h-80" />
      {geoError && <p className="mt-2 text-xs text-muted">Маршрут недоступний офлайн.</p>}

      {!trip.is_valid && (
        <div className="mt-3">
          <Banner tone="warn">Поїздку не враховано в пробігу{trip.invalid_reason ? `: ${trip.invalid_reason}` : ''}.</Banner>
        </div>
      )}

      <Card className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Відстань" value={formatKm(trip.distance_km, 1)} />
        <Stat label="Тривалість" value={formatDuration(trip.duration_seconds)} />
        <Stat label="Час" value={`${formatTime(trip.started_at)}–${formatTime(trip.ended_at)}`} />
        <Stat label="Середня швидкість" value={trip.average_speed != null ? `${formatNumber1(trip.average_speed)} км/год` : '—'} />
        <Stat label="Макс. швидкість" value={trip.max_speed ? `${Math.round(trip.max_speed)} км/год` : '—'} />
        <Stat label="Джерело" value={trip.source === 'phone' ? 'Телефон' : trip.source} />
      </Card>

      <Card className="mt-4 space-y-3">
        <Field label="Нотатки">
          <Textarea
            maxLength={1000}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Button
          variant="secondary"
          className="w-full"
          disabled={notes === (trip.notes ?? '')}
          onClick={async () => {
            await actions.updateTrip(trip.id, { notes: notes.trim() || null });
            setSaved(true);
          }}
        >
          {saved ? 'Збережено' : 'Зберегти нотатку'}
        </Button>
      </Card>

      <div className="mt-4">
        {trip.is_valid ? (
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              const reason = prompt('Чому поїздку не слід враховувати? (наприклад: GPS-збій, їхав не на цьому авто)');
              if (reason !== null) void actions.updateTrip(trip.id, { is_valid: false, invalid_reason: reason.trim().slice(0, 200) || 'Позначено вручну' });
            }}
          >
            Не враховувати в пробігу
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => void actions.updateTrip(trip.id, { is_valid: true, invalid_reason: null })}>
            Повернути в пробіг
          </Button>
        )}
        <p className="mt-2 text-center text-xs text-muted">Виміряні дані поїздки незмінні — це гарантує чесну історію пробігу.</p>
      </div>
    </div>
  );
}
