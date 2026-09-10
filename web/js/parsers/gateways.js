// Leitores das contas digitais: Vindi/Yapay, Mercado Pago e marketplaces.
import { parseMoney, toISODate, normalize } from '../lib/util.js';
import { comCabecalho, campo } from './planilha.js';

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

    const ehSaque = /vindi pagamentos/i.test(origem) || /saque|liquida/i.test(descricao) && liquido < 0;

    lancamentos.push({
      data,
      descricao: ehSaque
        ? 'Saque/liquidação para conta bancária'
        : `Venda recebida${pedido ? ` — pedido ${pedido}` : ''}${forma ? ` (${forma}${parcelas && parcelas !== '-' ? ' ' + parcelas : ''})` : ''}`,
      contraparte: ehSaque ? 'Vindi Pagamentos' : (forma || 'Cliente'),
      documento: pedido,
      valor: liquido,
      valor_bruto: ehSaque ? liquido : bruto,
      taxa: ehSaque ? 0 : Math.round((taxaRet + taxaAnt) * 100) / 100,
      tipo: liquido < 0 ? 'D' : 'C',
      ref: `vindi:${idTx}:${parcelas}:${liquido.toFixed(2)}`,
      origem: 'vindi',
      sugestao: ehSaque ? 'trf_interna' : 'rec_vendas',
      meta: { origemColuna: origem, forma, parcelas, pedido },
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
    const ehTransferencia = /transfer|saque/i.test(descricao);
    lancamentos.push({
      data,
      descricao: descricao || 'Movimentação conta digital',
      contraparte: 'Vindi Pagamentos',
      documento: String(campo(r, 'n_pedido') || ''),
      valor,
      tipo: valor < 0 ? 'D' : 'C',
      ref: `vindi-cd:${campo(r, 'id_transacao')}:${valor.toFixed(2)}`,
      origem: 'vindi',
      sugestao: ehTransferencia ? 'trf_interna' : valor > 0 ? 'rec_vendas' : null,
      meta: {},
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
    const ehSaque = /withdraw|saque|transfer|retiro/i.test(tipoMov);

    lancamentos.push({
      data,
      descricao: ehSaque ? 'Saque para conta bancária' : (tipoMov || 'Movimentação Mercado Pago'),
      contraparte: String(campo(r, 'payer_name', 'nome_do_pagador', 'contraparte') || (ehSaque ? 'Mercado Pago' : 'Cliente')),
      documento: String(campo(r, 'external_reference', 'order_id', 'n_pedido') || ''),
      valor,
      valor_bruto: bruto,
      taxa,
      tipo: valor < 0 ? 'D' : 'C',
      ref: `mp:${id}:${valor.toFixed(2)}`,
      origem: 'mercadopago',
      sugestao: ehSaque ? 'trf_interna' : valor > 0 ? 'rec_vendas' : null,
      meta: { tipoMov },
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
