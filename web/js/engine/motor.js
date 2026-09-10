// Motor de importação: deduplicação, enriquecimento, categorização
// automática e detecção de transferências entre contas próprias.
import { normalize, hash, round2, daysBetween, competenciaOf, uid, extractDoc, brl,
         formatarDoc, soDocumento } from '../lib/util.js';
import { REGRAS_PADRAO, CATEGORIA_POR_ID } from './seed.js';

// ------------------------------------------------------------ DEDUPLICAÇÃO ---

/**
 * Chave de deduplicação.
 *
 * Quando o arquivo traz identificador próprio (FITID do OFX, ID da transação
 * do gateway), ele já é único por definição — dois lançamentos com o mesmo
 * identificador são o mesmo lançamento, e o contador de ocorrências NÃO entra
 * na chave. É isso que faz reimportar o mesmo extrato, ou dois relatórios da
 * Vindi com períodos sobrepostos, não dobrar a receita.
 *
 * Sem identificador, a chave é data+valor+descrição e o sufixo `#n` permite
 * duas linhas legítimas idênticas no mesmo dia (dois boletos de mesmo valor).
 */
export function chaveDedupe(l, contaId, ocorrencia = 0) {
  if (l.ref) return hash(`${contaId}|ref|${l.ref}`);
  return hash(`${contaId}|dv|${l.data}|${round2(l.valor).toFixed(2)}|${normalize(l.descricao).slice(0, 40)}`, ocorrencia);
}

/**
 * Chave "fraca": mesma conta, mesma data e mesmo valor. Serve para pegar o
 * mesmo lançamento vindo de FONTES diferentes, que têm identificadores
 * diferentes — o caso clássico é importar o OFX e o extrato em PDF do mesmo
 * mês. Só vale entre arquivos distintos: repetições dentro do mesmo arquivo
 * são movimentos reais.
 */
export const chaveFraca = (l, contaId) =>
  hash(`${contaId}|fraca|${l.data}|${round2(l.valor).toFixed(2)}`);

// ----------------------------------------------------------- ENRIQUECIMENTO ---

/**
 * Aplica enriquecimentos (nome do beneficiário do boleto, nome do
 * destinatário do PIX) sobre uma lista de lançamentos.
 * @returns {number} quantos lançamentos ganharam nome
 */
export function aplicarEnriquecimentos(lancamentos, enriquecimentos) {
  if (!enriquecimentos.length) return 0;

  const porDocumento = new Map();
  const porDataValor = new Map();
  for (const e of enriquecimentos) {
    if (e.documentoChave) {
      porDocumento.set(String(e.documentoChave).replace(/\D/g, ''), e);
    }
    const k = `${e.data}|${Math.abs(round2(e.valor)).toFixed(2)}`;
    if (!porDataValor.has(k)) porDataValor.set(k, []);
    porDataValor.get(k).push(e);
  }

  let n = 0;
  for (const l of lancamentos) {
    if (l.enriquecido) continue;
    let achado = null;

    // 1) Casamento exato pelo número do agendamento do boleto.
    const doc = String(l.documento || '').replace(/\D/g, '');
    if (doc && porDocumento.has(doc)) {
      const e = porDocumento.get(doc);
      if (Math.abs(Math.abs(e.valor) - Math.abs(l.valor)) < 0.02) achado = e;
    }

    // 2) Casamento por data + valor (com tolerância de dias opcional).
    if (!achado) {
      const k = `${l.data}|${Math.abs(round2(l.valor)).toFixed(2)}`;
      const cands = (porDataValor.get(k) || []).filter(
        (e) => Math.sign(e.valor) === Math.sign(l.valor) && !e.__usado
      );
      if (cands.length) achado = cands[0];
      else {
        // Tolerância: boleto liquidado alguns dias depois do vencimento.
        for (const [kk, lista] of porDataValor) {
          const [d, v] = kk.split('|');
          if (v !== Math.abs(round2(l.valor)).toFixed(2)) continue;
          const cand = lista.find((e) => !e.__usado && Math.sign(e.valor) === Math.sign(l.valor)
            && Math.abs(daysBetween(d, l.data)) <= (e.tolerancia ?? 3));
          if (cand) { achado = cand; break; }
        }
      }
    }

    if (achado) {
      achado.__usado = true;
      if (achado.contraparte && !l.contraparte) l.contraparte = achado.contraparte;
      else if (achado.contraparte && l.contraparte && !normalize(l.contraparte).includes(normalize(achado.contraparte).slice(0, 12))) {
        l.contraparte = achado.contraparte;
      }
      if (achado.documento && !l.doc_contraparte) l.doc_contraparte = achado.documento;
      l.detalhe = [l.detalhe, achado.detalhe].filter(Boolean).join(' · ');
      l.enriquecido = 1;
      l.fonte_enriquecimento = achado.fonte;
      n++;
    }
  }
  return n;
}

