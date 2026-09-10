# O que eu encontrei nos seus arquivos de agosto/2026

Análise dos 22 arquivos que você enviou, feita com o próprio painel. Serve
para dois propósitos: mostrar o que dá para extrair automaticamente e apontar
o que merece a sua atenção.

> Os valores de resultado abaixo são **provisórios**: 34 lançamentos de agosto,
> somando R$ 44.275,09, ainda estavam sem categoria quando rodei a análise.
> Depois que você classificá-los na tela **Revisar**, o número final muda.

---

## 1. Os arquivos falam entre si melhor do que parece

O extrato do Sicoob, sozinho, é quase ilegível. De 167 lançamentos em agosto,
72 aparecem apenas como `DÉB.TIT.COMPE EFETIVADO`, `DÉB.TÍTULO COBRANÇA` ou
`PIX EMITIDO OUTRA IF` — sem dizer para quem o dinheiro foi.

Mas os outros arquivos completam a informação, e o encaixe é exato:

**Boletos.** O campo *Número do agendamento* do comprovante é o mesmo número
que aparece como documento no extrato. Não é aproximação, é o mesmo
identificador:

| No extrato | No comprovante |
|---|---|
| `31/08 · 16425806 · DÉB.TIT. COBRANÇA EFETIVADO · R$ 1.224,69` | agendamento 16425806 · **LINZ FÁBRICA DE MÓVEIS LTDA** · R$ 1.224,69 |

Os 39 comprovantes de agosto casaram com os débitos correspondentes.

**PIX.** Os relatórios de PIX pagos e recebidos trazem o nome de quem está do
outro lado, que o extrato omite. São 31 pagamentos e 30 recebimentos.

**Cadastro do Bling.** O relatório *Clientes e Fornecedor — Visão de Contatos*
é o arquivo mais útil do lote. São **172 contatos com CNPJ**: 102 fornecedores
e 70 transportadoras. Com ele, um PIX para `09.574.015/0001-38` vira
automaticamente *Linz Fábrica de Móveis*, classificado como fornecedor, sem
ninguém digitar nada.

**Resultado do cruzamento:** de 167 lançamentos, 92 ganharam nome e 132 foram
classificados sozinhos, já na primeira importação.

---

## 2. Agosto em números

Direto do extrato do Sicoob:

| | |
|---|---|
| Entradas | R$ 166.393,65 |
| Saídas | R$ 161.545,20 |
| **Sobrou no mês** | **R$ 4.848,45** |

E separando o que é resultado da empresa do que é só dinheiro andando:

| | |
|---|---|
| Receita da empresa | R$ 96.533,82 |
| Despesa da empresa | R$ 73.103,29 |
| **Resultado operacional** | **R$ 23.430,53** (margem de 24,3%) |

A diferença entre "sobrou R$ 4.848" e "lucrou R$ 23.430" é toda explicada:

| | |
|---|---|
| Resultado operacional | R$ 23.430,53 |
| Holding (gastos dos sócios pagos pela empresa) | −R$ 3.640,50 |
| Empréstimos (amortização) | −R$ 3.125,85 |
| Aplicações e resgates (RDC) | −R$ 22.084,31 |
| Transferências entre contas próprias | R$ 3.356,75 |
| Ainda sem categoria | R$ 6.911,83 |
| **Variação de caixa** | **R$ 4.848,45** |

A conta fecha com **zero de diferença**. É esse fechamento que dá confiança de
que nada foi perdido nem contado duas vezes.

**Onde o dinheiro saiu** (do que já está classificado):

| Categoria | Valor | % |
|---|---|---|
| Fornecedores e matéria-prima | R$ 66.350,04 | 91% |
| Fretes e transportadoras | R$ 4.075,40 | 6% |
| Tributos federais (DARF) | R$ 1.665,73 | 2% |
| Telefone e internet | R$ 597,12 | 1% |
| Juros e multas | R$ 172,79 | — |
| Energia elétrica | R$ 119,35 | — |
| IOF | R$ 92,56 | — |
| Tarifas bancárias | R$ 30,30 | — |

---

## 3. O achado que mais vale dinheiro: a taxa do cartão

Do extrato da Vindi de agosto, 206 parcelas liberadas:

| Forma | Parcelas | Valor bruto | Taxa | % |
|---|---|---|---|---|
| Mastercard | 95 | R$ 46.323,11 | R$ 5.691,51 | **12,29%** |
| Visa | 105 | R$ 21.068,51 | R$ 2.601,02 | **12,35%** |
| Pix | 6 | R$ 12.265,76 | R$ 63,64 | **0,52%** |
| **Total** | **206** | **R$ 79.657,38** | **R$ 8.356,17** | **10,49%** |

**O cartão custa 24 vezes mais que o Pix.** Só em agosto foram R$ 8.356 em
taxas — na casa de R$ 100 mil por ano no ritmo atual.

Essa despesa não aparece no extrato bancário: ela já vem descontada antes de o
dinheiro chegar. É por isso que ela passa despercebida hoje. No painel ela
aparece como uma categoria de custo, para você acompanhar mês a mês.

Duas coisas que valem contas:

- **Um desconto à vista no Pix** de 5% ainda deixa você melhor do que a venda
  no cartão parcelado, e o dinheiro entra na hora em vez de em 12 meses.
