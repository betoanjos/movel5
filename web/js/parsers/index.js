// Detecta o tipo de cada arquivo solto e devolve um resultado padronizado.
import { isOFX, parseOFX } from './ofx.js';
import { pdfParaLinhas, porPagina } from './pdf-text.js';
import {
  detectaSicoob, parseExtratoSicoob, parsePixSicoob,
  parseBoletosPagos, parseBoletosRecebidos,
} from './sicoob.js';
import {
  parseVindiPaymentExtract, parseVindiContaDigital,
  parseMercadoPago, parseMagaluRepasse, parseWebContinental, parsePlanilhaGenerica,
} from './gateways.js';
import {
  parseBlingPedidos, parseBlingVendasPeriodo, parseBlingNFEntrada,
  parseBlingPedidosPDF, parseBlingContasPagar, parseBlingContasPagarAgrupado,
  parseBlingContatos, detectaBlingPDF,
} from './bling.js';
import { planilhaParaMatriz, csvParaMatriz, decodeTexto } from './planilha.js';
import { normalize } from '../lib/util.js';

/**
 * @typedef {Object} Resultado
 * @property {string} arquivo
 * @property {string} tipo      rótulo legível do que foi reconhecido
 * @property {Array}  lancamentos  movimentos de conta (dinheiro que entrou/saiu)
 * @property {Array}  enriquecimentos  dados que dão nome a lançamentos existentes
 * @property {Array}  vendas
 * @property {Array}  compras
 * @property {Array}  diasVenda
 * @property {Object} extra     saldos, período, avisos
 * @property {string} [erro]
 */

const vazio = (arquivo) => ({
  arquivo, tipo: 'Não reconhecido', lancamentos: [], enriquecimentos: [],
  vendas: [], compras: [], diasVenda: [], contasPagar: [], contatos: [], extra: {},
});

/** Processa um File do navegador. */
export async function lerArquivo(file) {
  const nome = file.name;
  const ext = nome.toLowerCase().split('.').pop();
  const buf = await file.arrayBuffer();
  const res = vazio(nome);

  try {
    if (ext === 'ofx' || ext === 'ofc' || ext === 'qfx') return lerOFX(buf, res);
    if (ext === 'pdf') return await lerPDF(buf, res);
    if (ext === 'csv' || ext === 'txt') return lerCSV(buf, res);
    if (['xlsx', 'xls', 'xlsm'].includes(ext)) return await lerPlanilha(buf, res);

    // Sem extensão conhecida: tenta adivinhar pelo conteúdo.
    const texto = decodeTexto(buf.slice(0, 4096));
    if (isOFX(texto)) return lerOFX(buf, res);
    res.erro = `Formato não suportado (.${ext}). Envie OFX, PDF, XLSX ou CSV.`;
    return res;
  } catch (e) {
    res.erro = `Erro ao ler: ${e.message}`;
    return res;
  }
}

function lerOFX(buf, res) {
  const texto = decodeTexto(buf);
  const { lancamentos, saldo, dataSaldo, periodo, contaDetectada } = parseOFX(texto);
  res.tipo = 'Extrato bancário OFX';
  res.lancamentos = lancamentos;
  res.extra = { saldo, dataSaldo, periodo, contaDetectada };
  if (!lancamentos.length) res.erro = 'Nenhum lançamento encontrado no OFX.';
  return res;
}

