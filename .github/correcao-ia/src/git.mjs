/**
 * Operacoes de Git da correcao automatizada.
 *
 * Todo comando roda com `shell: false` e lista fixa de argumentos. O unico dado
 * variavel e o nome da branch, que passa por `garantirBranchAutomatica` antes
 * de qualquer escrita: o prefixo obrigatorio e a recusa em tocar na branch base
 * sao o que impede a automacao de escrever direto na `main`.
 */

import { spawnSync } from 'node:child_process';

import { criarLog } from '../../revisao-ia/src/log.mjs';

const log = criarLog('correcao-ia');

export class GitError extends Error {
  constructor(argumentos, saida) {
    super(`git ${argumentos.join(' ')} falhou (codigo ${saida.status}): ${saida.stderr?.trim()}`);
    this.name = 'GitError';
    this.codigo = saida.status;
    this.stderr = saida.stderr;
  }
}

/**
 * Subcomandos que alteram o repositorio ou a rede. No modo somente-leitura eles
 * sao registrados no log e nao executados, para que o ensaio local do fluxo
 * completo nao crie branch, nao commite e nao faca push no repositorio de quem
 * esta rodando.
 */
const COMANDOS_DE_ESCRITA = new Set(['checkout', 'add', 'commit', 'push', 'config', 'fetch']);

export function criarGit(raiz, executar = spawnSync, { somenteLeitura = false } = {}) {
  function rodar(argumentos, { tolerarFalha = false } = {}) {
    if (somenteLeitura && COMANDOS_DE_ESCRITA.has(argumentos[0])) {
      log.info(`[somente leitura] git ${argumentos.join(' ')} nao foi executado.`);

      return { ok: true, codigo: 0, saida: '', erro: '' };
    }

    const saida = executar('git', argumentos, {
      cwd: raiz,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });

    if (saida?.error) throw new Error(`Nao foi possivel executar o git: ${saida.error.message}`);

    if (saida.status !== 0 && !tolerarFalha) throw new GitError(argumentos, saida);

    return {
      ok: saida.status === 0,
      codigo: saida.status,
      saida: String(saida.stdout ?? '').trim(),
      erro: String(saida.stderr ?? '').trim(),
    };
  }

  return {
    rodar,

    /** Identidade dos commits automaticos. */
    configurarAutor(nome, email) {
      rodar(['config', 'user.name', nome]);
      rodar(['config', 'user.email', email]);
    },

    branchAtual() {
      return rodar(['rev-parse', '--abbrev-ref', 'HEAD']).saida;
    },

    /**
     * Sha do commit mais recente da branch base no remoto.
     *
     * No modo somente-leitura nao ha fetch, entao o commit de referencia passa
     * a ser o HEAD local — suficiente para o ensaio, que nao publica nada.
     */
    shaDaBase(branchBase) {
      if (somenteLeitura) return rodar(['rev-parse', 'HEAD']).saida;

      rodar(['fetch', '--depth=1', 'origin', branchBase]);

      return rodar(['rev-parse', 'FETCH_HEAD']).saida;
    },

    branchRemotaExiste(branch) {
      const resultado = rodar(['ls-remote', '--heads', 'origin', branch], { tolerarFalha: true });

      return resultado.ok && resultado.saida !== '';
    },

    /**
     * Cria a branch automatica em um commit ja conhecido da base.
     *
     * O sha e obtido uma unica vez, no inicio da execucao, por
     * `shaDaBase`: usar o mesmo commit na leitura dos arquivos e na criacao da
     * branch impede que um push na base durante a analise produza uma correcao
     * baseada em conteudo que ja mudou.
     */
    criarBranchNoCommit(branch, sha) {
      log.info(`Criando "${branch}" a partir de ${sha.slice(0, 8)}.`);

      rodar(['checkout', '-B', branch, sha]);

      return sha;
    },

    /**
     * Caminhos com alteracao pendente na arvore de trabalho.
     *
     * A saida do `status --porcelain` nao pode ser fatiada por posicao fixa:
     * `rodar` ja removeu os espacos das pontas, e com isso a primeira linha
     * perde o espaco inicial do codigo de status (" M arquivo"). Por isso a
     * separacao e pelo primeiro bloco de espacos depois do codigo.
     */
    arquivosAlterados() {
      return rodar(['status', '--porcelain', '--untracked-files=all'])
        .saida.split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha !== '')
        .map((linha) => {
          const caminho = linha.replace(/^\S{1,2}\s+/, '');

          // Renomeacao vem como "antigo -> novo"; interessa o destino.
          const seta = caminho.lastIndexOf(' -> ');

          return seta === -1 ? caminho : caminho.slice(seta + 4);
        })
        .filter((caminho) => caminho !== '');
    },

    /** Adiciona apenas os caminhos informados e cria o commit. */
    commitar(mensagem, caminhos) {
      if (caminhos.length === 0) throw new Error('Nenhum caminho informado para o commit.');

      rodar(['add', '--', ...caminhos]);

      const preparados = rodar(['diff', '--cached', '--name-only']).saida;

      if (preparados === '') return { criado: false, sha: null };

      rodar(['commit', '-m', mensagem]);

      return { criado: true, sha: rodar(['rev-parse', 'HEAD']).saida };
    },

    /** Publica a branch automatica. Nunca faz push com `--force`. */
    publicarBranch(branch) {
      rodar(['push', 'origin', `HEAD:refs/heads/${branch}`]);
    },

    /** Diferenca resumida contra a base, para conferencia antes do PR. */
    resumoDoDiff(shaDaBase) {
      return rodar(['diff', '--stat', `${shaDaBase}..HEAD`], { tolerarFalha: true }).saida;
    },

    /** Caminhos alterados em relacao a base. */
    arquivosDoDiff(shaDaBase) {
      return rodar(['diff', '--name-only', `${shaDaBase}..HEAD`], { tolerarFalha: true })
        .saida.split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha !== '');
    },
  };
}

/**
 * Recusa qualquer branch que nao seja a automatica.
 *
 * Chamada antes de commit e de push. E a trava que garante o criterio
 * "o workflow nao modifica diretamente a main".
 *
 * @throws {Error} quando a branch nao tem o prefixo exigido ou e a branch base
 */
export function garantirBranchAutomatica(branch, { prefixoDaBranch, branchBase }) {
  const nome = String(branch ?? '').trim();

  if (nome === '') throw new Error('Nome de branch vazio.');

  if (nome === branchBase) {
    throw new Error(`A automacao nao escreve na branch base "${branchBase}".`);
  }

  if (!nome.startsWith(`${prefixoDaBranch}/`)) {
    throw new Error(
      `A branch "${nome}" nao tem o prefixo obrigatorio "${prefixoDaBranch}/". `
        + 'A automacao so escreve em branch automatica.',
    );
  }

  if (!/^[a-z0-9][a-z0-9/-]*$/.test(nome) || nome.includes('..')) {
    throw new Error(`A branch "${nome}" contem caracteres nao permitidos.`);
  }

  return nome;
}
