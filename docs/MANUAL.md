# Manual do painel

Escrito para ser lido uma vez. Depois disso o painel se explica sozinho.

---

## A ideia em três frases

1. Você joga os arquivos do mês no painel.
2. Ele reconhece quase tudo e pergunta só o que não sabe.
3. Você confere o saldo contra o extrato e fecha o mês.

O que você ensinar ao painel numa vez, ele repete para sempre. Por isso o
primeiro mês dá algum trabalho e os seguintes praticamente não dão.

---

## Quais arquivos mandar

Arraste todos de uma vez. Ele identifica cada um pelo conteúdo.

### Do Sicoob

| Arquivo | Para que serve |
|---|---|
| **Extrato em OFX** | é a base de tudo: cada entrada e saída da conta |
| Extrato em PDF | serve no lugar do OFX quando você não tiver o OFX |
| Relatório de PIX pagos | dá o nome de quem recebeu cada PIX |
| Relatório de PIX recebidos | dá o nome de quem pagou |
| Comprovantes de boleto pago | dá o nome do fornecedor de cada boleto |

> Prefira sempre o **OFX**. Ele traz um identificador único por lançamento, o
> que deixa a conferência exata. Se mandar o OFX e o PDF do mesmo mês, o painel
> percebe e ignora o repetido.

### Do Bling

| Arquivo | Para que serve |
|---|---|
| **Clientes e Fornecedor — Visão de Contatos** | o mais valioso: liga cada CNPJ a um nome e a um tipo |
| Pedidos de venda (CSV) | o faturamento, para comparar com o que entrou |
| Notas fiscais de entrada | as compras de fornecedores |
| Contas a pagar | os títulos em aberto e atrasados |

> Mande o relatório de contatos **na primeira vez**. É ele que faz o painel
> reconhecer sozinho que um PIX para `09.574.015/0001-38` é a *Linz Fábrica de
> Móveis*, e classificar como fornecedor sem você digitar nada.

### Da Vindi e do Mercado Pago

Planilhas de extrato de pagamentos e da conta digital. Elas mostram as taxas
de cartão, que são um custo real e costumam passar despercebido.

Se **todo** o dinheiro que entra na Vindi é transferido para o Sicoob, esses
arquivos são opcionais: o crédito no Sicoob já registra a venda. Mande se
quiser enxergar as taxas separadas.

### Do Mercado Pago

O extrato da conta (`account_statement….xlsx`) é lido inteiro: venda liberada,
rendimento do saldo parado e o Pix que manda o dinheiro para o Sicoob. O
painel avisa o saldo do fim do período, para você conferir em *Fechar o mês*.

Um extrato de mês sem movimento é reconhecido como tal, em vez de dar erro.

### Do Magalu

O relatório de **repasse** (`repasse…xlsx`) é lido inteiro: cada parcela de
venda, cada estorno, cada evento de cupom e a transferência para o banco. O
arquivo fecha em zero, porque tudo que entrou saiu no repasse.

O Magalu cobra **R$ 5,00 fixos por transferência** — é por isso que o Pix que
chega no Sicoob é sempre R$ 5,00 menor que o repasse do relatório. O painel
mostra esse valor na descrição do repasse, e o aviso da importação diz quanto
foi no arquivo todo.

### Do Web Continental

O relatório de repasse do parceiro (`Parceiro_NNNN.xlsx`) também é lido: cada
pedido, os ajustes (tarifa de performance, recorrência) e o repasse para o
banco, que o painel cria a partir do total do arquivo.

Conferido no repasse de 10/08/2026: 907,05 − 1,00 − 35,00 = **871,05**, que é
exatamente o Pix que caiu no Sicoob.

### De outros lugares

Se o valor é pequeno, lance à mão em **Lançamentos → Novo lançamento**.

---

## O caminho de todo mês

### 1. Importar

**Importar** → arraste os arquivos → **Conferir importação**.

Ele mostra o que vai entrar antes de gravar: quantos lançamentos são novos,
quantos já existiam, quantos ele classificou sozinho e quantos precisam de
você. Nada é gravado até você confirmar.

Pode reenviar o mesmo arquivo quantas vezes quiser: o que já entrou não entra
de novo.

### 2. Revisar

**Revisar** mostra só o que precisa de decisão. Para cada linha, escolha a
categoria.

Quando for algo que se repete todo mês, clique no ícone de raio (⚡) e marque
**"vale para todas as parecidas"**. Escolha reconhecer pelo **CNPJ** sempre que
possível — é o que menos muda. A partir daí, todo lançamento daquele pagador
já vem classificado.

Dá para selecionar várias linhas e resolver de uma vez, inclusive marcando
tudo como **Holding** ou como **Transferência**.

#### Confirmar de uma vez

Nas linhas que o painel já classificou sozinho aparece um **✓** entre o valor e
a categoria: um clique confirma o palpite e a linha sai da caixa de revisão.
Selecionando várias, o botão **Está certo** confirma todas de uma vez.

