/* Glass breaking demo (jackkeuler.com/projects/glass/): radial and ring fracture clipped into convex shards,
   a bond network that decides what falls, and falling shards drawn in fake 3D with a perspective divide.
   Loaded at the end of projects/glass/index.html, after the elements it uses. */
(function () {
  'use strict';

  /* ---------- Scene (world units, independent of screen size; y points down) ---------- */
  var W = 1000, H = 640;
  var PANE = { x0: 165, y0: 34, x1: 835, y1: 474 };    // the glass, held by a frame
  var GROUND = 588;                                      // floor plane, y
  var FOCAL = 1000, VX = 500, VY = 270;                  // perspective: focal length and vanishing point
  var GRAVITY = 1800;
  var EDGE_EPS = 0.6;                                    // tolerance for "these two edges coincide"
  var ATTACHED = 0, FALLING = 1, RESTING = 2, GONE = 3;
  var CRACK_TIME = 0.06;                                 // seconds for new cracks to spread out from the impact

  var canvas = document.getElementById('glass'), ctx = canvas.getContext('2d');
  var layer = document.createElement('canvas'), lctx = layer.getContext('2d');  // cached static glass
  var scale = 1, dpr = 1, offX = 0, offY = 0;      // world -> CSS pixels: scale, then centre
  var shards = [], attached = [], falling = [], resting = [];
  var bonds = [];
  var nextId = 0, time = 0, power = 1, showBonds = false;
  var staticDirty = true, supportDirty = false, listsDirty = true, bfsStamp = 0;
  var waves = [];                                        // cracks still spreading: { ox, oy, t0, maxR, parent, done }

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------- Polygon helpers (flat arrays [x0, y0, x1, y1, ...], always convex) ---------- */
  function polyArea(p) {
    var a = 0, n = p.length;
    for (var i = 0; i < n; i += 2) { var j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; }
    return a / 2;
  }
  function polyCentroid(p) {
    var a = 0, cx = 0, cy = 0, n = p.length;
    for (var i = 0; i < n; i += 2) {
      var j = (i + 2) % n, cr = p[i] * p[j + 1] - p[j] * p[i + 1];
      a += cr; cx += (p[i] + p[j]) * cr; cy += (p[i + 1] + p[j + 1]) * cr;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-9) { cx = 0; cy = 0; for (i = 0; i < n; i += 2) { cx += p[i]; cy += p[i + 1]; } return [cx / (n / 2), cy / (n / 2)]; }
    return [cx / (6 * a), cy / (6 * a)];
  }
  // Sutherland-Hodgman: clip polygon `subject` to the convex polygon `clip`
  function clipConvex(subject, clip) {
    var out = subject, n = clip.length, sgn = polyArea(clip) >= 0 ? 1 : -1;
    for (var i = 0; i < n && out.length >= 6; i += 2) {
      var ax = clip[i], ay = clip[i + 1], bx = clip[(i + 2) % n], by = clip[(i + 3) % n];
      var inp = out, m = inp.length;
      out = [];
      for (var k = 0; k < m; k += 2) {
        var px = inp[k], py = inp[k + 1], qx = inp[(k + 2) % m], qy = inp[(k + 3) % m];
        var dp = sgn * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
        var dq = sgn * ((bx - ax) * (qy - ay) - (by - ay) * (qx - ax));
        if (dp >= 0) out.push(px, py);
        if ((dp >= 0) !== (dq >= 0)) { var t = dp / (dp - dq); out.push(px + (qx - px) * t, py + (qy - py) * t); }
      }
    }
    return out;
  }
  // drop repeated vertices so edges are never zero-length
  function clean(p) {
    var out = [], n = p.length;
    for (var i = 0; i < n; i += 2) {
      var lx = out.length ? out[out.length - 2] : p[n - 2], ly = out.length ? out[out.length - 1] : p[n - 1];
      if (Math.abs(p[i] - lx) > 0.02 || Math.abs(p[i + 1] - ly) > 0.02) out.push(p[i], p[i + 1]);
    }
    return out;
  }
  // split a convex polygon by the line through (px, py) with normal (nx, ny)
  function splitByLine(p, px, py, nx, ny) {
    var a = [], b = [], n = p.length;
    for (var i = 0; i < n; i += 2) {
      var x1 = p[i], y1 = p[i + 1], x2 = p[(i + 2) % n], y2 = p[(i + 3) % n];
      var d1 = (x1 - px) * nx + (y1 - py) * ny, d2 = (x2 - px) * nx + (y2 - py) * ny;
      if (d1 >= 0) a.push(x1, y1); else b.push(x1, y1);
      if ((d1 >= 0) !== (d2 >= 0)) { var t = d1 / (d1 - d2), ix = x1 + (x2 - x1) * t, iy = y1 + (y2 - y1) * t; a.push(ix, iy); b.push(ix, iy); }
    }
    return [clean(a), clean(b)];
  }
  function isConvex(p) {
    var n = p.length, sign = 0;
    for (var i = 0; i < n; i += 2) {
      var ax = p[(i + 2) % n] - p[i], ay = p[(i + 3) % n] - p[i + 1];
      var bx = p[(i + 4) % n] - p[(i + 2) % n], by = p[(i + 5) % n] - p[(i + 3) % n];
      var c = ax * by - ay * bx;
      if (Math.abs(c) < 1e-9) continue;
      if (sign === 0) sign = c > 0 ? 1 : -1; else if ((c > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }
  function insideConvex(p, x, y) {
    var n = p.length, sign = 0;
    for (var i = 0; i < n; i += 2) {
      var c = (p[(i + 2) % n] - p[i]) * (y - p[i + 1]) - (p[(i + 3) % n] - p[i + 1]) * (x - p[i]);
      if (Math.abs(c) < 1e-9) continue;
      if (sign === 0) sign = c > 0 ? 1 : -1; else if ((c > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }

  /* ---------- Shards ---------- */
  function makeShard(pts, ix, iy) {
    var c = polyCentroid(pts), area = Math.abs(polyArea(pts));
    var s = { id: nextId++, pts: pts, cx: c[0], cy: c[1], area: area, state: ATTACHED, bonds: [], fallAt: -1,
      ix: ix, iy: iy, micro: null, gen: 0, reach: 0,
      // weight it takes to keep this shard in place: bigger shards need more bond length to hang on
      need: (0.09 * Math.sqrt(area) + 1) * rand(0.6, 1.5),
      minx: 1e9, miny: 1e9, maxx: -1e9, maxy: -1e9 };
    for (var i = 0; i < pts.length; i += 2) {
      if (pts[i] < s.minx) s.minx = pts[i]; if (pts[i] > s.maxx) s.maxx = pts[i];
      if (pts[i + 1] < s.miny) s.miny = pts[i + 1]; if (pts[i + 1] > s.maxy) s.maxy = pts[i + 1];
    }
    shards.push(s);
    return s;
  }

  /* ---------- Bonds: shared edges between shards, and edges along the frame ---------- */
  function addBond(a, b, len, mx, my) {
    var bd = { a: a, b: b, len: len, mx: mx, my: my, ok: true };
    bonds.push(bd); a.bonds.push(bd); if (b) b.bonds.push(bd);
    return bd;
  }
  // total length (and midpoint) of the edges two convex shards share
  function sharedEdge(p, q) {
    var total = 0, mx = 0, my = 0, n = p.length, m = q.length;
    for (var i = 0; i < n; i += 2) {
      var ax = p[i], ay = p[i + 1], dx = p[(i + 2) % n] - ax, dy = p[(i + 3) % n] - ay, L = Math.sqrt(dx * dx + dy * dy);
      if (L < 0.3) continue;
      var ux = dx / L, uy = dy / L;
      for (var j = 0; j < m; j += 2) {
        var cx = q[j] - ax, cy = q[j + 1] - ay, ex = q[(j + 2) % m] - ax, ey = q[(j + 3) % m] - ay;
        if (Math.abs(ux * cy - uy * cx) > EDGE_EPS || Math.abs(ux * ey - uy * ex) > EDGE_EPS) continue;
        var tc = ux * cx + uy * cy, te = ux * ex + uy * ey;
        var lo = Math.max(0, Math.min(tc, te)), hi = Math.min(L, Math.max(tc, te));
        if (hi - lo > 0.3) { var t = (lo + hi) / 2, w = hi - lo; total += w; mx += (ax + ux * t) * w; my += (ay + uy * t) * w; }
      }
    }
    return total > 0 ? [total, mx / total, my / total] : null;
  }
  // total length of a shard's edges that lie along the frame
  function frameEdge(p) {
    var total = 0, mx = 0, my = 0, n = p.length;
    function on(x, y, side) {
      return side === 0 ? Math.abs(x - PANE.x0) < EDGE_EPS : side === 1 ? Math.abs(x - PANE.x1) < EDGE_EPS : side === 2 ? Math.abs(y - PANE.y0) < EDGE_EPS : Math.abs(y - PANE.y1) < EDGE_EPS;
    }
    for (var i = 0; i < n; i += 2) {
      var x1 = p[i], y1 = p[i + 1], x2 = p[(i + 2) % n], y2 = p[(i + 3) % n];
      for (var side = 0; side < 4; side++) {
        if (on(x1, y1, side) && on(x2, y2, side)) {
          var L = Math.hypot(x2 - x1, y2 - y1);
          total += L; mx += (x1 + x2) / 2 * L; my += (y1 + y2) / 2 * L;
          break;
        }
      }
    }
    return total > 0.3 ? [total, mx / total, my / total] : null;
  }
  function boxesTouch(a, b) {
    return a.minx <= b.maxx + 1 && b.minx <= a.maxx + 1 && a.miny <= b.maxy + 1 && b.miny <= a.maxy + 1;
  }
  function bondPair(a, b) {
    if (!boxesTouch(a, b)) return;
    var e = sharedEdge(a.pts, b.pts);
    if (e) addBond(a, b, e[0], e[1], e[2]);
  }

  /* ---------- Fracture ---------- */
  // Shatter shard `s` from the impact point (ox, oy).
  function shatter(s, ox, oy) {
    var P = s.pts, maxR = 0, i, k;
    for (i = 0; i < P.length; i += 2) maxR = Math.max(maxR, Math.hypot(P[i] - ox, P[i + 1] - oy));
    var size = Math.sqrt(s.area), detail = Math.max(0.35, Math.min(1, size / 420));

    // radial cracks, jittered around even spacing
    var nRays = Math.max(6, Math.round(rand(26, 40) * (0.5 + 0.5 * detail)));
    var stepA = Math.PI * 2 / nRays, base = Math.random() * stepA, angles = [];
    for (i = 0; i < nRays; i++) angles.push(base + i * stepA + (Math.random() - 0.5) * stepA * 0.75);
    angles.sort(function (a, b) { return a - b; });

    // ring cracks reach part-way out; harder hits ring further
    var ringLimit = Math.max(16, maxR * rand(0.32, 0.55) * (0.65 + 0.35 * detail) * Math.min(1.35, 0.7 + 0.3 * power));
    var far = maxR * 2 + 100, pieces = [];

    function addCell(cell) {
      if (cell.length < 6) return;
      if (!isConvex(cell) && cell.length === 8) {          // a rare non-convex quad: use its two triangles
        addCell([cell[0], cell[1], cell[2], cell[3], cell[4], cell[5]]);
        addCell([cell[0], cell[1], cell[4], cell[5], cell[6], cell[7]]);
        return;
      }
      var piece = clean(clipConvex(P, cell));
      if (piece.length >= 6 && Math.abs(polyArea(piece)) > 0.6) pieces.push(piece);
    }

    for (i = 0; i < nRays; i++) {
      var a0 = angles[i], a1 = i + 1 < nRays ? angles[i + 1] : angles[0] + Math.PI * 2;
      var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      // this wedge's own rings: each ring segment has its own radius at either crack, so rings never line up
      var ra = [0], rb = [0], r = rand(1.5, 4.5);
      while (r < ringLimit) {
        if (Math.random() > Math.min(0.5, (r / ringLimit) * 0.55)) {
          ra.push(Math.max(ra[ra.length - 1] + 1.2, r * rand(0.82, 1.18)));
          rb.push(Math.max(rb[rb.length - 1] + 1.2, r * rand(0.82, 1.18)));
        }
        r = r * rand(1.12, 1.42) + rand(0.8, 4);
      }
      ra.push(far); rb.push(far);
      for (k = 0; k < ra.length - 1; k++) {
        if (k === 0) addCell([ox, oy, ox + c0 * ra[1], oy + s0 * ra[1], ox + c1 * rb[1], oy + s1 * rb[1]]);
        else addCell([ox + c0 * ra[k], oy + s0 * ra[k], ox + c0 * ra[k + 1], oy + s0 * ra[k + 1],
                      ox + c1 * rb[k + 1], oy + s1 * rb[k + 1], ox + c1 * rb[k], oy + s1 * rb[k]]);
      }
    }

    // secondary cracks: split some of the larger pieces across, mostly along the ring direction
    var final = [];
    function crack(p, depth) {
      var area = Math.abs(polyArea(p));
      var chance = area > 5000 ? 0.9 : area > 1200 ? 0.65 : area > 250 ? 0.3 : 0;
      if (depth > 2 || Math.random() > chance) { final.push(p); return; }
      var c = polyCentroid(p), rx = c[0] - ox, ry = c[1] - oy, rl = Math.hypot(rx, ry) || 1;
      var ang = Math.atan2(ry, rx) + (Math.random() < 0.7 ? 0 : Math.PI / 2) + rand(-0.5, 0.5);
      var off = Math.sqrt(area) * rand(-0.25, 0.25);
      var halves = splitByLine(p, c[0] + rx / rl * off, c[1] + ry / rl * off, Math.cos(ang), Math.sin(ang));
      for (var h = 0; h < 2; h++) {
        if (halves[h].length >= 6 && Math.abs(polyArea(halves[h])) > 0.6) crack(halves[h], depth + 1);
      }
    }
    for (i = 0; i < pieces.length; i++) crack(pieces[i], 0);

    // replace the shard with its pieces
    var neighbours = [], frameBonded = false;
    for (i = 0; i < s.bonds.length; i++) {
      var bd = s.bonds[i];
      if (!bd.ok) continue;
      bd.ok = false;
      var o = bd.a === s ? bd.b : bd.a;
      if (o) { if (o.state === ATTACHED && neighbours.indexOf(o) < 0) neighbours.push(o); } else frameBonded = true;
    }
    s.state = GONE;
    var wave = { ox: ox, oy: oy, t0: time, maxR: maxR, parent: P, done: false };
    waves.push(wave);
    var made = [];
    for (i = 0; i < final.length; i++) {
      var ns = makeShard(final[i], ox, oy);
      ns.gen = s.gen;
      ns.wave = wave; ns.minFall = time + CRACK_TIME;   // nothing falls before the crack has reached it
      // fine hairline cracks near the impact that do not split the shard
      if (Math.hypot(ns.cx - ox, ns.cy - oy) < ringLimit * 0.7 && Math.random() < 0.45 && ns.area > 8) {
        var q = ns.pts, va = (Math.random() * (q.length / 2) | 0) * 2, t1 = rand(0.15, 0.6), t2 = rand(0.15, 0.6);
        ns.micro = [q[va] + (ns.cx - q[va]) * t1, q[va + 1] + (ns.cy - q[va + 1]) * t1,
                    ns.cx + (q[(va + 4) % q.length] - ns.cx) * t2, ns.cy + (q[(va + 5) % q.length] - ns.cy) * t2];
      }
      made.push(ns);
    }

    // bonds between the new pieces, to the old shard's neighbours, and to the frame
    for (i = 0; i < made.length; i++) {
      for (k = i + 1; k < made.length; k++) bondPair(made[i], made[k]);
      for (k = 0; k < neighbours.length; k++) bondPair(made[i], neighbours[k]);
      if (frameBonded) { var f = frameEdge(made[i].pts); if (f) addBond(made[i], null, f[0], f[1], f[2]); }
    }

    // the impact breaks bonds near it, with a chance that falls off with distance
    var R = Math.max(32, ringLimit * 0.72) * power;
    for (i = 0; i < bonds.length; i++) {
      var b2 = bonds[i];
      if (!b2.ok) continue;
      var d = Math.hypot(b2.mx - ox, b2.my - oy);
      if (d < R && Math.random() < 0.97 * Math.pow(1 - d / R, 0.85)) b2.ok = false;
    }
    bonds = bonds.filter(function (b3) { return b3.ok; });   // keep the live list small
    for (i = 0; i < made.length; i++) made[i].bonds = made[i].bonds.filter(function (b4) { return b4.ok; });
    for (i = 0; i < neighbours.length; i++) neighbours[i].bonds = neighbours[i].bonds.filter(function (b5) { return b5.ok; });
    supportDirty = true; staticDirty = true; listsDirty = true;
    wake();
  }

  /* ---------- Support: which shards are still held? ---------- */
  function schedule(s, delay) {
    var at = Math.max(time + delay, s.minFall || 0);
    if (s.fallAt < 0 || at < s.fallAt) s.fallAt = at;
  }
  // Breadth-first search from the frame through intact bonds. Shards it can't reach fall; shards it can
  // reach but whose bonds are too short for their size creak loose after a moment.
  function checkSupport() {
    var stamp = ++bfsStamp, queue = [], i, j, s, bd, o;
    for (i = 0; i < attached.length; i++) {
      s = attached[i];
      for (j = 0; j < s.bonds.length; j++) if (s.bonds[j].ok && !s.bonds[j].b) { s.reach = stamp; queue.push(s); break; }
    }
    for (var h = 0; h < queue.length; h++) {
      s = queue[h];
      for (j = 0; j < s.bonds.length; j++) {
        bd = s.bonds[j];
        if (!bd.ok) continue;
        o = bd.a === s ? bd.b : bd.a;
        if (o && o.state === ATTACHED && o.reach !== stamp) { o.reach = stamp; queue.push(o); }
      }
    }
    for (i = 0; i < attached.length; i++) {
      s = attached[i];
      if (s.reach !== stamp) { schedule(s, rand(0.01, 0.2)); continue; }
      var held = 0;
      for (j = 0; j < s.bonds.length; j++) if (s.bonds[j].ok) held += s.bonds[j].len;
      if (held < s.need) schedule(s, rand(0.25, 1.6));
    }
  }

  /* ---------- Falling shards: flat rigid bodies in 3D ---------- */
  function rotAxis(ax, ay, az, ang, out) {   // Rodrigues: rotation matrix about a unit axis
    var c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    out[0] = t * ax * ax + c;      out[1] = t * ax * ay - s * az; out[2] = t * ax * az + s * ay;
    out[3] = t * ax * ay + s * az; out[4] = t * ay * ay + c;      out[5] = t * ay * az - s * ax;
    out[6] = t * ax * az - s * ay; out[7] = t * ay * az + s * ax; out[8] = t * az * az + c;
    return out;
  }
  var TMP = new Float64Array(9), TMP2 = new Float64Array(9);
  function premultiply(R, M) {               // R = M * R
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
      TMP2[r * 3 + c] = M[r * 3] * R[c] + M[r * 3 + 1] * R[3 + c] + M[r * 3 + 2] * R[6 + c];
    for (var i = 0; i < 9; i++) R[i] = TMP2[i];
  }
  function setLocal(s, pts, cx, cy) {
    s.L = new Float64Array(pts.length);
    for (var i = 0; i < pts.length; i += 2) { s.L[i] = pts[i] - cx; s.L[i + 1] = pts[i + 1] - cy; }
  }
  function startFall(s) {
    s.state = FALLING;
    for (var i = 0; i < s.bonds.length; i++) s.bonds[i].ok = false;
    s.bonds.length = 0;
    setLocal(s, s.pts, s.cx, s.cy);
    s.x = s.cx; s.y = s.cy; s.z = 0;
    var dx = s.cx - s.ix, dy = s.cy - s.iy, dl = Math.hypot(dx, dy) || 1, push = rand(10, 70) * power;
    s.vx = dx / dl * push; s.vy = rand(-30, 20); s.vz = rand(-50, 230) * power;      // mostly away, through the frame
    s.R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    var ax = rand(-1, 1), ay = rand(-1, 1), az = rand(-0.4, 0.4), al = Math.hypot(ax, ay, az) || 1, spin = rand(1.5, 8);
    s.wx = ax / al * spin; s.wy = ay / al * spin; s.wz = az / al * spin;
    s.landed = false;
    supportDirty = true; staticDirty = true; listsDirty = true;
  }
  function breakOnFloor(s) {
    // a hard landing cracks the shard again, in its own plane
    var parts = [s.L], i;
    for (var cut = 0; cut < (s.area > 900 ? 2 : 1); cut++) {
      var next = [];
      for (i = 0; i < parts.length; i++) {
        var c = polyCentroid(parts[i]), ang = rand(0, Math.PI), off = Math.sqrt(Math.abs(polyArea(parts[i]))) * rand(-0.2, 0.2);
        var halves = splitByLine(parts[i], c[0] + Math.cos(ang) * off, c[1] + Math.sin(ang) * off, Math.cos(ang), Math.sin(ang));
        for (var h = 0; h < 2; h++) if (halves[h].length >= 6 && Math.abs(polyArea(halves[h])) > 0.5) next.push(halves[h]);
      }
      parts = next;
    }
    if (parts.length < 2) return false;
    for (i = 0; i < parts.length; i++) {
      var pc = polyCentroid(parts[i]), R = s.R;
      var child = { id: nextId++, state: FALLING, area: Math.abs(polyArea(parts[i])), gen: s.gen + 1, bonds: [], landed: false };
      setLocal(child, parts[i], pc[0], pc[1]);
      child.x = s.x + R[0] * pc[0] + R[1] * pc[1];
      child.y = s.y + R[3] * pc[0] + R[4] * pc[1];
      child.z = s.z + R[6] * pc[0] + R[7] * pc[1];
      child.R = new Float64Array(R);
      child.vx = s.vx * 0.5 + rand(-90, 90); child.vy = -Math.abs(s.vy) * rand(0.15, 0.35); child.vz = s.vz * 0.5 + rand(-90, 90);
      child.wx = rand(-6, 6); child.wy = rand(-6, 6); child.wz = rand(-3, 3);
      shards.push(child);
    }
    s.state = GONE; listsDirty = true;
    return true;
  }
  function stepFalling(s, dt) {
    var R = s.R, i, n = s.L.length;
    s.vy += GRAVITY * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    if (s.z < -380) { s.z = -380; s.vz = Math.abs(s.vz) * 0.3; }
    if (s.z > 950) { s.z = 950; s.vz = -Math.abs(s.vz) * 0.3; }
    var wl = Math.sqrt(s.wx * s.wx + s.wy * s.wy + s.wz * s.wz);
    if (wl > 1e-5) premultiply(R, rotAxis(s.wx / wl, s.wy / wl, s.wz / wl, wl * dt, TMP));
    if (s.landed) {
      // settle flat: turn the shard's normal toward vertical, and let friction stop it
      var nx = R[2], ny = R[5], nz = R[8], ty = ny < 0 ? -1 : 1;
      var axx = -nz * ty, axz = nx * ty, al = Math.sqrt(axx * axx + axz * axz);   // n x (0, ty, 0)
      if (al > 1e-4) premultiply(R, rotAxis(axx / al, 0, axz / al, Math.asin(Math.min(1, al)) * Math.min(1, 9 * dt), TMP));
      var damp = Math.max(0, 1 - 7 * dt);
      s.wx *= damp; s.wy *= damp; s.wz *= damp; s.vx *= damp; s.vz *= damp;
    }
    // floor contact: lowest corner of the shard in world space
    var maxY = -1e9;
    for (i = 0; i < n; i += 2) { var wy = s.y + R[3] * s.L[i] + R[4] * s.L[i + 1]; if (wy > maxY) maxY = wy; }
    if (maxY > GROUND) {
      s.y -= maxY - GROUND;
      if (s.vy > 0) {
        if (!s.landed && s.vy > 620 && s.area > 140 && s.gen < 2 && breakOnFloor(s)) return;
        s.vy = -s.vy * 0.2; s.vx *= 0.55; s.vz *= 0.55;
        s.wx *= 0.5; s.wy *= 0.5; s.wz *= 0.5;
        s.landed = true;
      }
    }
    if (s.landed && Math.abs(s.vy) < 25 && Math.abs(R[5]) > 0.999 && Math.abs(s.vx) + Math.abs(s.vz) < 6) {
      s.state = RESTING; s.screen = project(s); staticDirty = true; listsDirty = true;
    }
  }
  // perspective: one divide per corner
  function project(s) {
    var R = s.R, L = s.L, out = new Float64Array(L.length);
    for (var i = 0; i < L.length; i += 2) {
      var x = s.x + R[0] * L[i] + R[1] * L[i + 1], y = s.y + R[3] * L[i] + R[4] * L[i + 1], z = s.z + R[6] * L[i] + R[7] * L[i + 1];
      var f = FOCAL / (FOCAL + z);
      out[i] = VX + (x - VX) * f; out[i + 1] = VY + (y - VY) * f;
    }
    return out;
  }
  function pathPoly(c, p) {
    c.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.closePath();
  }
  function floorPoint(x, z) { var f = FOCAL / (FOCAL + z); return [VX + (x - VX) * f, VY + (GROUND - VY) * f]; }

  /* ---------- Drawing ---------- */
  function rebuildLists() {
    attached = []; falling = []; resting = [];
    var keep = [];
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      if (s.state === GONE) continue;
      keep.push(s);
      if (s.state === ATTACHED) attached.push(s); else if (s.state === FALLING) falling.push(s); else resting.push(s);
    }
    shards = keep; listsDirty = false;
  }

  function spreading(s) { return s.wave && !s.wave.done; }
  function drawStatic() {
    var c = lctx, i, s, k = 1 / scale;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, layer.width, layer.height);
    c.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);
    c.lineJoin = 'round';

    // floor: a faint perspective grid
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = k;
    c.beginPath();
    for (var z = -300; z <= 900; z += 150) { var p1 = floorPoint(-600, z), p2 = floorPoint(1600, z); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); }
    for (var x = -600; x <= 1600; x += 100) { var q1 = floorPoint(x, -300), q2 = floorPoint(x, 900); c.moveTo(q1[0], q1[1]); c.lineTo(q2[0], q2[1]); }
    c.stroke();

    // resting shards: dimmer the further back they lie
    for (i = 0; i < resting.length; i++) {
      s = resting[i];
      var depth = Math.max(0.3, Math.min(1, 1 - s.z / 1400));
      c.beginPath(); pathPoly(c, s.screen);
      c.fillStyle = 'rgba(255,255,255,' + (0.05 * depth).toFixed(3) + ')'; c.fill();
      c.strokeStyle = 'rgba(255,255,255,' + (0.55 * depth).toFixed(3) + ')'; c.lineWidth = k; c.stroke();
    }

    // the frame
    var f = 9;
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5 * k;
    c.strokeRect(PANE.x0 - f, PANE.y0 - f, PANE.x1 - PANE.x0 + 2 * f, PANE.y1 - PANE.y0 + 2 * f);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = k;
    c.strokeRect(PANE.x0 - 2, PANE.y0 - 2, PANE.x1 - PANE.x0 + 4, PANE.y1 - PANE.y0 + 4);

    // glass still in the frame: one path for all of it. Shards whose cracks are still spreading are filled as
    // their intact parent instead, and their outlines are revealed inside a circle growing from the impact.
    if (attached.length) {
      c.beginPath();
      for (i = 0; i < attached.length; i++) if (!spreading(attached[i])) pathPoly(c, attached[i].pts);
      for (i = 0; i < waves.length; i++) if (!waves[i].done) pathPoly(c, waves[i].parent);
      c.fillStyle = 'rgba(255,255,255,0.035)'; c.fill();
      // a few reflection streaks, visible only through the remaining glass
      c.save(); c.clip();
      c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 10 * k;
      c.beginPath(); c.moveTo(PANE.x0 + 60, PANE.y1 + 40); c.lineTo(PANE.x0 + 330, PANE.y0 - 40);
      c.moveTo(PANE.x0 + 120, PANE.y1 + 40); c.lineTo(PANE.x0 + 390, PANE.y0 - 40); c.stroke();
      c.lineWidth = 3 * k; c.beginPath(); c.moveTo(PANE.x0 + 420, PANE.y1 + 40); c.lineTo(PANE.x0 + 600, PANE.y0 - 40); c.stroke();
      c.restore();
      c.beginPath();
      for (i = 0; i < attached.length; i++) if (!spreading(attached[i])) pathPoly(c, attached[i].pts);
      for (i = 0; i < waves.length; i++) if (!waves[i].done) pathPoly(c, waves[i].parent);
      c.strokeStyle = 'rgba(255,255,255,0.82)'; c.lineWidth = k; c.stroke();
      for (i = 0; i < waves.length; i++) {
        var wv = waves[i], prog = Math.max(0, Math.min(1, (time - wv.t0) / CRACK_TIME));
        if (wv.done) continue;
        c.save(); c.beginPath(); c.arc(wv.ox, wv.oy, Math.max(0, wv.maxR * (1 - (1 - prog) * (1 - prog))), 0, Math.PI * 2); c.clip();
        c.beginPath();
        for (var wi = 0; wi < attached.length; wi++) if (attached[wi].wave === wv) pathPoly(c, attached[wi].pts);
        c.stroke();
        c.restore();
      }
      // hairline cracks
      c.beginPath();
      for (i = 0; i < attached.length; i++) { var m = attached[i].micro; if (m && !spreading(attached[i])) { c.moveTo(m[0], m[1]); c.lineTo(m[2], m[3]); } }
      c.strokeStyle = 'rgba(255,255,255,0.4)'; c.stroke();
    }

    // the bond network: shard to shard (centroid, through the shared edge), and shard to frame
    if (showBonds) {
      c.beginPath();
      for (i = 0; i < bonds.length; i++) {
        var b = bonds[i];
        if (!b.ok || b.a.state !== ATTACHED) continue;
        c.moveTo(b.a.cx, b.a.cy); c.lineTo(b.mx, b.my);
        if (b.b) { c.lineTo(b.b.cx, b.b.cy); }
      }
      c.strokeStyle = 'rgba(255,77,18,0.75)'; c.lineWidth = k; c.stroke();
      c.fillStyle = '#FF4D12';
      for (i = 0; i < bonds.length; i++) if (bonds[i].ok && !bonds[i].b) c.fillRect(bonds[i].mx - 1.5 * k, bonds[i].my - 1.5 * k, 3 * k, 3 * k);
    }
    staticDirty = false;
  }

  var LIGHT = [-0.35, -0.62, -0.7];  // toward the viewer and up (y is down)
  function drawFrame() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    if (!falling.length) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);
    ctx.lineJoin = 'round'; ctx.lineWidth = 1 / scale;
    for (var i = 0; i < falling.length; i++) {
      var s = falling[i], p = project(s), R = s.R;
      // glint: a sharp highlight when the shard's face turns toward the light (either side)
      var nd = Math.abs(R[2] * LIGHT[0] + R[5] * LIGHT[1] + R[8] * LIGHT[2]);
      var glint = Math.pow(nd, 10), depth = Math.max(0.35, Math.min(1, 1 - s.z / 1400));
      ctx.beginPath(); pathPoly(ctx, p);
      ctx.fillStyle = 'rgba(255,255,255,' + ((0.04 + 0.4 * glint) * depth).toFixed(3) + ')'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,' + ((0.6 + 0.4 * glint) * depth).toFixed(3) + ')'; ctx.stroke();
    }
  }

  /* ---------- Sizing ---------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(rect.width / W, rect.height / H);
    offX = (rect.width - W * scale) / 2; offY = (rect.height - H * scale) / 2;
    canvas.width = layer.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = layer.height = Math.max(1, Math.round(rect.height * dpr));
    staticDirty = true; wake();
  }

  /* ---------- Input ---------- */
  function toWorld(e) {
    var rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left - offX) / scale, (e.clientY - rect.top - offY) / scale];
  }
  canvas.addEventListener('pointerdown', function (e) {
    var p = toWorld(e), x = p[0], y = p[1];
    if (listsDirty) rebuildLists();
    for (var i = attached.length - 1; i >= 0; i--) {
      var s = attached[i];
      if (x < s.minx || x > s.maxx || y < s.miny || y > s.maxy) continue;
      if (insideConvex(s.pts, x, y)) { shatter(s, x, y); break; }
    }
    e.preventDefault();
  });

  function newPane() {
    shards = []; bonds = []; attached = []; falling = []; resting = []; waves = [];
    var s = makeShard([PANE.x0, PANE.y0, PANE.x1, PANE.y0, PANE.x1, PANE.y1, PANE.x0, PANE.y1], 500, 250);
    var f = frameEdge(s.pts);
    addBond(s, null, f[0], f[1], f[2]);
    supportDirty = false; staticDirty = true; listsDirty = true;
    wake();
  }

  var segButtons = document.querySelectorAll('[data-power]');
  function setPower(btn) {
    power = parseFloat(btn.getAttribute('data-power'));
    for (var i = 0; i < segButtons.length; i++) segButtons[i].setAttribute('aria-pressed', String(segButtons[i] === btn));
  }
  for (var sb = 0; sb < segButtons.length; sb++) segButtons[sb].addEventListener('click', function () { setPower(this); });
  var bBonds = document.getElementById('bonds');
  function toggleBonds() { showBonds = !showBonds; bBonds.setAttribute('aria-pressed', String(showBonds)); staticDirty = true; wake(); }
  bBonds.addEventListener('click', toggleBonds);
  document.getElementById('reset').addEventListener('click', newPane);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === '1' || k === '2' || k === '3') setPower(segButtons[+k - 1]);
    else if (k === 'b') toggleBonds();
    else if (k === 'r') newPane();
  });

  /* ---------- Loop: only runs while something is happening ---------- */
  var sShards = document.getElementById('sShards'), sFalling = document.getElementById('sFalling');
  var sFps = document.getElementById('sFps'), sMs = document.getElementById('sMs');
  var running = false, last = 0, workMs = 0, worked = 0, statT = 0;
  function wake() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }

  // If anything in a frame ever throws, let the next click restart the loop instead of leaving it stuck.
  function frame(now) {
    try { frameBody(now); } catch (err) { running = false; throw err; }
  }
  function frameBody(now) {
    // a rAF timestamp can be slightly earlier than the moment the loop was woken: never step backwards
    var dt = Math.max(0, Math.min((now - last) / 1000, 1 / 30));
    last = now; time += dt;
    var t0 = performance.now(), i;
    if (listsDirty) rebuildLists();

    // shards whose time has come let go; every fall re-checks what is left
    for (i = 0; i < attached.length; i++) {
      var s = attached[i];
      if (s.fallAt >= 0 && time >= s.fallAt) startFall(s);
    }
    if (listsDirty) rebuildLists();
    if (supportDirty) { supportDirty = false; checkSupport(); }
    if (waves.length) {
      staticDirty = true;
      for (i = 0; i < waves.length; i++) if (time - waves[i].t0 >= CRACK_TIME) waves[i].done = true;
    }

    for (i = 0; i < falling.length; i++) if (falling[i].state === FALLING) stepFalling(falling[i], dt);
    if (listsDirty) rebuildLists();
    if (staticDirty) drawStatic();
    if (waves.length) waves = waves.filter(function (wv) { return !wv.done; });   // drop finished ones after their final draw
    drawFrame();

    workMs += performance.now() - t0; worked++;
    var pending = false;
    for (i = 0; i < attached.length; i++) if (attached[i].fallAt >= 0) { pending = true; break; }
    if (now - statT > 400 || !(falling.length || pending)) {
      sShards.textContent = attached.length + falling.length + resting.length;
      sFalling.textContent = falling.length;
      var ms = workMs / Math.max(1, worked);
      sMs.textContent = ms.toFixed(2);
      sFps.textContent = Math.round(1000 / Math.max(ms, 0.05)).toLocaleString('en-US');
      workMs = 0; worked = 0; statT = now;
    }
    if (falling.length || pending || staticDirty || waves.length) requestAnimationFrame(frame);
    else { running = false; sMs.textContent = 'idle'; sFps.textContent = '—'; }
  }

  newPane();
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
})();