async function lerPDF(buf, res) {
  const linhas = await pdfParaLinhas(buf);
  const paginas = porPagina(linhas);
  const sicoob = detectaSicoob(linhas);

  if (sicoob === 'extrato') {
    const r = parseExtratoSicoob(linhas);
    res.tipo = 'Extrato Sicoob (PDF)';
    res.lancamentos = r.lancamentos;
    res.extra = { periodo: r.periodo, saldosDia: r.saldosDia };
    res.extra.aviso = 'Se você tiver o arquivo .OFX do mesmo período, prefira o OFX: ele traz identificadores únicos e evita duplicidade.';
    return res;
  }
  if (sicoob === 'pix-pago' || sicoob === 'pix-recebido') {
    const sentido = sicoob === 'pix-pago' ? 'pago' : 'recebido';
    const regs = parsePixSicoob(linhas, sentido);
    res.tipo = `PIX ${sentido === 'pago' ? 'pagos' : 'recebidos'} (Sicoob)`;
    res.enriquecimentos = regs.map((r) => ({
      chave: 'data-valor', data: r.data, valor: r.valor,
      contraparte: r.contraparte, documento: r.documento,
      detalhe: r.instituicao, fonte: 'pix-sicoob',
    }));
    return res;
  }
  if (sicoob === 'boletos-pagos') {
    const regs = parseBoletosPagos(paginas);
    res.tipo = 'Comprovantes de boleto pago (Sicoob)';
    res.enriquecimentos = regs.map((r) => ({
      chave: r.agendamento ? 'documento' : 'data-valor',
      documentoChave: r.agendamento,
      data: r.dataPagamento, valor: r.valor,
      contraparte: r.contraparte, documento: r.cnpj,
      detalhe: `Boleto venc. ${r.vencimento || '—'} · doc ${r.documento || '—'}`,
      fonte: 'boleto-sicoob',
    }));
    return res;
  }
  if (sicoob === 'boletos-recebidos') {
    const regs = parseBoletosRecebidos(paginas);
    res.tipo = 'Boletos emitidos (a receber)';
    res.extra = { boletosReceber: regs };
    res.enriquecimentos = regs.map((r) => ({
      chave: 'data-valor', data: r.vencimento, valor: r.valor,
      contraparte: r.contraparte, documento: '',
      detalhe: `Boleto emitido ${r.nossoNumero || ''}`.trim(), fonte: 'boleto-receber',
      tolerancia: 10,
    }));
    return res;
  }

  const bling = detectaBlingPDF(linhas);
  if (bling === 'nf-entrada') {
    const r = parseBlingNFEntrada(linhas);
    res.tipo = 'Notas fiscais de entrada (Bling)';
    res.compras = r.compras;
    if (!r.compras.length) res.erro = 'Nenhuma nota de entrada reconhecida neste PDF.';
    return res;
  }
  if (bling === 'pedidos') {
    const r = parseBlingPedidosPDF(linhas);
    res.tipo = 'Pedidos de venda (Bling, PDF)';
    res.vendas = r.vendas;
    res.extra.aviso = 'O CSV de pedidos do Bling traz mais detalhes (canal, forma de pagamento, comissão). Prefira o CSV quando tiver.';
    return res;
  }
  if (bling === 'contas-pagar-agrupado') {
    const r = parseBlingContasPagarAgrupado(linhas);
    res.tipo = 'Contas a pagar por fornecedor (Bling)';
    res.contasPagar = r.contasPagar;
    if (!r.contasPagar.length) res.erro = 'O relatório de contas a pagar veio vazio.';
    return res;
  }
  if (bling === 'contas-pagar') {
    const r = parseBlingContasPagar(linhas);
    res.tipo = 'Contas a pagar (Bling)';
    res.contasPagar = r.contasPagar;
    if (!r.contasPagar.length) res.erro = 'O relatório de contas a pagar veio vazio.';
    return res;
  }
  if (bling === 'contatos') {
    const r = parseBlingContatos(linhas);
    res.tipo = 'Cadastro de clientes e fornecedores (Bling)';
    res.contatos = r.contatos;
    res.extra.aviso = r.contatos.length
      ? `${r.contatos.length} contatos com CNPJ — a partir de agora os lançamentos desses CNPJs são nomeados e categorizados sozinhos.`
      : undefined;
    if (!r.contatos.length) res.erro = 'Nenhum contato reconhecido neste relatório.';
    return res;
  }

  res.erro = 'PDF não reconhecido. Reconheço: extrato Sicoob, PIX pagos/recebidos, comprovantes de boleto e relatórios do Bling.';
  return res;
}

function lerCSV(buf, res) {
  const texto = decodeTexto(buf);
  if (isOFX(texto)) return lerOFX(buf, res);
  const matriz = csvParaMatriz(texto);
  return classificaMatriz(matriz, res);
}

