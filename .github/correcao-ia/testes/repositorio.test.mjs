import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buscarNoCodigo,
  estaNoEscopoDeEdicao,
  estaNoEscopoDeLeitura,
  lerArquivoParaAnalise,
  lerArquivoParaEdicao,
  listarArvore,
  resolverCaminhoSeguro,
} from '../src/repositorio.mjs';

const CONFIGURACAO = {
  incluir: ['**/*.cpp', '**/*.h', '**/*.js', '**/*.md', '**/*.ini'],
  excluir: ['**/.pio/**', '**/secrets*.h', '**/node_modules/**'],
  editaveis: ['src/**', 'data/**', 'platformio.ini'],
  limites: {
    maxArquivosNaArvore: 50,
    maxCaracteresPorArquivo: 120,
    maxResultadosPorBusca: 10,
  },
};

let raiz;

before(() => {
  raiz = mkdtempSync(join(tmpdir(), 'correcao-ia-repo-'));

  mkdirSync(join(raiz, 'src'), { recursive: true });
  mkdirSync(join(raiz, 'data'), { recursive: true });
  mkdirSync(join(raiz, '.pio', 'build'), { recursive: true });

  writeFileSync(join(raiz, 'src', 'main.cpp'), 'void setDecoColorAll() {\n  // laco\n}\n');
  writeFileSync(join(raiz, 'data', 'app.js'), 'function setDecoColorAll() {}\n');
  writeFileSync(join(raiz, 'platformio.ini'), '[env:esp12e]\n');
  writeFileSync(join(raiz, 'README.md'), 'projeto\n');
  writeFileSync(join(raiz, '.pio', 'build', 'lixo.cpp'), 'gerado\n');
  writeFileSync(join(raiz, 'src', 'secrets.h'), 'WIFI_PASSWORD\n');
});

after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe('resolverCaminhoSeguro', () => {
  it('aceita caminho relativo dentro da raiz', () => {
    const resultado = resolverCaminhoSeguro('src/main.cpp', raiz);

    assert.equal(resultado.valido, true);
    assert.equal(resultado.relativo, 'src/main.cpp');
  });

  it('recusa travessia de diretorio', () => {
    assert.equal(resolverCaminhoSeguro('../../etc/passwd', raiz).valido, false);
    assert.equal(resolverCaminhoSeguro('src/../../fora.cpp', raiz).valido, false);
  });

  it('recusa caminho absoluto', () => {
    assert.equal(resolverCaminhoSeguro('/etc/passwd', raiz).valido, false);
    assert.equal(resolverCaminhoSeguro('C:/Windows/system.ini', raiz).valido, false);
  });

  it('recusa caminho vazio e byte nulo', () => {
    assert.equal(resolverCaminhoSeguro('', raiz).valido, false);
    assert.equal(resolverCaminhoSeguro('src/main\0.cpp', raiz).valido, false);
  });

  it('normaliza separador do Windows', () => {
    assert.equal(resolverCaminhoSeguro('src\\main.cpp', raiz).relativo, 'src/main.cpp');
  });
});

describe('escopo', () => {
  it('permite leitura do que casa com incluir', () => {
    assert.equal(estaNoEscopoDeLeitura('src/main.cpp', CONFIGURACAO).permitido, true);
    assert.equal(estaNoEscopoDeLeitura('README.md', CONFIGURACAO).permitido, true);
  });

  it('a exclusao vence a inclusao', () => {
    assert.equal(estaNoEscopoDeLeitura('.pio/build/lixo.cpp', CONFIGURACAO).permitido, false);
    assert.equal(estaNoEscopoDeLeitura('src/secrets.h', CONFIGURACAO).permitido, false);
  });

  it('recusa extensao fora da lista', () => {
    assert.equal(estaNoEscopoDeLeitura('Images/foto.png', CONFIGURACAO).permitido, false);
  });

  it('edicao e mais restrita que leitura', () => {
    assert.equal(estaNoEscopoDeLeitura('README.md', CONFIGURACAO).permitido, true);
    assert.equal(estaNoEscopoDeEdicao('README.md', CONFIGURACAO).permitido, false);
    assert.equal(estaNoEscopoDeEdicao('src/main.cpp', CONFIGURACAO).permitido, true);
  });

  it('recusa edicao de workflow', () => {
    const escopo = estaNoEscopoDeEdicao('.github/workflows/deploy.yml', CONFIGURACAO);

    assert.equal(escopo.permitido, false);
  });
});

