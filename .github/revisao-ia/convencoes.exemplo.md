# Projeto sob revisao: Minha API (exemplo)

API REST em Node.js + Express com Postgres. Este arquivo e apenas um exemplo do formato:
copie-o para `convencoes.md` e adapte, ou apague se nao for util.

## Convencoes obrigatorias

- **Idioma**: codigo, comentarios e mensagens de commit em portugues do Brasil.
  Apontar codigo novo escrito em ingles e legitimo; renomear codigo legado existente nao e.
- **Camadas**: `rotas/` so valida entrada e chama `servicos/`; `servicos/` contem a regra de negocio;
  `repositorios/` e o unico lugar com SQL. Rota que fala direto com o banco e achado grave.
- **Erros**: lancar as classes de `erros/` e deixar o middleware `tratadorDeErros` responder.
  `res.status(500).send(erro.message)` dentro da rota vaza detalhe interno - achado grave.
- **Banco**: sempre consulta parametrizada. Concatenacao de string em SQL e `Critical`.
- **Configuracao**: ler somente de `config/index.js`, nunca `process.env` espalhado pelo codigo.

## Testes

- Vitest, arquivos `*.test.js` ao lado do codigo testado.
- Nomenclatura: `deve <comportamento> quando <condicao>`.
- Logica nova em `servicos/` sem teste correspondente e achado `Medium`.

## Dados sensiveis

- Nunca registrar em log: senha, token, CPF, e-mail completo do usuario.
- Resposta de erro ao cliente nao expoe stack trace nem nome de tabela.
