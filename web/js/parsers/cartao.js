// Fatura de cartão de crédito.
//
// A fatura é a peça que falta para saber para onde foi o dinheiro de um
// pagamento de cartão: o extrato do banco mostra um débito só ("CC SICOOB
// R$ 6.680,16"), e é a fatura que diz que ali dentro há anúncio da Móvel5,
// parcela de empréstimo, IOF.
//
// O que sai daqui não é lançamento: o pagamento já está no extrato. É uma
// fatura com seus itens, que a tela de Cartões classifica e depois usa para
// desmembrar o pagamento.
import { parseMoney, toISODate, normalize, round2 } from '../lib/util.js';

/** Que tipo de fatura é, ou null. */
export function detectaFaturaCartao(linhas) {
  const cab = linhas.slice(0, 25).join(' ').toUpperCase();
  if (/EXTRATO DE FATURA DE CART(Ã|A)O/.test(cab)) return 'sicoob';
  return null;
}

/** OFX de cartão de crédito — que não pode ser lido como extrato de conta. */
export const ehOFXdeCartao = (texto) => /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(texto);

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO',
  'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

const RE_ITEM = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?[\d.]+,\d{2})\s*$/;
const RE_SECAO = /^GASTOS DE\s+(.+?)\s*\((\d{4})\)\s*$/i;
const RE_TOTAL_SECAO = /^TOTAL\s+([\d.]+,\d{2})\s*$/i;

const colapsa = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function tipoDoItem(descricao, valor) {
  const n = normalize(descricao);
  if (valor < 0) return 'credito';
  if (/\bIOF\b|ANUIDADE|\bJUROS\b|\bMULTA\b|\bMORA\b|ENCARGO/.test(n)) return 'encargo';
  if (/PARCELAMENTO DE (FATU|ROTA)|PARC(ELAMENTO)? (FATURA|ROTATIVO)/.test(n)) return 'financiamento';
  return 'compra';
}

/**
 * Procura, entre os créditos, os que quitam exatamente o saldo anterior.
 *
 * Saldo anterior de 8.729,40 e um crédito de -8.729,40 se anulam: é a fatura
 * passada sendo paga (ou parcelada), e o que ela custou já foi tratado
 * quando foi paga. Fica de fora da divisão. O que sobrar de crédito é
 * pagamento extra, e esse o usuário decide.
 */
function quitacaoDoSaldoAnterior(itens, saldoAnterior) {
  const alvo = Math.round(saldoAnterior * 100);
  if (!alvo) return [];
  const creditos = itens.filter((i) => i.valor < 0);
  const cents = creditos.map((i) => Math.round(-i.valor * 100));

  let achado = null;
  const busca = (inicio, falta, escolhidos) => {
    if (achado) return;
    if (falta === 0 && escolhidos.length) { achado = [...escolhidos]; return; }
    if (falta < 0 || escolhidos.length >= 3) return;
    for (let k = inicio; k < creditos.length; k++) busca(k + 1, falta - cents[k], [...escolhidos, k]);
  };
  busca(0, alvo, []);
  return achado ? achado.map((k) => creditos[k]) : [];
}

