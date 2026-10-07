/**
 * Minimal terminal progress bar.
 */
export class ProgressBar {
  constructor(total, label = '') {
    this.total = total;
    this.current = 0;
    this.label = label;
    this.width = 40;
    this._lastLen = 0;
  }

  update(current, extra = '') {
    this.current = current;
    const pct = this.total > 0 ? current / this.total : 0;
    const filled = Math.round(pct * this.width);
    const bar = '\x1b[32m' + '█'.repeat(filled) + '\x1b[0m' + '░'.repeat(this.width - filled);
    const line = `  ${this.label} [${bar}] ${current}/${this.total} ${extra}`;
    process.stdout.write('\r' + ' '.repeat(this._lastLen) + '\r');
    process.stdout.write(line);
    this._lastLen = line.length;
  }

  done(msg = '') {
    this.update(this.total, msg);
    process.stdout.write('\n');
  }
}
