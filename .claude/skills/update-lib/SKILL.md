---
name: update-lib
description: Check 紙匣's vendored libraries (lib/) against the CDN copies the single-file bundle loads, list newer versions, or update one library everywhere its version is named (lib/, tools/build.py, js/core.js, sw.js, docs/third-party.md), then build and run every test. Use when the user asks to update, upgrade or check pdf.js, pdf-lib, heic2any, Tesseract or qpdf.
disable-model-invocation: true
---

# Update a library in lib/

Arguments: nothing or `check` (only check and list versions), or `<library> <version>` (e.g. `pdf-lib 1.17.2`;
`latest` for the newest).

紙匣 loads each library from two places that must hold the same code: `lib/` (the site, the local server, and
`index.html` opened from disk) and the address in `tools/build.py`'s `CDN` table (the single-file bundle). Today
every file in `lib/` is byte for byte the file at its CDN address. Keep it so: **download each new file from the
very address that goes into the CDN table**, never from a different build or CDN.

`check-libs.mjs` next to this file checks exactly that, and lists the newest versions:
```bash
node .claude/skills/update-lib/check-libs.mjs
```
Exit 0 = every file matches. It also checks that `js/core.js` (`LIB_FALLBACK`) names the same versions as build.py.

## Where each library's version is named

| Library | Files in lib/ | Download from (= the CDN table) | Also named in |
|---|---|---|---|
| pdf-lib | `pdf-lib.min.js` | `cdnjs …/pdf-lib/<v>/pdf-lib.min.js` | |
| PDF.js | `pdf.min.js`, `pdf.worker.min.js` | `cdnjs …/pdf.js/<v>/` (the worker is found next to `pdf.min.js`, not in the table) | |
| PDF.js CMaps | `cmaps/*.bcmap` (keep `cmaps/LICENSE`) | `jsdelivr …/pdfjs-dist@<v>/cmaps/` | `js/core.js` `LIB_FALLBACK.cmaps` |
| heic2any | `heic2any.min.js` | `cdnjs …/heic2any/<v>/` | `js/core.js` `LIB_FALLBACK.heic` |
| Tesseract.js | `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | `jsdelivr …/tesseract.js@<v>/dist/` | |
| tesseract.js-core | `tesseract/tesseract-core-simd-lstm.wasm.js` | `jsdelivr …/tesseract.js-core@<v>/` | its major must match Tesseract.js |
| language data | `tesseract/lang/{chi_tra,eng}.traineddata.gz` | `jsdelivr …/@tesseract.js-data/<lang>@<v>/4.0.0_best_int/` | `LANG_DATA` in `check-libs.mjs` (the bundle takes the newest itself) |
| qpdf-wasm | `qpdf/qpdf.js`, `qpdf/qpdf.wasm.js` | `jsdelivr …/@neslinesli93/qpdf-wasm@<v>/dist/qpdf.js` and `qpdf.wasm` | `qpdf.wasm.js` is made by `python tools/wasm_to_js.py <qpdf.wasm> <v>` |

Every update also changes:
- `tools/build.py` `CDN`: the version in each address of that library (PDF.js: both `pdf.js/` and `pdfjs-dist@`).
- `docs/third-party.md`: the version and size columns (sizes from `du -sh` / `ls -l` of the new files), and the
  notes under the table that name a version (`pdfjs-dist@…`).
- **`sw.js`: `const CACHE = 'papertray-vN'` goes up by one.** The service worker serves `lib/` from its cache first
  ("Libraries never change under the same name"), so without a new cache name everyone who opened 紙匣 before keeps
  the old library, now next to new `js/` code. The new name makes the next visit drop the old cache. (The offline
  tests look in every cache, `T.cachedPaths()`, so they need no change.)

## Steps

1. **Check first.** Run `check-libs.mjs`. If something already differs, report it and stop: an update on top of a
   mismatch hides where it came from. With `check` (or no argument), report its output and stop here.

2. **Read what changed** between the pinned version and the target: the project's release notes (GitHub releases,
   `gh api repos/<owner>/<repo>/releases`). Then decide:
   - Patch or minor release: continue.
   - **New major version: stop and report to the user** what breaks, before downloading anything. Known ones:
     - PDF.js 4 and later ship ES modules only (`pdf.min.mjs`, `pdf.worker.min.mjs`); `loadScript()` in `js/core.js`
       loads classic scripts, and the global `pdfjsLib` is gone. That is a port of `core.js` and every tool, not a
       library update.
     - Tesseract.js and tesseract.js-core move together: a new major of one needs the same major of the other.
       Their npm `latest` tag can lag (core showed 6.1.2 while 7.0.0 is pinned); trust the version list, not `latest`.
   - The target must exist at the CDN address (cdnjs adds versions later than npm). If it does not, say so and stop.

3. **Download into the scratchpad**, one new empty folder, from the addresses the CDN table will hold. Check each:
   HTTP 200, not empty, a size near the old file's, and the license header still there (pdf-lib, PDF.js). For
   CMaps, take every `.bcmap` the package lists
   (`https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist@<v>?structure=flat`).

4. **Put the files into lib/ with `cp` in Bash.** The `guard-edits` hook blocks Edit and Write under `lib/` on
   purpose; copying files downloaded unchanged is what this skill is for. Never edit a library's code. For CMaps,
   replace the folder's `.bcmap` files as a set (delete maps the new version no longer has) and keep `LICENSE`. For
   qpdf, run `$PY tools/wasm_to_js.py <downloaded qpdf.wasm> <v>` (`$PY`: the Python `/full-test` picks). Don't do
   this while tests run (the same hook stops edits then too).

5. **Update the other places** from the table above: `tools/build.py`, `js/core.js` (`LIB_FALLBACK`) if listed,
   `docs/third-party.md` and `sw.js` `CACHE`. Updating several libraries at once: `CACHE` goes up once.

6. **Verify.**
   - `node .claude/skills/update-lib/check-libs.mjs` exits 0 (new files = CDN files, versions agree).
   - `/full-test`: it builds the bundle, then runs all three ways (server, `--file`, `--bundle`). The offline tests check
     the service worker caching the new files.
   - PDF.js or pdf-lib: suggest the user run `/bench` against `HEAD`, since rendering and saving speed can change
     between versions (this skill cannot start `/bench` itself).

7. **Report**: old → new version per library, files replaced, the size change, test results, and anything from the
   release notes the user should know. Do not commit unless the user asks; when they do, one commit for the update (`lib/`, the
   places above and the new cache name together, so no commit has new files under the old cache name).
