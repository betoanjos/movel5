// Leitores dos relatórios em PDF do Sicoob:
//  - Extrato de conta corrente        -> lançamentos (alternativa ao OFX)
//  - Movimentação PIX (pago/recebido) -> enriquecimento (nome da contraparte)
//  - Comprovantes de boleto pago      -> enriquecimento (nome do beneficiário)
//
// Os enriquecimentos existem porque no OFX o boleto aparece só como
// "DÉB.TIT.COMPE EFETIVADO" e o PIX só com o CNPJ. Cruzando com estes
// relatórios cada linha ganha nome — é o que torna a conciliação legível.
import { parseMoney, toISODate, normalize, extractDoc } from '../lib/util.js';

const RE_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})/;
const RE_DATA_CURTA = /^(\d{2})\/(\d{2})\b/;
const RE_VALOR_SICOOB = /R\$\s*([\d.]+,\d{2})\s*([CD])\b/;

/** Identifica qual relatório do Sicoob é, a partir das primeiras linhas. */
export function detectaSicoob(linhas) {
  const cab = linhas.slice(0, 25).join(' ').toUpperCase();
  if (cab.includes('EXTRATO DE CONTA CORRENTE')) return 'extrato';
  if (cab.includes('MOVIMENTAÇÃO - PAGAMENTOS') || cab.includes('MOVIMENTACAO - PAGAMENTOS')) return 'pix-pago';
  if (cab.includes('MOVIMENTAÇÃO - RECEBIMENTOS') || cab.includes('MOVIMENTACAO - RECEBIMENTOS')) return 'pix-recebido';
  if (cab.includes('PAGAMENTO DE BOLETO')) return 'boletos-pagos';
  if (cab.includes('CONSULTA DE BOLETO')) return 'boletos-recebidos';
  return null;
}

// ---------------------------------------------------------------- EXTRATO ---

/**
 * Extrato de conta corrente em PDF. As datas vêm sem ano ("26/08"),
 * então o ano é lido do cabeçalho "Periodo: 01/08/2026 - 31/08/2026".
 */
export function parseExtratoSicoob(linhas) {
  const cabecalho = linhas.slice(0, 20).join(' ');
  const per = cabecalho.match(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
  const inicio = per ? toISODate(per[1]) : null;
  const fim = per ? toISODate(per[2]) : null;
  const anoBase = inicio ? Number(inicio.slice(0, 4)) : new Date().getFullYear();
  const mesFim = fim ? Number(fim.slice(5, 7)) : null;

  const lancamentos = [];
  const saldosDia = [];
  let atual = null;

  const fecha = () => {
    if (atual && atual.valor) lancamentos.push(atual);
    atual = null;
  };

  for (const linha of linhas) {
    const mData = linha.match(RE_DATA_CURTA);
    const mValor = linha.match(RE_VALOR_SICOOB);

    if (mData && mValor) {
      fecha();
      const [, dd, mm] = mData;
      // Extrato do Sicoob vem do mais recente ao mais antigo; se o mês da
      // linha for maior que o mês final do período, é do ano anterior.
      const ano = mesFim && Number(mm) > mesFim ? anoBase - 1 : anoBase;
      const data = `${ano}-${mm}-${dd}`;
      const bruto = parseMoney(mValor[1]);
      const valor = mValor[2] === 'D' ? -bruto : bruto;

      const miolo = linha
        .slice(mData[0].length, linha.indexOf(mValor[0]))
        .replace(/\s+/g, ' ')
        .trim();

      if (/^SALDO DO DIA/i.test(miolo) || /SALDO DO DIA/i.test(linha)) {
        saldosDia.push({ data, saldo: valor });
        continue;
      }
      if (/^SALDO (ANTERIOR|BLOQUEADO|DISPON)/i.test(miolo)) continue;

      // "16425800 DÉB.TIT. COBRANÇA EFETIVADO" -> documento + histórico
      const mDoc = miolo.match(/^(\S+(?:\s\S+)?)\s+(D[ÉE]B|CR[ÉE]D|PIX|TARIFA|RESGATE|RDC|SALDO|JUROS|D[ÉE]BITO|CR[ÉE]DITO)/i);
      const documento = mDoc ? mDoc[1].trim() : '';
      const descricao = (mDoc ? miolo.slice(mDoc[1].length) : miolo).trim() || 'Lançamento';

      atual = {
        data,
        descricao,
        contraparte: '',
        documento: documento === 'Pix' ? '' : documento,
        valor,
        tipo: valor < 0 ? 'D' : 'C',
        ref: '',
        origem: 'extrato-pdf',
        meta: { linha },
      };
      continue;
    }

    // Linha de continuação: "Pagamento Pix 82.951.310 0001-56 ICMS SIMPLES..."
    if (atual && !mData && linha.length > 3 && !/^(Data|HIST[ÓO]RICO|SICOOB|SISBR|Cooperativa|Conta:|Periodo)/i.test(linha)) {
      const extra = linha.replace(/\s+/g, ' ').trim();
      atual.contraparte = (atual.contraparte
        ? atual.contraparte + ' ' + extra
        : extra.replace(/^(Pagamento|Recebimento)\s+Pix\s*/i, '')).trim();
      atual.meta.detalhe = (atual.meta.detalhe || '') + ' ' + extra;
    }
  }
  fecha();

  return { periodo: { inicio, fim }, lancamentos, saldosDia };
}

// -------------------------------------------------------------- PIX -------

/**
 * Relatório detalhado de PIX. Cada registro começa numa linha com data
 * completa e termina com "R$ 1.234,56"; as colunas quebram em várias linhas,
 * então acumulamos até a próxima data.
 * @returns {Array<{data,valor,contraparte,documento,instituicao,descricao,e2e}>}
 */
export function parsePixSicoob(linhas, sentido /* 'pago' | 'recebido' */) {
  const registros = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const texto = buffer.join(' ').replace(/\s+/g, ' ').trim();
    const mData = texto.match(RE_DATA_BR);
    const mValor = texto.match(/R\$\s*(-?[\d.]+,\d{2})\s*$/) || texto.match(/R\$\s*(-?[\d.]+,\d{2})/);
    if (mData && mValor) {
      const bruto = Math.abs(parseMoney(mValor[1]));
      registros.push({
        data: toISODate(mData[0]),
        valor: sentido === 'pago' ? -bruto : bruto,
        contraparte: extraiNomePix(texto),
        documento: extractDoc(texto) || '',
        instituicao: extraiInstituicao(texto),
        descricao: texto,
        e2e: (texto.match(/\bE\d{8,}[A-Za-z0-9]*/) || [''])[0],
      });
    }
    buffer = [];
  };

  for (const l of linhas) {
    if (RE_DATA_BR.test(l)) { flush(); buffer = [l]; }
    else if (buffer.length) buffer.push(l);
  }
  flush();

  // Descarta cabeçalho ("Período: ...") e o rodapé de totais do relatório.
  const RUIDO = /Per[ií]odo|emiss[ãa]o|Resumo|Valor total|Quantidade de|SICOOB - Sistema|Plataforma de Servi/i;
  return registros.filter((r) => Math.abs(r.valor) > 0 && !RUIDO.test(r.descricao.slice(0, 80)));
}

