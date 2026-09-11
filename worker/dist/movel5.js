// GERADO POR scripts/bundle.mjs — NÃO EDITE À MÃO.
// Painel financeiro da Móvel5: API e site num módulo de Worker só.
// 32 arquivos · 502 kB · pacote de 0 kB · bibliotecas vindas do CDN

// Integração com o Bling (API v3) — SOMENTE LEITURA.
//
// Regra que vale para tudo aqui: o painel nunca escreve no Bling. Nenhum
// pedido, nenhuma conta, nenhum cadastro. O Bling é a fonte de consulta que
// dá nome e origem ao dinheiro que aparece no extrato — quem manda no
// financeiro é o extrato bancário, não o ERP.
//
// Por isso só existem chamadas GET, e os escopos pedidos na autorização são
// de leitura. Se algum dia alguém tentar usar isto para lançar algo no
// Bling, vai ter que reescrever o arquivo inteiro — de propósito.

// A autorização é uma página do site (o usuário vê e aprova); os dados vêm
// do endpoint oficial da API. O Bling recusa chamada de dados em www com
// 403 e a mensagem "utilize o endpoint oficial: api.bling.com.br".
const AUTORIZAR = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const TOKENS = [
  'https://api.bling.com.br/Api/v3/oauth/token',
  'https://www.bling.com.br/Api/v3/oauth/token',
];
const BASE = 'https://api.bling.com.br/Api/v3';

// O Bling aceita 3 requisições por segundo. Ficamos abaixo disso de
// propósito: sincronizar rápido não interessa, sincronizar sem tomar 429 sim.
const PAUSA_MS = 400;
const LIMITE_PAGINA = 100;
const MAX_PAGINAS = 30;          // teto por recurso, por rodada

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ------------------------------------------------------------- ajustes ---

async function lerAjuste(env, chave) {
  const r = await env.DB.prepare('SELECT valor FROM ajustes WHERE chave = ?').bind(chave).first();
  if (!r?.valor) return null;
  try { return JSON.parse(r.valor); } catch { return r.valor; }
}

async function gravarAjuste(env, chave, valor) {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  await env.DB
    .prepare('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .bind(chave, texto).run();
}

const apagarAjuste = (env, chave) =>
  env.DB.prepare('DELETE FROM ajustes WHERE chave = ?').bind(chave).run();

// --------------------------------------------------------------- OAuth ---

async function blingEstado(env) {
  const cred = await lerAjuste(env, 'bling_credenciais');
  const tok = await lerAjuste(env, 'bling_tokens');
  const sync = await lerAjuste(env, 'bling_sync');
  return {
    temCredenciais: !!cred?.client_id,
    clientId: cred?.client_id ? `${String(cred.client_id).slice(0, 6)}…` : null,
    conectado: !!tok?.refresh_token,
    expiraEm: tok?.expira_em || null,
    ultimaSync: sync?.em || null,
    resumo: sync?.resumo || null,
    erro: sync?.erro || null,
  };
}

async function blingSalvarCredenciais(env, { client_id, client_secret }) {
  if (!client_id || !client_secret) throw new Error('Informe client_id e client_secret.');
  await gravarAjuste(env, 'bling_credenciais', {
    client_id: String(client_id).trim(),
    client_secret: String(client_secret).trim(),
  });
  return { ok: true };
}

async function blingDesconectar(env) {
  await apagarAjuste(env, 'bling_tokens');
  await apagarAjuste(env, 'bling_oauth_estado');
  return { ok: true };
}

async function blingUrlAutorizacao(env) {
  const cred = await lerAjuste(env, 'bling_credenciais');
  if (!cred?.client_id) throw new Error('Cadastre client_id e client_secret primeiro.');
  const estadoOauth = crypto.randomUUID().replace(/-/g, '');
  await gravarAjuste(env, 'bling_oauth_estado', { estado: estadoOauth, em: Date.now() });
  const u = new URL(AUTORIZAR);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cred.client_id);
  u.searchParams.set('state', estadoOauth);
  return u.toString();
}

const basico = (cred) => 'Basic ' + btoa(`${cred.client_id}:${cred.client_secret}`);

