#!/usr/bin/env node
/**
 * Ponto de entrada da revisao de codigo por IA.
 *
 * Subcomandos:
 *   detectar  - lista os arquivos do PR e publica outputs que habilitam as
 *               verificacoes nativas aplicaveis. Nao consome tokens de modelo.
 *   revisar   - executa a revisao e publica o comentario no PR.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { avaliarBloqueio, extrairJson, normalizarApontamentos } from './apuracao.mjs';
import { carregarConfiguracao } from './config.mjs';
import { correspondeAAlgum } from './caminhos.mjs';
import { criarClienteGitHub } from './github.mjs';
import { criarProvedor, RecusaDoModeloError } from './provedor.mjs';
import { log, registrarSegredo } from './log.mjs';
import { montarContexto, selecionarArquivos } from './diff.mjs';
import { montarPromptDeSistema, montarPromptDeUsuario } from './prompt.mjs';
import { MARCADOR, publicarComentario, renderizarComentario } from './comentario.mjs';

const DIRETORIO_DO_SCRIPT = dirname(fileURLToPath(import.meta.url));
const RAIZ_DA_ACAO = resolve(DIRETORIO_DO_SCRIPT, '..');

function diretorioTemporario() {
  return process.env.RUNNER_TEMP || process.env.TMPDIR || process.env.TEMP || '.';
}

const CACHE_DE_ARQUIVOS = join(diretorioTemporario(), 'revisao-ia-arquivos-pr.json');
const ARQUIVO_DE_VERIFICACOES = join(diretorioTemporario(), 'revisao-ia-verificacoes.json');

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

function lerEventoDoPr() {
  const numeroForcado = Number.parseInt(process.env.REVISAO_NUMERO_PR ?? '', 10);

  if (Number.isFinite(numeroForcado) && numeroForcado > 0) return { numero: numeroForcado };

  const caminho = process.env.GITHUB_EVENT_PATH;

  if (!caminho || !existsSync(caminho)) {
    throw new Error(
      'Nao foi possivel identificar o Pull Request: GITHUB_EVENT_PATH ausente e REVISAO_NUMERO_PR nao informado.',
    );
  }

  const evento = JSON.parse(readFileSync(caminho, 'utf8'));
  const numero = evento.pull_request?.number ?? evento.number;

  if (!numero) throw new Error('O evento recebido nao corresponde a um Pull Request.');

  return {
    numero,
    titulo: evento.pull_request?.title,
    descricao: evento.pull_request?.body,
    branchOrigem: evento.pull_request?.head?.ref,
    branchDestino: evento.pull_request?.base?.ref,
    sha: evento.pull_request?.head?.sha,
  };
}

async function obterArquivosDoPr(cliente, numeroDoPr) {
  if (existsSync(CACHE_DE_ARQUIVOS)) {
    log.info('Reaproveitando a lista de arquivos ja obtida nesta execucao.');

    return JSON.parse(readFileSync(CACHE_DE_ARQUIVOS, 'utf8'));
  }

  const arquivos = await cliente.listarArquivosDoPr(numeroDoPr);

  writeFileSync(CACHE_DE_ARQUIVOS, JSON.stringify(arquivos), 'utf8');

  return arquivos;
}

function lerVerificacoes() {
  if (!existsSync(ARQUIVO_DE_VERIFICACOES)) return [];

  try {
    const conteudo = JSON.parse(readFileSync(ARQUIVO_DE_VERIFICACOES, 'utf8'));

    return Array.isArray(conteudo) ? conteudo : [];
  } catch (erro) {
    log.aviso(`Nao foi possivel ler o resultado das verificacoes nativas: ${erro.message}`);

    return [];
  }
}

function lerArquivoDoDisco(caminho) {
  try {
    const absoluto = resolve(process.cwd(), caminho);

    if (!existsSync(absoluto)) return null;

    return readFileSync(absoluto, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Carrega o markdown de convencoes do repositorio revisado, se houver.
 * Procura primeiro a partir da raiz do repositorio e depois da pasta da acao.
 */
