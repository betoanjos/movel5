// Leitores das contas digitais: Vindi/Yapay, Mercado Pago e marketplaces.
import { parseMoney, toISODate, normalize, round2 } from '../lib/util.js';
import { comCabecalho, campo } from './planilha.js';

/**
 * Classifica uma linha de conta de gateway em venda, movimento interno ou
 * saída para o banco. É a peça que impede a contagem dobrada: a liquidação
 * dentro do gateway não é uma venda nova, é a mesma venda mudando de lugar.
 *
 * @returns {{tipo:'venda'|'interno'|'saida', sugestao:string|null,
 *            possivelTransferencia:0|1, rotulo:string|null}}
 */
export function classificarMovimentoGateway(descricao, valor, origem = '') {
  const d = String(descricao || '');
  const o = String(origem || '');
  const saida = valor < 0;

  if (saida) {
    // Só saque e transferência saem do gateway para o banco. O débito de
    // "liquidação" é dinheiro andando dentro do próprio gateway (do
    // intermediador para a conta digital) e nunca aparece no extrato do
    // banco — tratá-lo como possível transferência enchia a tela de revisão
    // de linhas que nunca teriam par.
    if (/saque|transfer/i.test(d)) {
      return {
        tipo: 'saida', sugestao: null, possivelTransferencia: 1,
        rotulo: /saque/i.test(d) ? 'Saque para conta bancária' : 'Transferência para conta bancária',
      };
    }
    if (/liquida[çc]/i.test(d)) {
      return {
        tipo: 'interno', sugestao: 'trf_interna', possivelTransferencia: 0,
        rotulo: 'Liquidação dentro do gateway (não sai para o banco)',
      };
    }
    return { tipo: 'saida', sugestao: null, possivelTransferencia: 1, rotulo: null };
  }
  // Crédito de liquidação: o dinheiro já foi contado quando a parcela entrou.
  if (/liquida[çc]/i.test(d) || /^cr[ée]dito referente [àa] liquida/i.test(d)) {
    return {
      tipo: 'interno', sugestao: 'trf_interna', possivelTransferencia: 0,
      rotulo: 'Liquidação dentro do gateway (não é venda nova)',
    };
  }
  if (/recebimento|venda|pagamento do pedido/i.test(d) || /intermediador/i.test(o)) {
    return { tipo: 'venda', sugestao: 'rec_vendas', possivelTransferencia: 0, rotulo: null };
  }
  // Crédito que não sabemos classificar: entra sem categoria, para revisão.
  return { tipo: 'venda', sugestao: null, possivelTransferencia: 0, rotulo: null };
}

/**
 * Extrato de pagamentos da Vindi/Yapay (PaymentExtract.xlsx).
 * Colunas: Data, ID Transação, N. Pedido, Descrição, Forma de Pagamento,
 *          Parcelas, Origem, Valor Liq., Valor Bruto, Taxa Retenção, Taxa Antecipação
 *
 * `Origem = Intermediador`  -> parcela de venda liberada (entrada na conta Vindi)
 * `Origem = Vindi Pagamentos` -> saque/liquidação para o banco (saída da conta Vindi)
 */
