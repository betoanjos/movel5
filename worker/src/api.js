// API do painel financeiro da Móvel5.
//
// O Worker faz três coisas: serve o site estático, cuida do login e guarda
// os registros no D1. Todo o processamento dos arquivos acontece no
// navegador — nenhum extrato é enviado para cá, só os lançamentos já
// interpretados.

const COLECOES = new Set([
  'contas', 'lancamentos', 'categorias', 'regras', 'fechamentos',
  'vendas', 'compras', 'contasPagar', 'contrapartes', 'enriquecimentos',
  'diasVenda', 'config', 'importacoes',
]);

const COOKIE = 'movel5_sessao';
const DURACAO_SESSAO = 60 * 60 * 24 * 30;   // 30 dias
// O Workers recusa PBKDF2 acima de 100.000 iterações
// ("iteration counts above 100000 are not supported"), então este é o teto da
// plataforma — e o wrangler local NÃO aplica esse limite, só a produção.
const ITERACOES = 100000;

/** Um pedido é da API quando o caminho começa com /api/. */
export const ehAPI = (url) => url.pathname.startsWith('/api/');

/** Trata um pedido da API. O restante do site é servido por quem chama. */
export async function tratarAPI(pedido, env) {
  const url = new URL(pedido.url);
  try {
    await garantirEsquema(env);
    const resposta = await roteador(pedido, env, url);
    resposta.headers.set('Cache-Control', 'no-store');
    resposta.headers.set('X-Content-Type-Options', 'nosniff');
    return resposta;
  } catch (e) {
    if (e instanceof RespostaErro) return json({ erro: e.message }, e.status);
    console.error(e);
    return json({ erro: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
}

// ----------------------------------------------------------------- esquema ---

let esquemaPronto = false;

/**
 * Cria as tabelas na primeira vez que o Worker roda.
 *
 * Assim não sobra nenhum comando manual depois de publicar: seja pelo botão
 * da Cloudflare, pelo painel ou pelo wrangler, o banco se prepara sozinho.
 * Roda uma vez por instância e usa IF NOT EXISTS, então é barato.
 */
async function garantirEsquema(env) {
  if (esquemaPronto) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS registros (
      colecao TEXT NOT NULL, id TEXT NOT NULL, dados TEXT NOT NULL,
      competencia TEXT, atualizado INTEGER NOT NULL,
      PRIMARY KEY (colecao, id))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_registros_colecao ON registros (colecao)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_registros_competencia ON registros (colecao, competencia)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usuarios (
      usuario TEXT PRIMARY KEY, nome TEXT NOT NULL, senha_hash TEXT NOT NULL,
      criado_em INTEGER NOT NULL, token_ver INTEGER NOT NULL DEFAULT 1)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, acao TEXT NOT NULL,
      colecao TEXT, qtd INTEGER, em INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ajustes (
      chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`),
  ]);
  esquemaPronto = true;
}

class RespostaErro extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const erro = (status, msg) => { throw new RespostaErro(status, msg); };

const json = (corpo, status = 200, headers = {}) =>
  new Response(corpo === null ? null : JSON.stringify(corpo), {
    status: corpo === null ? 204 : status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

// ------------------------------------------------------------------ rotas ---

async function roteador(pedido, env, url) {
  const caminho = url.pathname.replace(/^\/api/, '') || '/';
  const metodo = pedido.method;

  if (caminho === '/situacao' && metodo === 'GET') {
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM usuarios').all();
    return json({ configurado: (results[0]?.n || 0) > 0 });
  }

  if (caminho === '/setup' && metodo === 'POST') return primeiroAcesso(pedido, env);

  if (caminho === '/sessao') {
    if (metodo === 'POST') return entrar(pedido, env);
    if (metodo === 'DELETE') return sair();
    if (metodo === 'GET') {
      const s = await sessaoDe(pedido, env);
      if (!s) erro(401, 'Sem sessão.');
      return json({ usuario: { usuario: s.usuario, nome: s.nome } });
    }
  }

  // Daqui para baixo, tudo exige sessão.
  const sessao = await sessaoDe(pedido, env);
  if (!sessao) erro(401, 'Entre para continuar.');

  if (caminho === '/sessao/senha' && metodo === 'POST') return trocarSenha(pedido, env, sessao);

  if (caminho === '/dados' && metodo === 'DELETE') {
    await env.DB.prepare('DELETE FROM registros').run();
    await auditar(env, sessao, 'apagou tudo', null, null);
    return json({ ok: true });
  }

  const mColecaoTudo = caminho.match(/^\/dados\/([a-zA-Z]+)\/tudo$/);
  if (mColecaoTudo && metodo === 'DELETE') {
    const colecao = validaColecao(mColecaoTudo[1]);
    await env.DB.prepare('DELETE FROM registros WHERE colecao = ?').bind(colecao).run();
    await auditar(env, sessao, 'limpou coleção', colecao, null);
    return json({ ok: true });
  }

  const mColecao = caminho.match(/^\/dados\/([a-zA-Z]+)$/);
  if (mColecao) {
    const colecao = validaColecao(mColecao[1]);
    if (metodo === 'GET') return listar(env, colecao);
    if (metodo === 'PUT') return gravar(pedido, env, colecao, sessao);
    if (metodo === 'DELETE') return remover(pedido, env, colecao, sessao);
  }

  if (caminho === '/auditoria' && metodo === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT usuario, acao, colecao, qtd, em FROM auditoria ORDER BY id DESC LIMIT 100').all();
    return json(results);
  }

  erro(404, 'Rota não encontrada.');
}

const validaColecao = (nome) => {
  if (!COLECOES.has(nome)) erro(400, `Coleção desconhecida: ${nome}`);
  return nome;
};

// ------------------------------------------------------------------ dados ---

async function listar(env, colecao) {
  const { results } = await env.DB
    .prepare('SELECT dados FROM registros WHERE colecao = ?').bind(colecao).all();
  const saida = [];
  for (const r of results) {
    try { saida.push(JSON.parse(r.dados)); } catch { /* registro corrompido: ignora */ }
  }
  return json(saida);
}

async function gravar(pedido, env, colecao, sessao) {
  const corpo = await lerJSON(pedido);
  const registros = corpo?.registros;
  if (!Array.isArray(registros)) erro(400, 'Esperava uma lista em "registros".');
  if (registros.length > 500) erro(413, 'Envie no máximo 500 registros por vez.');

  const agora = Date.now();
  const sql = `INSERT INTO registros (colecao, id, dados, competencia, atualizado)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(colecao, id) DO UPDATE SET
                 dados = excluded.dados,
                 competencia = excluded.competencia,
                 atualizado = excluded.atualizado`;

  const lote = registros.map((r) => {
    if (!r || typeof r !== 'object' || !r.id) erro(400, 'Todo registro precisa de um "id".');
    const texto = JSON.stringify(r);
    if (texto.length > 100000) erro(413, 'Registro grande demais.');
    return env.DB.prepare(sql).bind(colecao, String(r.id), texto, r.competencia ?? null, agora);
  });

  await env.DB.batch(lote);
  await auditar(env, sessao, 'gravou', colecao, registros.length);
  return json({ gravados: registros.length });
}

async function remover(pedido, env, colecao, sessao) {
  const corpo = await lerJSON(pedido);
  const ids = corpo?.ids;
  if (!Array.isArray(ids) || !ids.length) erro(400, 'Esperava uma lista em "ids".');
  if (ids.length > 500) erro(413, 'Remova no máximo 500 registros por vez.');

  const sql = 'DELETE FROM registros WHERE colecao = ? AND id = ?';
  await env.DB.batch(ids.map((id) => env.DB.prepare(sql).bind(colecao, String(id))));
  await auditar(env, sessao, 'removeu', colecao, ids.length);
  return json({ removidos: ids.length });
}

async function lerJSON(pedido) {
  try { return await pedido.json(); }
  catch { erro(400, 'Corpo da requisição não é um JSON válido.'); }
}

const auditar = (env, sessao, acao, colecao, qtd) =>
  env.DB.prepare('INSERT INTO auditoria (usuario, acao, colecao, qtd, em) VALUES (?, ?, ?, ?, ?)')
    .bind(sessao.usuario, acao, colecao, qtd, Date.now()).run()
    .catch(() => { /* a auditoria nunca derruba a operação */ });

// ------------------------------------------------------------------ login ---

async function primeiroAcesso(pedido, env) {
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM usuarios').all();
  if ((results[0]?.n || 0) > 0) erro(409, 'O painel já foi configurado.');

  const corpo = await lerJSON(pedido);
  const usuarios = corpo?.usuarios;
  if (!Array.isArray(usuarios) || !usuarios.length || usuarios.length > 5) {
    erro(400, 'Informe de 1 a 5 usuários.');
  }

  const agora = Date.now();
  const linhas = [];
  for (const u of usuarios) {
    const login = String(u.usuario || '').trim().toLowerCase();
    const nome = String(u.nome || login).trim();
    const senha = String(u.senha || '');
    if (!/^[a-z0-9._-]{3,32}$/.test(login)) erro(400, `Usuário inválido: "${login}". Use letras, números, ponto, hífen ou sublinhado.`);
    if (senha.length < 8) erro(400, `A senha de "${login}" precisa de pelo menos 8 caracteres.`);
    linhas.push(env.DB
      .prepare('INSERT INTO usuarios (usuario, nome, senha_hash, criado_em, token_ver) VALUES (?, ?, ?, ?, 1)')
      .bind(login, nome, await gerarHash(senha), agora));
  }
  await env.DB.batch(linhas);
  return json({ ok: true, criados: usuarios.length });
}

async function entrar(pedido, env) {
  const corpo = await lerJSON(pedido);
  const login = String(corpo?.usuario || '').trim().toLowerCase();
  const senha = String(corpo?.senha || '');

  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE usuario = ?').bind(login).first();
  // Confere o hash mesmo sem usuário, para o tempo de resposta não denunciar
  // quais logins existem.
  const referencia = u?.senha_hash || `pbkdf2$${ITERACOES}$AAAAAAAAAAAAAAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;
  const confere = await conferirHash(senha, referencia);
  if (!u || !confere) erro(401, 'Usuário ou senha incorretos.');

  const token = await assinarToken({ u: u.usuario, v: u.token_ver }, env);
  return json({ usuario: { usuario: u.usuario, nome: u.nome } }, 200, {
    'Set-Cookie': cookie(token, DURACAO_SESSAO),
  });
}

const sair = () => json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });

async function trocarSenha(pedido, env, sessao) {
  const corpo = await lerJSON(pedido);
  const atual = String(corpo?.atual || '');
  const nova = String(corpo?.nova || '');
  if (nova.length < 8) erro(400, 'A senha nova precisa de pelo menos 8 caracteres.');

  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE usuario = ?').bind(sessao.usuario).first();
  if (!u || !(await conferirHash(atual, u.senha_hash))) erro(401, 'Senha atual incorreta.');

  await env.DB.prepare('UPDATE usuarios SET senha_hash = ?, token_ver = token_ver + 1 WHERE usuario = ?')
    .bind(await gerarHash(nova), sessao.usuario).run();

  // A sessão atual continua válida; as demais caem.
  const token = await assinarToken({ u: u.usuario, v: u.token_ver + 1 }, env);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(token, DURACAO_SESSAO) });
}

