# SDG Landingpage-Editor

Interne Web-App für das SIMBA-DICKIE-GROUP-Marketingteam zur gemeinsamen
Bearbeitung von HTML-Landingpages (Farben, Texte, Bilder) inkl.
Feedback-Kommentaren und Rechteverwaltung.

## Tech-Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres, Auth, Storage)
- Hosting: Vercel (Deployment übernimmt die Agentur)

## Lokale Einrichtung

1. `.env.example` nach `.env.local` kopieren und mit den Supabase-Zugangsdaten
   befüllen (Supabase-Dashboard -> Project Settings -> API):
   ```bash
   cp .env.example .env.local
   ```
2. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
3. Datenbankschema einspielen: Inhalt von `supabase/migrations/0001_init.sql`
   im Supabase SQL Editor ausführen (einmalig).
4. Entwicklungsserver starten:
   ```bash
   npm run dev
   ```
   Die App läuft dann unter http://localhost:3000

## Nötige Umgebungsvariablen (auch für das Deployment)

| Variable | Wo zu finden | Öffentlich? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings -> API -> Project URL | ja |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings -> API -> anon public | ja |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings -> API -> service_role | **nein, geheim** |

Build-Kommando: `npm run build` — Start-Kommando: `npm run start` (Standard-Next.js,
keine Sonderkonfiguration nötig).
