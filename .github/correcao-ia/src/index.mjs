#!/usr/bin/env node
/**
 * Ponto de entrada da correcao automatizada de bugs por IA.
 *
 * Subcomandos:
 *   triagem   - decide se a Issue do evento deve ser processada e publica os
 *               outputs do workflow. Nao consome tokens de modelo.
 *   executar  - investiga, corrige, valida e abre o Pull Request.
 *
 * Ordem das travas, da mais externa para a mais interna:
 *   1. triagem   - so Issue de bug, so evento previsto, so quem tem permissao
 *   2. analise   - so status "identified" com causa, arquivos e plano
 *   3. escopo    - so caminhos existentes e dentro de "editaveis"
 *   4. aplicacao - so trecho que casa exatamente uma vez
 *   5. validacao - so com build e testes verdes o Pull Request e aberto
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { criarProvedor, RecusaDoModeloError } from '../../revisao-ia/src/provedor.mjs';
import { criarLog, registrarSegredo } from '../../revisao-ia/src/log.mjs';

import { carregarConfiguracao } from './config.mjs';
import { criarClienteGitHub } from './github.mjs';
import { criarGit, garantirBranchAutomatica } from './git.mjs';
import { ehBug, montarNomeDaBranch, normalizarIssue, pedeReanalise } from './issue.mjs';
import {
  interpretarCorrecao,
  interpretarRodada,
  normalizarAnalise,
  podeCorrigir,
} from './analise.mjs';
import { aplicarAlteracoes, AlteracaoInaplicavelError, resumirAlteracoes } from './alteracoes.mjs';
import {
  buscarNoCodigo,
  estaNoEscopoDeEdicao,
  lerArquivoParaAnalise,
  lerArquivoParaEdicao,
  listarArvore,
} from './repositorio.mjs';
import { avaliarValidacoes, executarValidacoes, selecionarValidacoes } from './validacoes.mjs';
import {
  montarMensagemDeCommit,
  montarTituloDoPullRequest,
  renderizarComentarioDeAnaliseManual,
  renderizarComentarioDeInterrupcao,
  renderizarComentarioDePullRequest,
  renderizarComentarioDePullRequestExistente,
  renderizarComentarioDeValidacaoReprovada,
  renderizarDescricaoDoPullRequest,
} from './comentario.mjs';
import {
  montarPromptDeCorrecao,
  montarPromptDeCorrecaoDoUsuario,
  montarPromptDeInvestigacao,
  montarPromptDeRodada,
} from './prompt.mjs';

const log = criarLog('correcao-ia');

const DIRETORIO_DO_SCRIPT = dirname(fileURLToPath(import.meta.url));
const RAIZ_DA_ACAO = resolve(DIRETORIO_DO_SCRIPT, '..');
const RAIZ_DO_REPOSITORIO = process.env.GITHUB_WORKSPACE
  ? resolve(process.env.GITHUB_WORKSPACE)
  : resolve(RAIZ_DA_ACAO, '..', '..');

const AUTOR_DO_COMMIT = {
  nome: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};

function publicarOutput(nome, valor) {
  const destino = process.env.GITHUB_OUTPUT;

  if (!destino) {
    log.info(`output ${nome}=${valor}`);
    return;
  }

  appendFileSync(destino, `${nome}=${valor}\n`, 'utf8');
}

function publicarResumoDaEtapa(markdown) {
  const destino = process.env.GITHUB_STEP_SUMMARY;

  if (!destino) return;

  appendFileSync(destino, `${markdown}\n`, 'utf8');
}

function lerEvento() {
  const caminho = process.env.GITHUB_EVENT_PATH;

  if (!caminho || !existsSync(caminho)) return {};

  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (erro) {
    log.aviso(`Nao foi possivel ler o payload do evento: ${erro.message}`);

    return {};
  }
}

function lerArquivoDeConvencoes(configuracao) {
  const caminho = configuracao.arquivoDeConvencoes;

  if (!caminho) return null;

  for (const base of [RAIZ_DO_REPOSITORIO, RAIZ_DA_ACAO]) {
    const absoluto = resolve(base, caminho);

    if (!existsSync(absoluto)) continue;

    const conteudo = readFileSync(absoluto, 'utf8');

    log.info(`Convencoes carregadas de "${caminho}" (${conteudo.length} caracteres).`);

    return conteudo;
  }

  log.aviso(`Arquivo de convencoes "${caminho}" nao encontrado. Seguindo sem convencoes declaradas.`);

  return null;
}

function montarAmbiente() {
  const token = process.env.GITHUB_TOKEN;

  registrarSegredo(token);

  const configuracao = carregarConfiguracao(join(RAIZ_DA_ACAO, 'corretor.config.json'));
  const repositorio = process.env.GITHUB_REPOSITORY;

  const cliente = criarClienteGitHub({ token, repositorio });

  return { configuracao, cliente, repositorio };
}

/**
 * Le uma variavel de ambiente tratando string vazia como ausente.
 *
 * O Actions define a variavel mesmo quando a expressao que a alimenta e vazia:
 * `CORRECAO_NUMERO_ISSUE: ${{ inputs.numero_da_issue }}` vira `""` em um evento
 * de Issue, e nao `undefined`. Por isso `??` nao serve aqui — ele so cai para o
 * padrao em null/undefined, e a string vazia venceria o valor do payload.
 */
