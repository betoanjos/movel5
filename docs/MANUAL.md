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

### Do Magalu, Web Continental e outros

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
