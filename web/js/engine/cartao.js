// Cartão de crédito: classificar os itens de uma fatura e dividir o pagamento.
//
// O pagamento da fatura sai do banco inteiro (às vezes em mais de um débito).
// Cada item da fatura tem um destino — despesa da Móvel5, gasto de um sócio,
// parcela de empréstimo — e o pagamento é desmembrado em uma parte para cada
// destino, de modo que a soma das partes é sempre o que saiu do banco.
import { normalize, round2 } from '../lib/util.js';

export const CATEGORIA_FATURA = 'cartao_fatura';

/**
 * Regras que valem sem ninguém ter ensinado. Só o que não deixa dúvida:
 * imposto e tarifa do próprio cartão, e anúncio, que o Bling já tratava como
 * despesa de marketing da empresa.
 */
export const REGRAS_CARTAO_PADRAO = [
  { id: 'pad:iof',       padrao: 'IOF',       categoria: 'des_iof',       destino_holding: '', origem: 'padrao' },
  { id: 'pad:anuidade',  padrao: 'ANUIDADE',  categoria: 'des_tarifas',   destino_holding: '', origem: 'padrao' },
  { id: 'pad:google',    padrao: 'GOOGLE ADS', categoria: 'des_marketing', destino_holding: '', origem: 'padrao' },
  { id: 'pad:facebk',    padrao: 'FACEBK',    categoria: 'des_marketing', destino_holding: '', origem: 'padrao' },
  { id: 'pad:facebook',  padrao: 'FACEBOOK',  categoria: 'des_marketing', destino_holding: '', origem: 'padrao' },
];

const palavras = (s) => normalize(s).split(' ').filter(Boolean);

// Palavras de uma ou duas letras ("DE", "DL", "S", "A") não distinguem nada e
// atrapalham: "PARCELAMENTO DE FATU" tem que casar com "PARCELAMENTO FATU".
const significativas = (s) => palavras(s).filter((w) => w.length > 2);

/**
 * O padrão casa com a descrição quando suas palavras aparecem em sequência,
 * cada uma como início de uma palavra da descrição. Assim "GOOGLE ADS" casa
 * com "DL *GOOGLE ADS553478 SAO PAULO" (o id gruda na última palavra) e
 * "IOF" não casa com "BIOFIT".
 */
export function casaPadrao(padrao, descricao) {
  const p = significativas(padrao);
  const d = significativas(descricao);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= d.length; i++) {
    if (p.every((w, k) => d[i + k].startsWith(w))) return true;
  }
  return false;
}

const sentidoDe = (item) => (item.valor < 0 ? 'credito' : 'debito');

/** A regra que vale para um item: a do usuário antes da padrão, a mais específica antes. */
export function regraDoItem(item, regras) {
  const candidatas = regras.filter((r) =>
    casaPadrao(r.padrao, item.descricao) &&
    (!r.cartao_final || r.cartao_final === item.cartao_final) &&
    (!r.sentido || r.sentido === sentidoDe(item)));
  if (!candidatas.length) return null;
  const peso = (r) => (r.origem === 'padrao' ? 0 : 1000) + (r.cartao_final ? 100 : 0) +
    (r.sentido ? 50 : 0) + palavras(r.padrao).length * 10 + Math.min(String(r.padrao).length, 9);
  return candidatas.sort((a, b) => peso(b) - peso(a))[0];
}

/**
 * Aplica as regras aos itens da fatura. O que o usuário escolheu à mão
 * ('usuario') nunca é tocado; o que veio de regra é refeito, de modo que
 * apagar ou mudar uma regra também muda os itens que dependiam dela.
 */
