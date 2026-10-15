/* =========================================================
   Max Verstappen · Oracle Red Bull Racing
   Animação de frames controlada por scroll (canvas)
   ========================================================= */
(() => {
  "use strict";

  /* ---------- Configuração ---------- */
  const CONFIG = {
    path: "frameia-sequencia/", // pasta dos frames, relativa ao index.html
    prefix: "frame-",
    ext: ".webp",
    pad: 4,                      // frame-0001 → 4 dígitos
    first: 3,                    // frames 1–2 têm barra preta e outro enquadramento: ignorados
    last: 200,
    concurrency: 6,              // downloads simultâneos
    smoothing: 0.14,             // 0–1: quanto maior, mais rápido o frame alcança o scroll
    // Liga o progresso do scroll (0–1) ao frame, para cada capítulo cair na cena certa:
    // pit stop de frente (3–22) → saída lateral (23–108) → onboard (110–200).
    keyframes: [
      [0.00, 3],
      [0.18, 8],
      [0.40, 22],
      [0.62, 75],
      [0.82, 130],
      [1.00, 200],
    ],
    // Selo "F1 REPLAY" gravado nos frames (coordenadas na imagem original de 828×462).
    // É coberto por um remendo clonado da área vizinha, com bordas suaves.
    badge: { x: 0, y: 0, w: 192, h: 94, cloneGap: 4 },
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const TOTAL = CONFIG.last - CONFIG.first + 1;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const frameSrc = (n) => `${CONFIG.path}${CONFIG.prefix}${String(n).padStart(CONFIG.pad, "0")}${CONFIG.ext}`;

  document.documentElement.classList.remove("no-js");

  /* ---------- Elementos ---------- */
  const section = $("#sequencia");
  const sticky = $(".seq__sticky");
  const canvas = $("#seqCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const chapters = $$(".chapter").map((el) => ({
    el,
    start: parseFloat(el.dataset.start),
    end: parseFloat(el.dataset.end),
  }));
  const railButtons = $$("#rail button");
  const hudFrame = $("#hudFrame");
  const hudBar = $("#hudBar");
  const hudBuffer = $("#hudBuffer");
  const loader = $("#loader");
  const loaderPct = $("#loaderPct");
  const lights = $$(".loader__lights span");
  const nav = $("#nav");

  /* =========================================================
     1. PRÉ-CARREGAMENTO
     Ordem progressiva: primeiro frames espaçados (a animação já
     funciona inteira em baixa "resolução temporal"), depois os
     intermediários. O canvas sempre desenha o frame carregado
     mais próximo, então nunca há tela vazia.
     ========================================================= */
  const images = new Array(CONFIG.last + 1).fill(null);
  let loadedCount = 0;

  function buildOrder() {
    if (reduceMotion.matches) {
      // Movimento reduzido: só os quadros-chave de cada capítulo.
      return [...new Set([CONFIG.first, ...chapters.map(keyFrameOf)])];
    }
    const order = [CONFIG.first];
    const seen = new Set(order);
    for (const step of [32, 16, 8, 4, 2, 1]) {
      for (let n = CONFIG.first; n <= CONFIG.last; n += step) {
        if (!seen.has(n)) { seen.add(n); order.push(n); }
      }
      if (!seen.has(CONFIG.last)) { seen.add(CONFIG.last); order.push(CONFIG.last); }
    }
    return order;
  }

  function loadFrame(n) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.src = frameSrc(n);
      const done = () => { images[n] = img; loadedCount++; resolve(true); };
      if (img.decode) img.decode().then(done, () => (img.complete && img.naturalWidth ? done() : resolve(false)));
      else { img.onload = done; img.onerror = () => resolve(false); }
    });
  }

  async function preload(order, essentialCount, onEssential) {
    let next = 0;
    let essentialDone = 0;
    let fired = false;
    const worker = async () => {
      while (next < order.length) {
        const i = next++;
        await loadFrame(order[i]);
        if (i < essentialCount) essentialDone++;
        const pct = essentialDone / essentialCount;
        updateLoader(pct);
        updateBuffer();
        if (!fired && essentialDone >= essentialCount) { fired = true; onEssential(); }
        needsDraw = true;
      }
    };
    await Promise.all(Array.from({ length: CONFIG.concurrency }, worker));
    if (!fired) onEssential(); // garante a saída do loader mesmo com falhas
  }

  function nearestLoaded(n) {
    if (images[n]) return n;
    for (let d = 1; d <= TOTAL; d++) {
      if (n - d >= CONFIG.first && images[n - d]) return n - d;
      if (n + d <= CONFIG.last && images[n + d]) return n + d;
    }
    return -1;
  }

  /* ---------- Loader: luzes de largada ---------- */
  let shownPct = 0;
  function updateLoader(pct) {
    shownPct = Math.max(shownPct, pct);
    loaderPct.textContent = String(Math.round(shownPct * 100)).padStart(2, "0");
    lights.forEach((l, i) => l.classList.toggle("on", shownPct >= (i + 1) / lights.length - 0.001));
  }

  function updateBuffer() {
    const pct = Math.round((loadedCount / buildOrderLength) * 100);
    hudBuffer.textContent = `BUF ${String(pct).padStart(3, "0")}%`;
    hudBuffer.classList.toggle("is-full", pct >= 100);
  }

  function hideLoader() {
    updateLoader(1);
    const out = () => {
      loader.classList.add("is-out"); // "lights out and away we go"
      setTimeout(() => {
        loader.classList.add("is-done");
        document.body.classList.remove("is-loading");
      }, reduceMotion.matches ? 0 : 350);
    };
    setTimeout(out, reduceMotion.matches ? 0 : 650);
  }

  /* =========================================================
     2. CANVAS RESPONSIVO
     ========================================================= */
  let cssW = 0, cssH = 0, dpr = 1;
  let needsDraw = true;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = sticky.clientWidth;
    cssH = sticky.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    needsDraw = true;
  }
  new ResizeObserver(resize).observe(sticky);
  resize();

  // Cálculo de "cover": preenche a tela inteira mantendo a proporção 16:9 do vídeo,
  // cortando apenas o excedente (nunca distorce, nunca mostra bordas).
  function coverRect(iw, ih) {
    const cw = canvas.width, ch = canvas.height;
    const s = Math.max(cw / iw, ch / ih) * 1.015; // leve overscan para esconder artefatos de borda
    const w = iw * s, h = ih * s;
    // No celular em pé, o foco fica um pouco à esquerda do centro (onde está o carro/cockpit)
    const fx = cw < ch ? 0.47 : 0.5;
    return { x: (cw - w) * fx, y: (ch - h) * 0.5, s };
  }

  // Remendo para o selo do canto: clone da área vizinha + máscara com bordas suaves.
  // O selo encosta nas bordas superior e esquerda do vídeo, então só as bordas
  // direita e inferior do remendo precisam de degradê.
  const B = CONFIG.badge;
  const patch = document.createElement("canvas");
  patch.width = B.w; patch.height = B.h;
  const pctx = patch.getContext("2d");
  const mask = document.createElement("canvas");
  mask.width = B.w; mask.height = B.h;
  (() => {
    const m = mask.getContext("2d");
    const gx = m.createLinearGradient(0, 0, B.w, 0);
    gx.addColorStop(0, "#000"); gx.addColorStop(0.8, "#000"); gx.addColorStop(1, "rgba(0,0,0,0)");
    m.fillStyle = gx; m.fillRect(0, 0, B.w, B.h);
    m.globalCompositeOperation = "destination-in";
    const gy = m.createLinearGradient(0, 0, 0, B.h);
    gy.addColorStop(0, "#000"); gy.addColorStop(0.74, "#000"); gy.addColorStop(1, "rgba(0,0,0,0)");
    m.fillStyle = gy; m.fillRect(0, 0, B.w, B.h);
  })();

  function drawBadgePatch(img, r) {
    pctx.globalCompositeOperation = "source-over";
    pctx.clearRect(0, 0, B.w, B.h);
    // Clona a faixa logo à direita do selo (mesma iluminação e mesmo borrão de movimento)
    pctx.drawImage(img, B.x + B.w + B.cloneGap, B.y, B.w, B.h, 0, 0, B.w, B.h);
    pctx.globalCompositeOperation = "destination-in";
    pctx.drawImage(mask, 0, 0);
    ctx.drawImage(patch, r.x + B.x * r.s, r.y + B.y * r.s, B.w * r.s, B.h * r.s);
  }

  let drawnPos = -1;
  function draw(pos) {
    const a = Math.floor(pos);
    const frac = pos - a;
    const ia = nearestLoaded(a);
    if (ia < 0) return;
    const imgA = images[ia];
    const r = coverRect(imgA.naturalWidth, imgA.naturalHeight);
    const w = imgA.naturalWidth * r.s, h = imgA.naturalHeight * r.s;

    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgA, r.x, r.y, w, h);

    // Mistura com o próximo frame para uma transição sem degraus
    const b = a + 1;
    if (frac > 0.02 && b <= CONFIG.last && images[b] && ia === a) {
      ctx.globalAlpha = frac;
      ctx.drawImage(images[b], r.x, r.y, w, h);
      ctx.globalAlpha = 1;
    }
    drawBadgePatch(frac > 0.5 && images[b] ? images[b] : imgA, r);
    drawnPos = pos;
    needsDraw = false;
  }

  /* =========================================================
     3. SCROLL → FRAME
     ========================================================= */
  function frameAt(p) {
    const k = CONFIG.keyframes;
    for (let i = 1; i < k.length; i++) {
      if (p <= k[i][0]) {
        const t = (p - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t;
      }
    }
    return k[k.length - 1][1];
  }

  // Quadro fixo que representa cada capítulo (usado com movimento reduzido)
  const keyFrameOf = (c) => Math.round(frameAt((c.start + Math.min(c.end, 1)) / 2));

  function progress() {
    const rect = section.getBoundingClientRect();
    const scrollable = rect.height - sticky.clientHeight;
    return scrollable > 0 ? clamp(-rect.top / scrollable) : 0;
  }

  function chapterIndex(p) {
    let idx = 0;
    chapters.forEach((c, i) => { if (p >= c.start - 0.02) idx = i; });
    return idx;
  }

  let lastP = -1;
  function updateChapters(p) {
    const reduced = reduceMotion.matches;
    const active = chapterIndex(p);
    chapters.forEach((c, i) => {
      let vis, y;
      if (reduced) {
        vis = i === active ? 1 : 0;
        y = 0;
      } else {
        const fade = 0.035;
        const inn = i === 0 ? 1 : smoothstep(c.start, c.start + fade, p);
        const out = c.end >= 1 ? 1 : 1 - smoothstep(c.end - fade, c.end, p);
        vis = Math.min(inn, out);
        y = (1 - inn) * 40 - (1 - out) * 30;
      }
      c.el.style.opacity = vis.toFixed(3);
      c.el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      c.el.classList.toggle("is-visible", vis > 0.01);
      c.el.setAttribute("aria-hidden", vis > 0.5 ? "false" : "true");
    });
    railButtons.forEach((btn, i) => btn.classList.toggle("is-active", i === active));
  }

  let current = CONFIG.first;
  let lastTime = performance.now();

  function tick(now) {
    const dt = Math.min(64, now - lastTime);
    lastTime = now;
    const p = progress();

    let target;
    if (reduceMotion.matches) {
      target = keyFrameOf(chapters[chapterIndex(p)]);
      current = target; // sem interpolação
    } else {
      target = frameAt(p);
      const k = 1 - Math.pow(1 - CONFIG.smoothing, dt / 16.67);
      current += (target - current) * k;
      if (Math.abs(target - current) < 0.002) current = target;
    }

    if (needsDraw || Math.abs(current - drawnPos) > 0.004) draw(current);

    if (p !== lastP) {
      updateChapters(p);
      hudBar.style.transform = `scaleX(${p.toFixed(4)})`;
      lastP = p;
    }
    hudFrame.textContent = String(Math.round(current)).padStart(3, "0");

    requestAnimationFrame(tick);
  }

  // Botões do trilho: rolam até o capítulo
  railButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = parseFloat(btn.dataset.go);
      const top = section.offsetTop + p * (section.offsetHeight - sticky.clientHeight);
      window.scrollTo({ top, behavior: reduceMotion.matches ? "auto" : "smooth" });
    });
  });

  /* =========================================================
     4. RESTO DA PÁGINA
     ========================================================= */
  // Nav: fica sólida depois da sequência
  const onScroll = () => {
    const pastSeq = window.scrollY > section.offsetTop + section.offsetHeight - window.innerHeight * 0.6;
    nav.classList.toggle("is-solid", pastSeq);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Menu mobile
  const toggle = $("#navToggle");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    $(".sr", toggle).textContent = open ? "Fechar menu" : "Abrir menu";
  });
  $$("#navLinks a").forEach((a) => a.addEventListener("click", () => {
    toggle.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
  }));

  // Revelação ao entrar na tela + contadores
  const countUp = (el) => {
    const end = parseInt(el.dataset.count, 10);
    if (reduceMotion.matches || !end) { el.textContent = end; return; }
    const dur = 1400;
    const t0 = performance.now();
    const step = (t) => {
      const k = clamp((t - t0) / dur);
      el.textContent = Math.round(end * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = "0";
    requestAnimationFrame(step);
  };

  // Atraso escalonado para itens irmãos
  $$(".stats, .timeline, .team-grid").forEach((list) => {
    $$(".reveal", list).forEach((el, i) => el.style.setProperty("--d", `${i * 0.08}s`));
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("is-in");
      const num = $("[data-count]", e.target);
      if (num) countUp(num);
      io.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.1 });
  $$(".reveal").forEach((el) => io.observe(el));

  /* =========================================================
     5. INÍCIO
     ========================================================= */
  const order = buildOrder();
  const buildOrderLength = order.length;
  // Essenciais: frames de 16 em 16 (~14 imagens) antes de liberar a página; o resto carrega em segundo plano
  const firstFine = order.findIndex((n) => (n - CONFIG.first) % 16 !== 0 && n !== CONFIG.last);
  const essentialCount = reduceMotion.matches || firstFine < 0 ? order.length : firstFine;

  document.body.classList.add("is-loading");
  updateLoader(0);
  requestAnimationFrame(tick);
  preload(order, essentialCount, hideLoader);

  // Se a preferência de movimento mudar com a página aberta, redesenha
  reduceMotion.addEventListener?.("change", () => { needsDraw = true; lastP = -1; });
})();
