-- SDG Sites: Kommentare auf Unterseiten eines Shopify-Shops
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0015).
--
-- In der Shopify-Live-Ansicht kann man im Shop navigieren (Kategorien,
-- Produkte …) und dort kommentieren. Der Kommentar merkt sich die Seite.
-- Leer (NULL) = die Hauptseite des Projekts.

alter table comments add column if not exists page_path text;