export function classificarFatura(fatura, regrasUsuario = []) {
  const regras = [...regrasUsuario.map((r) => ({ ...r, origem: 'usuario' })), ...REGRAS_CARTAO_PADRAO];
  const itens = fatura.itens.map((item) => {
    if (item.neutro || item.origem_classificacao === 'usuario') return item;
    const r = regraDoItem(item, regras);
    if (!r) return { ...item, categoria: '', destino_holding: '', origem_classificacao: '', regra_id: '' };
    return {
      ...item,
      categoria: r.categoria,
      destino_holding: r.destino_holding || '',
      origem_classificacao: r.origem === 'padrao' ? 'padrao' : 'regra',
      regra_id: r.id,
    };
  });
  return { ...fatura, itens };
}

/**
 * Agrupa os itens por destino (categoria + destino da holding).
 *
 * Cada grupo vira uma parte do pagamento, e partes têm que ser positivas: um
 * crédito (pagamento extra, estorno) precisa estar no mesmo grupo de gastos
 * que ele abate, senão o grupo fica negativo e o painel avisa.
 */
export function agruparFatura(fatura, { ehHolding = () => false } = {}) {
  const uteis = fatura.itens.filter((i) => !i.neutro);
  const neutros = fatura.itens.filter((i) => i.neutro);
  const pendentes = uteis.filter((i) => !i.categoria || (ehHolding(i.categoria) && !i.destino_holding));

  const mapa = new Map();
  for (const i of uteis.filter((x) => !pendentes.includes(x))) {
    const k = `${i.categoria}|${i.destino_holding || ''}`;
    if (!mapa.has(k)) mapa.set(k, { categoria: i.categoria, destino: i.destino_holding || '', total: 0, itens: [] });
    const g = mapa.get(k);
    g.total = round2(g.total + i.valor);
    g.itens.push(i);
  }
  const todos = [...mapa.values()].sort((a, b) => b.total - a.total);
  // Um grupo que soma zero (a anuidade e o desconto dela) não tem o que
  // pagar: some. Negativo é erro — um crédito sobrou sem gasto para abater.
  const negativos = todos.filter((g) => g.total < -0.005);
  const grupos = todos.filter((g) => g.total > 0.005);
  const zerados = todos.filter((g) => Math.abs(g.total) <= 0.005);
  const total = round2(grupos.reduce((a, g) => a + g.total, 0));
  return { grupos, pendentes, neutros, negativos, zerados, total };
}

/**
 * Procura, entre as saídas ao redor do vencimento, as que somam o total da
 * fatura. O banco às vezes divide o pagamento em dois débitos (foi o caso de
 * janeiro: 5.915,83 e 764,33 no mesmo dia), então não basta um valor só.
 */
export function sugerirPagamentos(fatura, lancamentos, { antes = 3, depois = 12 } = {}) {
  const alvo = Math.round(fatura.total * 100);
  const venc = new Date(`${fatura.vencimento}T12:00:00Z`).getTime();
  const dias = (l) => Math.abs((new Date(`${l.data}T12:00:00Z`).getTime() - venc) / 864e5);
  const pareceCartao = (l) => /CART|CC SICOOB|FATURA|MASTERCARD|VISA/i.test(
    normalize(`${l.descricao} ${l.contraparte || ''}`));

  const janela = lancamentos.filter((l) => {
    if (l.valor >= 0 || l.transfer_id || l.fatura_cartao) return false;
    const d = (new Date(`${l.data}T12:00:00Z`).getTime() - venc) / 864e5;
    return d >= -antes && d <= depois && Math.round(-l.valor * 100) <= alvo;
  });
  const candidatas = janela
    .sort((a, b) => (pareceCartao(b) - pareceCartao(a)) || (dias(a) - dias(b)))
    .slice(0, 60)
    .sort((a, b) => a.valor - b.valor);                       // maiores saídas primeiro

  const cents = candidatas.map((l) => Math.round(-l.valor * 100));
  let melhor = null;
  const busca = (inicio, falta, escolhidos) => {
    if (falta === 0 && escolhidos.length) {
      const custo = escolhidos.length * 1000 + escolhidos.reduce((a, k) => a + dias(candidatas[k]) -
        (pareceCartao(candidatas[k]) ? 500 : 0), 0);
      if (!melhor || custo < melhor.custo) melhor = { custo, ks: [...escolhidos] };
      return;
    }
    if (falta <= 0 || escolhidos.length >= 4) return;
    for (let k = inicio; k < candidatas.length; k++) busca(k + 1, falta - cents[k], [...escolhidos, k]);
  };
  busca(0, alvo, []);

  return {
    exato: melhor ? melhor.ks.map((k) => candidatas[k]) : null,
    candidatas: janela.sort((a, b) => dias(a) - dias(b)),
  };
}

