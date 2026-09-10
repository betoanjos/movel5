# Publicar o painel na Cloudflare

Ao final deste guia você terá um endereço na internet, com login para você e
para o seu sócio, e um banco de dados compartilhado. **Tudo dentro do plano
gratuito da Cloudflare** — não é preciso cadastrar cartão.

Leva uns 15 minutos. Você vai digitar alguns comandos no terminal; pode copiar
e colar cada um.

---

## Já publicado

O painel está em **<https://movel5.an5.workers.dev>**, num Worker
`movel5` com o banco D1 `movel5-financeiro`, na conta da Móvel5.

O endereço antigo (`movel5-financeiro.an5.workers.dev`) continua funcionando:
redireciona para cá, preservando o caminho.

Nessa publicação o Worker guarda os arquivos do site no próprio banco e busca
as bibliotecas pesadas (leitor de PDF, de planilhas e gerador de PDF) num CDN,
com cache na borda. Foi o caminho possível pela API; o resultado é o mesmo.

### Atualizar o painel

O Worker publicado busca os arquivos do branch
`claude/movel5-financial-dashboard-rs3azk` e guarda cada um no banco na
primeira vez que é pedido. Então, depois de um `git push`, basta esvaziar
esse cache — os arquivos são buscados de novo na visita seguinte e o Worker
não precisa ser republicado:

```bash
npx wrangler d1 execute movel5-financeiro --remote --command "DELETE FROM arquivos;"
```

> **Espere alguns segundos entre o `git push` e o comando acima.** O GitHub
> serve o arquivo cru por CDN e leva um instante para propagar; esvaziando o
> cache cedo demais, o Worker busca a versão antiga e guarda ela de novo.
> Se acontecer, é só repetir o comando.

Republicar o Worker só é necessário quando muda o código da API
(`worker/src/api.js`) ou do próprio empacotador.

> **Cuidado com arquivo novo.** O Worker que está no ar hoje só serve os
> arquivos que existiam quando foi empacotado: um `.js` criado depois volta
> como a página inicial e quebra o painel inteiro. Por isso, enquanto ele não
> for republicado, código novo entra em arquivo que já existe. O empacotador
> já foi corrigido — a próxima publicação passa a aceitar arquivos novos.

### Passar para a publicação pelo wrangler

Se preferir o caminho padrão, em que tudo é servido pela própria Cloudflare
sem depender do GitHub:

```bash
git pull
npx wrangler deploy
```

Como o banco já existe, cole o `database_id` dele no `wrangler.jsonc`:

```
38aef38d-0ee7-4e03-9620-0134955cd82a
```

Os dados continuam onde estão — trocar a forma de publicar não mexe no banco.

Se preferir refazer tudo do zero, ou publicar em outra conta, siga o passo a
passo a partir daqui.

## Antes de começar

Você precisa de:

1. Uma conta na Cloudflare — <https://dash.cloudflare.com/sign-up> (gratuita).
2. O Node.js instalado — <https://nodejs.org> (baixe a versão "LTS").
3. Este repositório no seu computador:

```bash
git clone https://github.com/betoanjos/movel5.git
cd movel5
```

---

## Passo 1 — Entrar na sua conta Cloudflare

```bash
npx wrangler login
```

Vai abrir o navegador pedindo autorização. Autorize e volte ao terminal.

## Passo 2 — Criar o banco de dados

> Se você vai continuar usando o banco que já existe, pule para o passo 4 e
> apenas cole o `database_id` acima no `wrangler.jsonc`.

```bash
npx wrangler d1 create movel5-financeiro
```

O comando responde com um bloco parecido com este:

```
[[d1_databases]]
binding = "DB"
database_name = "movel5-financeiro"
database_id = "8f2c1d4a-....-............"
```

**Copie o `database_id`.** Abra o arquivo `worker/wrangler.toml` e substitua
`COLE_AQUI_O_ID_DO_SEU_BANCO` por esse número, entre aspas.

## Passo 3 — Criar as tabelas

```bash
cd worker
npx wrangler d1 execute movel5-financeiro --remote --file=schema.sql
```

## Passo 4 — Definir o segredo das sessões

É uma senha longa que o servidor usa para assinar os cookies de login. Ela
nunca aparece para ninguém e não precisa ser memorizada.

```bash
npx wrangler secret put SESSAO_SEGREDO
```

Quando pedir o valor, cole um texto longo e aleatório. Se quiser gerar um:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Passo 5 — Publicar

```bash
npx wrangler deploy
```

No fim ele mostra o endereço, algo como:

```
https://movel5-financeiro.SEU-USUARIO.workers.dev
```

