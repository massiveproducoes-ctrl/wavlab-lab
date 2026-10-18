# Wav Lab (LAB: ambiente de testes)

**Este repositório é o LAB**, a cópia de testes do site Wav Lab. Não é a produção.

## Regras do LAB (têm prioridade sobre o resto deste arquivo)

1. **O Supabase daqui é o de staging** (`rnqhytemdymjkpgtokvk`). O `config.js` do lab aponta só para ele.
2. **NUNCA use a URL ou as chaves da produção (`bgthmjchmssorcrirazs`) neste repositório.** Se aparecer esse código em qualquer arquivo, remova e avise o usuário. Ao copiar código do `wavlab` para cá, nunca copie o `config.js` junto.
3. **Os grants do lab são mais restritos que os da produção, de propósito.** Na produção, `anon` tem todos os privilégios nas tabelas (o RLS é a única barreira). No lab, `anon` só lê `genres`, `producers` e `beats` e só insere em `orders`, `events` e `waitlist`. Não "corrija" isso para igualar a produção.
4. **Features novas nascem aqui** e só vão para o `wavlab` (produção) depois de aprovadas pelo usuário. Ao portar, leve só o código da feature, não a faixa "LAB", os `noindex`, o `config.js` nem esta documentação.
5. Todas as páginas têm a faixa fixa "LAB · ambiente de testes" (`.lab-banner`, no `style.css`) e `<meta name="robots" content="noindex, nofollow">`. Páginas novas precisam dos dois.
6. A pasta `supabase/` (`schema.sql` e `conferencia.sql`) e qualquer `.csv` ficam no `.gitignore` e nunca vão para o GitHub. As regras de SQL abaixo (regra 4 da lista geral) continuam valendo: o usuário cola o SQL no Supabase; não rode SQL nem conecte ao banco.

---

# Wav Lab

Loja de beats (instrumentais) com vitrine pública e painel admin. Site estático, sem build e sem framework: HTML + CSS + JavaScript puro (ES5 na vitrine), com Supabase como banco, login e storage. Publicado no GitHub Pages a partir da branch `main`.

- Repositório do lab: `massiveproducoes-ctrl/wavlab-lab` (a produção é `massiveproducoes-ctrl/wavlab`)
- Site do lab: https://massiveproducoes-ctrl.github.io/wavlab-lab/
- Idioma do projeto: português do Brasil (textos da tela, comentários e mensagens de commit).

## Regras (valem sempre)

1. **Tudo configurável fica em `config.js`.** Preços, licenças e termos, WhatsApp, textos do topo, tempo do preview, URL e chave do Supabase. Não escreva esses valores direto em `app.js`, `admin.js` ou nos HTMLs. Se aparecer um valor novo que o dono pode querer mudar, crie a chave em `config.js` e leia de lá.
2. **Nunca coloque `secret key` nem `service_role` no código.** Só a chave pública (`anon`) pode ficar em `config.js`. Se o usuário colar uma chave, confira o `role` antes de gravar. Qualquer chave que não seja `anon` não entra em arquivo nenhum.
3. **Sempre teste antes de publicar.** Veja "Como testar" abaixo. Se não deu para testar alguma parte, diga qual antes de pedir autorização para publicar.
4. **SQL de banco: no lab fica em `supabase/` (ignorado pelo git); as migrações antigas estão fora do repositório.** O usuário cola o SQL no Supabase por conta própria. Salve o arquivo (ex.: `migracao_03.sql`) em `~\Documents\wavlab-sql` (`C:\Users\pedro\Documents\wavlab-sql`), fora do repositório, nunca nesta pasta, e nunca o inclua em commit. Não rode SQL, não tente se conectar ao banco e não use chave de administrador.
5. **Commits sempre com o e-mail noreply do GitHub já configurado neste repositório** (`git config user.email` dentro desta pasta). Não use o e-mail pessoal, não mude `user.email` (nem global nem local) e não use `--author` com outro e-mail. Se `git config user.email` mostrar algo que não termine em `@users.noreply.github.com`, pare e pergunte.
6. **Publicar só quando o usuário pedir.** "Publicar" é `git commit` + `git push origin main`. Nunca faça commit ou push por iniciativa própria. Termine o trabalho, mostre o `git status` e o `git diff --stat`, e pergunte se pode publicar.

