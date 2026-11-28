// Hook (PreToolUse, Edit|Write|NotebookEdit): while node tests/run.mjs is running, refuse changes to the files the
// test pages load. A page that loads a half-saved file fails for no real reason. tests/run.mjs keeps
// tests/.running-<pid> while it runs; a mark whose process is gone (a killed run) is removed here.
// Exit 2 blocks the edit and hands the message on stderr back to Claude.
const fs = require('fs'), path = require('path');
// From where this file is (.claude/hooks/), not $CLAUDE_PROJECT_DIR: from Git Bash that is /c/Users/…, which Node
// on Windows reads as C:\c\Users\….
const root = path.resolve(__dirname, '..', '..');
// What the test pages load: the page itself, its scripts, styles, libraries, icons, and the tests.
const WATCHED = ['js/', 'css/', 'lib/', 'icons/', 'tests/', 'index.html', 'sw.js', 'manifest.webmanifest'];

let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let p = '';
  try { const i = JSON.parse(s).tool_input || {}; p = i.file_path || i.notebook_path || ''; } catch (e) { return; }
  if (!p) return;
  const rel = path.relative(root, path.resolve(root, p)).split(path.sep).join('/');
  if (rel.startsWith('..') || !WATCHED.some(w => w.endsWith('/') ? rel.startsWith(w) : rel === w)) return;

  const dir = path.join(root, 'tests');
  let running = [];
  try { running = fs.readdirSync(dir).filter(f => /^\.running-\d+$/.test(f)); } catch (e) { return; }
  const alive = running.filter(f => {
    const pid = +f.slice('.running-'.length);
    try { process.kill(pid, 0); return true; } // signal 0 only asks whether the process exists
    catch (e) {
      if (e.code === 'EPERM') return true; // exists, owned by someone else
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch (e2) {}
      return false;
    }
  });
  if (!alive.length) return;
  process.stderr.write(`測試正在執行（tests/run.mjs，PID ${alive.map(f => f.slice(9)).join('、')}），先不要改 ${rel}：`
    + '測試頁面讀到改到一半的檔案會出現假的失敗。等測試跑完再改；'
    + `如果確定沒有測試在跑，刪掉 tests/${alive[0]} 即可。`);
  process.exit(2);
});
