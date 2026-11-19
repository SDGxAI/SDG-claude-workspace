-- SDG Sites: Kommentare hängen am Element statt an einer Prozent-Position
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0016).
--
-- Bisher wurde die Stelle eines Kommentars als Prozent der Seitenhöhe
-- gespeichert – ändert sich die Seite, verrutscht der Pin. Jetzt merkt sich
-- Sites das Element (Kennung) und die Lage darin: {"sid":"s12","dx":0.5,"dy":0.3}.
-- Ohne diese Spalte funktioniert alles weiter, nur eben mit der alten Position.
alter table comments add column if not exists anchor jsonb;
