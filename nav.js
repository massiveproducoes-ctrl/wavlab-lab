// @ts-nocheck
/* Wav Lab - navegacao do topo. A aba "Packs" so aparece quando existe pack publicado; a aba "Servicos"
   troca o "em breve" pelo link quando existe servico ou aluguel publicado. Configuracao em config.js */
(function () {
    'use strict';

    var CFG = window.WAVLAB || {};
    var packs = document.getElementById('navPacks');
    var services = document.getElementById('navServicos');
    var soon = document.getElementById('navServicosSoon');
    if (!window.supabase) return;

    var packTypes = CFG.PACK_TYPES || [];
    var serviceTypes = CFG.SERVICE_TYPES || [];
    // so consulta o que ainda nao se sabe: a propria pagina (data-always) ja tem a aba visivel
    var checkPacks = !!packs && packs.getAttribute('data-always') !== '1';
    var checkServices = !!services && services.getAttribute('data-always') !== '1';
    if (!checkPacks && !checkServices) return;

    var types = (checkPacks ? packTypes : []).concat(checkServices ? serviceTypes : []);
    if (!types.length) return;

    try {
        // cliente proprio, sem sessao: so uma consulta de leitura
        var db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        db.from('products').select('type').eq('published', true).in('type', types).limit(200)
            .then(function (res) {
                if (res.error || !res.data) return;
                var has = function (list) { return res.data.some(function (r) { return list.indexOf(r.type) > -1; }); };
                if (checkPacks && has(packTypes)) packs.hidden = false;
                if (checkServices && has(serviceTypes)) {
                    services.hidden = false;
                    if (soon) soon.hidden = true;
                }
            }, function () { /* sem rede: as abas ficam como estao */ });
    } catch (err) { /* nunca atrapalha a pagina */ }
})();
