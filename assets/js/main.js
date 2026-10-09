/* ==========================================================================
   main.js — comportements de l'interface
   Aucune dépendance externe. Chaque module est isolé et vérifie la présence
   de ses éléments avant de s'initialiser, pour qu'une section absente ne
   casse jamais le reste de la page.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------------------
     1. Thème clair / sombre
     Le thème initial est déjà posé par le script inline du <head>.
     Ici on ne gère que le bouton et la persistance.
     ---------------------------------------------------------------------- */
  (function theme() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('ll-theme', next); } catch (e) { /* stockage refusé */ }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#0A0C10' : '#F7F8FA');
    });

    // Si l'utilisateur n'a jamais choisi, on suit le système en direct.
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var follow = function (e) {
      var stored = null;
      try { stored = localStorage.getItem('ll-theme'); } catch (err) { /* ignore */ }
      if (!stored) root.setAttribute('data-theme', e.matches ? 'light' : 'dark');
    };
    if (mq.addEventListener) mq.addEventListener('change', follow);
    else if (mq.addListener) mq.addListener(follow);
  })();

  /* ----------------------------------------------------------------------
     2. Navigation mobile
     ---------------------------------------------------------------------- */
  (function mobileNav() {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('primaryNav');
    if (!toggle || !nav) return;

    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      nav.classList.toggle('is-open', open);
    };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    // Fermer après un clic sur un lien (navigation par ancres).
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });

    // Si on repasse en desktop, on remet l'état fermé.
    window.matchMedia('(min-width: 861px)').addEventListener('change', function (e) {
      if (e.matches) setOpen(false);
    });
  })();

  /* ----------------------------------------------------------------------
     3. En-tête collant + barre de progression
     La lecture de scrollY est groupée dans un rAF pour éviter le jank.
     ---------------------------------------------------------------------- */
  (function scrollUI() {
    var header = document.getElementById('siteHeader');
    var bar = document.getElementById('progressBar');
    var ticking = false;

    function update() {
      var y = window.scrollY || window.pageYOffset;
      if (header) header.classList.toggle('is-stuck', y > 12);

      if (bar) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var pct = max > 0 ? (y / max) * 100 : 0;
        bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
      }
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  })();

  /* ----------------------------------------------------------------------
     4. Révélation au défilement
     ---------------------------------------------------------------------- */
  (function reveal() {
    var items = document.querySelectorAll('[data-reveal]');
    if (!items.length) return;

    if (prefersReduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

    items.forEach(function (el) { io.observe(el); });
  })();

  /* ----------------------------------------------------------------------
     5. Lien de navigation actif
     ---------------------------------------------------------------------- */
  (function activeNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.primary-nav a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    var sections = [];

    links.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var section = document.getElementById(id);
      if (!section) return;
      map[id] = link;
      sections.push(section);
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (l) { l.classList.remove('is-active'); });
        var link = map[entry.target.id];
        if (link) link.classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (s) { io.observe(s); });
  })();

  /* ----------------------------------------------------------------------
     6. Compteurs animés du héro
     ---------------------------------------------------------------------- */
  (function counters() {
    var nodes = document.querySelectorAll('.count');
    if (!nodes.length) return;

    if (prefersReduced || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.textContent = n.dataset.count; });
      return;
    }

    var run = function (el) {
      var target = parseInt(el.dataset.count, 10) || 0;
      var duration = 900;
      var start = null;

      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        // easeOutCubic
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(target * eased));
        if (p < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    };

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        run(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    nodes.forEach(function (n) { io.observe(n); });
  })();

  /* ----------------------------------------------------------------------
     7. Schéma OSI ↔ TCP/IP
     Le survol d'une couche met en évidence son groupe dans les deux modèles.
     Accessible au clavier via focus.
     ---------------------------------------------------------------------- */
  (function osi() {
    var wrap = document.getElementById('osiModels');
    if (!wrap) return;

    var layers = wrap.querySelectorAll('.layer');
    var paths = wrap.querySelectorAll('.osi-links path');

    function highlight(group) {
      wrap.classList.add('is-hovering');
      layers.forEach(function (l) {
        l.classList.toggle('is-hl', !!group && l.dataset.group === group);
      });
      paths.forEach(function (p) {
        p.classList.toggle('is-hl', !!group && p.dataset.group === group);
      });
    }

    function clear() {
      wrap.classList.remove('is-hovering');
      layers.forEach(function (l) { l.classList.remove('is-hl'); });
      paths.forEach(function (p) { p.classList.remove('is-hl'); });
    }

    layers.forEach(function (layer) {
      layer.addEventListener('mouseenter', function () { highlight(layer.dataset.group); });
      layer.addEventListener('mouseleave', clear);
      layer.setAttribute('tabindex', '0');
      layer.addEventListener('focus', function () { highlight(layer.dataset.group); });
      layer.addEventListener('blur', clear);
    });
  })();

  /* ----------------------------------------------------------------------
     8. Année du pied de page
     ---------------------------------------------------------------------- */
  (function year() {
    var el = document.getElementById('year');
    if (el) el.textContent = String(new Date().getFullYear());
  })();

})();
