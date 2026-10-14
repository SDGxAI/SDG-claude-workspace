# Shopify-Anbindung

Mit der Shopify-Anbindung lassen sich **nicht veröffentlichte Themes** (Vorschau)
in Sites kommentieren und per KI direkt in Shopify ändern.

## Einmalige Einrichtung

1. **Datenbank:** `supabase/migrations/0015_shopify.sql` im Supabase SQL Editor ausführen.
2. **Shopify-App anlegen** (einmal für die ganze Organisation):
   - Im Shopify **Dev Dashboard** eine App anlegen (z. B. „SDG Sites“).
   - Version mit: App-URL `https://<sites-domain>/api/shopify/auth`,
     „In Admin einbetten“ aus, Weiterleitungs-URL
     `https://<sites-domain>/api/shopify/callback`, Bereiche
     `read_themes,write_themes,write_files`. Version veröffentlichen.
3. **Shop in Sites verbinden:** Menü **Shopify** (nur Admins) → Shop-Adresse
   (`name.myshopify.com`), Client-ID, Client-Secret und ggf. Onlineshop-Passwort
   eintragen → **„Über Shopify freigeben ↗“**. In Shopify die Installation
   bestätigen; Shopify leitet zurück und Sites speichert ein dauerhaftes Token.
   (Alternativ „Shop verbinden“ mit Client-Credentials – klappt nur, wenn die App
   bereits im Shop installiert ist und Shop + App in derselben Organisation liegen.)

Ältere, direkt im Shopify-Admin angelegte Apps funktionieren ebenfalls – dann statt
Client-ID/Secret das Admin-API-Zugriffstoken (`shpat_…`) eintragen.

Zugangsdaten liegen nur in der Datenbank-Tabelle `shopify_connections`
(RLS ohne Policies → nur serverseitig lesbar) und werden nie an den Browser gegeben.

## Ablauf

- **Neues Projekt → Shopify-Theme:** Shop, Theme, Seite (z. B. `/` oder
  `/products/handle`) und Vorlage (`templates/*.json`) wählen. Sites lädt die
  Vorschau aus dem Shop; danach wird wie gewohnt mit Pins kommentiert.
- **Umsetzen / Mit KI bearbeiten:** Claude ändert die JSON-Dateien des Themes
  (Vorlage, Header/Footer-Gruppen, globale Einstellungen, Übersetzungen) und
  speichert sie sofort im Vorschau-Theme. Danach wird die Vorschau neu geladen.
- **Versionen:** Vor jeder ersten Änderung einer Datei merkt sich Sites das
  Original. Wiederherstellen schreibt die Theme-Dateien auf den Stand der Version
  zurück; „Verwerfen“ im KI-Chat setzt die Entwurfs-Änderungen zurück.
- **Vorschau in Shopify ↗** öffnet das echte Vorschau-Theme im Browser.
- **Aus Shopify neu laden** holt den aktuellen Stand, z. B. nach Änderungen im
  Shopify-Theme-Editor.

## Grenzen

- Die KI ändert nur Theme-Einstellungen und Inhalte (wie im Theme-Editor) sowie
  Abschnitts-CSS – keinen Liquid-Code. Produktdaten, Menüs und App-Einstellungen
  müssen in Shopify selbst gepflegt werden.
- Wer gleichzeitig im Shopify-Theme-Editor dieselben Dateien ändert, kann von
  „Wiederherstellen“ überschrieben werden.
- Die Vorschau in Sites zeigt die Seite ohne JavaScript (Slider, Pop-ups usw.
  sind statisch). Für das echte Verhalten „Vorschau in Shopify ↗“ nutzen.