7. **A stack é fixa: HTML, CSS e JavaScript puro, sem frameworks.** Nenhuma melhoria de design pode quebrar busca, filtros, player, modal de compra, admin ou páginas de produtor. Depois de qualquer mudança visual, teste todos eles (ver "Como testar").

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | Vitrine pública: busca, produtores, gêneros, lista de beats, mini player, modal de licença |
| `app.js` | Lógica da vitrine (ver abaixo) |
| `style.css` | Estilos da vitrine. O admin também carrega este arquivo |
| `admin.html` | Painel admin (`/admin.html`, `noindex`). Login, abas Beats / Produtores / Pedidos, modais de beat, produtor e entrega |
| `admin.js` | Lógica do admin |
| `admin.css` | Estilos extras só do admin, por cima do `style.css` |
| `licencas.html`, `licencas.js`, `licencas.css` | Página "Licenças": cards, regras gerais, crédito para copiar e FAQ. Tudo vem de `LICENSES`, `COMMON_TERMS`, `CREDIT_TEMPLATE` e `DELIVERY_DAYS` do `config.js` |
| `produtor.html` | **Página de todos os produtores**, estilo link na bio, em `produtor.html?p=<slug>`. Um arquivo só: produtor novo com slug no admin funciona sem pasta e sem código |
| `alexandre/`, `drin/`, `faciebat/`, `felipe/` (cada uma com `index.html`) | Endereços antigos `/<slug>/`, mantidos para os links já divulgados. Não crie pasta para produtor novo |
| `produtor.css` | Estilos extras só da página do produtor |
| `site.js` | Peças comuns da vitrine e da página de licenças: bloco "Quem somos" e links do rodapé (Instagram, WhatsApp) |
| `config.js` | Configuração única, lida por vitrine e admin via `window.WAVLAB` |
| `favicon.svg`, `og.png` | Ícone e imagem de pré-visualização do link (WhatsApp/Instagram) |

Os scripts são carregados na ordem: `supabase-js` (CDN jsDelivr, versão fixa) → `config.js` → `app.js` ou `admin.js`. Cada script é uma IIFE; não há módulos nem bundler.

## Como funciona

### Vitrine (`app.js`)
- Lê `beats` do Supabase com o `producers` e o `genres` embutidos (só `published = true`, mais novos primeiro) usando a chave `anon`.
- **Busca por type beat:** o texto é normalizado (minúsculo, sem acento) e as palavras "type", "beat", "instrumental" etc. são ignoradas (`STOP`). Cada palavra precisa aparecer em título, produtor, gênero, tags ou `type_artists`. A ordem de relevância é type > título > tag > resto. O termo buscado também vai para a URL (`?q=drake`).
- **Rolagem infinita:** lotes de `BATCH` (24) beats liberados por um `IntersectionObserver` no elemento `#sentinel`. Sem o observer, mostra tudo de uma vez.
- **Grade/lista:** escolha salva em `localStorage` (`wavlab_view`). O padrão é a lista (linha de faixa) em qualquer tela; em lista com 720 px ou mais ela vira colunas alinhadas, por container query.
- **Filtros:** gêneros e produtores só aparecem se houver mais de um. Os atalhos de busca (chips) vêm dos types e tags mais usados.
- **Player:** um único `Audio` para a página toda, cortado em `PREVIEW_SECONDS`.
- **Compra:** o modal mostra as licenças de `config.js`. O botão abre o WhatsApp (`wa.me/<WHATSAPP>`) com a mensagem pronta e grava um *lead* em `orders` com o texto exato da licença (`terms_snapshot`). O pagamento é por Pix, combinado no WhatsApp. Não existe checkout automático.
- Todo texto vindo do banco passa por `esc()` antes de ir para `innerHTML`. Mantenha assim.

