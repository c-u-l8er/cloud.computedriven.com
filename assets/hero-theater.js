/* hero-theater.js — the world, rendered live in the site's own monospace.
 *
 * A sphere of ~1700 points is lit, rotated, and splatted onto a character
 * grid every frame — the same brightness-to-glyph mapping as this site's
 * static ASCII figures, running at 60fps. A small amber constellation rides
 * the surface: the wrl graph, carried along inside the world.
 *
 * Every few seconds — or when the visitor clicks — the world dissolves into
 * a stream and reassembles above the other machine's floor. The captions
 * under the floors tell the rest: the origin keeps "authority · held"; the
 * destination reads "restored", and only after a beat "granted · running".
 * State moves. Authority does not. The whole pitch is the loop.
 *
 * Zero dependencies. Canvas 2D, the page's own self-hosted font, and only
 * glyphs the font subset actually ships. Under prefers-reduced-motion the
 * world stands still, fully formed, and the captions still tell the story.
 * The renderer sleeps when the tab is hidden or the hero is scrolled away.
 */

const root = document.querySelector("[data-ht]");
if (root) init(root);

function init(root) {
  const canvas = root.querySelector(".ht-canvas");
  const ctx = canvas.getContext("2d");
  const capA = root.querySelector('[data-fl="a"] .ht-floor-cap');
  const capB = root.querySelector('[data-fl="b"] .ht-floor-cap');
  const floorA = root.querySelector('[data-fl="a"]');
  const floorB = root.querySelector('[data-fl="b"]');
  const lineA = floorA.querySelector(".ht-floor-line");
  const lineB = floorB.querySelector(".ht-floor-line");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // glyph ramp — every character verified present in the shipped woff2 subset
  const RAMP = " .,:;+*tf%8@";
  const CYAN = "45,226,230";
  const AMBER = "242,193,78";
  const DIM = "141,139,156";

  // ---- the world: a fibonacci sphere with a small amber constellation -----
  const N = 1700;
  const pts = [];
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = GOLD * i;
    pts.push({
      x: Math.cos(th) * r,
      y,
      z: Math.sin(th) * r,
      d: 0, // migration delay, assigned per flight
      wrl: false,
    });
  }
  // the wrl graph: a tight cluster of surface points, amber
  const seed = pts[420];
  for (const p of pts) {
    const dx = p.x - seed.x, dy = p.y - seed.y, dz = p.z - seed.z;
    if (dx * dx + dy * dy + dz * dz < 0.09) p.wrl = true;
  }

  // ---- stage geometry ------------------------------------------------------
  let W = 0, H = 0, DPR = 1, CELL = 13, R = 150;
  let ax = 0, bx = 0, cy = 0, floorY = 0; // anchor screen coords
  function layout() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = root.clientWidth;
    H = root.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CELL = W < 700 ? 11 : 13;
    ctx.font = `${CELL}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const narrow = W < 700;
    if (narrow) {
      R = Math.min(W * 0.26, 100);
      const copy = root.querySelector(".ht-copy");
      const r0m = root.getBoundingClientRect();
      const copyBottom = copy
        ? copy.getBoundingClientRect().bottom - r0m.top
        : H * 0.5;
      cy = Math.min(copyBottom + R + 30, H - R - 76);
      ax = W * 0.32;
      bx = Math.min(W * 0.72, W - R - 14);
    } else {
      // fit the journey to the space right of the headline:
      // h1Right + gap + R (sphere A) + >=2.3R travel + R (sphere B) + edge
      // clear the widest line of ink in the copy block, not the block box
      let inkRight = W * 0.45;
      const r0 = root.getBoundingClientRect();
      for (const el of root.querySelectorAll(".ht-copy h1, .ht-copy .lede, .ht-thesis")) {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        inkRight = Math.max(inkRight, rg.getBoundingClientRect().right - r0.left);
      }
      R = Math.min(H * 0.28, 170, (W - inkRight - 96) / 4.5);
      R = Math.max(R, 96);
      cy = H * 0.5;
      ax = inkRight + 40 + R;
      bx = W - 56 - R;
    }
    floorY = cy + R + 34;
    for (const [el, x] of [[floorA, ax], [floorB, bx]]) {
      el.style.left = `${x}px`;
      el.style.top = `${floorY}px`;
      // The floor is sized here, not left to shrink-to-fit. It used to be
      // auto-width with the line pulled left by -R*0.75, which centred nothing:
      // the line's preferred width became R*1.5 - R*0.75, so the box sized to
      // the CAPTION instead, translateX(-50%) shifted by half the caption, and
      // the negative margin then moved the line a further R*0.75 left. The
      // underline landed ~R/2 left of the world it was supposed to sit under.
      // One width, one centring mechanism: the box is the line's width, so
      // translateX(-50%) puts both line and caption on the anchor.
      el.style.width = `${R * 1.5}px`;
      const ln = el.querySelector(".ht-floor-line");
      ln.style.width = "100%";
      ln.style.marginLeft = "0";
    }
  }
  layout();
  addEventListener("resize", layout);

  // ---- migration state machine --------------------------------------------
  // at: 0 (floor A) or 1 (floor B). t: flight progress.
  const FLIGHT = 3000, SETTLE = 900;
  let at = 0, flying = false, t0 = 0, entryDone = false;
  let grantTimer = 0;

  function anchor(i) { return i === 0 ? ax : bx; }

  function caption(el, text, tone) {
    el.textContent = text;
    if (tone) el.setAttribute("data-tone", tone);
    else el.removeAttribute("data-tone");
  }

  function beginFlight(now) {
    if (flying) return;
    flying = true;
    t0 = now;
    // peel by longitude so the sphere unwinds into a stream
    for (const p of pts) {
      const lon = (Math.atan2(p.z, p.x) + Math.PI) / (2 * Math.PI);
      p.d = lon * 0.38 + Math.random() * 0.08;
    }
    const from = at === 0 ? capA : capB;
    const to = at === 0 ? capB : capA;
    caption(from, "authority \u00b7 held", "amber");
    caption(to, "", null);
    clearTimeout(grantTimer);
  }

  function endFlight() {
    flying = false;
    at = 1 - at;
    const here = at === 0 ? capA : capB;
    const line = at === 0 ? lineA : lineB;
    caption(here, "restored \u00b7 not granted", "dim");
    if (!reduced.matches) {
      line.animate(
        [
          { background: "rgba(45,226,230,0.9)", boxShadow: "0 0 12px rgba(45,226,230,0.6)" },
          { background: "rgba(141,139,156,0.55)", boxShadow: "none" },
        ],
        { duration: 900, easing: "ease-out" }
      );
    }
    grantTimer = setTimeout(() => {
      caption(here, "granted \u00b7 running", "amber");
      receiptDrift(at);
    }, reduced.matches ? 400 : 1400);
  }

  function receiptDrift(i) {
    if (reduced.matches) return;
    const s = document.createElement("span");
    s.className = "ht-receipt";
    const hx = new Uint8Array(2);
    crypto.getRandomValues(hx);
    s.textContent =
      "rcpt " + [...hx].map((x) => x.toString(16).padStart(2, "0")).join("") + "\u2026";
    s.style.left = `${anchor(i)}px`;
    s.style.top = `${cy - R - 18}px`;
    root.append(s);
    s.animate(
      [
        { transform: "translate(-50%, 0)", opacity: 0 },
        { transform: "translate(-50%, -12px)", opacity: 0.9, offset: 0.3 },
        { transform: "translate(-50%, -30px)", opacity: 0 },
      ],
      { duration: 2100, easing: "ease-out" }
    ).onfinish = () => s.remove();
  }

  // ---- pointer -------------------------------------------------------------
  let mx = -1e4, my = -1e4;
  root.addEventListener("pointermove", (e) => {
    const r = root.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
    root.style.setProperty("--hx", `${mx}px`);
    root.style.setProperty("--hy", `${my}px`);
  });
  root.addEventListener("pointerleave", () => {
    mx = my = -1e4;
    root.style.setProperty("--hx", "-20%");
    root.style.setProperty("--hy", "-20%");
  });
  canvas.style.cursor = "pointer";
  root.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    if (!flying && !reduced.matches) beginFlight(performance.now());
  });

  // ---- render loop ---------------------------------------------------------
  let running = true, raf = 0, last = 0, rot = 0, autoAt = 0;
  const io = new IntersectionObserver(([en]) => {
    running = en.isIntersecting;
    if (running && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(root);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && running && !raf) raf = requestAnimationFrame(frame);
  });

  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const cols = Math.ceil(2200 / 13), _grid = null;

  // light from upper-left-front
  const L = { x: -0.55, y: -0.6, z: 0.58 };
  const ln = Math.hypot(L.x, L.y, L.z);
  L.x /= ln; L.y /= ln; L.z /= ln;

  function frame(now) {
    raf = 0;
    if (!running || document.hidden) return;
    const dt = Math.min(50, now - (last || now));
    last = now;
    rot += dt * 0.00022;

    // entry: the world assembles on first sight
    if (!entryDone) {
      entryDone = true;
      if (!reduced.matches) {
        flying = true; t0 = now - FLIGHT * 0.25; at = 1; // fly from B side offscreen? no: assemble at A
        at = 1; // so endFlight lands on A
        for (const p of pts) p.d = Math.random() * 0.5;
      } else {
        caption(capA, "granted \u00b7 running", "amber");
        // "dim", not null: a cap with no data-tone is opacity 0, so a null tone
        // set the text and then hid it. The empty floor went unlabelled and the
        // reduced-motion page told half the story.
        caption(capB, "no world", "dim");
      }
    }

    // auto-migrate
    if (!flying && !reduced.matches) {
      autoAt += dt;
      if (autoAt > 8600) { autoAt = 0; beginFlight(now); }
    } else autoAt = 0;

    let ft = 0;
    if (flying) {
      ft = (now - t0) / FLIGHT;
      if (ft >= 1 + 0.2) { endFlight(); ft = 0; }
    }

    const sinR = Math.sin(rot), cosR = Math.cos(rot);
    const tilt = 0.35, sinT = Math.sin(tilt), cosT = Math.cos(tilt);
    const fromX = anchor(flying ? at : at);
    const toX = anchor(1 - at);
    const lift = -R * 0.9;

    // splat points into a sparse cell map
    const cellsCyan = new Map(); // key -> [x, y, bright]
    const cellsAmber = new Map();
    const half = CELL / 2;

    for (const p of pts) {
      // rotate
      let x = p.x * cosR + p.z * sinR;
      let z = -p.x * sinR + p.z * cosR;
      let y = p.y * cosT - z * sinT;
      z = p.y * sinT + z * cosT;

      // brightness: lambert + rim
      let b = Math.max(0, x * L.x + y * L.y + z * L.z);
      b = 0.12 + b * 0.88;
      if (z < -0.15) b *= 0.35; // far side fades

      // world position
      const breathe = 1 + 0.012 * Math.sin(now * 0.0012 + p.y * 3);
      b = Math.min(1, Math.max(0, b + 0.05 * Math.sin(now * 0.0031 + p.x * 9 + p.z * 7)));
      let px, py, alpha = 1;
      if (flying) {
        const u = Math.min(1, Math.max(0, (ft - p.d) / 0.56));
        const e = ease(u);
        const hx = fromX + (toX - fromX) * e;
        const hy = cy + Math.sin(Math.PI * e) * lift;
        px = hx + x * R;
        py = hy + y * R * 0.98;
        if (u > 0 && u < 1) {
          b = Math.min(1, b + 0.45); // comet glow in transit
          px += (Math.random() - 0.5) * 3;
          // ghost tail: a second, dimmer splat behind the direction of travel
          const sgn = toX > fromX ? 1 : -1;
          const tpx = px - sgn * (10 + 8 * Math.random());
          const tpy = py + (e < 0.5 ? 6 : -6);
          const tb = b * 0.5;
          const tcx = Math.round(tpx / CELL), tcy = Math.round(tpy / CELL);
          const tkey = tcx * 4096 + tcy;
          const tstore = p.wrl ? cellsAmber : cellsCyan;
          const tprev = tstore.get(tkey);
          if (!tprev || tprev[2] < tb) tstore.set(tkey, [tcx * CELL, tcy * CELL, tb, z]);
        }
        if (ft < p.d) { px = fromX + x * R; py = cy + y * R; }
        if (u >= 1) { px = toX + x * R; py = cy + y * R; }
      } else {
        px = anchor(at) + x * R * breathe;
        py = cy + y * R * breathe;
      }

      // cursor repulsion
      const dxm = px - mx, dym = py - my;
      const dm2 = dxm * dxm + dym * dym;
      if (dm2 < 8100) {
        const dm = Math.sqrt(dm2) || 1;
        const f = (1 - dm / 90) * 14;
        px += (dxm / dm) * f;
        py += (dym / dm) * f;
        b = Math.min(1, b + 0.15);
      }

      if (z < -0.55 && !flying) continue; // cull deep back except in stream
      const cxi = Math.round(px / CELL), cyi = Math.round(py / CELL);
      const key = cxi * 4096 + cyi;
      const store = p.wrl ? cellsAmber : cellsCyan;
      const prev = store.get(key);
      if (!prev || prev[2] < b) store.set(key, [cxi * CELL, cyi * CELL, b, z]);
    }

    // draw
    ctx.clearRect(0, 0, W, H);
    for (const [store, rgb] of [[cellsCyan, CYAN], [cellsAmber, AMBER]]) {
      // bucket by glyph+alpha to limit state changes
      for (const [, c] of store) {
        const b = c[2];
        const gi = Math.min(RAMP.length - 1, Math.floor(b * RAMP.length));
        const ch = RAMP[gi];
        if (ch === " ") continue;
        const a = 0.25 + b * 0.75;
        ctx.fillStyle = `rgba(${rgb},${a.toFixed(2)})`;
        ctx.fillText(ch, c[0], c[1]);
      }
    }

    raf = requestAnimationFrame(frame);
  }

  document.fonts?.ready.then(() => {
    layout();
    raf = requestAnimationFrame(frame);
  }) || (raf = requestAnimationFrame(frame));

  // captions at rest for the very first paint
  caption(capA, "granted \u00b7 running", "amber");
  caption(capB, "no world", "dim");

  // reduced motion: a single, fully formed frame
  if (reduced.matches) {
    // one draw pass happens via the loop, which then idles (no flights)
  }
}
