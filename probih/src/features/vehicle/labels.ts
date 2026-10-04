import type { FuelType, Transmission } from '@/domain/types';

export const FUEL_LABELS: Record<FuelType, string> = {
  petrol: 'Бензин',
  diesel: 'Дизель',
  lpg: 'Газ (LPG)',
  cng: 'Метан (CNG)',
  hybrid: 'Гібрид',
  electric: 'Електро',
};
export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  manual: 'Механіка (МКПП)',
  automatic: 'Автомат (АКПП)',
  cvt: 'Варіатор (CVT)',
  robot: 'Робот',
};
