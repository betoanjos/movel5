// Leitores das contas digitais: Vindi/Yapay, Mercado Pago e marketplaces.
import { parseMoney, toISODate, normalize } from '../lib/util.js';
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
    return {
      tipo: 'saida', sugestao: null, possivelTransferencia: 1,
      rotulo: /saque/i.test(d) ? 'Saque para conta bancária'
            : /transfer/i.test(d) ? 'Transferência para conta bancária'
            : /liquida/i.test(d) ? 'Liquidação para conta bancária'
            : null,
    };
  }
  // Crédito de liquidação: o dinheiro já foi contado quando a parcela entrou.
  if (/liquida[çc]/i.test(d) || /^cr[ée]dito referente [àa] liquida/i.test(d)) {
    return {
      tipo: 'interno', sugestao: 'trf_interna', possivelTransferencia: 1,
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
