/* Decorative cloth preview: a pinned, gently swaying grid of lines (the real physics lives on /projects/cloth/).
   Hovering warps it: points near the cursor bulge away and get dragged along by its motion. Each point chases its
   warp target on its own soft spring (slower the farther it is from the cursor), so the warp lags, overshoots and
   ripples back, leaving a fading orange trail. Purely visual, no physics.

   The animation loop only runs while the canvas is on screen, the tab is visible and motion is allowed
   (no prefers-reduced-motion, no `paused` class on <html>). Otherwise no frames are requested at all.

   Usage: <canvas data-cloth-preview></canvas> plus <script src="cloth-preview.js" defer></script> (relative path, so it also works from file://).
   Add data-center to center the grid vertically in its box. */
(function () {
  var COLS = 19, ROWS = 12, NP = ROWS * COLS;
  function pinned(c) { return c <= 1 || c >= COLS - 2 || c === (COLS - 1) / 2; }
  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function init(cv) {
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    var center = cv.hasAttribute('data-center');
    var w = 0, h = 0, dpr = 1;
    function size() {
      var r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    }

    /* Per-point spring state: offset, offset velocity, and a lingering glow. */
    var OX = new Float32Array(NP), OY = new Float32Array(NP), OVX = new Float32Array(NP), OVY = new Float32Array(NP), GL = new Float32Array(NP);
    var fr = 0, lastT = 0;

    /* Pointer state: target position, smoothed position/velocity, and an influence that eases in/out. */
    var mx = -1e4, my = -1e4, sx = -1e4, sy = -1e4, vx = 0, vy = 0, inf = 0, infTarget = 0;
    function toLocal(e) { var r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }
    cv.addEventListener('pointerenter', function (e) { toLocal(e); if (inf < 0.01) { sx = mx; sy = my; } infTarget = 1; });
    cv.addEventListener('pointermove', function (e) { toLocal(e); infTarget = 1; });
    cv.addEventListener('pointerleave', function () { infTarget = 0; });

    function ease(k) { return 1 - Math.pow(1 - k, fr); } /* per-60fps-frame rate -> this frame */
    function stepPointer(now) {
      fr = lastT ? Math.min(3, (now - lastT) / 16.667) : 1; lastT = now;
      var px = sx, py = sy;
      sx += (mx - sx) * ease(0.12); sy += (my - sy) * ease(0.12);
      vx += ((sx - px) / fr - vx) * ease(0.18); vy += ((sy - py) / fr - vy) * ease(0.18);
      var cap = 40; vx = Math.max(-cap, Math.min(cap, vx)); vy = Math.max(-cap, Math.min(cap, vy));
      inf += (infTarget - inf) * ease(infTarget > inf ? 0.08 : 0.04);
    }

    function draw(t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var sp = Math.min((w * 0.78) / (COLS - 1), (h * 0.8) / (ROWS - 1));
      var x0 = (w - sp * (COLS - 1)) / 2, y0 = center ? (h - sp * 0.97 * (ROWS - 1)) / 2 : h * 0.1;
      var pts = [];
      for (var r = 0; r < ROWS; r++) {
        var row = [];
        for (var c = 0; c < COLS; c++) {
          var k = r / (ROWS - 1);
          var sagTop = (r === 0 && !pinned(c)) ? Math.sin(Math.PI * ((c - 1) % 8) / 8) * sp * 0.35 : 0;
          var sway = Math.sin(t * 1.1 + r * 0.32 + c * 0.12) * sp * 0.55 * k * k;
          var bunch = Math.sin(c / (COLS - 1) * Math.PI * 4) * sp * 0.18 * k;
          var bx = x0 + c * sp + sway + bunch, by = y0 + r * sp * 0.97 + sagTop + Math.abs(sway) * 0.25, f = 0, tx = 0, ty = 0;
          if (inf > 0.002) {
            /* Gaussian falloff around the cursor; pinned points stay put, the free top edge barely moves. */
            var mob = r === 0 ? (pinned(c) ? 0 : 0.3) : Math.min(1, 0.45 + r * 0.25);
            var dx = bx - sx, dy = by - sy, R = sp * 4.2;
            f = Math.exp(-(dx * dx + dy * dy) / (R * R)) * inf * mob;
            tx = dx * f * 0.3 + vx * f * 1.1;
            ty = dy * f * 0.3 + vy * f * 1.1;
          }
          var i = r * COLS + c;
          if (fr) {
            /* Underdamped spring toward the target: near points snap, far points lag, giving a trailing ripple. */
            var stiff = (0.025 + 0.05 * Math.min(1, f * 3)) * fr, damp = Math.pow(0.86, fr);
            OVX[i] = (OVX[i] + (tx - OX[i]) * stiff) * damp; OVY[i] = (OVY[i] + (ty - OY[i]) * stiff) * damp;
            OX[i] += OVX[i] * fr; OY[i] += OVY[i] * fr;
            GL[i] += (f - GL[i]) * (f > GL[i] ? ease(0.25) : ease(0.035));
          }
          row.push([bx + OX[i], by + OY[i], GL[i]]);
        }
        pts.push(row);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(243,244,246,0.55)';
      ctx.beginPath();
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        var p = pts[r][c];
        if (c < COLS - 1) { ctx.moveTo(p[0], p[1]); ctx.lineTo(pts[r][c + 1][0], pts[r][c + 1][1]); }
        if (r < ROWS - 1) { ctx.moveTo(p[0], p[1]); ctx.lineTo(pts[r + 1][c][0], pts[r + 1][c][1]); }
      }
      ctx.stroke();
      /* Nodes: faint everywhere, brighter and orange-tinted where the cursor is warping them. */
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        var q = pts[r][c], g = Math.min(1, q[2] * 2.2);
        if (r === 0 && pinned(c)) continue;
        ctx.fillStyle = g > 0.05 ? 'rgba(255,' + Math.round(244 - 167 * g) + ',' + Math.round(246 - 228 * g) + ',' + (0.3 + 0.6 * g).toFixed(3) + ')' : 'rgba(243,244,246,0.3)';
        ctx.beginPath(); ctx.arc(q[0], q[1], 1.3 + 1.4 * g, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#FF4D12';
      for (c = 0; c < COLS; c++) if (pinned(c)) { ctx.beginPath(); ctx.arc(pts[0][c][0], pts[0][c][1], 3, 0, Math.PI * 2); ctx.fill(); }
    }

    /* ---------- Run only when it can be seen ---------- */
    var onScreen = false, raf = 0, frozenT = 0;
    function motionAllowed() {
      return !(reduceMQ && reduceMQ.matches) && !document.documentElement.classList.contains('paused');
    }
    function shouldRun() { return onScreen && !document.hidden && motionAllowed() && w > 0; }
    function frame(now) {
      raf = 0;
      if (!shouldRun()) return;            /* stop: no further frames are requested */
      stepPointer(now); frozenT = now / 1000; draw(frozenT);
      raf = requestAnimationFrame(frame);
    }
    function update() {
      if (shouldRun()) { if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function redrawStill() { fr = 0; draw(frozenT); }

    size(); redrawStill();
    if ('ResizeObserver' in window) new ResizeObserver(function () { size(); redrawStill(); update(); }).observe(cv);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { onScreen = e[e.length - 1].isIntersecting; update(); }).observe(cv);
    } else { onScreen = true; }
    document.addEventListener('visibilitychange', update);
    if (reduceMQ && reduceMQ.addEventListener) reduceMQ.addEventListener('change', update);
    if ('MutationObserver' in window) new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    update();
  }

  function boot() { Array.prototype.forEach.call(document.querySelectorAll('canvas[data-cloth-preview]'), init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
