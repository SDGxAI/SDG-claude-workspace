<?php
/**
 * Lokale Vorschau fuer ein MiniCMS-Projekt (Entwurfsstand).
 *
 * Rendert content.twig und meta.json.twig mit echtem Twig und baut daraus eine
 * eigenstaendige HTML-Datei, die den Inhalt – wie im MiniCMS – in einem
 * ShadowRoot mountet und das Projekt ZWEIMAL auf derselben Seite instanziiert
 * (entspricht "Instance 1/2" in dev.php).
 *
 * Das ist kein Ersatz fuer die Vorschau im MiniCMS, sondern nur ein Blick auf
 * Layout, Uebersetzungen und JS-Verhalten, solange das MiniCMS-Repo nicht
 * verfuegbar ist.
 *
 * Voraussetzung: twig/twig via composer, z. B.
 *   mkdir -p .twig && cd .twig && composer require twig/twig
 *   MINICMS_VENDOR=.twig/vendor/autoload.php php minicms/tools/preview.php <projekt> [locale]
 */

$projectArg = $argv[1] ?? null;
$locale     = $argv[2] ?? 'de';

if ($projectArg === null) {
    fwrite(STDERR, "Aufruf: php minicms/tools/preview.php <projektordner> [locale]\n");
    exit(2);
}

$projectDir = realpath(rtrim($projectArg, '/'));
if ($projectDir === false || !is_dir($projectDir)) {
    fwrite(STDERR, "Kein Verzeichnis: {$projectArg}\n");
    exit(2);
}

$autoloadCandidates = array_filter([
    getenv('MINICMS_VENDOR') ?: null,
    __DIR__ . '/vendor/autoload.php',
    getcwd() . '/vendor/autoload.php',
]);
$autoload = null;
foreach ($autoloadCandidates as $candidate) {
    if (is_file($candidate)) {
        $autoload = $candidate;
        break;
    }
}
if ($autoload === null) {
    fwrite(STDERR, "twig/twig nicht gefunden. MINICMS_VENDOR auf vendor/autoload.php setzen.\n");
    exit(2);
}
require $autoload;

$projectName   = basename($projectDir);
$translationFile = "{$projectDir}/translations/{$locale}.json";
if (!is_file($translationFile)) {
    fwrite(STDERR, "Keine Uebersetzung fuer '{$locale}': {$translationFile}\n");
    exit(2);
}
$translations = json_decode(file_get_contents($translationFile), true, 512, JSON_THROW_ON_ERROR);

/** Minimaler Ersatz fuer den media-Helper des MiniCMS. */
final class PreviewMedia
{
    public function __construct(private string $base) {}

    public function get_asset_link(string $path): string
    {
        return $this->base . ltrim($path, '/');
    }
}

$loader = new \Twig\Loader\FilesystemLoader($projectDir);
$twig   = new \Twig\Environment($loader, ['strict_variables' => false, 'autoescape' => 'html']);
$twig->addFilter(new \Twig\TwigFilter('trans', static function (string $key) use ($translations, $locale): string {
    if (!array_key_exists($key, $translations)) {
        fwrite(STDERR, "WARNUNG: Schluessel '{$key}' fehlt in {$locale}.json\n");
        return $key;
    }
    return (string) $translations[$key];
}));
$twig->addGlobal('media', new PreviewMedia("../projects/{$projectName}/"));

$content = $twig->render('content.twig');

$metaRaw = $twig->render('meta.json.twig');
$meta    = json_decode($metaRaw, true);
if (!is_array($meta)) {
    fwrite(STDERR, "WARNUNG: meta.json.twig ergibt kein gueltiges JSON:\n{$metaRaw}\n");
    $meta = [];
}

$cssFile = is_file("{$projectDir}/content.css.twig")
    ? $twig->render('content.css.twig')
    : (is_file("{$projectDir}/content.css") ? file_get_contents("{$projectDir}/content.css") : '');

$js = is_file("{$projectDir}/content.js") ? file_get_contents("{$projectDir}/content.js") : '';

$title = $meta['title'] ?? $projectName;

$payload = json_encode([
    'css'     => $cssFile,
    'content' => $content,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$outDir = dirname(__DIR__) . '/preview';
@mkdir($outDir, 0o777, true);
$outFile = "{$outDir}/{$projectName}.{$locale}.html";

$html = <<<HTML
<!DOCTYPE html>
<html lang="{$locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vorschau: {$title}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f3f1ef; }
  .preview-note { padding: 1rem 1.5rem; background: #1f2933; color: #fff; font-size: .9rem; line-height: 1.5; }
  .preview-note code { background: rgba(255,255,255,.14); padding: .1em .4em; border-radius: 4px; }
  .instance-label { padding: .6rem 1.5rem; font-size: .8rem; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; }
  .instance { background: #fff; }
  .instance.narrow { width: 480px; max-width: 100%; box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
</style>
</head>
<body>
<div class="preview-note">
  Lokale Entwurfs-Vorschau &ndash; nicht das MiniCMS. Inhalt liegt in je einem eigenen ShadowRoot;
  Instanz 2 laeuft absichtlich in <code>480px</code> Breite, um die Container Queries zu pruefen.
</div>

<div class="instance-label">Instance 1 &middot; volle Breite</div>
<div class="instance" id="instance-1"></div>

<div class="instance-label">Instance 2 &middot; 480px</div>
<div class="instance narrow" id="instance-2"></div>

<script type="application/json" id="payload">{$payload}</script>
<script type="module">
{$js}

const payload = JSON.parse(document.getElementById('payload').textContent);

for (const id of ['instance-1', 'instance-2']) {
  const host = document.getElementById(id);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = payload.css;
  root.appendChild(style);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = payload.content;
  root.appendChild(wrapper);
  init(root);
}
</script>
</body>
</html>
HTML;

file_put_contents($outFile, $html);
echo "Vorschau geschrieben: {$outFile}\n";
