import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppDataProvider } from './AppDataProvider';
import { useAppData } from './appDataContext';
import { AppShell } from './AppShell';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { SetupScreen } from '@/features/auth/SetupScreen';
import { VehicleOnboarding } from '@/features/vehicle/VehicleOnboarding';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { MapScreen } from '@/features/map/MapScreen';
import { TripsScreen } from '@/features/trips/TripsScreen';
import { TripDetailScreen } from '@/features/trips/TripDetailScreen';
import { MaintenanceScreen } from '@/features/maintenance/MaintenanceScreen';
import { MaintenanceItemScreen } from '@/features/maintenance/MaintenanceItemScreen';
import { MoreScreen } from '@/features/more/MoreScreen';
import { FuelScreen } from '@/features/fuel/FuelScreen';
import { PlacesScreen } from '@/features/places/PlacesScreen';
import { VehicleSettingsScreen } from '@/features/vehicle/VehicleSettingsScreen';
import { OdometerScreen } from '@/features/vehicle/OdometerScreen';
import { SyncScreen } from '@/features/more/SyncScreen';

function Gate() {
  const { configured, authReady, session, vehicles, loading } = useAppData();
  if (!configured) return <SetupScreen />;
  if (!authReady) return <Splash />;
  if (!session) return <AuthScreen />;
  if (vehicles.length === 0) return loading ? <Splash /> : <VehicleOnboarding />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/car" element={<DashboardScreen />} />
        <Route path="/map" element={<MapScreen />} />
        <Route path="/trips" element={<TripsScreen />} />
        <Route path="/trips/:id" element={<TripDetailScreen />} />
        <Route path="/maintenance" element={<MaintenanceScreen />} />
        <Route path="/maintenance/:id" element={<MaintenanceItemScreen />} />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="/more/fuel" element={<FuelScreen />} />
        <Route path="/more/places" element={<PlacesScreen />} />
        <Route path="/more/vehicle" element={<VehicleSettingsScreen />} />
        <Route path="/more/odometer" element={<OdometerScreen />} />
        <Route path="/more/sync" element={<SyncScreen />} />
        <Route path="*" element={<Navigate to="/car" replace />} />
      </Route>
    </Routes>
  );
}

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  );
}

export function App() {
  return (
    <AppDataProvider>
      <HashRouter>
        <Gate />
      </HashRouter>
    </AppDataProvider>
  );
}
