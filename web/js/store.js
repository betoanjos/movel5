// Estado da aplicação: carrega tudo na memória, grava através do back-end
// escolhido (local ou nuvem) e avisa a interface quando algo muda.
import { backendLocal, COLECOES } from './db/local.js';
import { criarBackendAPI } from './db/api.js';
import { CATEGORIAS, CATEGORIA_POR_ID, CONTAS_PADRAO, DESTINOS_HOLDING_PADRAO } from './engine/seed.js';
import { uid, competenciaOf } from './lib/util.js';

const CHAVE_MODO = 'movel5:modo';

export const estado = {
  modo: 'local',            // 'local' | 'nuvem'
  usuario: null,
  pronto: false,
  contas: [],
  lancamentos: [],
  categorias: [],           // categorias personalizadas do usuário
  regras: [],
  fechamentos: [],
  vendas: [],
  compras: [],
  contasPagar: [],
  contasReceber: [],
  movimentos: [],         // caixas e bancos do Bling (só consulta)
  contrapartes: [],
  enriquecimentos: [],
  diasVenda: [],
  importacoes: [],
  config: {},
  competencia: null,        // mês em foco
};

let backend = backendLocal;
const ouvintes = new Set();

export const aoMudar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
export const notificar = (o = {}) => { for (const fn of ouvintes) fn(o); };

export const getBackend = () => backend;
export const modoNuvem = () => estado.modo === 'nuvem';

/** Todas as categorias (padrão + personalizadas), indexadas. */
export function categorias() {
  return [...CATEGORIAS, ...estado.categorias];
}
export function categoriaPorId(id) {
  return CATEGORIA_POR_ID[id] || estado.categorias.find((c) => c.id === id) || null;
}
export const nomeCategoria = (id) => categoriaPorId(id)?.nome || (id ? 'Categoria removida' : 'Sem categoria');

/** A categoria é da conta corrente com a holding? */
export const ehHolding = (id) => categoriaPorId(id)?.natureza === 'holding';

/**
 * Destinos da holding (AN5, Roberto, Chácara…). Ficam em `config` para não
 * precisar de tabela nova — são uma lista curta que só ele edita.
 */
export function destinosHolding() {
  const lista = estado.config.holding_destinos;
  return Array.isArray(lista) && lista.length ? lista : [...DESTINOS_HOLDING_PADRAO];
}
export const salvarDestinosHolding = (lista) =>
  definirConfig('holding_destinos', lista.map((d) => String(d).trim()).filter(Boolean));

export const contaPorId = (id) => estado.contas.find((c) => c.id === id) || null;
export const nomeConta = (id) => contaPorId(id)?.nome || 'Conta removida';

// Mesmas regras usadas na apuração: gateway e marketplace são contas de
// passagem — a venda só vira receita quando o dinheiro chega no banco.
const bancoOuCaixa = (c) => c?.tipo === 'banco' || c?.tipo === 'caixa';
export function reconheceReceita(contaId) {
  const c = contaPorId(contaId);
  return c ? (c.reconhece_receita ?? bancoOuCaixa(c)) : true;
}
export function entraNoCaixa(contaId) {
  const c = contaPorId(contaId);
  return c ? (c.entra_no_caixa ?? bancoOuCaixa(c)) : true;
}

// ------------------------------------------------------------- inicialização

/**
 * Descobre se há uma API disponível (Cloudflare) e se o usuário está logado.
 * Sem API, cai no modo local sem pedir login.
 */
export async function iniciar() {
  const preferido = localStorage.getItem(CHAVE_MODO);
  const api = criarBackendAPI();

  if (preferido !== 'local') {
    try {
      // `/api/situacao` responde mesmo sem sessão: diz se existe API e se o
      // painel já teve os usuários criados.
      const situacao = await api.pedir('/situacao');
      backend = api;
      estado.modo = 'nuvem';
      if (!situacao.configurado) return { precisaConfigurar: true };
      try {
        const s = await api.quemSou();
        if (s?.usuario) {
          estado.usuario = s.usuario;
          await carregarTudo();
          return { precisaLogin: false };
        }
      } catch (e) { if (!e.naoAutorizado) throw e; }
      return { precisaLogin: true };
    } catch {
      // Sem API respondendo: o painel roda em modo local.
    }
  }

  backend = backendLocal;
  estado.modo = 'local';
  await carregarTudo();
  return { precisaLogin: false };
}

export async function entrar(usuario, senha) {
  const api = criarBackendAPI();
  const r = await api.entrar(usuario, senha);
  backend = api;
  estado.modo = 'nuvem';
  estado.usuario = r.usuario;
  localStorage.removeItem(CHAVE_MODO);
  await carregarTudo();
  return r;
}

export async function sair() {
  if (modoNuvem()) { try { await backend.sair(); } catch {} }
  estado.usuario = null;
  location.reload();
}

export async function usarModoLocal() {
  localStorage.setItem(CHAVE_MODO, 'local');
  location.reload();
}

/** Primeiro acesso: cria os usuários e já entra com o primeiro deles. */
export async function configurarPrimeiroAcesso(usuarios) {
  const api = criarBackendAPI();
  await api.pedir('/setup', { method: 'POST', body: { usuarios } });
  return entrar(usuarios[0].usuario, usuarios[0].senha);
}

export async function usarModoNuvem() {
  localStorage.removeItem(CHAVE_MODO);
  location.reload();
}

