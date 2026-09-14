/**
 * Ensaio offline do revisor: substitui o `fetch` por respostas simuladas da API do
 * GitHub e do provedor, portanto nao faz nenhuma chamada de rede, nao precisa de PR
 * real, de token ou de chave de API, e nao publica nada.
 *
 * Uso, a partir da raiz do repositorio:
 *
 *   GITHUB_TOKEN=token-falso GITHUB_REPOSITORY=usuario/meu-repositorio \
 *   REVISAO_NUMERO_PR=1 REVISAO_API_KEY=chave-falsa RUNNER_TEMP="$PWD/tmp" \
 *   node --import ./.github/revisao-ia/ensaio/stub-offline.mjs \
 *     .github/revisao-ia/src/index.mjs revisar
 *
 * O comentario que seria publicado aparece no terminal. Serve para conferir o
 * comportamento depois de editar convencoes.md, os globs ou os limites.
 *
 * O segundo apontamento simulado aponta um arquivo fora do PR de proposito: ele deve
 * ser descartado pela validacao, e nao aparecer no comentario.
 */

const ARQUIVOS = [
  {
    filename: 'src/total.js',
    status: 'modified',
    additions: 4,
    deletions: 1,
    patch: '@@ -1,5 +1,8 @@\n function somar(itens) {\n-  return itens.reduce((a, b) => a + b);\n+  let total = 0;\n+  for (const item of itens) total += item.valor;\n+  return total;\n }',
  },
  { filename: 'package-lock.json', status: 'modified', additions: 900, deletions: 12, patch: '@@ -1 +1 @@' },
];

const RESPOSTA_DO_MODELO = {
  resumo: 'Ensaio offline: o PR altera a soma de itens.',
  apontamentos: [
    {
      categoria: 'Erro de implementacao',
      severidade: 'High',
      confianca: 'confirmado',
      arquivo: 'src/total.js',
      linha: 4,
      titulo: 'Soma passa a depender de item.valor sem validar o formato',
      descricao: 'A funcao antes somava numeros e agora espera objetos com "valor".',
      explicacao: 'Chamadores existentes que passam numeros passam a somar undefined.',
      sugestao: 'Validar o formato ou manter compatibilidade.',
      exemplo: 'total += typeof item === "number" ? item : item.valor;',
    },
    {
      categoria: 'Qualidade',
      severidade: 'Critical',
      confianca: 'confirmado',
      arquivo: 'arquivo/que/nao/existe.js',
      linha: 1,
      titulo: 'Apontamento alucinado (deve ser descartado)',
      descricao: 'Arquivo fora do PR.',
      explicacao: '',
      sugestao: '',
      exemplo: '',
    },
  ],
};

globalThis.fetch = async (url, opcoes = {}) => {
  const endereco = String(url);
  const metodo = (opcoes.method ?? 'GET').toUpperCase();
  const ok = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

  if (endereco.includes('/files')) return ok(ARQUIVOS);
  if (endereco.includes('/issues/') && endereco.includes('/comments') && metodo === 'GET') return ok([]);

  if (endereco.includes('/comments') && metodo === 'POST') {
    console.log('\n================ COMENTARIO QUE SERIA PUBLICADO ================\n');
    console.log(JSON.parse(opcoes.body).body);
    console.log('\n===============================================================\n');

    return ok({ id: 1 }, 201);
  }

  if (endereco.includes('/pulls/')) {
    return ok({ title: 'Ajusta a soma de itens', body: 'PR de ensaio.', head: { ref: 'fix/soma', sha: 'abc1234' }, base: { ref: 'main' } });
  }

  if (endereco.includes('anthropic')) {
    return ok({
      content: [{ type: 'text', text: JSON.stringify(RESPOSTA_DO_MODELO) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12000, output_tokens: 800, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0 },
    });
  }

  throw new Error(`chamada nao prevista no ensaio: ${metodo} ${endereco}`);
};
