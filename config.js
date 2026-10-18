// @ts-nocheck
// Wav Lab - configuracao unica. Vitrine e admin leem daqui.
// LAB: aponta para o Supabase de TESTES (rnqhytemdymjkpgtokvk). Nunca usar a URL/chave da producao aqui.
// A chave abaixo e PUBLICA (anon) e pode ficar no site.
// NUNCA coloque aqui a "secret key" nem a "service_role".
window.WAVLAB = {
    SUPABASE_URL: 'https://rnqhytemdymjkpgtokvk.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJucWh5dGVtZHltamtwZ3Rva3ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTMxNTYsImV4cCI6MjEwNzgyOTE1Nn0.NYMvBoKiPtqnY5gzKGyFnZJDbJxs8_5RDsJLx8Yi0aQ',

    // Numero que recebe todos os leads (so digitos, com 55 + DDD)
    WHATSAPP: '5591985447000',

    PREVIEW_SECONDS: 30,

    // Admin: limite de caracteres do titulo do beat (o SQL migracao_05 trava o mesmo numero no banco)
    TITLE_MAX: 70,

    // Instagram do rodape (endereco completo, comecando com https://).
    // Perfil oficial: @wavlab.studio. Deixe '' para esconder o link.
    INSTAGRAM: 'https://www.instagram.com/wavlab.studio/',

    // Bloco "Quem somos" (acima do rodape). TEXTO PROVISORIO.
    ABOUT_TITLE: 'Quem somos',
    ABOUT_TEXT: 'A Wav Lab é um ateliê de beats feito por produtores. Cada instrumental sai das mãos de quem assina, e você fala direto com a gente: tire dúvidas, peça um beat no seu estilo e feche a licença pelo WhatsApp.',

    // Bloco "Em breve no Lab" da vitrine + formulario "Quero ser avisado". TEXTOS PROVISORIOS.
    // icon = nome de um icone Font Awesome (fa-...)
    COMING_SOON: {
        TITLE: 'Em breve no Lab',
        ITEMS: [
            { name: 'Sample packs', desc: 'Loops e one-shots prontos para usar na sua produção.', icon: 'fa-wave-square' },
            { name: 'Plugins', desc: 'Ferramentas para o seu som.', icon: 'fa-sliders' }
        ],
        BUTTON: 'Quero ser avisado',
        JOINED: 'Você está na lista',
        FORM_INTRO: 'Deixe seu nome e WhatsApp. A gente avisa assim que sair.',
        NOTE: 'Usamos seu número só para avisar dos lançamentos da Wav Lab. Se quiser sair da lista, é só pedir.',
        DONE: 'Fechou! Você está na lista e vai ser avisado pelo WhatsApp.'
    },

    // Pagina do produtor (/slug/): mensagem do botao "Falar com o produtor" ({produtor} vira o nome)
    PRODUCER_WA_TEXT: 'Salve! Vim pela página de {produtor} no Wav Lab e queria conversar sobre os beats.',

    // Enderecos que o slug de um produtor NAO pode usar (ja sao paginas ou arquivos do site)
    RESERVED_SLUGS: ['admin', 'licencas', 'index', 'config', 'app', 'site', 'style', 'produtor', 'favicon', 'og', 'assets'],

    // Pagina de licencas: modelo do credito ({produtor} vira o nome) e validade dos links de download
    CREDIT_TEMPLATE: 'Prod. {produtor}',
    DELIVERY_DAYS: 7,

    // Texto do topo da vitrine (o slogan ainda esta em definicao)
    HERO_TITLE: 'Beats com identidade.',
    HERO_SUB: 'Previews de 30s. Licencie direto e feche pelo WhatsApp.',

    // =====================================================================
    // LICENCAS - precos iguais para todos no beta.
    // ATENCAO: os limites de "terms" abaixo sao EXEMPLOS de mercado.
    // Combinem com os produtores (e, se possivel, com um advogado) antes
    // de divulgar, e ajuste aqui. O site mostra exatamente o que estiver escrito.
    // =====================================================================
    LICENSES: [
        {
            id: 'mp3', name: 'MP3', desc: 'Arquivo MP3 masterizado', price: 100,
            terms: [
                'Arquivo MP3 de alta qualidade',
                'Até 100 mil streams somados',
                '1 música gravada com o beat',
                '1 clipe de vídeo'
            ]
        },
        {
            id: 'wav', name: 'WAV', desc: 'Arquivo WAV em alta resolução', price: 180,
            terms: [
                'MP3 + WAV em alta resolução',
                'Até 500 mil streams somados',
                '1 música gravada com o beat',
                '1 clipe de vídeo'
            ]
        },
        {
            id: 'stems', name: 'Stems', desc: 'Trackout completo (WAV + MP3)', price: 350,
            terms: [
                'MP3 + WAV + stems separados para mixar',
                'Até 1 milhão de streams somados',
                '1 música gravada com o beat',
                'Até 2 clipes de vídeo'
            ]
        },
        {
            id: 'unlimited', name: 'Unlimited', desc: 'Stems + direitos ilimitados', price: 950,
            terms: [
                'Tudo da licença Stems',
                'Streams e clipes ilimitados',
                'Shows e uso comercial ilimitados',
                'Não exclusiva: o beat segue à venda'
            ]
        }
    ],

    // Regras que valem para todas as licencas
    COMMON_TERMS: [
        'Licença não exclusiva: o beat continua disponível para outros artistas.',
        'Crédito obrigatório nas plataformas: "Prod. nome do produtor".',
        'Proibido revender o beat ou registrá-lo no Content ID.'
    ]
};
