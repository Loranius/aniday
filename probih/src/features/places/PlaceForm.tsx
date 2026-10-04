import { useState, type FormEvent } from 'react';
import type { LatLng } from '@/domain/geo';
import type { SavedPlace } from '@/domain/types';
import { Banner, Button, Field, Input } from '@/ui/primitives';
import { cn } from '@/ui/cn';

const ICONS = ['🏠', '💼', '🏋️', '🛒', '❤️', '⛽', '🔧', '🏫', '🌳', '📍'];

export function PlaceForm({
  initial,
  onSubmit,
}: {
  initial: LatLng;
  onSubmit: (p: Omit<SavedPlace, 'id' | 'user_id' | 'is_demo' | 'created_at'>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏠');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), icon, address: address.trim() || null, latitude: initial.lat, longitude: initial.lng, radius_m: 150 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ICONS.map((i) => (
          <button
            type="button"
            key={i}
            onClick={() => setIcon(i)}
            className={cn('grid h-12 w-12 place-items-center rounded-xl border text-2xl', icon === i ? 'border-accent bg-accent/15' : 'border-line')}
            aria-pressed={icon === i}
          >
            {i}
          </button>
        ))}
      </div>
      <Field label="Назва">
        <Input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Дім" />
      </Field>
      <Field label="Адреса (необов’язково)">
        <Input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <p className="tabular text-xs text-muted">
        {initial.lat.toFixed(5)}, {initial.lng.toFixed(5)} · радіус 150 м
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit" className="w-full" disabled={busy}>
        Зберегти місце
      </Button>
    </form>
  );
}
