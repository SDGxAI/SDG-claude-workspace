# Deployment-Anleitung (für die Agentur)

Diese App ist eine Standard-Next.js-14-Anwendung (App Router) und wird
regulär auf Vercel deployed. Kein Docker, keine Sonderinfrastruktur.

## Überblick

- **Frontend/Backend:** Next.js 14 im Ordner `web/` dieses Repos
- **Datenbank/Auth/Storage:** Supabase Cloud (bereits eingerichtet)
- **Hosting:** Vercel (empfohlen) oder jede Node-fähige Plattform

## 1. Vercel-Projekt anlegen

1. Auf https://vercel.com mit dem GitHub-Konto anmelden
2. **Add New… → Project** → dieses GitHub-Repo importieren
3. **Root Directory** auf `web` setzen (wichtig, da die App im Unterordner
   liegt)
4. Framework wird automatisch als **Next.js** erkannt
5. Build-Kommando `npm run build`, Output wird automatisch erkannt

## 2. Umgebungsvariablen setzen

Unter **Project Settings → Environment Variables** folgende Werte eintragen
(aus dem Supabase-Dashboard → Project Settings → API):

| Variable | Wert | Sichtbarkeit |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (https://…supabase.co) | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable Key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role/secret Key | **geheim** |
| `NEXT_PUBLIC_SITE_URL` | die spätere Live-URL (z. B. https://landingpages.simba-dickie.com) | Public |

`NEXT_PUBLIC_SITE_URL` wird für die Links in den Einladungs-E-Mails
gebraucht und muss auf die tatsächliche Deployment-URL zeigen.

## 3. Supabase-Konfiguration prüfen

Im Supabase-Dashboard (einmalig, siehe auch `docs/ADMIN_SETUP.md`):

- **Authentication → URL Configuration:**
  - Site URL = die Live-URL
  - Redirect URLs enthalten `https://DEINE-DOMAIN/**`
- **Authentication → Sign In / Providers:** „Allow new users to sign up"
  ist **aus** (nur Einladungen)
- Die SQL-Migrationen `supabase/migrations/0001_init.sql` und
  `0002_storage.sql` sind im SQL Editor ausgeführt

## 4. Deployen

**Deploy** klicken. Jeder weitere Push auf den konfigurierten Branch löst
automatisch ein neues Deployment aus.

## 5. Eigene Domain (optional)

Unter **Project Settings → Domains** die gewünschte SDG-Domain hinzufügen
und den DNS-Anweisungen von Vercel folgen. Danach `NEXT_PUBLIC_SITE_URL`
und die Supabase-URL-Konfiguration auf die neue Domain anpassen.

## Lokale Entwicklung

```bash
cd web
cp .env.example .env.local   # Werte eintragen
npm install
npm run dev                  # http://localhost:3000
```

## Automatisierte Prüfungen

```bash
npm run lint          # Linting
npm run build         # Produktions-Build
npm run test:parse    # HTML-Erkennung
npm run test:editor   # Live-Bearbeitungslogik
npm run test:export   # Export-Transformationen
```
