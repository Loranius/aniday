import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ua.probih.app',
  appName: 'Пробіг',
  webDir: 'dist',
  android: {
    // Keep the WebView running JS while the trip foreground service is active.
    backgroundColor: '#0b0d10',
  },
};

export default config;
