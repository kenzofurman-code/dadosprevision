# Deploy na VPS e Integração com o Dados Prevision — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar a extração do Mega ERP (hoje manual, rodando no Windows do usuário)
para um serviço containerizado que roda sozinho na VPS Linux, escreve num schema
`mega` do mesmo PostgreSQL que o app Dados Prevision já usa, e substitui os arquivos
`.xlsx` como produto final por uma tabela consultável.

**Architecture:** Um pacote Python novo (`carregador`) fica entre o robô de extração
já existente (`executar.py`/`biblioteca.py`, sem mudança de estratégia — OCR sobre a
tela transmitida) e um PostgreSQL compartilhado. O robô continua salvando `.xlsx` em
`dados/bruto/<data>/`; o carregador lê esses arquivos, traduz e valida as colunas, e
grava por obra numa transação. Um laço de agendamento (`agendador.py`) dispara a
rotina noturna completa dentro de um container Docker com Chrome real sob Xvfb.

**Tech Stack:** Python 3.12, Playwright (Chrome real, headed), pytesseract/OpenCV
(camada OCR já existente, sem mudanças), pandas/openpyxl (leitura dos `.xlsx`),
psycopg 3 (escrita no Postgres), croniter (agendamento), pytest (testes da lógica
pura), Docker (Debian slim + Xvfb + Tesseract + Chrome estável).

**Spec:** [docs/superpowers/specs/2026-09-07-deploy-vps-integracao-dadosprevision-design.md](../specs/2026-09-07-deploy-vps-integracao-dadosprevision-design.md)

## Global Constraints

- Credenciais (MEGA_USUARIO, MEGA_SENHA, PGPASSWORD) só via variável de ambiente ou
  `.env` fora do git — nunca em código, nunca logadas. (Spec, Empacotamento.)
- Chrome real (`channel="chrome"`), sempre `headless=False` — o gateway HTML5 não
  funciona no Chromium empacotado do Playwright nem em modo headless. Na VPS Linux,
  isso significa Chrome sob Xvfb, não `headless=True`. (Spec, Riscos; `sessao.py`.)
- Viewport fixo em 1600×900 — controla a geometria da sessão remota; todas as
  coordenadas medidas em `biblioteca.py` assumem essa resolução. Não mudar sem
  remedir as âncoras.
- Retenção de dados por arquivo é a definida na Seção "Modelo de dados" da spec —
  já aprovada pelo usuário arquivo por arquivo. Não alterar sem nova aprovação.
- A porta do PostgreSQL não é publicada — o container `mega` fala com o banco pela
  rede interna do Compose, como o `app` já faz hoje.
- O robô escreve no schema `mega`; nunca no schema `public` (dono: app Node).
- Nenhuma tarefa deste plano edita o repositório `dadosprevision` diretamente — a
  migração do código para lá é decisão do usuário, feita separadamente (spec,
  "Fora de escopo"). As tarefas de empacotamento produzem os artefatos
  (`Dockerfile`, fragmento de `docker-compose.yml`, `sql/schema_mega.sql`) dentro de
  `mega-relatorios`, prontos para o merge quando a migração acontecer.
- Sem notificação ativa de falha (e-mail/webhook) — decisão do usuário. `mega.carga`
  é o único registro de falha.
- Módulos de lógica pura (tradução de colunas, trilha de situação, cálculo de
  agendamento) ganham testes automatizados com pytest, seguindo TDD. Módulos que
  interagem com o ERP real ou com um Postgres real não têm precedente de teste
  automatizado neste repositório (nenhum existe hoje) — seguem o padrão já
  estabelecido de verificação manual via scripts de `ferramentas/`, documentado
  explicitamente em cada tarefa.

---

## Mapeamento de colunas — decisões tomadas nesta fase

Para não inventar nomes de coluna de banco às cegas, o mecanismo de tradução
(Tarefa 2) normaliza automaticamente todo nome de coluna do Excel para snake_case
sem acento. Ele só precisa de um mapeamento manual explícito nos casos em que o
Excel repete o mesmo nome de coluna em posições diferentes com significados
diferentes (o pandas desambigua com sufixo `.1`, `.2`...) — a normalização
automática produziria `codigo_1`, `descricao_2`, que não dizem nada.

Esses casos foram levantados olhando as 6 planilhas reais de
`dados/consolidado/*.xlsx` (extração de 2026-09-02). Onde o significado é evidente
pelo contexto da linha, o nome final já está decidido. Onde não é, o nome vem
marcado com `# confirmar:` e a Tarefa 2 tem um passo explícito para validar com o
usuário antes de aplicar em produção — isso cobre a pendência que a spec deixou em
aberto.

## Task 1: Config — política de retenção, chaves e limpeza de configuração morta

**Files:**
- Modify: `config.yaml`
- Modify: `src/config.py`
- Test: `tests/test_config.py` (novo)

**Interfaces:**
- Produces: `cfgmod.retencao(cfg, relatorio_id) -> str` (um de `"atual"`,
  `"historico"`, `"atual_com_trilha"`); `cfgmod.chave_natural(cfg, relatorio_id) ->
  list[str] | None` (lista de nomes de coluna ORIGINAIS do Excel que formam a chave
  única, ou `None` quando o relatório usa id sintético); `cfgmod.tabela_destino(cfg,
  relatorio_id) -> str` (nome da tabela no schema `mega`, sem o prefixo `mega.`).

- [ ] **Step 1: Escrever o teste que expressa a política de retenção decidida com o usuário**

```python
# tests/test_config.py
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod


def _cfg():
    return cfgmod.carregar()


def test_retencao_por_relatorio_bate_com_o_decidido_com_o_usuario():
    cfg = _cfg()
    # Decisões da spec (Seção "Política de retenção"), uma por uma.
    assert cfgmod.retencao(cfg, "itens_solicitados") == "atual"
    assert cfgmod.retencao(cfg, "visualizacao_itens") == "atual_com_trilha"
    assert cfgmod.retencao(cfg, "pedidos_compra") == "atual"
    assert cfgmod.retencao(cfg, "analise_saldo_solicitacao") == "historico_ou_atual"


def test_retencao_por_aba_da_analise_de_saldo():
    # analise_saldo_solicitacao tem 3 exportacoes (abas) com politicas DIFERENTES:
    # Pedidos e Contratos = historico; Realizado = atual.
    cfg = _cfg()
    rel = cfgmod.relatorio(cfg, "analise_saldo_solicitacao")
    por_arquivo = {e["arquivo"]: e["retencao"] for e in rel["exportacoes"]}
    assert por_arquivo["Analise_Pedidos"] == "historico"
    assert por_arquivo["Analise_Contratos"] == "historico"
    assert por_arquivo["Analise_Realizado"] == "atual"


def test_tabela_destino_usa_nome_em_snake_case():
    cfg = _cfg()
    assert cfgmod.tabela_destino(cfg, "itens_solicitados") == "itens_solicitados"
    assert cfgmod.tabela_destino(cfg, "visualizacao_itens") == "visualizacao_itens"


def test_chave_natural_declarada_para_quem_tem_e_ausente_para_quem_nao_tem():
    cfg = _cfg()
    rel = cfgmod.relatorio(cfg, "itens_solicitados")
    assert rel["chave_natural"] == [
        "Código da solicitação", "Nr. RM", "Sequencial do item",
    ]
    rel_realizado = cfgmod.relatorio(cfg, "analise_saldo_solicitacao")
    exp_realizado = next(e for e in rel_realizado["exportacoes"]
                         if e["arquivo"] == "Analise_Realizado")
    assert exp_realizado.get("chave_natural") is None  # usa id sintetico


def test_destino_pasta_local_morta_foi_removido():
    # dados/bruto/<data> ja e onde o exportar_grid grava (biblioteca.py); a
    # pasta_local do Windows Downloads nunca chega a ser lida por ninguem no
    # pipeline novo. Mantida no config seria um convite a reintroduzir o bug.
    cfg = _cfg()
    assert "pasta_local" not in cfg["destino"]
    assert "notificacao" not in cfg   # decisao do usuario: sem alerta ativo
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `python -m pytest tests/test_config.py -v`
Expected: FAIL — `retencao`, `tabela_destino`, `chave_natural` não existem em
`config.py`; `config.yaml` ainda tem `pasta_local` e `notificacao`.

- [ ] **Step 3: Atualizar `config.yaml`**

Remover a chave `destino.pasta_local` (Windows Downloads — morta desde que
`exportar_grid` passou a gravar direto em `dados/bruto/<data>/` via
`page.expect_download()`) e a seção `notificacao` inteira (decisão do usuário: só
registrar em `mega.carga`, sem alerta ativo). Adicionar `retencao` e
`chave_natural` a cada relatório/exportação:

```yaml
destino:
  pasta_erp: '\\tsclient\WebFile'      # onde o ERP salva (referencia; nao lido pelo pipeline)
  formato_data: 'AAAA-MM-DD'
```

Em `itens_solicitados`, logo abaixo de `ancora_titulo_tela`:

```yaml
    retencao: "atual"
    chave_natural: ["Código da solicitação", "Nr. RM", "Sequencial do item"]
```

Em `analise_saldo_solicitacao`, cada item de `exportacoes` ganha `retencao`
(Pedidos e Contratos = histórico; Realizado = atual, sem chave natural — usa id
sintético):

```yaml
    exportacoes:
      - aba: "Pedidos"
        caminho_menu: ["Exportar", "Excel"]
        arquivo: "Analise_Pedidos"
        ancora_nome_padrao: "grdPedidos"
        retencao: "historico"
      - aba: "Contratos"
        caminho_menu: ["Exportar", "Excel"]
        arquivo: "Analise_Contratos"
        ancora_nome_padrao: "grdContratos"
        retencao: "historico"
      - aba: "Realizado"
        caminho_menu: ["Exportar", "Excel"]
        arquivo: "Analise_Realizado"
        ancora_nome_padrao: "grdRealizado"
        retencao: "atual"
```

Em `visualizacao_itens`:

```yaml
    retencao: "atual_com_trilha"
    chave_natural: ["Solicitação", "Sequência", "Fornecedor"]
```

Em `pedidos_compra`:

```yaml
    retencao: "atual"
    chave_natural: ["Número do pedido", "Item Pedido"]
```

- [ ] **Step 4: Implementar as funções de leitura em `src/config.py`**

Adicionar ao final do arquivo (depois de `nome_arquivo`):

```python
def retencao(cfg, rid):
    """Retencao de um relatorio. Para 'analise_saldo_solicitacao', que tem
    politicas diferentes por aba, devolve 'historico_ou_atual' — quem precisa
    do valor por arquivo usa as exportacoes diretamente (ver testes)."""
    rel = relatorio(cfg, rid)
    if "retencao" in rel:
        return rel["retencao"]
    valores = {e["retencao"] for e in rel["exportacoes"] if "retencao" in e}
    if len(valores) > 1:
        return "historico_ou_atual"
    return valores.pop() if valores else None


def tabela_destino(cfg, rid):
    """Nome da tabela no schema mega, sem o prefixo. Por ora e o proprio id do
    relatorio; para analise_saldo_solicitacao, quem precisa do nome por
    exportacao usa exp['arquivo'].lower()."""
    return rid
```

E em `_validar`, adicionar a checagem de que toda exportação declara `retencao`:

```python
        for e in r["exportacoes"]:
            if not e.get("arquivo"):
                raise ConfigInvalido("exportacao sem 'arquivo' em %s" % r["id"])
            if "retencao" not in r and "retencao" not in e:
                raise ConfigInvalido(
                    "relatorio %s (exportacao %s) sem 'retencao' declarada"
                    % (r["id"], e["arquivo"]))
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `python -m pytest tests/test_config.py -v`
Expected: PASS (5 testes)

- [ ] **Step 6: Rodar a suíte completa de config para garantir que nada quebrou**

Run: `python -m pytest tests/test_config.py -v && python -c "import sys; sys.path.insert(0,'src'); import config; config.carregar()"`
Expected: PASS — `config.carregar()` não levanta `ConfigInvalido`.

- [ ] **Step 7: Commit**

```bash
git add config.yaml src/config.py tests/test_config.py
git commit -m "Config: retencao e chave natural por relatorio; remove config morta"
```

---

## Task 2: Tradução de colunas do Excel para nomes de banco

**Files:**
- Create: `src/tradutor.py`
- Test: `tests/test_tradutor.py`

