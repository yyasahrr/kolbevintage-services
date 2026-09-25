#!/usr/bin/env node
/**
 * Prepares a real headless Chromium for the Phase 6.2 browser gate.
 *
 * Why this exists
 * ---------------
 * The official Playwright browser CDN (`cdn.playwright.dev`), the Chrome for
 * Testing host (`storage.googleapis.com`) and the Debian mirror are all
 * unreachable from some sandboxes/CI runners, while the npm registry is not.
 *
 * `@sparticuz/chromium` publishes the Chromium binary *and* the NSS/NSPR and
 * SwiftShader shared objects inside its npm tarball, so a working browser can
 * be assembled purely from `registry.npmjs.org` with no apt access.
 *
 * This script is a **developer/CI convenience only**. It never writes into
 * `node_modules` of the app, never touches application source, and the output
 * directory (`.browsers/`) is git-ignored. When Playwright's own browser cache
 * is available we prefer that and this script does nothing.
 *
 * Usage:
 *   node scripts/setup-e2e-browser.mjs            # install if needed
 *   node scripts/setup-e2e-browser.mjs --force    # reinstall
 *   node scripts/setup-e2e-browser.mjs --print    # print the executable path
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, chmodSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(repoRoot, ".browsers");
const binDir = join(target, "bin");
const libDir = join(target, "lib");
const executable = join(binDir, "chromium");

const argv = new Set(process.argv.slice(2));
const force = argv.has("--force");

function log(msg) {
  process.stdout.write(`[setup-e2e-browser] ${msg}\n`);
}

/**
 * Locate an installed dependency's directory from the repo root.
 *
 * We deliberately do NOT `import` the package: `@sparticuz/chromium` is ESM and
 * its `exports` map does not expose `./package.json`, so `require.resolve` on
 * the manifest throws. We only need the on-disk directory holding `bin/*.br`.
 */
function packageDir(name) {
  for (const base of [repoRoot, ...workspaceRoots()]) {
    const candidate = join(base, "node_modules", name);
    if (existsSync(join(candidate, "bin", "chromium.br"))) return candidate;
  }
  // Hoisted layouts: fall back to Node's own resolution of the entry point.
  const require = createRequire(join(repoRoot, "package.json"));
  try {
    const entry = require.resolve(name);
    let dir = dirname(entry);
    while (dir !== dirname(dir)) {
      if (existsSync(join(dir, "bin", "chromium.br"))) return dir;
      dir = dirname(dir);
    }
  } catch {
    /* not installed */
  }
  return null;
}

/** npm workspaces can nest node_modules, so check each workspace too. */
function workspaceRoots() {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    return (pkg.workspaces ?? []).map((w) => join(repoRoot, w.replace(/\/\*$/, "")));
  } catch {
    return [];
  }
}

function extractTarBr(brFile, destDir) {
  mkdirSync(destDir, { recursive: true });
  const tarPath = join(tmpdir(), `kolbe-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.tar`);
  writeFileSync(tarPath, brotliDecompressSync(readFileSync(brFile)));
  execFileSync("tar", ["-xf", tarPath, "-C", destDir], { stdio: "pipe" });
  rmSync(tarPath, { force: true });
}

async function main() {
  if (!force && existsSync(executable) && statSync(executable).size > 0) {
    if (argv.has("--print")) process.stdout.write(`${executable}\n`);
    else log(`already prepared: ${executable}`);
    return 0;
  }

  const pkgDir = packageDir("@sparticuz/chromium");
  if (!pkgDir) {
    log("ERROR: @sparticuz/chromium is not installed. Run: npm install -D @sparticuz/chromium");
    return 1;
  }

  const bundled = join(pkgDir, "bin");
  log(`source package: ${pkgDir}`);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(libDir, { recursive: true });

  // 1. The Chromium executable itself (brotli-compressed, ~67 MB -> ~209 MB).
  const stage = join(tmpdir(), `kolbe-e2e-chromium-${Date.now()}`);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "chromium.br"), readFileSync(join(bundled, "chromium.br")));
  writeFileSync(
    join(stage, "chromium"),
    brotliDecompressSync(readFileSync(join(bundled, "chromium.br"))),
    { maxOutputLength: 512 * 1024 * 1024 },
  );
  cpSync(join(stage, "chromium"), executable);
  chmodSync(executable, 0o755);
  rmSync(stage, { recursive: true, force: true });
  log("extracted chromium executable");

  // 2. NSS/NSPR + SwiftShader shared objects. Without these Chromium aborts
  //    with "libnspr4.so: cannot open shared object file" and ANGLE/Vulkan
  //    fails to initialise.
  extractTarBr(join(bundled, "al2023.tar.br"), join(target, "stage-al"));
  const alLib = join(target, "stage-al", "lib");
  for (const f of ["libexpat.so.1", "libfreebl3.so", "libfreeblpriv3.so", "libnspr4.so", "libnss3.so", "libnssutil3.so", "libplc4.so", "libplds4.so", "libsoftokn3.so"]) {
    const src = join(alLib, f);
    if (existsSync(src)) cpSync(src, join(libDir, f));
  }
  extractTarBr(join(bundled, "swiftshader.tar.br"), join(target, "stage-sw"));
  for (const f of ["libEGL.so", "libGLESv2.so", "libvk_swiftshader.so", "libvulkan.so.1"]) {
    const src = join(target, "stage-sw", f);
    if (existsSync(src)) cpSync(src, join(libDir, f));
  }
  rmSync(join(target, "stage-al"), { recursive: true, force: true });
  rmSync(join(target, "stage-sw"), { recursive: true, force: true });

  // 3. Vulkan ICD manifest so SwiftShader is discoverable. The path is
  //    relative to this manifest's own directory.
  writeFileSync(
    join(libDir, "vk_swiftshader_icd.json"),
    `${JSON.stringify(
      { file_format_version: "1.0.0", ICD: { library_path: "./libvk_swiftshader.so", api_version: "1.0.5" } },
      null,
      2,
    )}\n`,
  );
  log("staged shared libraries + Vulkan ICD");

  if (argv.has("--print")) process.stdout.write(`${executable}\n`);
  else log(`ready: ${executable}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`FAILED: ${err?.stack ?? err}`);
    process.exit(1);
  },
);
