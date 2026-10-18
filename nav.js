// @ts-nocheck
/* Wav Lab - navegacao do topo: a aba "Packs" so aparece quando existe pack publicado. Configuracao em config.js */
(function () {
    'use strict';

    var CFG = window.WAVLAB || {};
    var link = document.getElementById('navPacks');
    if (!link || link.getAttribute('data-always') === '1' || !window.supabase) return;

    try {
        // cliente proprio, sem sessao: so uma consulta de leitura
        var db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        db.from('products').select('id').eq('published', true).in('type', CFG.PACK_TYPES || []).limit(1)
            .then(function (res) {
                if (!res.error && res.data && res.data.length) link.hidden = false;
            }, function () { /* sem rede: a aba fica escondida */ });
    } catch (err) { /* nunca atrapalha a pagina */ }
})();