**Interfaces:**
- Consumes: nada de tarefas anteriores (módulo puro, independente).
- Produces: `traduzir_colunas(df: pandas.DataFrame, relatorio_id: str, aba: str |
  None = None) -> pandas.DataFrame` — usado pela Tarefa 6 (`carregar.py`).
  `normalizar_nome_coluna(nome: str) -> str` — usado só internamente e nos testes.

- [ ] **Step 1: Escrever o teste da normalização automática (o caso comum)**

```python
# tests/test_tradutor.py
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from tradutor import normalizar_nome_coluna, traduzir_colunas


def test_normaliza_acentos_espacos_e_pontuacao():
    assert normalizar_nome_coluna("Data de emissão") == "data_de_emissao"
    assert normalizar_nome_coluna("Situação do Item") == "situacao_do_item"
    assert normalizar_nome_coluna("Qtde. Convertida") == "qtde_convertida"
    assert normalizar_nome_coluna("Cód.Agente") == "cod_agente"
    assert normalizar_nome_coluna("% Desconto Geral") == "pct_desconto_geral"
    assert normalizar_nome_coluna("Nr.Processo") == "nr_processo"


def test_traduzir_colunas_aplica_normalizacao_automatica_por_padrao():
    df = pd.DataFrame({"obra": [340], "Data de emissão": ["2025-01-02"],
                       "Situação do Item": ["Baixado"]})
    saida = traduzir_colunas(df, "itens_solicitados")
    assert list(saida.columns) == ["obra", "data_de_emissao", "situacao_do_item"]
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tradutor'`

- [ ] **Step 3: Implementar a normalização automática**

```python
# -*- coding: utf-8 -*-
"""Traduz cabecalhos do Excel exportado do Mega para nomes de coluna de banco.

O ERP entrega nomes com acento, pontuacao e — no pior caso — o MESMO nome
repetido em colunas diferentes (o pandas desambigua com sufixo: "Codigo",
"Codigo.1"). A normalizacao automatica resolve o caso comum; o RENOMEIO_MANUAL
cobre so os casos em que duas colunas homonimas tem significados diferentes e o
sufixo numerico nao diz nada sobre qual e qual.
"""
import re
import unicodedata

import pandas as pd

_SUBSTITUICOES = {"%": "pct", "º": "o", "ª": "a"}


def normalizar_nome_coluna(nome):
    texto = str(nome)
    for antes, depois in _SUBSTITUICOES.items():
        texto = texto.replace(antes, depois)
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = texto.lower()
    texto = re.sub(r"[^a-z0-9]+", "_", texto)
    return texto.strip("_")
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: PASS (2 testes) — `traduzir_colunas` ainda não existe como função
separada; ajustar: criar `traduzir_colunas` chamando `normalizar_nome_coluna`
coluna a coluna quando não há override. Ver Step 3 acima já cobre isso
minimamente; caso o teste 2 falhe por `traduzir_colunas` ausente, adicionar:

```python
def traduzir_colunas(df, relatorio_id, aba=None):
    chave = (relatorio_id, aba)
    descartar = COLUNAS_DESCARTAR.get(chave, COLUNAS_DESCARTAR.get(relatorio_id, []))
    df = df.drop(columns=[c for c in descartar if c in df.columns])
    manual = RENOMEIO_MANUAL.get(chave, RENOMEIO_MANUAL.get(relatorio_id, {}))
    novo_nome = {c: manual.get(c, normalizar_nome_coluna(c)) for c in df.columns}
    return df.rename(columns=novo_nome)


COLUNAS_DESCARTAR = {}
RENOMEIO_MANUAL = {}
```

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Escrever o teste do descarte das colunas fiscais em `pedidos_compra`**

Lista extraída e verificada contra o arquivo real
`dados/consolidado/pedidos_compra.xlsx` (49 colunas, nenhuma sobra e nenhuma
falta — confirmado rodando o filtro contra o arquivo real antes de escrever este
plano):

```python
def test_pedidos_compra_descarta_as_49_colunas_fiscais():
    colunas_fiscais = [
        "Vlr. Base IPI", "% I.P.I", "Vlr. IPI", "Vlr. Isento IPI", "Vlr. Outros IPI",
        "IPI Recuperado", "Incide IPI", "Operação IPI",
        "Vlr. Base ICMS", "% I.C.M.S.", "Vlr. ICMS", "Vlr. Isento ICMS",
        "Vlr. Outros ICMS", "ICMS Recuperado", "ICMS Retido", "% Dif.ICMS",
        "Vlr.Dif. ICMS", "Vlr.Base Sub.Trib.", "ICMS definido pelo peso",
        "Incide ICMS", "Operação ICMS", "Vlr. do ICMS retido anteriormente",
        "Vlr. da base de substituição anteriormente",
        "Vlr.Base ISS Devido", "% ISS Devido", "Valor ISS Devido",
        "Vlr.Base ISS Retido", "% ISS Retido", "Valor ISS Retido", "Incide ISS",
        "Base I.R.R.F.", "% I.R.R.F", "Vlr. I.R.R.F.",
        "Vlr.Base I.N.S.S.", "% I.N.S.S", "Valor INSS",
        "Situação do e-mail",
        "Vlr. do PIS retido", "Vlr. PIS recupera", "% PIS", "Vlr. PIS",
        "Vlr. da base do PIS",
        "Vlr. do COFINS retido", "Vlr. COFINS recupera", "% COFINS", "Vlr. COFINS",
        "Vlr. da base do COFINS",
        "% CSLL", "Vlr. da base do CSLL", "Vlr. CSLL",
    ]
    assert len(colunas_fiscais) == 49
    dados = {"obra": [340], "Número do pedido": [4], "Item Pedido": [1]}
    dados.update({c: [0] for c in colunas_fiscais})
    df = pd.DataFrame(dados)
    saida = traduzir_colunas(df, "pedidos_compra")
    for c in colunas_fiscais:
        assert c not in saida.columns
    assert "obra" in saida.columns
    assert "numero_do_pedido" in saida.columns
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: FAIL — as colunas fiscais continuam na saída (`COLUNAS_DESCARTAR` vazio).

- [ ] **Step 7: Preencher `COLUNAS_DESCARTAR["pedidos_compra"]`**

```python
COLUNAS_DESCARTAR = {
    "pedidos_compra": [
        "Vlr. Base IPI", "% I.P.I", "Vlr. IPI", "Vlr. Isento IPI", "Vlr. Outros IPI",
        "IPI Recuperado", "Incide IPI", "Operação IPI",
        "Vlr. Base ICMS", "% I.C.M.S.", "Vlr. ICMS", "Vlr. Isento ICMS",
        "Vlr. Outros ICMS", "ICMS Recuperado", "ICMS Retido", "% Dif.ICMS",
        "Vlr.Dif. ICMS", "Vlr.Base Sub.Trib.", "ICMS definido pelo peso",
        "Incide ICMS", "Operação ICMS", "Vlr. do ICMS retido anteriormente",
        "Vlr. da base de substituição anteriormente",
        "Vlr.Base ISS Devido", "% ISS Devido", "Valor ISS Devido",
        "Vlr.Base ISS Retido", "% ISS Retido", "Valor ISS Retido", "Incide ISS",
        "Base I.R.R.F.", "% I.R.R.F", "Vlr. I.R.R.F.",
        "Vlr.Base I.N.S.S.", "% I.N.S.S", "Valor INSS",
        "Situação do e-mail",
        "Vlr. do PIS retido", "Vlr. PIS recupera", "% PIS", "Vlr. PIS",
        "Vlr. da base do PIS",
        "Vlr. do COFINS retido", "Vlr. COFINS recupera", "% COFINS", "Vlr. COFINS",
        "Vlr. da base do COFINS",
        "% CSLL", "Vlr. da base do CSLL", "Vlr. CSLL",
    ],
    # visualizacao_itens ja descarta colunas POSICIONAIS (setinha de expandir,
    # badge do grid) em config.yaml (leitura.descartar_colunas) — isso acontece
    # antes de chegar aqui, na leitura do Excel (Tarefa 6), nao neste modulo.
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: PASS (3 testes)

- [ ] **Step 9: Escrever o teste do renomeio manual para colunas homônimas ambíguas**

```python
def test_renomeio_manual_desambigua_colunas_homonimas_em_itens_solicitados():
    # "Codigo da cotacao" aparece duas vezes no Excel de Itens Solicitados —
    # confirmado olhando dados/consolidado/itens_solicitados.xlsx.
    df = pd.DataFrame({
        "obra": [340],
        "Código da cotação": [1],
        "Código da cotação.1": [1],
    })
    saida = traduzir_colunas(df, "itens_solicitados")
    assert "codigo_cotacao" in saida.columns
    assert "codigo_cotacao_alternativo" in saida.columns


def test_renomeio_manual_da_cadeia_de_natureza_em_visualizacao_itens():
    # Cadeia de 4 niveis de classificacao contabil (Codigo/Descricao repetidos).
    # NOMES MARCADOS COMO INFERIDOS: confirmar com o usuario (ver Step 11).
    df = pd.DataFrame({
        "obra": [340],
        "Código": [189], "Descrição.1": ["Viagens/Hospedagens (Obras)"],
        "Código.1": [109], "Descrição.2": ["Obra-Outras Entradas"],
        "Código.2": [35], "Descrição.3": ["Obras - Custos"],
        "Código.3": [13], "Descrição.4": ["Amáz (BALNEARIO ...)"],
        "Fornecedor": ["9966 - RAMIRO GIL SOBRADO JUNIOR"],
        "Fornecedor.1": ["5414 - WD3 CONSTRUCOES LTDA"],
    })
    saida = traduzir_colunas(df, "visualizacao_itens")
    esperado = {
        "codigo_natureza_nivel1", "descricao_natureza_nivel1",
        "codigo_natureza_nivel2", "descricao_natureza_nivel2",
        "codigo_natureza_nivel3", "descricao_natureza_nivel3",
        "codigo_natureza_nivel4", "descricao_natureza_nivel4",
        "fornecedor_cotacao", "fornecedor_contrato",
    }
    assert esperado.issubset(set(saida.columns))
```

- [ ] **Step 10: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: FAIL — `RENOMEIO_MANUAL` ainda vazio, colunas saem como
`codigo_da_cotacao`/`codigo_da_cotacao_1`, `codigo`/`codigo_1`/etc.

- [ ] **Step 11: Preencher `RENOMEIO_MANUAL` — e marcar o que precisa confirmação**

```python
RENOMEIO_MANUAL = {
    "itens_solicitados": {
        "Código da cotação": "codigo_cotacao",
        "Código da cotação.1": "codigo_cotacao_alternativo",  # confirmar: por
        # que a mesma cotacao aparece em duas colunas? (visto em 100% das linhas
        # amostradas com o mesmo valor nas duas)
    },
    "visualizacao_itens": {
        # Cadeia de classificacao contabil / natureza de aplicacao, 4 niveis.
        # INFERIDO pela adjacencia Codigo->Descricao e pelos valores de exemplo
        # (189/"Viagens e Hospedagens" -> 109/"Obra-Outras Entradas" ->
        # 35/"Obras - Custos" -> 13/obra especifica). CONFIRMAR com o usuario
        # antes de fixar em producao (ver Step 12).
        "Código": "codigo_natureza_nivel1", "Descrição.1": "descricao_natureza_nivel1",
        "Código.1": "codigo_natureza_nivel2", "Descrição.2": "descricao_natureza_nivel2",
        "Código.2": "codigo_natureza_nivel3", "Descrição.3": "descricao_natureza_nivel3",
        "Código.3": "codigo_natureza_nivel4", "Descrição.4": "descricao_natureza_nivel4",
        "Fornecedor": "fornecedor_cotacao",      # ligado a Cód. Cotação
        "Fornecedor.1": "fornecedor_contrato",   # ligado a Cod. Contrato
    },
    "analise_pedidos": {
        # "Codigo" = numero do pedido; "Codigo.1" repete o mesmo valor de
        # "Codigo Processo" nas amostras observadas — CONFIRMAR se sao sempre
        # iguais ou se ha caso em que divergem.
        "Código": "codigo_pedido",
        "Código.1": "codigo_processo_duplicado",  # confirmar
    },
    "analise_contratos": {
        "Código": "codigo_contrato",
        "Cód. Alternativo.2": "codigo_contrato_alternativo",
        "Cód. Alternativo.3": "codigo_insumo_alternativo",  # confirmar: vazio
        # em toda a amostra de 2026-09-02; pode ser coluna sempre vazia no ERP.
        "Descrição.2": "descricao_insumo_alternativa",      # confirmar, idem
    },
    "pedidos_compra": {
        "Característica Estoque.1": "caracteristica_estoque_alternativa",  # confirmar
        "Código": "codigo_classe_documento",  # confirmar: sempre vazio na amostra
    },
}
```

- [ ] **Step 12: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_tradutor.py -v`
Expected: PASS (5 testes)