Ao selecionar linhas, a barra de baixo mostra a **soma do que está
selecionado** — serve de conferência antes de aplicar uma categoria em lote.

#### "Vale para todas as parecidas"

Ao criar a regra você escolhe o que identifica o lançamento:

| Reconhecer por | Quando usar |
|---|---|
| Contraparte / Descrição | o texto do extrato é sempre igual |
| CNPJ/CPF | pega todos os lançamentos daquele pagador |
| Valor exato | repete sempre no mesmo valor |
| Valor + dia do mês | mensalidade, aluguel, parcela: mesmo valor, mesmo dia |
| Valor + descrição | o mesmo texto aparece com valores diferentes |

O diálogo mostra quantos lançamentos já importados combinam com a escolha,
antes de você confirmar.

#### "Mesmo dinheiro em duas contas"

É o botão de parear transferência. Serve para quando **um mesmo dinheiro
aparece duas vezes**: saiu de uma conta sua e entrou em outra (o repasse da
Vindi que cai no Sicoob, um PIX entre contas do mesmo CNPJ, o saque do
Mercado Pago).

Selecione as duas pontas — a saída de uma conta e a entrada na outra — e
clique. As duas passam a se anular: não contam como receita nem como despesa,
e o saldo de cada conta continua certo. Se chegou menos do que saiu, o painel
pergunta se a diferença é taxa e lança a diferença como custo.

Quando a conta de origem é de passagem (gateway/marketplace), o painel avisa e
marca só a saída — parear os dois lados apagaria o faturamento do mês.

#### De quem é esse pagamento

O extrato mostra "DÉB.TÍTULO COBRANÇA" e um número de agendamento, sem dizer
quem recebeu. Com o relatório de **contas a pagar** ou as **notas de entrada**
do Bling importados, o painel cruza as saídas com os títulos e mostra o
fornecedor — e, como o nome entra antes da categorização, as regras por texto
passam a reconhecer aquele fornecedor sozinhas.

O cruzamento é pelo valor exato, com vencimento, número do título e nome como
desempate. Título vence perto do pagamento (até 12 dias); nota de entrada pode
ser paga bem depois (até 60 dias). Empatou, ninguém é escolhido. Para rodar
sobre o que já está importado:
**Ajustes → Backup e dados → Ligar pagamentos aos títulos do Bling**.

#### PIX de pessoa física pelo banco de um gateway

Um PIX de uma pessoa pode chegar pelo Mercado Pago, PagSeguro ou Nubank —
o extrato mostra o banco de quem pagou, não a origem do dinheiro. O painel
não trata mais isso como repasse de marketplace: quando o pagador é pessoa
física, as regras de gateway não valem e o lançamento entra como PIX
recebido, para você decidir se é venda ou dinheiro da holding.

#### De qual pedido é esse PIX

O extrato só diz "PIX RECEBIDO — OUTRA IF". Se o CSV de pedidos do Bling
estiver importado, o painel cruza as entradas com os pedidos e mostra o
**número do pedido e o cliente** na linha.

O cruzamento é pelo valor exato, com nome, CNPJ/CPF e data como desempate.
Quando dois pedidos empatam, nenhum é escolhido — melhor sem número do que com
o número errado. Para rodar de novo sobre o que já está importado:
**Ajustes → Backup e dados → Ligar entradas aos pedidos de venda**.

#### Nome no lugar do CNPJ

Quando o extrato traz só o número, o painel busca a razão social nas bases
públicas da Receita (BrasilAPI e Minha Receita) em
**Ajustes → Contatos → Buscar nome dos CNPJs**. O nome fica guardado no
cadastro e vale para todos os lançamentos daquele CNPJ, inclusive os
próximos. CPF não tem consulta pública — nesses casos aparece o documento
formatado.

### 3. Fechar o mês

**Fechar o mês** lista suas contas com o saldo que o painel calculou. Digite,
ao lado, o saldo que aparece no extrato no último dia do mês.

- Bateu → aparece *confere*.
- Não bateu → aparece a diferença. Quase sempre é algum lançamento que faltou
  importar ou que foi lançado com valor errado.

Quando estiver certo, clique em **Fechar**. O saldo final vira automaticamente
a abertura do mês seguinte — é exatamente o "começa com dez mil" que você
queria.

Se precisar corrigir algo depois, dá para reabrir o mês.

### 4. Relatório

**Relatório** → **Baixar PDF**. Sai o demonstrativo do mês, o saldo de cada
conta, a conta da holding, a comparação com o mês anterior e o histórico.

---

## Entendendo os números

### "A empresa deu dinheiro?"

É a receita menos a despesa **da empresa**. Não entra transferência entre
contas suas, não entra dinheiro da holding, não entra empréstimo, não entra
resgate de aplicação. É o número que responde se o negócio se paga.

