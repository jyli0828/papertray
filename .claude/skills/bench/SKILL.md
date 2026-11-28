---
name: bench
description: Measure 紙匣's speed and memory in headless Chrome and compare the working tree against a baseline commit (HEAD by default), with an optional CPU profile. Use when the user asks to benchmark, measure performance, or show before/after numbers for an optimization.
disable-model-invocation: true
---

# Benchmark: before / after

Arguments (optional, in any order): case filters (parts of case names, e.g. `掃描 圖片工具`), a baseline ref
(`base=<commit>`, default `HEAD`), `profile` (CPU profile of each case) or `profile=load` (of page load).

Files next to this one:
- `make-runner.mjs` turns `tests/run.mjs` into `tests/_bench-run.mjs`: cases from `$BENCH`, gc flags, process memory
  sampling (Windows only: it reads the processes with PowerShell; elsewhere only timings are reported), optional CPU
  profiler. Run it for each copy being measured.
- `cases.mjs` the benchmark cases (startup, compress, image tool, images→PDF, watermark, 1000-page edit, split,
  merge, PDF→images, crop margins, blank pages, OCR page check). Its header explains the helpers and how to add one.

## Steps

1. **Baseline copy.** In the scratchpad (never in the project):
   ```bash
   B=<scratchpad>/bench-base; rm -rf "$B" && mkdir -p "$B" && git archive <base ref> | tar -x -C "$B"
   node .claude/skills/bench/make-runner.mjs "$B"
   node .claude/skills/bench/make-runner.mjs .
   ```
   With uncommitted changes, the working tree is "after" and the ref is "before". With none, say there is nothing to
   compare, and measure the current code once.

2. **Run both, one after the other** (never at the same time: they share the machine), each in the background:
   ```bash
   BENCH="$PWD/.claude/skills/bench/cases.mjs"; command -v cygpath >/dev/null && BENCH="$(cygpath -w "$BENCH")"
   export BENCH ONLY="<filters joined with commas, or empty>"
   (cd "$B" && node tests/_bench-run.mjs 2>&1 | grep -E '✓|✗|PROFILE|^      ') > <scratchpad>/bench-before.txt
   node tests/_bench-run.mjs 2>&1 | grep -E '✓|✗|PROFILE|^      ' > <scratchpad>/bench-after.txt
   ```
   Add `PROFILE=run` (or `PROFILE=load`) only when asked: profiling slows the run, so do not mix profiled timings
   into the comparison table. All cases take about 2 minutes per copy; a filter makes it shorter. (`cygpath` exists only in Git Bash on
   Windows, where Node needs the path as `C:\…`, not `/c/…`.)
   Do not edit `js/` while a run is going.

3. **Report** a table: case · before · after · change (%), with the memory peaks under it. Read the numbers honestly:
   - Each timing is the median of 3 runs (the three are in brackets). Under about ±10% is noise; say so.
   - Process memory (`行程記憶體峰值`, Windows only) is the peak rise of all the browser's processes and varies by ±200–300 MB between
     runs; only big, consistent differences mean something. The first repetition is often higher.
   - Startup cases (`開啟紙匣`) vary a lot run to run; compare several.
   - A `PROFILE` list is self time by function: `(idle)` on the page while a job runs usually means waiting for a
     worker (pdf.js decoding pictures, Tesseract), `(program)` is the browser itself.

4. **Clean up:** delete `tests/_bench-run.mjs` and the baseline folder. Never commit either.

## What earlier measurements found (so they are not tried again)

These were measured on one Windows machine whose headless Chrome drew with its graphics card (GTX 1060, D3D11).
Conclusions about canvases and drawing may not hold on a machine without one, or in another browser: measure again
there before relying on them.

- Thumbnails cost about 18 ms each regardless of size; a CPU canvas (`willReadFrequently`) was no faster, except
  that a plain (graphics card) canvas was faster for render + one `getImageData` on that machine.
- `createImageBitmap(..., { resizeWidth, resizeQuality: 'high' })` beats decoding whole only for small targets on
  the page; inside workers (compress keep-text) it was both faster and lighter.
- Scanned pages are bound by pdf.js decoding JPEGs in its worker: more workers (`pdfLanes()` in core.js) help;
  drawing the next page during OCR does not (Tesseract uses the same cores).
- Text pages drawn small (裁白邊, 選取空白頁) also gain from more workers: the page's thread waited a third of the
  time. Drawn at 150 dpi and up they do not (`LANES_TEXT_SCALE` in core.js). 1000 pages of 裁白邊: 17.6 → 13.7 s.
- Font preloading, fewer inpaint rounds at coarse levels, and typed arrays in inpaint `dist()` were tried and gave
  nothing (or changed the output).
