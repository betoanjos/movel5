// Leitores do Bling: pedidos de venda (CSV), vendas por período (XLSX)
// e notas fiscais de entrada (PDF).
//
// O Bling é a fonte do FATURAMENTO (regime de competência). O banco é a fonte
// do CAIXA. Guardamos os dois separados e cruzamos: assim dá para ver
// "vendi X, recebi Y, faltam receber Z".
import { parseMoney, toISODate, normalize } from '../lib/util.js';
import { comCabecalho, campo } from './planilha.js';

const CANCELADO = /cancel|devolv|recusad|estornad/i;

/** Pedidos de venda exportados do Bling (CSV com `;`). */
export function parseBlingPedidos(matriz) {
  const { registros, cabecalho } = comCabecalho(matriz, ['pedido', 'data', 'total']);
  if (!cabecalho.includes('pedido')) return { vendas: [], erro: 'Não parece um CSV de pedidos do Bling.' };

  const vendas = [];
  for (const r of registros) {
    const numero = String(campo(r, 'pedido') || '').trim();
    const data = toISODate(campo(r, 'data'));
    if (!numero || !data) continue;

    const total = parseMoney(campo(r, 'total'));
    const situacao = String(campo(r, 'status_pedido', 'situacao') || '').trim();

    vendas.push({
      fonte: 'bling',
      numero,
      data,
      dataPagamento: toISODate(campo(r, 'pagamento_data')) || null,
      cliente: String(campo(r, 'nome_do_cliente', 'destinatario', 'razao_social') || '').trim(),
      documento: String(campo(r, 'cpf') || campo(r, 'cnpj') || '').replace(/\D/g, ''),
      canal: String(campo(r, 'canal_de_venda') || '').trim(),
      formaPagamento: String(campo(r, 'pagamento_tipo', 'forma_pagamento_paga') || '').trim(),
      subtotal: parseMoney(campo(r, 'subtotal_produtos')),
      frete: parseMoney(campo(r, 'frete_valor')),
      desconto: parseMoney(campo(r, 'desconto')),
      comissao: parseMoney(campo(r, 'valor_comissao')),
      total,
      valorPago: parseMoney(campo(r, 'valor_pagamento')),
      situacao,
      cancelado: CANCELADO.test(situacao) ? 1 : 0,
      uf: String(campo(r, 'estado') || '').trim(),
      ref: `bling-ped:${numero}`,
    });
  }
  return { vendas };
}

/**
 * "Vendas por período" (XLSX): totais diários já consolidados.
 * Usado como conferência do faturamento quando não há o CSV de pedidos.
 */
export function parseBlingVendasPeriodo(matriz) {
  const { registros } = comCabecalho(matriz, ['dia', 'valor_das_vendas']);
  const dias = [];
  for (const r of registros) {
    const data = toISODate(campo(r, 'dia', 'data'));
    if (!data) continue;
    const valorVendas = parseMoney(campo(r, 'valor_das_vendas'));
    const valorPedidos = parseMoney(campo(r, 'valor_dos_pedidos'));
    const valorCancelados = parseMoney(campo(r, 'valor_pedidos_cancelados'));
    if (!valorVendas && !valorPedidos && !valorCancelados) continue;
    dias.push({
      data,
      qtdPedidos: Number(campo(r, 'quantidade_de_pedidos')) || 0,
      valorPedidos,
      qtdVendas: Number(campo(r, 'quantidade_de_vendas')) || 0,
      valorVendas,
      qtdCancelados: Number(campo(r, 'quantidade_de_pedidos_cancelados')) || 0,
      valorCancelados,
    });
  }
  return { diasVenda: dias };
}

/**
 * Relatório de Notas Fiscais de Entrada (PDF).
 * Linhas: `027438 Entrada 28/08/2026 MEYER MOVEIS LTDA Registrada 493,43`
 * Serve para identificar fornecedores e casar com os boletos pagos.
 */
