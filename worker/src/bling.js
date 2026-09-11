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

export async function blingEstado(env) {
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

export async function blingSalvarCredenciais(env, { client_id, client_secret }) {
  if (!client_id || !client_secret) throw new Error('Informe client_id e client_secret.');
  await gravarAjuste(env, 'bling_credenciais', {
    client_id: String(client_id).trim(),
    client_secret: String(client_secret).trim(),
  });
  return { ok: true };
}

export async function blingDesconectar(env) {
  await apagarAjuste(env, 'bling_tokens');
  await apagarAjuste(env, 'bling_oauth_estado');
  return { ok: true };
}

export async function blingUrlAutorizacao(env) {
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

export async function blingTrocarCodigo(env, code, estadoRecebido) {
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
export async function blingDescobrir(env) {
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
export async function blingSincronizar(env, { desde = null, dias = 180 } = {}) {
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
