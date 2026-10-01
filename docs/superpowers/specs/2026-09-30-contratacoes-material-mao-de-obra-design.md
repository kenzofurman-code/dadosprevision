# Contratações — Base comprometida, Material × Mão de obra, flags por fase e micro em tabela — Design

Data: 2026-09-30 · Obra piloto: POTY (Mega 650 ↔ Prevision 40661)
Evolui `2026-09-28-gestao-contratacoes-design.md`.

## 1. Problema

No drywall do POTY o painel mostrava 32% pedido, 3% contratado e R$ 390 mil
"falta lançar", enquanto a projeção de custo (e o Mega) mostram ~97%
comprometido. Diagnóstico no banco da VPS (2026-09-30):

| Fonte (drywall, 01.05.01.03.*) | Valor |
|---|---|
| Apropriado (`mega.analise_realizado`) | R$ 1.090 mil |
| Saldo aberto de contratos (`mega.analise_contratos_hist`, última extração) | R$ 187 mil |
| Saldo aberto de pedidos (`mega.analise_pedidos_hist`, última extração) | R$ 127 mil |
| Soma "pedido + contratado" do painel (valor do item da solicitação) | R$ 509 mil |

Causa: pedido/contratado eram o **valor do item na solicitação** dos itens com
nº de pedido/contrato. Contrato de mão de obra quase não aparece (valor fica no
contrato, não na solicitação) e valor de solicitação ≠ valor comprado. A
ligação solicitação ↔ etapa está íntegra (77/77 itens com par).

Além disso, o grupo DRYWALL (MATERIAL) soma também R$ 611 mil de serviço, e
os 40 grupos de mão de obra estão sem etapas porque hoje uma etapa só pode
estar em um grupo.

## 2. Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Base do macro | Mesma lógica da planilha de projeção: apropriado + saldo de contrato + saldo de pedido |
| Fases | Cumulativas até 100%: realizado ≤ comprometido ≤ solicitado. > 100% = "Rever projeção/dados" |
| Classificação | Planilha de insumos da empresa (Cód. Item, Descrição, Definição): **SE = mão de obra**; MT, EQ, OU = material |
| Item fora de orçamento | Descrição "ITENS FORA DE ORÇAMENTO": **sempre material** |
| Padrão × obra | Classificação é da empresa; a obra pode sobrescrever insumos específicos |
| Etapa em grupos | Uma etapa pode estar em **um grupo de material e um de mão de obra**; dentro do tipo, no máximo um |
| Mão de obra | Tela igual à de material, em **aba própria**; grupos e etapas configurados pelo usuário na tela (sem espelhamento automático) |
| Tela | Duas abas: **Material \| Mão de obra** |
| Alerta de classificação | Insumo SE comprado por **pedido** = alerta. Material por contrato é aceito (sem alerta) |
| Flags | Uma por fase, cada uma com data-limite própria (seção 5) |
| Micro | Tabela agrupada por **solicitação**, uma linha por insumo (seção 6) |

## 3. Classificação de insumos

- Tabela `insumo_classificacao` (schema `public`): `projeto_id` (NULL =
  empresa), `cod_insumo` (nullable), `descricao` (normalizada),
  `definicao` (MT/SE/EQ/OU), `tipo` (`MATERIAL`/`MAO_DE_OBRA`). Override da
  obra vence o da empresa.
- Importação da planilha de insumos em Configurações (upload xlsx; colunas
  "Cód.Item", "Descrição do Item", "Definição Item"). ~15 mil linhas.
- Casamento: por **código** quando a fonte tem (`solicitacoes_por_etapa.numero_insumo`,
  `raw_data.cod_insumo` nos saldos); por **descrição normalizada** quando não
  tem (projeção de custo). Validado: 99,8% do projetado do POTY casa por
  descrição; sobram 6 descrições (granito/mármore).
- Sem classificação → lista "insumos sem classificação" na configuração
  para o usuário marcar; descrição iniciando em "MO " sugere mão de obra.
- "ITENS FORA DE ORÇAMENTO" → material, sempre, antes de qualquer consulta.

## 4. Projeto e valores por etapa × tipo

- **Projetado:** a importação passa a guardar **por etapa e tipo**
  (linhas N5 da planilha, coluna DESCRIÇÃO classificada). Mantém a regra
  atual de nível.
- **Realizado:** apropriado por `cod_estruturado` e tipo do insumo.
- **Em contrato:** saldo aberto de contratos (última `data_extracao`), por etapa e tipo.
- **Em pedido:** saldo aberto de pedidos (última `data_extracao`), por etapa e tipo.
- **Comprometido** = realizado + em contrato + em pedido.
- **Solicitado:** itens de solicitação (como hoje), por tipo do insumo; usado
  só na flag de solicitação. Para a flag, solicitado efetivo = max(solicitado, comprometido).
- Macro por grupo: projetado, % realizado, % comprometido (com quebra
  pedido/contrato), **falta solicitar** = P − max(solicitado, comprometido),
  **falta fechar** = P − comprometido.

O semântico exato de `total`/`saldo_qtde_contrato` e `qtde_pedido −
qtde_apropriada` dos saldos deve ser conferido contra a projeção do POTY na
implementação (critério de sucesso 1).

## 5. Flags por fase

De trás para frente a partir do menor início das etapas no cronograma
(prazos do grupo, já guardados no banco):

| Flag | Data-limite | Concluída quando |
|---|---|---|
| Levantamento (lembrete) | limite solicitação − (levantamento + solicitação) | — (só avisa; sem atraso) |
| Solicitação | início − lead time (regra atual) | solicitado efetivo ≥ 100% |
| Mapa | início − (emissão + entrega) | itens com cotação/mapa aprovado ≥ 100% do solicitado |
| Pedido/Contrato | início − entrega | comprometido ≥ 100% |

Mão de obra usa os mesmos campos (entrega = entrega do QC; emissão = emissão
do contrato + integrações). Estados por flag: Atrasado, Atenção (≤ 7 dias),
No prazo, Feito. Filtro por flag no resumo.

## 6. Micro em tabela

Uma linha por item (solicitação + sequência); a coluna Solicitação ocupa as
linhas da mesma solicitação (rowspan). Colunas: Solicitação (nº, aprovação
x/y, aprovadores no hover) · Insumo · Etapa · Fornecedor/valor · Mapa ·
Pedido/Contrato · Medições (resumo "5/7 aprovadas · 6ª pendente há N dias",
expande ao clicar) · Parado em. Alerta na linha quando insumo SE tem pedido.

## 7. Fora do escopo

Espelhamento automático de etapas para grupos de mão de obra; alerta de
material por contrato; prazo de mobilização separado.

## 8. Critérios de sucesso

1. Drywall material + mão de obra do POTY somam o projetado da planilha
   (R$ 1.445.565) e o comprometido bate com apropriado + saldos do Mega (±1%).
2. Uma etapa aparece em um grupo de material e um de mão de obra sem contar
   valor duas vezes.
3. Cada flag mostra sua data-limite e estado; levantamento nunca fica "atrasado".
4. Micro de um grupo de mão de obra com contrato de 7+ medições cabe em uma
   linha por item.

## 9. Ordem de entrega

1. Base comprometida no macro (corrige os números atuais).
2. Classificação de insumos + projetado por tipo + aba Mão de obra.
3. Flags por fase.
4. Micro em tabela.
