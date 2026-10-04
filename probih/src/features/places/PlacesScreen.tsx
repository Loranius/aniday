import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { findFrequentRoutes } from '@/domain/trips';
import type { LatLng } from '@/domain/geo';
import { formatDuration, formatKm } from '@/ui/format';
import { Banner, Button, Card, EmptyState, PageHeader, SectionTitle, Sheet } from '@/ui/primitives';
import { BackLink } from '@/ui/BackLink';
import { PlaceForm } from './PlaceForm';

export function PlacesScreen() {
  const { bundle, actions, locationProvider } = useAppData();
  const [adding, setAdding] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const places = bundle?.places ?? [];
  const routes = useMemo(() => findFrequentRoutes(bundle?.trips ?? []), [bundle?.trips]);
  const byId = (id: string) => places.find((p) => p.id === id);

  async function addHere() {
    setError(null);
    try {
      const f = await locationProvider.getCurrent();
      setAdding(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <PageHeader back={<BackLink to="/more" />} title="Збережені місця" action={<Button onClick={addHere}>+ Тут</Button>} />
      {error && <Banner tone="error">{error}</Banner>}
      <p className="mb-3 text-sm text-muted">Місця підставляються в поїздки автоматично. Додати можна й довгим натисканням на карті.</p>
      {places.length === 0 ? (
        <EmptyState icon="📍" title="Поки немає місць" text="Додайте Дім, Роботу, Зал — і поїздки стануть зрозумілішими." />
      ) : (
        <Card className="divide-y divide-line py-1">
          {places.map((p) => (
            <div key={p.id} className="flex min-h-14 items-center gap-3 py-2">
              <span className="text-2xl">{p.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="truncate text-sm text-muted">{p.address ?? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`}</div>
              </div>
              <button
                aria-label={`Видалити ${p.name}`}
                className="grid h-11 w-11 place-items-center text-muted"
                onClick={() => confirm(`Видалити «${p.name}»?`) && void actions.deletePlace(p.id)}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </Card>
      )}

      {routes.length > 0 && (
        <>
          <SectionTitle>Ваші часті маршрути</SectionTitle>
          <Card className="divide-y divide-line py-1">
            {routes.map((r) => {
              const a = byId(r.startPlaceId);
              const b = byId(r.endPlaceId);
              if (!a || !b) return null;
              return (
                <div key={`${r.startPlaceId}-${r.endPlaceId}`} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    {a.icon} {a.name} → {b.icon} {b.name}
                  </div>
                  <div className="tabular shrink-0 text-right text-sm text-muted">
                    {formatKm(r.avgDistanceKm, 1)} · ~{formatDuration(r.avgDurationSeconds)}
                    <div className="text-xs">{r.count}×</div>
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <Sheet open={!!adding} onClose={() => setAdding(null)} title="Нове місце">
        {adding && (
          <PlaceForm
            initial={adding}
            onSubmit={async (p) => {
              await actions.addPlace(p);
              setAdding(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
