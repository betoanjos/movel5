// Back-end de nuvem: fala com o Worker da Cloudflare (banco D1).
// Mesma interface do back-end local, para o resto do app não saber a diferença.

export function criarBackendAPI(base = '/api') {
  const pedir = async (caminho, opts = {}) => {
    const r = await fetch(base + caminho, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) {
      const e = new Error('Sessão expirada. Entre novamente.');
      e.naoAutorizado = true;
      throw e;
    }
    if (!r.ok) {
      let msg = `Erro ${r.status}`;
      try { msg = (await r.json()).erro || msg; } catch {}
      throw new Error(msg);
    }
    return r.status === 204 ? null : r.json();
  };

  return {
    nome: 'nuvem',
    pedir,

    listar: (colecao) => pedir(`/dados/${colecao}`),

    gravar: async (colecao, registros) => {
      if (!registros.length) return 0;
      // Envia em blocos para não estourar o limite de corpo da requisição.
      let total = 0;
      for (let i = 0; i < registros.length; i += 400) {
        const r = await pedir(`/dados/${colecao}`, { method: 'PUT', body: { registros: registros.slice(i, i + 400) } });
        total += r?.gravados ?? 0;
      }
      return total;
    },

    remover: (colecao, ids) =>
      pedir(`/dados/${colecao}`, { method: 'DELETE', body: { ids: Array.isArray(ids) ? ids : [ids] } })
        .then((r) => r?.removidos ?? 0),

    limpar: (colecao) => pedir(`/dados/${colecao}/tudo`, { method: 'DELETE' }),

    apagarTudo: () => pedir('/dados', { method: 'DELETE' }),

    // ---- sessão ----
    entrar: (usuario, senha) => pedir('/sessao', { method: 'POST', body: { usuario, senha } }),
    sair: () => pedir('/sessao', { method: 'DELETE' }),
    quemSou: () => pedir('/sessao'),
    trocarSenha: (atual, nova) => pedir('/sessao/senha', { method: 'POST', body: { atual, nova } }),
  };
}
