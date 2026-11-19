'use strict';
/* 去浮水印的補圖演算法；也會被包成 Web Worker 在背景執行，所以必須自成一體 */

/* Content-aware fill: multi-scale PatchMatch (copies real texture from around the marked area).
   Self-contained so it can run inside a Web Worker. */
function umAlgoFactory() {
  function diffuseFill(img, hole, W, H) {
    const N = W * H, R = 4, known = new Uint8Array(N);
    for (let i = 0; i < N; i++) known[i] = hole[i] ? 0 : 1;
    const offs = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d2 = dx * dx + dy * dy; if (d2 && d2 <= R * R) offs.push(dx, dy, 1 / d2); }
    const queued = new Uint8Array(N); let layer = [];
    for (let i = 0; i < N; i++) if (hole[i]) {
      const x = i % W, y = (i / W) | 0;
      if ((x > 0 && known[i - 1]) || (x < W - 1 && known[i + 1]) || (y > 0 && known[i - W]) || (y < H - 1 && known[i + W])) { layer.push(i); queued[i] = 1; }
    }
    if (!layer.length) { for (let i = 0; i < N; i++) if (hole[i]) img[i * 3] = img[i * 3 + 1] = img[i * 3 + 2] = 128; return; }
    while (layer.length) {
      const vals = new Float32Array(layer.length * 3);
      for (let k = 0; k < layer.length; k++) {
        const i = layer[k], x = i % W, y = (i / W) | 0;
        let sw = 0, s0 = 0, s1 = 0, s2 = 0;
        for (let o = 0; o < offs.length; o += 3) {
          const nx = x + offs[o], ny = y + offs[o + 1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx; if (!known[j]) continue;
          const w = offs[o + 2]; sw += w; s0 += w * img[j * 3]; s1 += w * img[j * 3 + 1]; s2 += w * img[j * 3 + 2];
        }
        if (sw) { vals[k * 3] = s0 / sw; vals[k * 3 + 1] = s1 / sw; vals[k * 3 + 2] = s2 / sw; }
      }
      const next = [];
      for (let k = 0; k < layer.length; k++) { const i = layer[k]; img[i * 3] = vals[k * 3]; img[i * 3 + 1] = vals[k * 3 + 1]; img[i * 3 + 2] = vals[k * 3 + 2]; known[i] = 1; }
      for (const i of layer) {
        const x = i % W, y = (i / W) | 0;
        const push = j => { if (hole[j] && !known[j] && !queued[j]) { queued[j] = 1; next.push(j); } };
        if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
      }
      layer = next;
    }
  }
  function integral(hole, W, H) {
    const I = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += hole[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    return I;
  }
  function solveLevel(img, hole, W, H, nnfInit, Wc, Hc, em, pmIters) {
    const r = 3, Wp = W + 2 * r, Hp = H + 2 * r, NP = Wp * Hp, W1 = W + 1;
    const I = integral(hole, W, H);
    const pimg = new Float32Array(NP * 3), phole = new Uint8Array(NP), srcOK = new Uint8Array(NP), isT = new Uint8Array(NP);
    for (let y = 0; y < Hp; y++) {
      const sy = Math.min(H - 1, Math.max(0, y - r));
      for (let x = 0; x < Wp; x++) {
        const sx = Math.min(W - 1, Math.max(0, x - r)), s = (sy * W + sx) * 3, t = (y * Wp + x) * 3;
        pimg[t] = img[s]; pimg[t + 1] = img[s + 1]; pimg[t + 2] = img[s + 2];
      }
    }
    const src = [], tgt = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y + r) * Wp + x + r;
      if (hole[y * W + x]) phole[p] = 1;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r), y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      const s = I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
      if (s > 0) { isT[p] = 1; tgt.push(p); }
      else if (x >= r && x < W - r && y >= r && y < H - r) { srcOK[p] = 1; src.push(p); }
    }
    if (!src.length || !tgt.length) return null;
    const offs = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) offs.push(dy * Wp + dx);
    const K = offs.length;
    const dist = (p, q, bound) => {
      let s = 0;
      for (let k = 0; k < K; k++) {
        const a = (p + offs[k]) * 3, b = (q + offs[k]) * 3;
        const d0 = pimg[a] - pimg[b], d1 = pimg[a + 1] - pimg[b + 1], d2 = pimg[a + 2] - pimg[b + 2];
        s += (phole[p + offs[k]] ? 0.3 : 1) * (d0 * d0 + d1 * d1 + d2 * d2);
        if (s >= bound) return s;
      }
      return s;
    };
    const nnf = new Int32Array(NP), nd = new Float32Array(NP);
    const rnd = () => src[(Math.random() * src.length) | 0];
    for (const p of tgt) {
      let q = -1;
      if (nnfInit) {
        const x = p % Wp - r, y = ((p / Wp) | 0) - r;
        const cq = nnfInit[Math.min(Hc - 1, y >> 1) * Wc + Math.min(Wc - 1, x >> 1)];
        if (cq >= 0) {
          const qx = (cq % Wc) * 2 + (x & 1), qy = ((cq / Wc) | 0) * 2 + (y & 1);
          if (qx < W && qy < H) { const qq = (qy + r) * Wp + qx + r; if (srcOK[qq]) q = qq; }
        }
      }
      nnf[p] = q < 0 ? rnd() : q;
    }
    const maxR = Math.max(W, H), n = tgt.length;
    for (let e = 0; e < em; e++) {
      for (const p of tgt) nd[p] = dist(p, nnf[p], Infinity);
      for (let it = 0; it < pmIters; it++) {
        const fwd = it % 2 === 0, st = fwd ? 1 : -1;
        for (let ii = 0; ii < n; ii++) {
          const p = tgt[fwd ? ii : n - 1 - ii];
          let best = nnf[p], bd = nd[p];
          let nb = p - st;
          if (isT[nb]) { const q = nnf[nb] + st; if (q >= 0 && q < NP && srcOK[q] && q !== best) { const d = dist(p, q, bd); if (d < bd) { bd = d; best = q; } } }
          nb = p - st * Wp;
          if (isT[nb]) { const q = nnf[nb] + st * Wp; if (q >= 0 && q < NP && srcOK[q] && q !== best) { const d = dist(p, q, bd); if (d < bd) { bd = d; best = q; } } }
          const bx = best % Wp, by = (best / Wp) | 0;
          for (let rad = maxR; rad >= 1; rad >>= 1) {
            const qx = bx + Math.round((Math.random() * 2 - 1) * rad), qy = by + Math.round((Math.random() * 2 - 1) * rad);
            if (qx < 0 || qy < 0 || qx >= Wp || qy >= Hp) continue;
            const q = qy * Wp + qx;
            if (srcOK[q] && q !== best) { const d = dist(p, q, bd); if (d < bd) { bd = d; best = q; } }
          }
          nnf[p] = best; nd[p] = bd;
        }
      }
      let mean = 0; for (const p of tgt) mean += nd[p]; mean = mean / n + 1;
      const acc = new Float32Array(NP * 3), ws = new Float32Array(NP);
      for (const p of tgt) {
        const w = Math.exp(-nd[p] / (2 * mean)) + 1e-6, q = nnf[p];
        for (let k = 0; k < K; k++) {
          const t = p + offs[k]; if (!phole[t]) continue;
          const a = t * 3, b = (q + offs[k]) * 3;
          acc[a] += w * pimg[b]; acc[a + 1] += w * pimg[b + 1]; acc[a + 2] += w * pimg[b + 2]; ws[t] += w;
        }
      }
      for (const p of tgt) if (phole[p] && ws[p] > 0) { const a = p * 3; pimg[a] = acc[a] / ws[p]; pimg[a + 1] = acc[a + 1] / ws[p]; pimg[a + 2] = acc[a + 2] / ws[p]; }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) {
      const s = ((y + r) * Wp + x + r) * 3, t = (y * W + x) * 3;
      img[t] = pimg[s]; img[t + 1] = pimg[s + 1]; img[t + 2] = pimg[s + 2];
    }
    const out = new Int32Array(W * H).fill(-1);
    for (const p of tgt) { const q = nnf[p]; out[(((p / Wp) | 0) - r) * W + (p % Wp - r)] = (((q / Wp) | 0) - r) * W + (q % Wp - r); }
    return out;
  }
  function fillRegion(px, mask, W, H) {
    const N = W * H, img = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { img[i * 3] = px[i * 4]; img[i * 3 + 1] = px[i * 4 + 1]; img[i * 3 + 2] = px[i * 4 + 2]; }
    const levels = [{ img, hole: mask, W, H }];
    while (levels.length < 7) {
      const L = levels[levels.length - 1];
      if (Math.min(L.W, L.H) < 48) break;
      let hc = 0; for (let i = 0; i < L.hole.length; i++) hc += L.hole[i];
      if (hc < 64) break;
      const W2 = Math.ceil(L.W / 2), H2 = Math.ceil(L.H / 2);
      const img2 = new Float32Array(W2 * H2 * 3), hole2 = new Uint8Array(W2 * H2);
      for (let y2 = 0; y2 < H2; y2++) for (let x2 = 0; x2 < W2; x2++) {
        let s0 = 0, s1 = 0, s2 = 0, c = 0, h = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const x = 2 * x2 + dx, y = 2 * y2 + dy; if (x >= L.W || y >= L.H) continue;
          const i = y * L.W + x;
          if (L.hole[i]) h++; else { s0 += L.img[i * 3]; s1 += L.img[i * 3 + 1]; s2 += L.img[i * 3 + 2]; c++; }
        }
        const j = y2 * W2 + x2; hole2[j] = h >= 2 ? 1 : 0;
        if (c) { img2[j * 3] = s0 / c; img2[j * 3 + 1] = s1 / c; img2[j * 3 + 2] = s2 / c; }
      }
      levels.push({ img: img2, hole: hole2, W: W2, H: H2 });
    }
    let k = levels.length - 1, L = levels[k];
    diffuseFill(L.img, L.hole, L.W, L.H);
    let nnf = solveLevel(L.img, L.hole, L.W, L.H, null, 0, 0, 8, 6);
    for (k = levels.length - 2; k >= 0; k--) {
      const C = levels[k + 1], F = levels[k];
      for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
        const i = y * F.W + x; if (!F.hole[i]) continue;
        const ci = Math.min(C.H - 1, y >> 1) * C.W + Math.min(C.W - 1, x >> 1);
        F.img[i * 3] = C.img[ci * 3]; F.img[i * 3 + 1] = C.img[ci * 3 + 1]; F.img[i * 3 + 2] = C.img[ci * 3 + 2];
      }
      nnf = solveLevel(F.img, F.hole, F.W, F.H, nnf, C.W, C.H, k === 0 ? 3 : 5, k === 0 ? 3 : 4);
      if (!nnf) diffuseFill(F.img, F.hole, F.W, F.H);
    }
    for (let i = 0; i < N; i++) if (mask[i]) { px[i * 4] = img[i * 3]; px[i * 4 + 1] = img[i * 3 + 1]; px[i * 4 + 2] = img[i * 3 + 2]; }
  }
  return { fillRegion };
}
