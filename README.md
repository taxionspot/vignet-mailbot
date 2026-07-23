# VignetteHub mailbot

Autonome e-mailbot die klantmails van VignetteHub leest, in de taal van de klant
beantwoordt, en orders annuleert plus terugbetaalt zolang het vignet nog niet is
ingekocht. Draait als losstaande Node-service onder pm2, buiten de app om.

Bron van waarheid voor het gedrag: `docs/MAILBOT-SPEC-2026-07-23.md` in de
app-repo (`sites/vignet-mvp`).

## Wat deze service doet

- Pollt elke 30 seconden op ongelezen mail in INBOX (Zoho IMAP).
- Classificeert elke mail (intent, taal, vertrouwen) en matcht hem aan een order
  via VH-nummer, e-mailadres of kenteken.
- Beantwoordt autonoom bij status-, product-, bewijs- en kentekenvragen, en
  annuleert plus refundt een order die nog niet is ingekocht.
- Escaleert naar een mens (Sabur) bij facturen, betaalproblemen, juridische
  klachten, twijfel, of als de afzender niet de besteller is.
- Verplaatst verwerkte mail naar `Bot/Afgehandeld`, `Bot/Escalatie` of
  `Bot/Fout`. Wist nooit iets.

De bot praat met de app via `https://vignettehub.com/api/bot/*` met een eigen
`BOT_SECRET`. Hij heeft geen adminrechten en kiest nooit zelf een bedrag: het
refundbedrag komt altijd server-side uit de database.

## Architectuur van de code

| Bestand | Rol |
|---|---|
| `src/index.ts` | De lus: poll, guards, match, classificeer, stel op, controleer, verstuur of escaleer, log. |
| `src/config.ts` | Alle configuratie uit de omgeving, met harde validatie bij het opstarten. |
| `src/imap.ts` | IMAP-verbinding met herverbinding, ophalen, markeren en verplaatsen. |
| `src/parse.ts` | Ruwe mail naar een geparseerd object; citaat en handtekening strippen. |
| `src/match.ts` | Ordermatching (VH-nummer, e-mail, kenteken) en de identiteitsregel. |
| `src/guards.ts` | Schakelaars, caps (op schijf) en lus-beveiliging. |
| `src/api.ts` | Getypeerde client voor `/api/bot/order`, `/api/bot/actie`, `/api/bot/log`. |
| `src/types.ts` | Gedeelde contracten; het koppelvlak met de LLM-laag. |
| `src/log.ts` | Simpele logger met tijdstempel. |
| `src/classify.ts`, `src/compose.ts`, `src/verify.ts`, `src/acties.ts` | De LLM-laag en de acties (aparte bouwers), volgens de types in `src/types.ts`. |

## Opzetten op een Hetzner CX22 (Ubuntu 22.04/24.04)

De CX22 staat in Duitsland (EU-IP), zoals de spec voorschrijft. Dezelfde machine
wordt in fase 2 ook de inkooprobot.

### 1. Node 20 installeren

```bash
# Als root of met sudo
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
node -v   # verwacht v20.x of hoger
```

### 2. pm2 installeren

```bash
npm install -g pm2
```

### 3. Repo klonen en bouwen

```bash
cd /opt
git clone <repo-url> vignet-mailbot
cd vignet-mailbot
npm install
npm run build
```

### 4. .env vullen

```bash
cp .env.example .env
nano .env
```

Verplicht invullen: `ZOHO_IMAP_HOST`, `ZOHO_IMAP_USER`, `ZOHO_APP_PASSWORD`,
`APP_BASIS_URL`, `BOT_SECRET`, `ANTHROPIC_API_KEY`, `ESCALATIE_EMAIL`. Zie de
uitleg per waarde in `.env.example`. De drie schakelaars staan standaard aan.

Test eerst een enkele ronde zonder de service als daemon te draaien:

```bash
npm run eenmalig
```

Dit verwerkt een keer de inbox en stopt. Kijk of de mappen `Bot/Afgehandeld`,
`Bot/Escalatie` en `Bot/Fout` zijn aangemaakt en of er niets misgaat.

### 5. Starten onder pm2

```bash
pm2 start ecosystem.config.js
pm2 save                 # bewaart de proceslijst
pm2 startup              # volg de instructie zodat pm2 herstart na een reboot
```

### 6. Logs bekijken

```bash
pm2 logs vignet-mailbot          # live meekijken
pm2 logs vignet-mailbot --lines 200
tail -f logs/mailbot-out.log     # of rechtstreeks de logbestanden
```

Zet `LOG_DEBUG=1` in `.env` voor uitgebreide logging tijdens het inregelen.

## Noodstop

Er zijn drie niveaus, van zacht naar hard.

1. **Onderdeel uitzetten zonder herstart.** Zet in `.env` de betreffende
   schakelaar op 0 en herstart de service:
   - `MAILBOT_REFUND=0` stopt alleen de terugbetalingen.
   - `MAILBOT_SEND=0` stopt alle uitgaande klantmail (de bot blijft wel lezen en
     escaleren).
   - `MAILBOT_ENABLED=0` stopt het lezen en verwerken volledig.
   Daarna: `pm2 restart vignet-mailbot`.

2. **Proces pauzeren.** `pm2 stop vignet-mailbot`. De bot leest en verstuurt
   niets meer; ongelezen mail blijft gewoon in INBOX staan tot je hem weer start
   met `pm2 restart vignet-mailbot`.

3. **Proces verwijderen.** `pm2 delete vignet-mailbot`. Volledig weg uit pm2.

De caps staan in `data/caps.json` op schijf en overleven een herstart, zodat de
daglimieten niet resetten door een `pm2 restart`.

## Onderhoud

- **Codewijziging uitrollen:** `git pull && npm run build && pm2 restart vignet-mailbot`.
- **App-wachtwoord of API-key roteren:** waarde in `.env` aanpassen en
  `pm2 restart vignet-mailbot`.
- **Vastgelopen mail terugvinden:** kijk in de map `Bot/Fout` in Zoho. Die mails
  zijn wel als gelezen gemarkeerd maar niet automatisch afgehandeld; los ze met
  de hand op.