- [ ] **Step 13: Levantar as confirmações pendentes com o usuário**

Usar `AskUserQuestion` (ou pergunta direta em chat, se a sessão não tiver a
ferramenta) com o seguinte roteiro, ANTES de rodar a primeira carga em produção
(Tarefa 6 em diante). Cada item marcado `# confirmar` no Step 11 vira uma
pergunta objetiva:

1. Em `itens_solicitados`: por que `Código da cotação` aparece duas vezes com o
   mesmo valor? É intencional (ex.: cotação original vs. cotação vigente) ou é
   uma duplicação do próprio relatório do ERP?
2. Em `visualizacao_itens`: a cadeia `Código/Descrição` × 4 é mesmo uma
   hierarquia de plano de contas (natureza de aplicação)? Os nomes
   `codigo_natureza_nivel1..4` fazem sentido, ou o usuário usa outro termo
   (ex.: "centro de custo", "conta gerencial")?
3. Em `analise_pedidos`: `Código.1` e `Código Processo` sempre trazem o mesmo
   valor? Se sim, uma das duas pode ser descartada em vez de traduzida.
4. Em `analise_contratos` e `pedidos_compra`: as colunas marcadas "sempre vazia
   na amostra" (`Cód. Alternativo.3`, `Descrição.2`, `Característica
   Estoque.1`, `Código`) têm uso conhecido, ou podem ir para
   `COLUNAS_DESCARTAR` como as fiscais?

Registrar a resposta como atualização deste arquivo (`RENOMEIO_MANUAL` e,
se aplicável, `COLUNAS_DESCARTAR`) antes de prosseguir para a Tarefa 6.

- [ ] **Step 14: Commit**

```bash
git add src/tradutor.py tests/test_tradutor.py
git commit -m "Tradutor de colunas: normalizacao automatica + renomeio manual para homonimos"
```

---

## Task 3: Trilha de situação da Visualização de Itens

**Files:**
- Create: `src/situacao.py`
- Test: `tests/test_situacao.py`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces: `derivar_etapa(linha: dict) -> str` e `calcular_transicoes(atual:
  list[dict], abertas: dict[tuple, dict], data_iso: str) -> tuple[list[dict],
  list[dict]]` (retorna `(fechar, abrir)`) — usados pela Tarefa 6.
  `abertas` é um dict chaveado por `(obra, solicitacao, sequencia, fornecedor)`
  com as linhas de `mega.item_situacao_hist` que hoje têm `ate IS NULL`.

- [ ] **Step 1: Escrever o teste de `derivar_etapa`**

```python
# tests/test_situacao.py
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from situacao import derivar_etapa, calcular_transicoes


def test_derivar_etapa_pela_presenca_dos_codigos_do_ciclo():
    assert derivar_etapa({"cod_cotacao": None, "cod_pedido": None,
                          "cod_contrato": None}) == "solicitado"
    assert derivar_etapa({"cod_cotacao": 1, "cod_pedido": None,
                          "cod_contrato": None}) == "cotado"
    assert derivar_etapa({"cod_cotacao": 1, "cod_pedido": 4,
                          "cod_contrato": None}) == "pedido"
    assert derivar_etapa({"cod_cotacao": 1, "cod_pedido": 4,
                          "cod_contrato": 449}) == "contratado"
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_situacao.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implementar `derivar_etapa`**

```python
# -*- coding: utf-8 -*-
"""Deriva a etapa de compra de um item e mantem a trilha de mudancas de etapa.

O Mega so guarda o estado de HOJE. Para responder "esta item esta parado ha
quantos dias", e preciso comparar o estado de hoje com o de ontem e registrar
quando algo mudou — e e so isso que este modulo faz, sem tocar em ERP nem banco.
"""


def derivar_etapa(linha):
    if linha.get("cod_contrato"):
        return "contratado"
    if linha.get("cod_pedido"):
        return "pedido"
    if linha.get("cod_cotacao"):
        return "cotado"
    return "solicitado"
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_situacao.py -v`
Expected: PASS (1 teste)

- [ ] **Step 5: Escrever os testes de `calcular_transicoes`**

```python
def _chave(obra, sol, seq, forn):
    return (obra, sol, seq, forn)


def test_item_novo_abre_linha_sem_fechar_nada():
    atual = [{"obra": "340", "solicitacao": 1, "sequencia": 1,
              "fornecedor": "X", "situacao": "Aberto", "etapa": "solicitado"}]
    fechar, abrir = calcular_transicoes(atual, abertas={}, data_iso="2026-09-07")
    assert fechar == []
    assert abrir == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                      "fornecedor": "X", "situacao": "Aberto",
                      "etapa": "solicitado", "desde": "2026-09-07"}]


def test_item_sem_mudanca_nao_gera_transicao():
    linha_aberta = {"obra": "340", "solicitacao": 1, "sequencia": 1,
                    "fornecedor": "X", "situacao": "Aberto",
                    "etapa": "solicitado", "desde": "2026-09-01"}
    atual = [{"obra": "340", "solicitacao": 1, "sequencia": 1,
              "fornecedor": "X", "situacao": "Aberto", "etapa": "solicitado"}]
    abertas = {_chave("340", 1, 1, "X"): linha_aberta}
    fechar, abrir = calcular_transicoes(atual, abertas, data_iso="2026-09-07")
    assert fechar == []
    assert abrir == []


def test_item_que_mudou_de_etapa_fecha_a_antiga_e_abre_a_nova():
    linha_aberta = {"obra": "340", "solicitacao": 1, "sequencia": 1,
                    "fornecedor": "X", "situacao": "Aberto",
                    "etapa": "solicitado", "desde": "2026-09-01"}
    atual = [{"obra": "340", "solicitacao": 1, "sequencia": 1,
              "fornecedor": "X", "situacao": "Cotado", "etapa": "cotado"}]
    abertas = {_chave("340", 1, 1, "X"): linha_aberta}
    fechar, abrir = calcular_transicoes(atual, abertas, data_iso="2026-09-07")
    assert fechar == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                       "fornecedor": "X", "desde": "2026-09-01",
                       "ate": "2026-09-07"}]
    assert abrir == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                      "fornecedor": "X", "situacao": "Cotado",
                      "etapa": "cotado", "desde": "2026-09-07"}]


def test_item_que_sumiu_da_extracao_de_hoje_fecha_sem_abrir_novo():
    # Ex.: item cancelado no ERP. A trilha registra ate quando ficou vigente,
    # mas nao inventa um estado novo sem evidencia.
    linha_aberta = {"obra": "340", "solicitacao": 1, "sequencia": 1,
                    "fornecedor": "X", "situacao": "Aberto",
                    "etapa": "solicitado", "desde": "2026-09-01"}
    abertas = {_chave("340", 1, 1, "X"): linha_aberta}
    fechar, abrir = calcular_transicoes(atual=[], abertas=abertas,
                                        data_iso="2026-09-07")
    assert fechar == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                       "fornecedor": "X", "desde": "2026-09-01",
                       "ate": "2026-09-07"}]
    assert abrir == []
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_situacao.py -v`
Expected: FAIL — `calcular_transicoes` não existe.

- [ ] **Step 7: Implementar `calcular_transicoes`**

```python
_CAMPOS_CHAVE = ("obra", "solicitacao", "sequencia", "fornecedor")


def _chave_de(linha):
    return tuple(linha[c] for c in _CAMPOS_CHAVE)


def calcular_transicoes(atual, abertas, data_iso):
    """Compara o estado de hoje com as linhas ainda abertas na trilha.

    Devolve (fechar, abrir): 'fechar' sao as linhas cujo 'ate' deve ser
    preenchido com data_iso; 'abrir' sao as linhas novas com 'desde'=data_iso.
    Um item cuja etapa nao mudou nao gera nenhuma das duas.
    """
    fechar, abrir = [], []
    vistos = set()

    for linha in atual:
        chave = _chave_de(linha)
        vistos.add(chave)
        aberta = abertas.get(chave)
        if aberta and aberta["etapa"] == linha["etapa"]:
            continue  # sem mudanca
        if aberta:
            fechar.append({**{c: aberta[c] for c in _CAMPOS_CHAVE},
                           "desde": aberta["desde"], "ate": data_iso})
        abrir.append({**{c: linha[c] for c in _CAMPOS_CHAVE},
                      "situacao": linha["situacao"], "etapa": linha["etapa"],
                      "desde": data_iso})

    for chave, aberta in abertas.items():
        if chave not in vistos:
            fechar.append({**{c: aberta[c] for c in _CAMPOS_CHAVE},
                           "desde": aberta["desde"], "ate": data_iso})

    return fechar, abrir
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_situacao.py -v`
Expected: PASS (5 testes)

- [ ] **Step 9: Commit**

```bash
git add src/situacao.py tests/test_situacao.py
git commit -m "Trilha de situacao: deriva etapa de compra e calcula transicoes dia a dia"
```

---

## Task 4: Schema SQL do schema `mega`

**Files:**
- Create: `sql/schema_mega.sql`
- Test: `tests/test_schema_mega.py`

**Interfaces:**
- Produces: o arquivo `sql/schema_mega.sql`, lido por `banco.aplicar_esquema`
  (Tarefa 5).

- [ ] **Step 1: Escrever o teste que valida a sintaxe e a idempotência do arquivo (sem precisar de um Postgres real)**

```python
# tests/test_schema_mega.py
# -*- coding: utf-8 -*-
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SCHEMA = RAIZ / "sql" / "schema_mega.sql"


def test_schema_existe_e_nao_esta_vazio():
    assert SCHEMA.exists()
    texto = SCHEMA.read_text(encoding="utf-8")
    assert len(texto) > 200


def test_schema_e_idempotente_todo_create_usa_if_not_exists():
    texto = SCHEMA.read_text(encoding="utf-8").upper()
    for linha in texto.splitlines():
        linha = linha.strip()
        if linha.startswith("CREATE TABLE") or linha.startswith("CREATE SCHEMA"):
            assert "IF NOT EXISTS" in linha, (
                "instrucao nao idempotente (rodar duas vezes vai falhar): %s" % linha)


def test_schema_declara_todas_as_tabelas_da_spec():
    texto = SCHEMA.read_text(encoding="utf-8")
    for tabela in ("obra_projeto", "itens_solicitados", "visualizacao_itens",
                  "item_situacao_hist", "pedidos_compra", "analise_realizado",
                  "analise_pedidos_hist", "analise_contratos_hist", "carga"):
        assert ("mega.%s" % tabela) in texto, "tabela ausente: %s" % tabela


def test_tabelas_atuais_tem_coluna_obra_para_permitir_delete_por_obra():
    texto = SCHEMA.read_text(encoding="utf-8")
    for tabela in ("itens_solicitados", "visualizacao_itens", "pedidos_compra",
                  "analise_realizado"):
        # Localiza o bloco CREATE TABLE da tabela e confirma a coluna 'obra'.
        inicio = texto.index("mega.%s (" % tabela)
        fim = texto.index(");", inicio)
        bloco = texto[inicio:fim]
        assert "obra " in bloco or "obra\t" in bloco, (
            "tabela %s sem coluna 'obra' — DELETE por obra fica impossivel" % tabela)
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_schema_mega.py -v`
Expected: FAIL — `sql/schema_mega.sql` não existe.

- [ ] **Step 3: Escrever `sql/schema_mega.sql`**