export function parseVindiPaymentExtract(matriz) {
  const { registros } = comCabecalho(matriz, ['data', 'id_transacao', 'valor_liq']);
  const lancamentos = [];

  for (const r of registros) {
    const data = toISODate(campo(r, 'data'));
    if (!data) continue;
    const liquido = parseMoney(campo(r, 'valor_liq'));
    if (!liquido) continue;

    const bruto = parseMoney(campo(r, 'valor_bruto')) || liquido;
    const taxaRet = Math.abs(parseMoney(campo(r, 'taxa_retencao')));
    const taxaAnt = Math.abs(parseMoney(campo(r, 'taxa_antecipacao')));
    const origem = String(campo(r, 'origem'));
    const descricao = String(campo(r, 'descricao') || '').trim();
    const pedido = String(campo(r, 'n_pedido', 'pedido') || '').trim();
    const forma = String(campo(r, 'forma_de_pagamento', 'forma') || '').trim();
    const parcelas = String(campo(r, 'parcelas') || '').trim();
    const idTx = String(campo(r, 'id_transacao') || '').trim();

    // O texto da coluna Descrição distingue os três tipos de movimento, e a
    // distinção é o que evita contar a mesma venda duas vezes:
    //   "Crédito referente ao recebimento"  -> a venda entrando (receita)
    //   "Crédito referente à liquidação"    -> dinheiro andando dentro do
    //                                          próprio gateway (não é venda nova)
    //   "Débito referente ao saque/transf." -> saindo para o banco (transferência)
    const m = classificarMovimentoGateway(descricao, liquido, origem);

    lancamentos.push({
      data,
      descricao: m.rotulo || `Venda recebida${pedido ? ` — pedido ${pedido}` : ''}${forma ? ` (${forma}${parcelas && parcelas !== '-' ? ' ' + parcelas : ''})` : ''}`,
      contraparte: m.tipo === 'venda' ? (forma || 'Cliente') : 'Vindi Pagamentos',
      documento: pedido,
      valor: liquido,
      valor_bruto: m.tipo === 'venda' ? bruto : liquido,
      taxa: m.tipo === 'venda' ? Math.round((taxaRet + taxaAnt) * 100) / 100 : 0,
      tipo: liquido < 0 ? 'D' : 'C',
      ref: `vindi:${idTx}:${parcelas}:${liquido.toFixed(2)}`,
      origem: 'vindi',
      sugestao: m.sugestao,
      possivel_transferencia: m.possivelTransferencia,
      movimento_interno: m.tipo === 'interno' ? 1 : 0,
      meta: { origemColuna: origem, forma, parcelas, pedido, tipoMovimento: m.tipo },
    });
  }
  return { lancamentos };
}

/** Conta digital Vindi (Data, ID Transação, N. Pedido, Descrição, Valor). */
export function parseVindiContaDigital(matriz) {
  const { registros } = comCabecalho(matriz, ['data', 'id_transacao', 'valor']);
  const lancamentos = [];
  for (const r of registros) {
    const data = toISODate(campo(r, 'data'));
    const valor = parseMoney(campo(r, 'valor'));
    if (!data || !valor) continue;
    const descricao = String(campo(r, 'descricao') || '').trim();
    const m = classificarMovimentoGateway(descricao, valor, 'conta digital');
    lancamentos.push({
      data,
      descricao: m.rotulo || descricao || 'Movimentação conta digital',
      contraparte: 'Vindi Pagamentos',
      documento: String(campo(r, 'n_pedido') || ''),
      valor,
      tipo: valor < 0 ? 'D' : 'C',
      ref: `vindi-cd:${campo(r, 'id_transacao')}:${valor.toFixed(2)}`,
      origem: 'vindi',
      sugestao: m.sugestao,
      possivel_transferencia: m.possivelTransferencia,
      movimento_interno: m.tipo === 'interno' ? 1 : 0,
      meta: { tipoMovimento: m.tipo },
    });
  }
  return { lancamentos };
}

/**
 * Mercado Pago — aceita os dois formatos de relatório mais comuns
 * (liberações/settlement em inglês e o relatório de atividades em português).
 */