## Passo 6 — Criar os acessos

Abra esse endereço no navegador. Como é a primeira vez, aparece a tela
**"Vamos criar os acessos"**. Preencha o nome, o usuário e a senha de cada
pessoa e clique em criar.

Essa tela aparece **uma única vez**. Depois disso o endereço passa a pedir
login.

> Guarde as senhas. Não há tela de "esqueci minha senha" — para redefinir é
> preciso usar a linha de comando (veja mais abaixo).

Pronto. Mande o endereço para o seu sócio e ele entra com o usuário dele.

---

## Publicando uma atualização

Sempre que o painel mudar:

```bash
git pull
cd worker
npx wrangler deploy
```

Os dados ficam no banco e não são afetados.

---

## Tarefas do dia a dia

### Adicionar uma pessoa depois

A tela de primeiro acesso só funciona quando não há nenhum usuário. Para
incluir mais alguém depois, gere o hash da senha e insira direto no banco:

```bash
# 1) gere o hash (troque SENHA-DA-PESSOA)
node -e "
const c=require('crypto');
const senha='SENHA-DA-PESSOA', it=100000;
const salt=c.randomBytes(16);
const h=c.pbkdf2Sync(senha,salt,it,32,'sha256');
console.log(\`pbkdf2\\\$\${it}\\\$\${salt.toString('base64')}\\\$\${h.toString('base64')}\`);
"

# 2) insira o usuário (cole o hash no lugar de HASH-GERADO)
npx wrangler d1 execute movel5-financeiro --remote --command \
  "INSERT INTO usuarios (usuario, nome, senha_hash, criado_em, token_ver)
   VALUES ('maria', 'Maria', 'HASH-GERADO', strftime('%s','now')*1000, 1);"
```

### Redefinir a senha de alguém

Gere um hash novo com o comando acima e atualize:

```bash
npx wrangler d1 execute movel5-financeiro --remote --command \
  "UPDATE usuarios SET senha_hash='HASH-NOVO', token_ver=token_ver+1
   WHERE usuario='roberto';"
```

O `token_ver+1` derruba as sessões antigas dessa pessoa.

### Remover um acesso

```bash
npx wrangler d1 execute movel5-financeiro --remote --command \
  "DELETE FROM usuarios WHERE usuario='fulano';"
```

### Ver quem mexeu em quê

O painel guarda uma trilha simples das gravações:

```bash
npx wrangler d1 execute movel5-financeiro --remote --command \
  "SELECT usuario, acao, colecao, qtd, datetime(em/1000,'unixepoch','-3 hours') AS quando
   FROM auditoria ORDER BY id DESC LIMIT 30;"
```

### Fazer backup

Pelo painel: **Ajustes → Backup e dados → Baixar backup**. Guarde o arquivo
JSON. Vale fazer isso depois de fechar cada mês.

---

## Quanto custa

Nada, no uso desta empresa. Os limites gratuitos da Cloudflare são:

| Recurso | Limite grátis | Uso esperado aqui |
|---|---|---|
| Requisições ao Worker | 100.000 por dia | algumas centenas |
| Banco D1 — armazenamento | 5 GB | poucos MB por ano |
| Banco D1 — leituras | 5 milhões por dia | alguns milhares |
| Banco D1 — escritas | 100.000 por dia | algumas centenas |

Mesmo lançando dois anos de histórico de uma vez, sobra folga.

---

## Se algo der errado

**"The secret SESSAO_SEGREDO is not defined"** — falta o passo 4.

**"D1_ERROR: no such table"** — falta o passo 3. Confira também se o
`database_id` no `wrangler.toml` é o mesmo que o comando do passo 2 devolveu.

**A página abre mas fica girando** — abra o console do navegador (F12) e veja
o erro. Em geral é o `database_id` errado no `wrangler.toml`.

**Esqueci a senha e sou a única pessoa cadastrada** — use o comando de
redefinir senha acima. Ele não depende de estar logado.

**Quero recomeçar do zero** — apaga tudo, inclusive os lançamentos:

```bash
npx wrangler d1 execute movel5-financeiro --remote --command \
  "DELETE FROM registros; DELETE FROM usuarios;"
```

Na próxima visita a tela de primeiro acesso aparece de novo.

---

## E se eu não quiser publicar?

O painel funciona inteiro sem servidor nenhum. Basta abrir a pasta `web/`:

```bash
cd web
python3 -m http.server 8000
```

e acessar <http://localhost:8000>. Nesse modo os dados ficam guardados só
naquele navegador, naquele computador — então faça backup pelo painel de vez
em quando.