```sql
-- Schema mega: dados extraidos do Mega ERP. Dono: o servico "mega" (Python).
-- O schema "public" e do app Node (server/schema.sql) — nunca escrever la.
-- Idempotente: pode ser reaplicado a cada subida do container, como o
-- server/db.js do Dados Prevision ja faz com o schema public.

CREATE SCHEMA IF NOT EXISTS mega;

-- Ponte com a Prevision. SEM chave estrangeira de proposito: o sync da
-- Prevision recria projetos com ON DELETE CASCADE, e uma FK rigida faria a
-- carga do Mega falhar sempre que o lado Prevision mudasse.
CREATE TABLE IF NOT EXISTS mega.obra_projeto (
  obra          TEXT PRIMARY KEY,
  id_prevision  TEXT,
  observacao    TEXT
);

-- ---------------------------------------------------------------------------
-- Tabelas "atual": recarregadas por obra (DELETE+INSERT transacional) a cada
-- execucao noturna. raw_data guarda a linha original inteira em JSON, para as
-- colunas cujo nome final ainda nao foi fixado (ver tradutor.RENOMEIO_MANUAL).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mega.itens_solicitados (
  obra                    TEXT NOT NULL,
  obra_nome               TEXT,
  data_extracao           DATE NOT NULL,
  codigo_solicitacao      BIGINT,
  numero_rm               BIGINT,
  sequencial_item         INTEGER,
  data_de_emissao         DATE,
  situacao_do_item        TEXT,
  descricao_do_item       TEXT,
  quantidade_solicitada   NUMERIC,
  quantidade_baixada      NUMERIC,
  unidade                 TEXT,
  raw_data                JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, codigo_solicitacao, numero_rm, sequencial_item)
);
CREATE INDEX IF NOT EXISTS idx_mega_itens_solicitados_obra
  ON mega.itens_solicitados(obra);

CREATE TABLE IF NOT EXISTS mega.visualizacao_itens (
  obra                TEXT NOT NULL,
  obra_nome           TEXT,
  data_extracao       DATE NOT NULL,
  orcamento           BIGINT,
  solicitacao         BIGINT NOT NULL,
  sequencia           INTEGER NOT NULL,
  fornecedor          TEXT NOT NULL,
  cod_item            BIGINT,
  descricao           TEXT,
  qtde_solicitada     NUMERIC,
  data_de_necessidade DATE,
  data_inclusao       TIMESTAMPTZ,
  valor_total         NUMERIC,
  situacao_do_item    TEXT,
  cod_cotacao         BIGINT,
  cod_pedido          BIGINT,
  cod_contrato        BIGINT,
  raw_data            JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, solicitacao, sequencia, fornecedor)
);
CREATE INDEX IF NOT EXISTS idx_mega_visualizacao_itens_obra
  ON mega.visualizacao_itens(obra);
CREATE INDEX IF NOT EXISTS idx_mega_visualizacao_itens_necessidade
  ON mega.visualizacao_itens(data_de_necessidade);

-- Trilha de situacao: so existe para visualizacao_itens (e a unica com
-- historico de etapa aprovado). ate = NULL significa "vigente hoje".
CREATE TABLE IF NOT EXISTS mega.item_situacao_hist (
  obra        TEXT NOT NULL,
  solicitacao BIGINT NOT NULL,
  sequencia   INTEGER NOT NULL,
  fornecedor  TEXT NOT NULL,
  situacao    TEXT,
  etapa       TEXT NOT NULL,
  desde       DATE NOT NULL,
  ate         DATE,
  PRIMARY KEY (obra, solicitacao, sequencia, fornecedor, desde)
);
CREATE INDEX IF NOT EXISTS idx_mega_item_situacao_vigente
  ON mega.item_situacao_hist(obra, solicitacao, sequencia, fornecedor)
  WHERE ate IS NULL;

CREATE TABLE IF NOT EXISTS mega.pedidos_compra (
  obra                TEXT NOT NULL,
  obra_nome           TEXT,
  data_extracao       DATE NOT NULL,
  numero_do_pedido    BIGINT NOT NULL,
  item_pedido         INTEGER NOT NULL,
  situacao_do_pedido  TEXT,
  dt_emissao          DATE,
  nome_fantasia       TEXT,
  descricao_do_item   TEXT,
  quantidade          NUMERIC,
  total_pedido_compra NUMERIC,
  raw_data            JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, numero_do_pedido, item_pedido)
);
CREATE INDEX IF NOT EXISTS idx_mega_pedidos_compra_obra
  ON mega.pedidos_compra(obra);

CREATE TABLE IF NOT EXISTS mega.analise_realizado (
  id              BIGSERIAL PRIMARY KEY,   -- sintetico: nao ha chave natural limpa
  obra            TEXT NOT NULL,
  obra_nome       TEXT,
  data_extracao   DATE NOT NULL,
  documento       BIGINT,
  data_documento  DATE,
  ap              NUMERIC,
  fornecedor      TEXT,
  valor_apropriacao NUMERIC,
  raw_data        JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_analise_realizado_obra
  ON mega.analise_realizado(obra);

-- ---------------------------------------------------------------------------
-- Tabelas "historico": so recebem INSERT, empilhadas por data_extracao.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mega.analise_pedidos_hist (
  id                BIGSERIAL PRIMARY KEY,
  obra              TEXT NOT NULL,
  obra_nome         TEXT,
  data_extracao     DATE NOT NULL,
  codigo_pedido     BIGINT,
  saldo_qtde        NUMERIC,
  valor_unitario    NUMERIC,
  total             NUMERIC,
  qtde_apropriada   NUMERIC,
  raw_data          JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_analise_pedidos_hist_obra_data
  ON mega.analise_pedidos_hist(obra, data_extracao);

CREATE TABLE IF NOT EXISTS mega.analise_contratos_hist (
  id                     BIGSERIAL PRIMARY KEY,
  obra                   TEXT NOT NULL,
  obra_nome              TEXT,
  data_extracao          DATE NOT NULL,
  codigo_contrato        BIGINT,
  fornecedor             TEXT,
  status_pre_contrato    TEXT,
  saldo_qtde_contrato    NUMERIC,
  valor_unitario         NUMERIC,
  total                  NUMERIC,
  raw_data               JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_analise_contratos_hist_obra_data
  ON mega.analise_contratos_hist(obra, data_extracao);

-- Manifesto de cada carga: o que rodou, quando, o que falhou.
CREATE TABLE IF NOT EXISTS mega.carga (
  id            BIGSERIAL PRIMARY KEY,
  relatorio     TEXT NOT NULL,
  arquivo       TEXT NOT NULL,
  data_extracao DATE NOT NULL,
  obras_ok            TEXT[] DEFAULT '{}',
  obras_sem_movimento TEXT[] DEFAULT '{}',
  obras_falhou        TEXT[] DEFAULT '{}',
  bloqueado     BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_bloqueio TEXT,
  executado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mega_carga_data
  ON mega.carga(data_extracao);
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_schema_mega.py -v`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add sql/schema_mega.sql tests/test_schema_mega.py
git commit -m "Schema SQL do mega: tabelas atual/historico/trilha conforme a spec"
```

---

## Task 5: Camada de acesso ao Postgres (`banco.py`)

**Files:**
- Create: `src/banco.py`
- Modify: `requirements.txt`
- Test: `tests/test_banco.py`

**Interfaces:**
- Consumes: `sql/schema_mega.sql` (Tarefa 4).
- Produces: `conectar() -> psycopg.Connection`; `aplicar_esquema(conn)`;
  `substituir_obra(conn, tabela: str, colunas: list[str], obra: str, linhas:
  list[tuple])`; `inserir_historico(conn, tabela: str, colunas: list[str],
  linhas: list[tuple])`; `aplicar_transicoes_situacao(conn, fechar: list[dict],
  abrir: list[dict])`; `registrar_carga(conn, relatorio: str, arquivo: str,
  data_iso: str, resultado: dict, bloqueado: bool = False, motivo: str | None =
  None)`. Usados pela Tarefa 6.

**Nota sobre os testes desta tarefa:** não há um Postgres real disponível nesta
sessão de desenvolvimento (Docker Desktop instalado mas parado, ver checagem
feita durante o planejamento). Os testes automatizados aqui usam um
`sqlite3.Connection` real com uma tradução mínima de esquema — SQLite entende
`INSERT`/`DELETE` parametrizado com `?` do mesmo jeito que o teste os monta, o
que é suficiente para validar a LÓGICA de transação e substituição por obra sem
depender de um servidor Postgres de verdade. **Antes de usar em produção**, a
Tarefa 12 (Empacotamento) inclui um passo de verificação manual contra um
Postgres real (via `docker compose up postgres` local) que não pode ser pulado.

- [ ] **Step 1: Adicionar a dependência**

```bash
python -m pip install "psycopg[binary]"
```

Adicionar ao final de `requirements.txt`:

```
psycopg[binary]           # escrita no PostgreSQL compartilhado com o Dados Prevision
```

- [ ] **Step 2: Escrever o teste de `substituir_obra` — substitui só a obra indicada**

```python
# tests/test_banco.py
# -*- coding: utf-8 -*-
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import banco


def _conexao_sqlite_com_tabela():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE itens_solicitados (obra TEXT, numero_rm INTEGER, "
        "descricao TEXT)")
    conn.execute("INSERT INTO itens_solicitados VALUES ('340', 1, 'antigo 340')")
    conn.execute("INSERT INTO itens_solicitados VALUES ('410', 1, 'antigo 410')")
    conn.commit()
    return conn


def test_substituir_obra_apaga_so_a_obra_indicada_e_insere_as_novas_linhas():
    conn = _conexao_sqlite_com_tabela()
    banco.substituir_obra(
        conn, "itens_solicitados", ["obra", "numero_rm", "descricao"],
        obra="340",
        linhas=[("340", 2, "novo 340 a"), ("340", 3, "novo 340 b")],
        marcador_parametro="?",   # sqlite usa '?'; psycopg usa '%s' (Step 5)
    )
    conn.commit()
    linhas = conn.execute(
        "SELECT obra, numero_rm, descricao FROM itens_solicitados ORDER BY obra, numero_rm"
    ).fetchall()
    assert linhas == [
        ("340", 2, "novo 340 a"),
        ("340", 3, "novo 340 b"),
        ("410", 1, "antigo 410"),   # obra 410 preservada — nao foi tocada
    ]


