import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '@/app/appDataContext';
import type { Trip } from '@/domain/types';
import { formatDayHeading, formatDuration, formatKm, formatTime, pluralTrips } from '@/ui/format';
import { Button, Card, EmptyState, PageHeader } from '@/ui/primitives';
import { cn } from '@/ui/cn';
import { tripTitle } from './tripLabels';

const PAGE_DAYS = 14;

export function TripsScreen() {
  const { bundle, now } = useAppData();
  const [days, setDays] = useState(PAGE_DAYS);
  const trips = bundle?.trips;
  const places = bundle?.places ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, Trip[]>();
    for (const t of trips ?? []) {
      const key = new Date(t.started_at).toDateString();
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()];
  }, [trips]);

  if (!bundle) return null;
  if (bundle.trips.length === 0)
    return (
      <div>
        <PageHeader title="Поїздки" />
        <EmptyState
          icon="🚗"
          title="Ще немає поїздок"
          text="Натисніть «Почати поїздку» на карті — маршрут і кілометраж запишуться автоматично."
          action={
            <Link to="/map">
              <Button>Відкрити карту</Button>
            </Link>
          }
        />
      </div>
    );

  return (
    <div>
      <PageHeader title="Поїздки" subtitle={`${pluralTrips(bundle.trips.length)} всього`} />
      {groups.slice(0, days).map(([day, list]) => {
        const km = list.filter((t) => t.is_valid).reduce((s, t) => s + t.distance_km, 0);
        return (
          <section key={day} className="mt-4">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="font-semibold">{formatDayHeading(list[0]!.started_at, now)}</h2>
              <span className="tabular text-sm text-muted">{formatKm(km, 1)}</span>
            </div>
            <Card className="divide-y divide-line py-0">
              {list.map((t) => (
                <Link key={t.id} to={`/trips/${t.id}`} className={cn('block py-3', !t.is_valid && 'opacity-50')}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate font-medium">{tripTitle(t, places)}</div>
                    <div className="tabular shrink-0 font-semibold">{formatKm(t.distance_km, 1)}</div>
                  </div>
                  <div className="mt-0.5 flex justify-between text-sm text-muted">
                    <span>
                      {formatTime(t.started_at)}–{formatTime(t.ended_at)}
                      {!t.is_valid && ' · не враховано'}
                    </span>
                    <span>{formatDuration(t.duration_seconds)}</span>
                  </div>
                </Link>
              ))}
            </Card>
          </section>
        );
      })}
      {groups.length > days && (
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setDays(days + PAGE_DAYS)}>
          Показати ще
        </Button>
      )}
    </div>
  );
}
