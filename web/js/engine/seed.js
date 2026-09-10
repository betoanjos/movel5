// Plano de contas e regras iniciais.
// As regras foram derivadas dos arquivos reais de agosto/2026 (Sicoob, Vindi, Bling).

/**
 * natureza:
 *  - 'receita'        entra e é resultado da empresa
 *  - 'despesa'        sai e é resultado da empresa
 *  - 'transferencia'  move dinheiro entre contas próprias — NÃO é resultado
 *  - 'holding'        dinheiro dos sócios / pessoa física — NÃO é resultado da empresa,
 *                     vira saldo na conta corrente com a holding
 *  - 'investimento'   aplicação/resgate — NÃO é resultado
 *  - 'emprestimo'     entrada/saída de principal de empréstimo — NÃO é resultado
 *                     (só os juros são despesa)
 */
export const CATEGORIAS = [
  // ---------- RECEITAS ----------
  { id: 'rec_vendas',        nome: 'Vendas',                    grupo: 'Receitas',            natureza: 'receita' },
  { id: 'rec_frete',         nome: 'Frete cobrado do cliente',  grupo: 'Receitas',            natureza: 'receita' },
  { id: 'rec_servicos',      nome: 'Serviços / montagem',       grupo: 'Receitas',            natureza: 'receita' },
  { id: 'rec_juros',         nome: 'Rendimentos financeiros',   grupo: 'Receitas',            natureza: 'receita' },
  { id: 'rec_outras',        nome: 'Outras receitas',           grupo: 'Receitas',            natureza: 'receita' },

  // ---------- CUSTO / FORNECEDORES ----------
  { id: 'des_fornecedores',  nome: 'Fornecedores / matéria-prima', grupo: 'Custos',           natureza: 'despesa' },
  { id: 'des_frete_saida',   nome: 'Fretes e transportadoras',  grupo: 'Custos',              natureza: 'despesa' },
  { id: 'des_comissoes',     nome: 'Comissões e marketplaces',  grupo: 'Custos',              natureza: 'despesa' },
  { id: 'des_taxas_gateway', nome: 'Taxas de cartão / gateway', grupo: 'Custos',              natureza: 'despesa' },
  { id: 'des_embalagem',     nome: 'Embalagens',                grupo: 'Custos',              natureza: 'despesa' },

  // ---------- PESSOAS ----------
  { id: 'des_salarios',      nome: 'Salários e ordenados',      grupo: 'Pessoal',             natureza: 'despesa' },
  { id: 'des_prolabore',     nome: 'Pró-labore',                grupo: 'Pessoal',             natureza: 'despesa' },
  { id: 'des_encargos',      nome: 'Encargos (FGTS/INSS)',      grupo: 'Pessoal',             natureza: 'despesa' },
  { id: 'des_beneficios',    nome: 'Benefícios',                grupo: 'Pessoal',             natureza: 'despesa' },
  { id: 'des_terceiros',     nome: 'Serviços de terceiros',     grupo: 'Pessoal',             natureza: 'despesa' },

  // ---------- OCUPAÇÃO / ESTRUTURA ----------
  { id: 'des_aluguel',       nome: 'Aluguel',                   grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_energia',       nome: 'Energia elétrica',          grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_agua',          nome: 'Água',                      grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_telefone',      nome: 'Telefone e internet',       grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_manutencao',    nome: 'Manutenção e reparos',      grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_combustivel',   nome: 'Combustível e veículos',    grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_software',      nome: 'Software e assinaturas',    grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_marketing',     nome: 'Marketing e anúncios',      grupo: 'Estrutura',           natureza: 'despesa' },
  { id: 'des_contabilidade', nome: 'Contabilidade e jurídico',  grupo: 'Estrutura',           natureza: 'despesa' },

  // ---------- IMPOSTOS ----------
  { id: 'des_simples',       nome: 'Simples Nacional / DAS',    grupo: 'Impostos',            natureza: 'despesa' },
  { id: 'des_icms',          nome: 'ICMS',                      grupo: 'Impostos',            natureza: 'despesa' },
  { id: 'des_fed',           nome: 'Tributos federais (DARF)',  grupo: 'Impostos',            natureza: 'despesa' },
  { id: 'des_municipais',    nome: 'Tributos municipais',       grupo: 'Impostos',            natureza: 'despesa' },
  { id: 'des_parcelamentos', nome: 'Parcelamentos de tributos', grupo: 'Impostos',            natureza: 'despesa' },

  // ---------- FINANCEIRO ----------
  { id: 'des_tarifas',       nome: 'Tarifas bancárias',         grupo: 'Financeiro',          natureza: 'despesa' },
  { id: 'des_juros',         nome: 'Juros e multas',            grupo: 'Financeiro',          natureza: 'despesa' },
  { id: 'des_iof',           nome: 'IOF',                       grupo: 'Financeiro',          natureza: 'despesa' },
  { id: 'des_outras',        nome: 'Outras despesas',           grupo: 'Financeiro',          natureza: 'despesa' },

  // ---------- NÃO ENTRAM NO RESULTADO ----------
  { id: 'trf_interna',       nome: 'Transferência entre contas', grupo: 'Não operacional',    natureza: 'transferencia' },
  { id: 'inv_aplicacao',     nome: 'Aplicação / resgate (RDC)',  grupo: 'Não operacional',    natureza: 'investimento' },
  { id: 'emp_entrada',       nome: 'Empréstimo recebido',        grupo: 'Não operacional',    natureza: 'emprestimo' },
  { id: 'emp_amortizacao',   nome: 'Amortização de empréstimo',  grupo: 'Não operacional',    natureza: 'emprestimo' },
  { id: 'mkt_estorno',       nome: 'Ajuste do marketplace (estorno, tarifa)', grupo: 'Não operacional', natureza: 'transferencia' },
  { id: 'hold_saida',        nome: 'Holding — pago pela empresa', grupo: 'Holding',           natureza: 'holding' },
  { id: 'hold_entrada',      nome: 'Holding — aporte na empresa', grupo: 'Holding',           natureza: 'holding' },
];

export const CATEGORIA_POR_ID = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));

