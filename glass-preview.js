/* Decorative glass preview: still, shattered panes in white lines on black (the real simulation lives on
   /projects/glass/). A much simpler model than the demo: straight radial cracks from the impact to the frame,
   jittered ring segments between neighbouring cracks, a jagged hole at the impact and a few hairlines.
   Each pane is drawn once; a new random pane replaces it every few seconds.

   Cycling only happens while the canvas is on screen, the tab is visible and motion is allowed
   (no prefers-reduced-motion, no `paused` class on <html>). Otherwise it keeps showing one still pane.

   Usage: <canvas data-glass-preview></canvas> plus <script src="glass-preview.js" defer></script> (relative path). */
(function () {
  var CYCLE_MS = 3200;
  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function rand(a, b) { return a + Math.random() * (b - a); }

  // distance along a ray from (ox, oy) in direction (dx, dy) until it leaves the rectangle
  function exitDist(ox, oy, dx, dy, x0, y0, x1, y1) {
    var t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (x1 - ox) / dx); else if (dx < -1e-9) t = Math.min(t, (x0 - ox) / dx);
    if (dy > 1e-9) t = Math.min(t, (y1 - oy) / dy); else if (dy < -1e-9) t = Math.min(t, (y0 - oy) / dy);
    return t;
  }

  function drawPane(ctx, w, h) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    var mx = Math.max(14, w * 0.12), my = Math.max(12, h * 0.12);
    var x0 = mx, y0 = my, x1 = w - mx, y1 = h - my;
    if (x1 - x0 < 20 || y1 - y0 < 20) return;
    ctx.lineJoin = 'round';

    // frame
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.25;
    ctx.strokeRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 1.5, y0 - 1.5, x1 - x0 + 3, y1 - y0 + 3);

    // faint glass fill and a reflection streak
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = Math.max(6, (x1 - x0) * 0.025);
    var sx = x0 + (x1 - x0) * rand(0.1, 0.3);
    ctx.beginPath(); ctx.moveTo(sx, y1 + 10); ctx.lineTo(sx + (y1 - y0) * 0.55, y0 - 10); ctx.stroke();
    ctx.restore();

    // impact, somewhere away from the edges
    var ox = x0 + (x1 - x0) * rand(0.28, 0.72), oy = y0 + (y1 - y0) * rand(0.3, 0.7);
    var size = Math.min(x1 - x0, y1 - y0);

    // radial cracks to the frame
    var n = Math.round(rand(14, 22)), step = Math.PI * 2 / n, base = Math.random() * step, ang = [], len = [];
    for (var i = 0; i < n; i++) ang.push(base + i * step + (Math.random() - 0.5) * step * 0.7);
    ang.sort(function (a, b) { return a - b; });
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var dx = Math.cos(ang[i]), dy = Math.sin(ang[i]);
      len.push(exitDist(ox, oy, dx, dy, x0, y0, x1, y1));
      ctx.moveTo(ox, oy); ctx.lineTo(ox + dx * len[i], oy + dy * len[i]);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.stroke();

    // ring segments between neighbouring cracks: dense near the impact, sparser further out
    var limit = size * rand(0.32, 0.5);
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n, a0 = ang[i], a1 = j === 0 ? ang[0] + Math.PI * 2 : ang[j];
      for (var r = rand(4, 7); r < limit; r = r * rand(1.25, 1.6) + rand(1, 4)) {
        if (Math.random() < Math.min(0.55, (r / limit) * 0.6)) continue;
        var ra = Math.min(r * rand(0.85, 1.15), len[i]), rb = Math.min(r * rand(0.85, 1.15), len[j]);
        ctx.moveTo(ox + Math.cos(a0) * ra, oy + Math.sin(a0) * ra);
        ctx.lineTo(ox + Math.cos(a1) * rb, oy + Math.sin(a1) * rb);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();

    // a few secondary cracks across the outer pieces
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      if (Math.random() > 0.45) continue;
      var k = (i + 1) % n, b0 = ang[i], b1 = k === 0 ? ang[0] + Math.PI * 2 : ang[k];
      var d0 = rand(limit, len[i] * 0.9), d1 = Math.min(len[k] * 0.95, d0 * rand(0.8, 1.25));
      if (d0 < limit) continue;
      ctx.moveTo(ox + Math.cos(b0) * d0, oy + Math.sin(b0) * d0);
      ctx.lineTo(ox + Math.cos(b1) * d1, oy + Math.sin(b1) * d1);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();

    // the hole: a jagged ring of glass knocked out at the impact
    var hr = size * rand(0.025, 0.05), m = Math.round(rand(9, 14));
    ctx.beginPath();
    for (i = 0; i < m; i++) {
      var ha = (i / m) * Math.PI * 2, rr = hr * rand(0.6, 1.4);
      if (i === 0) ctx.moveTo(ox + Math.cos(ha) * rr, oy + Math.sin(ha) * rr); else ctx.lineTo(ox + Math.cos(ha) * rr, oy + Math.sin(ha) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();

    // hairlines near the impact
    ctx.beginPath();
    for (i = 0; i < 6; i++) {
      var ha2 = rand(0, Math.PI * 2), r1 = rand(hr * 1.5, limit * 0.5), r2 = r1 + rand(3, 10), sp = rand(-0.25, 0.25);
      ctx.moveTo(ox + Math.cos(ha2) * r1, oy + Math.sin(ha2) * r1);
      ctx.lineTo(ox + Math.cos(ha2 + sp) * r2, oy + Math.sin(ha2 + sp) * r2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
  }

  function init(cv) {
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    var w = 0, h = 0, timer = 0, visible = true;
    function render() {
      var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPane(ctx, w, h);
    }
    function canCycle() {
      return visible && !document.hidden && !(reduceMQ && reduceMQ.matches) && !document.documentElement.classList.contains('paused');
    }
    function schedule() {
      clearTimeout(timer);
      if (canCycle()) timer = setTimeout(function () { render(); schedule(); }, CYCLE_MS);
    }
    render();
    if ('ResizeObserver' in window) {
      var lw = -1, lh = -1;
      new ResizeObserver(function () {
        var r = cv.getBoundingClientRect();
        if (Math.round(r.width) !== lw || Math.round(r.height) !== lh) { lw = Math.round(r.width); lh = Math.round(r.height); render(); }
      }).observe(cv);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; schedule(); }).observe(cv);
    }
    document.addEventListener('visibilitychange', schedule);
    if (reduceMQ && reduceMQ.addEventListener) reduceMQ.addEventListener('change', schedule);
    if ('MutationObserver' in window) new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    schedule();
  }

  function start() {
    var list = document.querySelectorAll('canvas[data-glass-preview]');
    for (var i = 0; i < list.length; i++) init(list[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
