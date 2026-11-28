// Hook: after Claude edits a .js/.mjs file, check its syntax; exit 2 reports the error back to Claude.
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let p = '';
  try { p = (JSON.parse(s).tool_input || {}).file_path || ''; } catch (e) { return; }
  if (!/\.m?js$/i.test(p)) return;
  try { require('child_process').execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
  catch (e) { process.stderr.write(`語法錯誤：${p}\n${String(e.stderr || e.message)}`); process.exit(2); }
});