/** Categorias que NÃO afetam o resultado operacional da empresa. */
export const NAO_OPERACIONAIS = new Set(
  CATEGORIAS.filter((c) => c.natureza !== 'receita' && c.natureza !== 'despesa').map((c) => c.id)
);

/**
 * Regras automáticas. Avaliadas em ordem de `prioridade` (maior primeiro).
 * `quando` casa contra o texto normalizado de descrição + contraparte + documento.
 * `sinal`: 'D' só débitos, 'C' só créditos, null qualquer um.
 */
export const REGRAS_PADRAO = [
  // --- Investimento / aplicação (crítico: senão vira "receita" inflada) ---
  { padrao: 'RESGATE RDC',              categoria: 'inv_aplicacao',     sinal: null, prioridade: 100 },
  { padrao: 'RDC AUTOMATICO',           categoria: 'inv_aplicacao',     sinal: null, prioridade: 100 },
  { padrao: 'APLICACAO AUTOMATICA',     categoria: 'inv_aplicacao',     sinal: null, prioridade: 100 },

  // --- Repasses dos gateways ---
  // IMPORTANTE: nunca marcamos transferência só pelo texto. Se o extrato do
  // gateway não for importado, este crédito É a receita da venda chegando no
  // banco — classificá-lo como transferência zeraria o faturamento.
  // Marcamos como venda e sinalizamos `possivelTransferencia`: quando o outro
  // lado for importado, o pareador reclassifica os dois como transferência.
  { padrao: 'PAGCERTO',                 categoria: 'rec_vendas',        sinal: 'C',  prioridade: 95, possivelTransferencia: true },
  { padrao: 'YAPAY',                    categoria: 'rec_vendas',        sinal: 'C',  prioridade: 95, possivelTransferencia: true },
  { padrao: 'VINDI',                    categoria: 'rec_vendas',        sinal: 'C',  prioridade: 95, possivelTransferencia: true },
  { padrao: 'MERCADO PAGO',             categoria: 'rec_vendas',        sinal: 'C',  prioridade: 94, possivelTransferencia: true },
  { padrao: 'MERCADOPAGO',              categoria: 'rec_vendas',        sinal: 'C',  prioridade: 94, possivelTransferencia: true },
  { padrao: 'MAGALUPAY',                categoria: 'rec_vendas',        sinal: 'C',  prioridade: 94, possivelTransferencia: true },
  { padrao: 'MAGAZINE LUIZA',           categoria: 'rec_vendas',        sinal: 'C',  prioridade: 94, possivelTransferencia: true },
  { padrao: 'PAGAR ME',                 categoria: 'rec_vendas',        sinal: 'C',  prioridade: 94, possivelTransferencia: true },

  // --- Impostos ---
  { padrao: 'SIMPLES NACIONAL',         categoria: 'des_simples',       sinal: 'D',  prioridade: 90 },
  { padrao: 'DAS ',                     categoria: 'des_simples',       sinal: 'D',  prioridade: 88 },
  { padrao: 'ICMS',                     categoria: 'des_icms',          sinal: 'D',  prioridade: 90 },
  { padrao: 'DIVIDA ATIVA',             categoria: 'des_parcelamentos', sinal: 'D',  prioridade: 92 },
  { padrao: 'PAGAMENTO PARCELADO',      categoria: 'des_parcelamentos', sinal: 'D',  prioridade: 91 },
  { padrao: 'TRIBUTOS FEDERAIS',        categoria: 'des_fed',           sinal: 'D',  prioridade: 90 },
  { padrao: 'DARF',                     categoria: 'des_fed',           sinal: 'D',  prioridade: 90 },
  { padrao: 'RFB',                      categoria: 'des_fed',           sinal: 'D',  prioridade: 89 },
  { padrao: 'FGTS',                     categoria: 'des_encargos',      sinal: 'D',  prioridade: 90 },
  { padrao: 'INSS',                     categoria: 'des_encargos',      sinal: 'D',  prioridade: 90 },
  { padrao: 'GPS ',                     categoria: 'des_encargos',      sinal: 'D',  prioridade: 88 },
  { padrao: 'ISS',                      categoria: 'des_municipais',    sinal: 'D',  prioridade: 85 },
  { padrao: 'IPTU',                     categoria: 'des_municipais',    sinal: 'D',  prioridade: 88 },

  // --- Estrutura (convênios do Sicoob) ---
  { padrao: 'EN ELETRICA E GAS',        categoria: 'des_energia',       sinal: 'D',  prioridade: 90 },
  { padrao: 'ENERGIA',                  categoria: 'des_energia',       sinal: 'D',  prioridade: 80 },
  { padrao: 'CELESC',                   categoria: 'des_energia',       sinal: 'D',  prioridade: 88 },
  { padrao: 'COPEL',                    categoria: 'des_energia',       sinal: 'D',  prioridade: 88 },
  { padrao: 'TELECOMUNICACOES',         categoria: 'des_telefone',      sinal: 'D',  prioridade: 90 },
  { padrao: 'VIVO',                     categoria: 'des_telefone',      sinal: 'D',  prioridade: 85 },
  { padrao: 'CLARO',                    categoria: 'des_telefone',      sinal: 'D',  prioridade: 85 },
  { padrao: 'TIM ',                     categoria: 'des_telefone',      sinal: 'D',  prioridade: 84 },
  { padrao: 'OI ',                      categoria: 'des_telefone',      sinal: 'D',  prioridade: 82 },
  { padrao: 'SANEAMENTO',               categoria: 'des_agua',          sinal: 'D',  prioridade: 85 },
  { padrao: 'CASAN',                    categoria: 'des_agua',          sinal: 'D',  prioridade: 88 },
  { padrao: 'SANEPAR',                  categoria: 'des_agua',          sinal: 'D',  prioridade: 88 },
  { padrao: 'SAMAE',                    categoria: 'des_agua',          sinal: 'D',  prioridade: 88 },

  // --- Financeiro ---
  { padrao: 'DEB IOF',                  categoria: 'des_iof',           sinal: 'D',  prioridade: 95 },
  { padrao: 'IOF',                      categoria: 'des_iof',           sinal: 'D',  prioridade: 85 },
  { padrao: 'TARIFA',                   categoria: 'des_tarifas',       sinal: 'D',  prioridade: 90 },
  { padrao: 'PACOTE SERVICOS',          categoria: 'des_tarifas',       sinal: 'D',  prioridade: 92 },
  { padrao: 'CESTA DE SERVICOS',        categoria: 'des_tarifas',       sinal: 'D',  prioridade: 92 },
  { padrao: 'JUROS CONTA GARANTIDA',    categoria: 'des_juros',         sinal: 'D',  prioridade: 95 },
  { padrao: 'JUROS',                    categoria: 'des_juros',         sinal: 'D',  prioridade: 80 },
  { padrao: 'DEB EMPRESTIMO',           categoria: 'emp_amortizacao',   sinal: 'D',  prioridade: 95 },
  { padrao: 'EMPRESTIMO',               categoria: 'emp_amortizacao',   sinal: 'D',  prioridade: 85 },

  // --- Fornecedores conhecidos (vindos das NFs de entrada do Bling) ---
  { padrao: 'MEYER MOVEIS',             categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 92 },
  { padrao: 'RIOGRAN ESPUMAS',          categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 92 },
  { padrao: 'MUNHOZ ACESSORIOS',        categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 92 },
  { padrao: 'WOOD CHAIRS',              categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 92 },
  { padrao: 'BAIL COMERCIO DE FERRAGENS', categoria: 'des_fornecedores', sinal: 'D', prioridade: 92 },
  { padrao: 'MOVEIS SEIVA',             categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 92 },
  { padrao: 'ORION COMERCIO DE CAIXAS', categoria: 'des_embalagem',     sinal: 'D',  prioridade: 92 },
  { padrao: 'AZURELOG',                 categoria: 'des_frete_saida',   sinal: null, prioridade: 90 },
  { padrao: 'TRANSPORTES',              categoria: 'des_frete_saida',   sinal: 'D',  prioridade: 75 },
  { padrao: 'TRANSPORTADORA',           categoria: 'des_frete_saida',   sinal: 'D',  prioridade: 78 },
  { padrao: 'LOGISTICA',                categoria: 'des_frete_saida',   sinal: 'D',  prioridade: 74 },

  // --- Boletos e títulos: quase sempre fornecedor, mas confirmar ---
  { padrao: 'DEB TIT COMPE',            categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 30, confianca: 'baixa' },
  { padrao: 'DEB TITULO COBRANCA',      categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 30, confianca: 'baixa' },
  { padrao: 'DEB TIT COBRANCA',         categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 30, confianca: 'baixa' },
  { padrao: 'PAGAMENTO DE BOLETO',      categoria: 'des_fornecedores',  sinal: 'D',  prioridade: 28, confianca: 'baixa' },

  // --- Recebimentos genéricos ---
  { padrao: 'CRED LIQUIDACAO COBRANCA', categoria: 'rec_vendas',        sinal: 'C',  prioridade: 60, confianca: 'baixa' },
  { padrao: 'CRED TED STR',             categoria: 'rec_vendas',        sinal: 'C',  prioridade: 25, confianca: 'baixa' },
  { padrao: 'PIX RECEBIDO',             categoria: 'rec_vendas',        sinal: 'C',  prioridade: 20, confianca: 'baixa' },

  // --- Mesma titularidade: quase certamente transferência, mas só o pareador confirma ---
  { padrao: 'MESMA TIT',                categoria: null,                sinal: null, prioridade: 97, possivelTransferencia: true, confianca: 'baixa' },
  { padrao: 'SOLICITACAO DE SAQUE',     categoria: 'rec_vendas',        sinal: 'C',  prioridade: 96, possivelTransferencia: true },
  { padrao: 'TRANSF CONTAS DIF TITULARIDADE', categoria: 'hold_saida',  sinal: 'D',  prioridade: 40, confianca: 'baixa' },
  { padrao: 'TRANSF CONTAS INTERCREDIS', categoria: 'trf_interna',      sinal: null, prioridade: 60, confianca: 'baixa' },
];

