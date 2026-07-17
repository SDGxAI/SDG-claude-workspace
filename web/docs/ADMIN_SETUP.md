# Einmalige Einrichtung: Erster Admin & Auth-Einstellungen

Diese Schritte machst du **einmalig** im Supabase-Dashboard
(https://supabase.com/dashboard, dein Projekt öffnen). Danach läuft alles
über die App selbst.

## 1. Dich selbst als erste:n Nutzer:in anlegen

1. Linke Seitenleiste: **Authentication** (Schloss-Symbol)
2. Oben: Reiter **Users**
3. Rechts oben: Button **"Add user"** → **"Create new user"**
4. Deine E-Mail-Adresse und ein Passwort (mind. 8 Zeichen) eingeben
5. Haken bei **"Auto Confirm User"** setzen (wichtig – sonst wartet das
   System auf eine Bestätigungsmail)
6. **"Create user"** klicken

## 2. Dich zum Admin machen

1. Linke Seitenleiste: **SQL Editor** (Terminal-Symbol, dasselbe wie beim
   Schema)
2. Neue Query, folgendes einfügen – **ersetze die E-Mail durch deine**:

   ```sql
   update profiles
   set is_admin = true, status = 'aktiv'
   where email = 'deine.email@simba-dickie.com';
   ```

3. **Run** klicken → es sollte "Success" mit "1 rows affected" o. ä.
   erscheinen.

   (Hinweis: `status = 'aktiv'` wird hier mitgesetzt, weil der Automatik-
   Trigger nur bei später bestätigten Einladungen greift, nicht bei
   direkt im Dashboard angelegten Nutzern.)

## 3. Offene Registrierung abschalten (nur Einladungen erlauben)

1. **Authentication** → links im Untermenü **Sign In / Providers**
   (je nach Dashboard-Version auch "Providers" oder "Sign In / Up")
2. Beim Punkt **"Allow new users to sign up"** den Schalter **ausschalten**
3. Speichern

Wichtig: Admin-Einladungen funktionieren trotzdem weiter – dieser Schalter
blockiert nur die offene Selbst-Registrierung.

## 4. Redirect-URLs für Einladungslinks erlauben

Damit der Link in der Einladungsmail zur Passwort-festlegen-Seite der App
führen darf:

1. **Authentication** → links im Untermenü **URL Configuration**
2. **Site URL** setzen auf:
   - lokal zum Testen: `http://localhost:3000`
   - nach dem Deployment: die echte App-Adresse (z. B.
     `https://landingpages.simba-dickie.com`)
3. Unter **Redirect URLs** → **"Add URL"**:
   - `http://localhost:3000/**`
   - nach dem Deployment zusätzlich: `https://DEINE-DOMAIN/**`
4. Speichern

## Fertig!

Ab jetzt gilt:
- Du meldest dich in der App unter `/login` mit E-Mail + Passwort an.
- Neue Kolleg:innen lädst du über die Seite **"Nutzer & Rechte"** in der
  App ein – sie bekommen eine E-Mail mit Link, legen ihr Passwort fest
  und sind dann aktiv.
- Weitere Admins kannst du bei Bedarf mit demselben SQL-Statement aus
  Schritt 2 ernennen (nur `is_admin = true`, die Status-Zeile weglassen).
