// @ts-nocheck
/* Wav Lab - vitrine (app.js). Configuracao em config.js */
(function () {
    'use strict';

    var CFG = window.WAVLAB;
    var LICENSES = CFG.LICENSES;
    var PREVIEW_SECONDS = CFG.PREVIEW_SECONDS;
    var BATCH = 24;                 // quantos beats entram a cada "rolagem"
    var BEATS = [];
    var db = null;
    // tipos de produto que a vitrine mostra (config.js). So 'beat' tem card e modal de compra prontos.
    var CATALOG_TYPES = (CFG.CATALOG_TYPES && CFG.CATALOG_TYPES.length) ? CFG.CATALOG_TYPES : ['beat'];

    // Pagina do produtor: o <body> traz data-producer e so os beats dele aparecem.
    //  - produtor.html?p=slug : data-producer="url", o slug vem do endereco (vale para qualquer produtor, sem pasta)
    //  - /slug/ (pastas antigas): data-producer="slug"
    var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    var PRODUCER_SLUG = document.body.getAttribute('data-producer');
    if (PRODUCER_SLUG === 'url') {
        var ps = '';
        try { ps = new URLSearchParams(window.location.search).get('p') || ''; } catch (e) { /* sem URLSearchParams */ }
        PRODUCER_SLUG = (ps.length <= 60 && SLUG_RE.test(ps)) ? ps : '?';   // '?' nunca e um slug valido: cai em "Produtor nao encontrado"
    }
    var ROOT = document.body.getAttribute('data-root') || '';
    var PRODUCER = null;
    var SEARCH_ON = !!$('searchForm');      // a pagina do produtor nao tem busca

    // link compartilhado: ?beat=ID rola ate o beat e destaca (so aceita o formato de um id)
    var BEAT_PARAM = null;
    try {
        var qs = new URLSearchParams(window.location.search);
        var bp = qs.get('beat') || qs.get('produto');
        if (bp && /^[A-Za-z0-9-]{1,64}$/.test(bp)) BEAT_PARAM = bp;
    } catch (e) { /* sem URLSearchParams */ }

    function getDb() {
        if (!db && window.supabase) db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
        return db;
    }

    // Eventos simples (play, licenciar, finalizar, busca sem resultado). Sem IP, sem identificador, so o que esta abaixo.
    // Nunca atrapalha a vitrine: se falhar (ou se a tabela ainda nao existir), segue em silencio.
    function track(type, f) {
        if (!getDb()) return;
        try {
            var row = { type: type };
            if (f && f.beat) {
                row.product_id = f.beat;
                row.beat_id = f.beat;      // legado: o resumo do admin antigo ainda le beat_id
            }
            if (f && f.license) row.license_id = f.license;
            if (f && f.term) row.term = f.term;
            db.from('events').insert(row).then(function () {}, function () {});
        } catch (err) { /* nunca atrapalha */ }
    }

    // =========================================================
    // HELPERS
    // =========================================================
    function $(id) { return document.getElementById(id); }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function brl(n) { return 'R$ ' + Number(n).toLocaleString('pt-BR'); }

    function fmtTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function initials(text) {
        return String(text || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    }

    function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#ff5500'; }

    // minusculo e sem acento (busca "melodico" acha "melódico")
    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* navegador antigo */ }
        return s;
    }

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage, tudo bem */ } }

    function findBeat(id) {
        for (var i = 0; i < BEATS.length; i++) if (BEATS[i].id === id) return BEATS[i];
        return null;
    }

    function coverHTML(beat) {
        return (beat.cover ? '<img src="' + esc(beat.cover) + '" alt="" loading="lazy">' : '') +
            '<span>' + esc(initials(beat.title)) + '</span>';
    }

    var toastTimer = null;
    function toast(msg) {
        var t = $('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
    }

    var minPrice = Math.min.apply(null, LICENSES.map(function (l) { return l.price; }));

    // textos do topo vem do config.js
    if (CFG.HERO_TITLE && $('heroTitle')) $('heroTitle').textContent = CFG.HERO_TITLE;
    if (CFG.HERO_SUB && $('heroSub')) $('heroSub').textContent = CFG.HERO_SUB;

    // =========================================================
    // ESTADO DA VITRINE
    // =========================================================
    var filter = { genre: null, producer: null, type: null, q: '' };
    var view = lsGet('wavlab_view');
    if (view !== 'grid' && view !== 'list') {
        view = 'list';
    }
    var current = [];   // beats que passam na busca + filtros
    var shown = 0;      // quantos ja foram desenhados (rolagem infinita)

    // =========================================================
    // DADOS (Supabase)
    // =========================================================
    function normalize(r) {
        var p = r.producers || {};
        var g = r.genres || {};
        var d = r.product_beats;                  // dados proprios do beat (objeto ou lista de 1, conforme o embed)
        if (Array.isArray(d)) d = d[0];
        d = d || {};
        var b = {
            id: r.id,
            type: r.type || 'beat',
            title: r.title,
            price: r.price,
            bpm: d.bpm,
            key: d.musical_key,
            tags: r.tags || [],
            types: d.type_artists || [],
            note: d.note,
            cover: r.cover_url,
            audio: r.preview_url,
            producer: { id: p.id || 'wavlab', name: p.name || 'Wav Lab', handle: p.handle, photo: p.photo_url, slug: p.slug || null, bio: p.bio || '', active: p.active !== false },
            genre: { id: g.id || 'outro', name: g.name || 'Outro', color: safeColor(g.color), sort: g.sort == null ? 100 : g.sort }
        };
        // campos prontos para a busca
        b.titleN = norm(b.title);
        b.typesN = norm(b.types.join(' '));
        b.tagsN = norm(b.tags.join(' '));
        b.hay = norm([b.title, b.producer.name, b.producer.handle, b.genre.name, b.tags.join(' '), b.types.join(' ')].join(' '));
        return b;
    }

    function beatCols(o) {
        return 'id,type,title,price,cover_url,preview_url,tags,created_at,' +
            'producers(id,name,handle,photo_url' + (o.slug ? ',slug,bio,active' : '') + '),genres(id,name,color,sort),' +
            'product_beats(bpm,musical_key,type_artists,note)';
    }

    function fetchBeats(cols) {
        var q = db.from('products').select(cols).eq('published', true).in('type', CATALOG_TYPES);
        if (PRODUCER) q = q.eq('producer_id', PRODUCER.id);
        return q.order('created_at', { ascending: false });
    }

    // Se o banco ainda nao recebeu a migracao 03 (slug, bio), tenta de novo sem essas colunas.
    function fetchBeatsSafe(o) {
        return fetchBeats(beatCols(o)).then(function (res) {
            var m = (res.error && res.error.message) || '';
            if (o.slug && /slug|bio|active/.test(m)) return fetchBeatsSafe({ slug: false });
            return res;
        });
    }

    // Link para a pagina do produtor. Sem slug (ou produtor inativo) nao ha link: nunca gera endereco quebrado.
    function producerHref(p) {
        if (!p || !p.slug || p.active === false || !SLUG_RE.test(p.slug)) return null;
        return ROOT + 'produtor.html?p=' + encodeURIComponent(p.slug);
    }

    function loadBeats() {
        showSkeleton();
        if (!window.supabase) { showError(); return; }
        getDb();

        // pagina do produtor: acha o produtor pelo slug antes de buscar os beats
        var ready = (PRODUCER_SLUG && !PRODUCER) ? loadProducer() : Promise.resolve(true);
        ready.then(function (found) {
            if (!found) return;
            return fetchBeatsSafe({ slug: true })
                .then(function (res) {
                    if (res.error) throw res.error;
                    BEATS = (res.data || []).map(normalize);
                    renderControls();
                    renderBeats();
                    focusBeat();
                });
        }).catch(function () { showError(); });
    }

    // =========================================================
    // PAGINA DO PRODUTOR (link na bio)
    // =========================================================
    function instagramUrl(handle) {
        var h = String(handle || '').trim().replace(/^@/, '');
        return /^[A-Za-z0-9._]{1,30}$/.test(h) ? 'https://instagram.com/' + h : null;
    }

    function spotifyUrl(url) {
        url = String(url || '').trim();
        return /^https:\/\/(open\.)?spotify\.com\//i.test(url) ? url : null;
    }

    function loadProducer() {
        return db.from('producers')
            .select('id,name,handle,photo_url,bio,spotify_url,slug')
            .eq('slug', PRODUCER_SLUG).eq('active', true).maybeSingle()
            .then(function (res) {
                if (res.error) throw res.error;
                if (!res.data) { showNotFound(); return false; }
                PRODUCER = res.data;
                renderProfile(PRODUCER);
                return true;
            });
    }

    function renderProfile(p) {
        document.title = p.name + ' | Wav Lab';
        $('pfBeatsLabel').textContent = 'Produções de ' + p.name;

        var ig = instagramUrl(p.handle), sp = spotifyUrl(p.spotify_url);
        var msg = (CFG.PRODUCER_WA_TEXT || 'Salve! Vim pela página de {produtor} no Wav Lab.').replace('{produtor}', function () { return p.name; });
        var wa = 'https://wa.me/' + CFG.WHATSAPP + '?text=' + encodeURIComponent(msg);

        $('profile').innerHTML =
            '<div class="pf-avatar">' + (p.photo_url ? '<img src="' + esc(p.photo_url) + '" alt="Foto de ' + esc(p.name) + '">' : '<span>' + esc(initials(p.name)) + '</span>') + '</div>' +
            '<h1 class="pf-name">' + esc(p.name) + '</h1>' +
            (p.bio ? '<p class="pf-bio">' + esc(p.bio) + '</p>' : '') +
            '<div class="pf-links">' +
                '<a class="pf-btn primary" href="' + esc(wa) + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Falar com o produtor</a>' +
                (ig ? '<a class="pf-btn" href="' + esc(ig) + '" target="_blank" rel="noopener"><i class="fa-brands fa-instagram" aria-hidden="true"></i> Instagram</a>' : '') +
                (sp ? '<a class="pf-btn" href="' + esc(sp) + '" target="_blank" rel="noopener"><i class="fa-brands fa-spotify" aria-hidden="true"></i> Spotify</a>' : '') +
            '</div>';
    }

    function showNotFound() {
        $('profile').innerHTML = '';
        $('pfBeatsLabel').hidden = true;
        $('toolbar').hidden = true;
        $('sentinel').hidden = true;
        $('beatsList').innerHTML =
            '<div class="state-box"><strong>Produtor não encontrado</strong>' +
            'Confira o endereço ou veja todos os beats.<br><a class="state-link" href="' + ROOT + 'index.html">Ver a vitrine</a></div>';
    }

    // =========================================================
    // BUSCA (titulo, type, tags, produtor, genero)
    // =========================================================
    var STOP = { type: 1, beat: 1, beats: 1, typebeat: 1, instrumental: 1, instrumentais: 1, tipo: 1 };

    function tokens(q) {
        var all = norm(q).split(/\s+/).filter(Boolean);
        var useful = all.filter(function (t) { return !STOP[t]; });
        return useful;     // "drake type beat" vira ["drake"]; so "type beat" vira [] (mostra tudo)
    }

    // -1 = nao bate; maior = mais relevante (type > titulo > tag > resto)
    function score(b, toks) {
        var s = 0;
        for (var i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (b.hay.indexOf(t) === -1) return -1;
            s += b.typesN.indexOf(t) > -1 ? 3 : b.titleN.indexOf(t) > -1 ? 2 : b.tagsN.indexOf(t) > -1 ? 1 : 0.5;
        }
        return s;
    }

    function matchesFilter(b) {
        return (!filter.type || b.type === filter.type) &&
               (!filter.genre || b.genre.id === filter.genre) &&
               (!filter.producer || b.producer.id === filter.producer);
    }

    function computeList() {
        var toks = tokens(filter.q), out = [];
        BEATS.forEach(function (b, i) {
            if (!matchesFilter(b)) return;
            var s = toks.length ? score(b, toks) : 0;
            if (s < 0) return;
            out.push({ b: b, s: s, i: i });
        });
        if (toks.length) out.sort(function (a, c) { return (c.s - a.s) || (a.i - c.i); });
        return out.map(function (x) { return x.b; });
    }

    function syncUrl() {
        try {
            var u = new URL(window.location.href);
            if (filter.q) u.searchParams.set('q', filter.q); else u.searchParams.delete('q');
            u.searchParams.delete('beat');
            u.searchParams.delete('produto');
            window.history.replaceState(null, '', u.pathname + u.search + u.hash);
        } catch (e) { /* sem URL, tudo bem */ }
    }

    function setQuery(v, fromInput) {
        filter.q = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!fromInput) $('searchInput').value = filter.q;
        $('searchClear').hidden = !$('searchInput').value;
        syncUrl();
        renderBeats();
        markTerms();
    }

    var searchTimer = null;
    if (SEARCH_ON) {
        $('searchInput').addEventListener('input', function () {
            var v = this.value;
            $('searchClear').hidden = !v;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () { setQuery(v, true); }, 140);
        });

        $('searchForm').addEventListener('submit', function (e) {
            e.preventDefault();
            clearTimeout(searchTimer);
            setQuery($('searchInput').value, true);
            $('searchInput').blur();     // fecha o teclado no celular
        });

        $('searchClear').addEventListener('click', function () {
            setQuery('');
            $('searchInput').focus();
        });
    }

    // =========================================================
    // RENDER
    // =========================================================
    function showSkeleton() {
        var box = $('beatsList');
        box.className = 'beats-list is-' + view;
        var n = view === 'grid' ? 10 : 6, html = '';
        for (var i = 0; i < n; i++) html += '<div class="skeleton"></div>';
        box.innerHTML = html;
        $('sentinel').hidden = true;
    }

    function showError() {
        $('toolbar').hidden = true;
        $('sentinel').hidden = true;
        $('beatsList').innerHTML =
            '<div class="state-box"><strong>Não foi possível carregar os beats</strong>' +
            'Confira sua conexão e tente de novo.<br><button data-retry>Tentar de novo</button></div>';
    }

    // chips de busca rapida: types (peso 2) e tags (peso 1) mais usados
    function renderTerms() {
        var map = {}, list = [], skip = {};
        BEATS.forEach(function (b) { skip[norm(b.genre.name)] = 1; skip[norm(b.genre.id)] = 1; });

        function add(label, w) {
            var key = norm(label).trim();
            if (!key || skip[key]) return;
            if (!map[key]) { map[key] = { label: label, w: 0 }; list.push(map[key]); }
            map[key].w += w;
        }
        BEATS.forEach(function (b) {
            b.types.forEach(function (t) { add(t, 2); });
            b.tags.forEach(function (t) { add(t, 1); });
        });

        if (list.length < 2) { $('termChips').hidden = true; return; }
        list.sort(function (a, c) { return (c.w - a.w) || a.label.localeCompare(c.label); });
        $('termChips').hidden = false;
        $('termChips').innerHTML = list.slice(0, 12).map(function (x) {
            return '<button type="button" class="chip chip-term" data-term="' + esc(x.label) + '">' + esc(x.label) + '</button>';
        }).join('');
        markTerms();
    }

    function markTerms() {
        var chips = document.querySelectorAll('.chip-term');
        var cur = norm(filter.q).trim();
        for (var i = 0; i < chips.length; i++) {
            chips[i].classList.toggle('active', !!cur && norm(chips[i].getAttribute('data-term')) === cur);
        }
    }

    // genero + produtores
    function renderProducerBar() {
        var bar = $('producerBar');
        if (!bar) return;
        var p = null;
        if (filter.producer) {
            for (var i = 0; i < BEATS.length; i++) if (BEATS[i].producer.id === filter.producer) { p = BEATS[i].producer; break; }
        }
        if (!p) { bar.hidden = true; bar.innerHTML = ''; return; }
        var href = producerHref(p);
        bar.innerHTML =
            '<div class="pbar-photo">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc(initials(p.name))) + '</div>' +
            '<div class="pbar-text"><h3 class="pbar-name">' + esc(p.name) + '</h3>' +
                (p.bio ? '<p class="pbar-bio">' + esc(p.bio) + '</p>' : '') + '</div>' +
            (href ? '<a class="pbar-link" href="' + esc(href) + '">Ver perfil completo</a>' : '');
        bar.hidden = false;
    }

    // abas por tipo de produto: so aparecem quando ha mais de um tipo publicado
    function renderTypeTabs() {
        var box = $('typeTabs');
        if (!box) return;
        var order = [], counts = {};
        BEATS.forEach(function (b) {
            if (!counts[b.type]) { counts[b.type] = 0; order.push(b.type); }
            counts[b.type]++;
        });
        if (order.length < 2) { filter.type = null; box.hidden = true; box.innerHTML = ''; return; }
        var labels = CFG.PRODUCT_TYPES || {};
        box.hidden = false;
        box.innerHTML =
            '<button class="chip chip-all' + (!filter.type ? ' active' : '') + '" data-filter-type="">Tudo <span>' + BEATS.length + '</span></button>' +
            order.map(function (t) {
                return '<button class="chip' + (filter.type === t ? ' active' : '') + '" data-filter-type="' + esc(t) + '">' +
                    esc(labels[t] || t) + ' <span>' + counts[t] + '</span></button>';
            }).join('');
    }

    function renderControls() {
        if (PRODUCER_SLUG) return;      // a pagina do produtor nao tem filtros
        renderProducerBar();
        renderTypeTabs();
        var genres = {}, producers = {}, gList = [], pList = [];

        BEATS.forEach(function (b) {
            if (!genres[b.genre.id]) { genres[b.genre.id] = { g: b.genre, n: 0 }; gList.push(genres[b.genre.id]); }
            genres[b.genre.id].n++;
            if (!producers[b.producer.id]) { producers[b.producer.id] = { p: b.producer, n: 0 }; pList.push(producers[b.producer.id]); }
            producers[b.producer.id].n++;
        });

        // produtores: so aparece se tiver mais de um com beats
        if (pList.length < 2) {
            $('producersWrap').hidden = true;
        } else {
            $('producersWrap').hidden = false;
            $('producersStrip').innerHTML = pList.map(function (x) {
                var on = filter.producer === x.p.id;
                var dim = filter.producer && !on;
                return '<button class="prod-item' + (on ? ' active' : '') + (dim ? ' dim' : '') + '" data-filter-producer="' + esc(x.p.id) + '">' +
                    '<span class="prod-avatar">' + (x.p.photo ? '<img src="' + esc(x.p.photo) + '" alt="" loading="lazy">' : esc(initials(x.p.name))) + '</span>' +
                    '<span class="prod-name">' + esc(x.p.name) + '</span>' +
                    '<span class="prod-count">' + x.n + ' beat' + (x.n === 1 ? '' : 's') + '</span>' +
                '</button>';
            }).join('');
        }

        // generos: so aparece se tiver mais de um
        if (gList.length < 2) {
            $('genreFilters').hidden = true;
        } else {
            gList.sort(function (a, b) { return a.g.sort - b.g.sort; });
            $('genreFilters').hidden = false;
            $('genreFilters').innerHTML =
                '<button class="chip chip-all' + (!filter.genre ? ' active' : '') + '" data-filter-genre="">Todos <span>' + BEATS.length + '</span></button>' +
                gList.map(function (x) {
                    return '<button class="chip' + (filter.genre === x.g.id ? ' active' : '') + '" style="--g:' + x.g.color + '" data-filter-genre="' + esc(x.g.id) + '">' +
                        esc(x.g.name) + ' <span>' + x.n + '</span></button>';
                }).join('');
        }

        renderTerms();
    }

    function cardHTML(b) {
        var info = [];
        if (b.bpm) info.push(esc(b.bpm) + ' BPM');
        if (b.key) info.push(esc(b.key));
        var infoTxt = info.join(' &middot; ');
        var avatar = (b.producer.photo ? '<img src="' + esc(b.producer.photo) + '" alt="" loading="lazy">' : esc(initials(b.producer.name)));
        var pHref = producerHref(b.producer);
        var prod = (pHref ? '<a class="bprod" href="' + esc(pHref) + '" title="Ver a página de ' + esc(b.producer.name) + '">' : '<div class="bprod">') +
                '<span class="avatar">' + avatar + '</span><span class="producer-name">' + esc(b.producer.name) + '</span>' +
            (pHref ? '</a>' : '</div>');
        var cover =
            '<div class="bcover" style="--g:' + b.genre.color + '">' + coverHTML(b) +
                '<button class="play-btn" data-play="' + esc(b.id) + '" aria-label="Ouvir ' + esc(b.title) + '"><i class="fa-solid fa-play"></i></button>' +
            '</div>';
        var pill = '<span class="genre-pill" style="--g:' + b.genre.color + '">' + esc(b.genre.name) + '</span>';

        if (view === 'list') {
            var tags = b.types.concat(b.tags).slice(0, 3).map(function (t) {
                return SEARCH_ON
                    ? '<button type="button" class="beat-tag" data-term="' + esc(t) + '" title="' + esc(t) + '"><span>' + esc(t) + '</span></button>'
                    : '<span class="beat-tag" title="' + esc(t) + '"><span>' + esc(t) + '</span></span>';
            }).join('');
            return '' +
            '<article class="brow' + (tags ? '' : ' no-tags') + (b.note ? '' : ' no-note') + '" data-card="' + esc(b.id) + '">' +
                cover +
                '<h3 class="btitle" title="' + esc(b.title) + '">' + esc(b.title) + '</h3>' +
                prod +
                '<div class="brow-facts">' +
                    (b.bpm ? '<span class="binfo binfo-bpm">' + esc(b.bpm) + ' BPM</span>' : '') +
                    (b.key ? '<span class="binfo binfo-key">' + esc(b.key) + '</span>' : '') +
                    pill +
                '</div>' +
                (tags ? '<div class="brow-tags">' + tags + '</div>' : '') +
                (b.note ? '<p class="bnote" title="' + esc(b.note) + '">' + esc(b.note) + '</p>' : '') +
                '<button class="buy-btn" data-buy="' + esc(b.id) + '"><span class="buy-label">Licenciar &middot; </span><span class="price">' + brl(minPrice) + '</span></button>' +
            '</article>';
        }

        return '' +
        '<article class="bcard" data-card="' + esc(b.id) + '">' +
            cover +
            '<div class="bbody">' +
                '<h3 class="btitle" title="' + esc(b.title) + '">' + esc(b.title) + '</h3>' +
                prod +
                '<div class="bmeta">' + pill + (infoTxt ? '<span class="binfo">' + infoTxt + '</span>' : '') + '</div>' +
                '<button class="buy-btn" data-buy="' + esc(b.id) + '">Licenciar &middot; <span class="price">' + brl(minPrice) + '</span></button>' +
            '</div>' +
        '</article>';
    }

    function updateCount() {
        var n = current.length;
        var txt = n + (n === 1 ? ' beat' : ' beats');
        if (filter.q) txt = n + (n === 1 ? ' resultado' : ' resultados') + ' para “' + filter.q + '”';
        $('resultCount').textContent = txt;

        var btns = document.querySelectorAll('.view-btn');
        for (var i = 0; i < btns.length; i++) {
            var on = btns[i].getAttribute('data-view') === view;
            btns[i].classList.toggle('active', on);
            btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function updateEnd() {
        var s = $('sentinel');
        if (current.length <= BATCH) { s.hidden = true; return; }
        s.hidden = false;
        s.textContent = shown < current.length ? 'Carregando mais beats...' : 'Isso é tudo por enquanto.';
    }

    var io = null;

    // desenha o proximo lote (chamado pela rolagem)
    function appendMore() {
        if (shown >= current.length) { updateEnd(); return; }
        var step = io ? BATCH : current.length;      // sem IntersectionObserver, mostra tudo de uma vez
        var next = current.slice(shown, shown + step);
        $('beatsList').insertAdjacentHTML('beforeend', next.map(cardHTML).join(''));
        shown += next.length;
        updateEnd();
        if (playingId) syncIcons(audio.paused ? 'play' : 'pause');
        // re-observa: se o lote nao encheu a tela, o observador dispara de novo
        if (io && shown < current.length) { io.unobserve($('sentinel')); io.observe($('sentinel')); }
    }

    // rola ate o beat do link ?beat=ID e destaca (uma vez so)
    function focusBeat() {
        var id = BEAT_PARAM;
        BEAT_PARAM = null;
        if (!id) return;
        var b = findBeat(id);
        if (!b) { toast('Esse beat não está mais disponível.'); return; }

        // a rolagem infinita desenha em lotes: desenha ate o beat aparecer
        var idx = current.indexOf(b);
        while (idx > -1 && shown <= idx && shown < current.length) appendMore();

        var cards = document.querySelectorAll('[data-card]');
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].getAttribute('data-card') !== id) continue;
            cards[i].scrollIntoView({ block: 'center' });
            cards[i].classList.add('is-highlight');
            (function (el) { setTimeout(function () { el.classList.remove('is-highlight'); }, 5200); })(cards[i]);
            return;
        }
    }

    // busca sem resultado (so o termo, nada mais): espera a pessoa parar de digitar
    var emptyTimer = null, lastEmptyTerm = '';
    function trackEmptySearch() {
        var q = filter.q;
        if (!q || filter.type || filter.genre || filter.producer || current.length) return;
        emptyTimer = setTimeout(function () {
            var t = String(q).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
            if (!t || t === lastEmptyTerm) return;
            if (/\d{6,}|@|https?:|www\./.test(t)) return;      // nada que pareca telefone, e-mail ou link
            lastEmptyTerm = t;
            track('search_empty', { term: t });
        }, 1500);
    }

    function renderBeats() {
        var box = $('beatsList');
        clearTimeout(emptyTimer);

        if (!BEATS.length) {
            $('toolbar').hidden = true;
            $('sentinel').hidden = true;
            box.className = 'beats-list is-' + view;
            box.innerHTML =
                '<div class="state-box"><strong>Novos beats chegando</strong>' +
                'Ainda estamos preparando o catálogo. Volte em breve.</div>';
            return;
        }

        $('toolbar').hidden = false;
        current = computeList();
        shown = 0;
        updateCount();
        box.className = 'beats-list is-' + view;

        if (!current.length) {
            $('sentinel').hidden = true;
            var hasFilters = filter.q || filter.type || filter.genre || filter.producer;
            var ask = filter.q
                ? '<a class="state-link" target="_blank" rel="noopener" href="https://wa.me/' + CFG.WHATSAPP + '?text=' +
                    encodeURIComponent('Salve! Procurei "' + filter.q + '" no Wav Lab e não achei. Vocês fazem um beat nesse estilo?') +
                    '">Pedir esse beat no WhatsApp</a>'
                : '';
            box.innerHTML =
                '<div class="state-box"><strong>' + (filter.q ? 'Nada encontrado para “' + esc(filter.q) + '”' : 'Nenhum beat com esse filtro') + '</strong>' +
                'Tente outro nome, artista, gênero ou produtor.<br>' +
                (hasFilters ? '<button data-clear-filters>Limpar busca e filtros</button>' : '') + ask + '</div>';
            trackEmptySearch();
            return;
        }

        box.innerHTML = '';
        appendMore();
    }

    // =========================================================
    // MODAL DE COMPRA
    // =========================================================
    var modal = $('purchaseModal');
    var currentBeat = null;
    var selectedLicense = LICENSES[0];

    function renderLicenses() {
        $('licenseOptions').innerHTML = LICENSES.map(function (lic) {
            var on = lic.id === selectedLicense.id;
            return '' +
            '<label class="license-option' + (on ? ' selected' : '') + '">' +
                '<div class="license-left">' +
                    '<input type="radio" name="license" value="' + lic.id + '"' + (on ? ' checked' : '') + '>' +
                    '<div class="license-info"><h5>' + esc(lic.name) + '</h5><p>' + esc(lic.desc) + '</p></div>' +
                '</div>' +
                '<span class="license-price">' + brl(lic.price) + '</span>' +
                '<ul class="license-terms">' + (lic.terms || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
            '</label>';
        }).join('');
    }

    function commonTerms() {
        return (CFG.COMMON_TERMS || []).map(function (t) {
            return t.replace('nome do produtor', currentBeat ? currentBeat.producer.name : 'nome do produtor');
        });
    }

    // texto exato da licenca que o cliente viu (fica salvo no pedido)
    function termsSnapshot() {
        return selectedLicense.name + ' - ' + brl(selectedLicense.price) + '\n' +
            (selectedLicense.terms || []).map(function (t) { return '- ' + t; }).join('\n') +
            '\n\nRegras gerais:\n' + commonTerms().map(function (t) { return '- ' + t; }).join('\n');
    }

    function updateCheckoutLink() {
        if (!currentBeat) return;
        var msg = 'Salve! Quero comprar o beat *' + currentBeat.title + '* (prod. ' + currentBeat.producer.name +
            ') do Wav Lab na licença *' + selectedLicense.name + '* por *' + brl(selectedLicense.price) + '*. Como faço o Pix?';
        $('whatsappCheckoutBtn').href = 'https://wa.me/' + CFG.WHATSAPP + '?text=' + encodeURIComponent(msg);
    }

    function openModal(beatId) {
        currentBeat = findBeat(beatId);
        if (!currentBeat) return;
        selectedLicense = LICENSES[0];
        $('modalBeatTitle').textContent = currentBeat.title;

        var mHref = producerHref(currentBeat.producer);
        var credit = esc('Prod. ' + currentBeat.producer.name);
        var sub = [mHref ? '<a href="' + esc(mHref) + '">' + credit + '</a>' : credit];
        if (currentBeat.bpm) sub.push(esc(currentBeat.bpm) + ' BPM');
        if (currentBeat.key) sub.push(esc(currentBeat.key));
        $('modalSub').innerHTML = sub.join(' · ');

        $('modalNote').hidden = !currentBeat.note;
        $('modalNote').textContent = currentBeat.note ? '“' + currentBeat.note + '”' : '';

        $('licenseNotes').innerHTML = commonTerms().map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
        renderLicenses();
        updateCheckoutLink();
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    // link do beat: <esta pagina>?beat=ID
    function copyText(text, done) {
        function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            var okCopy = false;
            try { okCopy = document.execCommand('copy'); } catch (err) { /* sem permissao */ }
            document.body.removeChild(ta);
            done(okCopy);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        else fallback();
    }

    $('copyLinkBtn').addEventListener('click', function () {
        if (!currentBeat) return;
        var u = new URL(window.location.href);
        var keepP = (document.body.getAttribute('data-producer') === 'url') ? u.searchParams.get('p') : null;
        u.search = '';
        u.hash = '';
        if (keepP) u.searchParams.set('p', keepP);
        u.searchParams.set('beat', currentBeat.id);
        copyText(u.toString(), function (okCopy) { toast(okCopy ? 'Link do beat copiado.' : 'Não foi possível copiar. Copie o endereço do navegador.'); });
    });

    $('licenseOptions').addEventListener('change', function (e) {
        for (var i = 0; i < LICENSES.length; i++) {
            if (LICENSES[i].id === e.target.value) selectedLicense = LICENSES[i];
        }
        renderLicenses();
        updateCheckoutLink();
    });

    // registra o pedido (lead) quando a pessoa toca em "Finalizar"
    $('whatsappCheckoutBtn').addEventListener('click', function () {
        if (!db || !currentBeat) return;
        track('checkout', { beat: currentBeat.id, license: selectedLicense.id });
        try {
            // colunas antigas (continuam preenchidas) + colunas do catalogo + texto exato dos termos
            var row = {
                beat_id: currentBeat.type === 'beat' ? currentBeat.id : null,
                beat_title: currentBeat.title,
                license_id: selectedLicense.id,
                price: selectedLicense.price
            };
            var full = Object.assign({}, row, {
                terms_snapshot: termsSnapshot(),
                product_id: currentBeat.id,
                product_type: currentBeat.type,
                product_title: currentBeat.title,
                option_id: selectedLicense.id
            });
            db.from('orders').insert(full).then(function (r) {
                // banco sem o catalogo (migracao 001): salva o pedido no formato antigo
                if (r && r.error) return db.from('orders').insert(row);
            }).then(function () {}, function () {});
        } catch (err) { /* nunca atrapalha a compra */ }
    });

    // =========================================================
    // PLAYER (um so audio para a pagina toda)
    // =========================================================
    var audio = new Audio();
    audio.preload = 'none';
    var playingId = null;

    function previewLength() {
        var d = audio.duration;
        return (isFinite(d) && d > 0) ? Math.min(d, PREVIEW_SECONDS) : PREVIEW_SECONDS;
    }

    function setIcon(el, icon) {
        if (!el) return;
        var i = el.querySelector('i');
        if (i) i.className = 'fa-solid ' + icon;
    }

    function syncIcons(state) {
        var icon = state === 'pause' ? 'fa-pause' : state === 'loading' ? 'fa-spinner fa-spin' : 'fa-play';
        var btns = document.querySelectorAll('[data-play]');
        for (var i = 0; i < btns.length; i++) {
            setIcon(btns[i], btns[i].getAttribute('data-play') === playingId ? icon : 'fa-play');
        }
        var cards = document.querySelectorAll('[data-card]');
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.toggle('is-active', cards[j].getAttribute('data-card') === playingId);
        }
        setIcon($('mpPlay'), icon);
    }

    function showMiniPlayer(beat) {
        $('mpTitle').textContent = beat.title;
        $('mpCover').style.setProperty('--g', beat.genre.color);
        $('mpCover').innerHTML = coverHTML(beat);
        $('mpCurrent').textContent = '0:00';
        $('mpDuration').textContent = fmtTime(PREVIEW_SECONDS);
        $('mpFill').style.width = '0%';
        $('miniPlayer').classList.add('visible');
        $('miniPlayer').setAttribute('aria-hidden', 'false');
        document.body.classList.add('player-on');
    }

    function play(beatId) {
        var beat = findBeat(beatId);
        if (!beat) return;

        if (playingId === beatId) {
            if (audio.paused) {
                // so conta como novo play se recomecou do zero (pausar e retomar nao conta de novo)
                if (audio.currentTime === 0 || audio.currentTime >= previewLength()) track('play', { beat: beatId });
                if (audio.currentTime >= previewLength()) audio.currentTime = 0;
                audio.play().catch(onError);
            } else {
                audio.pause();
            }
            return;
        }

        audio.pause();
        playingId = beatId;
        track('play', { beat: beatId });
        audio.src = beat.audio;
        audio.currentTime = 0;
        showMiniPlayer(beat);
        syncIcons('loading');
        audio.play().catch(onError);
    }

    function onError() {
        syncIcons('play');
        toast('Não foi possível carregar o áudio. Confira sua conexão.');
    }

    audio.addEventListener('playing', function () { syncIcons('pause'); });
    audio.addEventListener('waiting', function () { syncIcons('loading'); });
    audio.addEventListener('pause', function () { syncIcons('play'); });
    audio.addEventListener('error', function () { if (playingId) onError(); });

    audio.addEventListener('loadedmetadata', function () {
        $('mpDuration').textContent = fmtTime(previewLength());
    });

    audio.addEventListener('timeupdate', function () {
        var limit = previewLength();
        if (audio.currentTime >= limit) {
            audio.pause();
            audio.currentTime = 0;
            $('mpCurrent').textContent = '0:00';
            $('mpFill').style.width = '0%';
            toast('Fim do preview. Curtiu? Escolha sua licença.');
            return;
        }
        $('mpCurrent').textContent = fmtTime(audio.currentTime);
        $('mpFill').style.width = (audio.currentTime / limit * 100) + '%';
    });

    audio.addEventListener('ended', function () {
        audio.currentTime = 0;
        syncIcons('play');
    });

    $('mpProgress').addEventListener('click', function (e) {
        if (!playingId) return;
        var rect = this.getBoundingClientRect();
        var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * previewLength();
    });

    $('mpPlay').addEventListener('click', function () {
        if (playingId) play(playingId);
    });

    // =========================================================
    // EM BREVE NO LAB (lista de espera: nome + WhatsApp)
    // =========================================================
    var SOON = CFG.COMING_SOON;
    var waitModal = $('waitModal');

    function setWaitStatus(msg, isErr) {
        $('waitStatus').textContent = msg || '';
        $('waitStatus').classList.toggle('err', !!isErr);
    }

    // so digitos, com 55 + DDD (aceita "(91) 98544-7000", "91985447000", "+55 91 98544-7000")
    function normPhone(v) {
        var d = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
        if (d.length >= 10 && d.length <= 11) d = '55' + d;
        return /^\d{12,15}$/.test(d) ? d : '';
    }

    function markJoined() {
        var b = $('soonBtn');
        b.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> ' + esc(SOON.JOINED || 'Você está na lista');
        b.classList.add('joined');
        b.disabled = true;
    }

    function showWaitDone() {
        lsSet('wavlab_wait', '1');
        markJoined();
        $('waitForm').hidden = true;
        $('waitDone').hidden = false;
    }

    function openWait() {
        setWaitStatus('');
        $('waitForm').hidden = false;
        $('waitDone').hidden = true;
        waitModal.classList.add('active');
        document.body.classList.add('modal-open');
    }

    function closeWait() {
        if (!waitModal) return;
        waitModal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    if (SOON && $('soon')) {
        $('soonTitle').textContent = SOON.TITLE || 'Em breve';
        $('soonItems').innerHTML = (SOON.ITEMS || []).map(function (it) {
            var icon = /^fa-[a-z0-9-]+$/.test(it.icon || '') ? it.icon : 'fa-star';
            return '<div class="soon-item"><i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
                '<div><h4>' + esc(it.name) + '</h4><p>' + esc(it.desc) + '</p></div></div>';
        }).join('');
        $('soonBtn').textContent = SOON.BUTTON || 'Quero ser avisado';
        $('waitTitle').textContent = SOON.BUTTON || 'Quero ser avisado';
        $('waitSend').textContent = SOON.BUTTON || 'Quero ser avisado';
        $('waitIntro').textContent = SOON.FORM_INTRO || '';
        $('waitNote').textContent = SOON.NOTE || '';
        $('waitDoneText').textContent = SOON.DONE || '';
        $('soon').hidden = false;
        if (lsGet('wavlab_wait')) markJoined();

        $('soonBtn').addEventListener('click', openWait);

        $('waitForm').addEventListener('submit', function (e) {
            e.preventDefault();
            if ($('waitHp').value) { showWaitDone(); return; }      // campo-armadilha preenchido: e robo, finge que deu certo
            var name = $('waitName').value.replace(/\s+/g, ' ').trim().slice(0, 60);
            var phone = normPhone($('waitPhone').value);
            if (name.length < 2) { setWaitStatus('Escreva seu nome.', true); $('waitName').focus(); return; }
            if (!phone) { setWaitStatus('Confira o WhatsApp: use DDD + número, por exemplo (91) 90000-0000.', true); $('waitPhone').focus(); return; }
            var client = getDb();
            if (!client) { setWaitStatus('Sem conexão com o servidor. Recarregue a página.', true); return; }

            function fail() { $('waitSend').disabled = false; setWaitStatus('Não foi possível salvar agora. Tente de novo em instantes.', true); }
            $('waitSend').disabled = true;
            setWaitStatus('Enviando...');
            client.from('waitlist').insert({ name: name, whatsapp: phone }).then(function (r) {
                if (r && r.error) { fail(); return; }
                $('waitSend').disabled = false;
                showWaitDone();
            }, fail);
        });
    }

    // =========================================================
    // EVENTOS GERAIS
    // =========================================================
    document.addEventListener('click', function (e) {
        if (e.target.closest('[data-retry]')) { loadBeats(); return; }

        var vw = e.target.closest('[data-view]');
        if (vw) {
            var v = vw.getAttribute('data-view');
            if (v !== view) { view = v; lsSet('wavlab_view', v); renderBeats(); }
            return;
        }

        var term = e.target.closest('[data-term]');
        if (term) {
            var t = term.getAttribute('data-term');
            var same = norm(filter.q).trim() === norm(t).trim();
            setQuery(same ? '' : t);
            // clique numa tag la embaixo: leva o olhar de volta para a busca
            if (term.closest('#beatsList') && !same) {
                var top = $('searchForm').getBoundingClientRect().top + window.pageYOffset - 84;
                window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            }
            return;
        }

        var ft = e.target.closest('[data-filter-type]');
        if (ft) { filter.type = ft.getAttribute('data-filter-type') || null; renderControls(); renderBeats(); return; }

        var fg = e.target.closest('[data-filter-genre]');
        if (fg) { filter.genre = fg.getAttribute('data-filter-genre') || null; renderControls(); renderBeats(); return; }

        var fp = e.target.closest('[data-filter-producer]');
        if (fp) {
            var pid = fp.getAttribute('data-filter-producer');
            filter.producer = (filter.producer === pid) ? null : pid;   // tocar de novo desmarca
            renderControls();
            renderBeats();
            return;
        }

        if (e.target.closest('[data-clear-filters]')) {
            filter.type = null; filter.genre = null; filter.producer = null;
            renderControls();
            setQuery('');
            return;
        }

        var buy = e.target.closest('[data-buy]');
        if (buy) { track('license_click', { beat: buy.getAttribute('data-buy') }); openModal(buy.getAttribute('data-buy')); return; }

        var p = e.target.closest('[data-play]');
        if (p) { play(p.getAttribute('data-play')); return; }

        if (e.target.closest('[data-close-wait]') || (waitModal && e.target === waitModal)) { closeWait(); return; }

        if (e.target.closest('[data-close-modal]') || e.target === modal) closeModal();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (modal.classList.contains('active')) closeModal();
        if (waitModal && waitModal.classList.contains('active')) closeWait();
    });

    // rolagem infinita: quando o fim da lista chega perto da tela, entra o proximo lote
    if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) appendMore();
        }, { rootMargin: '700px 0px' });
        io.observe($('sentinel'));
    }

    // link com busca pronta: ?q=drake
    try {
        var q0 = new URLSearchParams(window.location.search).get('q');
        if (q0 && SEARCH_ON && !BEAT_PARAM) { filter.q = q0.slice(0, 60); $('searchInput').value = filter.q; $('searchClear').hidden = false; }
    } catch (e) { /* sem URLSearchParams */ }

    loadBeats();
})();