// -------------------------------------------------------- CONTRAPARTES ------

/**
 * Índice CNPJ/CPF -> contato, montado a partir do relatório de contatos do
 * Bling e do que o usuário já cadastrou.
 */
export function indexarContrapartes(contrapartes = []) {
  const idx = new Map();
  for (const c of contrapartes) {
    const doc = String(c.documento || '').replace(/\D/g, '');
    if (doc.length >= 11) idx.set(doc, c);
  }
  return idx;
}

/**
 * Dá nome e categoria aos lançamentos cujo CNPJ/CPF já é conhecido.
 * É o que transforma "PIX EMITIDO OUTRA IF — 09.574.015/0001-38" em
 * "LINZ FABRICA DE MOVEIS — Fornecedores", sem ninguém digitar nada.
 * @returns {number} quantos lançamentos foram identificados
 */
export function aplicarContrapartes(lancamentos, indice) {
  let n = 0;
  for (const l of lancamentos) {
    const doc = docContraparte(l);
    if (!doc) continue;
    // O extrato às vezes perde a barra do CNPJ ("18.236.120 0001-58").
    // Enquanto não há nome, mostra ao menos o documento escrito direito.
    if (soDocumento(l.contraparte)) l.contraparte = formatarDoc(doc);
    if (!indice || !indice.size) continue;
    const c = indice.get(doc);
    if (!c) continue;
    l.doc_contraparte = doc;
    // O nome do cadastro é melhor que o texto solto do extrato.
    if (c.nome && (!l.contraparte || /^[\d.\/\- ]+$/.test(l.contraparte))) l.contraparte = c.nome;
    l.contraparte_tipo = c.tipo || '';
    if (c.categoriaSugerida) l.categoria_contraparte = c.categoriaSugerida;
    l.identificado = 1;
    n++;
  }
  return n;
}

// ----------------------------------------------------------- CATEGORIZAÇÃO ---

/**
 * Texto usado pelas regras: descrição + contraparte + detalhe + documentos.
 * O CNPJ/CPF entra também em dígitos puros — é o identificador que mais se
 * repete no extrato, então uma regra por documento resolve dezenas de linhas
 * de uma vez (ex.: todo PIX para 82.951.310/0001-56 é ICMS).
 */
export const textoRegra = (l) => {
  const doc = l.doc_contraparte || extractDoc(l.contraparte) || extractDoc(l.descricao);
  return normalize(
    [l.descricao, l.contraparte, l.detalhe, l.documento, l.doc_contraparte].filter(Boolean).join(' ')
  ) + (doc ? ' ' + String(doc).replace(/\D/g, '') : '');
};

/** Documento (CNPJ/CPF) da contraparte, quando identificável. */
export const docContraparte = (l) =>
  (l.doc_contraparte || extractDoc(l.contraparte) || extractDoc(l.descricao) || '').replace(/\D/g, '');

const temValor = (r) => r.valor != null && r.valor !== '' && Number(r.valor) !== 0;

/**
 * Uma regra sua casa com este lançamento?
 *
 * A regra pode combinar texto, valor e dia do mês. Todas as condições que
 * estiverem preenchidas precisam bater — assim "R$ 1.200,00 no dia 10" pega a
 * mensalidade certa sem pegar outros pagamentos do mesmo valor.
 */
export function regraCombina(regra, l, texto = null) {
  const sinal = l.valor < 0 ? 'D' : 'C';
  if (regra.sinal && regra.sinal !== sinal) return false;
  if (regra.conta_id && regra.conta_id !== l.conta_id) return false;

  if (temValor(regra) && Math.abs(Math.abs(Number(regra.valor)) - Math.abs(l.valor)) > 0.005) return false;
  if (regra.dia_mes && Number(String(l.data || '').slice(8, 10)) !== Number(regra.dia_mes)) return false;

  const alvo = normalize(regra.padrao || '');
  if (alvo) {
    const t = texto ?? textoRegra(l);
    if (!(regra.exato ? t === alvo : t.includes(alvo))) return false;
  }
  // Regra sem nenhuma condição pegaria tudo: não vale.
  return !!(alvo || temValor(regra) || regra.dia_mes);
}

