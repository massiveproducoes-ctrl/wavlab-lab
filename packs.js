// @ts-nocheck
/* Wav Lab - secao de packs (packs.js). Lista, pagina do pack (?pack=slug), demo e compra. Configuracao em config.js */
(function () {
    'use strict';

    var CFG = window.WAVLAB;
    var PACK_TYPES = CFG.PACK_TYPES || [];
    var TYPE_ONE = CFG.PRODUCT_TYPES_ONE || {};
    var TERMS = CFG.PACK_TERMS || [];
    var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    var PACKS = [];
    var db = null;
    var filter = { type: null, q: '' };

    var PACK_SLUG = null;
    try {
        var ps = new URLSearchParams(window.location.search).get('pack');
        if (ps !== null) PACK_SLUG = (ps.length <= 120 && SLUG_RE.test(ps)) ? ps : '?';     // '?' nunca e um slug: cai em "Pack nao encontrado"
    } catch (e) { /* sem URLSearchParams */ }

    // =========================================================
    // HELPERS
    // =========================================================
    function $(id) { return document.getElementById(id); }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function brl(n) {
        n = Number(n);
        var d = (n % 1) ? 2 : 0;
        return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: 2 });
    }

    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* navegador antigo */ }
        return s;
    }

    function initials(text) {
        return String(text || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    }

    function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#ff5500'; }

    function fmtTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function fill(tpl, map) {
        return String(tpl || '').replace(/\{(\w+)\}/g, function (all, k) { return map[k] != null ? map[k] : all; });
    }

    function priceText(p) {
        if (p.price == null) return 'Sob consulta';
        return Number(p.price) === 0 ? 'Grátis' : brl(p.price);
    }

    function typeLabel(t) { return TYPE_ONE[t] || t; }

    var toastTimer = null;
    function toast(msg) {
        var t = $('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
    }

    function getDb() {
        if (!db && window.supabase) {
            db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });
        }
        return db;
    }

    // Eventos simples (play, finalizar). Sem IP, sem identificador. Nunca atrapalha a pagina.
    function track(type, f) {
        if (!getDb()) return;
        try {
            var row = { type: type };
            if (f && f.pack) row.product_id = f.pack;
            db.from('events').insert(row).then(function () {}, function () {});
        } catch (err) { /* nunca atrapalha */ }
    }

    // capa que nao carrega: esconde a imagem e deixa so o degrade com as iniciais
    document.addEventListener('error', function (e) {
        var el = e.target;
        if (el && el.tagName === 'IMG' && el.closest && el.closest('.bcover')) el.style.display = 'none';
    }, true);

    // =========================================================
    // DADOS
    // =========================================================
    var BADGE_FIELDS = 'slug,name,description,icon,kind,sort';

    function badgeList(rows) {
        return (rows || []).map(function (x) {
            var b = x && x.badges;
            return Array.isArray(b) ? b[0] : b;
        }).filter(function (b) {
            return b && b.kind === 'titulo' && SLUG_RE.test(b.icon || '') && b.name;
        }).sort(function (a, c) { return (a.sort == null ? 100 : a.sort) - (c.sort == null ? 100 : c.sort); });
    }

    function badgesHTML(list) {
        if (!list || !list.length) return '';
        return '<span class="pbadges">' + list.map(function (b) {
            return '<img class="pbadge" src="icons/badges/' + esc(b.icon) + '.svg" width="14" height="14" alt="' + esc(b.name) + '" title="' + esc(b.name + ' · Wav Lab') + '">';
        }).join('') + '</span>';
    }

    function packCols(withBadges) {
        return 'id,type,slug,title,description,price,cover_url,preview_url,tags,details,created_at,' +
            'producers(id,name,photo_url,slug,active' + (withBadges ? ',producer_badges(badges(' + BADGE_FIELDS + '))' : '') + '),' +
            'genres(id,name,color)';
    }

    // base da consulta: so packs publicados dos tipos da secao
    function baseQuery(withBadges) {
        return db.from('products').select(packCols(withBadges)).eq('published', true).in('type', PACK_TYPES);
    }

    // sem a migracao 004 (insignias), tenta de novo sem elas
    function withFallback(build) {
        return build(true).then(function (res) {
            return (res.error && /badge/.test(res.error.message || '')) ? build(false) : res;
        });
    }

    function normalize(r) {
        var p = r.producers || null;
        var g = r.genres || {};
        var d = (r.details && typeof r.details === 'object') ? r.details : {};
        var pack = {
            id: r.id,
            type: r.type,
            slug: r.slug,
            title: r.title,
            desc: r.description || '',
            price: r.price,
            cover: r.cover_url,
            audio: r.preview_url,
            tags: r.tags || [],
            details: d,
            color: safeColor(g.color),
            producer: p ? { id: p.id, name: p.name, photo: p.photo_url, slug: p.slug || null, active: p.active !== false, badges: badgeList(p.producer_badges) } : null
        };
        pack.hay = norm([pack.title, pack.desc, pack.tags.join(' '), typeLabel(pack.type), p ? p.name : ''].join(' '));
        return pack;
    }

    function find(id) {
        for (var i = 0; i < PACKS.length; i++) if (PACKS[i].id === id) return PACKS[i];
        return null;
    }

    // =========================================================
    // RENDER COMUM
    // =========================================================
    function coverHTML(p) {
        return (p.cover ? '<img src="' + esc(p.cover) + '" alt="" loading="lazy">' : '') + '<span>' + esc(initials(p.title)) + '</span>';
    }

    function playBtn(p) {
        return p.audio
            ? '<button class="play-btn" data-play="' + esc(p.id) + '" aria-label="Ouvir a demo de ' + esc(p.title) + '"><i class="fa-solid fa-play"></i></button>'
            : '';
    }

    function producerHref(pr) {
        return (pr && pr.slug && pr.active && SLUG_RE.test(pr.slug)) ? 'produtor.html?p=' + encodeURIComponent(pr.slug) : null;
    }

    function producerHTML(pr) {
        var name = pr ? pr.name : 'Wav Lab';
        var avatar = (pr && pr.photo) ? '<img src="' + esc(pr.photo) + '" alt="" loading="lazy">' : esc(initials(name));
        var href = producerHref(pr);
        return (href ? '<a class="bprod" href="' + esc(href) + '" title="Ver a página de ' + esc(name) + '">' : '<div class="bprod">') +
            '<span class="avatar">' + avatar + '</span><span class="producer-name">' + esc(name) + '</span>' + badgesHTML(pr && pr.badges) +
            (href ? '</a>' : '</div>');
    }

    function packHref(p) { return 'packs.html?pack=' + encodeURIComponent(p.slug); }

    // =========================================================
    // LISTA
    // =========================================================
    function cardHTML(p) {
        var free = p.price != null && Number(p.price) === 0;
        return '' +
        '<article class="bcard" data-card="' + esc(p.id) + '">' +
            '<div class="bcover" style="--g:' + p.color + '">' + coverHTML(p) + playBtn(p) + '</div>' +
            '<div class="bbody">' +
                '<h3 class="btitle" title="' + esc(p.title) + '"><a href="' + esc(packHref(p)) + '">' + esc(p.title) + '</a></h3>' +
                producerHTML(p.producer) +
                '<div class="bmeta"><span class="genre-pill">' + esc(typeLabel(p.type)) + '</span>' +
                    '<span class="pk-price-tag' + (free ? ' free' : '') + '">' + esc(priceText(p)) + '</span></div>' +
                '<a class="buy-btn" href="' + esc(packHref(p)) + '">Ver pack</a>' +
            '</div>' +
        '</article>';
    }

    function computeList() {
        var toks = norm(filter.q).split(/\s+/).filter(Boolean);
        return PACKS.filter(function (p) {
            if (filter.type && p.type !== filter.type) return false;
            for (var i = 0; i < toks.length; i++) if (p.hay.indexOf(toks[i]) === -1) return false;
            return true;
        });
    }

    function renderTypeChips() {
        var box = $('typeChips');
        var order = [], counts = {};
        PACKS.forEach(function (p) {
            if (!counts[p.type]) { counts[p.type] = 0; order.push(p.type); }
            counts[p.type]++;
        });
        if (order.length < 2) { filter.type = null; box.hidden = true; box.innerHTML = ''; return; }
        box.hidden = false;
        box.innerHTML =
            '<button class="chip chip-all' + (!filter.type ? ' active' : '') + '" data-filter-type="">Todos <span>' + PACKS.length + '</span></button>' +
            order.map(function (t) {
                return '<button class="chip' + (filter.type === t ? ' active' : '') + '" data-filter-type="' + esc(t) + '">' + esc(typeLabel(t)) + ' <span>' + counts[t] + '</span></button>';
            }).join('');
    }

    var emptyTimer = null, lastEmptyTerm = '';

    function renderList() {
        var box = $('packsList');
        clearTimeout(emptyTimer);
        renderTypeChips();

        if (!PACKS.length) {
            $('toolbar').hidden = true;
            box.innerHTML = '<div class="state-box"><strong>Novos packs chegando</strong>Ainda estamos preparando esta seção. Volte em breve.</div>';
            return;
        }

        var list = computeList();
        $('toolbar').hidden = false;
        $('resultCount').textContent = filter.q
            ? list.length + (list.length === 1 ? ' resultado' : ' resultados') + ' para “' + filter.q + '”'
            : list.length + (list.length === 1 ? ' pack' : ' packs');

        if (!list.length) {
            box.innerHTML =
                '<div class="state-box"><strong>' + (filter.q ? 'Nada encontrado para “' + esc(filter.q) + '”' : 'Nenhum pack com esse filtro') + '</strong>' +
                'Tente outro nome, tag ou tipo.<br><button data-clear-filters>Limpar busca e filtros</button></div>';
            if (filter.q && !filter.type) {
                emptyTimer = setTimeout(function () {
                    var t = String(filter.q).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
                    if (!t || t === lastEmptyTerm || /\d{6,}|@|https?:|www\./.test(t) || !getDb()) return;
                    lastEmptyTerm = t;
                    try { db.from('events').insert({ type: 'search_empty', term: t }).then(function () {}, function () {}); } catch (err) { /* nunca atrapalha */ }
                }, 1500);
            }
            return;
        }
        box.innerHTML = list.map(cardHTML).join('');
        syncIcons();
    }

    function showSkeleton() {
        var html = '';
        for (var i = 0; i < 6; i++) html += '<div class="skeleton"></div>';
        $('packsList').innerHTML = html;
    }

    function showError(target) {
        $('toolbar').hidden = true;
        $(target).innerHTML =
            '<div class="state-box"><strong>Não foi possível carregar os packs</strong>' +
            'Confira sua conexão e tente de novo.<br><button data-retry>Tentar de novo</button></div>';
    }

    // busca
    var searchTimer = null;
    function setQuery(v, fromInput) {
        filter.q = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!fromInput) $('searchInput').value = filter.q;
        $('searchClear').hidden = !$('searchInput').value;
        renderList();
    }

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
        $('searchInput').blur();
    });
    $('searchClear').addEventListener('click', function () { setQuery(''); $('searchInput').focus(); });

    // =========================================================
    // DEMO (um so audio para a pagina toda)
    // =========================================================
    var audio = new Audio();
    audio.preload = 'none';
    var playingId = null;

    function syncIcons() {
        var btns = document.querySelectorAll('[data-play]');
        for (var i = 0; i < btns.length; i++) {
            var on = btns[i].getAttribute('data-play') === playingId && !audio.paused;
            var ic = btns[i].querySelector('i');
            if (ic) ic.className = on ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        }
        var cards = document.querySelectorAll('[data-card]');
        for (var j = 0; j < cards.length; j++) cards[j].classList.toggle('is-active', cards[j].getAttribute('data-card') === playingId && !audio.paused);
    }

    function togglePlay(id) {
        var p = find(id);
        if (!p || !p.audio) return;
        if (playingId === id) {
            if (audio.paused) audio.play().catch(onAudioError); else audio.pause();
            return;
        }
        audio.pause();
        playingId = id;
        track('play', { pack: id });
        audio.src = p.audio;
        audio.currentTime = 0;
        audio.play().catch(onAudioError);
        updateProgress();
        syncIcons();
    }

    function onAudioError() {
        toast('Não foi possível tocar a demo agora.');
        playingId = null;
        syncIcons();
    }

    function updateProgress() {
        var fillEl = $('pkFill'), timeEl = $('pkTime');
        if (!fillEl || !timeEl) return;
        var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        var cur = playingId ? audio.currentTime : 0;
        fillEl.style.width = dur ? Math.min(100, cur / dur * 100) + '%' : '0';
        timeEl.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
    }

    audio.addEventListener('play', syncIcons);
    audio.addEventListener('pause', syncIcons);
    audio.addEventListener('ended', function () { audio.currentTime = 0; syncIcons(); updateProgress(); });
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('error', function () { if (playingId) onAudioError(); });

    // =========================================================
    // PAGINA DE UM PACK
    // =========================================================
    var currentPack = null;

    function termsText(p) {
        return p.title + ' - ' + priceText(p) + '\n\nTermos de uso:\n' + TERMS.map(function (t) { return '- ' + t; }).join('\n');
    }

    function buyLabel(p) {
        if (p.price == null) return 'Consultar preço no WhatsApp';
        return Number(p.price) === 0 ? 'Quero este pack' : 'Comprar via Pix (WhatsApp)';
    }

    function buyHref(p) {
        var tpl = p.price == null ? CFG.PACK_WA_TEXT_ASK : Number(p.price) === 0 ? CFG.PACK_WA_TEXT_FREE : CFG.PACK_WA_TEXT;
        var msg = fill(tpl, { pack: p.title, produtor: p.producer ? p.producer.name : 'Wav Lab', preco: priceText(p) });
        return 'https://wa.me/' + CFG.WHATSAPP + '?text=' + encodeURIComponent(msg);
    }

    function factsHTML(p) {
        var d = p.details, items = [];
        if (d.file_count) items.push(['Arquivos', String(d.file_count)]);
        if (d.formats) items.push(['Formatos', d.formats]);
        if (d.total_size) items.push(['Tamanho total', d.total_size]);
        if (d.bpm) items.push(['BPM', d.bpm]);
        if (d.key) items.push(['Tom', d.key]);
        if (!items.length) return '';
        return '<div class="pk-facts">' + items.map(function (x) {
            return '<div class="pk-fact"><div class="pk-fact-label">' + esc(x[0]) + '</div><div class="pk-fact-val">' + esc(x[1]) + '</div></div>';
        }).join('') + '</div>';
    }

    function renderPack(p) {
        currentPack = p;
        document.title = p.title + ' | Wav Lab';
        var free = p.price != null && Number(p.price) === 0;
        $('packView').innerHTML =
            '<a class="pk-back" href="packs.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Todos os packs</a>' +
            '<article class="pk">' +
                '<div class="pk-media">' +
                    '<div class="bcover pk-cover" style="--g:' + p.color + '">' + coverHTML(p) + playBtn(p) + '</div>' +
                    (p.audio ? '<div class="pk-player"><div class="pk-track"><div class="pk-fill" id="pkFill"></div></div><span class="pk-time" id="pkTime">0:00 / 0:00</span></div>' : '') +
                '</div>' +
                '<div class="pk-info">' +
                    '<span class="genre-pill">' + esc(typeLabel(p.type)) + '</span>' +
                    '<h2 class="pk-title">' + esc(p.title) + '</h2>' +
                    producerHTML(p.producer) +
                    '<div class="pk-price' + (free ? ' free' : '') + '">' + esc(priceText(p)) + '</div>' +
                    (p.desc ? '<p class="pk-desc">' + esc(p.desc) + '</p>' : '') +
                    factsHTML(p) +
                    (p.details.inside ? '<div class="pk-inside"><h3 class="section-label">O que tem dentro</h3><p>' + esc(p.details.inside) + '</p></div>' : '') +
                    (p.tags.length ? '<div class="pk-tags">' + p.tags.map(function (t) { return '<span class="pk-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
                    (TERMS.length ? '<section class="pk-terms"><h3 class="section-label">Termos de uso</h3><ul class="license-notes">' +
                        TERMS.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>' : '') +
                    '<div class="pk-buy">' +
                        '<a id="buyBtn" class="checkout-btn" href="' + esc(buyHref(p)) + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> ' + esc(buyLabel(p)) + '</a>' +
                        '<button type="button" class="link-btn" id="copyLinkBtn"><i class="fa-solid fa-link" aria-hidden="true"></i> Copiar link</button>' +
                    '</div>' +
                '</div>' +
            '</article>';
        $('packsView').hidden = true;
        $('packView').hidden = false;
        updateProgress();
    }

    function showNotFound() {
        document.title = 'Pack não encontrado | Wav Lab';
        $('packsView').hidden = true;
        $('packView').hidden = false;
        $('packView').innerHTML =
            '<div class="state-box"><strong>Pack não encontrado</strong>' +
            'Ele pode ter saído do ar. <br><a class="state-link" href="packs.html">Ver todos os packs</a></div>';
    }

    // registra o pedido (lead) quando a pessoa toca em comprar: o texto dos termos e o que ela viu na pagina
    function recordOrder(p) {
        if (!getDb()) return;
        track('checkout', { pack: p.id });
        try {
            var row = {
                product_id: p.id,
                product_type: p.type,
                product_title: p.title,
                option_id: 'unica',
                terms_snapshot: termsText(p)
            };
            if (p.price != null) row.price = p.price;
            db.from('orders').insert(row).then(function () {}, function () {});
        } catch (err) { /* nunca atrapalha a compra */ }
    }

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

    // =========================================================
    // EVENTOS DA PAGINA
    // =========================================================
    document.addEventListener('click', function (e) {
        var play = e.target.closest('[data-play]');
        if (play) { togglePlay(play.getAttribute('data-play')); return; }

        var ft = e.target.closest('[data-filter-type]');
        if (ft) { filter.type = ft.getAttribute('data-filter-type') || null; renderList(); return; }

        if (e.target.closest('[data-clear-filters]')) { filter.type = null; setQuery(''); return; }
        if (e.target.closest('[data-retry]')) { load(); return; }

        if (e.target.closest('#buyBtn') && currentPack) { recordOrder(currentPack); return; }

        if (e.target.closest('#copyLinkBtn') && currentPack) {
            var u = new URL(window.location.href);
            u.search = '';
            u.hash = '';
            u.searchParams.set('pack', currentPack.slug);
            copyText(u.toString(), function (okCopy) { toast(okCopy ? 'Link do pack copiado.' : 'Não foi possível copiar. Copie o endereço do navegador.'); });
        }
    });

    // =========================================================
    // START
    // =========================================================
    function load() {
        if (!window.supabase || !getDb()) { showError(PACK_SLUG ? 'packView' : 'packsList'); return; }

        if (PACK_SLUG) {
            $('packsView').hidden = true;
            $('packView').hidden = false;
            if (PACK_SLUG === '?') { showNotFound(); return; }
            withFallback(function (b) { return baseQuery(b).eq('slug', PACK_SLUG).maybeSingle(); })
                .then(function (res) {
                    if (res.error) throw res.error;
                    if (!res.data) { showNotFound(); return; }
                    var p = normalize(res.data);
                    PACKS = [p];
                    renderPack(p);
                })
                .catch(function () { showError('packView'); });
            return;
        }

        showSkeleton();
        withFallback(function (b) { return baseQuery(b).order('created_at', { ascending: false }); })
            .then(function (res) {
                if (res.error) throw res.error;
                PACKS = (res.data || []).map(normalize);
                renderList();
            })
            .catch(function () { showError('packsList'); });
    }

    load();
})();
