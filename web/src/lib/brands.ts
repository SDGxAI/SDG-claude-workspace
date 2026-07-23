/**
 * Feste Liste der SDG-Marken für das Marken-Dropdown bei Projekten.
 *
 * Diese Liste ist absichtlich die einzige Stelle im Code, die geändert
 * werden muss, wenn sich die Markenliste ändert (kein DB-Eintrag, keine
 * Migration nötig). Achtung beim Umbenennen: bestehende Projekte speichern
 * den Markennamen als Text - eine vorhandene Marke umbenennen statt
 * löschen+neu anlegen, sonst "verwaisen" alte Projekte mit dem alten Namen.
 */
export const SDG_BRANDS = [
  "AquaPlay",
  "BIG",
  "Carson",
  "Corolle",
  "Dickie Toys",
  "Eichhorn",
  "Jada Toys",
  "Majorette",
  "Noris",
  "Schipper",
  "Simba",
  "Smoby",
  "Tamiya",
  "Zoch",
] as const;

export type SdgBrand = (typeof SDG_BRANDS)[number];