/** Como a regra aparece escrita para ele, na lista de regras e no histórico. */
export function rotuloRegra(regra) {
  const partes = [];
  if (regra.padrao) partes.push(`“${regra.padrao}”`);
  if (temValor(regra)) partes.push(brl(Math.abs(Number(regra.valor))));
  if (regra.dia_mes) partes.push(`dia ${regra.dia_mes}`);
  return partes.join(' + ') || 'regra sua';
}

/**
 * Escolhe a categoria de um lançamento.
 *
 * Ordem de precedência:
 *   1. regra criada pelo usuário  (ele mandou, vale)
 *   2. cadastro da contraparte     (CNPJ identificado no Bling)
 *   3. regras padrão por texto
 *   4. sugestão do próprio arquivo
 *
 * @param {Object} l lançamento
 * @param {Array} regrasUsuario regras aprendidas (têm prioridade sobre as padrão)
 * @returns {{categoria:string|null, confianca:'alta'|'baixa'|null, regra:string|null}}
 */
export function categorizar(l, regrasUsuario = []) {
  // Sugestão que veio do próprio parser (ex.: saque de gateway).
  const texto = textoRegra(l);
  const sinal = l.valor < 0 ? 'D' : 'C';

  const todas = [
    ...regrasUsuario.map((r) => ({ ...r, prioridade: (r.prioridade ?? 200), origem: 'usuario' })),
    ...REGRAS_PADRAO.map((r) => ({ ...r, origem: 'padrao' })),
  ].sort((a, b) => b.prioridade - a.prioridade);

  // Uma regra explícita do usuário ainda ganha do cadastro; por isso a busca
  // acontece em dois passos.
  const doUsuario = todas.filter((r) => r.origem === 'usuario');
  for (const r of doUsuario) {
    if (regraCombina(r, l, texto)) {
      return {
        categoria: r.categoria, confianca: 'alta', regra: rotuloRegra(r),
        possivelTransferencia: r.possivelTransferencia ? 1 : 0,
      };
    }
  }

  if (l.categoria_contraparte) {
    return {
      categoria: l.categoria_contraparte,
      confianca: 'alta',
      regra: `cadastro: ${l.contraparte || l.doc_contraparte}`,
      possivelTransferencia: 0,
    };
  }

  // Linha interna de gateway/marketplace: o próprio arquivo diz o que ela é
  // (estorno, tarifa retida, repasse). As regras de texto do banco não valem
  // aqui — senão a "Tarifa Performance" da Web Continental viraria tarifa
  // bancária e apareceria como despesa que nunca saiu do banco.
  if (l.movimento_interno && l.sugestao) {
    return {
      categoria: l.sugestao, confianca: 'alta', regra: 'origem do arquivo',
      possivelTransferencia: 0,
    };
  }

  for (const r of todas) {
    if (r.origem === 'usuario') continue;
    if (r.sinal && r.sinal !== sinal) continue;
    if (r.conta_id && r.conta_id !== l.conta_id) continue;
    const alvo = normalize(r.padrao);
    if (!alvo) continue;
    const casa = r.exato ? texto === alvo : texto.includes(alvo);
    if (!casa) continue;
    return {
      categoria: r.categoria,
      confianca: r.origem === 'usuario' ? 'alta' : (r.confianca || 'alta'),
      regra: r.padrao,
      possivelTransferencia: r.possivelTransferencia ? 1 : 0,
    };
  }

  if (l.sugestao) {
    return {
      categoria: l.sugestao, confianca: 'alta', regra: 'origem do arquivo',
      possivelTransferencia: l.sugestao === 'trf_interna' ? 1 : 0,
    };
  }
  return { categoria: null, confianca: null, regra: null, possivelTransferencia: 0 };
}

// ------------------------------------------------------ TRANSFERÊNCIAS ------

/**
 * Casa saídas de uma conta com entradas de outra: o saque do gateway que cai
 * no banco, o PIX entre contas próprias. Sem isso, o mesmo dinheiro é contado
 * duas vezes e a receita aparece inflada.
 *
 * @param {Array} lancamentos todos os lançamentos do período (várias contas)
 * @param {{janelaDias:number, tolerancia:number}} opts
 * @returns {{pares:Array, marcados:number}}
 */
