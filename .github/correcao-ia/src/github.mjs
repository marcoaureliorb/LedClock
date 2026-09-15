/**
 * Cliente REST do GitHub para Issues, rotulos e Pull Requests.
 *
 * Usa `fetch` nativo do Node 20+, sem dependencia externa. O `fetch` e
 * injetavel para permitir teste sem rede.
 *
 * O cliente do revisor (`.github/revisao-ia/src/github.mjs`) cobre uma
 * superficie diferente (arquivos de PR) e nao expoe o helper de retentativa,
 * por isso este modulo tem o seu. Manter os dois separados evita que uma
 * mudanca na correcao quebre a revisao, que ja esta em producao.
 */

import { criarLog } from '../../revisao-ia/src/log.mjs';

const log = criarLog('correcao-ia');

const ESPERA_BASE_EM_MS = 800;

function ehStatusRecuperavel(status) {
  return status === 429 || status === 408 || status >= 500;
}

async function aguardar(milissegundos) {
  await new Promise((resolver) => {
    setTimeout(resolver, milissegundos);
  });
}

export function criarClienteGitHub({
  token,
  repositorio,
  baseUrl = 'https://api.github.com',
  buscar = fetch,
  tentativas = 3,
  dormir = aguardar,
}) {
  if (!token) throw new Error('Token do GitHub ausente. Verifique a permissao do GITHUB_TOKEN.');

  if (!repositorio || !/^[\w.-]+\/[\w.-]+$/.test(repositorio)) {
    throw new Error(`Repositorio invalido: "${repositorio}". Esperado "owner/nome".`);
  }

  const cabecalhos = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'correcao-ia',
  };

  async function requisitar(caminho, opcoes = {}, { tolerar = [] } = {}) {
    let ultimoErro;

    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      let resposta;

      try {
        resposta = await buscar(`${baseUrl}${caminho}`, {
          ...opcoes,
          headers: { ...cabecalhos, ...(opcoes.headers ?? {}) },
        });
      } catch (erro) {
        ultimoErro = new Error(`Falha de rede ao chamar ${caminho}: ${erro.message}`);

        if (tentativa === tentativas) throw ultimoErro;

        await dormir(ESPERA_BASE_EM_MS * 2 ** (tentativa - 1));
        continue;
      }

      if (resposta.ok) {
        const corpo = resposta.status === 204 ? null : await resposta.json();

        return { corpo, status: resposta.status };
      }

      if (tolerar.includes(resposta.status)) return { corpo: null, status: resposta.status };

      const detalhe = await resposta.text().catch(() => '');

      ultimoErro = new Error(
        `GitHub respondeu ${resposta.status} em ${caminho}: ${detalhe.slice(0, 400)}`,
      );

      if (!ehStatusRecuperavel(resposta.status) || tentativa === tentativas) throw ultimoErro;

      log.aviso(
        `Tentativa ${tentativa}/${tentativas} falhou (${resposta.status}) em ${caminho}. Repetindo...`,
      );

      await dormir(ESPERA_BASE_EM_MS * 2 ** (tentativa - 1));
    }

    throw ultimoErro;
  }

  return {
    async obterIssue(numero) {
      const { corpo } = await requisitar(`/repos/${repositorio}/issues/${numero}`);

      return corpo;
    },

    async listarComentariosDaIssue(numero, maxPaginas = 3) {
      const comentarios = [];

      for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
        const { corpo } = await requisitar(
          `/repos/${repositorio}/issues/${numero}/comments?per_page=100&page=${pagina}`,
        );

        if (!Array.isArray(corpo) || corpo.length === 0) break;

        comentarios.push(...corpo);

        if (corpo.length < 100) break;
      }

      return comentarios;
    },

    async comentarNaIssue(numero, corpoDoComentario) {
      const { corpo } = await requisitar(`/repos/${repositorio}/issues/${numero}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: corpoDoComentario }),
      });

      return corpo;
    },

    async adicionarRotulos(numero, rotulos) {
      if (rotulos.length === 0) return null;

      const { corpo } = await requisitar(`/repos/${repositorio}/issues/${numero}/labels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labels: rotulos }),
      });

      return corpo;
    },

    /** Remover rotulo ausente devolve 404; isso nao e erro nesta automacao. */
    async removerRotulo(numero, rotulo) {
      const { status } = await requisitar(
        `/repos/${repositorio}/issues/${numero}/labels/${encodeURIComponent(rotulo)}`,
        { method: 'DELETE' },
        { tolerar: [404] },
      );

      return status !== 404;
    },

    /**
     * Permissao do usuario no repositorio: `admin`, `write`, `read` ou `none`.
     * Usada para decidir se um comentario pode disparar reanalise.
     */
    async permissaoDoUsuario(login) {
      const { corpo, status } = await requisitar(
        `/repos/${repositorio}/collaborators/${encodeURIComponent(login)}/permission`,
        {},
        { tolerar: [403, 404] },
      );

      if (status === 403 || status === 404) return 'none';

      return String(corpo?.permission ?? 'none');
    },

    /** Pull Requests abertos cuja branch de origem e a informada. */
    async listarPullRequestsDaBranch(branch, dono) {
      const { corpo } = await requisitar(
        `/repos/${repositorio}/pulls?state=open&head=${encodeURIComponent(`${dono}:${branch}`)}`,
      );

      return Array.isArray(corpo) ? corpo : [];
    },

    async criarPullRequest({ titulo, corpo: descricao, branchOrigem, branchDestino }) {
      const { corpo } = await requisitar(`/repos/${repositorio}/pulls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: titulo,
          body: descricao,
          head: branchOrigem,
          base: branchDestino,
          maintainer_can_modify: true,
          draft: false,
        }),
      });

      return corpo;
    },
  };
}
