/*
 * Canvas game engine: renders a generated level, handles taps, animations,
 * hearts. Tapping a snake whose escape ray is clear slides it off the board;
 * tapping a blocked snake costs a heart.
 */
(function () {
  'use strict';

  const HEARTS = Difficulty.MAX_HEARTS;

  class Game {
    /**
     * @param canvas   <canvas> element
     * @param levelData output of LevelGen.generateLevel
     * @param cb       { onHearts(n), onFail(), onWin(heartsLeft) }
     */
    constructor(canvas, levelData, cb) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cb = cb;
      this.cols = levelData.cols;
      this.rows = levelData.rows;
      this.hearts = HEARTS;
      this.finished = false;
      this.raf = 0;

      this.snakes = levelData.snakes.map(s => ({
        id: s.id,
        path: s.path,               // path[0] = head, cell coords
        removed: false,
        anim: null,                 // exit animation state
        flashUntil: 0,              // red flash on blocked tap
        shakeUntil: 0
      }));
      this.aliveCount = this.snakes.length;

      this.owner = new Array(this.cols * this.rows).fill(-1);
      for (const s of this.snakes)
        for (const [x, y] of s.path) this.owner[y * this.cols + x] = s.id;

      this._onResize = () => { this.layout(); this.render(); };
      window.addEventListener('resize', this._onResize);
      this._onTap = e => this.handleTap(e);
      canvas.addEventListener('pointerdown', this._onTap);

      this.layout();
      this.render();
    }

    destroy() {
      window.removeEventListener('resize', this._onResize);
      this.canvas.removeEventListener('pointerdown', this._onTap);
      cancelAnimationFrame(this.raf);
      this.finished = true;
    }

    layout() {
      const dpr = window.devicePixelRatio || 1;
      const box = this.canvas.parentElement.getBoundingClientRect();
      const w = Math.max(200, box.width);
      const h = Math.max(200, box.height);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.dpr = dpr;
      const pad = 10;
      this.cell = Math.min((w - pad * 2) / this.cols, (h - pad * 2) / this.rows);
      this.ox = (w - this.cell * this.cols) / 2;
      this.oy = (h - this.cell * this.rows) / 2;
      this.buildDots();
    }

    // Pre-render the faint dot grid once per layout; on huge boards drawing
    // thousands of arcs per animation frame is too slow.
    buildDots() {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = 'rgba(35,41,70,0.12)';
      const r = Math.max(0.75, this.cell * 0.045);
      for (let gy = 0; gy < this.rows; gy++)
        for (let gx = 0; gx < this.cols; gx++) {
          g.beginPath();
          g.arc(this.cx(gx), this.cy(gy), r, 0, Math.PI * 2);
          g.fill();
        }
      this.dots = c;
    }

    cx(x) { return this.ox + (x + 0.5) * this.cell; }
    cy(y) { return this.oy + (y + 0.5) * this.cell; }

    headDir(s) {
      return [s.path[0][0] - s.path[1][0], s.path[0][1] - s.path[1][1]];
    }

    // First snake blocking the escape ray, or null if the ray is clear.
    blockerOf(s) {
      const [dx, dy] = this.headDir(s);
      let x = s.path[0][0] + dx, y = s.path[0][1] + dy;
      while (x >= 0 && y >= 0 && x < this.cols && y < this.rows) {
        const o = this.owner[y * this.cols + x];
        if (o !== -1 && o !== s.id) {
          const sn = this.snakes[o];
          if (!sn.removed) return sn;
        }
        x += dx; y += dy;
      }
      return null;
    }

    handleTap(e) {
      if (this.finished || this.hearts <= 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const s = this.snakeAt(px, py);
      if (!s) return;
      this.tap(s);
    }

    snakeAt(px, py) {
      // nearest occupied cell center within ~0.7 cells
      let best = null, bestD = this.cell * 0.7;
      for (const s of this.snakes) {
        if (s.removed) continue;
        for (const [x, y] of s.path) {
          const d = Math.hypot(this.cx(x) - px, this.cy(y) - py);
          if (d < bestD) { bestD = d; best = s; }
        }
      }
      return best;
    }

    tap(s) {
      if (s.removed) return;
      const blocker = this.blockerOf(s);
      if (!blocker) {
        s.removed = true;
        this.aliveCount--;
        for (const [x, y] of s.path)
          if (this.owner[y * this.cols + x] === s.id) this.owner[y * this.cols + x] = -1;
        this.startExit(s);
      } else {
        this.hearts--;
        this.cb.onHearts(this.hearts);
        const now = performance.now();
        s.flashUntil = now + 500;
        s.shakeUntil = now + 400;
        blocker.flashUntil = now + 500;
        if (navigator.vibrate) navigator.vibrate(60);
        this.animate();
        if (this.hearts <= 0) {
          this.finished = true;
          setTimeout(() => this.cb.onFail(), 550);
        }
      }
    }

    // Build the pixel polyline the snake travels along: its own body
    // (tail -> head) extended straight past the head until fully off-board.
    startExit(s) {
      const [dx, dy] = this.headDir(s);
      const pts = [];
      for (let i = s.path.length - 1; i >= 0; i--)
        pts.push([this.cx(s.path[i][0]), this.cy(s.path[i][1])]);
      // extend beyond the board edge by ray + body length + margin
      let x = s.path[0][0], y = s.path[0][1];
      let steps = 0;
      const need = this.cols + this.rows + s.path.length + 2;
      while (steps < need) {
        x += dx; y += dy; steps++;
        pts.push([this.cx(x), this.cy(y)]);
        const px = this.cx(x), py = this.cy(y);
        if ((px < -this.cell * (s.path.length + 1) || px > this.canvas.clientWidth + this.cell * (s.path.length + 1) ||
             py < -this.cell * (s.path.length + 1) || py > this.canvas.clientHeight + this.cell * (s.path.length + 1))) break;
      }
      const travel = pts.length - s.path.length; // cells the head advances
      s.anim = {
        pts,
        len: s.path.length,
        start: performance.now(),
        dur: Math.min(900, Math.max(280, travel * 40))
      };
      this.animate();
    }

    animate() {
      cancelAnimationFrame(this.raf);
      const step = () => {
        const now = performance.now();
        let busy = false;
        for (const s of this.snakes) {
          if (s.anim && now - s.anim.start >= s.anim.dur) s.anim = null;
          if (s.anim || s.flashUntil > now || s.shakeUntil > now) busy = true;
        }
        this.render(now);
        if (busy) {
          this.raf = requestAnimationFrame(step);
        } else if (this.aliveCount === 0 && !this.finished) {
          this.finished = true;
          this.cb.onWin(this.hearts);
        }
      };
      this.raf = requestAnimationFrame(step);
    }

    render(now) {
      now = now || performance.now();
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

      // faint dot grid (pre-rendered in buildDots)
      ctx.drawImage(this.dots, 0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

      for (const s of this.snakes) {
        if (s.removed && !s.anim) continue;
        if (s.anim) this.drawExiting(s, now);
        else this.drawStatic(s, now);
      }
    }

    snakeColor(s, now) {
      return s.flashUntil > now ? '#e63946' : '#232946';
    }

    drawStatic(s, now) {
      let offX = 0, offY = 0;
      if (s.shakeUntil > now) {
        const [dx, dy] = this.headDir(s);
        const k = Math.sin((s.shakeUntil - now) / 400 * Math.PI * 6) * this.cell * 0.1;
        offX = dx * k; offY = dy * k;
      }
      const pts = [];
      for (let i = s.path.length - 1; i >= 0; i--)
        pts.push([this.cx(s.path[i][0]) + offX, this.cy(s.path[i][1]) + offY]);
      this.drawBody(pts, this.snakeColor(s, now));
    }

    drawExiting(s, now) {
      const a = s.anim;
      const t = Math.min(1, (now - a.start) / a.dur);
      const shift = (a.pts.length - a.len) * t * t; // accelerating slide
      const pts = [];
      for (let i = 0; i < a.len; i++) {
        const f = i + shift;
        const i0 = Math.min(a.pts.length - 1, Math.floor(f));
        const i1 = Math.min(a.pts.length - 1, i0 + 1);
        const frac = f - i0;
        pts.push([
          a.pts[i0][0] + (a.pts[i1][0] - a.pts[i0][0]) * frac,
          a.pts[i0][1] + (a.pts[i1][1] - a.pts[i0][1]) * frac
        ]);
      }
      this.drawBody(pts, '#232946');
    }

    // pts: tail -> head pixel points
    drawBody(pts, color) {
      const ctx = this.ctx;
      const s = this.cell;
      const head = pts[pts.length - 1];
      const prev = pts[pts.length - 2] || pts[0];
      const ang = Math.atan2(head[1] - prev[1], head[0] - prev[0]);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(2, s * 0.22);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();

      // arrowhead
      const tip = [head[0] + Math.cos(ang) * s * 0.34, head[1] + Math.sin(ang) * s * 0.34];
      const back = 0.12, wing = 0.30;
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(head[0] - Math.cos(ang) * s * back - Math.sin(ang) * s * wing,
                 head[1] - Math.sin(ang) * s * back + Math.cos(ang) * s * wing);
      ctx.lineTo(head[0] - Math.cos(ang) * s * back + Math.sin(ang) * s * wing,
                 head[1] - Math.sin(ang) * s * back - Math.cos(ang) * s * wing);
      ctx.closePath();
      ctx.fill();
    }
  }

  window.ArrowsGame = Game;
})();