/** Troca o code pelo par de tokens, ou renova com o refresh_token. */
async function pedirToken(env, corpo) {
  const cred = await lerAjuste(env, 'bling_credenciais');
  if (!cred?.client_id) throw new Error('Sem credenciais do Bling.');

  // Tenta o endpoint oficial e, se ele recusar, o do site — os dois já
  // responderam em momentos diferentes.
  let r = null;
  let texto = '';
  let dados = null;
  for (const url of TOKENS) {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basico(cred),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(corpo).toString(),
    });
    texto = await r.text();
    dados = null;
    try { dados = JSON.parse(texto); } catch { /* resposta não-JSON */ }
    if (r.ok && dados?.access_token) break;
  }
  if (!r?.ok || !dados?.access_token) {
    throw new Error(`Bling recusou o token (${r?.status}): ${texto.slice(0, 200)}`);
  }

  const tokens = {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    // Guarda com folga de um minuto, para nunca usar um token vencendo.
    expira_em: Date.now() + (Number(dados.expires_in || 3600) - 60) * 1000,
  };
  await gravarAjuste(env, 'bling_tokens', tokens);
  return tokens;
}

async function blingTrocarCodigo(env, code, estadoRecebido) {
  const guardado = await lerAjuste(env, 'bling_oauth_estado');
  if (!guardado?.estado || guardado.estado !== estadoRecebido) {
    throw new Error('Autorização não confere (state). Comece de novo.');
  }
  await apagarAjuste(env, 'bling_oauth_estado');
  return pedirToken(env, { grant_type: 'authorization_code', code });
}

