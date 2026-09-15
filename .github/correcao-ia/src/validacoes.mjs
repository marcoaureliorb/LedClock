/**
 * Execucao das validacoes do projeto (build, testes, verificacao de sintaxe).
 *
 * Regra de seguranca central do agente: o comando executado vem SEMPRE do
 * `corretor.config.json`, como array de argumentos, e roda com `shell: false`.
 * Nem a Issue nem a resposta do modelo conseguem introduzir um comando novo ou
 * um argumento a mais. O campo `tests_to_run` devolvido pela IA e apenas
 * informativo e aparece no relatorio, nunca na linha de comando.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { correspondeAAlgum } from '../../revisao-ia/src/caminhos.mjs';
import { criarLog } from '../../revisao-ia/src/log.mjs';

const log = criarLog('correcao-ia');

const MAX_CARACTERES_DE_SAIDA = 3000;

function recortarFim(texto, limite = MAX_CARACTERES_DE_SAIDA) {
  const limpo = String(texto ?? '').trimEnd();

  if (limpo.length <= limite) return limpo;

  return `[... saida truncada ...]\n${limpo.slice(-limite)}`;
}

/**
 * Seleciona as validacoes aplicaveis aos arquivos alterados.
 *
 * Uma validacao sem `gatilho` roda sempre; com `gatilho`, roda quando pelo
 * menos um arquivo alterado casa com algum dos globs.
 */
export function selecionarValidacoes(caminhosAlterados, configuracao) {
  return configuracao.validacoes.filter((validacao) => {
    if (!validacao.habilitada) return false;
    if (validacao.gatilho.length === 0) return true;

    return caminhosAlterados.some((caminho) => correspondeAAlgum(caminho, validacao.gatilho));
  });
}

/**
 * Executa uma validacao e devolve o resultado normalizado.
 *
 * @param {object} validacao validacao ja normalizada pela configuracao
 * @param {string} raiz raiz do repositorio
 * @param {Function} [executar] injecao para teste; por padrao `spawnSync`
 */
export function executarValidacao(validacao, raiz, executar = spawnSync) {
  const [programa, ...argumentos] = validacao.comando;
  const rotulo = validacao.comando.join(' ');

  log.info(`Executando validacao "${validacao.chave}": ${rotulo}`);

  let saida;

  try {
    saida = executar(programa, argumentos, {
      cwd: resolve(raiz, validacao.diretorio),
      encoding: 'utf8',
      timeout: validacao.timeoutEmSegundos * 1000,
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
  } catch (erro) {
    return {
      chave: validacao.chave,
      comando: rotulo,
      obrigatoria: validacao.obrigatoria,
      situacao: 'indisponivel',
      detalhe: `nao foi possivel iniciar o comando: ${erro.message}`,
    };
  }

  if (saida?.error) {
    const indisponivel = saida.error.code === 'ENOENT' || saida.error.code === 'EINVAL';

    return {
      chave: validacao.chave,
      comando: rotulo,
      obrigatoria: validacao.obrigatoria,
      situacao: indisponivel ? 'indisponivel' : 'falhou',
      detalhe: indisponivel
        ? `o programa "${programa}" nao esta disponivel neste ambiente`
        : `erro ao executar: ${saida.error.message}`,
    };
  }

  if (saida.signal) {
    return {
      chave: validacao.chave,
      comando: rotulo,
      obrigatoria: validacao.obrigatoria,
      situacao: 'falhou',
      detalhe: `interrompido pelo sinal ${saida.signal} (limite de ${validacao.timeoutEmSegundos}s)`,
      saida: recortarFim(`${saida.stdout ?? ''}\n${saida.stderr ?? ''}`),
    };
  }

  const sucesso = saida.status === 0;

  return {
    chave: validacao.chave,
    comando: rotulo,
    obrigatoria: validacao.obrigatoria,
    situacao: sucesso ? 'sucesso' : 'falhou',
    codigoDeSaida: saida.status,
    detalhe: sucesso ? 'concluida sem erros' : `terminou com codigo ${saida.status}`,
    saida: recortarFim(`${saida.stdout ?? ''}\n${saida.stderr ?? ''}`),
  };
}

/** Executa todas as validacoes selecionadas, em ordem. */
export function executarValidacoes(validacoes, raiz, executar = spawnSync) {
  return validacoes.map((validacao) => executarValidacao(validacao, raiz, executar));
}

/**
 * Decide se as validacoes autorizam abrir o Pull Request.
 *
 * Uma validacao obrigatoria indisponivel tambem impede o PR: sem o build nao ha
 * evidencia de que a correcao compila, e a saida da IA nao e evidencia de que o
 * bug foi corrigido.
 */
export function avaliarValidacoes(resultados) {
  const falharam = resultados.filter((item) => item.situacao === 'falhou');

  const indisponiveisObrigatorias = resultados.filter(
    (item) => item.situacao === 'indisponivel' && item.obrigatoria,
  );

  if (falharam.length > 0) {
    return {
      aprovado: false,
      motivo: `${falharam.length} validacao(oes) falharam: `
        + falharam.map((item) => item.chave).join(', '),
      falharam,
    };
  }

  if (indisponiveisObrigatorias.length > 0) {
    return {
      aprovado: false,
      motivo: 'validacao obrigatoria nao pode ser executada: '
        + indisponiveisObrigatorias.map((item) => item.chave).join(', '),
      falharam: indisponiveisObrigatorias,
    };
  }

  if (resultados.length === 0) {
    return {
      aprovado: false,
      motivo: 'nenhuma validacao foi aplicavel aos arquivos alterados, '
        + 'entao nao ha evidencia de que a correcao funciona',
      falharam: [],
    };
  }

  return {
    aprovado: true,
    motivo: `${resultados.length} validacao(oes) executadas com sucesso`,
    falharam: [],
  };
}
