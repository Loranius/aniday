import { Link } from 'react-router-dom';
import { useAppData } from '@/app/appDataContext';
import { formatNumber1 } from '@/ui/format';
import { cn } from '@/ui/cn';

export function RecordingPill() {
  const { recorder } = useAppData();
  const interrupted = recorder.status === 'interrupted';
  return (
    <Link
      to="/map"
      className={cn(
        'safe-top sticky top-0 z-50 flex items-center justify-center gap-2 py-2 text-sm font-medium',
        interrupted ? 'bg-soon text-black' : 'bg-accent text-accent-fg',
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', interrupted ? 'bg-black' : 'animate-pulse bg-current')} />
      {interrupted ? 'Поїздку перервано — відкрити' : `Запис поїздки · ${formatNumber1(recorder.liveDistanceKm)} км`}
    </Link>
  );
}