async function carregarTudo() {
  const nomes = ['contas', 'lancamentos', 'categorias', 'regras', 'fechamentos',
    'vendas', 'compras', 'contasPagar', 'contasReceber', 'movimentos', 'contrapartes',
    'enriquecimentos', 'diasVenda', 'importacoes', 'config'];

  const partes = await Promise.all(nomes.map((n) => backend.listar(n).catch(() => [])));
  nomes.forEach((n, i) => {
    if (n === 'config') {
      estado.config = Object.fromEntries((partes[i] || []).map((r) => [r.id, r.valor]));
    } else {
      estado[n] = partes[i] || [];
    }
  });

  if (!estado.contas.length) await semearContas();

  // Mês em foco: o último com movimento, senão o mês corrente.
  const comps = [...new Set(estado.lancamentos.map((l) => l.competencia))].filter(Boolean).sort();
  estado.competencia = estado.config.competencia_foco || comps[comps.length - 1] ||
    competenciaOf(new Date().toISOString());

  estado.pronto = true;
  notificar({ tudo: true });
}

/**
 * Recarrega coleções que foram gravadas fora do navegador — é o caso do que
 * a sincronização com o Bling traz: quem escreveu foi o servidor, então a
 * memória daqui está desatualizada até alguém buscar de novo.
 */
export async function recarregarColecoes(nomes) {
  for (const n of nomes) {
    try { estado[n] = await backend.listar(n); } catch {}
  }
  notificar({ tudo: true });
}

async function semearContas() {
  estado.contas = CONTAS_PADRAO.map((c, i) => ({ ...c, id: uid(), ordem: i }));
  await backend.gravar('contas', estado.contas);
}

// ------------------------------------------------------------------ escrita

/** Grava registros numa coleção e sincroniza o estado em memória. */
export async function salvar(colecao, registros) {
  const lista = Array.isArray(registros) ? registros : [registros];
  if (!lista.length) return;
  for (const r of lista) if (!r.id) r.id = uid();

  await backend.gravar(colecao, lista);

  const atual = estado[colecao] || [];
  const porId = new Map(atual.map((r) => [r.id, r]));
  for (const r of lista) porId.set(r.id, r);
  estado[colecao] = [...porId.values()];
  notificar({ colecao });
}

export async function remover(colecao, ids) {
  const lista = Array.isArray(ids) ? ids : [ids];
  if (!lista.length) return;
  await backend.remover(colecao, lista);
  const fora = new Set(lista);
  estado[colecao] = (estado[colecao] || []).filter((r) => !fora.has(r.id));
  notificar({ colecao });
}

export async function definirConfig(chave, valor) {
  estado.config[chave] = valor;
  await backend.gravar('config', [{ id: chave, valor }]);
  notificar({ config: chave });
}

/**
 * Troca o mês em foco. Avisa a interface na hora e só depois grava qual mês
 * ficou escolhido — esperar a gravação deixava a tela parada olhando para o
 * mês antigo, como se tivesse travado.
 */
export function definirCompetencia(comp) {
  estado.competencia = comp;
  notificar({ competencia: comp });
  return definirConfig('competencia_foco', comp).catch(() => {});
}

/** Apaga todos os dados (pede confirmação na interface). */
export async function apagarTudo() {
  await backend.apagarTudo();
  for (const c of COLECOES) estado[c] = [];
  estado.config = {};
  await semearContas();
  notificar({ tudo: true });
}

// -------------------------------------------------------------- utilitários

/** Lançamentos de uma competência, opcionalmente filtrados por conta. */
export function lancamentosDe(competencia, contaId = null) {
  return estado.lancamentos.filter(
    (l) => l.competencia === competencia && (!contaId || l.conta_id === contaId)
  );
}

/** Competências que têm movimento, da mais nova para a mais antiga. */
export function competenciasDisponiveis() {
  const set = new Set(estado.lancamentos.map((l) => l.competencia).filter(Boolean));
  set.add(estado.competencia);
  for (const f of estado.fechamentos) if (f.competencia) set.add(f.competencia);
  return [...set].filter(Boolean).sort().reverse();
}

/** Snapshot completo para backup em JSON. */
export function exportarTudo() {
  return {
    versao: 1,
    geradoEm: new Date().toISOString(),
    contas: estado.contas,
    lancamentos: estado.lancamentos,
    categorias: estado.categorias,
    regras: estado.regras,
    fechamentos: estado.fechamentos,
    vendas: estado.vendas,
    compras: estado.compras,
    contasPagar: estado.contasPagar,
    contasReceber: estado.contasReceber,
    movimentos: estado.movimentos,
    contrapartes: estado.contrapartes,
    enriquecimentos: estado.enriquecimentos,
    diasVenda: estado.diasVenda,
    config: estado.config,
  };
}

/** Restaura um backup, substituindo tudo. */
export async function importarBackup(dados) {
  if (!dados || dados.versao !== 1) throw new Error('Arquivo de backup não reconhecido.');
  await backend.apagarTudo();
  for (const c of ['contas', 'lancamentos', 'categorias', 'regras', 'fechamentos',
    'vendas', 'compras', 'contasPagar', 'contasReceber', 'movimentos', 'contrapartes',
    'enriquecimentos', 'diasVenda']) {
    const lista = dados[c] || [];
    estado[c] = lista;
    if (lista.length) await backend.gravar(c, lista);
  }
  estado.config = dados.config || {};
  await backend.gravar('config', Object.entries(estado.config).map(([id, valor]) => ({ id, valor })));
  notificar({ tudo: true });
}