### Link de beat, lista de espera e eventos (vitrine e página do produtor)
- **`?beat=ID`:** `app.js` (`focusBeat`) desenha os lotes da rolagem infinita até o beat, rola até ele e o destaca. Ignora `?q=` quando há `?beat=`. O botão "Copiar link" do modal copia `<página atual>?beat=ID` (na página do produtor, o link aponta para a própria página dele e mantém o `?p=<slug>`). O modal de compra está copiado em `index.html`, em `produtor.html` e em cada pasta antiga de produtor: mexeu nele, atualize todos.
- **"Em breve no Lab"** (só na vitrine): textos e itens em `COMING_SOON` (`config.js`). "Quero ser avisado" grava nome e WhatsApp (só dígitos, com 55) em `waitlist`. Tem campo-armadilha contra robô e lembra no `localStorage` (`wavlab_wait`).
- **Eventos** (`events`): `play`, `license_click`, `checkout` e `search_empty` (com o termo). Sem IP, sem cookie, sem identificador de pessoa. Termos que parecem telefone, e-mail ou link nunca são gravados. Se for criar evento novo, não grave dado pessoal. A falha ao gravar nunca pode atrapalhar a vitrine.
- Admin: abas "Lista de espera" (ver, copiar, abrir no WhatsApp, remover) e "Resumo" (últimos 30 dias, via função SQL `events_summary`). Sem a migração 04, só essas duas abas avisam; o resto do admin continua funcionando.
- **Ao testar, nunca grave em produção:** intercepte todo POST/DELETE para o Supabase (é o banco real) e responda com dados simulados.

### Página do produtor (`produtor.html?p=<slug>`)
- É o mesmo `app.js` da vitrine em "modo produtor": o `<body>` traz `data-producer="url"` (slug lido de `?p=` e validado) ou, nas pastas antigas, `data-producer="<slug>"` com `data-root="../"`. Ele busca o produtor em `producers` pelo `slug` (só `active = true`), desenha foto, nome, bio e botões, e carrega só os beats dele (`producer_id`). Player, modal de compra, grade/lista e rolagem infinita são os mesmos da vitrine; busca e filtros não existem nessa página.
- Botões: "Falar com o produtor" (WhatsApp da Wav Lab, mensagem em `PRODUCER_WA_TEXT`), Instagram (vem de `handle`) e Spotify (`spotify_url`). Botão sem dado não aparece.
- **Produtor novo não exige pasta nem código:** cadastre no admin com o slug preenchido e `produtor.html?p=<slug>` já funciona (só `active = true`). As pastas antigas continuam abrindo, mas não são mais necessárias. Slugs que não podem ser usados ficam em `RESERVED_SLUGS` (`config.js`).
- **Links para a página do produtor** (`producerHref` em `app.js`): nome do produtor em cada linha/card, "Prod. Nome" no modal e "Ver perfil completo" no mini cabeçalho que aparece quando a vitrine está filtrada por um produtor. Produtor sem slug (ou inativo) não gera link, só texto. A consulta lê `slug`, `bio` e `active` do produtor (migração 03) e tenta de novo sem eles se o banco ainda não os tem.
- O título da aba muda para o nome do produtor via JavaScript, mas a pré-visualização do link (`og:`) é genérica, porque o HTML é o mesmo para todos os produtores.
- Dentro das pastas antigas, caminhos de arquivos usam `../` (em `produtor.html`, que fica na raiz, não). Não use caminho começando com `/`: o site roda em `/wavlab/` no GitHub Pages.

