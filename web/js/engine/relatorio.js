// Apuração mensal: resultado da empresa, caixa por conta, conta corrente da
// holding e a ponte que explica a diferença entre lucro e dinheiro em caixa.
import { round2, sum, competenciaOf, prevCompetencia, nextCompetencia, labelCompetencia, groupBy } from '../lib/util.js';
import { CATEGORIA_POR_ID, NAO_OPERACIONAIS } from './seed.js';

/**
 * Categorias criadas pelo usuário, registradas a cada apuração.
 *
 * Sem isto, um lançamento numa categoria própria não era receita nem despesa
 * nem não-operacional: ficava num limbo, fora do resultado e fora da ponte —
 * e reaparecia como "diferença que as linhas não explicam".
 */
let categoriasExtras = new Map();
const registrarCategorias = (lista = []) => {
  categoriasExtras = new Map(lista.filter((c) => c && c.id).map((c) => [c.id, c]));
};
const catDe = (catId) => CATEGORIA_POR_ID[catId] || categoriasExtras.get(catId) || null;

const natureza = (catId) => catDe(catId)?.natureza || null;
const nomeCat = (catId) => catDe(catId)?.nome || 'Sem categoria';
const grupoCat = (catId) => catDe(catId)?.grupo || 'Sem categoria';

/** Só receita e despesa formam o resultado; o resto é movimento de dinheiro. */
const ehResultado = (catId) => natureza(catId) === 'receita' || natureza(catId) === 'despesa';

/**
 * Saldo de abertura de uma conta numa competência.
 * Usa o fechamento do mês anterior quando existir; senão, o saldo inicial
 * cadastrado na conta somado a tudo que houve antes da competência.
 */
export function saldoAbertura(contaId, competencia, { contas, lancamentos, fechamentos }) {
  const anterior = prevCompetencia(competencia);
  const f = fechamentos.find((x) => x.competencia === anterior && x.conta_id === contaId && x.fechado);
  if (f) return round2(f.saldo_final);

  const conta = contas.find((c) => c.id === contaId);
  const base = Number(conta?.saldo_inicial || 0);
  const antes = lancamentos.filter(
    (l) => l.conta_id === contaId && l.competencia < competencia && !ehAplicacao(l)
  );
  return round2(base + sum(antes, (l) => l.valor));
}

/**
 * Aplicação automática (RDC) é dinheiro que continua sendo seu e continua
 * disponível no mesmo banco — só mudou de bolso. Por isso não sai do caixa:
 * o saldo do painel é o que o extrato mostra como "saldo em conta" mais o
 * "saldo em RDC automático".
 */
const ehAplicacao = (l) => natureza(l.categoria) === 'investimento';

/**
 * Apuração completa de uma competência (`YYYY-MM`).
 * @param {Object} dados { lancamentos, contas, fechamentos, vendas, compras, config }
 */
