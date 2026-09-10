# Painel Financeiro Móvel5

Junta os extratos, relatórios e planilhas que a empresa já gera, concilia
linha por linha e responde a pergunta que interessa: **a empresa deu dinheiro
neste mês?**

Também mostra quanto entrou, quanto saiu, para onde foi cada real, quanto
sobrou em cada conta e quanto a holding deve à empresa (ou o contrário).

## O que ele faz

- **Lê os arquivos como eles saem dos sistemas.** Extrato OFX e PDF do Sicoob,
  relatórios de PIX, comprovantes de boleto, planilhas da Vindi e do Mercado
  Pago, pedidos, notas de entrada, contas a pagar e cadastro de contatos do
  Bling. É só arrastar tudo de uma vez.
- **Dá nome ao que o banco esconde.** No extrato, um boleto aparece só como
  `DÉB.TIT.COMPE EFETIVADO`. Cruzando com os comprovantes, vira
  *LINZ FÁBRICA DE MÓVEIS — R$ 1.224,69*. Um PIX com só o CNPJ vira o nome do
  fornecedor, usando o cadastro exportado do Bling.
- **Classifica sozinho.** Impostos, energia, telefone, tarifas, fornecedores e
  transportadoras já vêm reconhecidos. O que sobrar, você classifica uma vez e
  marca *"vale para todas as parecidas"* — nas próximas importações já vem
  pronto.
- **Não conta o mesmo dinheiro duas vezes.** Reimportar o mesmo arquivo não
  duplica nada, e a venda que passa pela Vindi antes de cair no Sicoob é
  contada uma vez só.
- **Separa lucro de caixa.** Mostra, item por item, por que o resultado do mês
  é diferente do dinheiro que sobrou na conta.
- **Isola o que é da holding.** Gasto pessoal pago pela empresa sai do
  resultado e vira saldo numa conta corrente com os sócios — com destino
  (AN5, Roberto, Osvaldo, Chácara, Solar, EV Parking) para você saber de quem
  é cada valor.
- **Desmembra um lançamento.** A parcela do empréstimo que é metade da empresa
  e metade da holding vira duas linhas, sem mexer no saldo da conta.
- **Fecha o mês.** Você confere o saldo calculado contra o extrato; quando bate,
  fecha, e o saldo final vira a abertura do mês seguinte.
- **Gera o relatório em PDF** e guarda o histórico para comparar meses.

Tudo é editável: dá para incluir, corrigir e apagar lançamentos à mão — que é
como você vai acertar os meses atrasados.

## Onde ele roda

De dois jeitos, com o mesmo código:

| Modo | Como funciona | Para quê |
|---|---|---|
| **Local** | Abre no navegador, guarda tudo no próprio computador. Não precisa de conta nem internet. | Testar agora, ou usar sozinho. |
| **Nuvem** | Publicado na Cloudflare, com login para cada pessoa e banco de dados compartilhado. | Você e seu sócio vendo os mesmos números, de qualquer lugar. |

O modo nuvem cabe folgado no plano gratuito da Cloudflare. O passo a passo
está em **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Já está no ar

**<https://movel5.an5.workers.dev>**

Publicado na conta Cloudflare da Móvel5, num Worker próprio (`movel5`)
com banco D1 próprio — sem encostar no `painel-bling` nem no `an5-site`, que já
existiam por lá.

Na primeira visita ele pede para criar os acessos: um para você e outro para o
seu sócio. Essa tela aparece **uma única vez**; depois disso o endereço passa a
pedir login. Guarde as senhas — para redefinir é preciso a linha de comando
(veja o [guia de publicação](docs/DEPLOY.md)).

## Começando

Para experimentar agora mesmo, sem instalar nada:

```bash
cd web
python3 -m http.server 8000
```

Abra <http://localhost:8000>, vá em **Importar** e arraste os arquivos do mês.

Para publicar para valer, siga o **[guia de publicação](docs/DEPLOY.md)**.
Para aprender a usar no dia a dia, veja o **[manual](docs/MANUAL.md)**.

## Privacidade

Os arquivos que você importa são lidos **dentro do navegador**. Extratos,
comprovantes e planilhas não são enviados para servidor nenhum — só os
lançamentos já interpretados são gravados, e apenas no modo nuvem.

## Como o projeto é organizado

```
web/                 o painel (site estático, sem etapa de build)
  index.html
  assets/app.css     sistema visual
  js/
    parsers/         leitura de OFX, PDF, planilhas e CSV
    engine/          conciliação, categorização e apuração
    views/           telas
    lib/             utilitários, interface e gráficos
    db/              armazenamento local e de nuvem
  vendor/            bibliotecas de terceiros, embutidas de propósito
worker/              API e banco de dados na Cloudflare
docs/                publicação, manual e análise dos dados
```

Não há passo de build: o que está em `web/` é exatamente o que roda.