const cookie = (valor, maxAge) =>
  `${COOKIE}=${valor}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

async function sessaoDe(pedido, env) {
  const bruto = (pedido.headers.get('Cookie') || '')
    .split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!bruto) return null;

  const dados = await verificarToken(bruto.slice(COOKIE.length + 1), env);
  if (!dados) return null;

  const u = await env.DB.prepare('SELECT usuario, nome, token_ver FROM usuarios WHERE usuario = ?')
    .bind(dados.u).first();
  if (!u || u.token_ver !== dados.v) return null;
  return { usuario: u.usuario, nome: u.nome };
}

// ------------------------------------------------------- criptografia ------

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytes = (s) => new TextEncoder().encode(s);

async function derivar(senha, salt, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', bytes(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iteracoes, hash: 'SHA-256' }, chave, 256);
}

async function gerarHash(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(senha, salt, ITERACOES);
  return `pbkdf2$${ITERACOES}$${b64(salt)}$${b64(hash)}`;
}

async function conferirHash(senha, guardado) {
  const [alg, it, salt, hash] = String(guardado).split('$');
  const iteracoes = Number(it);
  // Formato inválido é senha inválida. Já uma falha do próprio PBKDF2 é
  // problema de servidor e deve aparecer como tal, em vez de virar um
  // silencioso "senha incorreta" que esconde a causa.
  if (alg !== 'pbkdf2' || !salt || !hash || !Number.isInteger(iteracoes) || iteracoes < 1) return false;
  const calculado = await derivar(senha, deB64(salt), iteracoes);
  return igualdadeConstante(new Uint8Array(calculado), deB64(hash));
}

/** Comparação de tempo constante — não vaza o quanto o palpite chegou perto. */
function igualdadeConstante(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

let segredoCache = null;

/**
 * Segredo que assina os cookies de sessão.
 *
 * Usa a variável de ambiente quando ela existe. Se não existir, gera um na
 * primeira vez e guarda no banco — quem publica pelo botão da Cloudflare não
 * precisa configurar nada, e quem prefere o jeito clássico define o segredo e
 * ele passa a valer. Guardar no banco não afrouxa nada de verdade: quem tem
 * acesso ao banco já tem acesso a todos os dados.
 */
async function segredo(env) {
  const doAmbiente = env.SESSAO_SEGREDO;
  if (doAmbiente && doAmbiente.length >= 16) return doAmbiente;
  if (segredoCache) return segredoCache;

  const guardado = await env.DB
    .prepare("SELECT valor FROM ajustes WHERE chave = 'sessao_segredo'").first();
  if (guardado?.valor) { segredoCache = guardado.valor; return segredoCache; }

  const novo = b64(crypto.getRandomValues(new Uint8Array(48)));
  await env.DB
    .prepare("INSERT OR IGNORE INTO ajustes (chave, valor) VALUES ('sessao_segredo', ?)")
    .bind(novo).run();
  const efetivo = await env.DB
    .prepare("SELECT valor FROM ajustes WHERE chave = 'sessao_segredo'").first();
  segredoCache = efetivo?.valor || novo;
  return segredoCache;
}

const chaveHmac = async (env) =>
  crypto.subtle.importKey('raw', bytes(await segredo(env)), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']);

async function assinarToken(dados, env) {
  const corpo = { ...dados, exp: Math.floor(Date.now() / 1000) + DURACAO_SESSAO };
  const texto = b64(bytes(JSON.stringify(corpo))).replace(/=+$/, '');
  const assinatura = b64(await crypto.subtle.sign('HMAC', await chaveHmac(env), bytes(texto)))
    .replace(/=+$/, '');
  return `${texto}.${assinatura}`;
}

async function verificarToken(token, env) {
  const [texto, assinatura] = String(token).split('.');
  if (!texto || !assinatura) return null;
  try {
    const esperado = b64(await crypto.subtle.sign('HMAC', await chaveHmac(env), bytes(texto)))
      .replace(/=+$/, '');
    if (!igualdadeConstante(bytes(esperado), bytes(assinatura))) return null;
    const dados = JSON.parse(new TextDecoder().decode(deB64(texto + '==='.slice(texto.length % 4 || 3))));
    if (!dados.exp || dados.exp < Math.floor(Date.now() / 1000)) return null;
    return dados;
  } catch { return null; }
}
