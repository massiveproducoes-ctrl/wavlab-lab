// @ts-nocheck
/* Wav Lab - painel admin (admin.js). Configuracao em config.js */
(function () {
    'use strict';

    var CFG = window.WAVLAB;
    var MB = 1024 * 1024;
    var LIMIT_MASTER = 50 * MB;   // limite do plano gratis do Supabase
    var LIMIT_PREVIEW = 15 * MB;
    var TITLE_MAX = CFG.TITLE_MAX || 70;     // limite do titulo do beat (config.js)

    var state = { genres: [], producers: [], products: [], beatData: {}, files: {}, orders: [], badges: [], producerBadges: [], badgesErr: '', waitlist: null, waitlistErr: '' };
    var editingProduct = null;
    var editingProducer = null;
    var deliveryProduct = null;
    var deliveryOrder = null;
    var db = null;

    // Tipos de produto do catalogo (nomes de tela; os tipos liberados na vitrine ficam em config.js)
    var PACK_TYPES = ['sample_pack', 'drum_kit', 'loop_kit', 'preset', 'project_file', 'guide'];
    var SERVICE_TYPES = ['service', 'rental'];
    var ALL_TYPES = ['beat'].concat(PACK_TYPES, SERVICE_TYPES);
    var TYPE_ONE = {
        beat: 'Beat', sample_pack: 'Sample pack', drum_kit: 'Drum kit', loop_kit: 'Loop kit',
        preset: 'Preset', project_file: 'Projeto', guide: 'Guia', service: 'Serviço', rental: 'Aluguel'
    };
    var listFilter = { type: '', pub: '' };
    var orderFilter = { type: '' };

    // grupo do tipo decide quais campos e quais textos aparecem: beat, pack (arquivos) ou service (sem arquivo)
    function typeGroup(t) { return t === 'beat' ? 'beat' : SERVICE_TYPES.indexOf(t) > -1 ? 'service' : 'pack'; }
    function typeOne(t) { return TYPE_ONE[t] || t; }
    var minLicense = Math.min.apply(null, (CFG.LICENSES || []).map(function (l) { return l.price; }));

    // =========================================================
    // HELPERS
    // =========================================================
    function $(id) { return document.getElementById(id); }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initials(text) {
        return String(text || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    }

    function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#ff5500'; }

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
    }

    function brl(n) { return 'R$ ' + Number(n).toLocaleString('pt-BR'); }

    function fileExt(file, fallback) {
        var m = /\.([a-z0-9]{1,5})$/i.exec(file.name || '');
        return m ? m[1].toLowerCase() : fallback;
    }

    var toastTimer = null;
    function toast(msg, ms) {
        var t = $('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2800);
    }

    function setStatus(id, msg, isErr) {
        var el = $(id);
        el.textContent = msg || '';
        el.classList.toggle('err', !!isErr);
    }

    function openModal(id) { $(id).classList.add('active'); document.body.classList.add('modal-open'); }
    function closeModals() {
        var all = document.querySelectorAll('.modal-overlay');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    function findIn(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    // recorta no centro, deixa quadrada e comprime (foto de celular vira ~150KB)
    function resizeToJpeg(file, size) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var s = Math.min(img.width, img.height);
                var out = Math.min(size, s);
                var c = document.createElement('canvas');
                c.width = out; c.height = out;
                c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, out, out);
                c.toBlob(function (blob) {
                    URL.revokeObjectURL(url);
                    blob ? resolve(blob) : reject(new Error('Não consegui processar a imagem.'));
                }, 'image/jpeg', 0.86);
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
            img.src = url;
        });
    }

    async function upload(bucket, path, body, contentType) {
        var r = await db.storage.from(bucket).upload(path, body, { upsert: true, contentType: contentType || undefined, cacheControl: '3600' });
        if (r.error) throw new Error('Falha no envio (' + bucket + '): ' + r.error.message);
        return path;
    }

    function publicUrl(bucket, path) {
        return db.storage.from(bucket).getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
    }

    // =========================================================
    // LOGIN
    // =========================================================
    function showLogin() {
        $('appView').hidden = true;
        $('logoutBtn').hidden = true;
        $('loginView').hidden = false;
    }

    async function enterApp() {
        $('loginView').hidden = true;
        $('appView').hidden = false;
        $('logoutBtn').hidden = false;
        await loadAll();
    }

    $('loginForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = $('loginBtn');
        btn.disabled = true; btn.textContent = 'Entrando...';
        var r = await db.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPass').value });
        btn.disabled = false; btn.textContent = 'Entrar';
        if (r.error) { toast('E-mail ou senha incorretos.'); return; }
        $('loginPass').value = '';
        enterApp();
    });

    $('logoutBtn').addEventListener('click', async function () {
        await db.auth.signOut();
        showLogin();
    });

    // =========================================================
    // CARREGAR DADOS
    // =========================================================
    async function loadAll() {
        var res = await Promise.all([
            db.from('genres').select('*').order('sort'),
            db.from('producers').select('*').order('created_at'),
            db.from('products').select('*').order('created_at', { ascending: false }),
            db.from('product_beats').select('*'),
            db.from('product_files').select('*'),
            db.from('orders').select('*').order('created_at', { ascending: false }).limit(60)
        ]);
        for (var i = 0; i < res.length; i++) {
            if (res[i].error) { toast('Erro ao carregar: ' + res[i].error.message); return; }
        }
        state.genres = res[0].data;
        state.producers = res[1].data;
        state.products = res[2].data;
        state.beatData = {};
        res[3].data.forEach(function (d) { state.beatData[d.product_id] = d; });
        state.files = {};
        res[4].data.forEach(function (f) { state.files[f.product_id] = f; });
        state.orders = res[5].data;
        renderAll();
        loadBadges();        // fora do Promise.all: sem a migracao 004, so a area de titulos avisa
        loadWaitlist();      // fora do Promise.all: se a migracao 04 nao foi aplicada, so essa aba avisa
        if (statsLoaded) loadStats();
    }

    function renderAll() { renderProducts(); renderProducers(); renderOrders(); }

    // =========================================================
    // LISTAS
    // =========================================================
    function genreOf(id) { return findIn(state.genres, id) || { name: 'Outro', color: '#71717a' }; }

    function typeOptions(allLabel) {
        return '<option value="">' + allLabel + '</option>' + ALL_TYPES.map(function (t) {
            return '<option value="' + t + '">' + esc(typeOne(t)) + '</option>';
        }).join('');
    }

    function priceLabel(p) {
        if (p.type === 'beat') return 'a partir de ' + brl(minLicense);
        if (p.price == null) return 'sob consulta';
        if (Number(p.price) === 0) return 'Grátis';
        return brl(p.price) + (p.type === 'rental' ? '/dia' : '');
    }

    function renderProducts() {
        var box = $('productsAdminList');
        if (!state.products.length) {
            box.innerHTML = '<div class="empty">Nenhum produto ainda.<br>Cadastre o primeiro produtor e depois o primeiro produto.</div>';
            return;
        }
        var list = state.products.filter(function (p) {
            if (listFilter.type && p.type !== listFilter.type) return false;
            if (listFilter.pub === 'pub' && !p.published) return false;
            if (listFilter.pub === 'draft' && p.published) return false;
            return true;
        });
        if (!list.length) { box.innerHTML = '<div class="empty">Nenhum produto com esse filtro.</div>'; return; }
        box.innerHTML = list.map(function (b) {
            var grp = typeGroup(b.type);
            var prod = findIn(state.producers, b.producer_id);
            var g = genreOf(b.genre_id);
            var f = state.files[b.id] || {};
            var color = grp === 'beat' ? safeColor(g.color) : '#71717a';
            var badges = '';
            if (grp === 'beat') {
                badges =
                    '<span class="badge ' + (b.preview_url ? 'on' : '') + '">PREVIEW</span>' +
                    '<span class="badge ' + (f.mp3_path ? 'on' : '') + '">MP3</span>' +
                    '<span class="badge ' + (f.wav_path ? 'on' : '') + '">WAV</span>' +
                    '<span class="badge ' + ((f.stems_path || f.stems_link) ? 'on' : '') + '">STEMS</span>';
            } else if (grp === 'pack') {
                badges =
                    '<span class="badge ' + (b.preview_url ? 'on' : '') + '">DEMO</span>' +
                    '<span class="badge ' + (f.delivery_url ? 'on' : '') + '">ENTREGA</span>';
            }
            var canDeliver = grp !== 'service';
            return '' +
            '<div class="item">' +
                '<div class="item-top">' +
                    '<div class="thumb" style="--g:' + color + '">' + (b.cover_url ? '<img src="' + esc(b.cover_url) + '" alt="">' : '') + '<span>' + esc(initials(b.title)) + '</span></div>' +
                    '<div class="item-info">' +
                        '<div class="item-title">' + esc(b.title) + '</div>' +
                        '<div class="item-sub"><span class="genre-pill" style="--g:' + color + '">' + esc(typeOne(b.type)) + '</span><span>' + esc(prod ? prod.name : 'Estúdio') + '</span><span class="order-price">' + esc(priceLabel(b)) + '</span></div>' +
                    '</div>' +
                    '<label class="switch" title="Publicado"><input type="checkbox" data-toggle-product="' + b.id + '"' + (b.published ? ' checked' : '') + '><span></span></label>' +
                '</div>' +
                (badges ? '<div class="badges">' + badges + '</div>' : '') +
                '<div class="item-actions">' +
                    '<button class="btn small" data-act="edit-product" data-id="' + b.id + '"><i class="fa-solid fa-pen"></i> Editar</button>' +
                    (canDeliver ? '<button class="btn small" data-act="delivery" data-id="' + b.id + '"><i class="fa-solid fa-paper-plane"></i> Entrega</button>' : '') +
                    '<button class="btn small ghost danger" data-act="delete-product" data-id="' + b.id + '"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function renderProducers() {
        var box = $('producersAdminList');
        if (!state.producers.length) {
            box.innerHTML = '<div class="empty">Nenhum produtor ainda.<br>Comece por você, o Alexandre e o Gabriel.</div>';
            return;
        }
        box.innerHTML = state.producers.map(function (p) {
            var n = state.products.filter(function (b) { return b.producer_id === p.id; }).length;
            return '' +
            '<div class="item">' +
                '<div class="item-top">' +
                    '<div class="thumb round">' + (p.photo_url ? '<img src="' + esc(p.photo_url) + '" alt="">' : '') + '<span>' + esc(initials(p.name)) + '</span></div>' +
                    '<div class="item-info">' +
                        '<div class="item-title">' + esc(p.name) + '</div>' +
                        '<div class="item-sub"><span>' + esc(p.handle || 'sem @') + '</span><span>' + n + ' produto' + (n === 1 ? '' : 's') + '</span>' + (p.slug ? '<span>' + esc(p.slug) + '</span>' : '') + '</div>' +
                    '</div>' +
                    '<label class="switch" title="Ativo"><input type="checkbox" data-toggle-producer="' + p.id + '"' + (p.active ? ' checked' : '') + '><span></span></label>' +
                '</div>' +
                '<div class="item-actions">' +
                    '<button class="btn small" data-act="edit-producer" data-id="' + p.id + '"><i class="fa-solid fa-pen"></i> Editar</button>' +
                    (p.slug ? '<a class="btn small ghost" href="produtor.html?p=' + encodeURIComponent(p.slug) + '" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Página</a>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    // pedidos: o produto do pedido (pedidos antigos so tem beat_id) e o tipo (todo pedido antigo e de beat)
    function orderProduct(o) { return findIn(state.products, o.product_id || o.beat_id); }
    function orderType(o) { return o.product_type || 'beat'; }
    function statusList(type) { return typeGroup(type) === 'service' ? ['lead', 'agendado', 'concluido'] : ['lead', 'pago', 'entregue']; }

    function fmtDateOnly(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
        return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
    }

    function renderOrders() {
        var box = $('ordersAdminList');
        if (!state.orders.length) {
            box.innerHTML = '<div class="empty">Nenhum pedido ainda.</div>';
            return;
        }
        var list = state.orders.filter(function (o) { return !orderFilter.type || orderType(o) === orderFilter.type; });
        if (!list.length) { box.innerHTML = '<div class="empty">Nenhum pedido desse tipo.</div>'; return; }
        box.innerHTML = list.map(function (o) {
            var type = orderType(o);
            var grp = typeGroup(type);
            var when = new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            var sts = statusList(type);
            if (sts.indexOf(o.status) === -1) sts = sts.concat([o.status]);
            var opts = sts.map(function (s) {
                return '<option value="' + esc(s) + '"' + (o.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
            }).join('');
            var option = o.option_id || o.license_id;
            var optTxt = (option && option !== 'unica') ? String(option).toUpperCase() : '';
            var extra = [];
            if (o.desired_date) extra.push('Data desejada: ' + fmtDateOnly(o.desired_date));
            if (o.notes) extra.push(o.notes);
            var prod = orderProduct(o);
            var action = '';
            if (prod && grp === 'service') action = '<button class="btn small" data-act="order-delivery" data-id="' + o.id + '"><i class="fa-regular fa-calendar-check"></i> Confirmar data</button>';
            else if (prod) action = '<button class="btn small" data-act="order-delivery" data-id="' + o.id + '"><i class="fa-solid fa-paper-plane"></i> Entrega</button>';
            return '' +
            '<div class="item order">' +
                '<div class="item-top">' +
                    '<div class="item-info">' +
                        '<div class="item-title">' + esc(o.product_title || o.beat_title || 'Produto removido') + '</div>' +
                        '<div class="item-sub"><span class="genre-pill" style="--g:#71717a">' + esc(typeOne(type)) + '</span>' +
                            (optTxt ? '<span>' + esc(optTxt) + '</span>' : '') +
                            (o.quantity > 1 ? '<span>×' + esc(o.quantity) + '</span>' : '') +
                            '<span class="order-price">' + (o.price != null ? brl(o.price) : '') + '</span><span>' + esc(when) + '</span></div>' +
                        (extra.length ? '<div class="order-notes">' + extra.map(esc).join(' · ') + '</div>' : '') +
                    '</div>' +
                    '<select data-order-status="' + o.id + '">' + opts + '</select>' +
                '</div>' +
                (action ? '<div class="item-actions">' + action + '</div>' : '') +
            '</div>';
        }).join('');
    }

    // =========================================================
    // LISTA DE ESPERA ("Quero ser avisado")
    // =========================================================
    function fmtPhone(d) {
        d = String(d || '');
        var m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
        return m ? '+55 ' + m[1] + ' ' + m[2] + '-' + m[3] : '+' + d;
    }

    function fmtWhen(iso) { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }

    async function loadWaitlist() {
        var r = await db.from('waitlist').select('*').order('created_at', { ascending: false }).limit(500);
        state.waitlist = r.error ? null : r.data;
        state.waitlistErr = r.error ? r.error.message : '';
        renderWaitlist();
    }

    function renderWaitlist() {
        var box = $('waitlistAdminList');
        $('waitCopy').hidden = true;
        if (state.waitlistErr) {
            $('waitCount').textContent = '';
            box.innerHTML = '<div class="empty">Não foi possível ler a lista.<br>Rode o SQL <b>migracao_04</b> no Supabase.<br><small>' + esc(state.waitlistErr) + '</small></div>';
            return;
        }
        var list = state.waitlist || [];
        $('waitCount').textContent = list.length + (list.length === 1 ? ' pessoa' : ' pessoas');
        if (!list.length) { box.innerHTML = '<div class="empty">Ninguém na lista ainda.</div>'; return; }
        $('waitCopy').hidden = false;
        box.innerHTML = list.map(function (w) {
            return '' +
            '<div class="item">' +
                '<div class="item-top">' +
                    '<div class="item-info">' +
                        '<div class="item-title">' + esc(w.name) + '</div>' +
                        '<div class="item-sub"><span>' + esc(fmtPhone(w.whatsapp)) + '</span><span>' + esc(fmtWhen(w.created_at)) + '</span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="item-actions">' +
                    '<a class="btn small" href="https://wa.me/' + esc(w.whatsapp) + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>' +
                    '<button class="btn small ghost danger" data-act="delete-wait" data-id="' + esc(w.id) + '" aria-label="Remover da lista"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    async function deleteWait(id) {
        var w = findIn(state.waitlist || [], Number(id));
        if (!w || !confirm('Remover ' + w.name + ' da lista de espera?')) return;
        var r = await db.from('waitlist').delete().eq('id', w.id);
        if (r.error) { toast('Erro: ' + r.error.message); return; }
        toast('Removido da lista.');
        loadWaitlist();
    }

    $('waitCopy').addEventListener('click', async function () {
        var text = (state.waitlist || []).map(function (w) { return w.name + ' - ' + fmtPhone(w.whatsapp); }).join('\n');
        var done = false;
        try { await navigator.clipboard.writeText(text); done = true; } catch (e) { /* tenta o plano B */ }
        if (!done) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { done = document.execCommand('copy'); } catch (e) { /* sem permissao */ }
            document.body.removeChild(ta);
        }
        toast(done ? 'Lista copiada.' : 'Não foi possível copiar.');
    });

    // =========================================================
    // RESUMO DOS ULTIMOS 30 DIAS (eventos)
    // =========================================================
    var statsLoaded = false;
    var STATS_DAYS = 30;

    function nfmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }

    // os ultimos N dias (hoje no horario de Sao Paulo, o mesmo usado pelo SQL), do mais antigo ao mais novo
    function lastDays(n) {
        var today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        var p = today.split('-');
        var base = Date.UTC(+p[0], +p[1] - 1, +p[2]);
        var out = [];
        for (var i = n - 1; i >= 0; i--) out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
        return out;
    }

    function dayLabel(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

    function licenseName(id) {
        var l = findIn(CFG.LICENSES || [], id);
        return l ? l.name : String(id).toUpperCase();
    }

    function beatTitle(id) {
        var b = findIn(state.products, id);
        return b ? b.title : 'Beat removido';
    }

    // barras horizontais de uma serie so (um tom, valor na ponta)
    function barList(rows, labelOf) {
        var max = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 1);
        return '<ul class="rank">' + rows.map(function (r) {
            return '<li><span class="rank-label">' + esc(labelOf(r)) + '</span>' +
                '<span class="rank-track"><span class="rank-fill" style="width:' + Math.max(2, Math.round(r.n / max * 100)) + '%"></span></span>' +
                '<span class="rank-val">' + nfmt(r.n) + '</span></li>';
        }).join('') + '</ul>';
    }

    function renderStats(s) {
        var t = s.totals || {};
        var days = lastDays(s.days || STATS_DAYS);
        var byDay = {};
        (s.daily || []).forEach(function (d) { byDay[d.day] = d; });
        var series = days.map(function (d) { return { day: d, play: (byDay[d] || {}).play || 0, lic: (byDay[d] || {}).license_click || 0, chk: (byDay[d] || {}).checkout || 0 }; });
        var maxPlay = series.reduce(function (m, x) { return Math.max(m, x.play); }, 0);
        var total = (t.play || 0) + (t.license_click || 0) + (t.checkout || 0) + (t.search_empty || 0);

        $('statsTitle').textContent = 'Últimos ' + (s.days || STATS_DAYS) + ' dias';

        if (!total) {
            $('statsBody').innerHTML = '<div class="empty">Ainda não há eventos neste período.<br>Eles aparecem aqui conforme o pessoal usa a vitrine.</div>';
            return;
        }

        var rate = t.license_click ? Math.round((t.checkout || 0) / t.license_click * 100) : null;
        var html = '';

        html += '<div class="kpis">' +
            '<div class="kpi"><div class="kpi-label">Plays</div><div class="kpi-val">' + nfmt(t.play) + '</div></div>' +
            '<div class="kpi"><div class="kpi-label">Cliques em Licenciar</div><div class="kpi-val">' + nfmt(t.license_click) + '</div></div>' +
            '<div class="kpi"><div class="kpi-label">Finalizar (WhatsApp)</div><div class="kpi-val">' + nfmt(t.checkout) + '</div></div>' +
            '<div class="kpi"><div class="kpi-label">Buscas sem resultado</div><div class="kpi-val">' + nfmt(t.search_empty) + '</div></div>' +
        '</div>';
        if (rate !== null) html += '<p class="hint">De cada 100 cliques em Licenciar, <b>' + rate + '</b> chegaram ao Finalizar.</p>';

        // plays por dia (uma serie, uma cor)
        html += '<div class="stat-card"><div class="stat-title">Plays por dia</div>' +
            '<div class="col-chart" id="colChart" role="img" aria-label="Plays por dia nos últimos ' + days.length + ' dias. Veja a tabela logo abaixo.">' +
                '<span class="col-max">' + nfmt(maxPlay) + '</span>' +
                series.map(function (x, i) {
                    var h = maxPlay ? Math.max(x.play ? 4 : 0, Math.round(x.play / maxPlay * 100)) : 0;
                    return '<div class="col" data-i="' + i + '"><div class="col-fill" style="height:' + h + '%"></div></div>';
                }).join('') +
                '<div class="col-tip" id="colTip" hidden></div>' +
            '</div>' +
            '<div class="col-axis"><span>' + dayLabel(days[0]) + '</span><span>' + dayLabel(days[days.length - 1]) + '</span></div>' +
            '<details class="table-view"><summary>Ver em tabela</summary><div class="table-scroll"><table>' +
                '<thead><tr><th>Dia</th><th>Plays</th><th>Licenciar</th><th>Finalizar</th></tr></thead><tbody>' +
                series.slice().reverse().map(function (x) { return '<tr><td>' + dayLabel(x.day) + '</td><td>' + x.play + '</td><td>' + x.lic + '</td><td>' + x.chk + '</td></tr>'; }).join('') +
            '</tbody></table></div></details></div>';

        if ((s.top_beats || []).length) {
            html += '<div class="stat-card"><div class="stat-title">Beats mais ativos</div><div class="table-scroll"><table>' +
                '<thead><tr><th>Beat</th><th>Plays</th><th>Licenciar</th><th>Finalizar</th></tr></thead><tbody>' +
                s.top_beats.map(function (b) { return '<tr><td class="td-title">' + esc(beatTitle(b.beat_id)) + '</td><td>' + nfmt(b.plays) + '</td><td>' + nfmt(b.license_clicks) + '</td><td>' + nfmt(b.checkouts) + '</td></tr>'; }).join('') +
            '</tbody></table></div></div>';
        }

        if ((s.licenses || []).length) {
            html += '<div class="stat-card"><div class="stat-title">Licenças em Finalizar</div>' +
                barList(s.licenses, function (r) { return licenseName(r.license_id); }) + '</div>';
        }

        if ((s.empty_terms || []).length) {
            html += '<div class="stat-card"><div class="stat-title">Buscas sem resultado</div>' +
                barList(s.empty_terms, function (r) { return r.term; }) +
                '<p class="hint">É o que o pessoal procurou e não achou. Boas ideias de beat.</p></div>';
        }

        html += '<p class="hint">Contagem de ações, não de pessoas: a vitrine não usa cookies nem guarda identificador de quem visita.</p>';
        $('statsBody').innerHTML = html;
        $('statsBody')._series = series;
    }

    async function loadStats() {
        statsLoaded = true;
        var box = $('statsBody');
        box.classList.add('loading');
        var r = await db.rpc('events_summary', { days: STATS_DAYS });
        box.classList.remove('loading');
        if (r.error || !r.data) {
            box.innerHTML = '<div class="empty">Não foi possível carregar o resumo.<br>Rode o SQL <b>migracao_04</b> no Supabase.<br><small>' + esc(r.error ? r.error.message : '') + '</small></div>';
            return;
        }
        renderStats(r.data);
    }

    $('statsReload').addEventListener('click', loadStats);

    // dica ao passar/tocar numa coluna do grafico
    function showTip(e) {
        var col = e.target.closest && e.target.closest('.col');
        var tip = $('colTip');
        if (!tip) return;
        if (!col) { tip.hidden = true; return; }
        var x = $('statsBody')._series[+col.getAttribute('data-i')];
        tip.textContent = dayLabel(x.day) + ': ' + x.play + (x.play === 1 ? ' play' : ' plays');
        tip.hidden = false;
        var chart = $('colChart'), cr = col.getBoundingClientRect(), pr = chart.getBoundingClientRect();
        var left = cr.left - pr.left + cr.width / 2;
        tip.style.left = Math.max(40, Math.min(pr.width - 40, left)) + 'px';
    }
    $('statsBody').addEventListener('pointerover', showTip);
    $('statsBody').addEventListener('pointerdown', showTip);
    $('statsBody').addEventListener('pointerleave', function () { var tip = $('colTip'); if (tip) tip.hidden = true; });

    // =========================================================
    // PRODUTOR (criar / editar)
    // =========================================================
    // ---------- titulos (insignias) ----------
    async function loadBadges() {
        var r = await Promise.all([
            db.from('badges').select('*').order('sort'),
            db.from('producer_badges').select('*')
        ]);
        var err = r[0].error || r[1].error;
        state.badgesErr = err ? err.message : '';
        state.badges = err ? [] : r[0].data;
        state.producerBadges = err ? [] : r[1].data;
    }

    function badgeIconSrc(b) {
        return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.icon || '') ? 'icons/badges/' + b.icon + '.svg' : '';
    }

    // caixas de marcar: marcada = o produtor tem o titulo (grava ao salvar o produtor)
    function renderBadgePicks(producer) {
        var box = $('pf_badges');
        if (state.badgesErr) {
            box.innerHTML = '<div class="hint warn">Não foi possível ler os títulos. Rode o SQL <b>004_badges</b> no Supabase.</div>';
            return;
        }
        var titles = state.badges.filter(function (b) { return b.kind === 'titulo'; });
        if (!titles.length) { box.innerHTML = '<div class="hint">Nenhum título cadastrado.</div>'; return; }
        var has = {};
        state.producerBadges.forEach(function (pb) { if (producer && pb.producer_id === producer.id) has[pb.badge_id] = true; });
        box.innerHTML = titles.map(function (b) {
            var src = badgeIconSrc(b);
            return '<label class="badge-pick">' +
                '<input type="checkbox" value="' + esc(b.id) + '"' + (has[b.id] ? ' checked' : '') + '>' +
                (src ? '<img src="' + esc(src) + '" alt="">' : '') +
                '<span class="badge-pick-text"><span class="badge-pick-name">' + esc(b.name) + '</span>' +
                (b.description ? '<span class="badge-pick-sub">' + esc(b.description) + '</span>' : '') + '</span>' +
            '</label>';
        }).join('') + '<div class="hint">Os títulos aparecem na página do produtor e ao lado do nome nos beats.</div>';
    }

    // compara as caixas marcadas com o que o produtor ja tem e atribui / remove a diferenca
    async function syncBadges(producerId) {
        if (state.badgesErr) return;
        var boxes = $('pf_badges').querySelectorAll('input[type=checkbox]');
        if (!boxes.length) return;
        var want = {}, have = {};
        for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) want[boxes[i].value] = true;
        state.producerBadges.forEach(function (pb) { if (pb.producer_id === producerId) have[pb.badge_id] = true; });

        var add = [];
        Object.keys(want).forEach(function (id) { if (!have[id]) add.push({ producer_id: producerId, badge_id: id }); });
        if (add.length) {
            var ri = await db.from('producer_badges').insert(add);
            if (ri.error) throw new Error(ri.error.message);
        }
        var drop = Object.keys(have).filter(function (id) { return !want[id]; });
        for (var k = 0; k < drop.length; k++) {
            var rd = await db.from('producer_badges').delete().eq('producer_id', producerId).eq('badge_id', drop[k]);
            if (rd.error) throw new Error(rd.error.message);
        }
        await loadBadges();
    }

    var slugTouched = false;

    // "Alexandre Cunha" vira "alexandre-cunha"
    function slugify(s) {
        return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    }

    // aceita "@user", "user" ou o link do perfil; devolve "@user" ('' se vazio)
    function cleanHandle(v) {
        v = String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[\/?#].*$/, '').replace(/^@+/, '');
        return v ? '@' + v : '';
    }

    function slugProblem(slug, selfId) {
        if (!slug) return '';
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'Use só letras minúsculas, números e hífen (sem espaço nem acento).';
        if ((CFG.RESERVED_SLUGS || []).indexOf(slug) > -1) return '"' + slug + '" já é uma página do site. Escolha outro endereço.';
        for (var i = 0; i < state.producers.length; i++) {
            if (state.producers[i].slug === slug && state.producers[i].id !== selfId) return 'Esse endereço já é de ' + state.producers[i].name + '.';
        }
        return '';
    }

    function siteBase() { return location.origin + location.pathname.replace(/[^\/]*$/, ''); }

    function updateSlugHint() {
        var slug = $('pf_slug').value.trim().toLowerCase();
        var hint = $('pf_slug_hint');
        var problem = slugProblem(slug, editingProducer ? editingProducer.id : null);
        if (problem) { hint.className = 'hint warn'; hint.textContent = problem; }
        else if (slug) { hint.className = 'hint ok'; hint.textContent = 'Link da página: ' + siteBase() + 'produtor.html?p=' + slug + ' (funciona assim que o produtor for salvo, sem criar pasta).'; }
        else { hint.className = 'hint'; hint.textContent = 'Deixe vazio para o produtor ficar sem página e sem link na vitrine.'; }
    }

    $('pf_slug').addEventListener('input', function () { slugTouched = true; updateSlugHint(); });
    $('pf_name').addEventListener('input', function () {
        if (slugTouched) return;
        $('pf_slug').value = slugify(this.value);
        updateSlugHint();
    });

    function openProducerForm(p) {
        editingProducer = p || null;
        slugTouched = !!(p && p.slug);
        $('producerModalTitle').textContent = p ? 'Editar produtor' : 'Novo produtor';
        $('pf_name').value = p ? p.name : '';
        $('pf_handle').value = p ? (p.handle || '') : '';
        $('pf_slug').value = p ? (p.slug || '') : '';
        $('pf_bio').value = p ? (p.bio || '') : '';
        $('pf_spotify').value = p ? (p.spotify_url || '') : '';
        $('pf_active').checked = p ? !!p.active : true;
        $('pf_photo').value = '';
        $('pf_photo_cur').textContent = p && p.photo_url ? 'Já tem foto. Escolha outra só se quiser trocar.' : '';
        setStatus('pf_status', '');
        updateSlugHint();
        renderBadgePicks(p);
        openModal('producerModal');
    }

    $('producerForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = $('pf_save');
        btn.disabled = true;
        try {
            var id = editingProducer ? editingProducer.id : uuid();
            var photo = editingProducer ? editingProducer.photo_url : null;

            // confere tudo antes de enviar qualquer arquivo
            var handle = cleanHandle($('pf_handle').value);
            if (handle && !/^@[A-Za-z0-9._]{1,30}$/.test(handle)) throw new Error('O @ do Instagram só pode ter letras, números, ponto e sublinhado.');
            var slug = $('pf_slug').value.trim().toLowerCase();
            var problem = slugProblem(slug, id);
            if (problem) throw new Error(problem);
            var bio = $('pf_bio').value.replace(/\s+/g, ' ').trim();
            if (bio.length > 280) throw new Error('A bio passa de 280 caracteres (' + bio.length + ').');
            var spotify = $('pf_spotify').value.trim();
            if (spotify && !/^https:\/\/(open\.)?spotify\.com\//i.test(spotify)) throw new Error('O link do Spotify deve começar com https://open.spotify.com/');

            var file = $('pf_photo').files[0];
            if (file) {
                setStatus('pf_status', 'Enviando foto...');
                var blob = await resizeToJpeg(file, 500);
                await upload('avatars', id + '/avatar.jpg', blob, 'image/jpeg');
                photo = publicUrl('avatars', id + '/avatar.jpg');
            }
            setStatus('pf_status', 'Salvando...');
            var row = {
                id: id, name: $('pf_name').value.trim(), handle: handle || null,
                photo_url: photo, active: $('pf_active').checked
            };
            var r = await db.from('producers').upsert(Object.assign({}, row, { slug: slug || null, bio: bio || null, spotify_url: spotify || null }));
            var extrasSkipped = false;
            if (r.error && /duplicate|unique/i.test(r.error.message || '')) throw new Error('Esse endereço já é de outro produtor.');
            if (r.error && /could not find|does not exist/i.test(r.error.message || '') && /slug|bio|spotify_url/.test(r.error.message || '')) {
                // banco ainda sem a migracao 03: salva o resto e avisa
                extrasSkipped = true;
                r = await db.from('producers').upsert(row);
            }
            if (r.error) throw new Error(r.error.message);

            var badgeErr = '';
            try { await syncBadges(id); } catch (be) { badgeErr = be.message; }

            var msg = 'Produtor salvo.';
            if (extrasSkipped) msg = 'Produtor salvo, mas endereço, bio e Spotify não foram gravados: rode o SQL migracao_03 no Supabase.';
            if (badgeErr) msg += ' Os títulos não foram gravados: ' + badgeErr;
            closeModals();
            toast(msg, msg.length > 20 ? 6000 : 2800);
            await loadAll();
        } catch (err) {
            setStatus('pf_status', err.message, true);
        }
        btn.disabled = false;
    });

    // =========================================================
    // PRODUTO (criar / editar)
    // =========================================================
    function fillSelects() {
        $('pr_type').innerHTML = ALL_TYPES.map(function (t) {
            return '<option value="' + t + '">' + esc(typeOne(t)) + '</option>';
        }).join('');
        $('bf_producer').innerHTML = '<option value="">Escolha...</option>' + state.producers.map(function (p) {
            return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
        }).join('');
        $('bf_genre').innerHTML = '<option value="">Escolha...</option>' + state.genres.map(function (g) {
            return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>';
        }).join('');
    }

    function curHint(id, text) { $(id).textContent = text || ''; }

    // mostra so os campos do tipo escolhido e ajusta textos e campos obrigatorios
    function applyType() {
        var type = $('pr_type').value || 'beat';
        var grp = typeGroup(type);
        var isBeat = grp === 'beat';
        var els = document.querySelectorAll('#productForm [data-for]');
        for (var i = 0; i < els.length; i++) {
            els[i].hidden = els[i].getAttribute('data-for').split(' ').indexOf(grp) === -1;
        }

        $('bf_producer').required = isBeat;
        $('bf_genre').required = isBeat;
        $('bf_producer').options[0].text = isBeat ? 'Escolha...' : 'Nenhum (estúdio)';
        $('bf_genre').options[0].text = isBeat ? 'Escolha...' : 'Nenhum';
        $('bf_producer_label').textContent = isBeat ? 'Produtor *' : 'Produtor (opcional)';
        $('bf_genre_label').textContent = isBeat ? 'Gênero *' : 'Gênero (opcional)';

        $('bf_title_label').innerHTML = isBeat
            ? 'Título do beat * <span class="lbl-note">(é o que o artista busca)</span>'
            : 'Título *';
        $('bf_title').placeholder = isBeat ? 'Ex.: Drake Type Beat - "Midnight Vibes"' : 'Ex.: ' + (grp === 'service' ? 'Mix e master de 1 faixa' : 'Trap Essentials Vol. 1');

        $('pr_price').required = grp === 'pack';
        $('pr_price_label').textContent = type === 'rental' ? 'Valor da diária (R$)' + (grp === 'pack' ? ' *' : '') : 'Preço (R$)' + (grp === 'pack' ? ' *' : '');
        $('pr_price_hint').textContent = grp === 'pack'
            ? 'Preço fixo. 0 deixa o produto grátis.'
            : 'Preço fixo. 0 = grátis; vazio = "sob consulta".';
        $('pr_inside_label').textContent = grp === 'service' ? 'O que está incluso' : 'O que tem dentro';
        $('pr_duration_label').textContent = type === 'rental' ? 'Condições da diária (retirada, caução...)' : 'Duração';
        $('pr_duration').placeholder = type === 'rental' ? 'ex.: retirada no estúdio, caução de R$ 200' : 'ex.: 2 horas';

        $('bf_preview_label').textContent = isBeat ? 'Preview de 30s COM TAG (MP3) *' : 'Áudio demo (MP3, opcional)';

        $('productModalTitle').textContent = (editingProduct ? 'Editar ' : 'Novo ') + typeOne(type).toLowerCase();
        $('bf_save').textContent = 'Salvar ' + typeOne(type).toLowerCase();
        updateTitleHint();
    }

    function openProductForm(b) {
        editingProduct = b || null;
        var f = b ? (state.files[b.id] || {}) : {};
        var bd = b ? (state.beatData[b.id] || {}) : {};
        var d = (b && b.details) || {};
        fillSelects();
        $('pr_type').value = b ? b.type : 'beat';
        $('pr_type').disabled = !!b;
        $('pr_type_hint').hidden = !!b;
        $('bf_title').value = b ? b.title : '';
        $('bf_producer').value = b && b.producer_id ? b.producer_id : '';
        $('bf_genre').value = b && b.genre_id ? b.genre_id : '';
        $('bf_bpm').value = bd.bpm ? bd.bpm : '';
        $('bf_key').value = bd.musical_key || '';
        $('bf_tags').value = b ? (b.tags || []).join(', ') : '';
        $('bf_types').value = (bd.type_artists || []).join(', ');
        $('bf_note').value = bd.note || '';
        $('pr_price').value = b && b.price != null && b.type !== 'beat' ? b.price : '';
        $('pr_desc').value = b ? (b.description || '') : '';
        $('pr_inside').value = d.inside || '';
        $('pr_count').value = d.file_count || '';
        $('pr_size').value = d.total_size || '';
        $('pr_formats').value = d.formats || '';
        $('pr_bpm').value = d.bpm || '';
        $('pr_key').value = d.key || '';
        $('pr_duration').value = d.duration || '';
        $('pr_delivery_url').value = f.delivery_url || '';
        $('pr_delivery_note').value = f.delivery_note || '';
        $('bf_published').checked = b ? !!b.published : false;
        $('bf_stemslink').value = f.stems_link || '';
        ['bf_cover', 'bf_preview', 'bf_mp3', 'bf_wav', 'bf_stems'].forEach(function (id) { $(id).value = ''; });
        curHint('bf_cover_cur', b && b.cover_url ? 'Já tem capa. Escolha outra só se quiser trocar.' : '');
        curHint('bf_preview_hint', b && b.preview_url ? 'Já tem ' + (b.type === 'beat' ? 'preview' : 'áudio demo') + '. Escolha outro só se quiser trocar.' : '');
        curHint('bf_mp3_cur', f.mp3_path ? 'Já enviado.' : '');
        curHint('bf_wav_cur', f.wav_path ? 'Já enviado.' : '');
        curHint('bf_stems_cur', f.stems_path ? 'Já enviado.' : '');
        $('bf_preview_hint').className = 'hint';
        setStatus('bf_status', '');
        applyType();
        openModal('productModal');
    }

    $('pr_type').addEventListener('change', applyType);

    // ---------- titulo bom para busca (SEO, so para beats) ----------
    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* navegador antigo */ }
        return s;
    }

    function parseList(str, max) {
        return String(str || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, max);
    }

    // endereco do produto: titulo sem acento + 8 letras do id (igual ao que a migracao gerou para os beats)
    function productSlug(title, id) {
        var base = norm(title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'produto';
        return base + '-' + String(id).replace(/-/g, '').slice(0, 8);
    }

    var titleSuggestion = '';

    $('bf_title').maxLength = TITLE_MAX;
    $('titleMaxGuide').textContent = TITLE_MAX;

    function updateTitleHint() {
        var len = $('bf_title').value.length;
        var counter = $('bf_title_count');
        counter.textContent = len + '/' + TITLE_MAX;
        counter.className = 'char-count' + (len > TITLE_MAX ? ' over' : len >= TITLE_MAX - 10 ? ' warn' : '');

        var title = $('bf_title').value.trim();
        var hint = $('bf_title_hint'), btn = $('bf_title_use');
        titleSuggestion = '';
        btn.hidden = true;

        if (($('pr_type').value || 'beat') !== 'beat') {
            hint.className = 'hint';
            hint.textContent = title.length > TITLE_MAX ? 'Tem ' + title.length + ' caracteres; o limite é ' + TITLE_MAX + '. Encurte para poder salvar.' : 'Até ' + TITLE_MAX + ' caracteres.';
            return;
        }

        var types = parseList($('bf_types').value, 5);
        var hasType = /type\s*beat/i.test(title);
        var nt = norm(title);
        var cites = types.some(function (x) { return nt.indexOf(norm(x)) > -1; });
        var problems = [];

        if (!title) {
            hint.className = 'hint';
            hint.textContent = 'Formato: Artista Type Beat - "Nome do beat". Ex.: Drake Type Beat - "Midnight Vibes".';
            return;
        }
        if (!hasType) problems.push('Falta "Type Beat" no título (é o que o artista digita na busca).');
        if (hasType && types.length && !cites) problems.push('O título não cita nenhum artista do campo "Type de".');
        if (title.length > TITLE_MAX) problems.push('Tem ' + title.length + ' caracteres; o limite é ' + TITLE_MAX + '. Encurte para poder salvar.');

        if (!problems.length) {
            hint.className = 'hint ok';
            hint.textContent = 'Ótimo para busca (' + title.length + ' caracteres).';
        } else {
            hint.className = 'hint warn';
            hint.textContent = problems.join(' ');
        }

        if (!hasType && types.length) {
            var s = types.slice(0, 2).join(' x ') + ' Type Beat - "' + title + '"';
            if (s.length <= TITLE_MAX) {
                titleSuggestion = s;
                btn.textContent = 'Usar: ' + s;
                btn.hidden = false;
            } else {
                hint.textContent += ' A sugestão com "Type Beat" passaria de ' + TITLE_MAX + ' caracteres (' + s.length + '): encurte o nome do beat.';
            }
        }
    }

    $('bf_title').addEventListener('input', updateTitleHint);
    $('bf_types').addEventListener('input', updateTitleHint);
    $('bf_title_use').addEventListener('click', function () {
        if (titleSuggestion) { $('bf_title').value = titleSuggestion; updateTitleHint(); }
    });

    // avisa se o preview nao tem ~30s
    $('bf_preview').addEventListener('change', function () {
        var file = this.files[0];
        var hint = $('bf_preview_hint');
        hint.className = 'hint';
        if (!file) return;
        var a = new Audio();
        var url = URL.createObjectURL(file);
        a.preload = 'metadata';
        a.onloadedmetadata = function () {
            var d = Math.round(a.duration);
            if (d > 45) { hint.textContent = 'Esse arquivo tem ' + d + 's. O preview deve ter ~30s e com a tag de voz.'; hint.className = 'hint warn'; }
            else { hint.textContent = d + 's. Confirme que tem a tag de voz.'; hint.className = 'hint ok'; }
            URL.revokeObjectURL(url);
        };
        a.onerror = function () { URL.revokeObjectURL(url); };
        a.src = url;
    });

    // dados dos tipos que nao sao beat (vao em products.details); mantem chaves que a tela nao conhece
    function readDetails(grp, old) {
        var d = Object.assign({}, old || {});
        function put(key, val) { if (val) d[key] = val; else delete d[key]; }
        put('inside', $('pr_inside').value.trim());
        if (grp === 'pack') {
            var n = parseInt($('pr_count').value, 10);
            put('file_count', isNaN(n) || n < 1 ? null : n);
            put('total_size', $('pr_size').value.trim());
            put('formats', $('pr_formats').value.trim());
            put('bpm', $('pr_bpm').value.trim());
            put('key', $('pr_key').value.trim());
        }
        if (grp === 'service') put('duration', $('pr_duration').value.trim());
        return d;
    }

    $('productForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = $('bf_save');
        var type = $('pr_type').value || 'beat';
        var grp = typeGroup(type);
        var isBeat = grp === 'beat';
        var coverF = $('bf_cover').files[0], prevF = $('bf_preview').files[0];
        var mp3F = isBeat ? $('bf_mp3').files[0] : null, wavF = isBeat ? $('bf_wav').files[0] : null, stemsF = isBeat ? $('bf_stems').files[0] : null;
        function fail(msg, focusId) { setStatus('bf_status', msg, true); if (focusId) $(focusId).focus(); }

        var title = $('bf_title').value.trim();
        if (!title) return fail('Falta o título.', 'bf_title');
        if (title.length > TITLE_MAX) return fail('O título tem ' + title.length + ' caracteres; o limite é ' + TITLE_MAX + '. Encurte para salvar.', 'bf_title');
        if (isBeat) {
            if (!$('bf_producer').value) return fail('Escolha o produtor.', 'bf_producer');
            if (!$('bf_genre').value) return fail('Escolha o gênero.', 'bf_genre');
            if (!editingProduct && !prevF) return fail('Falta o preview de 30s com tag.');
        }
        if (prevF && prevF.size > LIMIT_PREVIEW) return fail('Preview acima de 15MB. Exporte em MP3 128-192kbps.');
        var big = [mp3F, wavF, stemsF].filter(function (x) { return x && x.size > LIMIT_MASTER; })[0];
        if (big) return fail('"' + big.name + '" passa de 50MB. Suba no Drive e cole o link em "link dos stems".');

        var price = null;
        if (!isBeat) {
            var rawPrice = $('pr_price').value.trim().replace(',', '.');
            if (rawPrice !== '') {
                price = Number(rawPrice);
                if (!isFinite(price) || price < 0) return fail('O preço precisa ser 0 ou mais.', 'pr_price');
            } else if (grp === 'pack') {
                return fail('Falta o preço (use 0 para grátis).', 'pr_price');
            }
        }
        var deliveryUrl = $('pr_delivery_url').value.trim();
        if (grp === 'pack' && deliveryUrl && !/^https:\/\//i.test(deliveryUrl)) return fail('O link de entrega deve começar com https://', 'pr_delivery_url');

        btn.disabled = true;
        try {
            var id = editingProduct ? editingProduct.id : uuid();
            var old = editingProduct ? (state.files[id] || {}) : {};
            var coverUrl = editingProduct ? editingProduct.cover_url : null;
            var prevUrl = editingProduct ? editingProduct.preview_url : null;
            var paths = { mp3_path: old.mp3_path || null, wav_path: old.wav_path || null, stems_path: old.stems_path || null };

            if (coverF) {
                setStatus('bf_status', 'Enviando capa...');
                await upload('covers', id + '/cover.jpg', await resizeToJpeg(coverF, 1000), 'image/jpeg');
                coverUrl = publicUrl('covers', id + '/cover.jpg');
            }
            if (prevF) {
                setStatus('bf_status', isBeat ? 'Enviando preview...' : 'Enviando áudio demo...');
                var pe = fileExt(prevF, 'mp3');
                await upload('previews', id + '/preview.' + pe, prevF, prevF.type);
                prevUrl = publicUrl('previews', id + '/preview.' + pe);
            }
            if (mp3F) { setStatus('bf_status', 'Enviando MP3 master...'); paths.mp3_path = await upload('masters', id + '/master.' + fileExt(mp3F, 'mp3'), mp3F, mp3F.type); }
            if (wavF) { setStatus('bf_status', 'Enviando WAV master...'); paths.wav_path = await upload('masters', id + '/master.' + fileExt(wavF, 'wav'), wavF, wavF.type); }
            if (stemsF) { setStatus('bf_status', 'Enviando stems...'); paths.stems_path = await upload('masters', id + '/stems.' + fileExt(stemsF, 'zip'), stemsF, stemsF.type); }

            setStatus('bf_status', 'Salvando...');
            var tags = $('bf_tags').value.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean).slice(0, 6);
            var bpm = parseInt($('bf_bpm').value, 10);

            var row = {
                id: id,
                type: type,
                slug: editingProduct ? editingProduct.slug : productSlug(title, id),
                title: title,
                description: isBeat ? (editingProduct ? editingProduct.description : null) : ($('pr_desc').value.trim() || null),
                producer_id: $('bf_producer').value || null,
                genre_id: $('bf_genre').value || null,
                tags: tags,
                cover_url: coverUrl,
                preview_url: prevUrl,
                price: price,
                details: isBeat ? ((editingProduct && editingProduct.details) || {}) : readDetails(grp, editingProduct && editingProduct.details),
                published: $('bf_published').checked
            };
            var r1 = await db.from('products').upsert(row);
            if (r1.error && /products_title_len/.test(r1.error.message || '')) throw new Error('O título passa de ' + TITLE_MAX + ' caracteres. Encurte para salvar.');
            if (r1.error && /products_price_min/.test(r1.error.message || '')) throw new Error('O preço precisa ser 0 ou mais.');
            if (r1.error && /products_slug_key/.test(r1.error.message || '')) throw new Error('Já existe um produto com esse endereço. Mude um pouco o título.');
            if (r1.error) throw new Error(r1.error.message);

            if (isBeat) {
                var r2 = await db.from('product_beats').upsert({
                    product_id: id, type: 'beat',
                    bpm: isNaN(bpm) ? null : bpm,
                    musical_key: $('bf_key').value.trim() || null,
                    type_artists: parseList($('bf_types').value, 5),
                    note: $('bf_note').value.trim() || null
                });
                if (r2.error) throw new Error(r2.error.message);

                var r3 = await db.from('product_files').upsert({
                    product_id: id,
                    mp3_path: paths.mp3_path, wav_path: paths.wav_path, stems_path: paths.stems_path,
                    stems_link: $('bf_stemslink').value.trim() || null
                });
                if (r3.error) throw new Error(r3.error.message);
            } else if (grp === 'pack') {
                var r4 = await db.from('product_files').upsert({
                    product_id: id,
                    delivery_url: deliveryUrl || null,
                    delivery_note: $('pr_delivery_note').value.trim() || null
                });
                if (r4.error) throw new Error(r4.error.message);
            }

            closeModals();
            toast(isBeat ? 'Beat salvo.' : typeOne(type) + ' salvo.');
            await loadAll();
        } catch (err) {
            setStatus('bf_status', err.message, true);
        }
        btn.disabled = false;
    });

    async function deleteProduct(b) {
        if (!confirm('Excluir "' + b.title + '" e todos os arquivos dele? Não dá para desfazer.')) return;
        try {
            var buckets = ['covers', 'previews', 'masters'];
            for (var i = 0; i < buckets.length; i++) {
                var l = await db.storage.from(buckets[i]).list(b.id);
                if (l.data && l.data.length) {
                    await db.storage.from(buckets[i]).remove(l.data.map(function (x) { return b.id + '/' + x.name; }));
                }
            }
            var r = await db.from('products').delete().eq('id', b.id);     // leva junto product_beats e product_files
            if (r.error) throw new Error(r.error.message);
            toast('Produto excluído.');
            await loadAll();
        } catch (err) { toast('Erro: ' + err.message); }
    }

    // =========================================================
    // ENTREGA E CONFIRMACAO (beat: links assinados; pack: link privado; servico: data)
    // =========================================================
    // order = pedido de onde veio o clique (opcional): preenche a licenca e a data
    function openDelivery(b, order) {
        deliveryProduct = b;
        deliveryOrder = order || null;
        var grp = typeGroup(b.type);
        $('dl_title').textContent = (grp === 'service' ? 'Confirmar data: ' : 'Entrega: ') + b.title;
        $('dl_sub').textContent = grp === 'beat' ? 'Gera os links dos arquivos (valem 7 dias)'
            : grp === 'pack' ? 'Monta a mensagem com o link de entrega'
            : 'Monta a mensagem de confirmação da data';
        $('dl_generate').textContent = grp === 'beat' ? 'Gerar links' : 'Gerar mensagem';

        $('dl_license_field').hidden = grp !== 'beat';
        $('dl_date_field').hidden = grp !== 'service';
        if (grp === 'beat') {
            $('dl_license').innerHTML = CFG.LICENSES.map(function (l) {
                return '<option value="' + l.id + '">' + esc(l.name) + ' (' + brl(l.price) + ')</option>';
            }).join('');
            var want = order && (order.option_id || order.license_id);
            if (want && findIn(CFG.LICENSES, want)) $('dl_license').value = want;
        }
        if (grp === 'service') $('dl_date').value = order && order.desired_date ? String(order.desired_date).slice(0, 10) : '';

        $('dl_message').hidden = true;
        $('dl_copy').hidden = true;
        setStatus('dl_status', '');
        openModal('deliveryModal');
    }

    function showMessage(text, statusText, isWarn) {
        $('dl_message').value = text;
        $('dl_message').hidden = false;
        $('dl_copy').hidden = false;
        setStatus('dl_status', statusText, !!isWarn);
    }

    $('dl_generate').addEventListener('click', async function () {
        var b = deliveryProduct;
        var f = state.files[b.id] || {};
        var grp = typeGroup(b.type);
        var btn = $('dl_generate');
        btn.disabled = true;
        try {
            if (grp === 'pack') {
                if (!f.delivery_url) throw new Error('Esse produto não tem link de entrega. Edite o produto e cole o link.');
                showMessage(
                    'Pagamento confirmado! Seguem os arquivos de *' + b.title + '*:\n\n' + f.delivery_url +
                    (f.delivery_note ? '\n\n' + f.delivery_note : '') +
                    '\n\nBaixe e guarde. Qualquer coisa é só chamar!',
                    'Pronto. Copie e cole no WhatsApp do cliente.');
            } else if (grp === 'service') {
                var date = fmtDateOnly($('dl_date').value);
                if (!date) throw new Error('Escolha a data combinada.');
                var qty = deliveryOrder && deliveryOrder.quantity > 1 ? ' (' + deliveryOrder.quantity + 'x)' : '';
                showMessage(
                    'Oi! Confirmando o seu pedido de *' + b.title + '*' + qty + ' para o dia *' + date + '*.' +
                    (b.type === 'rental' ? ' Combine comigo o horário de retirada e de devolução.' : ' Me avisa se precisar mudar a data.') +
                    '\n\nQualquer dúvida é só chamar!',
                    'Pronto. Copie e cole no WhatsApp do cliente.');
            } else {
                var lic = $('dl_license').value;
                var want = lic === 'mp3' ? ['mp3'] : lic === 'wav' ? ['mp3', 'wav'] : ['mp3', 'wav', 'stems'];
                var labels = { mp3: 'MP3', wav: 'WAV', stems: 'Stems' };
                var lines = [], missing = [];
                setStatus('dl_status', 'Gerando links...');
                for (var i = 0; i < want.length; i++) {
                    var k = want[i];
                    var path = f[k + '_path'];
                    if (path) {
                        var r = await db.storage.from('masters').createSignedUrl(path, 7 * 24 * 3600);
                        if (r.error) throw new Error(r.error.message);
                        lines.push(labels[k] + ': ' + r.data.signedUrl);
                    } else if (k === 'stems' && f.stems_link) {
                        lines.push('Stems: ' + f.stems_link);
                    } else {
                        missing.push(labels[k]);
                    }
                }
                if (!lines.length) throw new Error('Esse beat não tem nenhum arquivo master enviado.');
                var licName = findIn(CFG.LICENSES, lic).name;
                showMessage(
                    'Pagamento confirmado! Seguem seus arquivos de *' + b.title + '* (licença ' + licName + '):\n\n' +
                    lines.join('\n\n') + '\n\nOs links valem por 7 dias, baixe e guarde. Qualquer coisa é só chamar!',
                    missing.length ? 'Atenção: faltam arquivos de ' + missing.join(', ') + ' neste beat.' : 'Pronto. Copie e cole no WhatsApp do cliente.',
                    missing.length > 0);
            }
        } catch (err) {
            setStatus('dl_status', err.message, true);
        }
        btn.disabled = false;
    });

    $('dl_copy').addEventListener('click', async function () {
        var ta = $('dl_message');
        try { await navigator.clipboard.writeText(ta.value); toast('Mensagem copiada.'); }
        catch (e) { ta.select(); document.execCommand('copy'); toast('Mensagem copiada.'); }
    });

    // filtros das listas
    $('fltType').innerHTML = typeOptions('Todos os tipos');
    $('fltOrderType').innerHTML = typeOptions('Todos os tipos');
    $('fltType').addEventListener('change', function () { listFilter.type = this.value; renderProducts(); });
    $('fltPub').addEventListener('change', function () { listFilter.pub = this.value; renderProducts(); });
    $('fltOrderType').addEventListener('change', function () { orderFilter.type = this.value; renderOrders(); });

    // =========================================================
    // EVENTOS
    // =========================================================
    document.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-tab]');
        if (tab) {
            var tabs = document.querySelectorAll('.tab');
            for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i] === tab);
            var name = tab.getAttribute('data-tab');
            ['products', 'producers', 'orders', 'waitlist', 'stats'].forEach(function (n) { $('tab-' + n).hidden = (n !== name); });
            if (name === 'stats' && !statsLoaded) loadStats();
            tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });     // a barra de abas rola ate a aba escolhida
            return;
        }

        if (e.target.closest('[data-close]') || (e.target.classList && e.target.classList.contains('modal-overlay'))) { closeModals(); return; }

        var act = e.target.closest('[data-act]');
        if (!act) return;
        var a = act.getAttribute('data-act');
        var id = act.getAttribute('data-id');
        if (a === 'new-product') openProductForm(null);
        else if (a === 'new-producer') openProducerForm(null);
        else if (a === 'edit-product') openProductForm(findIn(state.products, id));
        else if (a === 'edit-producer') openProducerForm(findIn(state.producers, id));
        else if (a === 'delivery') openDelivery(findIn(state.products, id), null);
        else if (a === 'order-delivery') {
            var ord = findIn(state.orders, id);
            var prd = ord && orderProduct(ord);
            if (prd) openDelivery(prd, ord);
        }
        else if (a === 'delete-product') deleteProduct(findIn(state.products, id));
        else if (a === 'delete-wait') deleteWait(id);
    });

    document.addEventListener('change', async function (e) {
        var t = e.target;
        var bid = t.getAttribute && t.getAttribute('data-toggle-product');
        var pid = t.getAttribute && t.getAttribute('data-toggle-producer');
        var oid = t.getAttribute && t.getAttribute('data-order-status');
        var r;
        if (bid) {
            r = await db.from('products').update({ published: t.checked }).eq('id', bid);
            if (r.error) { t.checked = !t.checked; toast('Erro: ' + r.error.message); }
            else {
                var pr = findIn(state.products, bid);
                pr.published = t.checked;
                var nm = pr.type === 'beat' ? 'Beat' : 'Produto';
                toast(t.checked ? nm + ' publicado.' : nm + ' oculto.');
            }
        } else if (pid) {
            r = await db.from('producers').update({ active: t.checked }).eq('id', pid);
            if (r.error) { t.checked = !t.checked; toast('Erro: ' + r.error.message); }
            else { findIn(state.producers, pid).active = t.checked; toast(t.checked ? 'Produtor ativo.' : 'Produtor oculto.'); }
        } else if (oid) {
            r = await db.from('orders').update({ status: t.value }).eq('id', oid);
            toast(r.error ? 'Erro: ' + r.error.message : 'Status atualizado.');
        }
    });

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModals(); });

    // =========================================================
    // START
    // =========================================================
    async function init() {
        if (!window.supabase) { showLogin(); toast('Sem conexão com o servidor. Recarregue a página.'); return; }
        db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
        var s = await db.auth.getSession();
        if (s.data && s.data.session) enterApp(); else showLogin();
    }
    init();
})();
