import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function BackLink({ to, label = 'Назад' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="-ml-1 mb-1 inline-flex h-10 items-center text-sm text-accent">
      <ChevronLeft size={18} /> {label}
    </Link>
  );
}