/**
 * Desmembra os pagamentos nas partes da fatura.
 *
 * Os lançamentos originais saem; entram as partes, uma por destino. A chave
 * de duplicidade de cada original passa para uma parte (ou fica guardada em
 * `dedupes_extras`), para que reimportar o extrato do banco não traga o
 * débito de volta.
 */
export function montarPartes(fatura, pagamentos, agrupado, { uid, nomeCategoria }) {
  const base = [...pagamentos].sort((a, b) => a.data.localeCompare(b.data))[0];
  const pago = round2(pagamentos.reduce((a, l) => a + Math.abs(l.valor), 0));
  const originais = pagamentos.map((l) => ({ ...l }));
  const dedupes = pagamentos.map((l) => l.dedupe).filter(Boolean);
  const n = agrupado.grupos.length;

  const novos = agrupado.grupos.map((g, i) => ({
    ...base,
    id: uid(),
    descricao: `Fatura do cartão ${fatura.instituicao} (${fatura.mes_nome.toLowerCase()}/${fatura.vencimento.slice(0, 4)}) — ` +
      `${nomeCategoria(g.categoria)}${g.destino ? ` · ${g.destino}` : ''}`,
    contraparte: `Cartão ${fatura.instituicao} final ${String(fatura.cartao_conta).slice(-4)}`,
    valor: round2(-g.total),
    tipo: 'D',
    categoria: g.categoria,
    destino_holding: g.destino,
    confianca: 'alta',
    conciliado: 1,
    travado: 1,
    possivel_transferencia: 0,
    regra_aplicada: 'fatura de cartão',
    fatura_cartao: fatura.id,
    fatura_parte: i + 1,
    fatura_partes: n,
    fatura_originais: i === 0 ? originais : undefined,
    dedupe: dedupes[i] || `${dedupes[0] || 'fat'}#f${i}`,
    dedupes_extras: i === 0 && dedupes.length > n ? dedupes.slice(n) : undefined,
  }));
  return { novos, remover: pagamentos.map((l) => l.id), pago };
}

/** Desfaz: tira as partes e devolve os pagamentos originais. */
export function desfazerFatura(fatura, lancamentos) {
  const partes = lancamentos.filter((l) => l.fatura_cartao === fatura.id);
  const originais = partes.map((p) => p.fatura_originais).find(Boolean) || [];
  return { restaurar: originais, remover: partes.map((p) => p.id) };
}

/** Palavra(s) que identificam o estabelecimento, para sugerir uma regra. */
const GENERICAS = new Set(['PARCELAMENTO', 'PAGAMENTO', 'DESC', 'DEB', 'CRED', 'COMPRA',
  'VINDI', 'PAYPAL', 'MERCADOPAGO', 'PAGSEGURO', 'EBANX', 'HOTMART']);
export function sugerirPadrao(item) {
  const toks = palavras(item.descricao)
    .map((w) => w.replace(/\d.*$/, ''))                      // "ADS553478" -> "ADS"
    .filter((w) => w.length > 2 && w !== 'BRASILIA');
  if (!toks.length) return normalize(item.descricao);
  return GENERICAS.has(toks[0]) && toks[1] ? `${toks[0]} ${toks[1]}` : toks[0];
}
