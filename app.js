(function () {
  "use strict";

  const A = window.COVER_ASSETS;
  const SLOTS = window.COVER_SLOTS;
  const RATIO = A.ratioH / A.ratioW;

  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const slots = SLOTS.map((s, i) => ({
    i, name: s.name, group: s.group, poly: s.poly,
    defaultOx: s.defaultOx || 0,
    defaultZoom: s.defaultZoom || 1,
    img: null, url: null,
    zoom: s.defaultZoom || 1,
    ox: s.defaultOx || 0,
    oy: 0,
    rot: 0,
    flip: false
  }));

  let baseImg = null;
  let maskImg = null;
  let logoImg = null;
  let selected = 0;
  let swapSource = null;
  let hover = -1;
  let uploadTarget = 0;
  let drag = null;
  let queued = false;
  let toastTimer = null;
  let overlayCache = { key: "", canvas: null };

  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function syncRangeProgress(el) {
    if (!CSS.supports("accent-color", "auto")) {
      const min = parseFloat(el.min || "0");
      const max = parseFloat(el.max || "100");
      const val = parseFloat(el.value || "0");
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      el.style.setProperty("--progress", `${pct}%`);
    }
  }

  // ---------- geometry ----------
  function px(poly, W, H) { return poly.map(([x, y]) => [x * W, y * H]); }
  function bbox(pts) {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return { x: a, y: b, w: c - a, h: d - b, cx: (a + c) / 2, cy: (b + d) / 2 };
  }
  function inside(x, y, pts) {
    let r = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) r = !r;
    }
    return r;
  }
  function path(c, pts) {
    c.beginPath();
    pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  }

  // ---------- render ----------
  function overlayCanvas(W, H) {
    const key = `${W}x${H}:${baseImg.src.length}`;
    if (overlayCache.key === key) return overlayCache.canvas;
    const o = document.createElement("canvas");
    o.width = W; o.height = H;
    const c = o.getContext("2d");
    c.drawImage(baseImg, 0, 0, W, H);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(maskImg, 0, 0, W, H);
    overlayCache = { key, canvas: o };
    return o;
  }

  const DEFAULT_TEXTS = {
    header: "ROCKSTAR GAMES PRESENTS A ROCKSTAR NORTH PRODUCTION",
    synopsis:
      "When a young street hustler, a retired bank robber and a terrifying psychopath find themselves entangled with some of the most frightening and deranged elements of the criminal underworld, the U.S. government and the entertainment industry, they must pull off a series of dangerous heists to survive in a ruthless city in which they can trust nobody, least of all each other.",
    features:
      "Features across-the-board graphical and technical enhancements for a deeper, more vibrant world.\nTransfer your existing Grand Theft Auto Online characters and progression to PlayStation®4.*\nReturning players get exclusive vehicles, weapons, collectibles and more.**\nIncludes all Grand Theft Auto Online and Grand Theft Auto V free-to-access content updates."
  };

  function wrapLines(c, text, maxW) {
    const out = [];
    for (const para of (text || "").replace(/\r/g, "").split("\n")) {
      const words = para.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (c.measureText(test).width <= maxW) {
          line = test;
        } else {
          if (line) out.push(line);
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  function renderFittedBlock(c, text, x, y, maxW, maxH, maxFontPx, minFontPx, align, color) {
    let fontSize = maxFontPx;
    let lines = [];
    while (fontSize >= minFontPx) {
      c.font = `400 ${fontSize}px system-ui, "Segoe UI", sans-serif`;
      lines = wrapLines(c, text, maxW);
      if (lines.length * fontSize * 1.24 <= maxH) break;
      fontSize -= Math.max(0.6, maxFontPx * 0.06);
    }
    const lineH = fontSize * 1.24;
    const totalH = lines.length * lineH;
    const startY = y + Math.max(0, (maxH - totalH) * 0.35);
    c.save();
    c.font = `400 ${fontSize}px system-ui, "Segoe UI", sans-serif`;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "top";
    lines.forEach((ln, idx) => {
      const py = startY + idx * lineH;
      if (py + fontSize <= y + maxH + 2) {
        c.fillText(ln, align === "center" ? x + maxW / 2 : x, py, maxW);
      }
    });
    c.restore();
  }

  function renderBackTopTexts(c, W, H) {
    const sx = W / 1024;
    const sy = H / 603;

    const headerVal = $("backHeader").value.trim();
    if (headerVal !== DEFAULT_TEXTS.header) {
      c.fillStyle = "#000000";
      c.fillRect(12 * sx, 4 * sy, 460 * sx, 17 * sy);
      if (headerVal) {
        c.save();
        c.fillStyle = "#e8eaed";
        c.font = `600 ${Math.round(11 * sx)}px system-ui, "Segoe UI", sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(headerVal.toUpperCase(), 242 * sx, 12.5 * sy, 444 * sx);
        c.restore();
      }
    }

    const synVal = $("backSynopsis").value.trim();
    if (synVal !== DEFAULT_TEXTS.synopsis) {
      c.fillStyle = "#000000";
      c.fillRect(228 * sx, 21 * sy, 247 * sx, 128 * sy);
      if (synVal) {
        renderFittedBlock(
          c,
          synVal,
          231 * sx,
          24 * sy,
          237 * sx,
          121 * sy,
          11.8 * sx,
          7.4 * sx,
          "left",
          "#e6e8ec"
        );
      }
    }

    const featVal = $("backFeatures").value.trim();
    if (featVal !== DEFAULT_TEXTS.features) {
      c.fillStyle = "#000000";
      c.fillRect(8 * sx, 239 * sy, 468 * sx, 53 * sy);
      if (featVal) {
        renderFittedBlock(
          c,
          featVal,
          14 * sx,
          241 * sy,
          456 * sx,
          49 * sy,
          10.4 * sx,
          6.8 * sx,
          "center",
          "#f0f2f5"
        );
      }
    }
  }

  function render(c, W, H, preview) {
    c.clearRect(0, 0, W, H);
    c.drawImage(baseImg, 0, 0, W, H);

    for (const s of slots) {
      if (!s.img) continue;
      const pts = px(s.poly, W, H);
      const bb = bbox(pts);
      const iw = s.img.naturalWidth || s.img.width;
      const ih = s.img.naturalHeight || s.img.height;
      const k = Math.max(bb.w / iw, bb.h / ih) * s.zoom;
      c.save();
      path(c, pts);
      c.clip();
      c.translate(bb.cx + s.ox * bb.w, bb.cy + s.oy * bb.h);
      c.rotate((s.rot * Math.PI) / 180);
      if (s.flip) c.scale(-1, 1);
      c.drawImage(s.img, (-iw * k) / 2, (-ih * k) / 2, iw * k, ih * k);
      c.restore();
    }

    renderBackTopTexts(c, W, H);

    if (preview) {
      const lw = Math.max(2, W / 700);
      if ($("showOutlines").checked) {
        c.save();
        c.lineWidth = lw;
        c.strokeStyle = "rgba(74,222,128,.55)";
        c.setLineDash([lw * 4, lw * 3]);
        for (const s of slots) { path(c, px(s.poly, W, H)); c.stroke(); }
        c.restore();
      }
      const cur = hover >= 0 ? hover : selected;
      c.save();
      c.lineWidth = lw * 1.6;
      c.strokeStyle = swapSource !== null ? "#f7a800" : "#4ade80";
      path(c, px(slots[cur].poly, W, H));
      c.stroke();
      c.restore();
    }

    // Corner badges (ESRB + R★) and crisp official GTA V logo PNG on top of everything
    c.drawImage(overlayCanvas(W, H), 0, 0);
    if (logoImg && A.logoBox) {
      c.drawImage(logoImg, A.logoBox.x * W, A.logoBox.y * H, A.logoBox.w * W, A.logoBox.h * H);
    }
  }

  function draw() {
    queued = false;
    render(ctx, cv.width, cv.height, true);
  }
  function redraw() {
    if (queued || !baseImg) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  // ---------- UI ----------
  function buildList() {
    const box = $("slotList");
    box.innerHTML = "";
    slots.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot" + (s.i === selected ? " on" : "");
      const label = s.name.replace("Portada · ", "P: ").replace("Contraportada · ", "C: ");
      b.innerHTML = `<span></span><small>${s.img ? "●" : ""}</small>`;
      b.firstChild.textContent = label;
      b.addEventListener("click", () => select(s.i));
      box.appendChild(b);
    });
  }

  function syncPanel() {
    const s = slots[selected];
    $("selTitle").textContent = s.name;
    $("zoom").value = s.zoom;
    $("zoomOut").textContent = s.zoom.toFixed(2) + "×";
    $("rot").value = s.rot;
    $("rotOut").textContent = s.rot + "°";
    ["zoom", "rot", "flipBtn", "centerBtn", "swapBtn", "removeBtn"].forEach((id) => { $(id).disabled = !s.img; });
    $("swapBanner").hidden = swapSource === null;
    syncRangeProgress($("zoom"));
    syncRangeProgress($("rot"));
    buildList();
  }

  function swapSlots(aIdx, bIdx) {
    const a = slots[aIdx], b = slots[bIdx];
    const tmpImg = a.img, tmpUrl = a.url;
    a.img = b.img; a.url = b.url;
    b.img = tmpImg; b.url = tmpUrl;
    a.ox = a.defaultOx; a.oy = 0; a.zoom = a.defaultZoom; a.rot = 0; a.flip = false;
    b.ox = b.defaultOx; b.oy = 0; b.zoom = b.defaultZoom; b.rot = 0; b.flip = false;
    toast("Fotos intercambiadas");
  }

  function select(i) {
    if (swapSource !== null && swapSource !== i) {
      swapSlots(swapSource, i);
      swapSource = null;
    }
    selected = i;
    syncPanel();
    redraw();
  }

  function resetSlotState(s) {
    if (s.url) URL.revokeObjectURL(s.url);
    Object.assign(s, { img: null, url: null, zoom: s.defaultZoom, ox: s.defaultOx, oy: 0, rot: 0, flip: false });
  }

  function setImage(i, file) {
    if (!file || !file.type.startsWith("image/")) { toast("Elige un archivo de imagen"); return; }
    const url = URL.createObjectURL(file);
    loadImg(url).then((im) => {
      const s = slots[i];
      if (s.url) URL.revokeObjectURL(s.url);
      Object.assign(s, { img: im, url, zoom: s.defaultZoom, ox: s.defaultOx, oy: 0, rot: 0, flip: false });
      selected = i;
      syncPanel();
      redraw();
    }).catch(() => { URL.revokeObjectURL(url); toast("No se pudo cargar la imagen"); });
  }

  function fillMany(files, start) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    let order = slots.map((s) => s.i);
    if (typeof start === "number") {
      order = order.slice(start).concat(order.slice(0, start));
    } else {
      order = order.filter((i) => !slots[i].img).concat(order.filter((i) => slots[i].img));
    }
    list.slice(0, slots.length).forEach((f, n) => setImage(order[n], f));
    toast(`${Math.min(list.length, slots.length)} foto(s) colocadas`);
  }

  function pick(i) {
    uploadTarget = i;
    $("fileOne").value = "";
    $("fileOne").click();
  }

  // ---------- pointer ----------
  function pos(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
  }
  function hit(p) {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (inside(p.x, p.y, px(slots[i].poly, cv.width, cv.height))) return i;
    }
    return -1;
  }

  cv.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = pos(e);
    const i = hit(p);
    if (i < 0) return;
    cv.setPointerCapture(e.pointerId);
    const s = slots[i];
    drag = { id: e.pointerId, i, x: p.x, y: p.y, ox: s.ox, oy: s.oy, moved: false };
  });
  cv.addEventListener("pointermove", (e) => {
    const p = pos(e);
    if (drag && drag.id === e.pointerId) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      const s = slots[drag.i];
      if (drag.moved && s.img) {
        const bb = bbox(px(s.poly, cv.width, cv.height));
        s.ox = drag.ox + dx / bb.w;
        s.oy = drag.oy + dy / bb.h;
        redraw();
      }
      return;
    }
    const h = hit(p);
    if (h !== hover) { hover = h; redraw(); }
  });
  function up(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      const had = !!slots[d.i].img;
      select(d.i);
      if (!had && swapSource === null) pick(d.i);
    }
  }
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("pointerleave", () => { if (!drag) { hover = -1; redraw(); } });
  cv.addEventListener("dblclick", (e) => { const i = hit(pos(e)); if (i >= 0) { select(i); pick(i); } });
  cv.addEventListener("wheel", (e) => {
    const i = hit(pos(e));
    if (i < 0 || !slots[i].img) return;
    e.preventDefault();
    const s = slots[i];
    s.zoom = Math.min(4, Math.max(0.5, +(s.zoom + (e.deltaY < 0 ? 0.06 : -0.06)).toFixed(2)));
    if (i === selected) syncPanel();
    redraw();
  }, { passive: false });

  const frame = cv.parentElement;
  frame.addEventListener("dragover", (e) => {
    e.preventDefault();
    const h = hit(pos(e));
    if (h !== hover) { hover = h; redraw(); }
  });
  frame.addEventListener("drop", (e) => {
    e.preventDefault();
    const h = hit(pos(e));
    hover = -1;
    if (e.dataTransfer.files.length) fillMany(e.dataTransfer.files, h >= 0 ? h : selected);
  });

  // ---------- controls ----------
  $("uploadBtn").addEventListener("click", () => pick(selected));
  $("multiBtn").addEventListener("click", () => { $("fileMany").value = ""; $("fileMany").click(); });
  $("fileOne").addEventListener("change", (e) => { if (e.target.files[0]) setImage(uploadTarget, e.target.files[0]); });
  $("fileMany").addEventListener("change", (e) => fillMany(e.target.files));

  $("zoom").addEventListener("input", (e) => {
    const s = slots[selected]; s.zoom = +e.target.value; $("zoomOut").textContent = s.zoom.toFixed(2) + "×";
    syncRangeProgress(e.target); redraw();
  });
  $("rot").addEventListener("input", (e) => {
    const s = slots[selected]; s.rot = +e.target.value; $("rotOut").textContent = s.rot + "°";
    syncRangeProgress(e.target); redraw();
  });
  $("flipBtn").addEventListener("click", () => { slots[selected].flip = !slots[selected].flip; redraw(); });
  $("centerBtn").addEventListener("click", () => {
    const s = slots[selected];
    Object.assign(s, { zoom: s.defaultZoom, ox: s.defaultOx, oy: 0, rot: 0, flip: false });
    syncPanel(); redraw();
  });
  $("swapBtn").addEventListener("click", () => {
    if (!slots[selected].img) return;
    swapSource = selected;
    syncPanel(); redraw();
  });
  $("cancelSwapBtn").addEventListener("click", () => {
    swapSource = null;
    syncPanel(); redraw();
  });
  $("removeBtn").addEventListener("click", () => {
    resetSlotState(slots[selected]);
    syncPanel(); redraw();
  });

  const resetDialog = $("resetDialog");
  $("resetBtn").addEventListener("click", () => {
    if (!slots.some((s) => s.img)) { toast("No hay fotos que quitar"); return; }
    resetDialog.showModal();
  });
  $("closeResetBtn").addEventListener("click", () => resetDialog.close());
  $("cancelResetBtn").addEventListener("click", () => resetDialog.close());
  $("confirmResetBtn").addEventListener("click", () => {
    slots.forEach(resetSlotState);
    swapSource = null;
    resetDialog.close();
    syncPanel(); redraw();
    toast("Fotos eliminadas");
  });
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    resetDialog.addEventListener("click", (event) => {
      if (event.target !== resetDialog) return;
      const rect = resetDialog.getBoundingClientRect();
      const insideDlg = rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
                        rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
      if (!insideDlg) resetDialog.close();
    });
  }

  $("showOutlines").addEventListener("change", redraw);

  ["backHeader", "backSynopsis", "backFeatures"].forEach((id) => {
    $(id).addEventListener("input", redraw);
  });
  $("resetTextsBtn").addEventListener("click", () => {
    $("backHeader").value = DEFAULT_TEXTS.header;
    $("backSynopsis").value = DEFAULT_TEXTS.synopsis;
    $("backFeatures").value = DEFAULT_TEXTS.features;
    redraw();
    toast("Textos originales restaurados");
  });

  $("downloadBtn").addEventListener("click", () => {
    const W = +$("exportWidth").value;
    const H = Math.round(W * RATIO);
    const o = document.createElement("canvas");
    o.width = W; o.height = H;
    render(o.getContext("2d"), W, H, false);
    o.toBlob((blob) => {
      if (!blob) { toast("No se pudo generar la imagen"); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "caratula-gtav-ps4.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast(`Descargada caratula-gtav-ps4.png (${W}×${H})`);
    }, "image/png");
  });

  // ---------- init ----------
  cv.width = 2048;
  cv.height = Math.round(2048 * RATIO);
  Promise.all([loadImg(A.base), loadImg(A.mask), loadImg(A.logo)]).then(([b, m, l]) => {
    baseImg = b;
    maskImg = m;
    logoImg = l;
    syncPanel();
    redraw();
  });
})();