function lerConvencoesDoProjeto(configuracao) {
  const caminho = configuracao.arquivoDeConvencoes;

  if (!caminho) return null;

  const conteudo = lerArquivoDoDisco(caminho) ?? lerArquivoDoDisco(join(RAIZ_DA_ACAO, caminho));

  if (conteudo === null) {
    log.aviso(
      `Arquivo de convencoes "${caminho}" nao encontrado. A revisao seguira sem convencoes declaradas.`,
    );

    return null;
  }

  log.info(`Convencoes do projeto carregadas de "${caminho}" (${conteudo.length} caracteres).`);

  return conteudo;
}

function montarAmbiente() {
  const token = process.env.GITHUB_TOKEN;

  registrarSegredo(token);

  const configuracao = carregarConfiguracao(join(RAIZ_DA_ACAO, 'revisor.config.json'));

  const repositorio = process.env.GITHUB_REPOSITORY;

  const cliente = criarClienteGitHub({ token, repositorio });

  return { configuracao, cliente, repositorio };
}

/** Subcomando `detectar`. */
async function executarDeteccao() {
  const { configuracao, cliente } = montarAmbiente();
  const evento = lerEventoDoPr();

  const arquivos = await obterArquivosDoPr(cliente, evento.numero);
  const caminhos = arquivos.map((arquivo) => arquivo.filename);

  log.info(`O PR #${evento.numero} altera ${caminhos.length} arquivo(s).`);

  const { selecionados } = selecionarArquivos(arquivos, configuracao);

  publicarOutput('total_arquivos', String(caminhos.length));
  publicarOutput('arquivos_revisaveis', String(selecionados.length));
  publicarOutput('tem_revisao', selecionados.length > 0 ? 'true' : 'false');

  for (const [chave, verificacao] of Object.entries(configuracao.verificacoesNativas)) {
    const aplicavel = verificacao.habilitada !== false
      && caminhos.some((caminho) => correspondeAAlgum(caminho, verificacao.gatilho));

    publicarOutput(`rodar_${chave}`, aplicavel ? 'true' : 'false');
    publicarOutput(`dir_${chave}`, verificacao.diretorio ?? '.');

    log.info(`Verificacao "${chave}": ${aplicavel ? 'aplicavel' : 'nao aplicavel'}.`);
  }
}

