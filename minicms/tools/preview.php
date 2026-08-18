<?php
/**
 * Lokale Vorschau fuer ein MiniCMS-Projekt.
 *
 * Bildet den Einbettungs-Vertrag des MiniCMS nach: Inhalt liegt in einem
 * ShadowRoot in einem <div class="minicms_container">, content.js wird als
 * Modul mit den drei URL-Parametern importiert, die Uebersetzungen haengen
 * rawurlencodiert im data_src_ref-Element. Das Projekt wird zweimal
 * instanziiert (zweite Instanz schmal), wie "Instance 1/2" in dev.php.
 *
 * Kein Ersatz fuer dev.php: Marken-Stylesheet, @shared-Komponenten, Klaro und
 * die Interposer fehlen.
 *
 * Aufruf:
 *   mkdir -p .twig && (cd .twig && composer require twig/twig)
 *   MINICMS_VENDOR=.twig/vendor/autoload.php \
 *     php minicms/tools/preview.php minicms/projects/<projekt> [locale] [standalone|shop]
 *
 * Die erzeugte Datei per HTTP oeffnen (ES-Module laden nicht ueber file://):
 *   php -S localhost:8001 -t .
 *   http://localhost:8001/minicms/preview/<projekt>.<locale>.html
 */

$projectArg = $argv[1] ?? null;
$locale     = $argv[2] ?? 'de';
$mode       = $argv[3] ?? 'standalone';

if ($projectArg === null) {
    fwrite(STDERR, "Aufruf: php minicms/tools/preview.php <projektordner> [locale] [standalone|shop]\n");
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

$projectName     = basename($projectDir);
$translationFile = "{$projectDir}/translations/{$locale}.json";
if (!is_file($translationFile)) {
    fwrite(STDERR, "Keine Uebersetzung fuer '{$locale}': {$translationFile}\n");
    exit(2);
}
$translations = json_decode(file_get_contents($translationFile), true, 512, JSON_THROW_ON_ERROR);

/** Minimaler Ersatz fuer den media-Helper des MiniCMS. */
final class PreviewMedia
{
    public function __construct(private string $base, private string $project) {}

    public function get_asset_link(string $path): string
    {
        return $this->base . ltrim($path, '/');
    }

    public function get_project(): string
    {
        return $this->project;
    }
}

/** Minimaler Ersatz fuer den standalone-Helper des MiniCMS. */
final class PreviewStandalone
{
    public function __construct(private bool $standalone) {}

    public function is_standalone(): bool
    {
        return $this->standalone;
    }
}

$loader = new \Twig\Loader\FilesystemLoader($projectDir);
$twig   = new \Twig\Environment($loader, ['strict_variables' => false, 'autoescape' => 'html']);
$twig->addFilter(new \Twig\TwigFilter('trans', static function (string $key, array $params = []) use ($translations, $locale): string {
    if (!array_key_exists($key, $translations)) {
        fwrite(STDERR, "WARNUNG: Schluessel '{$key}' fehlt in {$locale}.json\n");
        return $key;
    }
    return strtr((string) $translations[$key], $params);
}));
$twig->addGlobal('media', new PreviewMedia("../projects/{$projectName}/", $projectName));
$twig->addGlobal('standalone', new PreviewStandalone($mode === 'standalone'));

$content = $twig->render('content.twig');

$metaRaw = $twig->render('meta.json.twig');
$meta    = json_decode($metaRaw, true);
if (!is_array($meta)) {
    fwrite(STDERR, "WARNUNG: meta.json.twig ergibt kein gueltiges JSON:\n{$metaRaw}\n");
    $meta = [];
}

$css = is_file("{$projectDir}/content.css.twig")
    ? $twig->render('content.css.twig')
    : (is_file("{$projectDir}/content.css") ? file_get_contents("{$projectDir}/content.css") : '');

$title    = $meta['title'] ?? $projectName;
$dataSrc  = rawurlencode(json_encode(['translations' => $translations], JSON_HEX_APOS | JSON_UNESCAPED_UNICODE));
$payload  = json_encode(['css' => $css, 'content' => $content], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$jsPath   = "../projects/{$projectName}/content.js?cb=" . (is_file("{$projectDir}/content.js") ? filemtime("{$projectDir}/content.js") : '0');
$hasJs    = is_file("{$projectDir}/content.js") ? 'true' : 'false';

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
  .d2s-data { display: none; }
</style>
</head>
<body>
<div class="preview-note">
  Lokale Entwurfs-Vorschau (Modus: <code>{$mode}</code>, Sprache: <code>{$locale}</code>) &ndash; nicht das MiniCMS.
  Inhalt liegt in je einem eigenen ShadowRoot; Instanz&nbsp;2 laeuft in <code>480px</code> Breite fuer die Container Queries.
</div>

<div class="instance-label">Instance 1 &middot; volle Breite</div>
<div class="instance" id="minicms_host_1"></div>

<div class="instance-label">Instance 2 &middot; 480px</div>
<div class="instance narrow" id="minicms_host_2"></div>

<div class="d2s-data" id="minicms_data_1">{$dataSrc}</div>
<div class="d2s-data" id="minicms_data_2">{$dataSrc}</div>

<script type="application/json" id="payload">{$payload}</script>
<script>
  const payload = JSON.parse(document.getElementById('payload').textContent);

  // Nachbau von helpers.css: der Container traegt container-type, nicht das Projekt
  const container_css = '.minicms_container { container-type: inline-size; }';

  for (const n of [1, 2]) {
    const host = document.getElementById('minicms_host_' + n);
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = payload.css + '\\n' + container_css;
    root.appendChild(style);

    const container = document.createElement('div');
    container.className = 'minicms_container';
    container.id = 'minicms_inner_' + n;
    container.innerHTML = payload.content;
    root.appendChild(container);

    if ({$hasJs}) {
      const params = new URLSearchParams({
        top_el_ref: 'minicms_host_' + n,
        top_el_ref_shadow_inner_dst: 'minicms_inner_' + n,
        data_src_ref: 'minicms_data_' + n,
      });
      import('{$jsPath}&' + params.toString());
    }
  }
</script>
</body>
</html>
HTML;

file_put_contents($outFile, $html);
echo "Vorschau geschrieben: {$outFile}\n";
echo "Oeffnen ueber HTTP (ES-Module laden nicht via file://):\n";
echo "  php -S localhost:8001 -t .\n";
echo "  http://localhost:8001/minicms/preview/{$projectName}.{$locale}.html\n";