export function detectarTransferencias(lancamentos, {
  janelaDias = 5, tolerancia = 0.02, reconheceReceita = () => true,
} = {}) {
  const saidas = lancamentos.filter((l) => l.valor < 0 && !l.transfer_id && !l.bloqueia_transferencia);
  const entradas = lancamentos.filter((l) => l.valor > 0 && !l.transfer_id && !l.bloqueia_transferencia);

  const porValor = new Map();
  for (const e of entradas) {
    const k = Math.abs(round2(e.valor)).toFixed(2);
    if (!porValor.has(k)) porValor.set(k, []);
    porValor.get(k).push(e);
  }

  const pares = [];
  for (const s of saidas) {
    const k = Math.abs(round2(s.valor)).toFixed(2);
    const cands = (porValor.get(k) || []).filter(
      (e) => e.conta_id !== s.conta_id && !e.__pareado &&
             Math.abs(daysBetween(s.data, e.data)) <= janelaDias
    );
    if (!cands.length) continue;

    // Prefere a entrada mais próxima no tempo.
    cands.sort((a, b) => Math.abs(daysBetween(s.data, a.data)) - Math.abs(daysBetween(s.data, b.data)));
    const e = cands[0];

    // Saída de conta de passagem para o banco: NÃO é para parear. Nessas
    // contas a venda só vira receita quando o dinheiro chega no banco — se as
    // duas pontas virassem transferência, o faturamento sumiria. Marca só a
    // saída, que é o dinheiro deixando o marketplace.
    if (!reconheceReceita(s.conta_id) && reconheceReceita(e.conta_id)) {
      if (!s.categoria) {
        s.categoria = 'trf_interna';
        s.confianca = 'alta';
        s.conciliado = 1;
        s.regra_aplicada = 'saída de conta de passagem';
      }
      s.possivel_transferencia = 0;
      continue;
    }
    e.__pareado = true;

    const tid = 'trf_' + uid();
    s.transfer_id = tid; e.transfer_id = tid;
    s.categoria = 'trf_interna'; e.categoria = 'trf_interna';
    s.confianca = 'alta'; e.confianca = 'alta';
    s.conciliado = 1; e.conciliado = 1;
    pares.push({ transfer_id: tid, saida: s, entrada: e, valor: Math.abs(s.valor), dias: Math.abs(daysBetween(s.data, e.data)) });
  }

  for (const e of entradas) delete e.__pareado;
  return { pares, marcados: pares.length * 2 };
}

// --------------------------------------------------------- PIPELINE IMPORT ---

/**
 * Roda a importação completa de um conjunto de arquivos já lidos.
 *
 * @param {Array} resultados saída de `lerArquivo`
 * @param {Object} ctx { contaPadraoId, contaPorArquivo, existentes, regrasUsuario, enriquecimentosSalvos }
 * @returns {Object} resumo + registros prontos para gravar
 */
