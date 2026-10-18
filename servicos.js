// @ts-nocheck
/* Wav Lab - secao de servicos (servicos.js). Lista, pagina do servico (?servico=slug) e pedido de horario. Configuracao em config.js */
(function () {
    'use strict';

    var CFG = window.WAVLAB;
    var SERVICE_TYPES = CFG.SERVICE_TYPES || ['service', 'rental'];
    var TYPE_ONE = CFG.PRODUCT_TYPES_ONE || {};
    var PERIODS = CFG.SERVICE_PERIODS || [];
    var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    var SERVICES = [];
    var db = null;
    var current = null;         // servico do modal aberto

    var SERVICE_SLUG = null;
    try {
        var ss = new URLSearchParams(window.location.search).get('servico');
        if (ss !== null) SERVICE_SLUG = (ss.length <= 120 && SLUG_RE.test(ss)) ? ss : '?';     // '?' nunca e um slug: cai em "nao encontrado"
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

    function initials(text) {
        return String(text || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    }

    function fill(tpl, map) {
        return String(tpl || '').replace(/\{(\w+)\}/g, function (all, k) { return map[k] != null ? map[k] : all; });
    }

    // "2026-11-05" -> "05/11/2026"
    function fmtDate(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
    }

    // data de hoje no horario do aparelho, no formato do campo de data
    function todayISO() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    // so digitos, com 55 + DDD (aceita "(91) 98544-7000", "91985447000", "+55 91 98544-7000")
    function normPhone(v) {
        var d = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
        if (d.length >= 10 && d.length <= 11) d = '55' + d;
        return /^\d{12,15}$/.test(d) ? d : '';
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

    // capa que nao carrega: esconde a imagem e deixa so o degrade com as iniciais
    document.addEventListener('error', function (e) {
        var el = e.target;
        if (el && el.tagName === 'IMG' && el.closest && el.closest('.bcover')) el.style.display = 'none';
    }, true);

    // =========================================================
    // DADOS
    // =========================================================
    var COLS = 'id,type,slug,title,description,price,cover_url,tags,details,created_at';

    function normalize(r) {
        var d = (r.details && typeof r.details === 'object') ? r.details : {};
        return {
            id: r.id, type: r.type, slug: r.slug, title: r.title, desc: r.description || '',
            price: r.price, cover: r.cover_url, tags: r.tags || [], details: d
        };
    }

    function find(id) {
        for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i];
        return null;
    }

    // preco fixo ou "a partir de" (details.price_from); aluguel e por diaria
    function priceText(s) {
        if (s.price == null) return 'Sob consulta';
        if (Number(s.price) === 0) return 'Grátis';
        return (s.details.price_from ? 'a partir de ' : '') + brl(s.price) + (s.type === 'rental' ? ' / diária' : '');
    }

    function includedLines(s) {
        return String(s.details.inside || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    }

    function serviceHref(s) { return 'servicos.html?servico=' + encodeURIComponent(s.slug); }

    // =========================================================
    // RENDER
    // =========================================================
    function cardHTML(s, detail) {
        var inc = includedLines(s);
        var rental = s.type === 'rental';
        var meta = s.details.duration
            ? '<div class="sv-meta"><i class="fa-regular ' + (rental ? 'fa-file-lines' : 'fa-clock') + '" aria-hidden="true"></i><span>' +
                (rental ? '' : 'Duração: ') + esc(s.details.duration) + '</span></div>'
            : '';
        return '' +
        '<article class="sv-card' + (detail ? ' sv-detail' : '') + '" data-card="' + esc(s.id) + '">' +
            '<div class="bcover sv-cover" style="--g:#ff5500">' + (s.cover ? '<img src="' + esc(s.cover) + '" alt="" loading="lazy">' : '') + '<span>' + esc(initials(s.title)) + '</span></div>' +
            '<div class="sv-body">' +
                '<span class="genre-pill">' + esc(typeLabel(s.type)) + '</span>' +
                '<h3 class="sv-title">' + (detail ? esc(s.title) : '<a href="' + esc(serviceHref(s)) + '">' + esc(s.title) + '</a>') + '</h3>' +
                (detail && s.desc ? '<p class="sv-desc">' + esc(s.desc) + '</p>' : '') +
                meta +
                (inc.length ? '<ul class="sv-inc">' + inc.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '') +
                '<div class="sv-price">' + esc(priceText(s)) + '</div>' +
                '<button type="button" class="checkout-btn" data-ask="' + esc(s.id) + '"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> ' + (rental ? 'Solicitar aluguel' : 'Solicitar horário') + '</button>' +
                (detail ? '<button type="button" class="link-btn" id="copyLinkBtn"><i class="fa-solid fa-link" aria-hidden="true"></i> Copiar link</button>' : '') +
            '</div>' +
        '</article>';
    }

    function renderList() {
        var box = $('svList');
        if (!SERVICES.length) {
            box.innerHTML = '<div class="state-box"><strong>Novos serviços chegando</strong>Ainda estamos preparando esta seção. Volte em breve.</div>';
            return;
        }
        box.innerHTML = SERVICES.map(function (s) { return cardHTML(s, false); }).join('');
    }

    function renderDetail(s) {
        document.title = s.title + ' | Wav Lab';
        $('svDetailView').innerHTML = '<a class="sv-back" href="servicos.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Todos os serviços</a>' + cardHTML(s, true);
        $('svListView').hidden = true;
        $('svDetailView').hidden = false;
    }

    function showSkeleton() {
        var html = '';
        for (var i = 0; i < 3; i++) html += '<div class="skeleton"></div>';
        $('svList').innerHTML = html;
    }

    function showError(target) {
        $(target).innerHTML =
            '<div class="state-box"><strong>Não foi possível carregar os serviços</strong>' +
            'Confira sua conexão e tente de novo.<br><button data-retry>Tentar de novo</button></div>';
    }

    function showNotFound() {
        document.title = 'Serviço não encontrado | Wav Lab';
        $('svListView').hidden = true;
        $('svDetailView').hidden = false;
        $('svDetailView').innerHTML =
            '<div class="state-box"><strong>Serviço não encontrado</strong>Ele pode ter saído do ar.<br>' +
            '<a class="state-link" href="servicos.html">Ver todos os serviços</a></div>';
    }

    // =========================================================
    // MODAL: SOLICITAR HORARIO / ALUGUEL
    // =========================================================
    var modal = $('svModal');

    function setStatus(msg, isErr) {
        $('svStatus').textContent = msg || '';
        $('svStatus').classList.toggle('err', !!isErr);
    }

    function termsList(s) { return s.type === 'rental' ? (CFG.RENTAL_TERMS || []) : (CFG.SERVICE_TERMS || []); }

    function openAsk(id) {
        var s = find(id);
        if (!s) return;
        current = s;
        var rental = s.type === 'rental';
        var today = todayISO();

        $('svModalTitle').textContent = rental ? 'Solicitar aluguel' : 'Solicitar horário';
        $('svModalSub').textContent = s.title + ' · ' + priceText(s);
        $('svForm').reset();
        $('svForm').hidden = false;
        $('svDone').hidden = true;
        setStatus('');

        $('svDateLabel').textContent = rental ? 'Retirada' : 'Data desejada';
        $('svDate').min = today;
        $('svDate2Field').hidden = !rental;
        $('svDate2').min = today;
        $('svPeriodLabel').textContent = rental ? 'Período de retirada' : 'Período desejado';
        $('svPeriod').innerHTML = PERIODS.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');

        // aluguel: termo de responsabilidade + aceite obrigatorio; servico: condicoes do estudio
        var terms = termsList(s);
        $('svTerms').hidden = !terms.length;
        $('svTermsTitle').textContent = rental ? 'Termo de responsabilidade' : 'Condições';
        $('svTermsList').innerHTML = terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
        $('svAcceptWrap').hidden = !rental;
        $('svAcceptLabel').textContent = CFG.RENTAL_ACCEPT_LABEL || 'Li e aceito o termo de responsabilidade';

        $('svSend').disabled = false;
        $('svSend').textContent = rental ? 'Enviar pedido de aluguel' : 'Enviar pedido de horário';
        modal.classList.add('active');
        document.body.classList.add('modal-open');
        try { $('svName').focus(); } catch (e) { /* sem foco */ }
    }

    function closeAsk() {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    // texto que fica salvo no pedido: exatamente o que a pessoa viu e aceitou
    function termsSnapshot(s) {
        var rental = s.type === 'rental';
        var lines = termsList(s).map(function (t) { return '- ' + t; }).join('\n');
        return s.title + ' - ' + priceText(s) + '\n\n' +
            (rental ? 'Termo de responsabilidade:\n' : 'Condições:\n') + lines +
            (rental ? '\n\n' + (CFG.RENTAL_ACCEPT_LABEL || 'Li e aceito o termo de responsabilidade') + ': SIM' : '');
    }

    function showDone(ok, waUrl) {
        $('svForm').hidden = true;
        $('svDone').hidden = false;
        $('svDone').classList.toggle('warn', !ok);
        $('svDoneIcon').className = ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation';
        $('svDoneText').textContent = ok
            ? 'Pedido registrado! Falta só avisar o estúdio pelo WhatsApp para confirmar o horário.'
            : 'Não conseguimos registrar o pedido agora, mas você pode enviá-lo direto pelo WhatsApp.';
        $('svWaBtn').href = waUrl;
    }

    $('svForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var s = current;
        if (!s || !getDb()) return;
        var rental = s.type === 'rental';

        var name = $('svName').value.replace(/\s+/g, ' ').trim();
        var phone = normPhone($('svPhone').value);
        var date1 = $('svDate').value, date2 = rental ? $('svDate2').value : '';
        var period = $('svPeriod').value;
        var obs = $('svNotes').value.replace(/\s+/g, ' ').trim().slice(0, 500);
        var today = todayISO();

        if (name.length < 2) { setStatus('Escreva seu nome.', true); $('svName').focus(); return; }
        if (!phone) { setStatus('Confira o WhatsApp: precisa do DDD, ex.: (91) 90000-0000.', true); $('svPhone').focus(); return; }
        if (!date1) { setStatus(rental ? 'Escolha a data de retirada.' : 'Escolha a data desejada.', true); $('svDate').focus(); return; }
        if (date1 < today) { setStatus('Essa data já passou. Escolha uma data a partir de hoje.', true); $('svDate').focus(); return; }
        if (rental) {
            if (!date2) { setStatus('Escolha a data de devolução.', true); $('svDate2').focus(); return; }
            if (date2 < date1) { setStatus('A devolução não pode ser antes da retirada.', true); $('svDate2').focus(); return; }
            if (!$('svAccept').checked) { setStatus('Para alugar, marque que leu e aceita o termo de responsabilidade.', true); $('svAccept').focus(); return; }
        }
        if ($('svHp').value) { showDone(true, 'https://wa.me/' + CFG.WHATSAPP); return; }     // robo preencheu o campo-armadilha: finge sucesso, nao grava

        var details = rental
            ? ['Retirada: ' + fmtDate(date1), 'Devolução: ' + fmtDate(date2), 'Período de retirada: ' + period]
            : ['Data: ' + fmtDate(date1), 'Período: ' + period];
        var notes = details.join(' · ') + (obs ? ' · Obs: ' + obs : '');

        var waLines = [fill(CFG.SERVICE_WA_TEXT || 'Salve! Quero solicitar *{servico}* no Wav Lab.', { servico: s.title }), '', 'Nome: ' + name]
            .concat(details)
            .concat(obs ? ['Obs: ' + obs] : [])
            .concat(rental ? ['Aceitei o termo de responsabilidade do aluguel.'] : []);
        var waUrl = 'https://wa.me/' + CFG.WHATSAPP + '?text=' + encodeURIComponent(waLines.join('\n'));

        var row = {
            product_id: s.id,
            product_type: s.type,
            product_title: s.title,
            option_id: 'unica',
            quantity: 1,
            desired_date: date1,
            notes: notes,
            terms_snapshot: termsSnapshot(s),
            customer_name: name,
            customer_whatsapp: phone
        };
        if (s.price != null) row.price = s.price;

        // 1) grava o pedido ANTES de abrir o WhatsApp: se a pessoa fechar a conversa, o lead ja esta salvo
        $('svSend').disabled = true;
        setStatus('Registrando seu pedido...');
        var saved = false;
        var request = new Promise(function (resolve) {
            var timer = setTimeout(function () { resolve(false); }, 8000);
            try {
                db.from('orders').insert(row).then(function (r) {
                    clearTimeout(timer);
                    resolve(!(r && r.error));
                }, function () { clearTimeout(timer); resolve(false); });
            } catch (err) { clearTimeout(timer); resolve(false); }
        });

        request.then(function (ok) {
            saved = ok;
            if (saved) {
                try { db.from('events').insert({ type: 'checkout', product_id: s.id }).then(function () {}, function () {}); } catch (err) { /* nunca atrapalha */ }
            }
            showDone(saved, waUrl);
            // 2) abre o WhatsApp; se o navegador bloquear a janela, o botao da tela continua valendo
            try { window.open(waUrl, '_blank', 'noopener'); } catch (err) { /* o botao cobre */ }
        });
    });

    // =========================================================
    // EVENTOS DA PAGINA
    // =========================================================
    document.addEventListener('click', function (e) {
        var ask = e.target.closest('[data-ask]');
        if (ask) { openAsk(ask.getAttribute('data-ask')); return; }

        if (e.target.closest('[data-close-sv]') || e.target === modal) { closeAsk(); return; }
        if (e.target.closest('[data-retry]')) { load(); return; }

        if (e.target.closest('#copyLinkBtn') && SERVICES.length === 1) {
            var u = new URL(window.location.href);
            u.search = '';
            u.hash = '';
            u.searchParams.set('servico', SERVICES[0].slug);
            var text = u.toString();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () { toast('Link do serviço copiado.'); }, function () { toast('Não foi possível copiar. Copie o endereço do navegador.'); });
            } else {
                toast('Copie o endereço do navegador.');
            }
        }
    });

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAsk(); });

    // =========================================================
    // START
    // =========================================================
    function load() {
        if (!window.supabase || !getDb()) { showError(SERVICE_SLUG ? 'svDetailView' : 'svList'); return; }

        if (SERVICE_SLUG) {
            $('svListView').hidden = true;
            $('svDetailView').hidden = false;
            if (SERVICE_SLUG === '?') { showNotFound(); return; }
            db.from('products').select(COLS).eq('published', true).in('type', SERVICE_TYPES).eq('slug', SERVICE_SLUG).maybeSingle()
                .then(function (res) {
                    if (res.error) throw res.error;
                    if (!res.data) { showNotFound(); return; }
                    var s = normalize(res.data);
                    SERVICES = [s];
                    renderDetail(s);
                })
                .catch(function () { showError('svDetailView'); });
            return;
        }

        showSkeleton();
        db.from('products').select(COLS).eq('published', true).in('type', SERVICE_TYPES).order('created_at', { ascending: true })
            .then(function (res) {
                if (res.error) throw res.error;
                var list = (res.data || []).map(normalize);
                // servicos primeiro, depois aluguel (mantendo a ordem de cadastro dentro de cada grupo)
                SERVICES = list.filter(function (x) { return x.type !== 'rental'; }).concat(list.filter(function (x) { return x.type === 'rental'; }));
                renderList();
            })
            .catch(function () { showError('svList'); });
    }

    load();
})();
