import { useState } from 'react';
import { useAppData } from '@/app/appDataContext';
import { Banner, PageHeader } from '@/ui/primitives';
import { BackLink } from '@/ui/BackLink';
import { VehicleForm } from './VehicleForm';

export function VehicleSettingsScreen() {
  const { activeVehicle: v, actions } = useAppData();
  const [saved, setSaved] = useState(false);
  if (!v) return null;
  return (
    <div>
      <PageHeader back={<BackLink to="/more" />} title="Автомобіль" />
      {saved && (
        <div className="mb-3">
          <Banner>Збережено</Banner>
        </div>
      )}
      <VehicleForm
        key={v.id}
        initial={v}
        showOdometer={false}
        submitLabel="Зберегти"
        onSubmit={async (input) => {
          // The odometer baseline is changed on the "Пробіг" screen, not here.
          const patch: Partial<typeof input> = { ...input };
          delete patch.initial_odometer;
          await actions.updateVehicle(patch);
          setSaved(true);
        }}
      />
    </div>
  );
}