def test_substituir_obra_com_lista_vazia_so_apaga_e_nao_insere_nada():
    conn = _conexao_sqlite_com_tabela()
    banco.substituir_obra(conn, "itens_solicitados",
                          ["obra", "numero_rm", "descricao"],
                          obra="340", linhas=[], marcador_parametro="?")
    conn.commit()
    linhas = conn.execute(
        "SELECT obra FROM itens_solicitados ORDER BY obra").fetchall()
    assert linhas == [("410",)]
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_banco.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'banco'`

- [ ] **Step 4: Implementar `banco.py`**

```python
# -*- coding: utf-8 -*-
"""Escrita no schema `mega` do PostgreSQL compartilhado com o Dados Prevision.

Um dono por schema: este modulo NUNCA escreve fora de `mega.*`. O schema
`public` e do app Node (server/db.js do dadosprevision).

A carga e SEMPRE por obra, numa transacao: DELETE FROM <tabela> WHERE obra=%s,
seguido de INSERT das linhas novas. Se a obra 410 falhar na extracao de hoje,
esta funcao simplesmente nao e chamada para ela — os dados de ontem permanecem
(regra conservadora, igual ao consolidar.py existente).
"""
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _dsn_de_variaveis_de_ambiente():
    """Mesma convencao do server/db.js do Dados Prevision: DATABASE_URL tem
    prioridade; senao monta a partir de PGHOST/PGPORT/PGDATABASE/PGUSER/
    PGPASSWORD."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    host = os.environ.get("PGHOST", "localhost")
    port = os.environ.get("PGPORT", "5432")
    db = os.environ.get("PGDATABASE", "dadosprevision")
    user = os.environ.get("PGUSER", "postgres")
    senha = os.environ.get("PGPASSWORD", "")
    return "host=%s port=%s dbname=%s user=%s password=%s" % (host, port, db, user, senha)


def conectar():
    import psycopg
    return psycopg.connect(_dsn_de_variaveis_de_ambiente())


def aplicar_esquema(conn):
    sql = (RAIZ / "sql" / "schema_mega.sql").read_text(encoding="utf-8")
    conn.execute(sql) if hasattr(conn, "execute") else conn.executescript(sql)
    conn.commit()


def substituir_obra(conn, tabela, colunas, obra, linhas, marcador_parametro="%s"):
    cur = conn.cursor()
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur.execute("DELETE FROM %s%s WHERE obra = %s" % (prefixo, tabela, marcador_parametro),
               (obra,))
    if linhas:
        colunas_sql = ", ".join(colunas)
        marcadores = ", ".join([marcador_parametro] * len(colunas))
        cur.executemany(
            "INSERT INTO %s%s (%s) VALUES (%s)" % (prefixo, tabela, colunas_sql, marcadores),
            linhas)


def inserir_historico(conn, tabela, colunas, linhas, marcador_parametro="%s"):
    if not linhas:
        return
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    colunas_sql = ", ".join(colunas)
    marcadores = ", ".join([marcador_parametro] * len(colunas))
    cur.executemany(
        "INSERT INTO %s%s (%s) VALUES (%s)" % (prefixo, tabela, colunas_sql, marcadores),
        linhas)


def aplicar_transicoes_situacao(conn, fechar, abrir, marcador_parametro="%s"):
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    for linha in fechar:
        cur.execute(
            "UPDATE %sitem_situacao_hist SET ate = %s WHERE obra = %s AND "
            "solicitacao = %s AND sequencia = %s AND fornecedor = %s AND desde = %s"
            % (prefixo, marcador_parametro, marcador_parametro, marcador_parametro,
               marcador_parametro, marcador_parametro, marcador_parametro),
            (linha["ate"], linha["obra"], linha["solicitacao"], linha["sequencia"],
             linha["fornecedor"], linha["desde"]))
    if abrir:
        colunas = ["obra", "solicitacao", "sequencia", "fornecedor", "situacao",
                  "etapa", "desde"]
        linhas = [tuple(a[c] for c in colunas) for a in abrir]
        inserir_historico(conn, "item_situacao_hist", colunas, linhas,
                          marcador_parametro=marcador_parametro)


def registrar_carga(conn, relatorio, arquivo, data_iso, resultado,
                    bloqueado=False, motivo=None, marcador_parametro="%s"):
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    m = marcador_parametro
    cur.execute(
        "INSERT INTO %scarga (relatorio, arquivo, data_extracao, obras_ok, "
        "obras_sem_movimento, obras_falhou, bloqueado, motivo_bloqueio) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)" % (prefixo, m, m, m, m, m, m, m, m),
        (relatorio, arquivo, data_iso,
         json.dumps(resultado.get("ok", [])),
         json.dumps(resultado.get("sem_movimento", [])),
         json.dumps(resultado.get("falhou", [])),
         bloqueado, motivo))
```

Nota: os placeholders de array (`obras_ok TEXT[]`) recebem uma string JSON
neste rascunho porque o teste roda contra SQLite, que não tem tipo array. O
Step de verificação manual contra Postgres real (Tarefa 12) deve confirmar que
`psycopg` aceita `list[str]` diretamente para colunas `TEXT[]` — nesse caso,
trocar `json.dumps(...)` por `resultado.get("ok", [])` puro nesta função antes
do primeiro deploy real. Documentar esse ajuste como parte do checklist da
Tarefa 12.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_banco.py -v`
Expected: PASS (2 testes)

- [ ] **Step 6: Escrever o teste de `registrar_carga` e `aplicar_transicoes_situacao`**

```python
def test_registrar_carga_grava_uma_linha_por_chamada():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE carga (relatorio TEXT, arquivo TEXT, data_extracao TEXT, "
        "obras_ok TEXT, obras_sem_movimento TEXT, obras_falhou TEXT, "
        "bloqueado INTEGER, motivo_bloqueio TEXT)")
    banco.registrar_carga(conn, "itens_solicitados", "Itens_Solicitados",
                          "2026-09-07", {"ok": ["340", "410"], "sem_movimento": [],
                                        "falhou": []},
                          marcador_parametro="?")
    conn.commit()
    linha = conn.execute("SELECT relatorio, bloqueado FROM carga").fetchone()
    assert linha == ("itens_solicitados", 0)


def test_aplicar_transicoes_fecha_e_abre_nas_tabelas_certas():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE item_situacao_hist (obra TEXT, solicitacao INTEGER, "
        "sequencia INTEGER, fornecedor TEXT, situacao TEXT, etapa TEXT, "
        "desde TEXT, ate TEXT)")
    conn.execute(
        "INSERT INTO item_situacao_hist VALUES "
        "('340', 1, 1, 'X', 'Aberto', 'solicitado', '2026-09-01', NULL)")
    conn.commit()

    fechar = [{"obra": "340", "solicitacao": 1, "sequencia": 1, "fornecedor": "X",
              "desde": "2026-09-01", "ate": "2026-09-07"}]
    abrir = [{"obra": "340", "solicitacao": 1, "sequencia": 1, "fornecedor": "X",
             "situacao": "Cotado", "etapa": "cotado", "desde": "2026-09-07"}]
    banco.aplicar_transicoes_situacao(conn, fechar, abrir, marcador_parametro="?")
    conn.commit()

    linhas = conn.execute(
        "SELECT etapa, desde, ate FROM item_situacao_hist ORDER BY desde").fetchall()
    assert linhas == [
        ("solicitado", "2026-09-01", "2026-09-07"),
        ("cotado", "2026-09-07", None),
    ]
```

- [ ] **Step 7: Rodar e confirmar que falha, depois passa**

Run: `python -m pytest tests/test_banco.py -v`
Expected: primeira rodada FAIL se `registrar_carga`/`aplicar_transicoes_situacao`
tiverem qualquer incompatibilidade com SQLite (ex.: `json.dumps` em coluna TEXT
funciona; conferir). Ajustar a implementação do Step 4 até passar.
Expected final: PASS (4 testes no total do arquivo)

- [ ] **Step 8: Commit**

```bash
git add src/banco.py requirements.txt tests/test_banco.py
git commit -m "Camada de banco: substituicao por obra, historico, trilha e manifesto de carga"
```

---

## Task 6: Carregador — do Excel ao banco

**Files:**
- Create: `src/carregar.py`
- Test: `tests/test_carregar.py`

**Interfaces:**
- Consumes: `tradutor.traduzir_colunas` (Tarefa 2), `situacao.calcular_transicoes`
  (Tarefa 3), `banco.substituir_obra`/`inserir_historico`/
  `aplicar_transicoes_situacao`/`registrar_carga` (Tarefa 5),
  `cfgmod.retencao`/`chave_natural`/`tabela_destino` (Tarefa 1).
- Produces: `carregar_relatorio(cfg, conn, rel_id: str, data_iso: str, pasta:
  Path, resultado_execucao: dict) -> dict` (retorna um "relato" por exportação,
  no formato `{"arquivo": str, "estado": "OK"|"BLOQUEADO"|"VAZIO", "obras": int,
  "motivo": str | None}`, espelhando o estilo de `consolidar.py`).
  `purgar_arquivos(pasta: Path, relatos: list[dict]) -> list[Path]` (devolve os
  arquivos efetivamente apagados). Usados por `rodar_noite.py` (Tarefa 8).

- [ ] **Step 1: Escrever o teste do caso feliz — relatório "atual", uma obra**

```python
# tests/test_carregar.py
# -*- coding: utf-8 -*-
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import carregar


@pytest.fixture
def pasta_bruta(tmp_path):
    df = pd.DataFrame({
        "obra": [340, 340], "obra_nome": ["BALNEARIO", "BALNEARIO"],
        "data_extracao": ["2026-09-07", "2026-09-07"],
        "Código da solicitação": [1, 1], "Nr. RM": [10, 11],
        "Sequencial do item": [1, 1], "Data de emissão": ["2025-01-02", "2025-01-03"],
        "Situação do Item": ["Baixado", "Aberto"],
        "Descrição do item": ["ITEM A", "ITEM B"],
        "Quantidade solicitada": [1.0, 2.0], "Quantidade baixada": [1.0, 0.0],
        "Unidade": ["UN", "UN"],
    })
    df.to_excel(tmp_path / "Itens_Solicitados_340_2026-09-07.xlsx", index=False)
    return tmp_path


def _conexao_com_tabela_itens_solicitados():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE itens_solicitados (obra TEXT, obra_nome TEXT, "
        "data_extracao TEXT, codigo_solicitacao INTEGER, numero_rm INTEGER, "
        "sequencial_item INTEGER, data_de_emissao TEXT, situacao_do_item TEXT, "
        "descricao_do_item TEXT, quantidade_solicitada REAL, "
        "quantidade_baixada REAL, unidade TEXT)")
    conn.commit()
    return conn


def test_carregar_relatorio_atual_insere_as_linhas_da_obra(pasta_bruta):
    cfg = cfgmod.carregar()
    conn = _conexao_com_tabela_itens_solicitados()
    resultado_execucao = {"ok": ["340"], "sem_movimento": [], "falhou": []}
    relatos = carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", pasta_bruta,
        resultado_execucao, marcador_parametro="?")
    conn.commit()
    linhas = conn.execute(
        "SELECT numero_rm, situacao_do_item FROM itens_solicitados ORDER BY numero_rm"
    ).fetchall()
    assert linhas == [(10, "Baixado"), (11, "Aberto")]
    assert relatos == [{"arquivo": "Itens_Solicitados", "estado": "OK",
                        "obras": 1, "motivo": None}]
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_carregar.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'carregar'`

- [ ] **Step 3: Implementar o caminho feliz de `carregar_relatorio`**

```python
# -*- coding: utf-8 -*-
"""Le os .xlsx de dados/bruto/<data>/, traduz e grava no schema mega.

