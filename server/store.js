// Tiny JSON-file persistence with debounced atomic writes.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.tmp = file + '.tmp';
    this.timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      this.data = { users: {}, codes: {}, groups: {} };
      this.flushSync();
    }
    this.data.users ||= {};
    this.data.codes ||= {};
    this.data.groups ||= {};

    const bye = () => { this.flushSync(); };
    process.on('exit', bye);
    process.on('SIGINT', () => { bye(); process.exit(0); });
    process.on('SIGTERM', () => { bye(); process.exit(0); });
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flushSync(); }
      catch (e) { console.error('store: write failed:', e.message); }
    }, 400);
  }

  flushSync() {
    fs.writeFileSync(this.tmp, JSON.stringify(this.data));
    fs.renameSync(this.tmp, this.file);
  }
}

module.exports = Store;
