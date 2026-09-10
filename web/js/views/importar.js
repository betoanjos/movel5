// Importação: solta os arquivos, o painel reconhece cada um, mostra o que vai
// entrar e só grava depois da confirmação.
import { estado, salvar, definirCompetencia, nomeCategoria } from '../store.js';
import { lerArquivo } from '../parsers/index.js';
import { processarImportacao } from '../engine/motor.js';
import { el, icone, bloco, avisar, liga } from '../lib/ui.js';
import { brl, esc, uid, labelCompetencia, competenciaOf, brDate } from '../lib/util.js';

let arquivos = [];   // { file, resultado, contaId }
let previa = null;

export function telaImportar(raiz, { ir }) {
  arquivos = []; previa = null;

  raiz.innerHTML = `
  <div class="pilha">
    <div class="cartao">
      <div class="cartao-corpo">
        <div class="solta" id="solta" tabindex="0" role="button"
             aria-label="Escolher arquivos para importar">
          <div class="solta-icone">${icone('importar', 40)}</div>
          <h3>Arraste os arquivos aqui</h3>
          <p class="secundario mini" style="max-width:520px;margin:6px auto 0">
            Pode soltar tudo de uma vez. Reconheço extrato OFX e PDF do Sicoob, relatórios de
            PIX e comprovantes de boleto, planilhas da Vindi e do Mercado Pago e os relatórios
            do Bling (pedidos, notas de entrada, contas a pagar e cadastro de contatos).
          </p>
          <input type="file" id="entrada-arquivo" multiple hidden
                 accept=".ofx,.ofc,.qfx,.pdf,.xlsx,.xls,.xlsm,.csv,.txt">
        </div>
      </div>
    </div>
    <div id="lista-arquivos"></div>
    <div id="resultado-previa"></div>
  </div>`;

  const zona = raiz.querySelector('#solta');
  const entrada = raiz.querySelector('#entrada-arquivo');

  zona.onclick = () => entrada.click();
  zona.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } };
  entrada.onchange = () => { adicionar([...entrada.files], raiz, ir); entrada.value = ''; };

  ['dragenter', 'dragover'].forEach((ev) =>
    zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('ativa'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('ativa'); }));
  zona.addEventListener('drop', (e) => adicionar([...e.dataTransfer.files], raiz, ir));
}

// ------------------------------------------------------------------ leitura --

async function adicionar(files, raiz, ir) {
  if (!files.length) return;
  const lista = raiz.querySelector('#lista-arquivos');
  lista.innerHTML = `<div class="cartao"><div class="cartao-corpo linha-flex">
    <span class="carregando"></span><span class="secundario">Lendo ${files.length} arquivo(s)…</span></div></div>`;

  for (const f of files) {
    if (arquivos.some((a) => a.file.name === f.name && a.file.size === f.size)) continue;
    const resultado = await lerArquivo(f);
    arquivos.push({ file: f, resultado, contaId: sugerirConta(resultado) });
  }
  desenharLista(raiz, ir);
}

/** Escolhe a conta provável a partir do tipo de arquivo. */
function sugerirConta(r) {
  const acha = (re) => estado.contas.find((c) => re.test(c.nome))?.id;
  const t = (r.tipo || '').toLowerCase();
  if (t.includes('vindi') || t.includes('yapay')) return acha(/vindi|yapay/i) || null;
  if (t.includes('mercado pago')) return acha(/mercado ?pago/i) || null;
  if (t.includes('sicoob') || t.includes('ofx')) return acha(/sicoob|banco/i) || estado.contas[0]?.id;
  return estado.contas[0]?.id;
}

// ------------------------------------------------------------------- lista --

