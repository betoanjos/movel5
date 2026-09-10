// Peças de interface reutilizadas por todas as telas.
import { esc } from './util.js';

/** Cria elemento a partir de HTML. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Delegação de eventos: `liga(raiz, 'click', '[data-acao]', fn)`. */
export function liga(raiz, evento, seletor, fn) {
  raiz.addEventListener(evento, (e) => {
    const alvo = e.target.closest(seletor);
    if (alvo && raiz.contains(alvo)) fn(e, alvo);
  });
}

const ICONES = {
  painel: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  importar: 'M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  revisar: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  fechar: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  relatorio: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M9 15h6M9 11h3',
  ajustes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  holding: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  alerta: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
  ok: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  erro: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM15 9l-6 6M9 9l6 6',
  nuvem: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10Z',
  mais: 'M12 5v14M5 12h14',
  lixo: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  lapis: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z',
  baixar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  busca: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  seta: 'M5 12h14M12 5l7 7-7 7',
  x: 'M18 6 6 18M6 6l12 12',
  raio: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  banco: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3',
};

/** SVG de ícone por nome. */
export function icone(nome, tam = 18) {
  const d = ICONES[nome] || ICONES.info;
  const paths = d.split(' M').map((p, i) => (i ? 'M' + p : p));
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" width="${tam}" height="${tam}" aria-hidden="true">
    ${paths.map((p) => `<path d="${esc(p)}"/>`).join('')}</svg>`;
}

/** Mensagem rápida no rodapé. */
export function avisar(texto, ms = 3200) {
  document.querySelector('.aviso-flutuante')?.remove();
  const n = el(`<div class="aviso-flutuante" role="status">${esc(texto)}</div>`);
  document.body.appendChild(n);
  setTimeout(() => n.remove(), ms);
}

/** Bloco de aviso embutido na página. */
export function bloco(tipo, texto, extra = '') {
  const ic = { info: 'info', atencao: 'alerta', erro: 'erro', ok: 'ok' }[tipo] || 'info';
  return `<div class="aviso aviso-${tipo}">${icone(ic)}<div class="aviso-texto">${texto}</div>${extra}</div>`;
}

/**
 * Caixa de diálogo. Devolve uma Promise com o resultado de `aoConfirmar`,
 * ou `null` se o usuário cancelar.
 */
export function modal({ titulo, corpo, confirmar = 'Salvar', cancelar = 'Cancelar',
                        largo = false, perigo = false, aoConfirmar, aoAbrir }) {
  return new Promise((resolve) => {
    const fundo = el(`
      <div class="modal-fundo" role="dialog" aria-modal="true">
        <div class="modal ${largo ? 'modal-largo' : ''}">
          <div class="modal-cabeca">
            <h2>${esc(titulo)}</h2>
            <button class="btn btn-sutil btn-pequeno" data-x aria-label="Fechar">${icone('x', 16)}</button>
          </div>
          <div class="modal-corpo">${corpo}</div>
          <div class="modal-pe">
            ${cancelar ? `<button class="btn" data-cancelar>${esc(cancelar)}</button>` : ''}
            ${confirmar ? `<button class="btn ${perigo ? 'btn-perigo' : 'btn-principal'}" data-ok>${esc(confirmar)}</button>` : ''}
          </div>
        </div>
      </div>`);

    const fechar = (v) => { fundo.remove(); document.removeEventListener('keydown', tecla); resolve(v); };
    const tecla = (e) => { if (e.key === 'Escape') fechar(null); };

    fundo.querySelector('[data-x]').onclick = () => fechar(null);
    fundo.querySelector('[data-cancelar]')?.addEventListener('click', () => fechar(null));
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(null); });
    document.addEventListener('keydown', tecla);

    const btnOk = fundo.querySelector('[data-ok]');
    if (btnOk) {
      btnOk.onclick = async () => {
        btnOk.disabled = true;
        try {
          const r = aoConfirmar ? await aoConfirmar(fundo) : true;
          if (r === false) { btnOk.disabled = false; return; }
          fechar(r === undefined ? true : r);
        } catch (e) {
          btnOk.disabled = false;
          avisar(e.message || 'Não foi possível concluir.');
        }
      };
    }

    document.body.appendChild(fundo);
    aoAbrir?.(fundo);
    fundo.querySelector('input, select, textarea, [data-ok]')?.focus();
  });
}

/** Confirmação simples. */
export const confirmar = (titulo, texto, rotulo = 'Confirmar', perigo = true) =>
  modal({ titulo, corpo: `<p>${texto}</p>`, confirmar: rotulo, perigo });

/** Estado vazio padronizado. */
export const vazio = (titulo, texto, acao = '') =>
  `<div class="vazio"><h3>${esc(titulo)}</h3><p>${texto}</p>${acao}</div>`;

/** Seletor de categorias agrupado. */
export function selectCategorias(categorias, selecionada = '', { vazioTexto = 'Sem categoria' } = {}) {
  const grupos = new Map();
  for (const c of categorias) {
    if (!grupos.has(c.grupo)) grupos.set(c.grupo, []);
    grupos.get(c.grupo).push(c);
  }
  return `<option value="">${esc(vazioTexto)}</option>` +
    [...grupos].map(([g, itens]) =>
      `<optgroup label="${esc(g)}">${itens.map((c) =>
        `<option value="${esc(c.id)}"${c.id === selecionada ? ' selected' : ''}>${esc(c.nome)}</option>`
      ).join('')}</optgroup>`).join('');
}
