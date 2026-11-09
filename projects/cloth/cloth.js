/* Cloth simulation demo (jackkeuler.com/projects/cloth/): 3D Verlet cloth with structural, shear and bend
   springs, point self-collision, and WebGL shading with the spring network drawn on top.
   Loaded at the end of projects/cloth/index.html, after the elements it uses. */
(function () {
  'use strict';

  /* PHYSICS-START ======================================================================
     Pure simulation: flat typed arrays, no DOM. World units; y points down, the viewer is at -z. */
  var COLS = 33, ROWS = 21, SPACING = 19;
  var DENSITY_MULT = 1

  var DENSITY_MIN = 0.5; // minimum density for slider
  var DENSITY_MAX = 2.0; // maximum density for slider

  var GRAVITY = 1500;            // world units / s^2
  var DAMPING = 0.985;           // fraction of velocity kept per step
  var ITERATIONS = 8;            // constraint passes per step (more passes = less stretch)
  var STEP = 1 / 120;            // fixed physics timestep
  var TEAR_RATIO = 3;            // a structural spring snaps beyond this multiple of its rest length
  var BEND_STIFFNESS = 0.2;      // fraction of the bend correction applied per pass
  var SELF_DIST = 15;            // self-collision: closest two non-neighbouring points may get (cloth thickness)
  var SELF_REACH = 22;           // radius candidate pairs are gathered within (thickness + margin for one step of motion)
  var SELF_SKIP = 38;            // points closer than this along the cloth (world units) never collide: springs keep them apart
  var PATCH = 3;                 // self-collision groups the grid into patches of up to PATCH x PATCH points (see gatherPairs)
  var HASH_SIZE = 4096;          // spatial hash buckets (power of two)
  var MAX_STEP = 12;             // no point moves further than this in one step, so nothing tunnels through
  var MAX_GRAB_SPEED = 1440;     // world units / s a held point can travel (= MAX_STEP per 1/120 s step)
  var GRAB_RADIUS = 48;          // grabbing also pulls the cloth within this radius, fading out toward the edge
  var GRAB_PULL = 0.25;           // pull strength at the centre of that patch (applied after every solver pass)
  var TOP = 70, FLOOR = 560;

  // Grid sizes and every per-point / per-spring array depend on the density, so they are (re)allocated in applyDensity().
  var N, HE, VE, NE, NC, MAX_SPRINGS;              // points, structural edges (horizontal, vertical, all), grid cells, spring capacity
  var KIND_STRUCT = 0, KIND_SHEAR = 1, KIND_BEND = 2;

  var X, Y, Z, PX, PY, PZ;
  var INV;                                       // inverse mass: 0 = pinned or held
  var PIN;
  var SA, SB;
  var RR;                                        // rest length squared
  var KIND;
  var REF1, REF2;                                // edge / cell ids
  var EDGE;                                      // 1 while a structural edge is intact
  var M = 0;                                     // live springs, dense in [0, M)
  var topology = 0;                              // bumps whenever the mesh changes
  var CELLDEAD;                                  // 1 once any of a grid cell's four structural edges has broken
  var needSweep = false;                         // edges were broken; their springs still need removing (sweepSprings)
  var geomVersion = 0;                           // bumps whenever point positions may have changed (renderer caches on it)
  var pinsVersion = 0;                           // bumps whenever the set of pinned points changes
  var wind = false, tearing = false, grabbed = -1, simTime = 0;
  var target = { x: 0, y: 0, z: 0 };             // where the held point is being pulled
  // the soft patch around the held point: which points, how strongly, and their offsets at grab time
  var GI, GW, GOX, GOY, GOZ, grabCount = 0;
  // self-collision scratch space, reallocated only when the density changes
  var ROWI, COLI, cellStart = new Int32Array(HASH_SIZE + 1), cellItems, pointCell;
  var SEEN = new Int32Array(HASH_SIZE), seenStamp = 0;   // buckets already scanned for the current patch
  var MAX_PAIRS, PAIR_A, PAIR_B, pairCount = 0;
  // self-collision patches: topology window in grid steps, patch size, members (PMEM, from PSTART[p]),
  // grid extents (rows PR0..PR1, cols PC0..PC1), and per step a bounding sphere (centre PCX/PCY/PCZ, radius PRAD)
  var SKIP, PK, NPATCH, PSTART, PMEM, PR0, PR1, PC0, PC1, PCX, PCY, PCZ, PRAD, BIG, PATCH_RCAP;

  const originalCols = COLS;
  const originalRows = ROWS;
  const originalSpacing = SPACING;

  // Apply the current DENSITY_MULT: more, closer points over the same cloth size. Resizes the grid and
  // reallocates the simulation arrays; call build() afterwards to lay the cloth out again.
  function applyDensity() {
    COLS = Math.floor(originalCols * DENSITY_MULT);
    ROWS = Math.floor(originalRows * DENSITY_MULT);
    SPACING = originalSpacing / DENSITY_MULT;

    N = COLS * ROWS;
    HE = ROWS * (COLS - 1); VE = (ROWS - 1) * COLS; NE = HE + VE;
    NC = (ROWS - 1) * (COLS - 1);
    MAX_SPRINGS = NE + 2 * NC + ROWS * (COLS - 2) + (ROWS - 2) * COLS;

    X = new Float64Array(N); Y = new Float64Array(N); Z = new Float64Array(N);
    PX = new Float64Array(N); PY = new Float64Array(N); PZ = new Float64Array(N);
    INV = new Float64Array(N);
    PIN = new Uint8Array(N);
    SA = new Int32Array(MAX_SPRINGS); SB = new Int32Array(MAX_SPRINGS);
    RR = new Float64Array(MAX_SPRINGS);
    KIND = new Uint8Array(MAX_SPRINGS);
    REF1 = new Int32Array(MAX_SPRINGS); REF2 = new Int32Array(MAX_SPRINGS);
    EDGE = new Uint8Array(NE);
    CELLDEAD = new Uint8Array(NC);
    M = 0;
    GI = new Int32Array(N); GW = new Float64Array(N); GOX = new Float64Array(N); GOY = new Float64Array(N); GOZ = new Float64Array(N);
    grabbed = -1; grabCount = 0;

    ROWI = new Int16Array(N); COLI = new Int16Array(N);
    for (var gi = 0; gi < N; gi++) { ROWI[gi] = (gi / COLS) | 0; COLI[gi] = gi % COLS; }
    cellItems = new Int32Array(N); pointCell = new Int32Array(N);
    MAX_PAIRS = N * 16; PAIR_A = new Int32Array(MAX_PAIRS); PAIR_B = new Int32Array(MAX_PAIRS); pairCount = 0;

    // The topology window is a fixed distance along the cloth, so collisions behave the same at any density.
    // Patches are no wider than that window, so two points in the same patch never need testing.
    SKIP = Math.max(1, Math.round(SELF_SKIP / SPACING));
    PK = Math.min(PATCH, SKIP + 1);
    var npr = Math.ceil(ROWS / PK), npc = Math.ceil(COLS / PK), pn = 0, p, r, c;
    NPATCH = npr * npc;
    PSTART = new Int32Array(NPATCH + 1); PMEM = new Int32Array(N);
    PR0 = new Int32Array(NPATCH); PR1 = new Int32Array(NPATCH); PC0 = new Int32Array(NPATCH); PC1 = new Int32Array(NPATCH);
    PCX = new Float64Array(NPATCH); PCY = new Float64Array(NPATCH); PCZ = new Float64Array(NPATCH); PRAD = new Float64Array(NPATCH);
    BIG = new Int32Array(NPATCH);
    for (var pa = 0; pa < npr; pa++) for (var pb = 0; pb < npc; pb++) {
      p = pa * npc + pb; PSTART[p] = pn;
      PR0[p] = pa * PK; PR1[p] = Math.min(ROWS, pa * PK + PK) - 1;
      PC0[p] = pb * PK; PC1[p] = Math.min(COLS, pb * PK + PK) - 1;
      for (r = PR0[p]; r <= PR1[p]; r++) for (c = PC0[p]; c <= PC1[p]; c++) PMEM[pn++] = r * COLS + c;
    }
    PSTART[NPATCH] = pn;
    // a flat patch fits in a sphere of its half-diagonal; past 1.5x that (stretched hard, or split by a tear)
    // it is handled separately so one huge patch can't inflate the hash cells for everyone
    PATCH_RCAP = 1.5 * (PK - 1) * SPACING * Math.SQRT1_2 + 1;
    topology++;
  }

  applyDensity();


  // Pull the patch toward "held point + its offset at grab time", strongest near the centre. Applied after
  // every solver pass so it holds against the springs: the grip is a hand-sized area, not a pinched point.
  function pullGrabArea() {
    if (grabbed < 0) return;
    var g = grabbed;
    for (var gk = 0; gk < grabCount; gk++) {
      var j = GI[gk], w = GW[gk];
      if (INV[j] === 0) continue;
      X[j] += (X[g] + GOX[gk] - X[j]) * w; Y[j] += (Y[g] + GOY[gk] - Y[j]) * w; Z[j] += (Z[g] + GOZ[gk] - Z[j]) * w;
    }
  }
  function grabArea(g) {
    grabCount = 0;
    for (var j = 0; j < N; j++) {
      if (j === g || INV[j] === 0) continue;
      var ox = X[j] - X[g], oy = Y[j] - Y[g], oz = Z[j] - Z[g], d = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (d >= GRAB_RADIUS) continue;
      var f = 1 - d / GRAB_RADIUS;
      GI[grabCount] = j; GW[grabCount] = GRAB_PULL * f; GOX[grabCount] = ox; GOY[grabCount] = oy; GOZ[grabCount] = oz; grabCount++;
    }
  }
  var selfCollide = true;

  function hEdge(r, c) { return r * (COLS - 1) + c; }
  function vEdge(r, c) { return HE + r * COLS + c; }
  function cellId(r, c) { return r * (COLS - 1) + c; }
  function isPinnedColumn(c) {
    // two points at each top corner plus the middle
    return c <= 1 || c >= COLS - 2 || c === Math.floor(COLS / 2);
  }
  function addSpring(a, b, kind, r1, r2) {
    var dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
    SA[M] = a; SB[M] = b; KIND[M] = kind; REF1[M] = r1; REF2[M] = r2;
    RR[M] = dx * dx + dy * dy + dz * dz;
    M++;
  }

  function build() {
    // the cloth starts flat and horizontal, pinned along its back edge, then falls and drapes
    var x0 = (1000 - (COLS - 1) * SPACING) / 2, r, c, i;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        i = r * COLS + c;
        X[i] = PX[i] = x0 + c * SPACING;
        Y[i] = PY[i] = TOP;
        Z[i] = PZ[i] = r * SPACING;
        PIN[i] = (r === 0 && isPinnedColumn(c)) ? 1 : 0;
        INV[i] = PIN[i] ? 0 : 1;
      }
    }
    M = 0; EDGE.fill(1);
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      i = r * COLS + c;
      if (c < COLS - 1) addSpring(i, i + 1, KIND_STRUCT, hEdge(r, c), -1);
      if (r < ROWS - 1) addSpring(i, i + COLS, KIND_STRUCT, vEdge(r, c), -1);
    }
    for (r = 0; r < ROWS - 1; r++) for (c = 0; c < COLS - 1; c++) {
      i = r * COLS + c;
      addSpring(i, i + COLS + 1, KIND_SHEAR, cellId(r, c), -1);
      addSpring(i + 1, i + COLS, KIND_SHEAR, cellId(r, c), -1);
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      i = r * COLS + c;
      if (c < COLS - 2) addSpring(i, i + 2, KIND_BEND, hEdge(r, c), hEdge(r, c + 1));
      if (r < ROWS - 2) addSpring(i, i + 2 * COLS, KIND_BEND, vEdge(r, c), vEdge(r + 1, c));
    }
    CELLDEAD.fill(0); needSweep = false;
    grabbed = -1; grabCount = 0; topology++; geomVersion++; pinsVersion++;
  }

  function removeSpring(s) {   // swap-remove keeps [0, M) dense
    M--;
    SA[s] = SA[M]; SB[s] = SB[M]; RR[s] = RR[M]; KIND[s] = KIND[M]; REF1[s] = REF1[M]; REF2[s] = REF2[M];
  }

  // Breaking a structural edge also drops the shear springs of the cells beside it and the
  // bend springs spanning it, so the fabric really separates instead of hanging on hidden springs.
  // breakEdge only marks the edge and its cells; sweepSprings then removes every affected spring in one
  // pass, so tearing or cutting k edges at once costs one O(M) sweep instead of k of them.
  function breakEdge(e) {
    if (!EDGE[e]) return;
    EDGE[e] = 0; needSweep = true; topology++;
    var r, c, k;
    if (e < HE) { r = (e / (COLS - 1)) | 0; c = e % (COLS - 1); if (r > 0) CELLDEAD[cellId(r - 1, c)] = 1; if (r < ROWS - 1) CELLDEAD[cellId(r, c)] = 1; }
    else { k = e - HE; r = (k / COLS) | 0; c = k % COLS; if (c > 0) CELLDEAD[cellId(r, c - 1)] = 1; if (c < COLS - 1) CELLDEAD[cellId(r, c)] = 1; }
  }
  function sweepSprings() {
    for (var s = M - 1; s >= 0; s--) {   // backwards, so the spring swapped into s has already been checked
      var kd = KIND[s];
      if (kd === KIND_STRUCT ? !EDGE[REF1[s]] : kd === KIND_SHEAR ? CELLDEAD[REF1[s]] : (!EDGE[REF1[s]] || !EDGE[REF2[s]])) removeSpring(s);
    }
    needSweep = false; topology++;
  }

  // Move both ends of a spring toward its rest length, split by inverse mass.
  // Square-root-free (Jakobsen): (d - L) / d  ~  (d^2 - L^2) / (d^2 + L^2).
  // Structural and shear springs only resist stretching; bend springs push and pull, softly.
  function relax(s) {
    var a = SA[s], b = SB[s];
    var dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
    var d2 = dx * dx + dy * dy + dz * dz, r2 = RR[s], kd = KIND[s];
    if (kd !== KIND_BEND && d2 <= r2) return;
    var wa = INV[a], wb = INV[b], w = wa + wb;
    if (w === 0) return;
    var k = (d2 - r2) / ((d2 + r2) * w);
    if (kd === KIND_BEND) k *= BEND_STIFFNESS;
    var ox = dx * k, oy = dy * k, oz = dz * k;
    X[a] += ox * wa; Y[a] += oy * wa; Z[a] += oz * wa;
    X[b] -= ox * wb; Y[b] -= oy * wb; Z[b] -= oz * wb;
  }

  /* ---------- Self-collision: points as small spheres, found with a spatial hash ---------- */
  function hashCell(ix, iy, iz) {
    return (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) & (HASH_SIZE - 1);
  }
  // Collect the pairs of points that are close in space but not close on the cloth (two-level broad phase).
  // Points within SKIP grid steps of each other are skipped: springs already hold them apart, and colliding
  // them would fight the bend springs.
  //
  // Hashing single points stops scaling at high density: the hash cells are a fixed size in world units, so
  // points per cell grow with density squared and the scan with density to the fourth. Instead the grid is
  // grouped into small patches. Each step every patch gets a bounding sphere, the spheres go into the hash,
  // and individual points are compared only between patches whose spheres come within reach. This finds
  // exactly the same pairs as comparing every point, with far fewer comparisons.
  function gatherPairs() {
    var p, k, i, hh, nbig = 0, rmax = 0;
    // 1. bounding sphere of every patch: centre = mean of its points, radius = farthest point
    for (p = 0; p < NPATCH; p++) {
      var s0 = PSTART[p], s1 = PSTART[p + 1], cx = 0, cy = 0, cz = 0, r2 = 0;
      for (k = s0; k < s1; k++) { i = PMEM[k]; cx += X[i]; cy += Y[i]; cz += Z[i]; }
      var invn = 1 / (s1 - s0); cx *= invn; cy *= invn; cz *= invn;
      for (k = s0; k < s1; k++) { i = PMEM[k]; var ex = X[i] - cx, ey = Y[i] - cy, ez = Z[i] - cz, e2 = ex * ex + ey * ey + ez * ez; if (e2 > r2) r2 = e2; }
      var rad = Math.sqrt(r2);
      PCX[p] = cx; PCY[p] = cy; PCZ[p] = cz; PRAD[p] = rad;
      if (rad > PATCH_RCAP) BIG[nbig++] = p;            // oversized: tested against every patch in step 4
      else if (rad > rmax) rmax = rad;
    }
    // 2. counting sort of the normal patches into hash buckets (no per-bucket lists, no allocation). Two patches
    //    can only have points within reach if their centres are within SELF_REACH + 2 * rmax; cells twice that
    //    wide mean the other centre lies in this cell or the neighbour on the nearer side of each axis: 8 cells.
    var cell = 2 * (SELF_REACH + 2 * rmax), inv = 1 / cell;
    cellStart.fill(0);
    for (p = 0; p < NPATCH; p++) {
      if (PRAD[p] > PATCH_RCAP) { pointCell[p] = -1; continue; }
      hh = hashCell(Math.floor(PCX[p] * inv), Math.floor(PCY[p] * inv), Math.floor(PCZ[p] * inv));
      pointCell[p] = hh; cellStart[hh]++;
    }
    for (hh = 1; hh <= HASH_SIZE; hh++) cellStart[hh] += cellStart[hh - 1];
    for (p = 0; p < NPATCH; p++) if (pointCell[p] >= 0) cellItems[--cellStart[pointCell[p]]] = p;
    var hashed = cellStart[HASH_SIZE];
    pairCount = 0;
    // 3. normal patches: each pair once (b > a in bucket order), each bucket once even if two cells share it
    for (var a = 0; a < hashed; a++) {
      var pa = cellItems[a];
      var fx = PCX[pa] * inv, fy = PCY[pa] * inv, fz = PCZ[pa] * inv, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      var sx = fx - ix < 0.5 ? -1 : 1, sy = fy - iy < 0.5 ? -1 : 1, sz = fz - iz < 0.5 ? -1 : 1;
      seenStamp++;
      for (var ox = 0; ox < 2; ox++) for (var oy = 0; oy < 2; oy++) for (var oz = 0; oz < 2; oz++) {
        hh = hashCell(ix + ox * sx, iy + oy * sy, iz + oz * sz);
        if (SEEN[hh] === seenStamp) continue;
        SEEN[hh] = seenStamp;
        for (var b = cellStart[hh] > a ? cellStart[hh] : a + 1, end = cellStart[hh + 1]; b < end; b++) collidePatches(pa, cellItems[b]);
      }
    }
    // 4. oversized patches against every other patch (rare, and there are few patches, so brute force is cheap)
    for (var q = 0; q < nbig; q++) {
      var g = BIG[q];
      for (p = 0; p < NPATCH; p++) if (p !== g && !(p < g && PRAD[p] > PATCH_RCAP)) collidePatches(g, p);
    }
  }
  // Narrow phase between two patches: every point of one against every point of the other.
  function collidePatches(pa, pb) {
    // all their point pairs lie within the topology window: nothing to test
    var mr = PR1[pa] - PR0[pb], mr2 = PR1[pb] - PR0[pa], mc = PC1[pa] - PC0[pb], mc2 = PC1[pb] - PC0[pa];
    if ((mr > mr2 ? mr : mr2) <= SKIP && (mc > mc2 ? mc : mc2) <= SKIP) return;
    // bounding spheres too far apart
    var bx = PCX[pb], by = PCY[pb], bz = PCZ[pb], rb = PRAD[pb];
    var dx = bx - PCX[pa], dy = by - PCY[pa], dz = bz - PCZ[pa], lim = SELF_REACH + PRAD[pa] + rb;
    if (dx * dx + dy * dy + dz * dz >= lim * lim) return;
    var q2 = SELF_REACH * SELF_REACH, qb = SELF_REACH + rb, qb2 = qb * qb, b0 = PSTART[pb], b1 = PSTART[pb + 1];
    for (var u = PSTART[pa], u1 = PSTART[pa + 1]; u < u1; u++) {
      var i = PMEM[u], xi = X[i], yi = Y[i], zi = Z[i];
      var hx = xi - bx, hy = yi - by, hz = zi - bz;
      if (hx * hx + hy * hy + hz * hz >= qb2) continue;     // this point can't reach any point of patch b
      var ri = ROWI[i], ci = COLI[i];
      for (var v = b0; v < b1; v++) {
        var j = PMEM[v], dr = ROWI[j] - ri, dc = COLI[j] - ci;
        if (dr <= SKIP && dr >= -SKIP && dc <= SKIP && dc >= -SKIP) continue;
        var gx = X[j] - xi, gy = Y[j] - yi, gz = Z[j] - zi;
        if (gx * gx + gy * gy + gz * gz < q2 && pairCount < MAX_PAIRS) { PAIR_A[pairCount] = i; PAIR_B[pairCount] = j; pairCount++; }
      }
    }
  }
  // Push overlapping pairs apart to SELF_DIST, split by inverse mass. (No friction term: editing the
  // previous positions for friction kept resting layers creeping forever, so the solver never slept.)
  function resolvePairs() {
    var m2 = SELF_DIST * SELF_DIST;
    for (var p = 0; p < pairCount; p++) {
      var a = PAIR_A[p], b = PAIR_B[p];
      var dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= m2 || d2 < 1e-8) continue;
      var wa = INV[a], wb = INV[b], w = wa + wb;
      if (w === 0) continue;
      var d = Math.sqrt(d2), k = (SELF_DIST - d) / (d * w);
      X[a] -= dx * k * wa; Y[a] -= dy * k * wa; Z[a] -= dz * k * wa;
      X[b] += dx * k * wb; Y[b] += dy * k * wb; Z[b] += dz * k * wb;
    }
  }

  // One fixed physics step. Returns the largest distance any point moved (for sleeping).
  function step(dt) {
    simTime += dt; geomVersion++;
    var dt2 = dt * dt, gy = GRAVITY * dt2, i, s, x, y, z, it;

    // 1. Verlet integration
    var gust = 0, t3 = simTime * 3.1;
    if (wind) gust = (520 + Math.sin(simTime * 0.9) * 300 + Math.sin(simTime * 2.3 + 1.7) * 160) * dt2;
    for (i = 0; i < N; i++) {
      if (INV[i] === 0) continue;
      x = X[i]; y = Y[i]; z = Z[i];
      var nx = x + (x - PX[i]) * DAMPING, ny = y + (y - PY[i]) * DAMPING + gy, nz = z + (z - PZ[i]) * DAMPING;
      if (wind) {
        var rip = gust * (0.55 + 0.45 * Math.sin(t3 + y * 0.021 + x * 0.004));
        nx += rip * 0.35; ny -= rip * 0.12; nz -= rip;        // blows toward the viewer and to the right
      }
      var mx = nx - x, my = ny - y, mz = nz - z, m2 = mx * mx + my * my + mz * mz;
      if (m2 > MAX_STEP * MAX_STEP) { var ms = MAX_STEP / Math.sqrt(m2); nx = x + mx * ms; ny = y + my * ms; nz = z + mz * ms; }
      PX[i] = x; PY[i] = y; PZ[i] = z; X[i] = nx; Y[i] = ny; Z[i] = nz;
    }

    // 2. The held point chases the drag target at a capped speed
    if (grabbed >= 0) {
      var g = grabbed, gx = target.x - X[g], gyy = target.y - Y[g], gz = target.z - Z[g];
      var gd2 = gx * gx + gyy * gyy + gz * gz, maxMove = MAX_GRAB_SPEED * dt;
      PX[g] = X[g]; PY[g] = Y[g]; PZ[g] = Z[g];
      if (gd2 > maxMove * maxMove) { var f = maxMove / Math.sqrt(gd2); gx *= f; gyy *= f; gz *= f; }
      X[g] += gx; Y[g] += gyy; Z[g] += gz;
      pullGrabArea();
    }

    // 3. Self-collision: gather nearby pairs every step, then resolve them between constraint passes
    if (selfCollide) gatherPairs();

    // 4. Constraints. The first pass also finds over-stretched structural springs to tear;
    //    later passes alternate direction (symmetric Gauss-Seidel converges faster).
    var tearLimit = TEAR_RATIO * TEAR_RATIO;
    for (s = 0; s < M; s++) {
      if (tearing && KIND[s] === KIND_STRUCT) {
        var a = SA[s], b = SB[s], dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
        if (dx * dx + dy * dy + dz * dz > RR[s] * tearLimit) { breakEdge(REF1[s]); continue; }   // removed by the sweep below
      }
      relax(s);
    }
    if (needSweep) sweepSprings();
    if (selfCollide) resolvePairs();
    for (it = 1; it < ITERATIONS; it++) {
      if (it & 1) { for (s = M - 1; s >= 0; s--) relax(s); }
      else { for (s = 0; s < M; s++) relax(s); }
      if (selfCollide && it === (ITERATIONS >> 1)) resolvePairs();
      if (grabCount) pullGrabArea();
    }
    if (selfCollide) resolvePairs();

    // 5. Floor with friction, soft walls, and motion for the sleep check
    var maxMotion = 0;
    for (i = 0; i < N; i++) {
      if (X[i] < -300) X[i] = -300; else if (X[i] > 1300) X[i] = 1300;
      if (Z[i] < -450) Z[i] = -450; else if (Z[i] > 850) Z[i] = 850;
      if (Y[i] > FLOOR) {
        Y[i] = FLOOR; PY[i] = FLOOR;
        PX[i] = X[i] - (X[i] - PX[i]) * 0.6; PZ[i] = Z[i] - (Z[i] - PZ[i]) * 0.6;
      }
      var m = Math.abs(X[i] - PX[i]) + Math.abs(Y[i] - PY[i]) + Math.abs(Z[i] - PZ[i]);
      if (m > maxMotion) maxMotion = m;
    }
    return maxMotion;
  }
  /* PHYSICS-END ======================================================================== */

  var GRAB_RADIUS_PX = 30;       // pointer pick radius in CSS pixels
  var SLEEP_FRAMES = 60;         // frames of near-stillness before the solver idles
  var SLEEP_MOTION = 0.05;       // max per-step movement (world units) that counts as still

  var canvas = document.getElementById('cloth');
  var overlay = document.getElementById('overlay');
  var octx = overlay.getContext('2d');
  // WebGL 2 where available: its bufferSubData can upload part of a typed array without making a view object.
  // The shaders are GLSL ES 1.00, which both versions accept.
  var GL_OPTS = { antialias: true, alpha: true, premultipliedAlpha: false, stencil: true };
  var gl = canvas.getContext('webgl2', GL_OPTS) || canvas.getContext('webgl', GL_OPTS);
  var gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  if (!gl) { document.getElementById('nogl').hidden = false; return; }

  var mode = 'grab', showSurface = true, showSprings = true, showHidden = false;
  var hover = -1, cssW = 1, cssH = 1, dpr = 1;
  var pointer = { x: 0, y: 0, vx: 0, vy: 0, vz: 0, t: 0, down: false, cutting: false, orbiting: false, inside: false, wx: 0, wy: 0, wz: 0 };
  var still = 0, asleep = false, dirty = true;   // dirty: redraw everything this frame
  var overlayDirty = false;                       // redraw only the 2D overlay (hover ring) this frame
  // anything that wakes the solver may also have moved points, so the renderer's cached geometry is stale
  function wake() { asleep = false; still = 0; dirty = true; geomVersion++; }

  /* ---------- Camera: small matrix helpers (column-major, like WebGL) ---------- */
  // head-on, slightly raised, with a long lens: reads as 2.5D, and you can still orbit
  var CAM_HOME = { yaw: 0, pitch: 0.07 };
  var cam = { yaw: CAM_HOME.yaw, pitch: CAM_HOME.pitch, dist: 1750, fov: 19 * Math.PI / 180, tx: 500, ty: 280, tz: 40 };
  function homeCamera() { cam.yaw = CAM_HOME.yaw; cam.pitch = CAM_HOME.pitch; updateCamera(); dirty = true; }
  var VP = new Float32Array(16), IVP = new Float32Array(16), EYE = new Float64Array(3), FWD = new Float64Array([0, 0, 1]);
  var VIEW = new Float32Array(16), PROJ = new Float32Array(16);   // scratch for updateCamera
  var PP = new Float64Array(2);                                    // projectPoint's result
  var UA = new Float64Array(3), UB = new Float64Array(3), UW = new Float64Array(3);   // unprojectToPlane scratch / result

  function mul(a, b, out) {
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  }
  function invert(m, out) {
    var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    var a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return out;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }
  function updateCamera() {
    var cp = Math.cos(cam.pitch);
    EYE[0] = cam.tx + cam.dist * Math.sin(cam.yaw) * cp;
    EYE[1] = cam.ty - cam.dist * Math.sin(cam.pitch);          // y is down, so "above" is negative y
    EYE[2] = cam.tz - cam.dist * Math.cos(cam.yaw) * cp;       // the viewer sits on the -z side
    // look-at basis with "up" = -y
    var zx = EYE[0] - cam.tx, zy = EYE[1] - cam.ty, zz = EYE[2] - cam.tz, zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
    zx /= zl; zy /= zl; zz /= zl;
    FWD[0] = -zx; FWD[1] = -zy; FWD[2] = -zz;
    var ux = 0, uy = -1, uz = 0;
    var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx, xl = Math.sqrt(xx * xx + xy * xy + xz * xz);
    xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    var v = VIEW;
    v[0] = xx; v[1] = yx; v[2] = zx; v[3] = 0; v[4] = xy; v[5] = yy; v[6] = zy; v[7] = 0; v[8] = xz; v[9] = yz; v[10] = zz; v[11] = 0;
    v[12] = -(xx * EYE[0] + xy * EYE[1] + xz * EYE[2]); v[13] = -(yx * EYE[0] + yy * EYE[1] + yz * EYE[2]); v[14] = -(zx * EYE[0] + zy * EYE[1] + zz * EYE[2]); v[15] = 1;
    var f = 1 / Math.tan(cam.fov / 2), near = 50, far = 5000, nf = 1 / (near - far), aspect = cssW / cssH, pr = PROJ;
    pr.fill(0);
    pr[0] = f / aspect; pr[5] = f; pr[10] = (far + near) * nf; pr[11] = -1; pr[14] = 2 * far * near * nf;
    mul(PROJ, VIEW, VP);
    invert(VP, IVP);
  }

  // world -> CSS pixel coordinates of the canvas
  var SXp, SYp;                                  // sized in allocRender()
  function projectAll() {
    var m = VP;
    for (var i = 0; i < N; i++) {
      var x = X[i], y = Y[i], z = Z[i];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15];
      SXp[i] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * cssW;
      SYp[i] = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * cssH;
    }
  }
  // writes the CSS-pixel position into PP (no allocation)
  function projectPoint(x, y, z) {
    var m = VP, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    PP[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * cssW;
    PP[1] = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * cssH;
  }
  function unproject(nx, ny, z, out) {
    var m = IVP;
    var x = m[0] * nx + m[4] * ny + m[8] * z + m[12], y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
    var zz = m[2] * nx + m[6] * ny + m[10] * z + m[14], w = m[3] * nx + m[7] * ny + m[11] * z + m[15];
    out[0] = x / w; out[1] = y / w; out[2] = zz / w;
  }
  // ray through a CSS pixel, intersected with the plane facing the camera through point (px, py, pz).
  // Returns the shared UW array: read it before the next call.
  function unprojectToPlane(sx, sy, px, py, pz) {
    var nx = sx / cssW * 2 - 1, ny = 1 - sy / cssH * 2;
    unproject(nx, ny, -1, UA); unproject(nx, ny, 1, UB);
    var dx = UB[0] - UA[0], dy = UB[1] - UA[1], dz = UB[2] - UA[2];
    var den = dx * FWD[0] + dy * FWD[1] + dz * FWD[2];
    var t = ((px - UA[0]) * FWD[0] + (py - UA[1]) * FWD[1] + (pz - UA[2]) * FWD[2]) / den;
    UW[0] = UA[0] + dx * t; UW[1] = UA[1] + dy * t; UW[2] = UA[2] + dz * t;
    return UW;
  }

  /* ---------- Shaders ---------- */
  function compile(type, src) {
    var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');   // keep attribute 0 always enabled (the pins draw with aStrain disabled)
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var info = { p: p, a: {}, u: {}, locs: [] }, i, n;
    n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (i = 0; i < n; i++) { var at = gl.getActiveAttrib(p, i); info.a[at.name] = gl.getAttribLocation(p, at.name); info.locs.push(info.a[at.name]); }
    n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (i = 0; i < n; i++) { var un = gl.getActiveUniform(p, i); info.u[un.name] = gl.getUniformLocation(p, un.name); }
    return info;
  }

  // Fabric: two-sided lighting from per-vertex normals, wrap-around diffuse, fill light,
  // grazing-angle sheen and a faint woven texture. Also draws the flattened floor shadow.
  var surfaceProg = program([
    'attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv; attribute float aStress; varying float vStress;',
    'uniform mat4 uVP; uniform float uFlatten; uniform float uFloor;',
    'varying vec3 vNor; varying vec2 vUv; varying vec3 vPos;',
    'void main() {',
    '  vec3 p = aPos;',
    '  if (uFlatten > 0.5) p.y = uFloor;',
    '  vPos = p; vNor = aNor; vUv = aUv; vStress = aStress;',
    '  gl_Position = uVP * vec4(p, 1.0);',
    '}'].join('\n'), [
    'precision mediump float;',
    'varying vec3 vNor; varying vec2 vUv; varying vec3 vPos;',
    'uniform vec3 uEye; uniform vec3 uKey; uniform vec3 uFill; uniform float uShadow;',
    'uniform vec3 uFront; uniform vec3 uBack; uniform vec2 uGrid; uniform vec3 uHot; varying float vStress;',
    'void main() {',
    '  if (uShadow > 0.5) { gl_FragColor = vec4(0.05, 0.06, 0.08, 0.11); return; }',
    '  vec3 n = normalize(vNor);',
    '  vec3 v = normalize(uEye - vPos);',
    '  float facing = dot(n, v);',
    '  vec3 base = mix(facing >= 0.0 ? uFront : uBack, uHot, smoothstep(1.1, 2.4, vStress));',   // same strain scale as the springs
    '  if (facing < 0.0) n = -n;',                                  // light whichever side we see
    '  float key = clamp((dot(n, uKey) + 0.35) / 1.35, 0.0, 1.0);',   // wrap lighting: soft like fabric
    '  float fill = max(dot(n, uFill), 0.0);',
    '  float sheen = pow(1.0 - clamp(abs(facing), 0.0, 1.0), 3.0);', // fibres catch light at grazing angles
    '  vec2 g = vUv * uGrid * 3.14159265 * 4.0;',
    '  float weave = 0.965 + 0.035 * sin(g.x) * sin(g.y);',
    '  vec3 col = base * weave * (0.40 + 0.56 * key + 0.14 * fill) + vec3(0.14) * sheen;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'].join('\n'));

  // Springs, floor grid and pins share one simple shader. Strain tints springs toward orange.
  var lineProg = program([
    'attribute vec3 aPos; attribute float aStrain;',
    'uniform mat4 uVP; uniform vec3 uEye; uniform float uPull; uniform float uPointSize;',
    'varying float vStrain;',
    'void main() {',
    '  vStrain = aStrain;',
    '  vec3 p = aPos + normalize(uEye - aPos) * uPull;',            // nudge toward the camera by a fixed world distance:
    '  gl_Position = uVP * vec4(p, 1.0);',                            // enough to sit on their own surface, far less than the gap between layers
    '  gl_PointSize = uPointSize;',
    '}'].join('\n'), [
    'precision mediump float;',
    'varying float vStrain;',
    'uniform vec4 uColor; uniform vec4 uHot; uniform float uRound;',
    'void main() {',
    '  if (uRound > 0.5 && length(gl_PointCoord - 0.5) > 0.5) discard;',
    '  float t = smoothstep(1.1, 2.4, vStrain);',                    // vStrain is length^2 / rest^2
    '  gl_FragColor = mix(uColor, uHot, t);',
    '}'].join('\n'));

  /* ---------- Buffers ---------- */
  // Every array draw() touches is allocated in allocRender(), once per density, and the GPU buffers are sized
  // there too. A frame only fills those arrays and copies them in with bufferSubData, so drawing allocates
  // nothing in JS and never makes the driver reallocate GPU storage.
  var posData, norData, uvData, stressData, idxData, pinIdx, lineData;
  var idxCount = 0, pinCount = 0, lineCount = new Int32Array(3);
  var builtTopology = -1, builtPins = -1;
  // what the cached geometry (positions, normals, stress, spring lines) was built from; see draw()
  var drawnGeom = -1, drawnTopo = -1, drawnAlpha = -1, drawnFlags = -1;

  var bufPos = gl.createBuffer(), bufNor = gl.createBuffer(), bufUv = gl.createBuffer(), bufStress = gl.createBuffer();
  var bufIdx = gl.createBuffer(), bufPinIdx = gl.createBuffer(), bufFloor = gl.createBuffer();
  var bufLines = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];

  function reserve(target, buf, bytes) { gl.bindBuffer(target, buf); gl.bufferData(target, bytes, gl.DYNAMIC_DRAW); }
  // Copy the first `len` elements of `data` into `buf`. WebGL 2 copies exactly that range; WebGL 1 has no
  // range form, so it copies the whole (preallocated) array rather than allocate a subarray view.
  function upload(target, buf, data, len) {
    gl.bindBuffer(target, buf);
    if (gl2) gl.bufferSubData(target, 0, data, 0, len);
    else gl.bufferSubData(target, 0, data);
  }

  // (Re)size the drawing arrays and GPU buffers to the current grid. Call after applyDensity().
  function allocRender() {
    posData = new Float32Array(N * 3); norData = new Float32Array(N * 3); uvData = new Float32Array(N * 2);
    stressData = new Float32Array(N);
    for (var r0 = 0; r0 < ROWS; r0++) for (var c0 = 0; c0 < COLS; c0++) {
      uvData[(r0 * COLS + c0) * 2] = c0 / (COLS - 1); uvData[(r0 * COLS + c0) * 2 + 1] = r0 / (ROWS - 1);
    }
    idxData = new Uint16Array(NC * 6); pinIdx = new Uint16Array(N);
    // one line array per spring kind, each sized to how many springs of that kind the grid has
    var cap = [NE, 2 * NC, MAX_SPRINGS - NE - 2 * NC];
    lineData = [new Float32Array(cap[0] * 8), new Float32Array(cap[1] * 8), new Float32Array(cap[2] * 8)];
    SXp = new Float32Array(N); SYp = new Float32Array(N);
    idxCount = pinCount = 0; lineCount.fill(0);
    builtTopology = builtPins = drawnGeom = drawnTopo = drawnFlags = -1; drawnAlpha = -1;

    gl.bindBuffer(gl.ARRAY_BUFFER, bufUv); gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);
    reserve(gl.ARRAY_BUFFER, bufPos, posData.byteLength);
    reserve(gl.ARRAY_BUFFER, bufNor, norData.byteLength);
    reserve(gl.ARRAY_BUFFER, bufStress, stressData.byteLength);
    for (var k = 0; k < 3; k++) reserve(gl.ARRAY_BUFFER, bufLines[k], lineData[k].byteLength);
    reserve(gl.ELEMENT_ARRAY_BUFFER, bufIdx, idxData.byteLength);
    reserve(gl.ELEMENT_ARRAY_BUFFER, bufPinIdx, pinIdx.byteLength);
  }
  allocRender();

  var floorVerts = [], fx, fz;
  for (fx = -400; fx <= 1400; fx += 50) floorVerts.push(fx, FLOOR, -500, 1, fx, FLOOR, 900, 1);
  for (fz = -500; fz <= 900; fz += 50) floorVerts.push(-400, FLOOR, fz, 1, 1400, FLOOR, fz, 1);
  var floorCount = floorVerts.length / 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, bufFloor); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floorVerts), gl.STATIC_DRAW);
  floorVerts = null;

  // triangles: a cell is drawn only while all four of its structural edges are intact
  function rebuildIndices() {
    idxCount = 0;
    for (var r = 0; r < ROWS - 1; r++) for (var c = 0; c < COLS - 1; c++) {
      if (CELLDEAD[cellId(r, c)]) continue;
      var i = r * COLS + c;
      idxData[idxCount++] = i; idxData[idxCount++] = i + 1; idxData[idxCount++] = i + COLS + 1;
      idxData[idxCount++] = i; idxData[idxCount++] = i + COLS + 1; idxData[idxCount++] = i + COLS;
    }
    if (idxCount) upload(gl.ELEMENT_ARRAY_BUFFER, bufIdx, idxData, idxCount);
    builtTopology = topology;
  }
  // pins are drawn straight from the position buffer through this index list, rebuilt only when pins change
  function rebuildPins() {
    pinCount = 0;
    for (var i = 0; i < N; i++) if (PIN[i]) pinIdx[pinCount++] = i;
    if (pinCount) upload(gl.ELEMENT_ARRAY_BUFFER, bufPinIdx, pinIdx, pinCount);
    builtPins = pinsVersion;
  }

  /* ---------- Drawing ---------- */
  function attrib(prog, name, buf, size, stride, offset) {
    var loc = prog.a[name];
    if (loc === undefined) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride || 0, offset || 0);
  }
  function disableAttribs(prog) { for (var k = 0; k < prog.locs.length; k++) gl.disableVertexAttribArray(prog.locs[k]); }

  // spring colours per kind: base rgba, then strained rgba (structural alpha depends on showSurface, set in draw)
  var LINE_COLORS = [
    new Float32Array([0.05, 0.06, 0.08, 0.55, 1.0, 0.30, 0.07, 1.0]),   // structural: ink, hot = orange
    new Float32Array([0.36, 0.38, 0.44, 0.45, 0.36, 0.38, 0.44, 0.45]), // shear: muted grey
    new Float32Array([0.76, 0.23, 0.02, 0.5, 0.76, 0.23, 0.02, 0.5])    // bend: deep orange
  ];

  // Fill and upload the per-frame geometry: interpolated positions, normals, per-point stress and the spring
  // lines. Strain is computed once per spring and feeds both the stress colouring and the lines.
  function buildGeometry(alpha) {
    var P = posData, i, o, r, c, s;
    for (i = 0, o = 0; i < N; i++, o += 3) {
      P[o] = PX[i] + (X[i] - PX[i]) * alpha;
      P[o + 1] = PY[i] + (Y[i] - PY[i]) * alpha;
      P[o + 2] = PZ[i] + (Z[i] - PZ[i]) * alpha;
    }
    upload(gl.ARRAY_BUFFER, bufPos, P, N * 3);

    if (showSurface) {
      // per-vertex normals from the neighbouring points (central differences)
      var NOR = norData;
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        i = r * COLS + c;
        var l = (c > 0 ? i - 1 : i) * 3, rt = (c < COLS - 1 ? i + 1 : i) * 3, u = (r > 0 ? i - COLS : i) * 3, d = (r < ROWS - 1 ? i + COLS : i) * 3;
        var ax = P[rt] - P[l], ay = P[rt + 1] - P[l + 1], az = P[rt + 2] - P[l + 2];
        var bx = P[d] - P[u], by = P[d + 1] - P[u + 1], bz = P[d + 2] - P[u + 2];
        var nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;   // down x right: faces the viewer when hanging
        var nl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        o = i * 3; NOR[o] = nx * nl; NOR[o + 1] = ny * nl; NOR[o + 2] = nz * nl;
      }
      upload(gl.ARRAY_BUFFER, bufNor, NOR, N * 3);
      stressData.fill(1);
    }

    // one pass over the springs: stress (the most-stretched structural spring touching each point, as
    // length^2 / rest^2) and the line vertices, one buffer per kind, each vertex carrying the spring's strain
    lineCount[0] = lineCount[1] = lineCount[2] = 0;
    var wantStress = showSurface, wantStruct = showSprings, wantHidden = showHidden;
    if (wantStress || wantStruct || wantHidden) {
      var ST = stressData, L0 = lineData[0], L1 = lineData[1], L2 = lineData[2], n0 = 0, n1 = 0, n2 = 0;
      for (s = 0; s < M; s++) {
        var kd = KIND[s], isStruct = kd === KIND_STRUCT, line = isStruct ? wantStruct : wantHidden;
        if (!line && !(isStruct && wantStress)) continue;
        var a = SA[s], b = SB[s], a3 = a * 3, b3 = b * 3;
        var x1 = P[a3], y1 = P[a3 + 1], z1 = P[a3 + 2], x2 = P[b3], y2 = P[b3 + 1], z2 = P[b3 + 2];
        var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, st = (dx * dx + dy * dy + dz * dz) / RR[s];
        if (isStruct && wantStress) { if (st > ST[a]) ST[a] = st; if (st > ST[b]) ST[b] = st; }
        if (!line) continue;
        var arr, lo;
        if (kd === 0) { arr = L0; lo = n0 * 8; n0++; } else if (kd === 1) { arr = L1; lo = n1 * 8; n1++; } else { arr = L2; lo = n2 * 8; n2++; }
        arr[lo] = x1; arr[lo + 1] = y1; arr[lo + 2] = z1; arr[lo + 3] = st;
        arr[lo + 4] = x2; arr[lo + 5] = y2; arr[lo + 6] = z2; arr[lo + 7] = st;
      }
      lineCount[0] = n0; lineCount[1] = n1; lineCount[2] = n2;
      if (wantStress) upload(gl.ARRAY_BUFFER, bufStress, ST, N);
      for (var k = 0; k < 3; k++) if (lineCount[k]) upload(gl.ARRAY_BUFFER, bufLines[k], lineData[k], lineCount[k] * 8);
    }
  }

  function draw(alpha) {
    if (builtTopology !== topology) rebuildIndices();
    if (builtPins !== pinsVersion) rebuildPins();
    // Rebuild the geometry only if something it depends on changed. While the cloth sleeps and you orbit,
    // this is skipped and a frame is just the GL draw calls with a new camera.
    var flags = (showSurface ? 1 : 0) | (showSprings ? 2 : 0) | (showHidden ? 4 : 0);
    if (geomVersion !== drawnGeom || topology !== drawnTopo || alpha !== drawnAlpha || flags !== drawnFlags) {
      buildGeometry(alpha);
      drawnGeom = geomVersion; drawnTopo = topology; drawnAlpha = alpha; drawnFlags = flags;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // floor grid
    gl.useProgram(lineProg.p);
    gl.uniformMatrix4fv(lineProg.u.uVP, false, VP);
    gl.uniform3f(lineProg.u.uEye, EYE[0], EYE[1], EYE[2]); gl.uniform1f(lineProg.u.uPull, 0); gl.uniform1f(lineProg.u.uPointSize, 1); gl.uniform1f(lineProg.u.uRound, 0);
    gl.uniform4f(lineProg.u.uColor, 0.05, 0.06, 0.08, 0.07); gl.uniform4f(lineProg.u.uHot, 0.05, 0.06, 0.08, 0.07);
    attrib(lineProg, 'aPos', bufFloor, 3, 16, 0); attrib(lineProg, 'aStrain', bufFloor, 1, 16, 12);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, floorCount);
    gl.depthMask(true);
    disableAttribs(lineProg);

    if (showSurface && idxCount) {
      gl.useProgram(surfaceProg.p);
      gl.uniformMatrix4fv(surfaceProg.u.uVP, false, VP);
      gl.uniform3f(surfaceProg.u.uEye, EYE[0], EYE[1], EYE[2]);
      gl.uniform3f(surfaceProg.u.uKey, -0.36, -0.55, -0.75);      // up-left and in front of the cloth (y is down)
      gl.uniform3f(surfaceProg.u.uFill, 0.6, -0.2, 0.77);         // from behind-right
      gl.uniform3f(surfaceProg.u.uFront, 0.93, 0.935, 0.95);      // paper white
      gl.uniform3f(surfaceProg.u.uBack, 0.55, 0.58, 0.64);         // slate, so stress orange reads on both sides
      gl.uniform3f(surfaceProg.u.uHot, 1.0, 0.30, 0.07);           // the springs' strained colour
      gl.uniform2f(surfaceProg.u.uGrid, COLS - 1, ROWS - 1);
      gl.uniform1f(surfaceProg.u.uFloor, FLOOR - 0.5);
      attrib(surfaceProg, 'aPos', bufPos, 3); attrib(surfaceProg, 'aNor', bufNor, 3); attrib(surfaceProg, 'aUv', bufUv, 2); attrib(surfaceProg, 'aStress', bufStress, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);

      // soft shadow: the mesh flattened onto the floor, each pixel darkened once (stencil)
      gl.uniform1f(surfaceProg.u.uShadow, 1); gl.uniform1f(surfaceProg.u.uFlatten, 1);
      gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.depthMask(false);
      gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.disable(gl.STENCIL_TEST);

      // the fabric itself (the springs are nudged toward the camera in their shader, so they draw on top of it)
      gl.uniform1f(surfaceProg.u.uShadow, 0); gl.uniform1f(surfaceProg.u.uFlatten, 0);
      gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
      disableAttribs(surfaceProg);
    }

    // springs (bend, then shear, then structural on top)
    if (lineCount[0] || lineCount[1] || lineCount[2]) {
      gl.useProgram(lineProg.p);
      gl.uniformMatrix4fv(lineProg.u.uVP, false, VP);
      gl.uniform3f(lineProg.u.uEye, EYE[0], EYE[1], EYE[2]); gl.uniform1f(lineProg.u.uPull, 1.5); gl.uniform1f(lineProg.u.uRound, 0);
      for (var k = 2; k >= 0; k--) {
        if (!lineCount[k]) continue;
        var col = LINE_COLORS[k];
        gl.uniform4f(lineProg.u.uColor, col[0], col[1], col[2], k === 0 ? (showSurface ? 0.55 : 0.8) : col[3]);
        gl.uniform4f(lineProg.u.uHot, col[4], col[5], col[6], col[7]);
        attrib(lineProg, 'aPos', bufLines[k], 3, 16, 0); attrib(lineProg, 'aStrain', bufLines[k], 1, 16, 12);
        gl.drawArrays(gl.LINES, 0, lineCount[k] * 2);
      }
      disableAttribs(lineProg);
    }

    // pins: indexed straight out of the position buffer
    if (pinCount) {
      gl.useProgram(lineProg.p);
      gl.uniformMatrix4fv(lineProg.u.uVP, false, VP);
      gl.uniform3f(lineProg.u.uEye, EYE[0], EYE[1], EYE[2]); gl.uniform1f(lineProg.u.uPull, 3); gl.uniform1f(lineProg.u.uPointSize, 7 * dpr); gl.uniform1f(lineProg.u.uRound, 1);
      gl.uniform4f(lineProg.u.uColor, 0.05, 0.06, 0.08, 1); gl.uniform4f(lineProg.u.uHot, 0.05, 0.06, 0.08, 1);
      attrib(lineProg, 'aPos', bufPos, 3);
      if (lineProg.a.aStrain !== undefined) gl.vertexAttrib1f(lineProg.a.aStrain, 0);   // disabled: constant
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufPinIdx);
      gl.drawElements(gl.POINTS, pinCount, gl.UNSIGNED_SHORT, 0);
      disableAttribs(lineProg);
    }

    drawOverlay();
  }

  // 2D overlay for the pointer feedback (hover ring, cut brush). Skips the clear when it is already empty.
  var overlayHasContent = true;
  function drawOverlay() {
    var focus = grabbed >= 0 ? grabbed : (mode === 'grab' && pointer.inside && !pointer.down ? hover : -1);
    var brush = pointer.cutting && pointer.inside;
    if (focus < 0 && !brush && !overlayHasContent) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    overlayHasContent = focus >= 0 || brush;
    if (!overlayHasContent) return;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (focus >= 0) {
      var o = focus * 3, fx = posData[o], fy = posData[o + 1], fz = posData[o + 2];
      projectPoint(fx, fy, fz);
      var px = PP[0], py = PP[1];
      // the grab patch: a soft disc the size of GRAB_RADIUS on screen, plus a ring on the held point
      projectPoint(fx + GRAB_RADIUS, fy, fz);
      var ex = PP[0] - px, ey = PP[1] - py, pr = Math.sqrt(ex * ex + ey * ey);
      octx.fillStyle = grabbed >= 0 ? 'rgba(255,77,18,0.16)' : 'rgba(255,77,18,0.09)';
      octx.beginPath(); octx.arc(px, py, pr, 0, 6.2832); octx.fill();
      octx.strokeStyle = '#FF4D12'; octx.lineWidth = 2;
      octx.beginPath(); octx.arc(px, py, grabbed >= 0 ? 7 : 5, 0, 6.2832); octx.stroke();
    }
    if (brush) {
      octx.fillStyle = 'rgba(255,77,18,0.18)';
      octx.beginPath(); octx.arc(pointer.x, pointer.y, 10, 0, 6.2832); octx.fill();
    }
  }

  /* ---------- Sizing ---------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = Math.max(1, rect.width); cssH = Math.max(1, rect.height);
    canvas.width = overlay.width = Math.round(cssW * dpr);
    canvas.height = overlay.height = Math.round(cssH * dpr);
    updateCamera();
    dirty = true;
  }

  /* ---------- Pointer interaction (all in CSS pixels of the canvas) ---------- */
  var LX = 0, LY = 0;   // local(e) writes the event's canvas position here
  function local(e) { var rect = canvas.getBoundingClientRect(); LX = e.clientX - rect.left; LY = e.clientY - rect.top; }
  function nearestPoint(sx, sy) {
    projectAll();
    var best = -1, bestD = GRAB_RADIUS_PX * GRAB_RADIUS_PX;
    for (var i = 0; i < N; i++) {
      var dx = SXp[i] - sx, dy = SYp[i] - sy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function segIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
    var d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x);
    if (d === 0) return false;
    var t = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d;
    var u = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function cutAlong(x1, y1, x2, y2) {
    projectAll();
    var changed = false;
    for (var s = 0; s < M; s++) {
      var a = SA[s], b = SB[s];
      var mx = (SXp[a] + SXp[b]) / 2 - x2, my = (SYp[a] + SYp[b]) / 2 - y2;
      if (mx * mx + my * my < 49 || segIntersect(x1, y1, x2, y2, SXp[a], SYp[a], SXp[b], SYp[b])) {
        if (KIND[s] === KIND_STRUCT) breakEdge(REF1[s]);   // marked now, removed by the sweep below
        else { removeSpring(s); s--; }
        changed = true;
      }
    }
    if (needSweep) sweepSprings();
    if (changed) { topology++; wake(); }
  }
  function updateCursor() {
    canvas.classList.toggle('cut', mode === 'cut' || pointer.cutting);
    canvas.classList.toggle('dragging', grabbed >= 0 || pointer.orbiting);
  }

  canvas.addEventListener('pointerdown', function (e) {
    local(e);
    var px = LX, py = LY;
    pointer.x = px; pointer.y = py; pointer.vx = pointer.vy = pointer.vz = 0; pointer.t = e.timeStamp;
    pointer.down = true; pointer.inside = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    pointer.cutting = mode === 'cut' || e.button === 2 || e.shiftKey;
    if (pointer.cutting) cutAlong(px, py, px, py);
    else {
      grabbed = nearestPoint(px, py);
      if (grabbed >= 0) {
        INV[grabbed] = 0;
        grabArea(grabbed);
        target.x = pointer.wx = X[grabbed]; target.y = pointer.wy = Y[grabbed]; target.z = pointer.wz = Z[grabbed];
      } else pointer.orbiting = true;              // empty space: orbit the camera
    }
    // orbiting a settled cloth only redraws the cached geometry from a new camera; anything else wakes the solver
    if (pointer.orbiting) dirty = true; else wake();
    updateCursor();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    local(e);
    var px = LX, py = LY, dx = px - pointer.x, dy = py - pointer.y;
    pointer.inside = true;
    if (pointer.down) {
      if (pointer.cutting) cutAlong(pointer.x, pointer.y, px, py);
      else if (pointer.orbiting) {
        cam.yaw -= dx * 0.0035;
        cam.pitch = Math.max(-0.05, Math.min(1.1, cam.pitch + dy * 0.003));
        updateCamera();
      } else if (grabbed >= 0) {
        // drag within the plane that faces the camera and passes through the held point
        var w = unprojectToPlane(px, py, target.x, target.y, target.z);
        var dt = Math.max(e.timeStamp - pointer.t, 1) / 1000;
        pointer.vx = pointer.vx * 0.6 + (w[0] - target.x) / dt * 0.4;
        pointer.vy = pointer.vy * 0.6 + (w[1] - target.y) / dt * 0.4;
        pointer.vz = pointer.vz * 0.6 + (w[2] - target.z) / dt * 0.4;
        target.x = w[0]; target.y = w[1]; target.z = w[2];
      }
      dirty = true;
    } else if (mode === 'grab') {
      var h = nearestPoint(px, py);
      if (h !== hover) { hover = h; overlayDirty = true; }   // only the hover ring changes
    }
    pointer.t = e.timeStamp;
    pointer.x = px; pointer.y = py;
  });
  function clampSpeed(v) { return v < -4000 ? -4000 : v > 4000 ? 4000 : v; }
  function release() {
    var touched = grabbed >= 0 || pointer.cutting;   // orbiting never touches the cloth, so it needn't wake the solver
    if (grabbed >= 0) {
      var g = grabbed;
      if (PIN[g]) { PX[g] = X[g]; PY[g] = Y[g]; PZ[g] = Z[g]; }
      else {
        // carry the pointer's velocity into the cloth so it can be thrown
        PX[g] = X[g] - clampSpeed(pointer.vx) * STEP; PY[g] = Y[g] - clampSpeed(pointer.vy) * STEP; PZ[g] = Z[g] - clampSpeed(pointer.vz) * STEP;
        INV[g] = 1;
      }
    }
    grabbed = -1; grabCount = 0; pointer.down = false; pointer.cutting = false; pointer.orbiting = false;
    if (touched) wake(); else dirty = true;
    updateCursor();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', function () { if (!pointer.down) { pointer.inside = false; hover = -1; overlayDirty = true; } });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('dblclick', function (e) {
    local(e);
    var i = nearestPoint(LX, LY);
    if (i < 0) return;
    PIN[i] = PIN[i] ? 0 : 1; pinsVersion++;
    INV[i] = PIN[i] ? 0 : 1;
    PX[i] = X[i]; PY[i] = Y[i]; PZ[i] = Z[i];
    wake();
  });

  /* ---------- Controls ---------- */
  function byId(id) { return document.getElementById(id); }
  var bGrab = byId('modeGrab'), bCut = byId('modeCut');
  function setMode(m) {
    mode = m;
    bGrab.setAttribute('aria-pressed', String(m === 'grab'));
    bCut.setAttribute('aria-pressed', String(m === 'cut'));
    hover = -1; dirty = true; updateCursor();
  }
  function toggler(id, get, set, wakeSim) {
    var b = byId(id);
    function flip() { set(!get()); b.setAttribute('aria-pressed', String(get())); if (wakeSim) wake(); else dirty = true; }
    b.addEventListener('click', flip);
    return flip;
  }
  var toggleWind = toggler('wind', function () { return wind; }, function (v) { wind = v; }, true);
  var toggleTear = toggler('tear', function () { return tearing; }, function (v) { tearing = v; }, false);
  var toggleSelf = toggler('selfc', function () { return selfCollide; }, function (v) { selfCollide = v; }, true);
  toggler('surface', function () { return showSurface; }, function (v) { showSurface = v; }, false);
  toggler('springs', function () { return showSprings; }, function (v) { showSprings = v; }, false);
  toggler('hidden', function () { return showHidden; }, function (v) { showHidden = v; }, false);
  bGrab.addEventListener('click', function () { setMode('grab'); });
  bCut.addEventListener('click', function () { setMode('cut'); });
  byId('reset').addEventListener('click', function () { build(); homeCamera(); wake(); });

  // Density slider (DENSITY_MIN..DENSITY_MAX). The label follows the thumb live; the mesh is only rebuilt on
  // 'change', which fires once the user lets go (or per arrow-key step), so dragging never rebuilds mid-slide.
  var densityBox = document.createElement('label'), densityIn = document.createElement('input'), densityOut = document.createElement('output');
  densityBox.className = 'toggle';
  densityBox.style.cursor = 'default';
  densityIn.type = 'range'; densityIn.id = 'density';
  densityIn.min = DENSITY_MIN; densityIn.max = DENSITY_MAX; densityIn.step = 0.05; densityIn.value = DENSITY_MULT;
  densityIn.style.cssText = 'width: 110px; margin: 0; accent-color: var(--accent); cursor: pointer;';
  densityOut.style.cssText = 'font-family: var(--mono); font-size: 12px; min-width: 4ch; text-align: right;';
  densityOut.htmlFor = 'density';
  function showDensity(v) { densityOut.textContent = (+v).toFixed(2) + '×'; }
  showDensity(DENSITY_MULT);
  densityBox.appendChild(document.createTextNode('Density'));
  densityBox.appendChild(densityIn); densityBox.appendChild(densityOut);
  byId('reset').parentNode.insertBefore(densityBox, byId('reset'));
  densityIn.addEventListener('input', function () { showDensity(densityIn.value); });
  densityIn.addEventListener('change', function () {
    var v = Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, +densityIn.value));
    showDensity(v);
    if (v === DENSITY_MULT) return;
    DENSITY_MULT = v;
    applyDensity(); allocRender(); build();
    hover = -1; wake();
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var k = e.key.toLowerCase();
    if (k === 'g') setMode('grab');
    else if (k === 'c') setMode('cut');
    else if (k === 'w') toggleWind();
    else if (k === 't') toggleTear();
    else if (k === 's') toggleSelf();
    else if (k === 'r') { build(); homeCamera(); wake(); }
  });

  /* ---------- Loop ---------- */
  var sPoints = byId('sPoints'), sLinks = byId('sLinks'), sFps = byId('sFps'), sMs = byId('sMs');
  var acc = 0, last = performance.now(), frames = 0, fpsT = last, visible = true;
  var simMs = 0, drawMs = 0, worked = 0, shownN = -1, shownM = -1, shownIdle = false;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(canvas);

  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    frames++;
    if (visible && !document.hidden) {
      var t0 = performance.now(), n = 0, motion = 0;
      if (!asleep) {
        acc += dt;
        // catch up at most 4 steps or ~8 ms per frame; if still behind, drop the leftover time (brief slow
        // motion) instead of letting heavy frames demand ever more steps and freeze the page
        while (acc >= STEP && n < 4 && performance.now() - t0 < 8) { motion = Math.max(motion, step(STEP)); acc -= STEP; n++; }
        if (acc >= STEP) acc = 0;
        // idle the solver once the cloth has settled and nobody is touching it
        if (n > 0) {
          if (!wind && grabbed < 0 && !pointer.down && motion < SLEEP_MOTION) { if (++still > SLEEP_FRAMES) asleep = true; }
          else still = 0;
        }
      }
      var t1 = performance.now();
      if (!asleep || dirty) {
        draw(asleep ? 1 : acc / STEP);
        dirty = overlayDirty = false;
        var t2 = performance.now();
        simMs += t1 - t0; drawMs += t2 - t1; worked++;
      } else if (overlayDirty) {
        drawOverlay();   // asleep and only the hover ring moved: leave the WebGL frame as it is
        overlayDirty = false;
      }
    }
    if (now - fpsT > 500) {
      // touch the DOM only when a value changed (each write builds a string and may restyle)
      if (N !== shownN) sPoints.textContent = shownN = N;
      if (M !== shownM) sLinks.textContent = shownM = M;
      if (asleep) {
        if (!shownIdle) { sFps.textContent = '—'; sMs.textContent = 'idle'; sMs.title = 'Cloth has settled; the solver is paused until you touch it.'; shownIdle = true; }
      } else if (worked) {
        shownIdle = false;
        var msPerFrame = (simMs + drawMs) / worked;
        sMs.textContent = msPerFrame.toFixed(2);
        // theoretical frame rate if only our own CPU work limited it (display refresh normally caps it)
        sFps.textContent = Math.round(1000 / Math.max(msPerFrame, 0.01)).toLocaleString("en-US");
        sMs.title = 'physics ' + (simMs / worked).toFixed(3) + ' ms + drawing ' + (drawMs / worked).toFixed(3) + ' ms per frame';
      }
      frames = 0; fpsT = now; simMs = drawMs = 0; worked = 0;
    }
    requestAnimationFrame(frame);
  }

  build();
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