/** Subcomando `revisar`. */
async function executarRevisao() {
  const { configuracao, cliente, repositorio } = montarAmbiente();
  const evento = lerEventoDoPr();

  const pullRequest = evento.titulo
    ? evento
    : { ...evento, ...(await cliente.obterPullRequest(evento.numero)) };

  const contextoDoLink = {
    servidor: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
    repositorio,
    sha: pullRequest.sha ?? 'HEAD',
  };

  const arquivos = await obterArquivosDoPr(cliente, evento.numero);

  const { selecionados, ignorados } = selecionarArquivos(arquivos, configuracao);

  const verificacoes = lerVerificacoes();

  if (selecionados.length === 0) {
    log.info('Nenhum arquivo revisavel neste PR.');

    const corpo = [
      MARCADOR,
      '## Revisao de codigo por IA',
      '',
      '**Nenhuma alteracao analisavel neste Pull Request.**',
      '',
      'Os arquivos alterados sao binarios, gerados, de configuracao sensivel ou estao fora do escopo',
      'configurado em `.github/revisao-ia/revisor.config.json`.',
      '',
      '<details><summary>Arquivos ignorados</summary>',
      '',
      ...ignorados.map((item) => `- \`${item.caminho}\` - ${item.motivo}`),
      '',
      '</details>',
    ].join('\n');

    await publicarComentario({ cliente, numeroDoPr: evento.numero, corpo });
    publicarResumoDaEtapa('Revisao por IA: nenhuma alteracao analisavel.');

    return 0;
  }

  const contexto = montarContexto({
    selecionados,
    configuracao,
    lerArquivo: lerArquivoDoDisco,
  });

  contexto.naoEnviados.push(...ignorados);

  log.info(
    `Enviando ${contexto.itens.length} arquivo(s) / ${contexto.caracteresTotais} caracteres ao provedor `
      + `"${configuracao.provedor}" (modelo ${configuracao.modelo}).`,
  );

  if (contexto.segredosRedigidos > 0) {
    log.aviso(
      `${contexto.segredosRedigidos} trecho(s) com aparencia de segredo foram redigidos antes do envio.`,
    );
  }

  // `provedor` e criado dentro do try para que um erro de configuracao do
  // provedor tambem vire comentario no PR, e nao apenas log.
  let provedor;
  let resposta;

  try {
    provedor = criarProvedor(configuracao);

    resposta = await provedor.revisar({
      sistema: montarPromptDeSistema(lerConvencoesDoProjeto(configuracao)),
      usuario: montarPromptDeUsuario({ pullRequest, contexto, verificacoes }),
    });
  } catch (erro) {
    const mensagem = erro instanceof RecusaDoModeloError
      ? `O modelo recusou processar este diff (categoria: ${erro.categoria ?? 'desconhecida'}).`
      : `Falha ao consultar o provedor de IA: ${erro.message}`;

    log.erro(mensagem);

    const corpo = renderizarComentario({
      configuracao,
      contexto,
      verificacoes,
      provedor: provedor ?? { nome: configuracao.provedor, modelo: configuracao.modelo },
      contextoDoLink,
      falha: mensagem,
    });

    await publicarComentario({ cliente, numeroDoPr: evento.numero, corpo });
    publicarResumoDaEtapa(`Revisao por IA nao concluida: ${mensagem}`);

    return configuracao.bloquearQuandoApiFalhar ? 1 : 0;
  }

  if (resposta.truncado) {
    log.aviso(
      'A resposta do modelo atingiu o limite de tokens de saida e pode estar incompleta. '
        + 'Considere aumentar REVISAO_MAX_TOKENS_SAIDA ou reduzir REVISAO_MAX_CARACTERES.',
    );
  }

  let resultado;

  try {
    resultado = normalizarApontamentos(extrairJson(resposta.texto), {
      arquivosPermitidos: contexto.itens.map((item) => item.caminho),
      maxApontamentos: configuracao.limites.maxApontamentos,
    });
  } catch (erro) {
    const mensagem = `A resposta do modelo nao pode ser interpretada: ${erro.message}`;

    log.erro(mensagem);

    const corpo = renderizarComentario({
      configuracao,
      contexto,
      verificacoes,
      provedor,
      contextoDoLink,
      falha: mensagem,
    });

    await publicarComentario({ cliente, numeroDoPr: evento.numero, corpo });

    return configuracao.bloquearQuandoApiFalhar ? 1 : 0;
  }

  resultado.uso = resposta.uso;

  const bloqueio = avaliarBloqueio(resultado.apontamentos, configuracao);

  log.info(
    `Revisao concluida: ${resultado.apontamentos.length} apontamento(s), `
      + `${resultado.descartados.length} descartado(s). Bloqueio: ${bloqueio.deveBloquear}.`,
  );

  const corpo = renderizarComentario({
    resultado,
    configuracao,
    contexto,
    verificacoes,
    bloqueio,
    provedor,
    contextoDoLink,
  });

  await publicarComentario({ cliente, numeroDoPr: evento.numero, corpo });
  publicarResumoDaEtapa(corpo);

  if (bloqueio.deveBloquear) {
    log.erro(`Revisao reprovada: ${bloqueio.motivo}.`);

    return 1;
  }

  return 0;
}

async function principal() {
  const subcomando = process.argv[2] ?? 'revisar';

  if (subcomando === 'detectar') {
    await executarDeteccao();

    return 0;
  }

  if (subcomando === 'revisar') return executarRevisao();

  throw new Error(`Subcomando desconhecido: "${subcomando}". Use "detectar" ou "revisar".`);
}

principal()
  .then((codigo) => {
    process.exitCode = codigo ?? 0;
  })
  .catch((erro) => {
    log.erro(`Erro nao tratado na revisao: ${erro.message}`);

    if (erro.stack) log.depuracao(erro.stack);

    // Falha de infraestrutura da propria acao nao deve bloquear o merge por padrao.
    process.exitCode = process.env.REVISAO_BLOQUEAR_QUANDO_API_FALHAR === 'true' ? 1 : 0;
  });