/** Fatura do Sicoob (PDF, "Extrato de fatura de cartão de crédito"). */
export function parseFaturaSicoob(linhas) {
  const L = linhas.map((l) => colapsa(l)).filter(Boolean);
  const texto = L.join('\n');

  const contaCartao = (texto.match(/Conta Cart[ãa]o:\s*(\d+)/i) || [])[1] || '';
  const mVenc = texto.match(/Fatura de\s+([A-ZÇÃ]+)\s+Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const vencimento = mVenc ? toISODate(mVenc[2]) : null;
  if (!contaCartao || !vencimento) {
    return { erro: 'Não consegui ler o número do cartão ou o vencimento desta fatura.', fatura: null };
  }

  // O titular é a linha logo depois do título do relatório.
  const iTitulo = L.findIndex((l) => /EXTRATO DE FATURA DE CART/i.test(l));
  const titular = iTitulo >= 0 ? L[iTitulo + 1] : '';

  const [anoV, mesV] = [Number(vencimento.slice(0, 4)), Number(vencimento.slice(5, 7))];
  const dataDoItem = (dm) => {
    const [d, m] = dm.split('/').map(Number);
    // Gasto de dezembro numa fatura que vence em janeiro é do ano anterior.
    return `${m > mesV ? anoV - 1 : anoV}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const faturaId = `sicoob:${contaCartao}:${vencimento}`;
  const mSaldo = texto.match(/(?:^|\n)-?\s*SALDO ANTERIOR\s+(-?[\d.]+,\d{2})\s*(?:\n|$)/i);
  const saldoAnterior = mSaldo ? parseMoney(mSaldo[1]) : 0;

  const itens = [];
  const secoes = [];
  let portador = '';
  let final = '';
  let secao = null;

  for (const linha of L) {
    if (/ENCARGOS FINANCEIROS/i.test(linha)) break;

    const mSec = linha.match(RE_SECAO);
    if (mSec) {
      portador = colapsa(mSec[1]);
      final = mSec[2];
      secao = { portador, final, total: null, soma: 0 };
      secoes.push(secao);
      continue;
    }
    const mTot = linha.match(RE_TOTAL_SECAO);
    if (mTot && secao) { secao.total = parseMoney(mTot[1]); secao = null; continue; }

    const m = linha.match(RE_ITEM);
    if (!m) continue;

    const valor = parseMoney(m[3]);
    const descricao = colapsa(m[2]);
    const parcela = (descricao.match(/(?:^|\s)(\d{2}\/\d{2})(?=\s|$)/) || [])[1] || '';
    const finalNoTexto = (descricao.match(/\((\d{4})\)/) || [])[1] || '';

    const item = {
      id: `${faturaId}#${itens.length}`,
      data: dataDoItem(m[1]),
      descricao,
      parcela,
      valor,
      portador: secao ? portador : '',
      cartao_final: secao ? final : finalNoTexto,
      tipo: tipoDoItem(descricao, valor),
      neutro: '',
      categoria: '',
      destino_holding: '',
      origem_classificacao: '',
    };
    itens.push(item);
    if (secao) secao.soma = round2(secao.soma + valor);
  }

  if (!itens.length) return { erro: 'Esta fatura não trouxe nenhum item.', fatura: null };

  for (const q of quitacaoDoSaldoAnterior(itens, saldoAnterior)) q.neutro = 'quitacao_saldo_anterior';

  const pega = (re) => {
    const m = texto.match(re);
    return m ? parseMoney(m[1]) : null;
  };
  const total = pega(/Total da fatura\s+([\d.]+,\d{2})/i);
  const somaItens = round2(itens.reduce((a, i) => a + i.valor, 0));

  const nomeMes = normalize(mVenc[1]);
  const idxMes = MESES.indexOf(nomeMes);

  const fatura = {
    id: faturaId,
    instituicao: 'Sicoob',
    cartao_conta: contaCartao,
    titular: colapsa(titular),
    competencia: vencimento.slice(0, 7),
    mes_nome: idxMes >= 0 ? MESES[idxMes] : nomeMes,
    vencimento,
    total,
    minimo: pega(/Pagamento m[ií]nimo\s+([\d.]+,\d{2})/i),
    saldo_anterior: saldoAnterior,
    debitos: pega(/D[ée]bitos R\$\s*([\d.]+,\d{2})/i),
    encargos: pega(/Encargos R\$\s*([\d.]+,\d{2})/i),
    pagamentos: pega(/Pagamento R\$\s*([\d.]+,\d{2})/i),
    limite: pega(/Limite de cr[ée]dito R\$\s*([\d.]+,\d{2})/i),
    itens,
    // A conta fecha: saldo anterior mais todos os itens (créditos negativos)
    // é o total da fatura, e cada seção bate com o seu "TOTAL".
    confere: total != null && Math.abs(round2(saldoAnterior + somaItens) - total) < 0.005 &&
      secoes.every((s) => s.total == null || Math.abs(s.total - s.soma) < 0.005),
    pagamento_ids: [],
    situacao: 'importada',
  };
  return { erro: null, fatura };
}
