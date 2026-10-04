import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/domain/geo';
import { createMapProvider } from './LeafletMapProvider';
import type { MapProvider } from './MapProvider';

/** Creates a MapProvider bound to the returned container ref for the component's lifetime. */
export function useMap(initial: { center: LatLng; zoom: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MapProvider | null>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const provider = createMapProvider();
    let disposed = false;
    void provider.initialize(el, initialRef.current).then(() => {
      if (!disposed) setMap(provider);
    });
    const ro = new ResizeObserver(() => provider.invalidateSize());
    ro.observe(el);
    return () => {
      disposed = true;
      ro.disconnect();
      provider.destroy();
      setMap(null);
    };
  }, []);

  return { containerRef, map };
}
