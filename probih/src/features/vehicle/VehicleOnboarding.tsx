import { useState } from 'react';
import { useAppData } from '@/app/appDataContext';
import { Button } from '@/ui/primitives';
import { VehicleForm } from './VehicleForm';

export function VehicleOnboarding() {
  const { actions, loadError } = useAppData();
  const [demoBusy, setDemoBusy] = useState(false);
  return (
    <div className="safe-top mx-auto max-w-lg px-5 pb-12 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">Ваш автомобіль</h1>
      <p className="mt-1 text-muted">Додайте авто, щоб почати облік пробігу та обслуговування.</p>
      {loadError && <p className="mt-3 text-sm text-soon">Немає зв’язку з сервером — дані збережуться локально й синхронізуються пізніше.</p>}
      <div className="mt-6">
        <VehicleForm submitLabel="Додати автомобіль" onSubmit={async (v) => void (await actions.createVehicle(v))} />
      </div>
      <div className="mt-8 border-t border-line pt-6 text-center">
        <p className="text-sm text-muted">Хочете спершу подивитися, як це працює?</p>
        <Button
          variant="secondary"
          className="mt-3"
          disabled={demoBusy}
          onClick={async () => {
            setDemoBusy(true);
            try {
              await actions.loadDemo();
            } finally {
              setDemoBusy(false);
            }
          }}
        >
          Завантажити демо-авто
        </Button>
      </div>
    </div>
  );
}