Regra conservadora, igual a consolidar.py: so grava as obras que a extracao da
noite marcou como "ok" ou "sem_movimento". Uma obra "falhou" mantem os dados de
ontem intocados no banco.
"""
from pathlib import Path

import pandas as pd

import banco
import config as cfgmod
from situacao import calcular_transicoes
from tradutor import traduzir_colunas

RAIZ = Path(__file__).resolve().parent.parent


def _linhas_atuais_por_obra(cfg, rel_id, data_iso, pasta, obras_a_carregar, aba=None):
    rel = cfgmod.relatorio(cfg, rel_id)
    arquivo_base = rel["exportacoes"][0]["arquivo"] if not aba else next(
        e["arquivo"] for e in rel["exportacoes"] if e.get("aba") == aba)
    por_obra = {}
    for obra in obras_a_carregar:
        caminho = pasta / ("%s_%s_%s.xlsx" % (arquivo_base, obra, data_iso))
        if not caminho.exists():
            continue
        df = pd.read_excel(caminho)
        por_obra[obra] = traduzir_colunas(df, rel_id, aba=aba)
    return por_obra, arquivo_base


def carregar_relatorio(cfg, conn, rel_id, data_iso, pasta, resultado_execucao,
                       marcador_parametro="%s"):
    obras_a_carregar = resultado_execucao.get("ok", []) + resultado_execucao.get(
        "sem_movimento", [])
    if resultado_execucao.get("falhou"):
        motivo = "obras com falha registrada: %s" % ",".join(
            f["obra"] if isinstance(f, dict) else f for f in resultado_execucao["falhou"])
        arquivo_base, _ = _linhas_atuais_por_obra(cfg, rel_id, data_iso, pasta, [])[1], None
        return [{"arquivo": arquivo_base, "estado": "BLOQUEADO", "obras": 0,
                "motivo": motivo}]

    por_obra, arquivo_base = _linhas_atuais_por_obra(
        cfg, rel_id, data_iso, pasta, obras_a_carregar)
    if not por_obra:
        return [{"arquivo": arquivo_base, "estado": "VAZIO", "obras": 0,
                "motivo": "nenhum arquivo encontrado"}]

    tabela = cfgmod.tabela_destino(cfg, rel_id)
    for obra, df in por_obra.items():
        colunas = list(df.columns)
        linhas = [tuple(row) for row in df.itertuples(index=False, name=None)]
        banco.substituir_obra(conn, tabela, colunas, obra, linhas,
                              marcador_parametro=marcador_parametro)

    banco.registrar_carga(conn, rel_id, arquivo_base, data_iso, resultado_execucao,
                          marcador_parametro=marcador_parametro)
    return [{"arquivo": arquivo_base, "estado": "OK", "obras": len(por_obra),
            "motivo": None}]
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_carregar.py -v`
Expected: PASS (1 teste)

- [ ] **Step 5: Escrever o teste da regra conservadora — obra que falhou bloqueia**

```python
def test_obra_que_falhou_bloqueia_a_carga_e_nao_apaga_dados_antigos(pasta_bruta):
    cfg = cfgmod.carregar()
    conn = _conexao_com_tabela_itens_solicitados()
    conn.execute(
        "INSERT INTO itens_solicitados VALUES "
        "('410', 'CROMA', '2026-09-06', 9, 99, 1, '2025-01-01', 'Aberto', "
        "'ANTIGO', 1.0, 0.0, 'UN')")
    conn.commit()

    resultado_execucao = {"ok": [], "sem_movimento": [], "falhou": [{"obra": "410"}]}
    relatos = carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", pasta_bruta,
        resultado_execucao, marcador_parametro="?")

    assert relatos[0]["estado"] == "BLOQUEADO"
    linhas = conn.execute("SELECT obra FROM itens_solicitados").fetchall()
    assert linhas == [("410",)]   # dado antigo intocado
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_carregar.py -v`
Expected: FAIL — a implementação atual do Step 3 tem um bug: quando
`obras_a_carregar` é vazio, `_linhas_atuais_por_obra` levanta `IndexError` ao
tentar achar `arquivo_base` (não há obras para determinar o nome do arquivo
quando a lista está vazia e não é passada explicitamente). Corrigir passando
`rel_id` e derivando `arquivo_base` direto da config, sem depender de haver
obras:

```python
def carregar_relatorio(cfg, conn, rel_id, data_iso, pasta, resultado_execucao,
                       aba=None, marcador_parametro="%s"):
    rel = cfgmod.relatorio(cfg, rel_id)
    arquivo_base = (rel["exportacoes"][0]["arquivo"] if not aba else
                   next(e["arquivo"] for e in rel["exportacoes"] if e.get("aba") == aba))

    if resultado_execucao.get("falhou"):
        motivo = "obras com falha registrada: %s" % ",".join(
            f["obra"] if isinstance(f, dict) else f for f in resultado_execucao["falhou"])
        return [{"arquivo": arquivo_base, "estado": "BLOQUEADO", "obras": 0,
                "motivo": motivo}]

    obras_a_carregar = resultado_execucao.get("ok", []) + resultado_execucao.get(
        "sem_movimento", [])
    por_obra = {}
    for obra in obras_a_carregar:
        caminho = pasta / ("%s_%s_%s.xlsx" % (arquivo_base, obra, data_iso))
        if not caminho.exists():
            continue
        df = pd.read_excel(caminho)
        por_obra[obra] = traduzir_colunas(df, rel_id, aba=aba)

    if not por_obra:
        return [{"arquivo": arquivo_base, "estado": "VAZIO", "obras": 0,
                "motivo": "nenhum arquivo encontrado"}]

    tabela = cfgmod.tabela_destino(cfg, rel_id)
    for obra, df in por_obra.items():
        colunas = list(df.columns)
        linhas = [tuple(row) for row in df.itertuples(index=False, name=None)]
        banco.substituir_obra(conn, tabela, colunas, obra, linhas,
                              marcador_parametro=marcador_parametro)

    banco.registrar_carga(conn, rel_id, arquivo_base, data_iso, resultado_execucao,
                          marcador_parametro=marcador_parametro)
    return [{"arquivo": arquivo_base, "estado": "OK", "obras": len(por_obra),
            "motivo": None}]
```

Remover a função auxiliar `_linhas_atuais_por_obra` do Step 3 (foi absorvida
aqui) e ajustar as chamadas no teste do Step 1, que não usam nome de parâmetro
posicional incompatível — conferir que `aba=None` como kwarg opcional não quebra
a chamada já escrita.

- [ ] **Step 7: Rodar e confirmar que os dois testes passam**

Run: `python -m pytest tests/test_carregar.py -v`
Expected: PASS (2 testes)

- [ ] **Step 8: Escrever o teste de `purgar_arquivos`**

```python
def test_purgar_arquivos_apaga_so_o_que_carregou_ok(pasta_bruta):
    outro = pasta_bruta / "Analise_Realizado_340_2026-09-07.xlsx"
    outro.write_bytes(b"PK\x03\x04lixo")  # simula um xlsx qualquer
    relatos = [
        {"arquivo": "Itens_Solicitados", "estado": "OK", "obras": 1, "motivo": None},
        {"arquivo": "Analise_Realizado", "estado": "BLOQUEADO", "obras": 0,
         "motivo": "obras com falha"},
    ]
    apagados = carregar.purgar_arquivos(pasta_bruta, relatos, "2026-09-07")
    assert (pasta_bruta / "Itens_Solicitados_340_2026-09-07.xlsx") not in list(
        pasta_bruta.iterdir())
    assert outro.exists()   # BLOQUEADO preserva o arquivo como evidencia
    assert len(apagados) == 1
```

- [ ] **Step 9: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_carregar.py -v`
Expected: FAIL — `purgar_arquivos` não existe.

- [ ] **Step 10: Implementar `purgar_arquivos`**

```python
def purgar_arquivos(pasta, relatos, data_iso):
    """Apaga os .xlsx do dia cuja carga NAO ficou BLOQUEADO.

    BLOQUEADO preserva o arquivo bruto como evidencia para investigacao manual
    — mesma logica conservadora de consolidar.py antes de sobrescrever.
    """
    pasta = Path(pasta)
    apagados = []
    for relato in relatos:
        if relato["estado"] == "BLOQUEADO":
            continue
        for caminho in pasta.glob("%s_*_%s.xlsx" % (relato["arquivo"], data_iso)):
            caminho.unlink()
            apagados.append(caminho)
    return apagados
```

- [ ] **Step 11: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_carregar.py -v`
Expected: PASS (3 testes)

- [ ] **Step 12: Commit**

```bash
git add src/carregar.py tests/test_carregar.py
git commit -m "Carregador: Excel para o schema mega, com bloqueio conservador e purga"
```

---

## Task 7: Tesseract multiplataforma

**Files:**
- Create: `src/plataforma.py`
- Modify: `src/executar.py:24`
- Modify: `ferramentas/mapear_relatorio.py:20`, `ferramentas/depurar_exportacao.py:19`,
  `ferramentas/mapear_tela.py`, `ferramentas/testar_relatorio1.py`
- Test: `tests/test_plataforma.py`

**Interfaces:**
- Produces: `caminho_tesseract() -> str`, usado por `executar.py` e pelos 4
  scripts de `ferramentas/`.

- [ ] **Step 1: Escrever o teste**

```python
# tests/test_plataforma.py
# -*- coding: utf-8 -*-
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import plataforma


def test_variavel_de_ambiente_tem_prioridade(monkeypatch):
    monkeypatch.setenv("TESSERACT_BIN", "/caminho/customizado/tesseract")
    assert plataforma.caminho_tesseract() == "/caminho/customizado/tesseract"


def test_sem_variavel_usa_padrao_do_linux_quando_nao_e_windows(monkeypatch):
    monkeypatch.delenv("TESSERACT_BIN", raising=False)
    monkeypatch.setattr(plataforma.sys, "platform", "linux")
    assert plataforma.caminho_tesseract() == "/usr/bin/tesseract"
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_plataforma.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implementar `src/plataforma.py`**

```python
# -*- coding: utf-8 -*-
"""Caminho do binario do Tesseract, que muda entre o Windows de desenvolvimento
e o container Linux da VPS."""
import os
import sys

_PADRAO_WINDOWS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
_PADRAO_LINUX = "/usr/bin/tesseract"   # instalado via apt no Dockerfile


def caminho_tesseract():
    if os.environ.get("TESSERACT_BIN"):
        return os.environ["TESSERACT_BIN"]
    return _PADRAO_WINDOWS if sys.platform == "win32" else _PADRAO_LINUX
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_plataforma.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Aplicar em `executar.py`**

Em `src/executar.py`, substituir a linha 24:

```python
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
```

por:

```python
from plataforma import caminho_tesseract

TESSERACT = caminho_tesseract()
```

- [ ] **Step 6: Aplicar nos 4 scripts de `ferramentas/`**

Em cada um de `ferramentas/mapear_relatorio.py`, `ferramentas/depurar_exportacao.py`,
`ferramentas/mapear_tela.py`, `ferramentas/testar_relatorio1.py`, substituir a
linha `TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"` por:

```python
from plataforma import caminho_tesseract

TESS = caminho_tesseract()
```

(o `sys.path.insert(0, ...)` que aponta para `src/` já existe em todos os 4
arquivos — conferir antes de editar, como no exemplo de
`ferramentas/mapear_relatorio.py:12`.)

- [ ] **Step 7: Verificar que os 4 scripts continuam válidos sintaticamente**

Run: `python -m py_compile src/executar.py ferramentas/mapear_relatorio.py ferramentas/depurar_exportacao.py ferramentas/mapear_tela.py ferramentas/testar_relatorio1.py`
Expected: sem saída, sem erro (compilação silenciosa = sucesso)

- [ ] **Step 8: Commit**

```bash
git add src/plataforma.py src/executar.py ferramentas/*.py tests/test_plataforma.py
git commit -m "Tesseract multiplataforma: caminho por variavel de ambiente, com padrao por SO"
```

---

## Task 8: Encerramento de sessão pelo caminho confirmado em campo

**Files:**
- Modify: `src/biblioteca.py:460-479` (`Operador.encerrar_sessao`)

**Interfaces:**
- Consumes: `self.ICONE_PESSOA`, `self.v.achar_texto`, `centro` (já existentes
  em `biblioteca.py`).
- Produces: mesmo contrato de antes — `encerrar_sessao() -> bool`.

O usuário confirmou em 2026-09-07 que o caminho ícone de pessoa → opção de sair
funciona (spec, "Limitações conhecidas"). Isso substitui o `Ctrl+Alt+Delete`
atual, que não atravessa o gateway HTML5.

- [ ] **Step 1: Reescrever `encerrar_sessao`**

Em `src/biblioteca.py`, substituir o método inteiro (linhas 460-479):

```python
    def encerrar_sessao(self):
        """Desloga do Windows remoto pelo painel do usuario.

        CORRIGIDO 2026-09-07: Ctrl+Alt+Delete NAO atravessa o gateway HTML5 —
        e um atalho do SO local, nao da sessao remota. O caminho confirmado
        pelo usuario e o mesmo painel usado em trocar_empresa: icone de pessoa,
        depois a opcao de sair. Fechar so a aba do Playwright deixa a sessao
        viva no servidor Mega; sem deslogar, o usuario acumula sessoes orfas
        que o proprio Mega derruba na entrada seguinte (ver
        responder_sessao_duplicada), transformando isso numa falha
        intermitente sem sintoma claro.

        Os textos candidatos seguem o mesmo padrao de responder_sessao_duplicada:
        tenta cada um, na ordem, e usa o primeiro que aparecer na tela — o Mega
        nao usa sempre o mesmo rotulo em todo lugar.
        """
        TEXTOS_SAIR = ("Sair", "Encerrar Sessão", "Desconectar", "Log Off")
        try:
            self.pagina.mouse.click(self.ICONE_PESSOA[0], self.ICONE_PESSOA[1])
            time.sleep(3.0)
            img = self.tela()
            for texto in TEXTOS_SAIR:
                caixa = self.v.achar_texto(texto, img=img)
                if caixa:
                    x, y = centro(caixa)
                    self.pagina.mouse.click(x, y)
                    time.sleep(5)
                    self.log("   sessao encerrada via painel do usuario (%r)" % texto)
                    return True
            self.log("   painel do usuario abriu mas nenhum texto de saida foi achado")
        except Exception as e:
            self.log("   nao consegui encerrar a sessao: %s" % str(e)[:60])
        return False
```

- [ ] **Step 2: Verificar sintaxe**

Run: `python -m py_compile src/biblioteca.py`
Expected: sem saída, sem erro

**Verificação manual obrigatória (não pode ser automatizada nesta sessão):**
rodar `python src/executar.py --relatorio itens_solicitados --obras 340` uma vez
e observar, ao final, se o log mostra `"sessao encerrada via painel do usuario"`
e se a sessão de fato cai (conferir entrando de novo no Mega e checando que NÃO
aparece o diálogo de sessão duplicada). Caso nenhum dos 4 textos candidatos seja
encontrado, usar `ferramentas/mapear_relatorio.py` (ou um script equivalente
apontando para o painel do usuário já aberto) para listar as palavras reais do
menu e atualizar `TEXTOS_SAIR`.

- [ ] **Step 3: Commit**

```bash
git add src/biblioteca.py
git commit -m "Encerrar sessao pelo painel do usuario, confirmado em campo (nao Ctrl+Alt+Del)"
```

---

## Task 9: Refatorar `executar.py` para expor uma função reutilizável

**Files:**
- Modify: `src/executar.py`
- Test: `tests/test_executar_refatorado.py`

**Interfaces:**
- Consumes: nada novo.
- Produces: `executar_relatorio(op, v, s, rel: dict, obras: list[dict], data_iso:
  str, pasta: Path, falhas_dir: Path, log: callable) -> dict` — o corpo do laço
  `for i, obra in enumerate(obras, 1): ...` que hoje vive dentro de `main()`
  (linhas 220-262), extraído para ser chamado tanto pelo `main()` da CLI quanto
  por `rodar_noite.py` (Tarefa 10) sem duplicar a lógica de reconexão.

Esta tarefa é puramente uma extração de função — nenhum comportamento muda. O
teste garante isso comparando o formato do retorno.

- [ ] **Step 1: Escrever o teste que fixa o contrato de retorno**

```python
# tests/test_executar_refatorado.py
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import executar


def test_executar_relatorio_existe_e_aceita_a_assinatura_esperada():
    import inspect
    assinatura = inspect.signature(executar.executar_relatorio)
    parametros = list(assinatura.parameters)
    assert parametros == ["op", "v", "s", "rel", "obras", "data_iso", "pasta",
                          "falhas_dir", "log"]


def test_executar_relatorio_devolve_dict_com_as_tres_chaves_do_resultado():
    # Teste de contrato, nao de comportamento: usa uma obra vazia para nao
    # exigir sessao real, so verificando a FORMA do retorno.
    resultado = executar.executar_relatorio(
        op=None, v=None, s=None, rel={"id": "x", "exportacoes": []},
        obras=[], data_iso="2026-09-07", pasta=Path("."), falhas_dir=Path("."),
        log=lambda *a: None)
    assert set(resultado.keys()) == {"ok", "sem_movimento", "falhou"}
    assert resultado == {"ok": [], "sem_movimento": [], "falhou": []}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_executar_refatorado.py -v`
Expected: FAIL — `AttributeError: module 'executar' has no attribute
'executar_relatorio'`

- [ ] **Step 3: Extrair a função de `main()`**

Em `src/executar.py`, adicionar antes de `def main():` (a extração é o corpo
das linhas 220-262 de `main()`, sem mudar nenhuma linha de lógica):

```python
def executar_relatorio(op, v, s, rel, obras, data_iso, pasta, falhas_dir, log):
    """O laço de uma execucao de relatorio por todas as obras, extraido de
    main() para ser reutilizavel por rodar_noite.py (varias execucoes numa
    unica sessao) sem duplicar a logica de reconexao e falha por obra."""
    resultado = {"ok": [], "sem_movimento": [], "falhou": []}
    for i, obra in enumerate(obras, 1):
        log("")
        log("[%d/%d] obra %s - %s" % (i, len(obras), obra["codigo"], obra["nome"]))
        try:
            if op is not None and op.pagina.is_closed():
                log("   sessao caida; reconectando")
                erp = s.abrir_erp()
                v = Visao(erp, binario_tesseract=TESSERACT)
                op = Operador(erp, visao=v, log=log)
                op.esperar_erp_pronto(timeout=300)
                log("   reconectado")
            estado, caminhos = uma_obra(op, v, rel, obra, data_iso, pasta)
            if estado == "sem_movimento":
                log("   sem movimento no periodo")
                resultado["sem_movimento"].append(obra["codigo"])
            else:
                for c in caminhos:
                    log("   OK: %s (%d bytes)" % (c.name, c.stat().st_size))
                resultado["ok"].append(obra["codigo"])
        except Exception as e:
            log("   FALHOU: %s" % str(e).splitlines()[0][:110])
            resultado["falhou"].append({"obra": obra["codigo"], "motivo": str(e)})
            if op is not None and "closed" in str(e).lower():
                try:
                    erp = s.abrir_erp()
                    v = Visao(erp, binario_tesseract=TESSERACT)
                    op = Operador(erp, visao=v, log=log)
                    op.esperar_erp_pronto(timeout=300)
                    log("   reconectado apos queda")
                except Exception as e2:
                    log("   reconexao falhou: %s" % str(e2).splitlines()[0][:80])
            if op is not None:
                try:
                    op.pagina.screenshot(path=str(falhas_dir / ("%s_%s.png"
                                         % (data_iso, obra["codigo"]))))
                except Exception:
                    pass
    return resultado
```

Nota: a função usa `op.pagina.is_closed()` em vez do `erp.is_closed()` do
código original — `op.pagina` é o mesmo objeto `erp` que era passado antes
(ver `Operador.__init__`, que guarda a página em `self.pagina`), então o
comportamento é idêntico; o teste de contrato do Step 1 aceita `op=None` sem
tocar essa linha graças ao `if op is not None`.

Reescrever `main()` para chamar a função extraída em vez do laço original
(linhas 220-262 do arquivo original são substituídas por uma chamada):

```python
        resultado = executar_relatorio(op, v, s, rel, obras, args.data, pasta,
                                       falhas_dir, log)

        log("")
        log("encerrando a sessao do Windows remoto")
        op.encerrar_sessao()
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_executar_refatorado.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Verificar que o arquivo inteiro ainda compila e que a suíte completa continua verde**

Run: `python -m py_compile src/executar.py && python -m pytest tests/ -v`
Expected: sem erro de compilação; todos os testes de todas as tarefas
anteriores continuam PASS (nenhuma regressão).

**Verificação manual obrigatória:** rodar
`python src/executar.py --relatorio itens_solicitados --obras 340` contra o ERP
real uma vez, e conferir que o comportamento observável (log, arquivo baixado,
manifesto) é idêntico ao de antes da refatoração — esta parte não tem como ser
coberta por teste automatizado nesta sessão, pelo mesmo motivo que nenhuma
outra interação com o ERP tem.

- [ ] **Step 6: Commit**

```bash
git add src/executar.py tests/test_executar_refatorado.py
git commit -m "Extrai executar_relatorio() de main() para reuso em rodar_noite.py"
```

---

## Task 10: Orquestrador da noite (`rodar_noite.py`)

**Files:**
- Create: `src/rodar_noite.py`
- Test: `tests/test_rodar_noite.py`

**Interfaces:**
- Consumes: `executar.executar_relatorio` (Tarefa 9), `carregar.carregar_relatorio`
  e `carregar.purgar_arquivos` (Tarefa 6), `banco.conectar`/`aplicar_esquema`
  (Tarefa 5), `Sessao`, `Visao`, `Operador` (já existentes).
- Produces: `rodar_relatorios_da_noite(cfg, conectar_fn, abrir_sessao_fn,
  data_iso: str) -> dict` — função orquestradora, com as dependências externas
  (banco e sessão do navegador) injetadas por parâmetro para ser testável sem
  ERP nem Postgres reais. `main()` — ponto de entrada real, chamado pelo
  `agendador.py` (Tarefa 11) e utilizável via `python src/rodar_noite.py`.

- [ ] **Step 1: Escrever o teste com dependências falsas (dublês)**

```python
# tests/test_rodar_noite.py
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import rodar_noite


class _ConexaoFalsa:
    def commit(self):
        pass


class _SessaoFalsa:
    """Dubla Sessao: nao abre navegador nenhum. Registra o que foi chamado."""
    def __init__(self):
        self.chamadas = []

    def entrar(self):
        self.chamadas.append("entrar")
        return "login efetuado"

    def abrir_erp(self):
        self.chamadas.append("abrir_erp")
        return "pagina-falsa"


def test_rodar_relatorios_da_noite_roda_os_4_relatorios_em_uma_unica_sessao(monkeypatch):
    cfg = cfgmod.carregar()
    chamadas_executar = []

    def executar_relatorio_falso(op, v, s, rel, obras, data_iso, pasta, falhas_dir, log):
        chamadas_executar.append(rel["id"])
        return {"ok": [], "sem_movimento": [o["codigo"] for o in obras], "falhou": []}

    def carregar_relatorio_falso(cfg, conn, rel_id, data_iso, pasta, resultado, **kw):
        return [{"arquivo": rel_id, "estado": "OK", "obras": 0, "motivo": None}]

    def purgar_arquivos_falso(pasta, relatos, data_iso):
        return []

    monkeypatch.setattr(rodar_noite, "executar_relatorio", executar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "carregar_relatorio", carregar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "purgar_arquivos", purgar_arquivos_falso)
    monkeypatch.setattr(rodar_noite, "Operador", lambda *a, **k: object())
    monkeypatch.setattr(rodar_noite, "Visao", lambda *a, **k: object())

    sessao_falsa = _SessaoFalsa()
    resultado = rodar_noite.rodar_relatorios_da_noite(
        cfg, conectar_fn=lambda: _ConexaoFalsa(),
        abrir_sessao_fn=lambda: sessao_falsa, data_iso="2026-09-07")

    assert chamadas_executar == ["itens_solicitados", "analise_saldo_solicitacao",
                                 "visualizacao_itens", "pedidos_compra"]
    assert sessao_falsa.chamadas == ["entrar", "abrir_erp"]
    assert set(resultado.keys()) == {"itens_solicitados", "analise_saldo_solicitacao",
                                     "visualizacao_itens", "pedidos_compra"}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_rodar_noite.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'rodar_noite'`

- [ ] **Step 3: Implementar `rodar_noite.py`**

```python
# -*- coding: utf-8 -*-
"""Orquestra uma noite inteira: os 4 relatorios, numa unica sessao do ERP,
seguidos da carga no Postgres e da purga dos arquivos que carregaram OK.

