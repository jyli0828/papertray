// Hook (PreToolUse, Edit|Write|NotebookEdit): refuse two kinds of edits. Exit 2 blocks the edit and hands the
// message on stderr back to Claude.
// 1. Anything under lib/ or dist/, ever.
//    - lib/ holds the libraries exactly as their projects publish them (minified). tools/build.py's CDN table and
//      sw.js expect those very files, and a hand edit is lost, or out of step with the CDN copy, at the next update.
//    - dist/ is made by python tools/build.py; an edit there is overwritten by the next build.
// 2. The files the test pages load, while node tests/run.mjs is running: a page that loads a half-saved file fails
//    for no real reason. tests/run.mjs keeps tests/.running-<pid> while it runs; a mark whose process is gone (a
//    killed run) is removed here.
const fs = require('fs'), path = require('path');
// From where this file is (.claude/hooks/), not $CLAUDE_PROJECT_DIR: from Git Bash that is /c/Users/…, which Node
// on Windows reads as C:\c\Users\….
const root = path.resolve(__dirname, '..', '..');
// What the test pages load: the page itself, its scripts, styles, libraries, icons, and the tests.
const WATCHED = ['js/', 'css/', 'lib/', 'icons/', 'tests/', 'index.html', 'sw.js', 'manifest.webmanifest'];

const block = msg => { process.stderr.write(msg); process.exit(2); };

let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let p = '';
  try { const i = JSON.parse(s).tool_input || {}; p = i.file_path || i.notebook_path || ''; } catch (e) { return; }
  if (!p) return;
  const rel = path.relative(root, path.resolve(root, p)).split(path.sep).join('/');

  if (rel.startsWith('lib/')) block(`不要直接改 ${rel}：lib/ 是函式庫官方發布的原檔，手改會在下次更新時遺失，也會和單一檔案版從 CDN `
    + '載入的版本不一致。要換版本，就下載官方的新檔整個換掉，並一起更新 tools/build.py 的 CDN 表、sw.js 和 '
    + 'docs/third-party.md；要改行為，就改 js/ 裡呼叫它的程式。真的必須改 lib/ 時，先問使用者。');
  if (rel.startsWith('dist/')) block(`不要直接改 ${rel}：dist/ 由 python tools/build.py 產生，下次打包就會被蓋掉。`
    + '改原始檔（index.html、js/、css/ 或 tools/build.py）後重新打包。');

  if (!WATCHED.some(w => w.endsWith('/') ? rel.startsWith(w) : rel === w)) return;
  const dir = path.join(root, 'tests');
  let marks = [];
  try { marks = fs.readdirSync(dir).map(f => /^\.running-(\d+)$/.exec(f)).filter(Boolean).map(([f, pid]) => ({ f, pid })); }
  catch (e) { return; }
  const alive = marks.filter(({ f, pid }) => {
    try { process.kill(+pid, 0); return true; } // signal 0 only asks whether the process exists
    catch (e) {
      if (e.code === 'EPERM') return true; // exists, owned by someone else
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch (e2) {}
      return false;
    }
  });
  if (alive.length) block(`測試正在執行（tests/run.mjs，PID ${alive.map(m => m.pid).join('、')}），先不要改 ${rel}：`
    + '測試頁面讀到改到一半的檔案會出現假的失敗。等測試跑完再改；'
    + `如果確定沒有測試在跑，刪掉 tests/${alive[0].f} 即可。`);
});