export function parseMercadoPago(matriz) {
  const { registros } = comCabecalho(matriz, ['date', 'data', 'source_id', 'transaction_amount', 'valor']);
  const lancamentos = [];

  for (const r of registros) {
    const data = toISODate(campo(r, 'date_created', 'settlement_date', 'money_release_date', 'data_de_libera', 'data'));
    if (!data) continue;

    let valor = parseMoney(campo(r, 'net_credit_amount')) - Math.abs(parseMoney(campo(r, 'net_debit_amount')));
    if (!valor) valor = parseMoney(campo(r, 'valor_liquido', 'net_received_amount', 'transaction_amount', 'valor'));
    if (!valor) continue;

    const bruto = parseMoney(campo(r, 'gross_amount', 'transaction_amount', 'valor_bruto')) || valor;
    const taxa = Math.abs(parseMoney(campo(r, 'mp_fee_amount', 'fee_amount', 'taxa', 'tarifa')));
    const tipoMov = String(campo(r, 'transaction_type', 'description', 'descricao', 'tipo') || '');
    const id = String(campo(r, 'source_id', 'operation_id', 'id') || '');
    const m = classificarMovimentoGateway(tipoMov, valor, 'mercadopago');
    const ehSaque = m.tipo === 'saida';

    lancamentos.push({
      data,
      descricao: m.rotulo || (tipoMov || 'Movimentação Mercado Pago'),
      contraparte: String(campo(r, 'payer_name', 'nome_do_pagador', 'contraparte') || (ehSaque ? 'Mercado Pago' : 'Cliente')),
      documento: String(campo(r, 'external_reference', 'order_id', 'n_pedido') || ''),
      valor,
      valor_bruto: bruto,
      taxa,
      tipo: valor < 0 ? 'D' : 'C',
      ref: `mp:${id}:${valor.toFixed(2)}`,
      origem: 'mercadopago',
      sugestao: m.sugestao,
      possivel_transferencia: m.possivelTransferencia,
      movimento_interno: m.tipo === 'interno' ? 1 : 0,
      meta: { tipoMov, tipoMovimento: m.tipo },
    });
  }
  return { lancamentos };
}

/**
 * Extrato da conta do Mercado Pago ("account_statement….xlsx").
 *
 * Formato: um bloco de resumo (saldo inicial, créditos, débitos, saldo final)
 * e, abaixo, uma linha por movimento — RELEASE_DATE, TRANSACTION_TYPE,
 * REFERENCE_ID, TRANSACTION_NET_AMOUNT, PARTIAL_BALANCE.
 *
 * Os tipos que aparecem na prática:
 *   Liberação de dinheiro  venda liberada (entra na conta do Mercado Pago)
 *   Rendimentos            juros do saldo parado lá dentro
 *   Pix enviado …          o dinheiro indo para o banco
 *
 * Como a conta do Mercado Pago é de passagem, a saída para o banco é
 * transferência e a receita continua sendo contada quando o dinheiro chega no
 * Sicoob — que é o número que dá para conferir no extrato.
 */
export function parseMercadoPagoExtrato(matriz) {
  const { registros } = comCabecalho(matriz, ['release_date', 'transaction_net_amount']);
  const lancamentos = [];

  for (const r of registros) {
    const data = toISODate(campo(r, 'release_date'));
    const valor = parseMoney(campo(r, 'transaction_net_amount'));
    if (!data || !valor) continue;

    const tipo = String(campo(r, 'transaction_type') || '').trim();
    const id = String(campo(r, 'reference_id') || '').trim();
    const t = normalize(tipo);

    let sugestao = null;
    let interno = 0;
    let rotulo = tipo || 'Movimentação Mercado Pago';
    let contraparte = 'Mercado Pago';

    if (/LIBERACAO DE DINHEIRO|LIBERACAO|PAGAMENTO RECEBIDO|VENDA/.test(t) && valor > 0) {
      sugestao = 'rec_vendas';
      rotulo = 'Venda liberada no Mercado Pago';
      contraparte = 'Cliente';
    } else if (/RENDIMENTO/.test(t)) {
      sugestao = 'rec_juros';
      rotulo = 'Rendimento do saldo no Mercado Pago';
    } else if (valor < 0 && /PIX ENVIADO|TRANSFER|SAQUE|RETIRADA|WITHDRAW/.test(t)) {
      sugestao = 'trf_interna';
      interno = 1;
      rotulo = tipo || 'Saída do Mercado Pago para o banco';
    } else if (valor < 0 && /TARIFA|TAXA|COMISS|ESTORNO|DEVOLU|REEMBOLSO|CONTESTAC|CHARGEBACK/.test(t)) {
      sugestao = 'mkt_estorno';
      interno = 1;
    }

    lancamentos.push({
      data,
      descricao: rotulo,
      contraparte,
      documento: '',
      valor,
      tipo: valor < 0 ? 'D' : 'C',
      ref: `mp-ext:${id}:${valor.toFixed(2)}`,
      origem: 'mercadopago',
      sugestao,
      possivel_transferencia: 0,
      movimento_interno: interno,
      meta: { tipoMov: tipo, referencia: id },
    });
  }

  // O bloco de resumo serve de conferência do saldo da conta.
  const cabecalho = matriz.slice(0, 3).map((l) => l.map((c) => String(c || '')));
  const iSaldo = cabecalho.findIndex((l) => l.some((c) => /INITIAL_BALANCE/i.test(c)));
  const saldos = iSaldo >= 0 && matriz[iSaldo + 1]
    ? {
        inicial: parseMoney(matriz[iSaldo + 1][0]),
        creditos: parseMoney(matriz[iSaldo + 1][1]),
        debitos: parseMoney(matriz[iSaldo + 1][2]),
        final: parseMoney(matriz[iSaldo + 1][3]),
      }
    : null;

  return { lancamentos, saldos };
}