async function tokenValido(env) {
  const tok = await lerAjuste(env, 'bling_tokens');
  if (!tok?.access_token) throw new Error('Painel ainda não conectado ao Bling.');
  if (tok.expira_em && Date.now() < tok.expira_em) return tok.access_token;
  if (!tok.refresh_token) throw new Error('Sessão do Bling expirada. Conecte de novo.');
  const novo = await pedirToken(env, { grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  return novo.access_token;
}

// ----------------------------------------------------------- chamadas ----

/** GET numa rota do Bling. Só GET: a integração é de leitura. */
async function buscar(env, rota, params = {}) {
  const token = await tokenValido(env);
  const u = new URL(BASE + rota);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { /* deixa nulo */ }
  return { ok: r.ok, status: r.status, dados, texto: texto.slice(0, 400) };
}

/**
 * Percorre as páginas de uma rota até acabar ou bater o teto.
 * Devolve também a primeira resposta crua, que é o que permite acertar o
 * mapeamento com os dados reais da conta dele em vez de adivinhar.
 */
async function paginar(env, rota, params = {}, maxPaginas = MAX_PAGINAS) {
  const itens = [];
  let amostra = null;
  let pagina = 1;
  while (pagina <= maxPaginas) {
    const r = await buscar(env, rota, { ...params, pagina, limite: LIMITE_PAGINA });
    if (!r.ok) {
      if (pagina === 1) return { itens, amostra, erro: `${r.status}: ${r.texto}` };
      break;
    }
    const lote = Array.isArray(r.dados?.data) ? r.dados.data : (Array.isArray(r.dados) ? r.dados : []);
    if (pagina === 1) amostra = lote[0] || null;
    itens.push(...lote);
    if (lote.length < LIMITE_PAGINA) break;
    pagina++;
    await espera(PAUSA_MS);
  }
  return { itens, amostra, erro: null };
}

// ---------------------------------------------------------- descoberta ---

/**
 * Pergunta ao Bling o que a conta dele expõe.
 *
 * A documentação da v3 é uma página JavaScript que não dá para ler de fora,
 * então em vez de adivinhar nomes de campo eu pergunto: bate em cada rota
 * candidata, guarda quais responderam e o primeiro registro de cada uma.
 * Com isso o mapeamento é feito em cima do dado real.
 */
async function blingDescobrir(env) {
  const candidatas = [
    '/pedidos/vendas', '/pedidos/compras', '/contas/pagar', '/contas/receber',
    '/nfe', '/contatos', '/produtos', '/categorias/receitas-despesas',
    '/formas-pagamentos', '/borderos', '/contas-contabeis', '/canais-venda',
    '/depositos', '/situacoes/modulos',
  ];
  const achadas = [];
  for (const rota of candidatas) {
    const r = await buscar(env, rota, { pagina: 1, limite: 1 });
    const lote = Array.isArray(r.dados?.data) ? r.dados.data : [];
    achadas.push({
      rota,
      status: r.status,
      ok: r.ok,
      itens: lote.length,
      amostra: r.ok ? (lote[0] ?? null) : null,
      erro: r.ok ? null : r.texto,
    });
    await espera(PAUSA_MS);
  }
  await gravarAjuste(env, 'bling_descoberta', { em: new Date().toISOString(), achadas });
  return achadas.map(({ rota, status, ok, itens, erro }) => ({ rota, status, ok, itens, erro }));
}

// ------------------------------------------------------- mapeamentos -----
//
// As formas abaixo vieram do que a conta dele devolve de verdade, não da
// documentação. Três coisas que só o dado real contou:
//
//  1. O número que ele conhece do pedido é `numeroLoja` (12448), não `numero`
//     (4737, que é a contagem interna do Bling).
//  2. Situação vem como número — `{"id":6,"valor":0}` —, então cancelado só
//     dá para saber consultando a tabela de situações do módulo.
//  3. Em pedido de compra e em conta a pagar, o contato vem só com `id`. O
//     nome mora no cadastro de contatos, que por isso é carregado primeiro.

/** Primeiro caminho que existir no objeto: 'contato.nome', 'cliente.nome'… */
const pegar = (obj, ...caminhos) => {
  for (const c of caminhos) {
    let v = obj;
    for (const parte of c.split('.')) v = v?.[parte];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
};

const numero = (v) => {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const dataISO = (v) => {
  const s = String(v ?? '').trim();
  if (s.startsWith('0000')) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
};

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const CANCELADO = /cancel|denegad|rejeitad/i;

/**
 * Índices que dão nome aos números: contatos, canais de venda e situações.
 * Carregados uma vez por sincronização e usados por todos os mapeamentos.
 */
async function montarIndices(env) {
  const contatos = new Map();
  const canais = new Map();
  const situacoes = new Map();

  const c = await paginar(env, '/contatos', {}, 12);
  for (const x of c.itens) {
    contatos.set(String(x.id), {
      nome: String(x.nome || '').trim(),
      doc: soDigitos(x.numeroDocumento),
      tipo: String(x.tipo || ''),
    });
  }

  const cv = await buscar(env, '/canais-venda', { pagina: 1, limite: 100 });
  for (const x of (cv.dados?.data || [])) {
    canais.set(String(x.id), `${x.descricao || ''}${x.tipo ? ` (${x.tipo})` : ''}`.trim());
  }
  await espera(PAUSA_MS);

  // Situação vem como id; o nome está na tabela de cada módulo.
  const mods = await buscar(env, '/situacoes/modulos', { pagina: 1, limite: 100 });
  for (const mod of (mods.dados?.data || [])) {
    await espera(PAUSA_MS);
    const r = await buscar(env, `/situacoes/modulos/${mod.id}`, {});
    for (const sit of (r.dados?.data || [])) {
      situacoes.set(`${mod.id}:${sit.id}`, String(sit.nome || sit.descricao || ''));
      if (!situacoes.has(String(sit.id))) situacoes.set(String(sit.id), String(sit.nome || sit.descricao || ''));
    }
  }

  return { contatos, canais, situacoes, totalContatos: c.itens.length };
}

const nomeSituacao = (idx, id) => idx.situacoes.get(String(id)) || '';

/** Pedido de venda -> mesma forma que o CSV de pedidos produz. */
const mapPedidoVenda = (idx) => (p) => {
  // O número que ele vê no Bling e no extrato é o da loja.
  const num = String(pegar(p, 'numeroLoja', 'numero', 'id')).trim();
  const data = dataISO(pegar(p, 'data', 'dataEmissao'));
  if (!num || !data) return null;
  const sit = nomeSituacao(idx, pegar(p, 'situacao.id'));
  const contato = idx.contatos.get(String(pegar(p, 'contato.id'))) || {};
  return {
    fonte: 'bling', origem_api: 1,
    numero: num,
    numeroBling: String(pegar(p, 'numero') || ''),
    data,
    dataPagamento: dataISO(pegar(p, 'dataSaida')) || null,
    cliente: String(pegar(p, 'contato.nome') || contato.nome || '').trim(),
    documento: soDigitos(pegar(p, 'contato.numeroDocumento')) || contato.doc || '',
    canal: idx.canais.get(String(pegar(p, 'loja.id'))) || '',
    total: numero(pegar(p, 'total', 'totalProdutos')),
    valorPago: 0,
    situacao: sit,
    situacaoId: String(pegar(p, 'situacao.id') || ''),
    cancelado: CANCELADO.test(sit) ? 1 : 0,
    ref: `bling-ped:${num}`,
  };
};

/** Pedido de compra -> entra junto das notas de entrada, como compra. */
const mapPedidoCompra = (idx) => (p) => {
  const num = String(pegar(p, 'numero', 'id')).trim();
  const data = dataISO(pegar(p, 'data', 'dataPrevista'));
  if (!num || !data) return null;
  const sit = nomeSituacao(idx, pegar(p, 'situacao.id'));
  const forn = idx.contatos.get(String(pegar(p, 'fornecedor.id', 'contato.id'))) || {};
  return {
    fonte: 'bling-pedido-compra', origem_api: 1,
    numero: num,
    data,
    fornecedor: String(pegar(p, 'fornecedor.nome', 'contato.nome') || forn.nome || '').trim(),
    documento: soDigitos(pegar(p, 'fornecedor.numeroDocumento')) || forn.doc || '',
    valor: numero(pegar(p, 'total', 'totalProdutos')),
    situacao: sit,
    cancelado: CANCELADO.test(sit) ? 1 : 0,
    ref: `bling-pc:${num}`,
  };
};

/** Nota fiscal de entrada. */
const mapNota = (idx) => (n) => {
  const num = String(pegar(n, 'numero', 'id')).trim();
  const data = dataISO(pegar(n, 'dataEmissao', 'dataOperacao'));
  if (!num || !data) return null;
  const sit = nomeSituacao(idx, pegar(n, 'situacao'));
  const contato = idx.contatos.get(String(pegar(n, 'contato.id'))) || {};
  return {
    fonte: 'bling', origem_api: 1,
    numero: num,
    data,
    fornecedor: String(pegar(n, 'contato.nome') || contato.nome || '').trim(),
    documento: soDigitos(pegar(n, 'contato.numeroDocumento')) || contato.doc || '',
    valor: numero(pegar(n, 'valorNota', 'total', 'valor')),
    situacao: sit || String(pegar(n, 'situacao') || ''),
    chave: String(pegar(n, 'chaveAcesso') || ''),
    cancelado: CANCELADO.test(sit) ? 1 : 0,
    ref: `bling-nfe-api:${num}`,
  };
};

/** Conta a pagar -> alimenta a conciliação dos pagamentos do extrato. */
const mapContaPagar = (idx) => (c) => {
  const venc = dataISO(pegar(c, 'vencimento', 'dataVencimento'));
  const valor = numero(pegar(c, 'valor', 'valorTotal'));
  if (!venc || !valor) return null;
  const contato = idx.contatos.get(String(pegar(c, 'contato.id'))) || {};
  const sit = nomeSituacao(idx, pegar(c, 'situacao'));
  return {
    fonte: 'bling', origem_api: 1,
    fornecedor: String(pegar(c, 'contato.nome') || contato.nome || '').trim(),
    documento: String(pegar(c, 'numeroDocumento') || '').trim(),
    historico: String(pegar(c, 'historico', 'observacoes') || '').trim(),
    vencimento: venc,
    situacao: sit || String(pegar(c, 'situacao') || ''),
    // No Bling, 1 = em aberto e 2 = pago/baixado.
    paga: String(pegar(c, 'situacao')) === '2' || /pag|liquidad|baixad/i.test(sit) ? 1 : 0,
    valor,
    contaContabil: String(pegar(c, 'contaContabil.descricao') || ''),
    ref: `bling-cp-api:${pegar(c, 'id') || venc + ':' + valor}`,
  };
};

/** Conta a receber -> o que ainda vai entrar. */
const mapContaReceber = (idx) => (c) => {
  const venc = dataISO(pegar(c, 'vencimento', 'dataVencimento'));
  const valor = numero(pegar(c, 'valor', 'valorTotal'));
  if (!venc || !valor) return null;
  const contato = idx.contatos.get(String(pegar(c, 'contato.id'))) || {};
  const sit = nomeSituacao(idx, pegar(c, 'situacao'));
  return {
    fonte: 'bling', origem_api: 1,
    cliente: String(pegar(c, 'contato.nome') || contato.nome || '').trim(),
    documento: soDigitos(pegar(c, 'contato.numeroDocumento')) || contato.doc || '',
    vencimento: venc,
    dataEmissao: dataISO(pegar(c, 'dataEmissao')),
    situacao: sit || String(pegar(c, 'situacao') || ''),
    recebida: String(pegar(c, 'situacao')) === '2' || /receb|liquidad|baixad/i.test(sit) ? 1 : 0,
    valor,
    contaContabil: String(pegar(c, 'contaContabil.descricao') || ''),
    origemTipo: String(pegar(c, 'origem.tipoOrigem') || ''),
    origemNumero: String(pegar(c, 'origem.numero') || ''),
    ref: `bling-cr-api:${pegar(c, 'id') || venc + ':' + valor}`,
  };
};

/** Contato -> cadastro que dá nome ao CNPJ que aparece no extrato. */
const mapContato = (c) => {
  const doc = soDigitos(pegar(c, 'numeroDocumento', 'documento', 'cpfCnpj'));
  const nome = String(pegar(c, 'nome', 'razaoSocial', 'fantasia') || '').trim();
  if (!doc || doc.length < 11 || !nome) return null;
  return {
    nome,
    documento: doc,
    tipo: String(pegar(c, 'tipo') || '').trim(),
    fonte: 'bling-api',
    ref: `bling-contato:${doc}`,
  };
};

// ------------------------------------------------------ sincronização ----

/** Grava na mesma tabela que o painel já lê, com id estável por `ref`. */
async function gravarColecao(env, colecao, registros) {
  if (!registros.length) return 0;
  const agora = Date.now();
  const sql = `INSERT INTO registros (colecao, id, dados, competencia, atualizado)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(colecao, id) DO UPDATE SET
                 dados = excluded.dados,
                 competencia = excluded.competencia,
                 atualizado = excluded.atualizado`;
  // O id vem do `ref`: sincronizar de novo atualiza a mesma linha em vez de
  // duplicar, e uma importação por arquivo depois reaproveita o mesmo id.
  const lotes = [];
  for (const r of registros) {
    const id = r.ref || crypto.randomUUID();
    const comp = (r.data || r.vencimento || '').slice(0, 7) || null;
    lotes.push(env.DB.prepare(sql).bind(colecao, id, JSON.stringify({ ...r, id }), comp, agora));
  }
  for (let i = 0; i < lotes.length; i += 50) {
    await env.DB.batch(lotes.slice(i, i + 50));
  }
  return registros.length;
}

const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * Puxa do Bling e grava no painel. Só leitura, sempre.
 *
 * `desde` limita o período dos pedidos e das contas; os contatos vêm
 * inteiros, porque é o cadastro que dá nome ao CNPJ do extrato.
 */
async function blingSincronizar(env, { desde = null, dias = 180 } = {}) {
  const inicio = desde || diasAtras(dias);
  const hoje = new Date().toISOString().slice(0, 10);
  const resumo = {};
  const erros = {};
  const amostras = {};

  // Primeiro os índices: sem eles, pedido de compra e conta a pagar vêm com
  // o contato como um número e o painel não teria nome nenhum para mostrar.
  let idx;
  try {
    idx = await montarIndices(env);
    resumo.contatosLidos = { lidos: idx.totalContatos, gravados: 0 };
  } catch (e) {
    return { em: new Date().toISOString(), resumo, erro: { indices: String(e.message || e) } };
  }

  const rodar = async (nome, rota, params, mapear, colecao) => {
    try {
      const { itens, amostra, erro } = await paginar(env, rota, params);
      if (erro) { erros[nome] = erro; return; }
      amostras[nome] = amostra;
      const mapeados = itens.map(mapear).filter(Boolean);
      resumo[nome] = { lidos: itens.length, gravados: await gravarColecao(env, colecao, mapeados) };
    } catch (e) {
      erros[nome] = String(e.message || e).slice(0, 200);
    }
    await espera(PAUSA_MS);
  };

  // Contatos com CNPJ/CPF viram cadastro de contrapartes.
  try {
    const contatos = [...idx.contatos.entries()]
      .map(([id, c]) => mapContato({ id, nome: c.nome, numeroDocumento: c.doc, tipo: c.tipo }))
      .filter(Boolean);
    resumo.contatos = {
      lidos: idx.totalContatos,
      gravados: await gravarColecao(env, 'contrapartes', contatos),
    };
    delete resumo.contatosLidos;
  } catch (e) { erros.contatos = String(e.message || e).slice(0, 200); }

  await rodar('pedidosVenda', '/pedidos/vendas',
    { dataInicial: inicio, dataFinal: hoje }, mapPedidoVenda(idx), 'vendas');

  await rodar('pedidosCompra', '/pedidos/compras',
    { dataInicial: inicio, dataFinal: hoje }, mapPedidoCompra(idx), 'compras');

  await rodar('notasEntrada', '/nfe',
    { tipo: 0, dataEmissaoInicial: inicio, dataEmissaoFinal: hoje }, mapNota(idx), 'compras');

  await rodar('contasPagar', '/contas/pagar',
    { dataVencimentoInicial: inicio, dataVencimentoFinal: hoje }, mapContaPagar(idx), 'contasPagar');

  await rodar('contasReceber', '/contas/receber',
    { dataVencimentoInicial: inicio, dataVencimentoFinal: hoje }, mapContaReceber(idx), 'contasReceber');

  const registro = {
    em: new Date().toISOString(),
    periodo: { de: inicio, ate: hoje },
    resumo,
    erro: Object.keys(erros).length ? erros : null,
  };
  await gravarAjuste(env, 'bling_sync', registro);
  await gravarAjuste(env, 'bling_amostras', { em: registro.em, amostras });
  return registro;
}


// API do painel financeiro da Móvel5.
//
// O Worker faz três coisas: serve o site estático, cuida do login e guarda
// os registros no D1. Todo o processamento dos arquivos acontece no
// navegador — nenhum extrato é enviado para cá, só os lançamentos já
// interpretados.


const COLECOES = new Set([
  'contas', 'lancamentos', 'categorias', 'regras', 'fechamentos',
  'vendas', 'compras', 'contasPagar', 'contasReceber', 'contrapartes',
  'enriquecimentos', 'diasVenda', 'config', 'importacoes',
]);

const COOKIE = 'movel5_sessao';
const DURACAO_SESSAO = 60 * 60 * 24 * 30;   // 30 dias
// O Workers recusa PBKDF2 acima de 100.000 iterações
// ("iteration counts above 100000 are not supported"), então este é o teto da
// plataforma — e o wrangler local NÃO aplica esse limite, só a produção.
const ITERACOES = 100000;

/** Um pedido é da API quando o caminho começa com /api/. */
const ehAPI = (url) => url.pathname.startsWith('/api/');

/** Trata um pedido da API. O restante do site é servido por quem chama. */
async function tratarAPI(pedido, env) {
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

  // ---- Bling (somente leitura; ver worker/src/bling.js) ----
  if (caminho.startsWith('/bling/')) return rotaBling(caminho, metodo, pedido, env, sessao);

  if (caminho === '/auditoria' && metodo === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT usuario, acao, colecao, qtd, em FROM auditoria ORDER BY id DESC LIMIT 100').all();
    return json(results);
  }

  erro(404, 'Rota não encontrada.');
}

/**
 * Rotas da integração com o Bling. O callback do OAuth é a única que o
 * navegador acessa sem estar na tela do painel — ela volta redirecionando.
 */
async function rotaBling(caminho, metodo, pedido, env, sessao) {
  if (caminho === '/bling/estado' && metodo === 'GET') return json(await blingEstado(env));

  if (caminho === '/bling/credenciais' && metodo === 'POST') {
    const corpo = await pedido.json().catch(() => ({}));
    await blingSalvarCredenciais(env, corpo);
    await auditar(env, sessao, 'bling: credenciais', null, null);
    return json({ ok: true });
  }

  if (caminho === '/bling/conectar' && metodo === 'GET') {
    return json({ url: await blingUrlAutorizacao(env) });
  }

  if (caminho === '/bling/callback' && metodo === 'GET') {
    const url = new URL(pedido.url);
    const code = url.searchParams.get('code');
    const est = url.searchParams.get('state');
    const destino = (msg) => new Response(null, {
      status: 302,
      headers: { Location: `/#/ajustes?bling=${encodeURIComponent(msg)}` },
    });
    if (!code) return destino('cancelado');
    try {
      await blingTrocarCodigo(env, code, est);
      await auditar(env, sessao, 'bling: conectou', null, null);
      return destino('ok');
    } catch (e) {
      return destino(String(e.message || e).slice(0, 120));
    }
  }

  if (caminho === '/bling/desconectar' && metodo === 'POST') {
    await blingDesconectar(env);
    await auditar(env, sessao, 'bling: desconectou', null, null);
    return json({ ok: true });
  }

  if (caminho === '/bling/sincronizar' && metodo === 'POST') {
    const corpo = await pedido.json().catch(() => ({}));
    const r = await blingSincronizar(env, corpo);
    await auditar(env, sessao, 'bling: sincronizou', null, null);
    return json(r);
  }

  if (caminho === '/bling/descobrir' && metodo === 'POST') {
    return json({ rotas: await blingDescobrir(env) });
  }

  if (caminho === '/bling/amostras' && metodo === 'GET') {
    const r = await env.DB.prepare("SELECT valor FROM ajustes WHERE chave = 'bling_amostras'").first();
    return json(r?.valor ? JSON.parse(r.valor) : { amostras: {} });
  }

  erro(404, 'Rota do Bling não encontrada.');
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


// ---------------------------------------------------------- site estático ---

const PACOTE = 'H4sIAAAAAAACA6uuBQBDv6ajAgAAAA==';
const CDN = {"/vendor/pdf.min.mjs":"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs","/vendor/pdf.worker.min.mjs":"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs","/vendor/xlsx.full.min.js":"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js","/vendor/jspdf.umd.min.js":"https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js","/vendor/jspdf.plugin.autotable.min.js":"https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.3/jspdf.plugin.autotable.min.js"};

// Modo "buscar no repositório": os arquivos vêm de um commit fixo do GitHub na
// primeira vez e ficam guardados no banco. Depois disso o GitHub não é mais
// consultado — o painel continua de pé mesmo se o repositório voltar a ser
// privado ou sair do ar.
const ORIGEM = "https://raw.githubusercontent.com/betoanjos/movel5/claude/movel5-financial-dashboard-rs3azk/web";
const TIPOS = {"/assets/LOGO.md":"text/markdown; charset=utf-8","/assets/app.css":"text/css; charset=utf-8","/assets/icone.png":"image/png","/assets/logo-escuro.png":"image/png","/assets/logo.png":"image/png","/dist/LEIA.md":"text/markdown; charset=utf-8","/dist/worker.js":"text/javascript; charset=utf-8","/index.html":"text/html; charset=utf-8","/js/db/api.js":"text/javascript; charset=utf-8","/js/db/local.js":"text/javascript; charset=utf-8","/js/engine/motor.js":"text/javascript; charset=utf-8","/js/engine/relatorio.js":"text/javascript; charset=utf-8","/js/engine/seed.js":"text/javascript; charset=utf-8","/js/lib/graficos.js":"text/javascript; charset=utf-8","/js/lib/ui.js":"text/javascript; charset=utf-8","/js/lib/util.js":"text/javascript; charset=utf-8","/js/main.js":"text/javascript; charset=utf-8","/js/parsers/bling.js":"text/javascript; charset=utf-8","/js/parsers/gateways.js":"text/javascript; charset=utf-8","/js/parsers/index.js":"text/javascript; charset=utf-8","/js/parsers/ofx.js":"text/javascript; charset=utf-8","/js/parsers/pdf-text.js":"text/javascript; charset=utf-8","/js/parsers/planilha.js":"text/javascript; charset=utf-8","/js/parsers/sicoob.js":"text/javascript; charset=utf-8","/js/store.js":"text/javascript; charset=utf-8","/js/views/ajustes.js":"text/javascript; charset=utf-8","/js/views/fechamento.js":"text/javascript; charset=utf-8","/js/views/importar.js":"text/javascript; charset=utf-8","/js/views/lancamentos.js":"text/javascript; charset=utf-8","/js/views/painel.js":"text/javascript; charset=utf-8","/js/views/relatorio.js":"text/javascript; charset=utf-8","/js/views/revisar.js":"text/javascript; charset=utf-8"};
// Arquivo criado depois deste empacotamento: descobre o tipo pela extensão em
// vez de devolver a página inicial. Sem isto, um import novo cai no HTML e o
// painel inteiro para de carregar.
const TIPOS_POR_EXTENSAO = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".md":"text/markdown; charset=utf-8",".txt":"text/plain; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon",".woff2":"font/woff2"};
const tipoDe = (caminho) => TIPOS[caminho] ||
  TIPOS_POR_EXTENSAO[(caminho.match(/.[a-z0-9]+$/i) || [''])[0].toLowerCase()] || null;

let tabelaPronta = false;

async function garantirTabelaArquivos(env) {
  if (tabelaPronta) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS arquivos (caminho TEXT PRIMARY KEY, tipo TEXT NOT NULL, conteudo TEXT NOT NULL)'
  ).run();
  tabelaPronta = true;
}

/**
 * A coluna do banco guarda texto, então arquivo binário (as imagens da logo)
 * é gravado em base64 e decodificado na hora de servir. Sem isto o PNG chega
 * corrompido ao navegador.
 */
const ehBinario = (tipo) => !/^text\/|json|javascript|svg/.test(tipo);

async function servirDoRepositorio(caminho, pedido, env, ctx) {
  const tipo = tipoDe(caminho);
  if (!ORIGEM || !tipo) return null;
  await garantirTabelaArquivos(env);

  const guardado = await env.DB
    .prepare('SELECT conteudo FROM arquivos WHERE caminho = ?').bind(caminho).first();

  let conteudo = guardado?.conteudo;
  if (conteudo == null) {
    const r = await fetch(ORIGEM + caminho);
    if (!r.ok) return null;
    if (ehBinario(tipo)) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bruto = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        bruto += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      conteudo = btoa(bruto);
    } else {
      conteudo = await r.text();
    }
    ctx.waitUntil(
      env.DB.prepare('INSERT OR REPLACE INTO arquivos (caminho, tipo, conteudo) VALUES (?, ?, ?)')
        .bind(caminho, tipo, conteudo).run()
    );
  }

  const etag = '"' + conteudo.length.toString(36) + '"';
  if (pedido.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const corpo = ehBinario(tipo)
    ? Uint8Array.from(atob(conteudo), (c) => c.charCodeAt(0))
    : conteudo;
  return new Response(corpo, {
    headers: {
      'Content-Type': tipo,
      'Cache-Control': ehBinario(tipo)
        ? 'public, max-age=604800'
        : 'public, max-age=0, must-revalidate',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

let arquivos = null;

/** Descomprime o pacote uma vez por instância e guarda em memória. */
async function carregarArquivos() {
  if (arquivos) return arquivos;
  const bytes = Uint8Array.from(atob(PACOTE), (c) => c.charCodeAt(0));
  const fluxo = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  arquivos = JSON.parse(await new Response(fluxo).text());
  return arquivos;
}

async function servirArquivo(caminho, pedido) {
  const arq = (await carregarArquivos())[caminho];
  if (!arq) return null;

  const corpo = arq.b ? Uint8Array.from(atob(arq.b), (c) => c.charCodeAt(0)) : arq.c;
  const etag = '"' + (arq.c ? arq.c.length : arq.b.length).toString(36) + '"';
  if (pedido.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(corpo, {
    headers: {
      'Content-Type': arq.t,
      // Sem cache longo: uma atualização precisa aparecer sem ninguém limpar nada.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Bibliotecas que não vieram no pacote são buscadas no CDN uma vez e guardadas
 * no cache da borda. O navegador continua pedindo sempre o mesmo /vendor/...,
 * então o código do painel é idêntico nos dois modos.
 */
async function servirDoCDN(caminho, pedido, ctx) {
  const origem = CDN[caminho];
  if (!origem) return null;

  const chave = new Request(new URL(pedido.url).origin + caminho);
  const guardado = await caches.default.match(chave);
  if (guardado) return guardado;

  const r = await fetch(origem, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
  if (!r.ok) return new Response('Biblioteca indisponível no momento.', { status: 502 });

  const resposta = new Response(r.body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  ctx.waitUntil(caches.default.put(chave, resposta.clone()));
  return resposta;
}

export default {
  // Cron: sincroniza o Bling de madrugada, para o painel abrir com o mês em
  // dia. Só leitura — nada é escrito no Bling.
  async scheduled(evento, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const estado = await blingEstado(env);
        if (!estado.conectado) return;
        await blingSincronizar(env, {});
      } catch (e) {
        console.error('cron bling:', e && e.message);
      }
    })());
  },

  async fetch(pedido, env, ctx) {
    const url = new URL(pedido.url);
    if (ehAPI(url)) return tratarAPI(pedido, env);

    if (pedido.method !== 'GET' && pedido.method !== 'HEAD') {
      return new Response('Método não permitido', { status: 405 });
    }

    const caminho = decodeURIComponent(url.pathname);
    const doCDN = await servirDoCDN(caminho, pedido, ctx);
    if (doCDN) return doCDN;

    const buscar = async (p) =>
      (await servirArquivo(p, pedido)) || (await servirDoRepositorio(p, pedido, env, ctx));

    const resposta =
      (await buscar(caminho)) ||
      (await buscar(caminho.replace(/\/$/, '') + '/index.html')) ||
      // Aplicação de página única: qualquer rota desconhecida abre o painel.
      (await buscar('/index.html'));

    return resposta || new Response('Não encontrado', { status: 404 });
  },
};