export function processarImportacao(resultados, ctx) {
  const {
    contaPorArquivo = {}, contaPadraoId = null,
    existentes = [], regrasUsuario = [], enriquecimentosSalvos = [],
  } = ctx;

  // Índice do que já está gravado, para não duplicar.
  const chavesExistentes = new Set(existentes.map((l) => l.dedupe));
  const fracasExistentes = new Map();
  for (const l of existentes) {
    const k = chaveFraca(l, l.conta_id);
    fracasExistentes.set(k, (fracasExistentes.get(k) || 0) + 1);
  }

  const novosEnriquecimentos = [];
  const novasVendas = [];
  const novasCompras = [];
  const novosDiasVenda = [];
  const novasContasPagar = [];
  const novosContatos = [];
  const brutos = [];
  const porArquivo = [];

  for (const r of resultados) {
    if (r.erro && !r.lancamentos.length && !r.enriquecimentos.length) {
      porArquivo.push({ arquivo: r.arquivo, tipo: r.tipo, erro: r.erro, novos: 0, duplicados: 0 });
      continue;
    }
    const contaId = contaPorArquivo[r.arquivo] || contaPadraoId;
    novosEnriquecimentos.push(...r.enriquecimentos);
    novasVendas.push(...r.vendas);
    novasCompras.push(...r.compras);
    novosDiasVenda.push(...r.diasVenda);
    novasContasPagar.push(...(r.contasPagar || []));
    novosContatos.push(...(r.contatos || []));

    for (const l of r.lancamentos) {
      brutos.push({ ...l, conta_id: contaId, arquivo: r.arquivo });
    }
    porArquivo.push({
      arquivo: r.arquivo, tipo: r.tipo, aviso: r.extra?.aviso,
      lidos: r.lancamentos.length,
      enriquecimentos: r.enriquecimentos.length,
      vendas: r.vendas.length, compras: r.compras.length,
      novos: 0, duplicados: 0,
    });
  }

  // --- Deduplicação ---
  const contadorSemRef = new Map();   // repetições legítimas quando não há identificador
  const fracasNoLote = new Map();     // chave fraca -> arquivos que já a usaram neste lote
  const novos = [];
  const duplicados = [];

  for (const l of brutos) {
    const linhaArquivo = porArquivo.find((p) => p.arquivo === l.arquivo);
    const marcarDuplicado = (motivo) => {
      duplicados.push({ ...l, motivo });
      if (linhaArquivo) linhaArquivo.duplicados++;
    };

    let dedupe;
    if (l.ref) {
      dedupe = chaveDedupe(l, l.conta_id);
    } else {
      const cBase = `${l.conta_id}|${l.data}|${round2(l.valor).toFixed(2)}|${normalize(l.descricao).slice(0, 40)}`;
      const oc = contadorSemRef.get(cBase) || 0;
      contadorSemRef.set(cBase, oc + 1);
      dedupe = chaveDedupe(l, l.conta_id, oc);
    }

    if (chavesExistentes.has(dedupe)) {
      marcarDuplicado('Já importado antes — mesmo identificador do arquivo de origem.');
      continue;
    }

    // Mesma conta, data e valor vindo de outro arquivo: é o mesmo movimento
    // relatado por duas fontes (OFX e PDF, por exemplo).
    const fk = chaveFraca(l, l.conta_id);
    const usados = fracasNoLote.get(fk) || new Set();
    const jaGravadas = fracasExistentes.get(fk) || 0;
    const deOutroArquivo = [...usados].some((a) => a !== l.arquivo);

    if (deOutroArquivo) {
      marcarDuplicado('Mesma data e valor já vieram de outro arquivo deste envio.');
      continue;
    }
    if (jaGravadas > usados.size) {
      marcarDuplicado('Mesma data e valor já existem nesta conta, de outra fonte.');
      usados.add(l.arquivo);
      fracasNoLote.set(fk, usados);
      continue;
    }

    usados.add(l.arquivo);
    fracasNoLote.set(fk, usados);
    chavesExistentes.add(dedupe);
    novos.push({ ...l, dedupe });
    if (linhaArquivo) linhaArquivo.novos++;
  }

  // --- Enriquecimento (usa também o que já foi salvo em importações anteriores) ---
  const todosEnriq = [...novosEnriquecimentos, ...enriquecimentosSalvos.map((e) => ({ ...e }))];
  const enriquecidosNovos = aplicarEnriquecimentos(novos, todosEnriq);
  // Lançamentos antigos ainda sem nome também aproveitam os enriquecimentos novos.
  const semNome = existentes.filter((l) => !l.enriquecido && !l.contraparte);
  const enriquecidosAntigos = aplicarEnriquecimentos(semNome, novosEnriquecimentos);

  // --- Identificação de contrapartes pelo CNPJ ---
  const idxContrapartes = indexarContrapartes(ctx.contrapartes || []);
  const identificados = aplicarContrapartes(novos, idxContrapartes) +
                        aplicarContrapartes(existentes.filter((l) => !l.identificado), idxContrapartes);

  // --- Títulos: liga a saída do banco ao fornecedor ---
  // Antes da categorização de propósito: com o nome do fornecedor no
  // lançamento, as regras por texto passam a reconhecê-lo.
  const universoTitulos = [...(ctx.contasPagar || []), ...novasContasPagar];
  const universoCompras = [...(ctx.compras || []), ...novasCompras];
  const pag = conciliarPagamentos(
    [...novos, ...existentes.filter((l) => !l.titulo_fornecedor)],
    universoTitulos, universoCompras
  );
  const titulosLigados = pag.resumo.ligados;
  const antigosComTitulo = pag.alterados.filter((l) => existentes.includes(l));

  // --- Categorização ---
  let autoCategorizados = 0;
  for (const l of novos) {
    l.competencia = competenciaOf(l.data);
    const c = categorizar(l, regrasUsuario);
    l.categoria = c.categoria;
    l.confianca = c.confianca;
    l.regra_aplicada = c.regra;
    // A marca vinda do parser (linha de gateway) tem tanto valor quanto a da regra.
    l.possivel_transferencia = c.possivelTransferencia || l.possivel_transferencia || 0;
    l.conciliado = c.categoria && c.confianca === 'alta' ? 1 : 0;
    if (c.categoria) autoCategorizados++;
  }

  // --- Pedidos: liga a entrada do banco ao pedido de venda ---
  // Vale para os novos e para os antigos ainda sem pedido: o CSV de pedidos
  // costuma chegar depois do extrato.
  const universoVendas = [...(ctx.vendas || []), ...novasVendas];
  const conc = conciliarVendas([...novos, ...existentes.filter((l) => !l.venda_numero)], universoVendas);
  const vendasLigadas = conc.resumo.ligados;
  const antigosComPedido = conc.alterados.filter((l) => existentes.includes(l));

  // --- Transferências (considera o histórico para casar com o outro lado) ---
  const universo = [...existentes.filter((l) => !l.transfer_id), ...novos];
  const contasCtx = ctx.contas || [];
  const reconheceReceita = (contaId) => {
    const c = contasCtx.find((x) => x.id === contaId);
    if (!c) return true;
    return c.reconhece_receita ?? (c.tipo === 'banco' || c.tipo === 'caixa');
  };
  const { pares } = detectarTransferencias(universo, { reconheceReceita });
  const paresNovos = pares.filter((p) => novos.includes(p.saida) || novos.includes(p.entrada));
  const alteradosAntigos = universo.filter((l) => existentes.includes(l) && l.transfer_id);

  return {
    novos,
    duplicados,
    alteradosAntigos: [...new Set([...alteradosAntigos, ...semNome.filter((l) => l.enriquecido),
      ...antigosComPedido, ...antigosComTitulo])],
    enriquecimentos: novosEnriquecimentos,
    vendas: novasVendas,
    compras: novasCompras,
    diasVenda: novosDiasVenda,
    contasPagar: novasContasPagar,
    contatos: novosContatos,
    porArquivo,
    resumo: {
      arquivos: resultados.length,
      lidos: brutos.length,
      novos: novos.length,
      duplicados: duplicados.length,
      autoCategorizados,
      enriquecidos: enriquecidosNovos + enriquecidosAntigos,
      identificados,
      transferencias: paresNovos.length,
      vendasLigadas,
      titulosLigados,
      pendentes: novos.filter((l) => !l.categoria || l.confianca === 'baixa').length,
    },
    pares: paresNovos,
  };
}