- **Renegociar a taxa** com a Vindi. 12,3% é alto até para parcelado longo;
  vale cotar com outro adquirente e usar a cotação como argumento.

---

## 4. Vendido não é recebido

O Bling registrou **42 pedidos** em agosto, somando **R$ 142.544,76** — ticket
médio de R$ 3.393,92. Por canal:

| Canal | Valor | % |
|---|---|---|
| Loja virtual | R$ 89.835,38 | 63% |
| Particular | R$ 40.514,11 | 28% |
| Web Continental | R$ 10.558,67 | 7% |
| Magazine Luiza | R$ 1.636,60 | 1% |

Mas entraram no caixa R$ 96.533,82 — **R$ 46 mil a menos**. Isso não é erro: é
o parcelamento. Você vende hoje em 12x e recebe ao longo de um ano.

Essa é, muito provavelmente, uma das raízes do aperto de caixa: o faturamento
cresce e o caixa não acompanha, porque cada venda vira 12 pedaços. É outro
argumento a favor de incentivar o Pix.

---

## 5. Contas a pagar

O relatório agrupado por fornecedor traz 58 títulos no período de julho e
agosto, somando R$ 29.017,16 — dos quais **2 títulos, R$ 320,00, estavam em
aberto ou atrasados**. As notas fiscais de entrada somam 328 documentos no
período.

Os fornecedores recorrentes são Meyer Móveis, Linz Fábrica de Móveis, Riogran
Espumas, Itamóveis, Móveis Seiva e Munhoz Acessórios; nos fretes aparecem
Azurelog, Aceville e Expresso Leomar.

---

## 6. Sobre a holding — e uma sugestão

Você pediu para marcar como *holding* tudo que sai da empresa mas é seu ou do
seu sócio. Em agosto isso soma **R$ 3.640,50** a favor da empresa.

**O que eu fiz, um pouco diferente do que você descreveu.** Em vez de tratar
holding como mais uma categoria de despesa, tratei como uma **conta corrente
entre as duas empresas**:

- Cada saída por conta dos sócios **aumenta** o que a holding deve.
- Cada aporte dos sócios **diminui**.
- O saldo é acumulado desde o começo, não zera a cada mês.
- Nada disso entra no resultado da empresa.

Assim você tem as duas respostas separadas, que hoje estão embaralhadas:

1. *A empresa se paga?* — o resultado operacional, limpo.
2. *Quanto uma deve à outra?* — o saldo da conta corrente.

Se holding fosse uma categoria de despesa, a empresa pareceria menos lucrativa
do que é, e você continuaria sem saber o tamanho do acerto. Do jeito atual, o
painel diz em uma frase: *"a holding/sócios devem R$ 3.640,50 à Móvel5"*.

**Uma sugestão prática:** hoje esses pagamentos saem da conta da empresa e
viram trabalho de separação todo mês. Se der para fazer uma retirada mensal
fixa para a pessoa física e pagar as coisas pessoais de lá, o problema
desaparece na origem — a conta da empresa fica limpa e o painel fica só com o
que é da empresa. Enquanto isso não acontece, a conta corrente resolve.

---

## 7. Coisas que o painel não adivinha

Três pontos onde ele precisa que você decida:

**Boletos de fornecedor.** O painel classifica todo `DÉB.TIT.COMPE` como
fornecedor, com confiança baixa, e marca para conferência. Quando o comprovante
identifica uma transportadora, ele corrige para frete. O resto você confirma
uma vez e vira regra.

**PIX para órgãos públicos.** Os pagamentos recorrentes para `82.951.310/0001-56`
(Sefaz-SC) e `00.394.460/0058-87` (arrecadação federal) aparecem repetidos.
Classifique um de cada e marque *"vale para todas as parecidas"* pelo **CNPJ** —
resolve uma dezena de linhas por mês, para sempre.

**O extrato da Vindi.** Você me disse que todo dinheiro que entra na Vindi é
transferido para o Sicoob. Por isso o painel trata a Vindi como conta de
passagem: a venda é contada quando o dinheiro chega ao banco, que é o número
que você confere no extrato. Mesmo assim vale importar o arquivo da Vindi, só
para acompanhar as taxas de cartão.

Vale registrar um detalhe: o arquivo `08 - PaymentExtract.xlsx` lista várias
parcelas do mesmo pedido com a mesma data de liberação (por exemplo as parcelas
4, 5, 7, 9 e 10 de 12, todas em 01/08). Isso sugere que ele mostra a **agenda
de recebíveis**, não o dinheiro que entrou naquele dia. É mais uma razão para
usar o extrato bancário como fonte da receita.

---

## 8. Por onde começar

1. Importe os arquivos de agosto e **classifique os 34 lançamentos pendentes**.
   Marque *"vale para todas as parecidas"* sempre que puder — o mês seguinte já
   vem quase pronto.
2. **Feche agosto**, conferindo o saldo contra o extrato.
3. Repita com julho, junho, maio… indo para trás. A cada mês o trabalho
   diminui, porque as regras já estão criadas.
4. Com três ou quatro meses lançados, os gráficos de evolução começam a
   responder o que você quer saber: se a empresa está melhorando ou piorando.