export function parseBlingNFEntrada(linhas) {
  const compras = [];
  const re = /^(\d{4,9})\s+(Entrada|Sa[íi]da)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(Registrada|Emitida[^\d]*|Rejeitada|Cancelada|Autorizada|Denegada|Em digita[çc][ãa]o)\s+([\d.]+,\d{2})\s*$/i;
  for (const l of linhas) {
    const m = l.match(re);
    if (!m) continue;
    const situacao = m[5].trim();
    compras.push({
      fonte: 'bling',
      numero: m[1],
      data: toISODate(m[3]),
      fornecedor: m[4].trim(),
      situacao,
      cancelado: /cancel|denegad|rejeitad/i.test(situacao) ? 1 : 0,
      valor: parseMoney(m[6]),
      ref: `bling-nfe:${m[1]}:${m[3]}`,
    });
  }
  return { compras };
}

/** Relatório de Pedidos de Vendas (PDF) — alternativa ao CSV. */
export function parseBlingPedidosPDF(linhas) {
  const vendas = [];
  const re = /^(\d{3,8})\s+(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(.+?)\s+(Em aberto|Atendido|Cancelado|Em andamento|Faturado|Verificado|Conclu[íi]do)\s+([\d.]+,\d{2})\s*$/i;
  for (const l of linhas) {
    const m = l.match(re);
    if (!m) continue;
    vendas.push({
      fonte: 'bling',
      numero: m[1],
      data: toISODate(m[2]),
      dataPagamento: null,
      cliente: m[4].trim(),
      documento: '',
      canal: '',
      formaPagamento: '',
      total: parseMoney(m[6]),
      valorPago: 0,
      situacao: m[5],
      cancelado: /cancel/i.test(m[5]) ? 1 : 0,
      ref: `bling-pedpdf:${m[1]}`,
    });
  }
  return { vendas };
}

/**
 * Relatório de Contas a Pagar — layout "Agrupado por Fornecedor".
 * O nome do fornecedor vem numa linha isolada e as parcelas logo abaixo:
 *   AZURELOG TRANSPORTES LTDA
 *   0298938-7 20/07/2026 Paga 3.639,41
 *   Total: R$ 5.045,79
 */
export function parseBlingContasPagarAgrupado(linhas) {
  const contas = [];
  const reParcela = /^(\S[\S-]*)?\s*(\d{2}\/\d{2}\/\d{4})\s+(Paga|Em aberto|Aberto|Atrasada(?:\s+demais)?|Cancelada|Parcial)\s+([\d.]+,\d{2})\s*$/i;
  let fornecedor = '';

  for (const linha of linhas) {
    const l = linha.trim();
    if (!l || l === '\f') continue;
    if (/^(Relat[óo]rio|Per[íi]odo|Nro\.?|Hist[óo]rico|Fornecedor\b|Vencimento|Situa[çc][ãa]o|Valor$)/i.test(l)) continue;
    if (/^Total\s*:/i.test(l)) continue;

    const m = l.match(reParcela);
    if (m) {
      if (!fornecedor) continue;
      contas.push({
        fornecedor,
        documento: (m[1] || '').trim(),
        vencimento: toISODate(m[2]),
        situacao: m[3].replace(/\s+/g, ' ').trim(),
        paga: /paga/i.test(m[3]) ? 1 : 0,
        valor: parseMoney(m[4]),
        ref: `bling-cp:${normalize(fornecedor)}:${(m[1] || '').trim()}:${m[2]}`,
      });
      continue;
    }
    // Linha sem data e sem valor = cabeçalho de um novo fornecedor.
    if (!/\d{2}\/\d{2}\/\d{4}/.test(l) && !/[\d.]+,\d{2}/.test(l) && l.length > 3) {
      fornecedor = l;
    }
  }
  return { contasPagar: contas };
}

/**
 * Relatório de Contas a Pagar — layout plano (uma linha por título).
 * O nome do fornecedor quebra em várias linhas, então a âncora é a linha
 * que termina em `vencimento situação valor`; o fornecedor é montado com o
 * texto que sobra dessa linha e das linhas vizinhas sem data.
 */
export function parseBlingContasPagar(linhas) {
  const contas = [];
  const reFim = /(\d{2}\/\d{2}\/\d{4})\s+(Paga|Em aberto|Aberto|Atrasada(?:\s+demais)?|Cancelada|Parcial)?\s*([\d.]+,\d{2})\s*$/i;
  const limpas = linhas.map((l) => l.trim()).filter((l) => l && l !== '\f');

  for (let i = 0; i < limpas.length; i++) {
    const l = limpas[i];
    if (/^(Relat[óo]rio|Per[íi]odo|Nro\.?|Fornecedor\b|Hist[óo]rico|Total)/i.test(l)) continue;
    const m = l.match(reFim);
    if (!m) continue;

    const antes = l.slice(0, m.index).trim();
    // Linhas vizinhas sem data/valor pertencem ao nome do fornecedor quebrado.
    const vizinha = (j) => {
      const v = limpas[j];
      return v && !reFim.test(v) && !/\d{2}\/\d{2}\/\d{4}/.test(v) && !/^(Relat|Per[íi]odo|Nro|Total)/i.test(v) ? v : '';
    };
    const bruto = [vizinha(i - 1), antes, vizinha(i + 1)].filter(Boolean).join(' ');

    // Separa fornecedor do histórico/nº do documento.
    const mDoc = bruto.match(/^(.*?)\s+((?:Ref\. a NF|PED\b).*)$/i);
    let fornecedor = (mDoc ? mDoc[1] : bruto)
      .replace(/\s+\S*\d{4,}\S*\s*$/, '')
      .replace(/\s+/g, ' ').trim();

    // A situação e os rótulos do cabeçalho vazam quando a coluna quebra.
    let situacao = (m[2] || '').replace(/\s+/g, ' ').trim();
    const mSit = fornecedor.match(/^(Paga|Em aberto|Aberto|Atrasada(?:\s+demais)?|Cancelada|Parcial)\s+(.*)$/i);
    if (mSit) { situacao = situacao || mSit[1]; fornecedor = mSit[2]; }
    fornecedor = fornecedor
      .replace(/^(documento|Nro\.?|Hist[óo]rico|Fornecedor|Situa[çc][ãa]o|Vencimento|Valor)\s+/i, '')
      .replace(/\s+(demais)$/i, '')
      .trim();
    if (!situacao) situacao = 'Em aberto';

    if (fornecedor.length < 3) continue;
    contas.push({
      fornecedor,
      documento: '',
      historico: mDoc ? mDoc[2].trim() : '',
      vencimento: toISODate(m[1]),
      situacao,
      paga: /paga/i.test(situacao) ? 1 : 0,
      valor: parseMoney(m[3]),
      ref: `bling-cp:${normalize(fornecedor)}:${m[1]}:${m[3]}`,
    });
  }
  return { contasPagar: contas };
}

/**
 * "Relatório de Clientes e Fornecedor — Visão de Contatos".
 *
 * É o arquivo mais útil de todos para a conciliação: dá o nome e o TIPO de
 * cada CNPJ. Com ele, um PIX para 09.574.015/0001-38 vira automaticamente
 * "LINZ FABRICA DE MOVEIS — Fornecedores" sem intervenção nenhuma.
 *
 * O PDF é multi-coluna e quebra tanto o nome quanto o CNPJ em duas linhas
 * ("81.560.047/00" + "01-01"), então cada registro é remontado.
 */
export function parseBlingContatos(linhas) {
  const TIPOS = /(Transportador(?:a)?|Fornecedor|Cliente|Funcion[áa]rio|Contador|T[ée]cnico|Vendedor|Representante|Parceiro)/i;
  const contatos = [];
  const limpas = linhas.map((l) => l.trim()).filter((l) => l && l !== '\f');

  // Um registro começa na linha que traz "Pessoa" (Física/Jurídica).
  const inicios = [];
  limpas.forEach((l, i) => { if (/\bPessoa\b/.test(l) && TIPOS.test(l)) inicios.push(i); });

  for (let k = 0; k < inicios.length; k++) {
    const ini = inicios[k];
    const fim = k + 1 < inicios.length ? inicios[k + 1] : limpas.length;
    const bloco = limpas.slice(ini, Math.min(fim, ini + 4));
    const texto = bloco.join(' ');

    const mTipo = texto.match(TIPOS);
    const tipo = mTipo ? mTipo[1] : '';

    // CNPJ/CPF partido: "81.560.047/00" + ... + "01-01"
    let doc = '';
    const mCnpjInteiro = texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (mCnpjInteiro) doc = mCnpjInteiro[0].replace(/\D/g, '');
    else {
      const p1 = texto.match(/(\d{2}\.\d{3}\.\d{3}\/\d{2})(?!\d)/);
      const p2 = texto.match(/(?:^|\s)(\d{2}-\d{2})(?:\s|$)/);
      if (p1 && p2) doc = (p1[1] + p2[1]).replace(/\D/g, '');
    }
    const mCpf = !doc && texto.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    if (mCpf) doc = mCpf[0].replace(/\D/g, '');

    // Nome: o que vem antes de "Pessoa" na 1ª linha, mais o que vem antes de
    // "Jurídica"/"Física" nas linhas de continuação.
    let nome = bloco[0].split(/\bPessoa\b/)[0].trim();
    for (const cont of bloco.slice(1)) {
      if (/\bPessoa\b/.test(cont)) break;
      const mCont = cont.match(/^(.*?)\s*\b(Jur[íi]dica|F[íi]sica)\b/);
      const pedaco = (mCont ? mCont[1] : cont.split(/\d{2}\.\d{3}\.\d{3}|\d{5}-\d{3}|\(\d{2}\)|[a-z0-9._%-]+@/i)[0]).trim();
      if (pedaco && /^[A-Za-zÀ-Úà-ú&'.\- ]{2,}$/.test(pedaco)) nome += ' ' + pedaco;
    }
    nome = nome
      .split(/\s+/)
      .filter((t) => !t.includes('@') && !/\.(com|br|net|org)\b/i.test(t) && !/^\.+/.test(t))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!nome || nome.length < 3) continue;
    contatos.push({
      nome,
      documento: doc,
      tipo,
      uf: (texto.match(/\b([A-Z]{2})\b(?=\s+[A-ZÀ-Ú][a-zà-ú])/) || [])[1] || '',
      categoriaSugerida: categoriaPorTipoContato(tipo),
      ref: `bling-contato:${doc || normalize(nome)}`,
    });
  }
  return { contatos };
}

/** Traduz o tipo de contato do Bling em categoria financeira. */
export function categoriaPorTipoContato(tipo) {
  const t = normalize(tipo);
  if (t.startsWith('TRANSPORTADOR')) return 'des_frete_saida';
  if (t === 'FORNECEDOR') return 'des_fornecedores';
  if (t === 'CLIENTE') return 'rec_vendas';
  if (t === 'FUNCIONARIO') return 'des_salarios';
  if (t === 'CONTADOR') return 'des_contabilidade';
  if (t === 'TECNICO') return 'des_manutencao';
  return null;
}

/** Detecta qual relatório do Bling é um PDF. */
export function detectaBlingPDF(linhas) {
  const cab = normalize(linhas.slice(0, 12).join(' '));
  if (cab.includes('NOTAS FISCAIS DE ENTRADA')) return 'nf-entrada';
  if (cab.includes('PEDIDOS DE VENDAS')) return 'pedidos';
  if (cab.includes('CONTAS A PAGAR AGRUPADO')) return 'contas-pagar-agrupado';
  if (cab.includes('CONTAS A PAGAR')) return 'contas-pagar';
  if (cab.includes('CONTAS A RECEBER')) return 'contas-receber';
  if (cab.includes('VISAO DE CONTATOS') || cab.includes('CLIENTES E FORNECEDOR')) return 'contatos';
  return null;
}
