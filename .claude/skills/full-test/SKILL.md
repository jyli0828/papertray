---
name: full-test
description: Run 紙匣's whole browser test suite in all three ways it is opened (local server, index.html from disk, single-file bundle) and report only what failed. Use before pushing to main, after changes to js/, css/, index.html, sw.js or tools/build.py, or when the user asks to run the full tests.
---

# Full test run

紙匣 is opened three ways, and each must work: from a local server, by double-clicking `index.html` (`file://`,
no workers), and as the single-file bundle `dist/紙匣.html` (libraries from CDNs). `tests/run.mjs` covers each.

## Steps

1. **Check the tree.** Run `git status --short`. Do not edit any file under `js/`, `css/` or `tests/` while the tests
   run: a test that loads a half-written file fails for no real reason.

2. **Build the bundle first**, so the bundle run tests the current code:
   ```bash
   PY=$(for c in python3 python "py -3"; do $c -c 'import sys; sys.exit(sys.version_info < (3, 8))' >/dev/null 2>&1 && { echo "$c"; break; }; done)
   $PY tools/build.py
   ```
   The first command that is a working Python 3.8+ wins: the name differs between machines (`python3` on macOS and
   Linux; on Windows often `python` or `py`, while `python3` may be a Store stub that only prints a hint). If none
   is found, or the build fails, report that and stop before step 3's bundle run.

3. **Run the three modes one after another, in the background** (each takes about 2–3 minutes; together about 7–8).
   One Bash call with `run_in_background: true`, keeping only the summary and the failures:
   ```bash
   cd <project root> && for m in "" "--file" "--bundle"; do echo "=== ${m:-http}"; node tests/run.mjs $m 2>&1 | grep -vE '^\s+✓'; done
   ```
   - The default (http) run includes the slow tests (OCR); `--file` and `--bundle` skip the http-only ones, so they
     list fewer tests. That is expected.
   - `--bundle` loads pdf.js, pdf-lib, Tesseract and qpdf from CDNs: it needs the network.
   - Wait for the background task's notification; do not poll its output file.

4. **Report** a table with one row per mode: passed / failed counts and time. Under it, for every failure: the test
   name, the mode, and the error lines the runner printed. When everything passed, say so in one line.
   - A failure only in `--bundle` with a network error (a CDN fetch) is likely the network, not the code: say so,
     and offer to rerun that mode alone (`node tests/run.mjs --bundle <test name>`).
   - To rerun one failing test: `node tests/run.mjs <part of its name>` (add `--file` / `--bundle` for those modes).

5. **Do not fix anything unasked.** If tests failed, report and offer to investigate. `dist/` is git-ignored, so the
   rebuilt bundle needs no commit.
