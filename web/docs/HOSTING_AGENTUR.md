# Hosting durch eine Agentur (inkl. Deutschland/Hetzner)

Dieses Dokument richtet sich an die Agentur/IT, die das Hosting übernimmt.
Es beschreibt, was die App braucht und welche Hosting-Wege es gibt – von
„einfach & managed" bis „alles in Deutschland, self-hosted".

## Was die App technisch ist

- **Frontend + Backend:** Eine **Next.js 14** (App Router) Anwendung im
  Ordner `web/`. Braucht eine **Node.js-Laufzeitumgebung** (Server-Side
  Rendering + Server Actions/Route Handler). **Kein** reines PHP-/Static-
  Hosting möglich.
- **Datenbank/Auth/Storage:** Nutzt **Supabase** (PostgreSQL + GoTrue-Auth
  + Storage) über das offizielle SDK. Supabase ist Open Source und kann
  **managed** (supabase.com) **oder self-hosted** betrieben werden – der
  App-Code ist in beiden Fällen identisch, nur die drei Umgebungsvariablen
  zeigen auf die jeweilige Instanz.

### Nötige Umgebungsvariablen
| Variable | Bedeutung |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL der Supabase-Instanz |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | öffentlicher (anon/publishable) Key |
| `SUPABASE_SERVICE_ROLE_KEY` | geheimer service-role/secret Key |
| `NEXT_PUBLIC_SITE_URL` | öffentliche App-Adresse (für E-Mail-Links) |
| `ADMIN_CONFIRM_PASSWORD` | Bestätigungspasswort für Admin-Vergabe |

### Datenbank-Einrichtung
Einmalig `web/supabase/setup_all.sql` im SQL-Editor der Supabase-Instanz
ausführen (Schema, RLS-Policies, Trigger, Storage-Buckets). Details/Erst-
Admin: `web/docs/ADMIN_SETUP.md`.

## Die drei realistischen Hosting-Wege

### Weg 1 – Managed, US-Anbieter (aktueller Stand)
- **Vercel** (App) + **Supabase Cloud** (DB/Auth/Storage), beide mit
  Region **Frankfurt** wählbar → Daten physisch in Deutschland.
- **Pro:** null Server-Wartung, Auto-Deploy aus GitHub, Backups inklusive.
- **Contra:** Anbieter sind US-Unternehmen (Auftragsverarbeiter) → für
  strenge DSGVO-Bewertung AVV/DPA nötig.
- Aufwand Agentur: minimal (nur Env-Variablen + Domain).

### Weg 2 – Deutschland, self-hosted auf Hetzner (empfohlen für volle DE-Datenhaltung)
Deutscher Anbieter, deutsche Rechenzentren. Die Agentur richtet einen
Server ein und betreibt beide Teile dort.

Empfohlenes Setup:
- **Hetzner Cloud VPS** (z. B. CPX21/CPX31, Standort Nürnberg oder
  Falkenstein), Ubuntu.
- **Next.js-App** als Docker-Container oder via Node + PM2; davor
  **Nginx** als Reverse Proxy mit **Let's-Encrypt-SSL**.
- **Supabase self-hosted** per Docker-Compose (offizielles Repo) auf
  demselben oder einem zweiten Server – liefert PostgreSQL, Auth und
  Storage. Die drei Env-Variablen der App zeigen dann auf diese Instanz.
- **Backups** (z. B. `pg_dump` + Hetzner Storage Box) und **Updates**
  organisiert die Agentur.
- **Pro:** vollständige Datenhaltung + Anbieter in Deutschland, volle
  Kontrolle, keine Nutzungslimits.
- **Contra:** laufende Server-Wartung (Sicherheit, Updates, Backups,
  Monitoring) liegt bei der Agentur.
- Aufwand Agentur: einmalig Setup + laufender Betrieb.

### Weg 3 – Hostinger
- Die günstigen **Shared-Hosting**-Pakete (PHP/WordPress) sind **nicht**
  geeignet (kein Node.js-Serverbetrieb). Nur ein **Hostinger VPS** könnte
  die App wie bei Weg 2 betreiben.
- EU-Rechenzentren vorhanden, aber für „alles in Deutschland" ist Hetzner
  die naheliegendere Wahl.

## Deploy-Grundlagen (für jeden Node-Host)
```bash
# im Ordner web/
npm ci
npm run build
npm run start   # startet den Next.js-Server (Port 3000)
```
Davor gehört ein Reverse Proxy (Nginx) mit HTTPS; als Prozessmanager
eignen sich PM2 oder ein systemd-Service bzw. ein Docker-Container.

## Empfehlung
- Schnell live & wenig Wartung, Frankfurt-Region: **Weg 1**.
- Maximale Datenhoheit „made in Germany": **Weg 2 (Hetzner + self-hosted
  Supabase)**.
Der App-Code bleibt in allen Fällen unverändert – es ändern sich nur
Betrieb und die Umgebungsvariablen.