/**
 * Reavalia lançamentos de gateway já gravados.
 *
 * A classificação de um movimento de gateway (venda, movimento interno ou
 * saída para o banco) é feita na hora da importação. Quando essa regra
 * melhora, o que já está gravado continua com a classificação antiga — foi o
 * que aconteceu com os débitos de "liquidação", que ficavam pedindo
 * conciliação sem nunca ter par no extrato.
 *
 * Esta função roda a regra atual sobre o texto já gravado e corrige os
 * lançamentos que mudaram de classificação. Não mexe no que você travou.
 *
 * @param {Array} lancamentos
 * @param {(descricao:string, valor:number, origem:string) => Object} classificar
 * @returns {{alterados:Array, resumo:Object}}
 */
export function reavaliarGateway(lancamentos, classificar) {
  const alterados = [];
  const resumo = { analisados: 0, virouInterno: 0, virouSaida: 0, virouVenda: 0 };

  for (const l of lancamentos) {
    if (l.origem !== 'vindi' && l.origem !== 'mercadopago') continue;
    if (l.travado) continue;                 // decisão manual não se mexe
    if (l.transfer_id) continue;             // já pareado de verdade
    resumo.analisados++;

    const m = classificar(l.descricao || '', l.valor, l.meta?.origemColuna || '');
    const antes = {
      possivel: l.possivel_transferencia ? 1 : 0,
      interno: l.movimento_interno ? 1 : 0,
    };
    const depois = {
      possivel: m.possivelTransferencia ? 1 : 0,
      interno: m.tipo === 'interno' ? 1 : 0,
    };
    if (antes.possivel === depois.possivel && antes.interno === depois.interno) continue;

    const atualizado = {
      ...l,
      descricao: m.rotulo || l.descricao,
      possivel_transferencia: depois.possivel,
      movimento_interno: depois.interno,
      sugestao: m.sugestao,
      meta: { ...(l.meta || {}), tipoMovimento: m.tipo },
    };
    // Movimento interno do gateway não é receita nem despesa: já entra resolvido.
    if (m.tipo === 'interno' && !l.categoria) {
      atualizado.categoria = m.sugestao;
      atualizado.confianca = 'alta';
      atualizado.conciliado = 1;
      atualizado.regra_aplicada = 'movimento interno do gateway';
    }
    alterados.push(atualizado);
    resumo[m.tipo === 'interno' ? 'virouInterno' : m.tipo === 'venda' ? 'virouVenda' : 'virouSaida']++;
  }
  return { alterados, resumo };
}

