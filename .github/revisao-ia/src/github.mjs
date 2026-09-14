/**
 * Cliente minimo da API REST do GitHub (apenas o que a revisao precisa).
 *
 * Usa `fetch` nativo do Node 20+, sem dependencias externas. O `fetch` e
 * injetavel para permitir teste sem rede.
 */

import { log } from './log.mjs';

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
  if (!repositorio || !repositorio.includes('/')) {
    throw new Error(`Repositorio invalido: "${repositorio}". Esperado "owner/nome".`);
  }

  const cabecalhos = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'revisao-ia',
  };

  async function requisitar(caminho, opcoes = {}) {
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

        return { corpo, resposta };
      }

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
    /** Metadados do PR (titulo, descricao, branches, sha do head). */
    async obterPullRequest(numeroDoPr) {
      const { corpo } = await requisitar(`/repos/${repositorio}/pulls/${numeroDoPr}`);

      return {
        titulo: corpo.title,
        descricao: corpo.body,
        branchOrigem: corpo.head?.ref,
        branchDestino: corpo.base?.ref,
        sha: corpo.head?.sha,
      };
    },

    /** Lista os arquivos do PR, paginando ate `maxPaginas`. */
    async listarArquivosDoPr(numeroDoPr, maxPaginas = 10) {
      const arquivos = [];

      for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
        const { corpo } = await requisitar(
          `/repos/${repositorio}/pulls/${numeroDoPr}/files?per_page=100&page=${pagina}`,
        );

        if (!Array.isArray(corpo) || corpo.length === 0) break;

        arquivos.push(...corpo);

        if (corpo.length < 100) break;
      }

      return arquivos;
    },

    async listarComentarios(numeroDoPr, maxPaginas = 5) {
      const comentarios = [];

      for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
        const { corpo } = await requisitar(
          `/repos/${repositorio}/issues/${numeroDoPr}/comments?per_page=100&page=${pagina}`,
        );

        if (!Array.isArray(corpo) || corpo.length === 0) break;

        comentarios.push(...corpo);

        if (corpo.length < 100) break;
      }

      return comentarios;
    },

    async criarComentario(numeroDoPr, corpoDoComentario) {
      const { corpo } = await requisitar(`/repos/${repositorio}/issues/${numeroDoPr}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: corpoDoComentario }),
      });

      return corpo;
    },

    async atualizarComentario(idDoComentario, corpoDoComentario) {
      const { corpo } = await requisitar(
        `/repos/${repositorio}/issues/comments/${idDoComentario}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: corpoDoComentario }),
        },
      );

      return corpo;
    },
  };
}
