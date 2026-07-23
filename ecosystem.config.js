// pm2-configuratie voor de VignetteHub mailbot.
//
// Draaien:
//   npm run build          (eenmalig, of na een codewijziging)
//   pm2 start ecosystem.config.js
//   pm2 logs vignet-mailbot
//   pm2 restart vignet-mailbot
//   pm2 stop vignet-mailbot        (noodstop: de bot verwerkt dan niets meer)
//
// pm2 leest .env niet zelf; de bot laadt .env via dotenv bij het opstarten.
// Zet gevoelige waarden dus in .env naast dit bestand, of geef ze via de
// omgeving mee. Dit CommonJS-bestand blijft .js zodat pm2 het direct inleest,
// los van de ESM-build in dist/.

module.exports = {
  apps: [
    {
      name: "vignet-mailbot",
      script: "dist/index.js",
      cwd: __dirname,
      // Node draait de gebouwde ESM-bundel. Geen extra flags nodig.
      exec_mode: "fork",
      instances: 1,
      // Automatisch herstarten bij een crash, met een oplopende wachttijd zodat
      // een blijvende fout niet in een herstartlus terechtkomt.
      autorestart: true,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      max_restarts: 20,
      // Bij geheugengroei herstarten (defensief; de bot houdt weinig in geheugen).
      max_memory_restart: "300M",
      // Logs: gescheiden bestanden met tijdstempel per regel.
      output: "logs/mailbot-out.log",
      error: "logs/mailbot-error.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
