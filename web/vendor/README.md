# Bibliotecas de terceiros

Estes arquivos vêm junto com o projeto de propósito: o painel não depende de
nenhum CDN, funciona offline e continua funcionando se um serviço externo sair
do ar. Não edite nada aqui — para atualizar, troque o arquivo pela versão nova.

| Arquivo | Biblioteca | Versão | Licença | Para quê |
|---|---|---|---|---|
| `pdf.min.mjs`, `pdf.worker.min.mjs` | [pdf.js](https://mozilla.github.io/pdf.js/) | 4.6.82 | Apache-2.0 | ler o texto dos PDFs do Sicoob e do Bling |
| `xlsx.full.min.js` | [SheetJS](https://sheetjs.com/) | 0.18.5 | Apache-2.0 | ler planilhas .xlsx da Vindi, Mercado Pago e Bling |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | MIT | gerar o relatório em PDF |
| `jspdf.plugin.autotable.min.js` | [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) | 3.8.3 | MIT | montar as tabelas do PDF |

Todo o processamento acontece no navegador. Os arquivos que você importa não
são enviados para nenhum servidor — só os lançamentos já interpretados são
gravados no banco.
