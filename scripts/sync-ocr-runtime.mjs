/**
 * Copy the prepared local OCR environment into resources/ocr-runtime so the
 * Windows installer ships a working OCR stack (RapidOCR + onnxruntime-directml)
 * and end users never pip-install anything themselves.
 *
 * Source of truth: .artifacts/ocr-env (created by the self-check repair or
 * `npm run ocr:provision`). Prunes pip tooling caches to keep the bundle lean.
 *
 * Usage: node scripts/sync-ocr-runtime.mjs
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const source = resolve(desktopRoot, '.artifacts/ocr-env')
const target = resolve(desktopRoot, 'resources/ocr-runtime')

const PRUNE_NAMES = new Set(['__pycache__', 'pip', 'setuptools', 'pkg_resources', 'wheel'])

function prune(directory) {
  for (const entry of readdirSync(directory)) {
    const full = resolve(directory, entry)
    if (!statSync(full).isDirectory()) continue
    const base = entry.endsWith('.dist-info') ? entry.replace(/\.dist-info$/u, '') : entry
    if (PRUNE_NAMES.has(base)) {
      rmSync(full, { recursive: true, force: true })
      continue
    }
    prune(full)
  }
}

if (!existsSync(source)) {
  console.error(`[sync-ocr-runtime] source env not found: ${source}`)
  console.error('[sync-ocr-runtime] create it first (self-check 一键修复, or npm run ocr:provision).')
  process.exit(1)
}

const pythonPath = resolve(source, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
if (!existsSync(pythonPath)) {
  console.error(`[sync-ocr-runtime] source env has no interpreter: ${pythonPath}`)
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
prune(resolve(target, process.platform === 'win32' ? 'Lib/site-packages' : 'lib'))
console.log(`[sync-ocr-runtime] copied ${source} -> ${target}`)