Ponto de entrada do container `mega` (chamado pelo agendador.py). As
dependencias externas (sessao do navegador, conexao com o banco) entram por
parametro para permitir testar a ORQUESTRACAO sem abrir Chrome nem Postgres.
"""
import datetime as dt
from pathlib import Path

import banco
import config as cfgmod
from biblioteca import Operador
from carregar import carregar_relatorio, purgar_arquivos
from executar import TESSERACT, executar_relatorio
from sessao import Sessao
from visao import Visao

RAIZ = Path(__file__).resolve().parent.parent
ORDEM_RELATORIOS = ["itens_solicitados", "analise_saldo_solicitacao",
                    "visualizacao_itens", "pedidos_compra"]


def _log(msg):
    print("%s  %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def rodar_relatorios_da_noite(cfg, conectar_fn, abrir_sessao_fn, data_iso):
    pasta = RAIZ / "dados" / "bruto" / data_iso
    pasta.mkdir(parents=True, exist_ok=True)
    falhas_dir = RAIZ / "dados" / "falhas"
    falhas_dir.mkdir(parents=True, exist_ok=True)

    obras = cfgmod.obras(cfg)
    conn = conectar_fn()
    banco.aplicar_esquema(conn) if hasattr(banco, "aplicar_esquema") else None

    s = abrir_sessao_fn()
    _log("login: %s" % s.entrar())
    erp = s.abrir_erp()
    v = Visao(erp, binario_tesseract=TESSERACT)
    op = Operador(erp, visao=v, log=_log)

    resultados = {}
    for rel_id in ORDEM_RELATORIOS:
        rel = cfgmod.relatorio(cfg, rel_id)
        resultado_execucao = executar_relatorio(op, v, s, rel, obras, data_iso,
                                                pasta, falhas_dir, _log)
        relatos = carregar_relatorio(cfg, conn, rel_id, data_iso, pasta,
                                     resultado_execucao)
        conn.commit()
        purgar_arquivos(pasta, relatos, data_iso)
        resultados[rel_id] = {"execucao": resultado_execucao, "carga": relatos}

    op.encerrar_sessao()
    return resultados


def main():
    cfg = cfgmod.carregar()
    data_iso = dt.date.today().isoformat()
    resultados = rodar_relatorios_da_noite(
        cfg, conectar_fn=banco.conectar, abrir_sessao_fn=Sessao, data_iso=data_iso)
    for rel_id, r in resultados.items():
        exec_r = r["execucao"]
        _log("%s: ok=%d sem_movimento=%d falhou=%d" % (
            rel_id, len(exec_r["ok"]), len(exec_r["sem_movimento"]),
            len(exec_r["falhou"])))
    return resultados


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_rodar_noite.py -v`
Expected: PASS (1 teste)

**Verificação manual obrigatória:** esta função nunca roda de ponta a ponta
contra o ERP e o Postgres reais dentro desta sessão de planejamento/implementação
— exige o ambiente da VPS (Tarefa 12). Antes de agendar (Tarefa 11), rodar
`python src/rodar_noite.py` manualmente uma vez, observar os logs completos, e
conferir em `mega.carga` que as 4 linhas de manifesto foram gravadas.

- [ ] **Step 5: Commit**

```bash
git add src/rodar_noite.py tests/test_rodar_noite.py
git commit -m "Orquestrador da noite: os 4 relatorios, uma sessao, carga e purga"
```

---

## Task 11: Agendador

**Files:**
- Create: `src/agendador.py`
- Modify: `requirements.txt`
- Test: `tests/test_agendador.py`

**Interfaces:**
- Consumes: `rodar_noite.main` (Tarefa 10).
- Produces: `proxima_execucao(agora: datetime.datetime, expressao_cron: str) ->
  datetime.datetime`; `main()` — laço infinito que dorme até a próxima execução
  e chama `rodar_noite.main()`.

- [ ] **Step 1: Adicionar a dependência**

```bash
python -m pip install croniter
```

Adicionar ao `requirements.txt`:

```
croniter                  # calcula a proxima execucao a partir de CRON_SCHEDULE_MEGA
```

- [ ] **Step 2: Escrever o teste de `proxima_execucao`**

```python
# tests/test_agendador.py
# -*- coding: utf-8 -*-
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import agendador


def test_proxima_execucao_hoje_quando_ainda_nao_passou_do_horario():
    agora = dt.datetime(2026, 9, 7, 1, 0, 0)
    proxima = agendador.proxima_execucao(agora, "0 2 * * *")
    assert proxima == dt.datetime(2026, 9, 7, 2, 0, 0)


def test_proxima_execucao_amanha_quando_ja_passou_do_horario():
    agora = dt.datetime(2026, 9, 7, 3, 0, 0)
    proxima = agendador.proxima_execucao(agora, "0 2 * * *")
    assert proxima == dt.datetime(2026, 9, 8, 2, 0, 0)
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_agendador.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agendador'`

- [ ] **Step 4: Implementar**

```python
# -*- coding: utf-8 -*-
"""Laco de agendamento: dorme ate o horario configurado e dispara a noite.