/**
 * Repasse do Magalu (relatório "repasse…xlsx").
 *
 * O arquivo é o extrato da conta do marketplace: cada linha é uma parcela de
 * venda, um estorno, um evento (subsídio de cupom) ou a transferência do
 * dinheiro para o banco. A coluna "Valor do repasse financeiro da parcela" é
 * a que manda — o arquivo inteiro fecha em zero, porque tudo o que entrou saiu
 * na transferência.
 *
 * Duas coisas importantes:
 *  1. O Magalu cobra R$ 5,00 fixos por transferência, declarados na coluna
 *     "Taxa de transferência". Por isso o Pix que chega no Sicoob é sempre
 *     R$ 5,00 menor que o repasse — conferido nos três repasses de agosto.
 *  2. A receita é reconhecida quando o dinheiro cai no banco (a conta do
 *     marketplace é de passagem). Então as linhas de venda e estorno servem
 *     para explicar o repasse, não para somar faturamento duas vezes.
 */
export function parseMagaluRepasse(matriz) {
  const { registros } = comCabecalho(matriz, ['id_do_repasse', 'valor_do_repasse_financeiro_da_parcela']);
  const lancamentos = [];
  let taxaTransferencia = 0;

  for (const r of registros) {
    const data = toISODate(campo(r, 'data_do_repasse'));
    const valor = parseMoney(campo(r, 'valor_do_repasse_financeiro_da_parcela'));
    if (!data || !valor) continue;

    const forma = String(campo(r, 'forma_de_pagamento') || '').trim();
    const repasse = String(campo(r, 'id_do_repasse') || '').trim();
    const idTx = String(campo(r, 'id_da_transacao') || '').trim();
    const pedido = String(campo(r, 'numero_do_pedido') || '').replace(/^N\/A$/i, '').trim();
    const cliente = String(campo(r, 'nome_do_cliente') || '').replace(/^N\/A$/i, '').trim();
    const parcela = String(campo(r, 'parcela_atual') || '').replace(/^N\/A$/i, '').trim();
    const obs = String(campo(r, 'observacoes') || '').trim();
    const bruto = parseMoney(campo(r, 'valor_bruto_da_parcela'));

    const base = {
      data,
      documento: pedido,
      tipo: valor < 0 ? 'D' : 'C',
      origem: 'magalu',
      possivel_transferencia: 0,
      movimento_interno: 0,
      meta: { repasse, idTx, forma, parcela },
    };

    if (/transfer/i.test(forma)) {
      // O repasse indo para o banco. Sai inteiro da conta do Magalu; no
      // extrato do Sicoob chega R$ 5,00 a menos.
      const taxa = Math.abs(parseMoney(campo(r, 'taxa_de_transferencia')));
      taxaTransferencia = round2(taxaTransferencia + taxa);
      lancamentos.push({
        ...base,
        descricao: `Repasse Magalu para a conta bancária${taxa ? ` (taxa de transferência ${taxa.toFixed(2)})` : ''}`,
        contraparte: 'Magazine Luiza',
        detalhe: `Repasse ${repasse}${taxa ? ` — chega no banco ${Math.abs(round2(valor + taxa)).toFixed(2)}` : ''}`,
        valor,
        taxa,
        ref: `magalu:${repasse}:transferencia:${valor.toFixed(2)}`,
        sugestao: 'trf_interna',
        movimento_interno: 1,
      });
      continue;
    }

    if (valor < 0) {
      // Estorno/devolução: reduz o repasse. Como a receita só é contada quando
      // o dinheiro chega no banco, isto não é despesa — já vem descontado.
      lancamentos.push({
        ...base,
        descricao: `Estorno Magalu${pedido ? ` — pedido ${pedido}` : ''}`,
        contraparte: cliente || 'Magazine Luiza',
        detalhe: obs,
        valor,
        ref: `magalu:${repasse}:${idTx || pedido}:${parcela}:${valor.toFixed(2)}`,
        sugestao: 'mkt_estorno',
        movimento_interno: 1,
      });
      continue;
    }

    const rotulo = /evento/i.test(forma) ? 'Evento Magalu' : 'Venda Magalu';
    lancamentos.push({
      ...base,
      descricao: `${rotulo}${pedido ? ` — pedido ${pedido}` : ''}${parcela && parcela !== '1/1' ? ` (parcela ${parcela})` : ''}`,
      contraparte: cliente || 'Magazine Luiza',
      detalhe: obs,
      valor,
      valor_bruto: bruto > 0 ? bruto : valor,
      // A "taxa" é o que o marketplace reteve: o que ele vendeu menos o que sobrou.
      taxa: bruto > valor ? round2(bruto - valor) : 0,
      ref: `magalu:${repasse}:${idTx || pedido}:${parcela}:${valor.toFixed(2)}`,
      sugestao: 'rec_vendas',
    });
  }

  return { lancamentos, taxaTransferencia };
}