/** Recategoriza lançamentos existentes após mudança nas regras. */
export function recategorizar(lancamentos, regrasUsuario, { apenasPendentes = true } = {}) {
  let n = 0;
  for (const l of lancamentos) {
    if (l.travado) continue;                       // categoria definida à mão
    if (apenasPendentes && l.categoria && l.confianca === 'alta') continue;
    if (l.transfer_id) continue;
    const c = categorizar(l, regrasUsuario);
    if (c.categoria && c.categoria !== l.categoria) {
      l.categoria = c.categoria;
      l.confianca = c.confianca;
      l.regra_aplicada = c.regra;
      n++;
    }
  }
  return n;
}

// -------------------------------------------------- PEDIDOS × ENTRADAS ------

/**
 * Liga as entradas do banco aos pedidos de venda (Tray importada no Bling).
 *
 * A maioria dos PIX que cai no Sicoob é pagamento de pedido, mas o extrato só
 * traz "PIX RECEBIDO - OUTRA IF" e o nome de quem pagou. Aqui o valor exato é
 * a âncora — em varejo, dois pedidos com o mesmo centavo no mesmo dia são
 * raros — e o nome, o documento e a data servem de desempate.
 *
 * Só liga quando não há dúvida: se dois pedidos diferentes empatam, deixa
 * como está em vez de chutar o número errado.
 *
 * @param {Array} lancamentos
 * @param {Array} vendas
 * @param {{janelaDias:number}} opts
 * @returns {{alterados:Array, resumo:{analisados:number, ligados:number, ambiguos:number}}}
 */
export function conciliarVendas(lancamentos, vendas = [], { janelaDias = 7 } = {}) {
  const alterados = [];
  const resumo = { analisados: 0, ligados: 0, ambiguos: 0 };
  const candidatas = vendas.filter((v) => !v.cancelado && v.numero && (v.total || v.valorPago));
  if (!candidatas.length) return { alterados, resumo };

  // Índice por valor em centavos: o cruzamento fica direto, sem varrer tudo.
  const porValor = new Map();
  const guardar = (centavos, v) => {
    if (!centavos) return;
    if (!porValor.has(centavos)) porValor.set(centavos, []);
    const lista = porValor.get(centavos);
    if (!lista.includes(v)) lista.push(v);
  };
  for (const v of candidatas) {
    guardar(Math.round(Math.abs(v.total || 0) * 100), v);
    guardar(Math.round(Math.abs(v.valorPago || 0) * 100), v);
  }

  for (const l of lancamentos) {
    if (l.valor <= 0 || l.venda_numero || l.transfer_id) continue;
    const lista = porValor.get(Math.round(l.valor * 100));
    if (!lista) continue;
    resumo.analisados++;

    const doc = docContraparte(l);
    const nome = normalize(l.contraparte || '');
    const pontuadas = [];
    for (const v of lista) {
      const dataVenda = v.dataPagamento || v.data;
      const dias = Math.abs(daysBetween(dataVenda, l.data));
      if (dias > janelaDias) continue;

      let pontos = 1;
      if (doc && v.documento && doc === String(v.documento).replace(/\D/g, '')) pontos += 5;
      const nomeVenda = normalize(v.cliente || '');
      if (nome && nomeVenda && (nomeVenda.includes(nome) || nome.includes(nomeVenda))) pontos += 4;
      if (dias === 0) pontos += 2;
      else if (dias <= 2) pontos += 1;
      pontuadas.push({ v, pontos });
    }
    if (!pontuadas.length) continue;

    pontuadas.sort((a, b) => b.pontos - a.pontos);
    const melhor = pontuadas[0];
    const empatou = pontuadas.some((p) => p !== melhor && p.pontos === melhor.pontos && p.v.numero !== melhor.v.numero);
    if (empatou) { resumo.ambiguos++; continue; }

    const v = melhor.v;
    l.venda_numero = v.numero;
    l.venda_canal = v.canal || '';
    l.venda_cliente = v.cliente || '';
    if (!l.documento) l.documento = v.numero;
    if (v.documento && !l.doc_contraparte) l.doc_contraparte = String(v.documento).replace(/\D/g, '');
    if (v.cliente && (!l.contraparte || soDocumento(l.contraparte))) l.contraparte = v.cliente;
    const marca = `Pedido ${v.numero}${v.canal ? ` · ${v.canal}` : ''}`;
    l.detalhe = l.detalhe && !l.detalhe.includes(marca) ? `${l.detalhe} · ${marca}` : marca;
    alterados.push(l);
    resumo.ligados++;
  }
  return { alterados, resumo };
}

// ------------------------------------------------ PAGAMENTOS × TÍTULOS ------