export function apurar(competencia, dados) {
  const { lancamentos = [], contas = [], fechamentos = [], vendas = [], config = {} } = dados;
  registrarCategorias(dados.categorias);
  const doMes = lancamentos.filter((l) => l.competencia === competencia);
  const ativos = contas.filter((c) => c.ativo !== 0);

  // Onde a receita é reconhecida.
  //
  // Por padrão, só o que chega numa conta bancária ou no caixa vira receita.
  // As contas de gateway e marketplace são tratadas como passagem: o dinheiro
  // fica lá até ser sacado, e só conta como venda quando cai no banco.
  //
  // O motivo é prático: o extrato do banco é o único número que ele consegue
  // conferir. Quem preferir reconhecer a venda já na conta do gateway pode
  // ligar isso conta a conta, em Ajustes.
  const reconhece = (contaId) => {
    const c = contas.find((x) => x.id === contaId);
    if (!c) return true;
    return c.reconhece_receita ?? (c.tipo === 'banco' || c.tipo === 'caixa');
  };
  const noCaixa = (contaId) => {
    const c = contas.find((x) => x.id === contaId);
    if (!c) return true;
    return c.entra_no_caixa ?? (c.tipo === 'banco' || c.tipo === 'caixa');
  };

  // Repasse de gateway que chega no banco: só é transferência quando a conta
  // do gateway também reconhece receita (senão a venda nunca seria contada).
  const repasses = identificarRepasses(doMes, ativos, reconhece);
  const ehRepasse = (l) => repasses.ids.has(l.id);

  // Crédito numa conta de passagem: entra no saldo dela, mas não é receita.
  const emTransito = (l) => l.valor > 0 && !reconhece(l.conta_id);

  // ------------------------------------------------------------ por conta ---
  const porConta = ativos.map((c) => {
    const lc = doMes.filter((l) => l.conta_id === c.id && !ehAplicacao(l));
    const inicial = saldoAbertura(c.id, competencia, { contas, lancamentos, fechamentos });
    const entradas = sum(lc.filter((l) => l.valor > 0), (l) => l.valor);
    const saidas = sum(lc.filter((l) => l.valor < 0), (l) => l.valor);
    const final = round2(inicial + entradas + saidas);
    const fech = fechamentos.find((f) => f.competencia === competencia && f.conta_id === c.id);
    const saldoBanco = fech && fech.saldo_banco != null ? Number(fech.saldo_banco) : null;
    return {
      conta: c, contaId: c.id, nome: c.nome, cor: c.cor, tipo: c.tipo,
      inicial, entradas, saidas, final,
      movimentos: lc.length,
      saldoBanco,
      diferenca: saldoBanco == null ? null : round2(saldoBanco - final),
      fechado: !!(fech && fech.fechado),
      reconheceReceita: reconhece(c.id),
      entraNoCaixa: noCaixa(c.id),
    };
  });

  const contasCaixa = porConta.filter((c) => c.entraNoCaixa);
  const contasTransito = porConta.filter((c) => !c.entraNoCaixa);

  const caixa = {
    inicial: sum(contasCaixa, (c) => c.inicial),
    entradas: sum(contasCaixa, (c) => c.entradas),
    saidas: sum(contasCaixa, (c) => c.saidas),
    final: sum(contasCaixa, (c) => c.final),
  };
  caixa.variacao = round2(caixa.final - caixa.inicial);

  // Quanto do saldo está aplicado no RDC automático: é a soma de tudo que foi
  // aplicado menos o que foi resgatado, desde o começo. O dinheiro continua
  // no caixa — isto serve só para ele saber onde está.
  const aplicacoes = lancamentos.filter(
    (l) => ehAplicacao(l) && l.competencia <= competencia && noCaixa(l.conta_id)
  );
  caixa.aplicado = round2(-sum(aplicacoes, (l) => l.valor));
  caixa.aplicadoNoMes = round2(-sum(aplicacoes.filter((l) => l.competencia === competencia), (l) => l.valor));

  // Dinheiro que já é da empresa mas ainda não chegou ao banco.
  const transito = {
    contas: contasTransito,
    inicial: sum(contasTransito, (c) => c.inicial),
    final: sum(contasTransito, (c) => c.final),
    entradas: sum(contasTransito, (c) => c.entradas),
    saidas: sum(contasTransito, (c) => c.saidas),
  };
  transito.variacao = round2(transito.final - transito.inicial);

  // ------------------------------------------------------- resultado -------
  const operacionais = doMes.filter((l) =>
    ehResultado(l.categoria) && !ehRepasse(l) && !emTransito(l));
  const receitasL = operacionais.filter((l) => natureza(l.categoria) === 'receita');
  const despesasL = operacionais.filter((l) => natureza(l.categoria) === 'despesa');

  const receitas = sum(receitasL, (l) => Math.abs(l.valor));
  // Taxas de cartão/gateway ficam embutidas no valor líquido; somamos à parte
  // para que a receita apareça bruta e a taxa como custo real.
  const taxasEmbutidas = sum(doMes.filter((l) => reconhece(l.conta_id)), (l) => Number(l.taxa) || 0);
  const receitaBruta = round2(receitas + taxasEmbutidas);
  const despesas = round2(sum(despesasL, (l) => Math.abs(l.valor)) + taxasEmbutidas);
  const resultadoOperacional = round2(receitaBruta - despesas);

  // ------------------------------------------------------ por categoria ----
  const catMap = new Map();
  const somaCat = (catId, valor, extra = 0) => {
    if (!catMap.has(catId)) {
      catMap.set(catId, {
        id: catId, nome: nomeCat(catId), grupo: grupoCat(catId),
        natureza: natureza(catId), total: 0, qtd: 0,
      });
    }
    const e = catMap.get(catId);
    e.total = round2(e.total + Math.abs(valor) + extra);
    e.qtd++;
  };
  for (const l of operacionais) somaCat(l.categoria, l.valor);
  if (taxasEmbutidas > 0) {
    catMap.set('des_taxas_gateway', {
      id: 'des_taxas_gateway', nome: nomeCat('des_taxas_gateway'), grupo: 'Custos',
      natureza: 'despesa',
      total: round2((catMap.get('des_taxas_gateway')?.total || 0) + taxasEmbutidas),
      qtd: (catMap.get('des_taxas_gateway')?.qtd || 0) + doMes.filter((l) => Number(l.taxa) > 0).length,
    });
    // Receita bruta: devolve a taxa retida ao valor da venda.
    const rv = catMap.get('rec_vendas');
    if (rv) rv.total = round2(rv.total + taxasEmbutidas);
  }

  const categorias = [...catMap.values()].sort((a, b) => b.total - a.total);
  const despesasPorCategoria = categorias.filter((c) => c.natureza === 'despesa');
  const receitasPorCategoria = categorias.filter((c) => c.natureza === 'receita');
  for (const c of despesasPorCategoria) c.pct = despesas ? round2((c.total / despesas) * 100) : 0;
  for (const c of receitasPorCategoria) c.pct = receitaBruta ? round2((c.total / receitaBruta) * 100) : 0;

  const grupos = [...groupBy(despesasPorCategoria, (c) => c.grupo)].map(([nome, itens]) => ({
    nome, total: sum(itens, (i) => i.total), itens,
    pct: despesas ? round2((sum(itens, (i) => i.total) / despesas) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // ------------------------------------------------------------ holding ----
  const holding = calcularHolding(competencia, lancamentos);

  // ------------------------------------------------- não operacionais ------
  const somaNat = (nat) =>
    sum(doMes.filter((l) => natureza(l.categoria) === nat && !ehRepasse(l) && !emTransito(l)), (l) => l.valor);
  const naoOperacional = {
    transferencias: round2(somaNat('transferencia') + repasses.total),
    investimentos: somaNat('investimento'),
    emprestimos: somaNat('emprestimo'),
    holding: holding.movimentoLiquido,
    semCategoria: sum(doMes.filter((l) => !l.categoria), (l) => l.valor),
  };

  // ------------------------------------------------------------- ponte ----
  // Explica, linha a linha, por que o lucro difere do dinheiro que sobrou.
  // A ponte explica a variação do CAIXA, então só o que passou por conta de
  // caixa entra nela. O que entrou no gateway e ainda não foi sacado aparece
  // à parte, como dinheiro em trânsito.
  const soCaixa = (l) => noCaixa(l.conta_id);

  /**
   * Cada lançamento de caixa cai em um balde, e em um só. É isso que faz a
   * ponte fechar sempre: a soma dos baldes é, por construção, a variação do
   * caixa. Quando um lançamento não se encaixava em nenhum — categoria
   * própria, categoria apagada, crédito em conta que não reconhece receita —
   * o dinheiro sumia da explicação e virava "diferença não explicada".
   */
  const baldeDe = (l) => {
    if (ehRepasse(l)) return 'repasses';
    const nat = natureza(l.categoria);
    if (!nat) return 'semCategoria';                 // sem categoria ou categoria removida
    if (nat === 'investimento') return 'aplicacoes'; // não sai do caixa
    if (nat === 'holding') return 'holding';
    if (nat === 'emprestimo') return 'emprestimos';
    if (nat === 'transferencia') return 'transferencias';
    if (emTransito(l)) return 'naoReceita';          // entrou, mas a conta não reconhece receita
    return 'operacional';
  };

  const baldes = {
    operacional: [], holding: [], emprestimos: [], transferencias: [],
    repasses: [], semCategoria: [], naoReceita: [], aplicacoes: [],
  };
  for (const l of doMes) {
    if (!soCaixa(l)) continue;
    baldes[baldeDe(l)].push(l);
  }
  const totalBalde = (nome) => sum(baldes[nome], (l) => l.valor);

  const operacionalCaixa = totalBalde('operacional');
  const holdingCaixa = totalBalde('holding');
  const emprestimosCaixa = totalBalde('emprestimos');
  const transferenciasCaixa = totalBalde('transferencias');
  const repassesCaixa = totalBalde('repasses');
  const semCategoriaCaixa = totalBalde('semCategoria');
  const naoReceitaCaixa = totalBalde('naoReceita');

  // Diferença entre o resultado do mês e a parte dele que passou pelo banco:
  // taxa descontada na origem, custo pago dentro do gateway, venda que ficou
  // no marketplace. Uma linha só, para a conta continuar de pé.
  const foraDoCaixa = round2(operacionalCaixa - resultadoOperacional);

  const ponte = [
    { rotulo: 'Resultado operacional do mês', valor: resultadoOperacional, destaque: true },
    { rotulo: 'Parte que não passou pelo banco', valor: foraDoCaixa,
      nota: 'taxa descontada na origem, venda que ficou no gateway',
      oculto: Math.abs(foraDoCaixa) < 0.005 },
    { rotulo: 'Holding (sócios)', valor: holdingCaixa, qtd: baldes.holding.length },
    { rotulo: 'Empréstimos', valor: emprestimosCaixa, qtd: baldes.emprestimos.length, oculto: emprestimosCaixa === 0 },
    { rotulo: 'Transferências entre contas', valor: transferenciasCaixa, qtd: baldes.transferencias.length,
      oculto: transferenciasCaixa === 0 && !baldes.transferencias.length },
    { rotulo: 'Recebido dos gateways', valor: repassesCaixa,
      oculto: repassesCaixa === 0,
      nota: 'venda já contada quando caiu na conta do gateway' },
    { rotulo: 'Entrou sem ser receita', valor: naoReceitaCaixa,
      oculto: naoReceitaCaixa === 0, qtd: baldes.naoReceita.length,
      nota: 'conta marcada como passagem: a venda é contada quando sai dela' },
    { rotulo: 'Sem categoria', valor: semCategoriaCaixa, alerta: semCategoriaCaixa !== 0,
      oculto: semCategoriaCaixa === 0, qtd: baldes.semCategoria.length,
      nota: 'inclui lançamento em categoria que foi apagada' },
  ].filter((x) => !x.oculto);

  const variacaoExplicada = round2(
    operacionalCaixa + holdingCaixa + emprestimosCaixa +
    transferenciasCaixa + repassesCaixa + semCategoriaCaixa + naoReceitaCaixa
  );
  ponte.push({ rotulo: 'Variação de caixa explicada', valor: variacaoExplicada, total: true });
  const residuo = round2(caixa.variacao - variacaoExplicada);

  // Os lançamentos por trás de cada linha, para conferir quando algo
  // surpreender — em especial "sem categoria" e "entrou sem ser receita".
  const ponteItens = {
    semCategoria: baldes.semCategoria,
    naoReceita: baldes.naoReceita,
    holding: baldes.holding,
    emprestimos: baldes.emprestimos,
    transferencias: baldes.transferencias,
  };

  // ------------------------------------------------------- faturamento ----
  const vendasMes = vendas.filter((v) => competenciaOf(v.data) === competencia && !v.cancelado);
  const faturamento = {
    qtd: vendasMes.length,
    total: sum(vendasMes, (v) => v.total),
    ticketMedio: vendasMes.length ? round2(sum(vendasMes, (v) => v.total) / vendasMes.length) : 0,
    canais: [...groupBy(vendasMes, (v) => v.canal || 'Não informado')]
      .map(([nome, itens]) => ({ nome, qtd: itens.length, total: sum(itens, (v) => v.total) }))
      .sort((a, b) => b.total - a.total),
    cancelados: sum(vendas.filter((v) => competenciaOf(v.data) === competencia && v.cancelado), (v) => v.total),
  };
  // Taxa que o gateway retém antes de repassar: nunca passa pela conta, então
  // não aparece como despesa. A porcentagem é sobre o valor bruto dessas
  // mesmas linhas — comparar com o vendido do mês enganaria, porque o extrato
  // da Vindi lista parcelas que ainda vão ser liberadas.
  const comTaxa = doMes.filter((l) => Number(l.taxa) > 0);
  const brutoComTaxa = sum(comTaxa, (l) => Math.abs(Number(l.valor_bruto) || l.valor));
  faturamento.taxasRetidas = round2(sum(comTaxa, (l) => Number(l.taxa) || 0));
  faturamento.pctTaxas = brutoComTaxa
    ? round2((faturamento.taxasRetidas / brutoComTaxa) * 100) : 0;
  faturamento.recebidoNoCaixa = receitaBruta;
  faturamento.diferenca = round2(receitaBruta - faturamento.total);

  // ---------------------------------------------------------- alertas -----
  const alertas = [];
  const semCat = doMes.filter((l) => !l.categoria && !ehRepasse(l));
  if (transito.final || transito.variacao) {
    // O extrato da Vindi lista todas as parcelas de uma venda de uma vez, com
    // a mesma data. O "saldo" do gateway é, portanto, uma agenda de
    // recebíveis: dinheiro que vai ficando disponível mês a mês, e não
    // dinheiro parado esperando saque.
    alertas.push({
      nivel: 'info',
      texto: `${fmt(transito.final)} a receber dos gateways — em boa parte parcelas de cartão que ` +
        'vão sendo liberadas nos próximos meses. Não entra no caixa nem no resultado: ' +
        'cada parcela vira receita quando cai no banco.',
      acao: 'conciliar',
    });
  }
  if (repasses.total) {
    alertas.push({
      nivel: 'info',
      texto: `${repasses.ids.size} recebimento(s) no banco, somando ${fmt(repasses.total)}, são repasses de gateway/marketplace. Como a conta do gateway também foi importada, essas vendas já estão contadas lá — aqui entram como transferência, para não dobrar a receita.`,
      acao: 'revisar',
    });
  }
  if (semCat.length) {
    alertas.push({
      nivel: 'atencao',
      texto: `${semCat.length} lançamento(s) sem categoria, somando ${fmt(sum(semCat, (l) => Math.abs(l.valor)))}. Enquanto não forem classificados, o resultado do mês está incompleto.`,
      acao: 'revisar',
    });
  }
  const baixaConfianca = doMes.filter((l) => l.categoria && l.confianca === 'baixa' && !l.travado);
  if (baixaConfianca.length) {
    alertas.push({
      nivel: 'info',
      texto: `${baixaConfianca.length} lançamento(s) foram classificados por palpite e merecem uma conferência rápida.`,
      acao: 'revisar',
    });
  }
  const gatewaysQueContam = ativos.filter(
    (c) => (c.tipo === 'gateway' || c.tipo === 'marketplace') && reconhece(c.id)
  );
  if (gatewaysQueContam.length) {
    const semPar = doMes.filter(
      (l) => l.possivel_transferencia && !l.transfer_id && !ehRepasse(l) && l.valor > 0 && noCaixa(l.conta_id)
    );
    if (semPar.length) {
      alertas.push({
        nivel: 'atencao',
        texto: `${semPar.length} recebimento(s) no banco parecem repasse de gateway, mas não achei o outro lado. Como ${gatewaysQueContam.map((c) => c.nome).join(' e ')} está configurado para reconhecer receita, existe risco de contar a mesma venda duas vezes.`,
        acao: 'importar',
      });
    }
  }
  for (const c of porConta) {
    if (c.diferenca != null && Math.abs(c.diferenca) >= 0.01) {
      alertas.push({
        nivel: 'erro',
        texto: `${c.nome}: o saldo calculado (${fmt(c.final)}) não bate com o saldo informado do banco (${fmt(c.saldoBanco)}). Diferença de ${fmt(c.diferenca)}.`,
        acao: 'conciliar',
      });
    }
  }
  if (Math.abs(residuo) >= 0.01) {
    alertas.push({
      nivel: 'erro',
      texto: `Diferença de ${fmt(residuo)} entre a variação de caixa e a soma das explicações. Normalmente é lançamento sem categoria ou transferência só de um lado.`,
      acao: 'revisar',
    });
  }

  return {
    competencia,
    rotulo: labelCompetencia(competencia),
    porConta, caixa, transito,
    resultado: {
      receitas: receitaBruta,
      despesas,
      resultadoOperacional,
      margem: receitaBruta ? round2((resultadoOperacional / receitaBruta) * 100) : 0,
      taxasEmbutidas,
    },
    categorias, receitasPorCategoria, despesasPorCategoria, grupos,
    holding, naoOperacional, ponte, ponteItens, residuo, faturamento, alertas, repasses,
    contagem: {
      lancamentos: doMes.length,
      semCategoria: semCat.length,
      pendentes: semCat.length + baixaConfianca.length,
      conciliados: doMes.filter((l) => l.conciliado).length,
    },
  };
}

/**
 * Recebimentos no banco que são apenas repasse de uma conta de gateway
 * já importada. Só valem como transferência se a conta do gateway tiver
 * movimento no mesmo mês — se ele não importou o gateway, o dinheiro que
 * chega no banco É a receita e continua contando como tal.
 *
 * @returns {{ids:Set<string>, total:number, contas:string[]}}
 */
export function identificarRepasses(doMes, contas, reconhece = () => true) {
  // Só conta como repasse quando o gateway de fato reconhece a venda; se ele
  // é tratado como passagem, a receita é reconhecida aqui, no banco.
  const repasse = new Set(
    contas.filter((c) => (c.tipo === 'gateway' || c.tipo === 'marketplace') && reconhece(c.id)).map((c) => c.id)
  );
  const comMovimento = [...new Set(doMes.filter((l) => repasse.has(l.conta_id)).map((l) => l.conta_id))];
  if (!comMovimento.length) return { ids: new Set(), total: 0, contas: [] };

  const ids = new Set();
  let total = 0;
  for (const l of doMes) {
    if (repasse.has(l.conta_id)) continue;          // só o lado do banco
    if (l.valor <= 0) continue;
    if (l.transfer_id) continue;                     // já pareado de verdade
    if (l.travado) continue;                         // ele decidiu à mão
    if (!l.possivel_transferencia) continue;
    ids.add(l.id);
    total = round2(total + l.valor);
  }
  return { ids, total, contas: comMovimento };
}

/**
 * Conta corrente com a holding / sócios.
 *
 * Regra: dinheiro que a empresa gastou com coisas dos sócios aumenta o que a
 * holding deve à empresa. Dinheiro que os sócios colocaram na empresa reduz.
 * O saldo é acumulado desde o início — é uma conta corrente, não um resultado.
 */
export function calcularHolding(competencia, lancamentos) {
  const eh = (l) => natureza(l.categoria) === 'holding';
  const ateAgora = lancamentos.filter((l) => eh(l) && l.competencia <= competencia);
  const doMes = lancamentos.filter((l) => eh(l) && l.competencia === competencia);

  // Saída de caixa da empresa por conta dos sócios => holding fica devendo.
  const pagoPelaEmpresa = sum(doMes.filter((l) => l.valor < 0), (l) => Math.abs(l.valor));
  const aportado = sum(doMes.filter((l) => l.valor > 0), (l) => l.valor);
  const movimentoLiquido = sum(doMes, (l) => l.valor);

  const saldoAcumulado = round2(
    sum(ateAgora.filter((l) => l.valor < 0), (l) => Math.abs(l.valor)) -
    sum(ateAgora.filter((l) => l.valor > 0), (l) => l.valor)
  );

  // Quebra por destino: para onde foi / de onde veio. Só serve para enxergar
  // e lançar no financeiro de cada lugar — não muda nada no resultado.
  const SEM = 'Sem destino';
  const porDestino = [];
  const indice = new Map();
  const pega = (nome) => {
    if (!indice.has(nome)) {
      const linha = { destino: nome, pago: 0, aportado: 0, liquidoMes: 0, saldoAcumulado: 0, qtd: 0 };
      indice.set(nome, linha);
      porDestino.push(linha);
    }
    return indice.get(nome);
  };
  for (const l of ateAgora) {
    const linha = pega(l.destino_holding || SEM);
    linha.saldoAcumulado = round2(linha.saldoAcumulado - l.valor);
  }
  for (const l of doMes) {
    const linha = pega(l.destino_holding || SEM);
    linha.qtd++;
    linha.liquidoMes = round2(linha.liquidoMes + l.valor);
    if (l.valor < 0) linha.pago = round2(linha.pago + Math.abs(l.valor));
    else linha.aportado = round2(linha.aportado + l.valor);
  }
  porDestino.sort((a, b) =>
    Math.abs(b.saldoAcumulado) - Math.abs(a.saldoAcumulado) || a.destino.localeCompare(b.destino));

  return {
    pagoPelaEmpresa,
    aportado,
    movimentoLiquido,
    saldoAcumulado,
    porDestino,
    semDestino: doMes.filter((l) => !l.destino_holding).length,
    devedor: saldoAcumulado >= 0 ? 'holding' : 'empresa',
    interpretacao: saldoAcumulado > 0
      ? `A holding/sócios devem ${fmt(saldoAcumulado)} à Móvel5.`
      : saldoAcumulado < 0
        ? `A Móvel5 deve ${fmt(Math.abs(saldoAcumulado))} à holding/sócios.`
        : 'Contas acertadas com a holding.',
    lancamentosMes: doMes,
  };
}

/**
 * Posição de hoje, somando tudo desde o começo — não só o mês em foco.
 *
 * É a resposta para "quanto a Móvel5 tem, de verdade": o dinheiro nas contas
 * (banco, caixa e o que está aplicado no RDC) mais o que está com a holding,
 * porque esse dinheiro é da empresa e volta quando ela precisar.
 *
 * O que está nos gateways aparece à parte: é dinheiro que vira caixa quando
 * for sacado, e depende do extrato do gateway estar em dia.
 */
export function posicaoAtual(dados) {
  const { lancamentos = [], contas = [] } = dados;
  registrarCategorias(dados.categorias);

  const ativos = contas.filter((c) => c.ativo !== 0);
  const entraNoCaixa = (c) => c.entra_no_caixa ?? (c.tipo === 'banco' || c.tipo === 'caixa');

  const porConta = ativos.map((c) => {
    const ls = lancamentos.filter((l) => l.conta_id === c.id && !ehAplicacao(l));
    return {
      contaId: c.id, nome: c.nome, cor: c.cor, tipo: c.tipo,
      saldo: round2(Number(c.saldo_inicial || 0) + sum(ls, (l) => l.valor)),
      noCaixa: entraNoCaixa(c),
      movimentos: ls.length,
    };
  });

  const emContas = sum(porConta.filter((c) => c.noCaixa), (c) => c.saldo);
  const emGateways = sum(porConta.filter((c) => !c.noCaixa), (c) => c.saldo);

  // Quanto está aplicado no RDC, dentro do "emContas".
  const aplicado = round2(-sum(
    lancamentos.filter((l) => ehAplicacao(l) && entraNoCaixaId(l.conta_id, ativos)),
    (l) => l.valor
  ));

  const ultima = lancamentos.reduce((a, l) => (l.competencia > a ? l.competencia : a), '');
  const holding = calcularHolding(ultima || competenciaOf(new Date().toISOString()), lancamentos);

  return {
    emContas,
    emGateways,
    aplicado,
    holding: holding.saldoAcumulado,
    holdingPorDestino: holding.porDestino,
    // O que a empresa teria em caixa se chamasse de volta o que está com a
    // holding. Saldo negativo com a holding entra como dívida, reduzindo.
    operacional: round2(emContas + holding.saldoAcumulado),
    porConta,
    ate: ultima || null,
  };
}

const entraNoCaixaId = (contaId, contas) => {
  const c = contas.find((x) => x.id === contaId);
  if (!c) return true;
  return c.entra_no_caixa ?? (c.tipo === 'banco' || c.tipo === 'caixa');
};

/**
 * Série histórica para os gráficos e comparações.
 * @returns {Array} uma entrada por competência, da mais antiga para a mais nova
 */
export function serieHistorica(dados, { ate, meses = 12 } = {}) {
  const { lancamentos = [] } = dados;
  const comps = [...new Set(lancamentos.map((l) => l.competencia).filter(Boolean))].sort();
  if (!comps.length) return [];
  const fim = ate || comps[comps.length - 1];

  const lista = [];
  let c = fim;
  for (let i = 0; i < meses; i++) { lista.unshift(c); c = prevCompetencia(c); }

  return lista
    .filter((comp) => comp >= comps[0])
    .map((comp) => {
      const a = apurar(comp, dados);
      return {
        competencia: comp,
        rotulo: labelCompetencia(comp),
        receitas: a.resultado.receitas,
        despesas: a.resultado.despesas,
        resultado: a.resultado.resultadoOperacional,
        margem: a.resultado.margem,
        caixaFinal: a.caixa.final,
        entradas: a.caixa.entradas,
        saidas: Math.abs(a.caixa.saidas),
        holding: a.holding.saldoAcumulado,
        faturamento: a.faturamento.total,
        lancamentos: a.contagem.lancamentos,
      };
    });
}

/** Compara duas competências categoria a categoria. */
export function comparar(compA, compB, dados) {
  const a = apurar(compA, dados);
  const b = apurar(compB, dados);
  const ids = new Set([...a.categorias.map((c) => c.id), ...b.categorias.map((c) => c.id)]);
  const linhas = [...ids].map((id) => {
    const va = a.categorias.find((c) => c.id === id)?.total || 0;
    const vb = b.categorias.find((c) => c.id === id)?.total || 0;
    return {
      id, nome: nomeCat(id), grupo: grupoCat(id), natureza: natureza(id),
      anterior: va, atual: vb, delta: round2(vb - va),
      deltaPct: va ? round2(((vb - va) / va) * 100) : null,
    };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { a, b, linhas };
}

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
