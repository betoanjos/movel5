# Por que o Worker publicado mora aqui

O painel é publicado num Worker que busca os arquivos do site direto do
GitHub. Para publicar uma versão nova do próprio Worker, o script precisa
chegar até a API da Cloudflare — e o ambiente que fala com essa API não
alcança o GitHub.

A saída é usar o Worker que já está no ar como carregador: ele busca este
arquivo no GitHub (como faz com qualquer arquivo de `web/`), guarda no banco,
e a publicação lê o script de lá. Nenhum byte precisa passar pela conversa.

`worker.js` é gerado por `node scripts/bundle.mjs --do-github --commit=<branch>`
e minificado com esbuild. A versão legível fica em `worker/dist/movel5.js`.
