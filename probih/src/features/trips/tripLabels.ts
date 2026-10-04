import type { SavedPlace, Trip } from '@/domain/types';

export function tripTitle(t: Trip, places: SavedPlace[]): string {
  const p = (id: string | null) => (id ? places.find((x) => x.id === id) : undefined);
  const a = p(t.start_place_id);
  const b = p(t.end_place_id);
  const fmt = (x: SavedPlace | undefined, fallback: string) => (x ? `${x.icon} ${x.name}` : fallback);
  return `${fmt(a, '📍 Старт')} → ${fmt(b, '🏁 Фініш')}`;
}
