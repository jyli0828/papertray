// Hook (PreToolUse, Edit|Write|NotebookEdit): never change lib/ or dist/ by hand.
// - lib/ holds the libraries exactly as their projects publish them (minified). tools/build.py's CDN table and sw.js
//   expect those very files, and a hand edit is lost, or out of step with the CDN copy, at the next update.
// - dist/ is made by python tools/build.py; an edit there is overwritten by the next build.
// Exit 2 blocks the edit and hands the message on stderr back to Claude.
const path = require('path');
// From where this file is (.claude/hooks/), not $CLAUDE_PROJECT_DIR (see block-while-testing.js).
const root = path.resolve(__dirname, '..', '..');

let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let p = '';
  try { const i = JSON.parse(s).tool_input || {}; p = i.file_path || i.notebook_path || ''; } catch (e) { return; }
  if (!p) return;
  const rel = path.relative(root, path.resolve(root, p)).split(path.sep).join('/');
  if (rel.startsWith('lib/')) {
    process.stderr.write(`不要直接改 ${rel}：lib/ 是函式庫官方發布的原檔，手改會在下次更新時遺失，也會和單一檔案版從 CDN `
      + '載入的版本不一致。要換版本，就下載官方的新檔整個換掉，並一起更新 tools/build.py 的 CDN 表、sw.js 和 '
      + 'docs/third-party.md；要改行為，就改 js/ 裡呼叫它的程式。真的必須改 lib/ 時，先問使用者。');
    process.exit(2);
  }
  if (rel.startsWith('dist/')) {
    process.stderr.write(`不要直接改 ${rel}：dist/ 由 python tools/build.py 產生，下次打包就會被蓋掉。`
      + '改原始檔（index.html、js/、css/ 或 tools/build.py）後重新打包。');
    process.exit(2);
  }
});