/**
 * Repasse da Web Continental (relatório "Parceiro_NNNN.xlsx").
 *
 * O arquivo é um repasse por vez: um cabeçalho com "Data Repasse" e o total,
 * depois uma linha por pedido e algumas linhas de ajuste (tarifa de
 * performance, recorrência). A coluna "LÍQUIDO DO PEDIDO" é a que soma —
 * conferido no repasse de 10/08/2026: 907,05 − 1,00 − 35,00 = 871,05, que é
 * exatamente o Pix que caiu no Sicoob.
 *
 * Como a conta do marketplace é de passagem, as linhas servem para explicar o
 * repasse; a receita continua sendo contada quando o dinheiro chega no banco.
 */
export function parseWebContinental(matriz) {
  const texto = matriz.slice(0, 12).map((l) => l.join(' ')).join(' ');
  const mData = texto.match(/Data\s*Repasse\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const data = toISODate(mData?.[1]);
  if (!data) return { lancamentos: [], erro: 'Não achei a "Data Repasse" no cabeçalho do relatório.' };

  const parceiro = (texto.match(/Parceiro\s*:?\s*([\w\s.\-]{3,40})/i)?.[1] || '').trim();
  const { registros } = comCabecalho(matriz, ['pedido', 'liquido_do_pedido']);
  const lancamentos = [];
  let soma = 0;

  for (const r of registros) {
    const liquido = parseMoney(campo(r, 'liquido_do_pedido'));
    if (!liquido) continue;

    const pedido = String(campo(r, 'pedido') || '').trim();
    const status = String(campo(r, 'status') || '').trim();
    const cliente = String(campo(r, 'cliente') || '').trim();
    const doc = String(campo(r, 'cpf_cnpj') || '').replace(/\D/g, '');
    const bruto = parseMoney(campo(r, 'valor_pedido'));
    const nota = String(campo(r, 'forpag') || '').trim();
    soma = round2(soma + liquido);

    const base = {
      data,
      documento: pedido,
      tipo: liquido < 0 ? 'D' : 'C',
      origem: 'webcontinental',
      possivel_transferencia: 0,
      movimento_interno: 0,
      meta: { pedido, status, nota, parceiro },
    };

    if (!pedido) {
      // Linha de ajuste do marketplace (tarifa, recorrência): já vem
      // descontada do repasse, então não é despesa nova.
      lancamentos.push({
        ...base,
        descricao: `Web Continental — ${status || 'ajuste do repasse'}`,
        contraparte: 'Web Continental',
        detalhe: nota,
        valor: liquido,
        ref: `webcont:${data}:${normalize(status || nota).slice(0, 24)}:${liquido.toFixed(2)}`,
        sugestao: 'mkt_estorno',
        movimento_interno: 1,
      });
      continue;
    }

    lancamentos.push({
      ...base,
      descricao: `Venda Web Continental — pedido ${pedido}${status ? ` (${status})` : ''}`,
      contraparte: cliente || 'Web Continental',
      doc_contraparte: doc.length >= 11 ? doc : '',
      detalhe: nota,
      valor: liquido,
      valor_bruto: bruto > 0 ? bruto : liquido,
      // O que o marketplace reteve é a diferença entre o pedido e o líquido.
      // As colunas de comissão vêm duplicadas no relatório (valor e
      // porcentagem com o mesmo rótulo), então a subtração é mais confiável.
      taxa: bruto > liquido ? round2(bruto - liquido) : 0,
      ref: `webcont:${data}:${pedido}:${liquido.toFixed(2)}`,
      sugestao: liquido < 0 ? 'mkt_estorno' : 'rec_vendas',
      movimento_interno: liquido < 0 ? 1 : 0,
    });
  }

  if (!lancamentos.length) return { lancamentos: [], erro: 'Nenhum pedido reconhecido neste relatório.' };

  // O relatório não traz a linha do repasse em si: sem ela a conta do
  // marketplace nunca zeraria. Aqui ela é criada com o total do arquivo.
  lancamentos.push({
    data,
    descricao: 'Repasse Web Continental para a conta bancária',
    contraparte: 'Web Continental',
    documento: '',
    valor: -soma,
    tipo: 'D',
    ref: `webcont:${data}:repasse:${soma.toFixed(2)}`,
    origem: 'webcontinental',
    sugestao: 'trf_interna',
    possivel_transferencia: 0,
    movimento_interno: 1,
    detalhe: `Total do repasse de ${data.split('-').reverse().join('/')}`,
    meta: { parceiro, repasse: soma },
  });

  return { lancamentos, repasse: soma, data };
}

/**
 * Formato livre — qualquer planilha com colunas de data, descrição e valor.
 * Serve para marketplaces menores (Magalu, Web Continental) e lançamentos em lote.
 */
export function parsePlanilhaGenerica(matriz) {
  const { registros, cabecalho } = comCabecalho(matriz, ['data', 'valor']);
  if (!cabecalho.some((c) => c.includes('data')) || !cabecalho.some((c) => c.includes('valor'))) {
    return { lancamentos: [], erro: 'A planilha precisa ter ao menos as colunas "Data" e "Valor".' };
  }
  const lancamentos = [];
  for (const r of registros) {
    const data = toISODate(campo(r, 'data'));
    const valor = parseMoney(campo(r, 'valor'));
    if (!data || !valor) continue;
    lancamentos.push({
      data,
      descricao: String(campo(r, 'descricao', 'historico', 'description') || 'Lançamento'),
      contraparte: String(campo(r, 'contraparte', 'fornecedor', 'cliente', 'nome') || ''),
      documento: String(campo(r, 'documento', 'doc', 'nf') || ''),
      valor,
      tipo: valor < 0 ? 'D' : 'C',
      ref: '',
      origem: 'planilha',
      meta: {},
    });
  }
  return { lancamentos };
}
