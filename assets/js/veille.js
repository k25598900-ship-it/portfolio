/* ==========================================================================
   veille.js — agrégateur de flux RSS côté navigateur

   Principe
   --------
   Un site statique ne peut pas lire un flux RSS distant directement : la
   politique de même origine (CORS) du navigateur le bloque, et c'est tant
   mieux. On passe donc par un relais qui va chercher le XML à notre place.

   Deux relais sont utilisés en cascade :
     1. api.rss2json.com  — renvoie du JSON déjà analysé, plus rapide ;
     2. api.allorigins.win — renvoie le XML brut, que l'on analyse ici.
   Si le premier échoue, le second prend le relais. Si les deux échouent,
   la page reste lisible et affiche une explication plutôt qu'une erreur nue.

   Alternative sans dépendance externe : héberger `rss-proxy.php` (fourni)
   et remplacer PROXY ci-dessous par '../rss-proxy.php?url='.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Sources suivies
     `theme` sert au filtrage : cyber | reseau | systeme | virtu
     ---------------------------------------------------------------------- */
  var SOURCES = [
    {
      name: 'CERT-FR — Avis',
      url: 'https://www.cert.ssi.gouv.fr/avis/',
      feed: 'https://www.cert.ssi.gouv.fr/avis/feed/',
      theme: 'cyber',
      desc: 'Avis de vulnérabilité publiés par l\'ANSSI, avec le niveau de gravité et les versions corrigées.'
    },
    {
      name: 'CERT-FR — Alertes',
      url: 'https://www.cert.ssi.gouv.fr/alerte/',
      feed: 'https://www.cert.ssi.gouv.fr/alerte/feed/',
      theme: 'cyber',
      desc: 'Alertes de sécurité en cours d\'exploitation. Le flux à surveiller en priorité.'
    },
    {
      name: 'ANSSI',
      url: 'https://www.ssi.gouv.fr/',
      feed: 'https://www.ssi.gouv.fr/feed/',
      theme: 'cyber',
      desc: 'Actualités, guides d\'hygiène numérique et recommandations de l\'agence nationale.'
    },
    {
      name: 'The Hacker News',
      url: 'https://thehackernews.com/',
      feed: 'https://feeds.feedburner.com/TheHackersNews',
      theme: 'cyber',
      desc: 'Vulnérabilités, campagnes de phishing et compromissions, avec un bon niveau de détail technique.'
    },
    {
      name: 'BleepingComputer',
      url: 'https://www.bleepingcomputer.com/',
      feed: 'https://www.bleepingcomputer.com/feed/',
      theme: 'cyber',
      desc: 'Ransomwares, failles corrigées par Microsoft, actualité des menaces.'
    },
    {
      name: 'CISA — Advisories',
      url: 'https://www.cisa.gov/news-events/cybersecurity-advisories',
      feed: 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
      theme: 'cyber',
      desc: 'Bulletins de l\'agence américaine. Utile pour anticiper les vagues de correctifs.'
    },
    {
      name: 'IT-Connect',
      url: 'https://www.it-connect.fr/',
      feed: 'https://www.it-connect.fr/feed/',
      theme: 'systeme',
      desc: 'Tutoriels et actualité francophone pour l\'administration système et réseau.'
    },
    {
      name: 'Journal du Hacker',
      url: 'https://www.journalduhacker.net/',
      feed: 'https://www.journalduhacker.net/rss',
      theme: 'systeme',
      desc: 'Agrégateur communautaire francophone. Bon révélateur de ce qui compte vraiment.'
    },
    {
      name: 'Developpez.com',
      url: 'https://www.developpez.com/',
      feed: 'https://www.developpez.com/index/rss',
      theme: 'systeme',
      desc: 'Actualité du développement et des systèmes, avec des dossiers techniques fouillés.'
    },
    {
      name: 'Next',
      url: 'https://next.ink/',
      feed: 'https://next.ink/feed/',
      theme: 'reseau',
      desc: 'Enquêtes sur les infrastructures, la souveraineté numérique et la régulation.'
    },
    {
      name: 'Korben',
      url: 'https://korben.info/',
      feed: 'https://korben.info/feed',
      theme: 'systeme',
      desc: 'Auto-hébergement, outils et bidouille. Souvent la première alerte sur un projet utile.'
    },
    {
      name: 'Le Monde Informatique',
      url: 'https://www.lemondeinformatique.fr/',
      feed: 'https://www.lemondeinformatique.fr/flux-rss/thematique/toutes-les-actualites/rss.xml',
      theme: 'reseau',
      desc: 'Actualité des infrastructures et des choix technologiques en entreprise.'
    },
    {
      name: 'Proxmox',
      url: 'https://www.proxmox.com/en/news',
      feed: 'https://www.proxmox.com/en/news/feed',
      theme: 'virtu',
      desc: 'Nouvelles versions de l\'hyperviseur que j\'utilise en labo.'
    },
    {
      name: 'NVD — CVE analysées',
      url: 'https://nvd.nist.gov/',
      feed: 'https://nvd.nist.gov/feeds/xml/cve/misc/nvd-rss-analyzed.xml',
      theme: 'cyber',
      desc: 'Flux brut des CVE enrichies. Volumineux : à filtrer avant lecture.'
    }
  ];

  var THEME_LABEL = {
    cyber: 'Cybersécurité',
    reseau: 'Réseau',
    systeme: 'Systèmes',
    virtu: 'Virtualisation'
  };

  /* Relais. Le premier renvoie du JSON, le second du XML brut. */
  var PROXY_JSON = 'https://api.rss2json.com/v1/api.json?count=15&rss_url=';
  var PROXY_RAW = 'https://api.allorigins.win/raw?url=';

  var MAX_ITEMS = 15;      // par source
  var PAGE_SIZE = 24;      // articles affichés au départ
  var FETCH_TIMEOUT = 14000;

  /* ----------------------------------------------------------------------
     Calendrier des fins de support
     Les dates sont vérifiables sur les pages éditeurs liées dans le HTML.
     ---------------------------------------------------------------------- */
  var EOL = [
    { prod: 'Windows Server 2016',       tag: 'OS',        date: '2027-01-12', scope: 'fin du support étendu' },
    { prod: 'Windows 11 23H2',           tag: 'OS',        date: '2025-11-11', scope: 'fin de support (éditions Famille/Pro)' },
    { prod: 'Windows 10 22H2',           tag: 'OS',        date: '2025-10-14', scope: 'fin du support (hors ESU)' },
    { prod: 'Windows Server 2019',       tag: 'OS',        date: '2029-01-09', scope: 'fin du support étendu' },
    { prod: 'VMware vSphere 7.0',        tag: 'Hyperviseur', date: '2025-10-02', scope: 'fin du support général' },
    { prod: 'VMware vSphere 8.0',        tag: 'Hyperviseur', date: '2027-10-11', scope: 'fin du support général' },
    { prod: 'Debian 11 « bullseye »',    tag: 'Distribution', date: '2026-08-31', scope: 'fin du support long terme' },
    { prod: 'Debian 12 « bookworm »',    tag: 'Distribution', date: '2028-06-30', scope: 'fin du support long terme' },
    { prod: 'Ubuntu 22.04 LTS',          tag: 'Distribution', date: '2027-06-01', scope: 'fin du support standard' },
    { prod: 'PHP 8.1',                   tag: 'Runtime',   date: '2025-12-31', scope: 'fin des correctifs de sécurité' },
    { prod: 'PHP 8.2',                   tag: 'Runtime',   date: '2026-12-31', scope: 'fin des correctifs de sécurité' }
  ];

  /* ======================================================================
     Utilitaires
     ====================================================================== */

  function $(id) { return document.getElementById(id); }

  function stripHtml(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('script, style').forEach(function (n) { n.remove(); });
    var text = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
    return text;
  }

  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
  }

  function toDate(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function relative(date) {
    if (!date) return '';
    var diff = Date.now() - date.getTime();
    var min = Math.round(diff / 60000);
    if (min < 1) return 'à l\'instant';
    if (min < 60) return 'il y a ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    var j = Math.round(h / 24);
    if (j < 31) return 'il y a ' + j + ' j';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function shortDate(date) {
    if (!date) return '';
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  /* Normalise un titre pour repérer les doublons entre sources. */
  function fingerprint(title) {
    return (title || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 60);
  }

  /* Extrait une propriété en cherchant plusieurs noms possibles (Atom vs RSS). */
  function pick(node, names) {
    for (var i = 0; i < names.length; i++) {
      var el = node.getElementsByTagName(names[i])[0];
      if (el && el.textContent) return el.textContent.trim();
    }
    return '';
  }

  /* Extrait un lien, en gérant le cas Atom où l'URL est dans un attribut. */
  function pickLink(node) {
    var link = node.getElementsByTagName('link')[0];
    if (link) {
      var href = link.getAttribute('href');
      if (href) return href.trim();
      if (link.textContent.trim()) return link.textContent.trim();
    }
    var guid = node.getElementsByTagName('guid')[0];
    if (guid && /^https?:/i.test(guid.textContent.trim())) return guid.textContent.trim();
    return '';
  }

  /* ======================================================================
     Récupération des flux
     ====================================================================== */

  function fetchWithTimeout(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, FETCH_TIMEOUT);

    return fetch(url, {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' }
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* Voie 1 : le relais renvoie du JSON déjà structuré. */
  function viaJson(source) {
    return fetchWithTimeout(PROXY_JSON + encodeURIComponent(source.feed))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || data.status !== 'ok' || !Array.isArray(data.items) || !data.items.length) {
          throw new Error('flux vide');
        }
        return data.items.map(function (it) {
          return {
            title: (it.title || '').trim(),
            link: it.link || '',
            date: toDate(it.pubDate),
            summary: truncate(stripHtml(it.description || it.content || ''), 220)
          };
        });
      });
  }

  /* Voie 2 : le relais renvoie le XML brut, analysé ici. */
  function viaXml(source) {
    return fetchWithTimeout(PROXY_RAW + encodeURIComponent(source.feed))
      .then(function (res) { return res.text(); })
      .then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('XML illisible');

        var nodes = doc.querySelectorAll('item');
        if (!nodes.length) nodes = doc.querySelectorAll('entry'); // Atom
        if (!nodes.length) throw new Error('aucun article');

        return Array.prototype.slice.call(nodes, 0, MAX_ITEMS).map(function (node) {
          var raw = pick(node, ['description', 'summary', 'content', 'encoded']);
          return {
            title: pick(node, ['title']),
            link: pickLink(node),
            date: toDate(pick(node, ['pubDate', 'published', 'updated', 'dc:date'])),
            summary: truncate(stripHtml(raw), 220)
          };
        });
      });
  }

  /* Essaie la voie JSON puis la voie XML pour une source. */
  function loadSource(source) {
    return viaJson(source)
      .catch(function () { return viaXml(source); })
      .then(function (items) {
        return items
          .filter(function (it) { return it.title && it.link; })
          .map(function (it) {
            it.source = source.name;
            it.sourceUrl = source.url;
            it.theme = source.theme;
            return it;
          });
      });
  }

  /* ======================================================================
     Rendu
     ====================================================================== */

  var ARTICLES = [];
  var shown = PAGE_SIZE;
  var activeFilter = 'all';
  var query = '';

  function renderFeed() {
    var list = $('veilleFeed');
    var more = $('veilleMore');
    if (!list) return;

    var q = query.toLowerCase();

    var filtered = ARTICLES.filter(function (a) {
      if (activeFilter !== 'all' && a.theme !== activeFilter) return false;
      if (!q) return true;
      return (a.title + ' ' + a.source).toLowerCase().indexOf(q) !== -1;
    });

    list.innerHTML = '';
    list.setAttribute('aria-busy', 'false');

    if (!filtered.length) {
      var empty = document.createElement('li');
      empty.className = 'feed-empty';
      var strong = document.createElement('strong');
      strong.textContent = ARTICLES.length ? 'Aucun article ne correspond' : 'Aucun article chargé';
      var p = document.createElement('p');
      p.textContent = ARTICLES.length
        ? 'Essayez un autre thème, ou effacez la recherche.'
        : 'Les flux n\'ont pas pu être récupérés. Utilisez « Actualiser », ou lisez les sources directement depuis la liste ci-dessous.';
      empty.appendChild(strong);
      empty.appendChild(p);
      list.appendChild(empty);
      if (more) more.hidden = true;
      return;
    }

    filtered.slice(0, shown).forEach(function (a, i) {
      list.appendChild(buildCard(a, i));
    });

    if (more) {
      more.hidden = filtered.length <= shown;
      more.textContent = 'Afficher plus d\'articles (' + (filtered.length - shown) + ')';
    }
  }

  function buildCard(a, index) {
    var li = document.createElement('li');
    li.className = 'feed-item';
    li.style.setProperty('--i', Math.min(index, 12));

    // Bandeau : thème, source, date
    var top = document.createElement('div');
    top.className = 'feed-top';

    var tag = document.createElement('span');
    tag.className = 'feed-tag';
    tag.textContent = THEME_LABEL[a.theme] || a.theme;
    top.appendChild(tag);

    var src = document.createElement('span');
    src.className = 'feed-src';
    src.textContent = a.source;
    top.appendChild(src);

    if (a.date) {
      var date = document.createElement('time');
      date.className = 'feed-date';
      date.dateTime = a.date.toISOString();
      date.textContent = shortDate(a.date);
      top.appendChild(date);
    }
    li.appendChild(top);

    // Titre
    var h3 = document.createElement('h3');
    h3.className = 'feed-title';
    var link = document.createElement('a');
    link.href = a.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = a.title;
    h3.appendChild(link);
    li.appendChild(h3);

    // Résumé
    if (a.summary) {
      var sum = document.createElement('p');
      sum.className = 'feed-sum';
      sum.textContent = a.summary;
      li.appendChild(sum);
    }

    // Pied : lien + ancienneté
    var foot = document.createElement('div');
    foot.className = 'feed-foot';

    var open = document.createElement('a');
    open.className = 'feed-link';
    open.href = a.link;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Lire l\'article →';
    foot.appendChild(open);

    var fresh = document.createElement('span');
    fresh.className = 'feed-fresh';
    if (a.date) {
      var ageHours = (Date.now() - a.date.getTime()) / 3600000;
      if (ageHours <= 48) fresh.classList.add('is-new');
      fresh.textContent = relative(a.date);
    } else {
      fresh.textContent = a.source;
    }
    foot.appendChild(fresh);

    li.appendChild(foot);
    return li;
  }

  function renderSources(offlineSet) {
    var grid = $('sourcesGrid');
    if (!grid) return;

    grid.innerHTML = '';
    SOURCES.forEach(function (s) {
      var a = document.createElement('a');
      a.className = 'src';
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (offlineSet && offlineSet.has(s.name)) a.classList.add('is-off');

      var name = document.createElement('span');
      name.className = 'src-name';
      name.textContent = s.name;

      var desc = document.createElement('span');
      desc.className = 'src-desc';
      desc.textContent = s.desc;

      var meta = document.createElement('span');
      meta.className = 'src-meta';
      meta.textContent = (THEME_LABEL[s.theme] || s.theme) + ' · flux RSS';

      a.appendChild(name);
      a.appendChild(desc);
      a.appendChild(meta);
      grid.appendChild(a);
    });
  }

  function setHealth(ok, total) {
    var dot = $('vsDot');
    var health = $('vsHealth');
    if (health) {
      health.textContent = ok + ' / ' + total + ' sources joignables';
    }
    if (dot) {
      dot.className = 'vs-dot ' + (ok === 0 ? 'is-down' : ok < total ? 'is-partial' : 'is-ok');
    }
  }

  function setNotice(message) {
    var box = $('veilleNotice');
    var text = $('veilleNoticeText');
    if (!box || !text) return;
    if (!message) { box.hidden = true; text.textContent = ''; return; }
    text.textContent = message;
    box.hidden = false;
  }

  /* ======================================================================
     Compteur des fins de support
     ====================================================================== */

  function renderEol() {
    var list = $('eolList');
    if (!list) return;

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var rows = EOL.map(function (item) {
      var target = new Date(item.date + 'T00:00:00');
      var days = Math.round((target - today) / 86400000);
      return { item: item, target: target, days: days };
    }).sort(function (a, b) { return a.target - b.target; });

    list.innerHTML = '';

    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'eol-item';

      var state = 'ok';
      if (row.days < 0) state = 'past';
      else if (row.days <= 120) state = 'critical';
      else if (row.days <= 400) state = 'warn';
      if (state !== 'ok') li.classList.add('is-' + state);

      // Produit + étiquette
      var prod = document.createElement('div');
      prod.className = 'eol-prod';
      var tag = document.createElement('span');
      tag.className = 'eol-tag';
      tag.textContent = row.item.tag;
      var strong = document.createElement('strong');
      strong.textContent = row.item.prod;
      prod.appendChild(tag);
      prod.appendChild(strong);
      li.appendChild(prod);

      // Date cible
      var date = document.createElement('span');
      date.className = 'eol-date';
      date.textContent = row.target.toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
      li.appendChild(date);

      // Compteur
      var count = document.createElement('div');
      count.className = 'eol-count';
      var days = document.createElement('span');
      days.className = 'eol-days';

      var sub = document.createElement('span');
      sub.className = 'eol-sub';

      if (row.days < 0) {
        days.textContent = 'Échu';
        sub.textContent = 'depuis ' + Math.abs(row.days) + ' jours';
      } else if (row.days === 0) {
        days.textContent = 'Aujourd\'hui';
        sub.textContent = row.item.scope;
      } else {
        days.textContent = row.days + ' jours';
        sub.textContent = row.days <= 120 ? 'échéance proche — à traiter' : row.item.scope;
      }

      count.appendChild(days);
      count.appendChild(sub);
      li.appendChild(count);

      list.appendChild(li);
    });
  }

  /* ======================================================================
     Chargement global
     ====================================================================== */

  function loadAll(manual) {
    var refreshBtn = $('vsRefresh');
    var list = $('veilleFeed');
    if (refreshBtn) refreshBtn.classList.add('is-busy');
    if (list) list.setAttribute('aria-busy', 'true');
    if (manual) setNotice('');

    var results = SOURCES.map(function (source) {
      return loadSource(source).then(
        function (items) { return { source: source, items: items, ok: true }; },
        function () { return { source: source, items: [], ok: false }; }
      );
    });

    Promise.all(results).then(function (all) {
      var okCount = 0;
      var offline = new Set();
      var pool = [];

      all.forEach(function (r) {
        if (r.ok && r.items.length) { okCount++; }
        else { offline.add(r.source.name); }
        pool = pool.concat(r.items);
      });

      // Dédoublonnage par empreinte du titre, en gardant le plus récent.
      var seen = {};
      pool.forEach(function (a) {
        var key = fingerprint(a.title);
        if (!key) return;
        var existing = seen[key];
        if (!existing) { seen[key] = a; return; }
        var aTime = a.date ? a.date.getTime() : 0;
        var eTime = existing.date ? existing.date.getTime() : 0;
        if (aTime > eTime) seen[key] = a;
      });

      ARTICLES = Object.keys(seen).map(function (k) { return seen[k]; });

      // Tri du plus récent au plus ancien ; les articles sans date en dernier.
      ARTICLES.sort(function (a, b) {
        var at = a.date ? a.date.getTime() : -Infinity;
        var bt = b.date ? b.date.getTime() : -Infinity;
        return bt - at;
      });

      shown = PAGE_SIZE;
      renderFeed();
      renderSources(offline);
      setHealth(okCount, SOURCES.length);

      var updated = $('vsUpdated');
      if (updated) {
        updated.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      }
      var count = $('vsCount');
      if (count) count.textContent = String(ARTICLES.length);

      if (!ARTICLES.length) {
        setNotice(
          'Les flux n\'ont pas pu être récupérés depuis le navigateur. ' +
          'Cela arrive si le réseau est filtré, si un relais public est indisponible, ' +
          'ou si la page est ouverte depuis un fichier local sans serveur web. ' +
          'La liste des sources ci-dessous reste consultable directement.'
        );
      } else if (okCount < SOURCES.length) {
        setNotice(
          (SOURCES.length - okCount) + ' source(s) n\'ont pas répondu cette fois-ci. ' +
          'Elles restent listées ci-dessous ; un nouvel essai suffit souvent.'
        );
      } else {
        setNotice('');
      }

      if (refreshBtn) refreshBtn.classList.remove('is-busy');
    });
  }

  /* ======================================================================
     Initialisation
     ====================================================================== */

  function init() {
    if (!$('veilleFeed')) return;

    renderEol();
    renderSources(null);
    loadAll(false);

    // Filtres par thème
    var filters = $('veilleFilters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip-filter');
        if (!btn) return;
        filters.querySelectorAll('.chip-filter').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        activeFilter = btn.dataset.filter || 'all';
        shown = PAGE_SIZE;
        renderFeed();
      });
    }

    // Recherche, avec un léger délai pour ne pas filtrer à chaque frappe
    var search = $('veilleSearch');
    if (search) {
      var timer;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          query = search.value.trim();
          shown = PAGE_SIZE;
          renderFeed();
        }, 180);
      });
    }

    // Pagination
    var more = $('veilleMore');
    if (more) {
      more.addEventListener('click', function () {
        shown += PAGE_SIZE;
        renderFeed();
      });
    }

    // Actualisation manuelle
    var refresh = $('vsRefresh');
    if (refresh) {
      refresh.addEventListener('click', function () { loadAll(true); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