/**
 * Nome do outro lado do PIX.
 *
 * O relatório é multi-coluna e o texto sai embaralhado, mas há uma âncora
 * confiável: o nome do destinatário/pagador vem logo depois de
 * "Pix via chave" / "Pix copia e cola" / "Pix via manual" e termina no
 * início da chave (CPF mascarado, CNPJ, telefone, e-mail ou UUID).
 */
function extraiNomePix(texto) {
  const ancora = texto.match(
    /Pix\s+(?:via chave|copia e cola|via manual|manual)\s+(.{3,90}?)(?=\s*(?:\*{3}\.|\d{2}\.\d{3}\.\d{3}\/|\+55|[a-z]{2,}\*{2,}@|[0-9a-f]{6,}-\*|R\$|$))/i
  );
  let bruto = ancora ? ancora[1] : '';

  if (!bruto) {
    // Sem âncora: usa o trecho depois de "Pagamento/Recebimento" e antes da chave.
    const alt = texto.match(/(?:Pagamento|Recebimento)\s+(.{3,80}?)(?=\s*(?:CPF|CNPJ|Telefone|E-mail|Chave))/i);
    bruto = alt ? alt[1] : '';
  }

  const nome = bruto
    .replace(/\b(?:Resumo|Valor total|Solicitacao de saque|Transferencia Bankline)\b/gi, ' ')
    .replace(/\b[A-Z0-9]{8,}\b/g, ' ')            // ids/hashes de transação
    .replace(/\d{6,}/g, ' ')
    .replace(/\bE\d{8,}[A-Za-z0-9]*/g, ' ')
    .replace(/R\$\s*[\d.,]+/g, ' ')
    .replace(/\b(CPF|CNPJ|Telefone|E-mail|Chave aleat[óo]ria|Pix|via|chave|copia|cola|manual)\b/gi, ' ')
    .replace(/[^A-Za-zÀ-Úà-ú&.\-\/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Descarta sobras de uma palavra só que sejam claramente rótulo.
  if (nome.length < 4) return '';
  if (/^(LTDA|S A|S\.A|IP|ME|EIRELI|SA|CRED|COOP)$/i.test(nome)) return '';
  return nome;
}

function extraiInstituicao(texto) {
  const inst = texto.match(/\b(ITA[ÚU] UNIBANCO|BANCO INTER|NU PAGAMENTOS|CAIXA ECONOMICA FEDERAL|BCO DO BRASIL|MERCADO PAGO|PAGCERTO|MAGALUPAY|CIVIA COOP|SICOOB|BRADESCO|SANTANDER|PAGSEGURO|PAGAR\.ME|STONE|CORA|C6)\b/i);
  return inst ? inst[0] : '';
}

// ---------------------------------------------------------- BOLETOS PAGOS ---

/**
 * Comprovantes de boleto pago (um por página). O "Número do agendamento"
 * é o mesmo valor que aparece como CHECKNUM/Documento no OFX e no extrato,
 * o que dá um casamento exato com o lançamento bancário.
 */
export function parseBoletosPagos(paginas) {
  const registros = [];
  for (const pag of paginas) {
    const texto = pag.join('\n');
    if (!/PAGAMENTO DE BOLETO/i.test(texto)) continue;

    const campo = (rot) => {
      const re = new RegExp(rot + '\\s*:?\\s*(.+)', 'i');
      for (const l of pag) { const m = l.match(re); if (m) return m[1].trim(); }
      return '';
    };

    // O bloco "Beneficiário:" precede o nome; "Pagador:" também tem Nome/Razão.
    const idxBenef = pag.findIndex((l) => /^Benefici[áa]rio\s*:?\s*$/i.test(l.trim()));
    const idxPagador = pag.findIndex((l) => /^Pagador\s*:?\s*$/i.test(l.trim()));
    const bloco = idxBenef >= 0
      ? pag.slice(idxBenef, idxPagador > idxBenef ? idxPagador : idxBenef + 6)
      : pag;
    const nome = (bloco.find((l) => /Nome\/Raz[ãa]o Social/i.test(l)) || '')
      .replace(/.*Nome\/Raz[ãa]o Social\s*:?\s*/i, '').trim();
    const cnpj = (bloco.find((l) => /CPF\/CNPJ/i.test(l)) || '')
      .replace(/.*CPF\/CNPJ\s*:?\s*/i, '').trim();

    const valorPago = parseMoney(campo('Pago'));
    const agendamento = campo('N[úu]mero do agendamento').replace(/\D/g, '');
    if (!valorPago && !agendamento) continue;

    registros.push({
      agendamento,
      documento: campo('N[úu]mero do documento'),
      nossoNumero: campo('Nosso n[úu]mero'),
      contraparte: nome,
      cnpj,
      valor: -Math.abs(valorPago || parseMoney(campo('Documento'))),
      dataPagamento: toISODate(campo('Pagamento')),
      vencimento: toISODate(campo('Vencimento')),
      situacao: campo('Situa[çc][ãa]o'),
    });
  }
  return registros;
}

// ------------------------------------------------------ BOLETOS RECEBIDOS ---

/** Consulta de boletos emitidos (a receber). Usado como conta a receber. */
export function parseBoletosRecebidos(paginas) {
  const registros = [];
  for (const pag of paginas) {
    const texto = pag.join('\n');
    if (!/CONSULTA DE BOLETO/i.test(texto)) continue;
    const campo = (rot) => {
      const re = new RegExp(rot + '\\s*:?\\s*([^:]+?)(?:\\s{2,}[A-ZÀ-Ú][a-zà-ú]+\\s*:|$)', 'i');
      for (const l of pag) { const m = l.match(re); if (m) return m[1].trim(); }
      return '';
    };
    const idxPagador = pag.findIndex((l) => /^Pagador\s*$/i.test(l.trim()));
    const nome = idxPagador >= 0
      ? (pag.slice(idxPagador, idxPagador + 3).find((l) => /Nome\s*:/i.test(l)) || '')
          .replace(/.*Nome\s*:\s*/i, '').replace(/CPF\/CNPJ.*/i, '').trim()
      : '';
    const valor = parseMoney(campo('Valor boleto'));
    if (!valor) continue;
    registros.push({
      contraparte: nome,
      valor,
      vencimento: toISODate(campo('Data vencimento')),
      emissao: toISODate(campo('Data emiss[ãa]o')),
      nossoNumero: campo('Nosso n[úu]mero'),
      seuNumero: campo('Seu n[úu]mero'),
    });
  }
  return registros;
}

/** Chave usada para casar enriquecimento por data+valor quando não há nº de agendamento. */
export const chaveDataValor = (data, valor) => `${data}|${Math.abs(Number(valor)).toFixed(2)}`;
export { normalize };
