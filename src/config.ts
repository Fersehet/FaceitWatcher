try {
  process.loadEnvFile();
} catch {
  // Keine .env vorhanden: Standardwerte bzw. Demo-Modus
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  /** 0.0.0.0 = auch im Heimnetz und aus Docker erreichbar */
  host: process.env.HOST || '0.0.0.0',
  faceitApiKey: process.env.FACEIT_API_KEY?.trim() || '',
  defaultNickname: process.env.FACEIT_NICKNAME?.trim() || '',
  pollIntervalSeconds: Math.max(15, Number(process.env.POLL_INTERVAL_SECONDS) || 60),
  dbPath: process.env.DB_PATH || './data/faceitwatcher.db',
};

export const isDemo = config.faceitApiKey === '';