### Admin (`admin.js`)
- Login por e-mail e senha do Supabase Auth. As permissões reais ficam nas regras (RLS) do banco, não no JavaScript.
- Cadastro de produtores (foto quadrada reduzida no navegador), de beats e conferência de pedidos (status `lead` → `pago` → `entregue`).
- **Título do beat: no máximo `TITLE_MAX` caracteres (70, em `config.js`).** O campo tem `maxlength`, contador "45/70", o salvar é bloqueado acima do limite e o botão "Usar sugestão" só aparece se a sugestão couber. `migracao_05.sql` (fora do repositório) trava o mesmo limite no banco (`beats_title_len`) e só cria a regra se nenhum beat passar de 70. Se mudar `TITLE_MAX`, mude também o SQL.
- Cadastro de beat: o título deve seguir `Artista Type Beat - "Nome"`, e o admin avisa quando não segue. Há também "Type de" (`type_artists`), tags, tom, BPM, nota, capa e preview de ~30s com tag de voz.
- **Entrega:** gera links assinados de 7 dias dos arquivos master para o usuário colar no WhatsApp do cliente.
- Excluir um beat apaga também os arquivos dele no storage.

### Supabase
- Tabelas usadas: `genres`, `producers`, `beats`, `beat_files`, `orders`.
- Buckets de storage: `covers`, `previews`, `avatars` (públicos) e `masters` (privado, só por link assinado).
- **Compatibilidade com o banco antigo:** `type_artists` (em `beats`) e `terms_snapshot` (em `orders`) vêm de uma migração SQL (`migracao_02`) que o usuário aplica no Supabase por conta própria. Se a coluna não existir, vitrine e admin tentam de novo sem ela e continuam funcionando. Preserve esse comportamento ao mexer nessas consultas.
- **Migração 04** (`~\Documents\wavlab-sql\migracao_04.sql`, fora do repositório): cria `waitlist` e `events` (público só insere; só quem está logado no admin lê), um freio contra enxurrada de registros e a função `events_summary(dias)`. Tabelas `waitlist` e `events` e a função só existem depois dela.
- **Migração 03** (`~\Documents\wavlab-sql\migracao_03.sql`, fora do repositório): cria `slug`, `bio` e `spotify_url` em `producers`. O admin tenta de novo sem esses campos se a migração não foi aplicada (e avisa). A página do produtor só funciona depois dela.

## Como testar

Não há suíte de testes. Antes de pedir para publicar:

1. Abra o site localmente por um servidor (não por `file://`), em uma pasta/porta separada do projeto, por exemplo `python -m http.server 8000` rodado com `--directory` apontando para esta pasta. Abra `http://localhost:8000/` e `/admin.html`.
2. Confira o console do navegador: nenhum erro vermelho.
3. Na vitrine: os beats carregam; a busca (`drake type beat`, termo com acento, termo sem resultado); filtros de gênero e produtor; alternar grade/lista; rolar até o fim da lista; tocar um preview; abrir o modal e conferir o link do WhatsApp; testar em largura de celular (~390 px).
4. No admin (se mexeu nele): o login abre, as abas trocam e os modais abrem/fecham. Ações que gravam no banco só devem ser testadas com autorização do usuário, porque o banco é o de produção.
5. Se mexeu em `config.js`: confira que a vitrine mostra os valores novos.
6. Diga ao usuário o que foi testado e o que não deu para testar.

## Publicar (somente quando o usuário pedir)

1. `git status` e `git diff --stat` para o usuário conferir.
2. `git config user.email` deve ser o noreply do GitHub (regra 5).
3. `git add` apenas dos arquivos do site, citados um a um. Não use `git add -A` nem `git add .`, para não incluir `.sql` ou outro arquivo solto por engano.
4. `git commit` com mensagem em português, curta, descrevendo o que mudou para quem usa o site.
5. `git push origin main`. O GitHub Pages atualiza sozinho em ~1 minuto.
6. Se o push der erro 403, a conta salva no Windows não tem acesso ao repositório. Este repositório usa `credential.username = massiveproducoes-ctrl`. Não mexa nas credenciais salvas; avise o usuário.
7. Informe o resultado do push (deu certo ou não).
