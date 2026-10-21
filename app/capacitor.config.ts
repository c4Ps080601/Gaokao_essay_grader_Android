import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'org.essaygrader.android',
  appName: '续写批改站',
  webDir: 'mobile-dist',
  android: { allowMixedContent: false },
  server: { androidScheme: 'https' },
};
export default config;