/** Contas padrão sugeridas na primeira execução. */
export const CONTAS_PADRAO = [
  { nome: 'Sicoob 13.666-2',   tipo: 'banco',       saldo_inicial: 0, cor: '#3b7dd8', ativo: 1 },
  { nome: 'Mercado Pago',      tipo: 'gateway',     saldo_inicial: 0, cor: '#00b0ea', ativo: 1 },
  { nome: 'Vindi / Yapay',     tipo: 'gateway',     saldo_inicial: 0, cor: '#7b61ff', ativo: 1 },
  { nome: 'Magalu Pay',        tipo: 'marketplace', saldo_inicial: 0, cor: '#e8562f', ativo: 1 },
  { nome: 'Web Continental',   tipo: 'marketplace', saldo_inicial: 0, cor: '#f0a500', ativo: 1 },
  { nome: 'Caixa / dinheiro',  tipo: 'caixa',       saldo_inicial: 0, cor: '#6b7280', ativo: 1 },
];

/**
 * Destinos da conta com a holding: para onde o dinheiro foi, ou de onde veio,
 * quando o lançamento não é da Móvel5. Serve só para enxergar depois e lançar
 * no financeiro de cada lugar — não muda o resultado da empresa.
 * A lista é editável em Ajustes › Categorias.
 */
export const DESTINOS_HOLDING_PADRAO = [
  'AN5', 'Roberto', 'Osvaldo', 'Chácara', 'Solar', 'EV Parking',
];
