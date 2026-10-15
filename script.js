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
    first: 1,
    last: 199,
    aspect: 3832 / 2126,         // proporção dos quadros (4K sem as bordas pretas)
    // Resoluções disponíveis, uma subpasta cada (frameia-sequencia/720/frame-0001.webp …)
    tiers: [
      { dir: "720", label: "720p", width: 1280 },
      { dir: "1080", label: "1080p", width: 1920 },
      { dir: "4k", label: "4K", width: 3832 },
    ],
    mobileMaxTier: "1080",       // celulares não baixam o pacote 4K
    decodeWindow: { "1080": 12, "4k": 6 }, // quadros nítidos mantidos decodificados ao redor da posição
    concurrency: 6,              // downloads simultâneos
    smoothing: 0.14,             // 0–1: quanto maior, mais rápido o frame alcança o scroll
    // Liga o progresso do scroll (0–1) ao frame, para cada capítulo cair na cena certa:
    // pit stop de frente (1–30) → saída lateral (31–55) → onboard lateral (56–100) → T-cam (101–199).
    keyframes: [
      [0.00, 1],
      [0.18, 6],
      [0.40, 30],
      [0.62, 92],
      [0.82, 150],
      [1.00, 199],
    ],
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
  const frameSrc = (dir, n) =>
    `${CONFIG.path}${dir}/${CONFIG.prefix}${String(n).padStart(CONFIG.pad, "0")}${CONFIG.ext}`;

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
     1. CANVAS RESPONSIVO + ESCOLHA DE RESOLUÇÃO
     ========================================================= */
  let dpr = 1;
  let needsDraw = true;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(sticky.clientWidth * dpr);
    canvas.height = Math.round(sticky.clientHeight * dpr);
    needsDraw = true;
    const t = pickTier();
    // Só sobe de resolução (nunca descarta o que já baixou ao diminuir a janela)
    if (!mainTier || CONFIG.tiers.indexOf(t) > CONFIG.tiers.indexOf(mainTier)) setMainTier(t);
  }

  // Largura em pixels reais que o quadro ocupa no modo "cover"
  const neededWidth = () => Math.max(canvas.width, canvas.height * CONFIG.aspect);

  function pickTier() {
    const byDir = (d) => CONFIG.tiers.find((t) => t.dir === d);
    const forced = byDir(new URLSearchParams(location.search).get("q")); // ?q=4k | 1080 | 720
    if (forced) return forced;
    if (navigator.connection && navigator.connection.saveData) return CONFIG.tiers[0];
    const small = Math.min(window.innerWidth, window.innerHeight) < 820;
    const cap = small ? CONFIG.tiers.indexOf(byDir(CONFIG.mobileMaxTier)) : CONFIG.tiers.length - 1;
    const need = neededWidth() * 0.9; // aceita até ~10% de ampliação
    for (let i = 0; i <= cap; i++) if (CONFIG.tiers[i].width >= need) return CONFIG.tiers[i];
    return CONFIG.tiers[cap];
  }

  // Cálculo de "cover": preenche a tela inteira mantendo a proporção do vídeo,
  // cortando apenas o excedente (nunca distorce, nunca mostra bordas).
  function coverRect() {
    const cw = canvas.width, ch = canvas.height;
    const w = Math.max(cw, ch * CONFIG.aspect) * 1.004;
    const h = w / CONFIG.aspect;
    // No celular em pé, o foco fica um pouco à esquerda do centro (onde está o carro/cockpit)
    const fx = cw < ch ? 0.47 : 0.5;
    return { x: (cw - w) * fx, y: (ch - h) * 0.5, w, h };
  }

  /* =========================================================
     2. CARREGAMENTO EM CAMADAS
     • Base (720p): <img> leves para todos os quadros. Abre a página
       rápido e serve de reserva durante rolagens rápidas.
     • Principal (1080p ou 4K): baixada compactada (Blob). Só uma
       janela de quadros ao redor da posição atual é decodificada
       (ImageBitmap) e o resto é liberado. Assim o 4K fica nítido
       sem ocupar gigabytes de memória.
     ========================================================= */
  const BASE = CONFIG.tiers[0];
  const base = new Array(CONFIG.last + 1).fill(null);   // HTMLImageElement
  let mainTier = null;
  let blobs = [];                                       // Blob por quadro (camada principal)
  const bitmaps = new Map();                            // n → ImageBitmap decodificado
  const decoding = new Set();
  let baseLoaded = 0, mainLoaded = 0, mainTotal = 0;
  let mainToken = 0;
  let current = CONFIG.first;

  let releaseStart;
  const started = new Promise((r) => (releaseStart = r));

  function progressiveOrder(only) {
    if (only) return only;
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

  // Executa as tarefas com N em paralelo
  async function pool(items, worker, n = CONFIG.concurrency) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < items.length) { const k = i++; await worker(items[k], k); }
    }));
  }

  function loadBase(n) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.src = frameSrc(BASE.dir, n);
      const done = () => { base[n] = img; baseLoaded++; needsDraw = true; resolve(); };
      img.decode().then(done, () => (img.naturalWidth ? done() : resolve()));
    });
  }

  const keyFrames = () => [...new Set([CONFIG.first, ...chapters.map(keyFrameOf)])];

  async function loadBaseLayer(onEssential) {
    const order = progressiveOrder(reduceMotion.matches ? keyFrames() : null);
    // Essenciais: um a cada 16 quadros (~13 imagens leves) antes de liberar a página
    const essential = reduceMotion.matches ? order.length
      : Math.max(1, order.findIndex((n) => (n - CONFIG.first) % 16 !== 0 && n !== CONFIG.last));
    let done = 0, fired = false;
    await pool(order, async (n, k) => {
      await loadBase(n);
      if (k < essential) { done++; updateLoader(done / essential); }
      if (!fired && done >= essential) { fired = true; onEssential(); }
      updateBuffer();
    });
    if (!fired) onEssential();
  }

  function setMainTier(t) {
    mainTier = t;
    const token = ++mainToken;
    bitmaps.forEach((b) => b.close && b.close());
    bitmaps.clear();
    blobs = new Array(CONFIG.last + 1).fill(null);
    mainLoaded = 0;
    needsDraw = true;
    if (t === BASE) { mainTotal = 0; updateBuffer(); return; }
    const order = progressiveOrder(reduceMotion.matches ? keyFrames() : null);
    mainTotal = order.length;
    updateBuffer();
    started.then(() => {
      // Começa pelos quadros perto da posição atual
      const c = Math.round(current);
      order.sort((a, b) => (Math.abs(a - c) < 8 ? 0 : 1) - (Math.abs(b - c) < 8 ? 0 : 1));
      return pool(order, async (n) => {
        if (token !== mainToken) return;
        try {
          const res = await fetch(frameSrc(t.dir, n));
          if (!res.ok) return;
          const blob = await res.blob();
          if (token !== mainToken) return;
          blobs[n] = blob;
          mainLoaded++;
          updateBuffer();
        } catch (e) { /* segue com a camada base */ }
      }, 4);
    });
  }

  // Mantém decodificados apenas os quadros nítidos perto da posição atual
  let lastDir = 1;
  function updateDecodeWindow(pos, dir) {
    if (!mainTier || mainTier === BASE || typeof createImageBitmap !== "function") return;
    const W = CONFIG.decodeWindow[mainTier.dir] || 8;
    const c = Math.round(pos);
    const ahead = dir >= 0 ? W : Math.ceil(W / 2);
    const behind = dir >= 0 ? Math.ceil(W / 2) : W;
    const lo = Math.max(CONFIG.first, c - behind), hi = Math.min(CONFIG.last, c + ahead);
    // libera o que saiu da janela
    for (const [n, bm] of bitmaps) {
      if (n < lo - 2 || n > hi + 2) { if (bm.close) bm.close(); bitmaps.delete(n); }
    }
    // decodifica do mais próximo ao mais distante, no máximo 2 por vez
    if (decoding.size >= 2) return;
    const want = [];
    for (let n = lo; n <= hi; n++) if (blobs[n] && !bitmaps.has(n) && !decoding.has(n)) want.push(n);
    want.sort((a, b) => Math.abs(a - pos) - Math.abs(b - pos));
    const token = mainToken;
    for (const n of want) {
      if (decoding.size >= 2) break;
      decoding.add(n);
      createImageBitmap(blobs[n]).then((bm) => {
        decoding.delete(n);
        const cc = Math.round(current);
        if (token !== mainToken || n < cc - W - 2 || n > cc + W + 2) { if (bm.close) bm.close(); return; }
        bitmaps.set(n, bm);
        if (Math.abs(n - current) < 1.5) needsDraw = true;
      }, () => decoding.delete(n));
    }
  }

  function nearestBase(n) {
    if (base[n]) return n;
    for (let d = 1; d <= TOTAL; d++) {
      if (n - d >= CONFIG.first && base[n - d]) return n - d;
      if (n + d <= CONFIG.last && base[n + d]) return n + d;
    }
    return -1;
  }

  // Melhor imagem disponível para o quadro n: nítida decodificada → base exata → base mais próxima
  function sourceFor(n) {
    if (bitmaps.has(n)) return { img: bitmaps.get(n), exact: true, sharp: true };
    if (base[n]) return { img: base[n], exact: true, sharp: false };
    const k = nearestBase(n);
    return k < 0 ? null : { img: base[k], exact: false, sharp: false };
  }

  /* ---------- Loader: luzes de largada ---------- */
  let shownPct = 0;
  function updateLoader(pct) {
    shownPct = Math.max(shownPct, pct);
    loaderPct.textContent = String(Math.round(shownPct * 100)).padStart(2, "0");
    lights.forEach((l, i) => l.classList.toggle("on", shownPct >= (i + 1) / lights.length - 0.001));
  }

  function updateBuffer() {
    const useMain = mainTier && mainTier !== BASE;
    const total = useMain ? mainTotal : (reduceMotion.matches ? keyFrames().length : TOTAL);
    const pct = Math.min(100, Math.round(((useMain ? mainLoaded : baseLoaded) / total) * 100));
    hudBuffer.textContent = `${(mainTier || BASE).label} ${String(pct).padStart(3, "0")}%`;
    hudBuffer.classList.toggle("is-full", pct >= 100);
  }

  function hideLoader() {
    updateLoader(1);
    releaseStart(); // a camada nítida só começa a baixar depois que a página abre
    const out = () => {
      loader.classList.add("is-out"); // "lights out and away we go"
      setTimeout(() => {
        loader.classList.add("is-done");
        document.body.classList.remove("is-loading");
      }, reduceMotion.matches ? 0 : 350);
    };
    setTimeout(out, reduceMotion.matches ? 0 : 650);
  }

  /* ---------- Desenho ---------- */
  let drawnPos = -1, drawnSharp = false;
  function draw(pos) {
    const a = Math.floor(pos);
    const frac = pos - a;
    const A = sourceFor(a);
    if (!A) return;
    const r = coverRect();

    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(A.img, r.x, r.y, r.w, r.h);

    // Mistura com o próximo quadro para uma transição sem degraus
    const b = a + 1;
    if (frac > 0.02 && b <= CONFIG.last && A.exact) {
      const B = sourceFor(b);
      if (B && B.exact) {
        ctx.globalAlpha = frac;
        ctx.drawImage(B.img, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
    }
    drawnPos = pos;
    drawnSharp = A.sharp;
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

    const moving = Math.abs(target - current) > 0.01;
    if (moving) lastDir = Math.sign(target - current) || lastDir;
    updateDecodeWindow(current, lastDir);
    if (needsDraw || Math.abs(current - drawnPos) > 0.004) draw(current);
    else if (!drawnSharp && bitmaps.has(Math.floor(current))) draw(current); // a nitidez chegou

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
  document.body.classList.add("is-loading");
  updateLoader(0);
  new ResizeObserver(resize).observe(sticky);
  resize();
  requestAnimationFrame(tick);
  loadBaseLayer(hideLoader);

  // Se a preferência de movimento mudar com a página aberta, redesenha
  reduceMotion.addEventListener?.("change", () => { needsDraw = true; lastP = -1; });
})();