/**
 * Liga as saídas do banco às contas a pagar e às notas de entrada do Bling.
 *
 * No extrato, o pagamento de um fornecedor aparece como "DÉB.TÍTULO COBRANÇA"
 * e um número de agendamento — não diz quem recebeu. O relatório de contas a
 * pagar tem fornecedor, vencimento e valor; a nota de entrada tem fornecedor,
 * data e valor. O valor exato é a âncora; vencimento (ou data da nota) e nome
 * desempatam.
 *
 * Igual à conciliação de vendas: se dois títulos empatam, nenhum é escolhido.
 * Um nome errado no lançamento é pior do que nenhum nome.
 *
 * @returns {{alterados:Array, resumo:{ligados:number, porTitulo:number, porNota:number, ambiguos:number}}}
 */
export function conciliarPagamentos(lancamentos, contasPagar = [], compras = [], opts = {}) {
  const { janelaTitulo = 12, janelaNota = 60 } = opts;
  const alterados = [];
  const resumo = { ligados: 0, porTitulo: 0, porNota: 0, ambiguos: 0 };

  const porValor = new Map();
  const guardar = (valor, item) => {
    const centavos = Math.round(Math.abs(Number(valor) || 0) * 100);
    if (!centavos) return;
    if (!porValor.has(centavos)) porValor.set(centavos, []);
    porValor.get(centavos).push(item);
  };
  for (const c of contasPagar) {
    if (/cancel/i.test(c.situacao || '')) continue;
    guardar(c.valor, { tipo: 'titulo', fornecedor: c.fornecedor, data: c.vencimento, doc: c.documento, ref: c.ref, fonte: c });
  }
  for (const n of compras) {
    if (n.cancelado) continue;
    guardar(n.valor, { tipo: 'nota', fornecedor: n.fornecedor, data: n.data, doc: n.numero, ref: n.ref, fonte: n });
  }
  if (!porValor.size) return { alterados, resumo };

  for (const l of lancamentos) {
    if (l.valor >= 0 || l.titulo_fornecedor || l.transfer_id) continue;
    const lista = porValor.get(Math.round(Math.abs(l.valor) * 100));
    if (!lista) continue;

    const texto = normalize([l.contraparte, l.descricao, l.detalhe].filter(Boolean).join(' '));
    const pontuados = [];
    for (const c of lista) {
      if (!c.data) continue;
      const dias = daysBetween(c.data, l.data);
      // Título: paga-se perto do vencimento, antes ou depois. Nota fiscal:
      // o pagamento vem depois da compra, às vezes 30 ou 60 dias.
      const dentro = c.tipo === 'titulo'
        ? Math.abs(dias) <= janelaTitulo
        : dias >= -3 && dias <= janelaNota;
      if (!dentro) continue;

      let pontos = c.tipo === 'titulo' ? 2 : 1;
      const nome = normalize(c.fornecedor || '');
      const primeira = nome.split(' ').filter((p) => p.length > 3)[0];
      if (primeira && texto.includes(primeira)) pontos += 4;
      if (c.doc && l.documento && String(c.doc).replace(/\D/g, '') === String(l.documento).replace(/\D/g, '')) pontos += 4;
      if (Math.abs(dias) === 0) pontos += 2;
      else if (Math.abs(dias) <= 3) pontos += 1;
      pontuados.push({ c, pontos });
    }
    if (!pontuados.length) continue;

    pontuados.sort((a, b) => b.pontos - a.pontos);
    const melhor = pontuados[0];
    const empatou = pontuados.some((p) =>
      p !== melhor && p.pontos === melhor.pontos && normalize(p.c.fornecedor || '') !== normalize(melhor.c.fornecedor || ''));
    if (empatou) { resumo.ambiguos++; continue; }

    const c = melhor.c;
    l.titulo_fornecedor = c.fornecedor || '';
    l.titulo_ref = c.ref || '';
    l.titulo_tipo = c.tipo;
    if (c.fornecedor && (!l.contraparte || soDocumento(l.contraparte))) l.contraparte = c.fornecedor;
    const marca = c.tipo === 'titulo'
      ? `Título Bling · venc. ${(c.data || '').split('-').reverse().join('/')}`
      : `Nota de entrada ${c.doc || ''}`.trim();
    l.detalhe = l.detalhe && !l.detalhe.includes(marca) ? `${l.detalhe} · ${marca}` : marca;
    alterados.push(l);
    resumo.ligados++;
    if (c.tipo === 'titulo') resumo.porTitulo++; else resumo.porNota++;
  }
  return { alterados, resumo };
}
