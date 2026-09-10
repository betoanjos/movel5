// Fechamento do mês: confere o saldo calculado contra o saldo real de cada
// conta, tranca o mês e leva o saldo final como abertura do mês seguinte.
import { estado, salvar, remover } from '../store.js';
import { apurar, saldoAbertura } from '../engine/relatorio.js';
import { brl, labelCompetencia, nextCompetencia, prevCompetencia, esc, uid, round2 } from '../lib/util.js';
import { icone, bloco, avisar, liga, modal } from '../lib/ui.js';

export function telaFechamento(raiz, { ir }) {
  desenhar(raiz, ir);
}

function desenhar(raiz, ir) {
  const comp = estado.competencia;
  const dados = {
    lancamentos: estado.lancamentos, contas: estado.contas,
    fechamentos: estado.fechamentos, vendas: estado.vendas, compras: estado.compras,
  };
  const a = apurar(comp, dados);
  const fechado = estado.fechamentos.some((f) => f.competencia === comp && f.fechado);

  const bloqueios = [];
  if (a.contagem.semCategoria) {
    bloqueios.push({
      grave: true,
      texto: `${a.contagem.semCategoria} lançamento(s) ainda sem categoria. Sem isso o resultado do mês fica incompleto.`,
      acao: '<a class="btn btn-pequeno" href="#/revisar">Classificar</a>',
    });
  }
  const diferentes = a.porConta.filter((c) => c.diferenca != null && Math.abs(c.diferenca) >= 0.01);
  if (diferentes.length) {
    bloqueios.push({
      grave: true,
      texto: `${diferentes.length} conta(s) com saldo diferente do informado pelo banco.`,
    });
  }
  const semConferencia = a.porConta.filter((c) => c.saldoBanco == null && (c.movimentos || c.inicial));
  if (semConferencia.length) {
    bloqueios.push({
      grave: false,
      texto: `${semConferencia.length} conta(s) sem o saldo real informado. Dá para fechar assim, mas a conferência fica sem prova.`,
    });
  }

  raiz.innerHTML = `
  <div class="pilha">
    ${fechado
      ? bloco('ok', `<strong>${esc(labelCompetencia(comp))} está fechado.</strong>
          O saldo final de ${brl(a.caixa.final)} já é a abertura de ${esc(labelCompetencia(nextCompetencia(comp)))}.`,
          '<button class="btn btn-pequeno" data-reabrir>Reabrir mês</button>')
      : bloco('info', `Confira abaixo o saldo de cada conta. Quando o valor calculado bater com o extrato,
          feche o mês — o saldo final vira automaticamente a abertura do mês seguinte.`)}

    ${bloqueios.length ? `<div class="pilha" style="gap:8px">
      ${bloqueios.map((b) => bloco(b.grave ? 'atencao' : 'info', esc(b.texto), b.acao || '')).join('')}
    </div>` : bloco('ok', 'Nada pendente. Este mês está pronto para fechar.')}

    <div class="cartao">
      <div class="cartao-cabeca">
        <h2>Conferência das contas — ${esc(labelCompetencia(comp))}</h2>
        <span class="mini mudo">informe o saldo que aparece no extrato no último dia do mês</span>
      </div>
      <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
        <table class="tabela">
          <thead><tr>
            <th>Conta</th><th class="num">Abertura</th><th class="num">Movimento</th>
            <th class="num">Saldo calculado</th><th class="num" style="min-width:150px">Saldo real do banco</th>
            <th class="num">Diferença</th>
          </tr></thead>
          <tbody>
            ${a.porConta.map((c) => {
              const dif = c.diferenca;
              return `<tr>
                <td><span class="linha-flex" style="gap:8px">
                  <span class="ponto" style="background:${esc(c.cor || 'var(--ink-3)')}"></span>${esc(c.nome)}</span>
                  <div class="mini mudo">${c.movimentos} movimento(s)</div></td>
                <td class="num mudo">${brl(c.inicial)}</td>
                <td class="num ${c.entradas + c.saidas >= 0 ? 'pos' : 'neg'}">${brl(c.entradas + c.saidas)}</td>
                <td class="num forte">${brl(c.final)}</td>
                <td class="num">
                  <input type="number" step="0.01" data-saldo="${c.contaId}" style="text-align:right;max-width:140px"
                    value="${c.saldoBanco != null ? c.saldoBanco.toFixed(2) : ''}"
                    placeholder="—" ${fechado ? 'disabled' : ''}></td>
                <td class="num">${dif == null ? '<span class="mudo">—</span>'
                  : Math.abs(dif) < 0.01
                    ? '<span class="selo selo-pos">confere</span>'
                    : `<span class="selo selo-neg">${brl(dif)}</span>`}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr style="border-top:2px solid var(--linha-forte)">
            <td class="forte">Total em caixa</td>
            <td class="num mudo">${brl(a.caixa.inicial)}</td>
            <td class="num ${a.caixa.variacao >= 0 ? 'pos' : 'neg'}">${brl(a.caixa.variacao)}</td>
            <td class="num forte">${brl(a.caixa.final)}</td>
            <td colspan="2"></td>
          </tr></tfoot>
        </table>
      </div>
    </div>

    ${cartaoResumo(a)}

    ${!fechado ? `<div class="barra-acao">
      <span class="mini secundario">
        ${bloqueios.some((b) => b.grave)
          ? 'Ainda há pendências. Você pode fechar mesmo assim, mas o resultado pode mudar depois.'
          : 'Tudo conferido.'}
      </span>
      <span class="espaco"></span>
      <button class="btn btn-principal" data-fechar>${icone('fechar', 15)} Fechar ${esc(labelCompetencia(comp))}</button>
    </div>` : ''}
  </div>`;

  liga(raiz, 'change', '[data-saldo]', async (e, alvo) => {
    const contaId = alvo.dataset.saldo;
    const valor = alvo.value === '' ? null : round2(Number(alvo.value));
    await gravarFechamento(comp, contaId, { saldo_banco: valor });
    desenhar(raiz, ir);
  });

  raiz.querySelector('[data-fechar]')?.addEventListener('click', async () => {
    const graves = bloqueios.filter((b) => b.grave);
    const ok = await modal({
      titulo: `Fechar ${labelCompetencia(comp)}`,
      confirmar: 'Fechar o mês',
      corpo: `
        <p>O saldo final de <strong>${brl(a.caixa.final)}</strong> vira a abertura de
        <strong>${esc(labelCompetencia(nextCompetencia(comp)))}</strong>.</p>
        <p>Resultado apurado: <strong class="${a.resultado.resultadoOperacional >= 0 ? 'pos' : 'neg'}">
          ${brl(a.resultado.resultadoOperacional)}</strong>.</p>
        ${graves.length ? `<div style="margin-top:10px">${graves.map((b) =>
          bloco('atencao', esc(b.texto))).join('')}</div>
          <p class="mini mudo" style="margin-top:8px">Você pode reabrir o mês depois e corrigir.</p>` : ''}`,
    });
    if (!ok) return;
    for (const c of a.porConta) {
      await gravarFechamento(comp, c.contaId, {
        saldo_inicial: c.inicial, saldo_final: c.final,
        entradas: c.entradas, saidas: c.saidas,
        resultado: a.resultado.resultadoOperacional,
        fechado: 1, fechado_em: new Date().toISOString(),
      });
    }
    avisar(`${labelCompetencia(comp)} fechado.`);
    desenhar(raiz, ir);
  });

  raiz.querySelector('[data-reabrir]')?.addEventListener('click', async () => {
    const ok = await modal({
      titulo: 'Reabrir o mês', confirmar: 'Reabrir', perigo: true,
      corpo: `<p>Reabrir ${esc(labelCompetencia(comp))} permite editar os lançamentos de novo.</p>
        <p class="mini mudo">A abertura dos meses seguintes volta a ser calculada a partir dos lançamentos.</p>`,
    });
    if (!ok) return;
    for (const f of estado.fechamentos.filter((f) => f.competencia === comp)) {
      await salvar('fechamentos', [{ ...f, fechado: 0, fechado_em: null }]);
    }
    avisar('Mês reaberto.');
    desenhar(raiz, ir);
  });
}

async function gravarFechamento(competencia, conta_id, campos) {
  const atual = estado.fechamentos.find((f) => f.competencia === competencia && f.conta_id === conta_id);
  await salvar('fechamentos', [{
    id: atual?.id || uid(),
    competencia, conta_id,
    ...(atual || {}),
    ...campos,
  }]);
}

function cartaoResumo(a) {
  return `
  <div class="grade g3">
    <div class="cartao kpi">
      <div class="kpi-rotulo">Resultado do mês</div>
      <div class="kpi-valor ${a.resultado.resultadoOperacional >= 0 ? 'pos' : 'neg'}">${brl(a.resultado.resultadoOperacional)}</div>
      <div class="kpi-nota">${brl(a.resultado.receitas)} de receita menos ${brl(a.resultado.despesas)} de despesa</div>
    </div>
    <div class="cartao kpi">
      <div class="kpi-rotulo">Sobrou em caixa</div>
      <div class="kpi-valor">${brl(a.caixa.final)}</div>
      <div class="kpi-nota">abertura era ${brl(a.caixa.inicial)} · variação de ${brl(a.caixa.variacao)}</div>
    </div>
    <div class="cartao kpi">
      <div class="kpi-rotulo">${icone('holding', 14)} Conta da holding</div>
      <div class="kpi-valor" style="color:var(--holding)">${brl(Math.abs(a.holding.saldoAcumulado))}</div>
      <div class="kpi-nota">${esc(a.holding.interpretacao)}</div>
    </div>
  </div>`;
}
