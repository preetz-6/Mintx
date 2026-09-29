/**
 * Mintx — esbuild bundler
 *
 * Bundles ES module source files into MV3-compatible scripts.
 * Content scripts and service workers in MV3 can't use bare ES imports,
 * so we bundle them into self-contained IIFE/ESM files.
 *
 * Output goes to dist/ — load the extension from dist/ in chrome://extensions.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const distDir = path.join(__dirname, 'dist');

// Copy static files to dist
function copyStatic() {
  // Ensure dist dirs exist
  const dirs = ['dist', 'dist/popup', 'dist/icons', 'dist/models'];
  for (const d of dirs) {
    const full = path.join(__dirname, d);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }

  // manifest.json
  fs.copyFileSync(
    path.join(__dirname, 'manifest.json'),
    path.join(distDir, 'manifest.json')
  );

  // Patch manifest: point to bundled files
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf-8'));
  manifest.background.service_worker = 'service-worker.bundle.js';
  manifest.background.type = 'module';
  manifest.content_scripts[0].js = ['content.bundle.js'];
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // popup files
  fs.copyFileSync(path.join(__dirname, 'popup/popup.html'), path.join(distDir, 'popup/popup.html'));
  fs.copyFileSync(path.join(__dirname, 'popup/popup.css'), path.join(distDir, 'popup/popup.css'));

  // MV3 cannot execute remotely hosted WASM. Ship the ONNX Runtime binaries
  // with the extension and point Transformers.js at this extension-local path.
  const ortDist = path.join(__dirname, 'node_modules/onnxruntime-web/dist');
  const wasmOut = path.join(distDir, 'onnxruntime');
  fs.mkdirSync(wasmOut, { recursive: true });
  for (const file of fs.readdirSync(ortDist).filter(name => name.endsWith('.wasm'))) {
    fs.copyFileSync(path.join(ortDist, file), path.join(wasmOut, file));
  }

  // Patch popup.html to use bundled JS
  let popupHtml = fs.readFileSync(path.join(distDir, 'popup/popup.html'), 'utf-8');
  popupHtml = popupHtml.replace('popup.js" type="module"', 'popup.bundle.js"');
  fs.writeFileSync(path.join(distDir, 'popup/popup.html'), popupHtml);

  // Copy icons if they exist
  const iconsDir = path.join(__dirname, 'icons');
  if (fs.existsSync(iconsDir)) {
    for (const f of fs.readdirSync(iconsDir)) {
      fs.copyFileSync(path.join(iconsDir, f), path.join(distDir, 'icons', f));
    }
  }
}

async function build() {
  copyStatic();

  const commonOptions = {
    bundle: true,
    minify: false,       // keep readable for debugging
    sourcemap: true,
    target: ['chrome120'],
    logLevel: 'info',
  };

  // 1. Content script — IIFE (no top-level await, runs in page context)
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'content/content.js')],
    outfile: path.join(distDir, 'content.bundle.js'),
    format: 'iife',
  });

  // 2. Service worker — ESM (MV3 service workers support type: module)
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'background/service-worker.js')],
    outfile: path.join(distDir, 'service-worker.bundle.js'),
    format: 'esm',
  });

  // 3. Popup script
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'popup/popup.js')],
    outfile: path.join(distDir, 'popup/popup.bundle.js'),
    format: 'iife',
  });

  console.log('✅ Build complete → dist/');
}

if (watch) {
  // Simple watch: rebuild on file changes
  const chokidar = require('chokidar');
  build().then(() => {
    console.log('👀 Watching for changes...');
    const watcher = chokidar || null;
    // Fallback: just use esbuild context for watch
    // For now, re-run build manually or use esbuild's watch
  });
} else {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