Processo de longa duracao dentro do container `mega` (restart: always no
Compose) — sem depender de cron do host nem de ferramenta de orquestracao
externa.
"""
import os
import time

from croniter import croniter


def proxima_execucao(agora, expressao_cron):
    it = croniter(expressao_cron, agora)
    return it.get_next(type(agora))


def main():
    import datetime as dt

    import rodar_noite

    expressao = os.environ.get("CRON_SCHEDULE_MEGA", "0 2 * * *")
    while True:
        agora = dt.datetime.now()
        proxima = proxima_execucao(agora, expressao)
        espera = (proxima - agora).total_seconds()
        print("proxima execucao: %s (em %.0fs)" % (proxima.isoformat(), espera),
             flush=True)
        time.sleep(max(0, espera))
        try:
            rodar_noite.main()
        except Exception as e:
            print("execucao da noite falhou: %s" % e, flush=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_agendador.py -v`
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```bash
git add src/agendador.py requirements.txt tests/test_agendador.py
git commit -m "Agendador: dorme ate CRON_SCHEDULE_MEGA e dispara rodar_noite"
```

---

## Task 12: Empacotamento — Dockerfile, `.env.example`, fragmento de Compose e verificação com Postgres real

**Files:**
- Create: `Dockerfile`
- Create: `.env.example`
- Create: `deploy/docker-compose.mega.snippet.yml`
- Create: `deploy/DEPLOY_VPS.md`
- Modify: `.gitignore` (garantir que `.env` e `.sessao.json` continuam fora,
  conferir que nada novo desta tarefa precisa entrar)

**Interfaces:** nenhuma — esta tarefa produz artefatos de implantação, não
código consumido por outro módulo.

- [ ] **Step 1: Escrever o `Dockerfile`**

```dockerfile
# Chrome real (nao o Chromium do Playwright — o gateway HTML5 nao carrega nele,
# ver sessao.py) sob Xvfb (display virtual: headless=False sem monitor real).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb tesseract-ocr tesseract-ocr-por wget gnupg \
    && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m playwright install-deps chromium

COPY . .

ENV TESSERACT_BIN=/usr/bin/tesseract

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1600x900x24", \
    "python", "src/agendador.py"]
```

- [ ] **Step 2: Escrever `.env.example`**

Seguindo o padrão de `dadosprevision/.env.example` (mesmas variáveis de banco):

```env
# PostgreSQL compartilhado com o Dados Prevision — mesmos valores do .env dele
POSTGRES_DB=dadosprevision
POSTGRES_USER=postgres
POSTGRES_PASSWORD=uma_senha_forte

# Credenciais do Mega ERP — NUNCA commitar o .env real
MEGA_USUARIO=
MEGA_SENHA=

# Formato cron. Padrao: 02:00 todo dia — fora de qualquer horario de uso do
# ERP, porque a execucao mantem a sessao do usuario aberta por ~2h30 (ver spec).
CRON_SCHEDULE_MEGA=0 2 * * *
```

- [ ] **Step 3: Escrever o fragmento de Compose a ser mesclado quando a migração para `dadosprevision/mega` acontecer**

```yaml
# deploy/docker-compose.mega.snippet.yml
#
# Este fragmento NAO e aplicado automaticamente. Quando o repositorio
# mega-relatorios for movido para dentro de dadosprevision/mega (decisao do
# usuario, fora do escopo deste plano), copiar este servico para dentro do
# docker-compose.yml do Dados Prevision, ajustando "build: ./mega" se o
# caminho final for diferente.

services:
  mega:
    build: ./mega
    container_name: dadosprevision-mega
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PGHOST: postgres
      PGPORT: 5432
      PGDATABASE: ${POSTGRES_DB:-dadosprevision}
      PGUSER: ${POSTGRES_USER:-postgres}
      PGPASSWORD: ${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}
      MEGA_USUARIO: ${MEGA_USUARIO:?defina MEGA_USUARIO}
      MEGA_SENHA: ${MEGA_SENHA:?defina MEGA_SENHA}
      CRON_SCHEDULE_MEGA: ${CRON_SCHEDULE_MEGA:-0 2 * * *}
    volumes:
      - mega_dados:/app/dados   # so para BLOQUEADO reter evidencia

volumes:
  mega_dados:
    driver: local
```

- [ ] **Step 4: Escrever `deploy/DEPLOY_VPS.md`**

```markdown
# Deploy do robo Mega na VPS (dentro da stack do Dados Prevision)

Pre-requisito: o Dados Prevision ja rodando na VPS via Docker Compose (ver
`deploy.md` daquele repositorio), com `postgres` saudavel.

## 1. Aplicar o schema `mega`

Antes de subir o container `mega` pela primeira vez, aplicar o schema
manualmente (o container tambem tenta aplicar sozinho no boot, via
`banco.aplicar_esquema`, mas confirmar manualmente na primeira vez evita
depurar dois problemas ao mesmo tempo):

    docker compose exec -T postgres psql -U postgres -d dadosprevision \
      < sql/schema_mega.sql

Conferir: `docker compose exec postgres psql -U postgres -d dadosprevision -c '\dt mega.*'`
deve listar as 9 tabelas (obra_projeto, itens_solicitados, visualizacao_itens,
item_situacao_hist, pedidos_compra, analise_realizado, analise_pedidos_hist,
analise_contratos_hist, carga).

## 2. Preencher a tabela de-para de obras

A correspondencia entre obra do Mega e projeto da Prevision e PARCIAL
(confirmado com o usuario). Preencher manualmente, uma vez:

    docker compose exec -T postgres psql -U postgres -d dadosprevision <<'SQL'
    INSERT INTO mega.obra_projeto (obra, id_prevision, observacao) VALUES
      ('340', NULL, 'confirmar codigo Prevision'),
      ('410', NULL, 'confirmar codigo Prevision'),
      ('430', NULL, 'confirmar codigo Prevision'),
      ('480', NULL, 'confirmar codigo Prevision'),
      ('490', NULL, 'confirmar codigo Prevision'),
      ('601', NULL, 'confirmar codigo Prevision'),
      ('630', NULL, 'confirmar codigo Prevision'),
      ('650', NULL, 'confirmar codigo Prevision')
    ON CONFLICT (obra) DO NOTHING;
    SQL

Depois, atualizar `id_prevision` obra por obra com o `id_prevision` real
(consultar `SELECT id_prevision, nome_projeto FROM public.projetos;` e casar
manualmente pelo nome — a correspondencia foi confirmada como parcial, então
nem toda obra vai ter um `id_prevision`).

## 3. Merge do serviço no `docker-compose.yml`

Copiar o conteúdo de `deploy/docker-compose.mega.snippet.yml` para dentro do
`docker-compose.yml` do Dados Prevision (serviço `mega`, ao lado de `postgres`
e `app`). Adicionar as variáveis `MEGA_USUARIO`, `MEGA_SENHA` e
`CRON_SCHEDULE_MEGA` ao `.env` da VPS (nunca commitado).

## 4. Subir e verificar

    docker compose up -d --build mega
    docker compose logs -f mega

Esperado no log: `login: login efetuado` (ou `sessao reaproveitada`), seguido
da extração dos 4 relatórios. A primeira execução real só acontece no próximo
horário de `CRON_SCHEDULE_MEGA` — para testar sem esperar até de madrugada,
rodar manualmente uma vez:

    docker compose exec mega python src/rodar_noite.py

## 5. Verificação manual do banco com Postgres real (pendência da Tarefa 5)

A Tarefa 5 (`src/banco.py`) foi testada nesta fase só contra SQLite, por falta
de um Postgres real na máquina de desenvolvimento. Antes de confiar na carga em
produção, rodar manualmente, com o Postgres real da VPS (ou um Postgres local
via `docker compose up postgres`):

    docker compose exec mega python -c "
    import sys; sys.path.insert(0, 'src')
    import banco
    conn = banco.conectar()
    banco.aplicar_esquema(conn)
    banco.substituir_obra(conn, 'itens_solicitados',
        ['obra', 'codigo_solicitacao'], '340', [('340', 1)])
    conn.commit()
    print('ok')
    "

Conferir especificamente se `registrar_carga` grava corretamente as colunas
`TEXT[]` (`obras_ok`, `obras_sem_movimento`, `obras_falhou`) — o rascunho da
Tarefa 5 usa `json.dumps()` para compatibilidade com o teste em SQLite; se o
psycopg aceitar `list[str]` Python diretamente para uma coluna `TEXT[]` (o
caminho normal), trocar por atribuição direta em `src/banco.py` antes do
primeiro deploy real.

## 6. Primeira semana: acompanhar `mega.carga`

    SELECT relatorio, data_extracao, obras_ok, obras_falhou, bloqueado
    FROM mega.carga ORDER BY executado_em DESC LIMIT 20;

Sem notificação ativa (decisão do usuário) — a conferência é manual nesta
consulta.
```

- [ ] **Step 5: Verificar que nenhum segredo foi commitado**

Run: `git status --short && git diff --cached -- .env`
Expected: `.env` não aparece em nenhum dos dois (só `.env.example` deve estar
staged); confirmar com `git check-ignore -v .env` que ele continua ignorado.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .env.example deploy/
git commit -m "Empacotamento: Dockerfile, .env.example, fragmento de Compose e guia de deploy"
```

---

## Self-Review desta versão do plano

**Cobertura da spec:** Arquitetura (Task 12 — Dockerfile + snippet de Compose,
sem tocar o repo dadosprevision); Modelo de dados / chaves naturais (Task 1 +
Task 4); Retenção por arquivo (Task 1 + schema da Task 4, tabelas
`*_hist` vs. tabelas "atuais"); Tradução de colunas com pendência explícita
(Task 2, Step 13); Trilha de situação (Task 3); Pipeline diário / carga por
obra / regra conservadora (Task 6); Agendamento e janela noturna única (Task
11, `.env.example`); Limitação `\\tsclient\WebFile` (não requer código —
permanece documentada só na spec, nenhuma tarefa a resolve porque está fora do
alcance do container); Encerramento de sessão corrigido (Task 8); Riscos não
verificáveis (download via gateway em Linux e estabilidade de chaves — ambos
viram passos de verificação manual explícitos nas Tasks 10 e 12, não ignorados).

**Placeholders:** nenhum "TBD" resta; as poucas incertezas genuínas (mapeamento
de colunas ambíguas, comportamento do psycopg com `TEXT[]`) viram passos
concretos de verificação com ação definida, não texto vago.

**Consistência de tipos:** `carregar_relatorio` (Task 6) usa exatamente as
funções de `banco.py` (Task 5) e `tradutor.py` (Task 2) pelos nomes definidos
nelas; `rodar_noite.py` (Task 10) importa `executar_relatorio` com a assinatura
travada pelo teste de contrato da Task 9; `agendador.py` (Task 11) chama
`rodar_noite.main()` como definido na Task 10.
