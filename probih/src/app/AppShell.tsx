import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Car, Ellipsis, Map, Route as RouteIcon, Wrench } from 'lucide-react';
import { useAppData } from './appDataContext';
import { cn } from '@/ui/cn';
import { RecordingPill } from '@/features/map/RecordingPill';

const TABS = [
  { to: '/map', label: 'Карта', icon: Map },
  { to: '/trips', label: 'Поїздки', icon: RouteIcon },
  { to: '/car', label: 'Авто', icon: Car },
  { to: '/maintenance', label: 'Обслуговування', icon: Wrench },
  { to: '/more', label: 'Ще', icon: Ellipsis },
] as const;

export function AppShell() {
  const { pathname } = useLocation();
  const { recorder } = useAppData();
  const fullBleed = pathname === '/map';
  const showPill = !fullBleed && (recorder.status === 'recording' || recorder.status === 'starting' || recorder.status === 'interrupted');

  return (
    <div className="flex h-full lg:pl-24">
      <main className={cn('min-h-0 flex-1', fullBleed ? 'relative h-full' : 'overflow-y-auto pb-28 lg:pb-8')}>
        {showPill && <RecordingPill />}
        {fullBleed ? (
          <Outlet />
        ) : (
          <div className="mx-auto w-full max-w-2xl px-4">
            <Outlet />
          </div>
        )}
      </main>

      <nav
        aria-label="Основна навігація"
        className="safe-bottom fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-surface/95 backdrop-blur lg:inset-y-0 lg:left-0 lg:right-auto lg:w-24 lg:border-r lg:border-t-0"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-5 lg:mt-6 lg:flex lg:flex-col lg:gap-2">
          {TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex h-16 flex-col items-center justify-center gap-1 px-0.5 text-center text-[10.5px] leading-tight font-medium tracking-tight transition',
                    isActive ? 'text-accent' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('grid h-8 w-14 place-items-center rounded-full transition', isActive && 'bg-accent/15')}>
                      <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
