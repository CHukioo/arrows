// Generate extra-life codes from the command line (server must be stopped,
// or use the POST /api/admin/codes endpoint while it runs).
//   node server/tools/make-codes.js [count] [livesPerCode]
const path = require('path');
const Store = require('../store.js');

const count = Math.min(100, Math.max(1, parseInt(process.argv[2] || '5', 10)));
const lives = Math.min(50, Math.max(1, parseInt(process.argv[3] || '3', 10)));

const store = new Store(path.join(__dirname, '..', 'data', 'db.json'));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

for (let i = 0; i < count; i++) {
  let code;
  do {
    code = '';
    for (let j = 0; j < 6; j++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (store.data.codes[code]);
  store.data.codes[code] = { lives, createdAt: Date.now() };
  console.log(code);
}
store.flushSync();
console.log(`\n${count} code(s) created, +${lives} lives each.`);