describe('listarArvore', () => {
  it('lista os arquivos analisaveis e ignora os excluidos', () => {
    const arvore = listarArvore(raiz, CONFIGURACAO);
    const caminhos = arvore.arquivos.map((arquivo) => arquivo.caminho);

    assert.ok(caminhos.includes('src/main.cpp'));
    assert.ok(caminhos.includes('data/app.js'));
    assert.ok(caminhos.includes('platformio.ini'));
    assert.equal(caminhos.includes('.pio/build/lixo.cpp'), false);
    assert.equal(caminhos.includes('src/secrets.h'), false);
  });

  it('informa o tamanho de cada arquivo', () => {
    const arquivo = listarArvore(raiz, CONFIGURACAO).arquivos
      .find((item) => item.caminho === 'src/main.cpp');

    assert.ok(arquivo.bytes > 0);
  });
});

describe('lerArquivoParaAnalise', () => {
  it('le arquivo dentro do escopo', () => {
    const leitura = lerArquivoParaAnalise('src/main.cpp', raiz, CONFIGURACAO);

    assert.equal(leitura.ok, true);
    assert.match(leitura.conteudo, /setDecoColorAll/);
  });

  it('recusa arquivo fora do escopo', () => {
    const leitura = lerArquivoParaAnalise('src/secrets.h', raiz, CONFIGURACAO);

    assert.equal(leitura.ok, false);
    assert.match(leitura.motivo, /excluido por/);
  });

  it('recusa travessia de diretorio', () => {
    assert.equal(lerArquivoParaAnalise('../fora.cpp', raiz, CONFIGURACAO).ok, false);
  });

  it('informa arquivo inexistente sem lancar', () => {
    const leitura = lerArquivoParaAnalise('src/inventado.cpp', raiz, CONFIGURACAO);

    assert.equal(leitura.ok, false);
    assert.equal(leitura.motivo, 'arquivo inexistente');
  });

  it('trunca arquivo acima do limite', () => {
    const grande = join(raiz, 'src', 'grande.cpp');

    writeFileSync(grande, 'x'.repeat(500));

    const leitura = lerArquivoParaAnalise('src/grande.cpp', raiz, CONFIGURACAO);

    assert.equal(leitura.truncado, true);
    assert.ok(leitura.conteudo.includes('arquivo truncado'));

    rmSync(grande);
  });
});

describe('lerArquivoParaEdicao', () => {
  it('devolve o conteudo integral, sem truncar', () => {
    const grande = join(raiz, 'src', 'grande.cpp');

    writeFileSync(grande, 'y'.repeat(500));

    const leitura = lerArquivoParaEdicao('src/grande.cpp', raiz, CONFIGURACAO);

    assert.equal(leitura.ok, true);
    assert.equal(leitura.conteudo.length, 500);

    rmSync(grande);
  });

  it('marca arquivo inexistente como criacao possivel', () => {
    const leitura = lerArquivoParaEdicao('src/novo.cpp', raiz, CONFIGURACAO);

    assert.equal(leitura.ok, true);
    assert.equal(leitura.existe, false);
    assert.equal(leitura.conteudo, null);
  });

  it('recusa arquivo fora da lista de editaveis', () => {
    const leitura = lerArquivoParaEdicao('README.md', raiz, CONFIGURACAO);

    assert.equal(leitura.ok, false);
    assert.match(leitura.motivo, /editaveis/);
  });
});

describe('buscarNoCodigo', () => {
  it('encontra o termo nos arquivos analisaveis', () => {
    const busca = buscarNoCodigo('setDecoColorAll', raiz, CONFIGURACAO);

    const caminhos = busca.ocorrencias.map((item) => item.caminho);

    assert.ok(caminhos.includes('src/main.cpp'));
    assert.ok(caminhos.includes('data/app.js'));
  });

  it('nao diferencia caixa', () => {
    assert.ok(buscarNoCodigo('SETDECOCOLORALL', raiz, CONFIGURACAO).ocorrencias.length > 0);
  });

  it('recusa termo curto demais', () => {
    const busca = buscarNoCodigo('a', raiz, CONFIGURACAO);

    assert.equal(busca.ocorrencias.length, 0);
    assert.match(busca.motivo, /curto demais/);
  });

  it('trata o termo como literal, nao como expressao regular', () => {
    const busca = buscarNoCodigo('.*(', raiz, CONFIGURACAO);

    assert.equal(busca.ocorrencias.length, 0);
    assert.equal(busca.motivo, undefined);
  });

  it('nao busca em arquivo excluido', () => {
    const busca = buscarNoCodigo('gerado', raiz, CONFIGURACAO);

    assert.equal(busca.ocorrencias.length, 0);
  });
});