async function lerPlanilha(buf, res) {
  const abas = await planilhaParaMatriz(buf, { todasAbas: true });
  // Usa a primeira aba que produzir dados.
  for (const aba of abas) {
    const parcial = classificaMatriz(aba.linhas, vazio(res.arquivo));
    const achou = parcial.lancamentos.length || parcial.vendas.length ||
                  parcial.diasVenda.length || parcial.compras.length;
    if (achou) { parcial.arquivo = res.arquivo; parcial.extra.aba = aba.nome; return parcial; }
  }
  res.erro = 'Não consegui identificar colunas de data e valor nesta planilha.';
  return res;
}

/** Decide, pelo cabeçalho, qual leitor de planilha usar. */
function classificaMatriz(matriz, res) {
  if (!matriz.length) { res.erro = 'Arquivo vazio.'; return res; }
  const cab = normalize(matriz.slice(0, 6).map((l) => l.join(' ')).join(' '));

  if (cab.includes('VALOR LIQ') && cab.includes('TAXA RETENCAO')) {
    const r = parseVindiPaymentExtract(matriz);
    res.tipo = 'Extrato de pagamentos Vindi/Yapay';
    res.lancamentos = r.lancamentos;
    return res;
  }
  if (cab.includes('ID TRANSACAO') && cab.includes('VALOR')) {
    const r = parseVindiContaDigital(matriz);
    res.tipo = 'Conta digital Vindi';
    res.lancamentos = r.lancamentos;
    return res;
  }
  if (cab.includes('LIQUIDO DO PEDIDO') || (cab.includes('DATA REPASSE') && cab.includes('COMISSAO'))) {
    const r = parseWebContinental(matriz);
    res.tipo = 'Repasse Web Continental';
    res.lancamentos = r.lancamentos;
    if (r.erro) res.erro = r.erro;
    else if (r.repasse) {
      res.extra.aviso = `Repasse de ${r.repasse.toFixed(2).replace('.', ',')} em ` +
        `${r.data.split('-').reverse().join('/')} — é esse o valor que aparece no extrato do Sicoob.`;
    }
    return res;
  }
  if (cab.includes('ID DO REPASSE') && cab.includes('VALOR DO REPASSE FINANCEIRO')) {
    const r = parseMagaluRepasse(matriz);
    res.tipo = 'Repasse Magalu';
    res.lancamentos = r.lancamentos;
    if (r.taxaTransferencia) {
      res.extra.aviso = `O Magalu cobrou ${r.taxaTransferencia.toFixed(2).replace('.', ',')} de taxa de transferência ` +
        'neste arquivo — é por isso que o Pix que chega no Sicoob é menor que o repasse.';
    }
    return res;
  }
  if (cab.includes('SOURCE ID') || cab.includes('MP FEE') || cab.includes('MERCADO PAGO') ||
      cab.includes('NET CREDIT AMOUNT') || cab.includes('MONEY RELEASE')) {
    const r = parseMercadoPago(matriz);
    res.tipo = 'Relatório Mercado Pago';
    res.lancamentos = r.lancamentos;
    return res;
  }
  if (cab.includes('NOME DO CLIENTE') && cab.includes('CANAL DE VENDA')) {
    const r = parseBlingPedidos(matriz);
    res.tipo = 'Pedidos de venda (Bling)';
    res.vendas = r.vendas;
    if (r.erro) res.erro = r.erro;
    return res;
  }
  if (cab.includes('VALOR DAS VENDAS') || cab.includes('QUANTIDADE DE PEDIDOS')) {
    const r = parseBlingVendasPeriodo(matriz);
    res.tipo = 'Vendas por período (Bling)';
    res.diasVenda = r.diasVenda;
    return res;
  }

  const r = parsePlanilhaGenerica(matriz);
  res.tipo = 'Planilha genérica (data / descrição / valor)';
  res.lancamentos = r.lancamentos;
  if (r.erro) res.erro = r.erro;
  return res;
}