function desenharLista(raiz, ir) {
  const lista = raiz.querySelector('#lista-arquivos');
  if (!arquivos.length) { lista.innerHTML = ''; return; }

  const precisaConta = (a) => a.resultado.lancamentos.length > 0;

  lista.innerHTML = `
  <div class="cartao">
    <div class="cartao-cabeca">
      <h2>${arquivos.length} arquivo(s) prontos</h2>
      <button class="btn btn-sutil btn-pequeno" data-limpar>Limpar lista</button>
      <button class="btn btn-principal" data-processar>${icone('raio', 15)} Conferir importação</button>
    </div>
    <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
      <table class="tabela">
        <thead><tr><th>Arquivo</th><th>Reconhecido como</th><th class="num">Conteúdo</th><th>Conta</th><th></th></tr></thead>
        <tbody>
        ${arquivos.map((a, i) => {
          const r = a.resultado;
          return `<tr>
            <td><div class="forte mini">${esc(a.file.name)}</div>
                ${r.erro ? `<div class="mini neg">${esc(r.erro)}</div>` : ''}
                ${r.extra?.aviso ? `<div class="mini mudo">${esc(r.extra.aviso)}</div>` : ''}</td>
            <td><span class="selo ${r.erro && !r.lancamentos.length ? 'selo-neg' : 'selo-acento'}">${esc(r.tipo)}</span></td>
            <td class="num mini">${esc(descreverConteudo(r))}</td>
            <td>${precisaConta(a)
              ? `<select data-conta="${i}" style="min-width:150px">
                   ${estado.contas.map((c) => `<option value="${c.id}"${c.id === a.contaId ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
                 </select>`
              : '<span class="mini mudo">não se aplica</span>'}</td>
            <td><button class="btn btn-sutil btn-pequeno" data-remover="${i}" aria-label="Remover">${icone('x', 14)}</button></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

  liga(lista, 'change', '[data-conta]', (e, alvo) => { arquivos[Number(alvo.dataset.conta)].contaId = alvo.value; });
  liga(lista, 'click', '[data-remover]', (e, alvo) => {
    arquivos.splice(Number(alvo.dataset.remover), 1);
    desenharLista(raiz, ir);
    raiz.querySelector('#resultado-previa').innerHTML = '';
  });
  lista.querySelector('[data-limpar]').onclick = () => {
    arquivos = []; desenharLista(raiz, ir);
    raiz.querySelector('#resultado-previa').innerHTML = '';
  };
  lista.querySelector('[data-processar]').onclick = () => processar(raiz, ir);
}

function descreverConteudo(r) {
  const p = [];
  if (r.lancamentos.length) p.push(`${r.lancamentos.length} lançamentos`);
  if (r.enriquecimentos.length) p.push(`${r.enriquecimentos.length} identificações`);
  if (r.vendas.length) p.push(`${r.vendas.length} pedidos`);
  if (r.compras.length) p.push(`${r.compras.length} notas`);
  if (r.contasPagar?.length) p.push(`${r.contasPagar.length} títulos`);
  if (r.contatos?.length) p.push(`${r.contatos.length} contatos`);
  if (r.diasVenda.length) p.push(`${r.diasVenda.length} dias de venda`);
  return p.join(' · ') || '—';
}

// ---------------------------------------------------------------- processar --

function processar(raiz, ir) {
  const contaPorArquivo = Object.fromEntries(arquivos.map((a) => [a.resultado.arquivo, a.contaId]));
  previa = processarImportacao(arquivos.map((a) => a.resultado), {
    contaPorArquivo,
    contaPadraoId: estado.contas[0]?.id,
    existentes: estado.lancamentos,
    regrasUsuario: estado.regras,
    enriquecimentosSalvos: estado.enriquecimentos,
    contrapartes: estado.contrapartes,
  });
  desenharPrevia(raiz, ir);
}

function desenharPrevia(raiz, ir) {
  const r = previa.resumo;
  const caixa = raiz.querySelector('#resultado-previa');
  const comps = [...new Set(previa.novos.map((l) => l.competencia))].sort();
  const semCategoria = previa.novos.filter((l) => !l.categoria);

  caixa.innerHTML = `
  <div class="cartao">
    <div class="cartao-cabeca"><h2>O que vai entrar</h2></div>
    <div class="cartao-corpo">
      <div class="grade g4" style="gap:12px;margin-bottom:16px">
        ${mini('Lançamentos novos', r.novos, 'pos')}
        ${mini('Já existiam', r.duplicados, 'mudo')}
        ${mini('Classificados sozinhos', r.autoCategorizados, 'pos')}
        ${mini('Precisam de você', r.pendentes, r.pendentes ? 'neg' : 'pos')}
      </div>

      <div class="pilha" style="gap:8px">
        ${r.enriquecidos ? bloco('ok', `<strong>${r.enriquecidos} lançamentos ganharam nome</strong> —
          boletos que apareciam só como "DÉB.TIT.COMPE" agora mostram o fornecedor, e os PIX mostram o destinatário.`) : ''}
        ${r.identificados ? bloco('ok', `<strong>${r.identificados} contrapartes reconhecidas pelo CNPJ</strong>
          a partir do cadastro do Bling.`) : ''}
        ${r.transferencias ? bloco('info', `<strong>${r.transferencias} transferência(s) entre contas próprias</strong>
          foram pareadas e não vão contar como receita nem como despesa.`) : ''}
        ${r.duplicados ? bloco('info', `${r.duplicados} lançamento(s) já estavam no sistema e foram ignorados —
          pode reenviar o mesmo arquivo sem medo de duplicar.`) : ''}
        ${comps.length > 1 ? bloco('atencao', `Os arquivos cobrem ${comps.length} meses
          (${comps.map(labelCompetencia).join(', ')}). Todos serão importados.`) : ''}
        ${!r.novos ? bloco('atencao', 'Nenhum lançamento novo. Provavelmente estes arquivos já foram importados antes.') : ''}
      </div>

      ${previa.porArquivo.some((p) => p.erro) ? `<div style="margin-top:12px" class="pilha">
        ${previa.porArquivo.filter((p) => p.erro).map((p) =>
          bloco('erro', `<strong>${esc(p.arquivo)}</strong>: ${esc(p.erro)}`)).join('')}
      </div>` : ''}

      ${previa.novos.length ? `
        <details style="margin-top:16px">
          <summary class="mini forte" style="cursor:pointer">Ver os ${previa.novos.length} lançamentos que vão entrar</summary>
          <div class="tabela-rolagem" style="max-height:340px;overflow-y:auto;margin-top:10px;border:1px solid var(--linha);border-radius:var(--r-md)">
            <table class="tabela tabela-compacta">
              <thead><tr><th>Data</th><th>Descrição</th><th>Contraparte</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
              <tbody>${previa.novos.slice(0, 400).map((l) => `
                <tr><td class="mini nowrap">${brDate(l.data)}</td>
                  <td class="mini">${esc((l.descricao || '').slice(0, 46))}</td>
                  <td class="mini secundario">${esc((l.contraparte || '').slice(0, 34))}</td>
                  <td class="mini">${l.categoria
                      ? `<span class="selo ${l.confianca === 'baixa' ? 'selo-alerta' : ''}">${esc(nomeCategoria(l.categoria))}</span>`
                      : '<span class="selo selo-neg">definir</span>'}</td>
                  <td class="num mini ${l.valor >= 0 ? 'pos' : 'neg'}">${brl(l.valor)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </details>` : ''}
    </div>
    <div class="barra-acao" style="margin:0;border-radius:0 0 var(--r-lg) var(--r-lg);border-left:none;border-right:none;border-bottom:none">
      <span class="mini secundario">
        ${previa.novos.length
          ? `${previa.novos.length} lançamentos serão gravados${semCategoria.length ? `, ${semCategoria.length} sem categoria` : ''}.`
          : 'Nada novo para gravar.'}
      </span>
      <span class="espaco"></span>
      <button class="btn" data-cancelar>Cancelar</button>
      <button class="btn btn-principal" data-confirmar ${previa.novos.length || previa.contatos?.length ? '' : 'disabled'}>
        ${icone('ok', 15)} Confirmar importação</button>
    </div>
  </div>`;

  caixa.querySelector('[data-cancelar]').onclick = () => { caixa.innerHTML = ''; previa = null; };
  caixa.querySelector('[data-confirmar]').onclick = (e) => gravar(e.target.closest('button'), ir);
}

const mini = (rotulo, valor, classe) => `
  <div style="padding:10px 12px;background:var(--surface-sunken);border-radius:var(--r-md)">
    <div class="micro">${esc(rotulo)}</div>
    <div class="num forte ${classe}" style="font-size:1.35rem">${valor}</div>
  </div>`;

// ------------------------------------------------------------------ gravar --

async function gravar(btn, ir) {
  btn.disabled = true;
  btn.innerHTML = '<span class="carregando"></span> Gravando…';
  try {
    const agora = new Date().toISOString();

    if (previa.novos.length) {
      await salvar('lancamentos', previa.novos.map((l) => ({ ...l, id: l.id || uid(), criado_em: agora })));
    }
    if (previa.alteradosAntigos?.length) await salvar('lancamentos', previa.alteradosAntigos);
    if (previa.enriquecimentos.length) {
      await salvar('enriquecimentos', previa.enriquecimentos.map((e) => ({ ...e, id: uid() })));
    }
    if (previa.contatos?.length) await salvar('contrapartes', mesclarPorChave(previa.contatos, estado.contrapartes, 'documento'));
    if (previa.vendas.length) await salvar('vendas', mesclarPorChave(previa.vendas, estado.vendas, 'ref'));
    if (previa.compras.length) await salvar('compras', mesclarPorChave(previa.compras, estado.compras, 'ref'));
    if (previa.contasPagar.length) await salvar('contasPagar', mesclarPorChave(previa.contasPagar, estado.contasPagar, 'ref'));
    if (previa.diasVenda.length) await salvar('diasVenda', previa.diasVenda.map((d) => ({ ...d, id: 'dv:' + d.data })));

    await salvar('importacoes', [{
      id: uid(), em: agora,
      arquivos: previa.porArquivo.map((p) => ({ arquivo: p.arquivo, tipo: p.tipo, novos: p.novos })),
      resumo: previa.resumo,
    }]);

    const comps = [...new Set(previa.novos.map((l) => l.competencia))].sort();
    if (comps.length) await definirCompetencia(comps[comps.length - 1]);

    const pendentes = previa.resumo.pendentes;
    avisar(`${previa.novos.length} lançamentos importados.`);
    previa = null; arquivos = [];
    ir(pendentes ? 'revisar' : 'painel');
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    btn.innerHTML = 'Tentar de novo';
    avisar('Não consegui gravar: ' + e.message, 5000);
  }
}

/** Une registros novos aos existentes sem duplicar, usando uma chave natural. */
function mesclarPorChave(novos, existentes, chave) {
  const idPorChave = new Map(existentes.filter((e) => e[chave]).map((e) => [e[chave], e.id]));
  const vistos = new Set();
  const saida = [];
  for (const n of novos) {
    const k = n[chave];
    if (k && vistos.has(k)) continue;
    if (k) vistos.add(k);
    saida.push({ ...n, id: (k && idPorChave.get(k)) || uid() });
  }
  return saida;
}