function lerVariavel(nome) {
  const valor = process.env[nome];

  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

/**
 * Numero da Issue do evento, com validacao.
 *
 * O numero e usado para montar caminhos de API e o nome da branch, entao ele
 * precisa ser um inteiro positivo, e nao apenas "o que veio no payload".
 */
function numeroDaIssueDoEvento(evento) {
  const bruto = lerVariavel('CORRECAO_NUMERO_ISSUE') ?? evento?.issue?.number;

  if (bruto === undefined || bruto === null) return null;

  const numero = Number.parseInt(bruto, 10);

  if (!Number.isFinite(numero) || numero <= 0 || String(numero) !== String(bruto).trim()) {
    return null;
  }

  return numero;
}

// ---------------------------------------------------------------------------
// Subcomando: triagem
// ---------------------------------------------------------------------------

/**
 * Obtem os dados da Issue para a triagem.
 *
 * Os eventos `issues` e `issue_comment` trazem a Issue inteira no payload. O
 * `workflow_dispatch` nao traz nada: ali so existe o numero informado a mao, e
 * ler `github.event.issue` devolveria titulo e rotulos vazios — a Issue seria
 * classificada como "nao e um bug" por falta de dado, e nao por conteudo.
 * Nesse caso, buscamos a Issue na API.
 *
 * @returns {Promise<{ bruta: object, origem: string }>}
 */
async function obterIssueParaTriagem({ evento, numero, cliente }) {
  const doPayload = evento?.issue;

  if (doPayload && Number(doPayload.number) === numero) {
    return { bruta: doPayload, origem: 'do payload do evento' };
  }

  return { bruta: await cliente.obterIssue(numero), origem: 'da API do GitHub' };
}

/**
 * Decide se o evento deve disparar a analise.
 *
 * @returns {Promise<{ processar: boolean, numero: number|null, motivo: string }>}
 */
export async function decidirTriagem({ evento, nomeDoEvento, configuracao, cliente }) {
  const numero = numeroDaIssueDoEvento(evento);

  if (numero === null) return { processar: false, numero: null, motivo: 'evento sem numero de Issue valido' };

  const { bruta: issueBruta, origem } = await obterIssueParaTriagem({ evento, numero, cliente });

  if (issueBruta?.pull_request) {
    return { processar: false, numero, motivo: 'o evento e de um Pull Request, nao de uma Issue' };
  }

  const issue = normalizarIssue(issueBruta ?? {}, [], configuracao);

  log.info(
    `Issue #${numero} lida ${origem}: titulo "${issue.titulo}", `
      + `estado "${issue.estado}", rotulos [${issue.rotulos.join(', ')}].`,
  );

  if (issue.estado !== 'open') {
    return { processar: false, numero, motivo: 'a Issue esta fechada' };
  }

  if (!ehBug(issue, configuracao)) {
    return {
      processar: false,
      numero,
      motivo: `a Issue nao e um bug: o titulo "${issue.titulo}" nao comeca com `
        + `${configuracao.prefixosDeTitulo.join('/')} e os rotulos `
        + `[${issue.rotulos.join(', ') || 'nenhum'}] nao incluem `
        + `${configuracao.rotulosDeBug.join('/')}`,
    };
  }

  if (issue.rotulos.includes(configuracao.rotuloEmAndamento)) {
    return {
      processar: false,
      numero,
      motivo: `ja existe uma analise em andamento (rotulo "${configuracao.rotuloEmAndamento}")`,
    };
  }

  if (nomeDoEvento === 'issue_comment') {
    const comentario = evento?.comment ?? {};

    if (!pedeReanalise(comentario.body, configuracao.comandoDeReanalise)) {
      return {
        processar: false,
        numero,
        motivo: `o comentario nao contem o comando "${configuracao.comandoDeReanalise}"`,
      };
    }

    // Reanalise e uma acao que gasta tokens e escreve no repositorio: so quem
    // pode escrever no repositorio pode pedi-la. Sem esta checagem, qualquer
    // pessoa que consiga comentar dispararia o agente.
    const login = String(comentario.user?.login ?? '');
    const permissao = await cliente.permissaoDoUsuario(login);

    if (!['admin', 'write', 'maintain'].includes(permissao)) {
      return {
        processar: false,
        numero,
        motivo: `o autor do comentario nao tem permissao de escrita no repositorio (${permissao})`,
      };
    }

    return { processar: true, numero, motivo: 'reanalise solicitada por usuario autorizado' };
  }

  const acao = String(evento?.action ?? '');

  if (acao === 'edited' && issue.rotulos.includes(configuracao.rotuloConcluido)) {
    return {
      processar: false,
      numero,
      motivo: `a Issue ja foi analisada (rotulo "${configuracao.rotuloConcluido}"). `
        + `Comente "${configuracao.comandoDeReanalise}" para uma nova analise`,
    };
  }

  if (acao === 'labeled') {
    const rotuloAdicionado = String(evento?.label?.name ?? '').toLowerCase();
    const rotulosDeBug = configuracao.rotulosDeBug.map((rotulo) => rotulo.toLowerCase());

    if (!rotulosDeBug.includes(rotuloAdicionado)) {
      return { processar: false, numero, motivo: `o rotulo adicionado ("${rotuloAdicionado}") nao e de bug` };
    }

    if (issue.rotulos.includes(configuracao.rotuloConcluido)) {
      return { processar: false, numero, motivo: 'a Issue ja foi analisada' };
    }
  }

  const gatilho = acao === '' ? nomeDoEvento : `${nomeDoEvento}/${acao}`;

  return { processar: true, numero, motivo: `Issue de bug no evento "${gatilho}"` };
}

async function executarTriagem() {
  const { configuracao, cliente } = montarAmbiente();
  const evento = lerEvento();
  const nomeDoEvento = lerVariavel('GITHUB_EVENT_NAME') ?? 'workflow_dispatch';

  const decisao = await decidirTriagem({ evento, nomeDoEvento, configuracao, cliente });

  publicarOutput('processar', decisao.processar ? 'true' : 'false');
  publicarOutput('numero', decisao.numero === null ? '' : String(decisao.numero));
  publicarOutput('motivo', decisao.motivo);

  log.info(
    decisao.processar
      ? `Issue #${decisao.numero} sera analisada: ${decisao.motivo}.`
      : `Nada a fazer: ${decisao.motivo}.`,
  );

  return 0;
}

// ---------------------------------------------------------------------------
// Fase 1: investigacao
// ---------------------------------------------------------------------------

/**
 * Executa as rodadas de investigacao ate o modelo concluir ou o limite acabar.
 *
 * Os provedores sao chamados sem historico de conversa: o estado viaja no
 * dossie, remontado a cada rodada. Isso mantem o prompt de sistema estavel
 * (cacheavel) e o adaptador de provedor identico ao usado pela revisao.
 */
export async function investigar({ provedor, issue, arvore, configuracao, promptDeSistema, raiz }) {
  const dossie = { arquivos: [], buscas: [] };
  const jaFornecidos = new Set();
  const jaBuscados = new Set();

  const maxRodadas = configuracao.limites.maxRodadasDeInvestigacao;

  let caracteresAcumulados = 0;
  let ultimaResposta = null;
  let uso = { tokensDeEntrada: 0, tokensDeSaida: 0, tokensLidosDoCache: 0, tokensGravadosNoCache: 0 };

  for (let rodada = 1; rodada <= maxRodadas; rodada += 1) {
    const rodadasRestantes = maxRodadas - rodada;

    const resposta = await provedor.revisar({
      sistema: promptDeSistema,
      usuario: montarPromptDeRodada({ issue, arvore, dossie, rodada, rodadasRestantes }),
    });

    uso = {
      tokensDeEntrada: uso.tokensDeEntrada + (resposta.uso?.tokensDeEntrada ?? 0),
      tokensDeSaida: uso.tokensDeSaida + (resposta.uso?.tokensDeSaida ?? 0),
      tokensLidosDoCache: uso.tokensLidosDoCache + (resposta.uso?.tokensLidosDoCache ?? 0),
      tokensGravadosNoCache: uso.tokensGravadosNoCache + (resposta.uso?.tokensGravadosNoCache ?? 0),
    };

    const rodadaInterpretada = interpretarRodada(resposta.texto, configuracao);

    ultimaResposta = rodadaInterpretada;

    if (rodadaInterpretada.acao === 'concluir') {
      log.info(`Rodada ${rodada}: o modelo concluiu a investigacao.`);

      return { bruto: rodadaInterpretada.bruto, dossie, uso, rodadas: rodada };
    }

    log.info(
      `Rodada ${rodada}: o modelo pediu ${rodadaInterpretada.arquivos.length} arquivo(s) e `
        + `${rodadaInterpretada.buscas.length} busca(s).`,
    );

    for (const termo of rodadaInterpretada.buscas) {
      if (jaBuscados.has(termo)) continue;

      jaBuscados.add(termo);
      dossie.buscas.push(buscarNoCodigo(termo, raiz, configuracao));
    }

    for (const caminho of rodadaInterpretada.arquivos) {
      if (jaFornecidos.has(caminho)) continue;

      jaFornecidos.add(caminho);

      const leitura = lerArquivoParaAnalise(caminho, raiz, configuracao);

      if (leitura.ok && caracteresAcumulados + leitura.conteudo.length
        > configuracao.limites.maxCaracteresTotal) {
        dossie.arquivos.push({
          ok: false,
          caminho: leitura.caminho,
          motivo: 'limite total de caracteres da investigacao atingido',
        });
        continue;
      }

      if (leitura.ok) caracteresAcumulados += leitura.conteudo.length;

      dossie.arquivos.push(leitura);
    }
  }

  // O modelo esgotou as rodadas sem concluir. A ultima resposta ainda pode
  // trazer campos uteis; o status vira "uncertain" na normalizacao.
  return {
    bruto: { ...(ultimaResposta?.bruto ?? {}), status: 'uncertain' },
    dossie,
    uso,
    rodadas: maxRodadas,
    esgotouRodadas: true,
  };
}

// ---------------------------------------------------------------------------
// Subcomando: executar
// ---------------------------------------------------------------------------

async function executarCorrecao() {
  const { configuracao, cliente, repositorio } = montarAmbiente();
  const evento = lerEvento();

  const numero = numeroDaIssueDoEvento(evento);

  if (numero === null) throw new Error('Nao foi possivel identificar o numero da Issue do evento.');

  const issueBruta = await cliente.obterIssue(numero);

  if (issueBruta?.pull_request) throw new Error(`#${numero} e um Pull Request, nao uma Issue.`);

  const comentarios = await cliente.listarComentariosDaIssue(numero);
  const issue = normalizarIssue(issueBruta, comentarios, configuracao);

  if (!ehBug(issue, configuracao)) {
    log.info(`A Issue #${numero} nao e um bug. Nada a fazer.`);

    return 0;
  }

  if (issue.segredosRedigidos > 0) {
    log.aviso(
      `${issue.segredosRedigidos} trecho(s) com aparencia de segredo foram redigidos do texto da Issue.`,
    );
  }

  const branch = garantirBranchAutomatica(
    montarNomeDaBranch({
      prefixo: configuracao.prefixoDaBranch,
      descricao: issue.titulo,
      numeroDaIssue: issue.numero,
    }),
    configuracao,
  );

  const dono = repositorio.split('/')[0];

  // Controle de duplicidade: se ja existe um PR automatico aberto para esta
  // Issue, a execucao vira um comentario de status.
  const abertos = await cliente.listarPullRequestsDaBranch(branch, dono);

  if (abertos.length > 0) {
    log.info(`Ja existe Pull Request aberto para "${branch}" (#${abertos[0].number}).`);

    await publicar(cliente, configuracao, numero,
      renderizarComentarioDePullRequestExistente({ issue, pullRequest: abertos[0], branch }));

    return 0;
  }

  const git = criarGit(RAIZ_DO_REPOSITORIO, undefined, { somenteLeitura: configuracao.simulacao });
  const provedor = criarProvedor(configuracao);
  const convencoes = lerArquivoDeConvencoes(configuracao);

  await marcarEmAndamento(cliente, configuracao, numero, true);

  try {
    const shaDaBase = git.shaDaBase(configuracao.branchBase);

    log.info(`Base "${configuracao.branchBase}" no commit ${shaDaBase.slice(0, 8)}.`);

    const arvore = listarArvore(RAIZ_DO_REPOSITORIO, configuracao);

    log.info(`Arvore do repositorio: ${arvore.arquivos.length} arquivo(s) analisavel(is).`);

    const investigacao = await investigar({
      provedor,
      issue,
      arvore,
      configuracao,
      promptDeSistema: montarPromptDeInvestigacao(convencoes),
      raiz: RAIZ_DO_REPOSITORIO,
    });

    const arquivosExistentes = new Set(arvore.arquivos.map((arquivo) => arquivo.caminho));

    const analise = normalizarAnalise(investigacao.bruto, {
      caminhoEhEditavel: (caminho) =>
        estaNoEscopoDeEdicao(caminho, configuracao).permitido,
      arquivosExistentes,
      configuracao,
    });

    analise.arquivosInvestigados = investigacao.dossie.arquivos
      .filter((arquivo) => arquivo.ok)
      .map((arquivo) => arquivo.caminho);
    analise.buscasRealizadas = investigacao.dossie.buscas.map((busca) => busca.termo);

    log.info(
      `Analise: status "${analise.status}", confianca ${analise.confianca}, `
        + `${analise.arquivosAfetados.length} arquivo(s) afetado(s), `
        + `${investigacao.rodadas} rodada(s), ${investigacao.uso.tokensDeEntrada} tokens de entrada.`,
    );

    const decisao = podeCorrigir(analise);

    if (!decisao.pode) {
      log.info(`Correcao nao autorizada: ${decisao.motivo}.`);

      await publicar(cliente, configuracao, numero,
        renderizarComentarioDeAnaliseManual({ analise, issue }));

      publicarResumoDaEtapa(
        `Issue #${numero}: nenhuma alteracao feita (${decisao.motivo}).`,
      );

      await concluir(cliente, configuracao, numero);

      return 0;
    }

    // A partir daqui o codigo e alterado. A branch automatica e criada antes
    // de qualquer escrita, no mesmo commit da base usado na leitura.
    git.configurarAutor(AUTOR_DO_COMMIT.nome, AUTOR_DO_COMMIT.email);
    git.criarBranchNoCommit(branch, shaDaBase);

    // No ensaio o checkout nao acontece, entao o HEAD continua onde estava e a
    // conferencia nao se aplica.
    if (!configuracao.simulacao) {
      const atual = git.branchAtual();

      if (atual !== branch) {
        throw new Error(`Esperado estar em "${branch}", mas o HEAD esta em "${atual}".`);
      }

      garantirBranchAutomatica(atual, configuracao);
    }

    const arquivosParaEdicao = [];
    const conteudoPorArquivo = new Map();

    for (const caminho of analise.arquivosAfetados) {
      const leitura = lerArquivoParaEdicao(caminho, RAIZ_DO_REPOSITORIO, configuracao);

      if (!leitura.ok) {
        log.aviso(`Arquivo "${caminho}" ignorado na correcao: ${leitura.motivo}.`);
        continue;
      }

      conteudoPorArquivo.set(leitura.caminho, leitura.conteudo);

      if (leitura.existe) {
        arquivosParaEdicao.push({ caminho: leitura.caminho, conteudo: leitura.conteudo });
      }
    }

    if (arquivosParaEdicao.length === 0) {
      throw new Error('Nenhum dos arquivos apontados pode ser lido para edicao.');
    }

    const respostaDaCorrecao = await provedor.revisar({
      sistema: montarPromptDeCorrecao(convencoes),
      usuario: montarPromptDeCorrecaoDoUsuario({ issue, analise, arquivos: arquivosParaEdicao }),
    });

    const correcao = interpretarCorrecao(respostaDaCorrecao.texto, {
      caminhoEhEditavel: (caminho) => estaNoEscopoDeEdicao(caminho, configuracao).permitido,
      configuracao,
    });

    if (correcao.status !== 'corrigido' || correcao.alteracoes.length === 0) {
      log.info('O modelo nao produziu alteracoes aplicaveis.');

      await publicar(cliente, configuracao, numero, renderizarComentarioDeInterrupcao({
        issue,
        etapa: 'implementacao da correcao',
        mensagem: correcao.motivo
          || 'o agente nao conseguiu produzir uma alteracao segura com as evidencias coletadas',
        detalhes: correcao.descartadas.map((item) => `\`${item.caminho}\`: ${item.motivo}`),
      }));

      await concluir(cliente, configuracao, numero);

      return 0;
    }

    // Arquivos novos propostos precisam ser carregados como inexistentes para
    // que `aplicarAlteracoes` os aceite.
    for (const alteracao of correcao.alteracoes) {
      if (conteudoPorArquivo.has(alteracao.caminho)) continue;

      const leitura = lerArquivoParaEdicao(alteracao.caminho, RAIZ_DO_REPOSITORIO, configuracao);

      if (!leitura.ok) {
        throw new AlteracaoInaplicavelError(alteracao.caminho, leitura.motivo);
      }

      conteudoPorArquivo.set(leitura.caminho, leitura.conteudo);
    }

    let aplicacao;

    try {
      aplicacao = aplicarAlteracoes(conteudoPorArquivo, correcao.alteracoes);
    } catch (erro) {
      if (!(erro instanceof AlteracaoInaplicavelError)) throw erro;

      log.erro(erro.message);

      await publicar(cliente, configuracao, numero, renderizarComentarioDeInterrupcao({
        issue,
        etapa: 'aplicacao da correcao',
        mensagem: erro.message,
        detalhes: [
          'A correcao e aplicada por substituicao de trecho exato. Um trecho que nao casa '
            + 'exatamente uma vez interrompe o processo, em vez de alterar o arquivo errado.',
        ],
      }));

      await concluir(cliente, configuracao, numero);

      return 0;
    }

    const caminhosAlterados = [...aplicacao.resultado.keys()];
    const resumoDasAlteracoes = resumirAlteracoes(conteudoPorArquivo, aplicacao.resultado);

    // O ensaio para aqui de proposito: ele nao grava em disco, para nao sujar o
    // repositorio de quem esta rodando, e por isso tambem nao roda as
    // validacoes, que precisariam dos arquivos ja alterados.
    if (configuracao.simulacao) {
      log.info('Modo de ensaio: nada sera gravado, validado ou publicado.');

      for (const item of resumoDasAlteracoes) {
        log.info(
          `  ${item.caminho}: ${item.linhasAntes} -> ${item.linhasDepois} linhas `
            + `(${item.variacao >= 0 ? '+' : ''}${item.variacao})`,
        );
      }

      process.stdout.write(
        `\n=========== PULL REQUEST QUE SERIA ABERTO ===========\n`
          + `titulo: ${montarTituloDoPullRequest(issue, correcao)}\n`
          + `branch: ${branch} -> ${configuracao.branchBase}\n\n`
          + `${renderizarDescricaoDoPullRequest({
            issue,
            analise,
            correcao,
            arquivosAlterados: caminhosAlterados,
            resultados: selecionarValidacoes(caminhosAlterados, configuracao).map((validacao) => ({
              comando: validacao.comando.join(' '),
              situacao: 'nao executada no ensaio',
              detalhe: 'o ensaio nao grava arquivos',
            })),
            provedor,
          })}\n`
          + '=====================================================\n\n',
      );

      return 0;
    }

    for (const [caminho, conteudo] of aplicacao.resultado) {
      const absoluto = resolve(RAIZ_DO_REPOSITORIO, caminho);

      mkdirSync(dirname(absoluto), { recursive: true });
      writeFileSync(absoluto, conteudo, 'utf8');

      log.info(`Arquivo gravado: ${caminho}`);
    }

    for (const item of resumoDasAlteracoes) {
      log.info(
        `  ${item.caminho}: ${item.linhasAntes} -> ${item.linhasDepois} linhas `
          + `(${item.variacao >= 0 ? '+' : ''}${item.variacao})`,
      );
    }

    const selecionadas = selecionarValidacoes(caminhosAlterados, configuracao);

    log.info(
      `Validacoes aplicaveis: ${selecionadas.map((item) => item.chave).join(', ') || '(nenhuma)'}.`,
    );

    const resultados = executarValidacoes(selecionadas, RAIZ_DO_REPOSITORIO);
    const avaliacao = avaliarValidacoes(resultados);

    if (!avaliacao.aprovado) {
      log.erro(`Validacao reprovada: ${avaliacao.motivo}. Nenhum Pull Request sera aberto.`);

      await publicar(cliente, configuracao, numero, renderizarComentarioDeValidacaoReprovada({
        analise,
        issue,
        resultados,
        avaliacao,
        branch,
      }));

      publicarResumoDaEtapa(`Issue #${numero}: correcao reprovada nas validacoes (${avaliacao.motivo}).`);

      await concluir(cliente, configuracao, numero);

      return 0;
    }

    // As validacoes rodam ferramentas de build reais, que podem sujar a arvore
    // de trabalho. Commitar apenas os caminhos escritos pelo agente ja protege,
    // mas registrar o que sobrou torna o comportamento auditavel no log.
    const inesperados = git.arquivosAlterados()
      .filter((caminho) => !caminhosAlterados.includes(caminho));

    if (inesperados.length > 0) {
      log.aviso(
        `Arquivos alterados fora da correcao e ignorados no commit: ${inesperados.join(', ')}.`,
      );
    }

    const commit = git.commitar(montarMensagemDeCommit(issue, correcao), caminhosAlterados);

    if (!commit.criado) {
      throw new Error('As alteracoes propostas nao produziram diferenca em relacao a base.');
    }

    log.info(`Commit criado: ${commit.sha.slice(0, 8)}.`);

    // Ultima conferencia antes de publicar: nenhum arquivo fora do escopo
    // editavel pode ter entrado no commit.
    const doDiff = git.arquivosDoDiff(shaDaBase);
    const foraDoEscopo = doDiff.filter(
      (caminho) => !estaNoEscopoDeEdicao(caminho, configuracao).permitido,
    );

    if (foraDoEscopo.length > 0) {
      throw new Error(
        `O commit inclui arquivos fora do escopo editavel: ${foraDoEscopo.join(', ')}.`,
      );
    }

    garantirBranchAutomatica(git.branchAtual(), configuracao);
    git.publicarBranch(branch);

    log.info(`Branch "${branch}" publicada.`);

    const pullRequest = await cliente.criarPullRequest({
      titulo: montarTituloDoPullRequest(issue, correcao),
      corpo: renderizarDescricaoDoPullRequest({
        issue,
        analise,
        correcao,
        arquivosAlterados: doDiff,
        resultados,
        provedor,
      }),
      branchOrigem: branch,
      branchDestino: configuracao.branchBase,
    });

    log.info(`Pull Request aberto: ${pullRequest.html_url}`);

    await publicar(cliente, configuracao, numero,
      renderizarComentarioDePullRequest({ issue, analise, pullRequest, branch }));

    publicarResumoDaEtapa(
      `Issue #${numero}: Pull Request ${pullRequest.html_url} aberto a partir de \`${branch}\`.`,
    );

    await concluir(cliente, configuracao, numero);

    return 0;
  } catch (erro) {
    const mensagem = erro instanceof RecusaDoModeloError
      ? `o modelo recusou processar esta Issue (categoria: ${erro.categoria ?? 'desconhecida'})`
      : erro.message;

    log.erro(`Correcao interrompida: ${mensagem}`);

    if (erro.stack) log.depuracao(erro.stack);

    await publicar(cliente, configuracao, numero, renderizarComentarioDeInterrupcao({
      issue,
      etapa: 'execucao da automacao',
      mensagem,
    })).catch((falha) => log.aviso(`Nao foi possivel comentar na Issue: ${falha.message}`));

    return 1;
  } finally {
    await marcarEmAndamento(cliente, configuracao, numero, false)
      .catch((falha) => log.aviso(`Nao foi possivel remover o rotulo de andamento: ${falha.message}`));
  }
}

/** Publica um comentario, respeitando o modo de simulacao. */
async function publicar(cliente, configuracao, numero, corpo) {
  if (configuracao.simulacao) {
    process.stdout.write(`\n=========== COMENTARIO QUE SERIA PUBLICADO ===========\n${corpo}\n`);
    process.stdout.write('=====================================================\n\n');

    return null;
  }

  return cliente.comentarNaIssue(numero, corpo);
}

async function marcarEmAndamento(cliente, configuracao, numero, ativo) {
  if (configuracao.simulacao) return;

  if (ativo) {
    await cliente.adicionarRotulos(numero, [configuracao.rotuloEmAndamento]);

    return;
  }

  await cliente.removerRotulo(numero, configuracao.rotuloEmAndamento);
}

async function concluir(cliente, configuracao, numero) {
  if (configuracao.simulacao) return;

  await cliente.adicionarRotulos(numero, [configuracao.rotuloConcluido])
    .catch((erro) => log.aviso(`Nao foi possivel aplicar o rotulo de conclusao: ${erro.message}`));
}

// ---------------------------------------------------------------------------

async function principal() {
  const subcomando = process.argv[2] ?? 'executar';

  if (subcomando === 'triagem') return executarTriagem();
  if (subcomando === 'executar') return executarCorrecao();

  throw new Error(`Subcomando desconhecido: "${subcomando}". Use "triagem" ou "executar".`);
}

/**
 * So executa quando chamado como programa.
 *
 * Sem esta guarda, importar o modulo em um teste dispararia a automacao
 * inteira: `decidirTriagem` e `investigar` sao exportados justamente para
 * serem exercitados sem rede.
 */
function ehPontoDeEntrada() {
  const invocado = process.argv[1];

  if (!invocado) return false;

  return resolve(invocado) === resolve(fileURLToPath(import.meta.url));
}

if (ehPontoDeEntrada()) {
  principal()
    .then((codigo) => {
      process.exitCode = codigo ?? 0;
    })
    .catch((erro) => {
      log.erro(`Erro nao tratado na correcao automatizada: ${erro.message}`);

      if (erro.stack) log.depuracao(erro.stack);

      process.exitCode = 1;
    });
}