### "Do lucro ao caixa"

Lucro e dinheiro na conta são coisas diferentes, e essa lista mostra por quê:

```
Resultado operacional do mês        R$  23.430,53
Holding (sócios)                    R$  -3.640,50
Empréstimos                         R$  -3.125,85
Aplicações e resgates               R$ -22.084,31
Transferências entre contas         R$   3.356,75
Ainda sem categoria                 R$   6.911,83
─────────────────────────────────────────────────
Variação de caixa explicada         R$   4.848,45
```

Se a última linha bate com a variação real do caixa, a conciliação fechou. Se
sobrar diferença, o painel avisa — normalmente é lançamento sem categoria ou
uma transferência que só apareceu de um lado.

### A conta da holding

Todo dinheiro que sai da empresa para coisa dos sócios entra aqui, em vez de
virar despesa. Todo aporte dos sócios também.

O saldo é acumulado desde o começo, como uma conta corrente entre as duas
empresas:

> *A holding/sócios devem R$ 3.640,50 à Móvel5.*

Assim o resultado da empresa não fica sujo e você sabe exatamente quanto
acertar.

**Por que assim e não como despesa:** se o gasto pessoal entrasse como despesa,
a empresa pareceria menos lucrativa do que é, e você continuaria sem saber
quanto uma deve à outra. Do jeito atual você tem as duas respostas separadas.

#### De quem é esse dinheiro (destinos)

Ao marcar um lançamento como holding, o painel pergunta **de quem** é: AN5,
Roberto, Osvaldo, Chácara, Solar, EV Parking — a lista é sua, edite em
**Ajustes → Categorias → Destinos da holding**.

A regra de *"vale para todas as parecidas"* também pergunta o destino quando a
categoria é de holding: aí todo PIX daquela pessoa já entra na conta certa,
com o destino certo, sem você tocar.

O saldo com a holding continua sendo um só. O destino é para você enxergar
depois para onde foi (ou de onde veio) cada valor e lançar no financeiro de
cada lugar. A quebra por destino aparece no painel, no relatório e no PDF.

### Dividir um lançamento em partes

Uma parcela do empréstimo sai inteira da conta da Móvel5, mas metade é da
holding. Em **Lançamentos**, abra o lançamento e clique em **Desmembrar em
partes** (na revisão o botão é o **+** ao lado da linha).

Você diz quanto é de cada parte e a categoria de cada uma — o painel só aceita
quando as partes somam exatamente o valor que saiu do banco. O lançamento
original é substituído pelas partes, então o saldo da conta não muda e
reimportar o mesmo arquivo não traz o valor de volta.

Mudou de ideia? Abra qualquer parte e use **Juntar de volta**.

### Contas de passagem

Gateways e marketplaces (Vindi, Mercado Pago, Magalu) vêm marcados como
**passagem**: o dinheiro que chega neles ainda não é considerado receita. A
venda é contada quando cai no banco, que é o número que você consegue conferir
no extrato.

O saldo dessas contas aparece à parte, como *dinheiro em trânsito*.

Se você preferir contar a venda já na chegada ao gateway, dá para mudar em
**Ajustes → Contas**, ligando *"contar as entradas desta conta como receita"*.
Só não ligue os dois lados ao mesmo tempo, senão a mesma venda conta duas
vezes — e o painel avisa se isso acontecer.

### Vendido × recebido

Compara o que o Bling registrou como venda no mês com o que entrou de fato.
Quase sempre são diferentes, porque venda parcelada no cartão só cai nos meses
seguintes. Não é erro.

---

## Acertando os meses atrasados

Para recuperar os dois anos:

1. Comece pelo mês mais antigo que você tem extrato.
2. Em **Ajustes → Contas**, coloque no saldo inicial quanto havia na conta
   antes desse mês.
3. Importe os arquivos daquele mês, revise e feche.
4. Vá para o mês seguinte. A abertura já vem preenchida.

Nos meses sem arquivo, use **Lançamentos → Novo lançamento** para registrar o
que você lembra ou tem anotado.

Cada regra que você criar no caminho vale para todos os meses seguintes, então
o trabalho diminui rápido.

---

## Perguntas rápidas

**Importei o arquivo errado. E agora?**
Vá em **Lançamentos**, marque **Todos os meses**, filtre pela conta, selecione
as linhas e exclua.

**Um lançamento está com a categoria errada.**
Mude na tela **Revisar** ou **Lançamentos**. O que você escolhe à mão nunca é
sobrescrito automaticamente.

**Preciso de uma categoria que não existe.**
**Ajustes → Categorias → Nova categoria.**

**Como faço backup?**
**Ajustes → Backup e dados → Baixar backup.** Vale fazer depois de fechar cada
mês.

**Meus arquivos vão para algum servidor?**
Não. Eles são lidos dentro do navegador. Só os lançamentos já interpretados são
gravados, e apenas no modo nuvem.
