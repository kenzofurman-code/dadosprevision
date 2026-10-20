# Painel 9 — Teórico x Físico (com orçamento reajustado pelo INCC-DI)

Data: 2026-10-20 · Área: Gestão à Vista (`src/App.tsx`), servidor (`server/`)

## Intenção

Mostrar na Gestão à Vista **onde a obra está gastando em ritmo diferente do que está executando**,
etapa a etapa, sem depender da planilha de projeção montada à mão. O painel replica a lógica das
colunas da planilha de projeção de custo:

- Orçamento reajustado;
- Apropriado;
- Custo projetado;
- Resultado;
- Evolução financeira;
- Medição física;
- Resultado teórico;
- Teórico x Projeção.

A partir delas, o painel ranqueia as etapas de nível 5 com maior variação.

## Objetivos

1. **Orçamento reajustado automático:** orçamento base da Prevision × fator acumulado do **INCC-DI**, a partir do **mês-base do orçamento** informado por obra.
2. **Quadrinho de INCC-DI:** índices mês a mês e fator acumulado, atualizados sozinhos pelo Banco Central.
3. **Painel 9** com a EAP inteira (níveis 1 a 5) e um modo **"Maiores variações"**: as 15 ou 20 etapas nível 5 com maior variação, mostradas em cascata com todos os níveis acima delas.
4. Duas réguas de variação, alternáveis:
   - **(A) Evolução financeira x Medição física**, em pontos percentuais;
   - **(B) Teórico x Projeção**, em %.

## Fora do escopo

- Coluna **Apoio**: é manual e fica para depois (decisão do usuário).
- Preenchimento manual de índice: só o que o Banco Central publicar.
- INCC-M e outros índices: a obra usa **INCC-DI** fixo (decisão do usuário).
- Impressão A4 específica do painel: ele usa o contêiner padrão (`gestao-card`), como os painéis 6 a 8.

## Anti-objetivos

- **Não escrever em `mega.*`:** o painel só lê o schema `mega` (regra do AGENTS.md).
- **Não inventar orçamento reajustado:** se a obra não tiver mês-base, o painel mostra "Informe o mês-base do orçamento" e não exibe colunas que dependem dele.

---

## Fontes de dados (por etapa nível 5, código Mega)

| Coluna | Origem |
|---|---|
| Código, descrição, nível | `cff_itens` da Prevision, convertido com `etapaParaMega` |
| **Orçamento base** | `cff_itens.custo_total`, nível 5 (decisão do usuário) |
| **Apropriado (nominal)** | `mega.analise_realizado` agrupado por etapa (`raw_data->>'cod_estruturado'`) e mês de `data_documento`. Usa o mesmo filtro que `valoresPorEtapa` aplica ao realizado. |
| **Apropriado reajustado** | Σ apropriado do mês × fator INCC-DI dos meses **posteriores** ao mês do documento, até o último índice publicado. Documento sem data: fator 1. **Decisão do builder:** "apropriado reajustado" foi entendido como apropriado em moeda forte. |
| **Saldo de contratos / Saldo de pedidos** | `valoresPorEtapa` (`em_contrato`, `em_pedido`), somando os dois tipos. Reaproveitar, não duplicar a SQL. |
| **Comprometido** | apropriado reajustado + saldo de contratos + saldo de pedidos (decisão do usuário) |
| **Custo projetado** | Última importação (`custo_projetado_itens`). Sem importação, a coluna fica vazia. |
| **Medição física** | `cff_itens.peso_realizado`, nível 5, entre 0 e 1. É a mesma leitura usada hoje pelo módulo de Curvas. **Validar com dados reais** (ver Riscos). |
| Obra Mega | `mega.obra_projeto`. Sem obra vinculada, apropriado e projetado ficam vazios, com aviso. |

## Fórmulas

As fórmulas foram conferidas contra a linha GERAL da planilha do usuário: 58,33%, −3,1 mi e −5,00%.

- **fator INCC** = produto de (1 + v/100) para os meses **depois** do mês-base, até o último publicado.
  - **Decisão do builder:** o mês-base já está a preço da data-base, por isso não entra.
- **orç. reajustado (OR)** = orçamento base × fator
- **resultado** = OR − custo projetado
- **apropriado (AP)** = apropriado reajustado
- **comprometido** = AP + saldo de contratos + saldo de pedidos
- **evolução financeira (EF)** = AP ÷ OR
- **medição física (MF)** = % físico realizado
- **resultado teórico (RT)** = OR × MF − AP
- **Régua A** = EF − MF, em p.p. Positivo significa que gastou mais do que andou.
- **Régua B (Teórico x Projeção)** = (RT − resultado) ÷ OR

**Níveis 1 a 4:** são somas dos filhos nível 5 para OR, AP, saldos, comprometido e projetado. MF é a média dos filhos ponderada pelo OR. EF, RT e as réguas são recalculadas a partir dessas somas, nunca como média de percentuais.

**Divisão por zero:** se OR = 0, EF, Régua A e Régua B ficam `null` e a etapa sai do ranking.

## Ranking "maiores variações" (em cascata)

- **Seleção:** as **N** etapas nível 5 com OR > 0 e maior **valor absoluto** da régua ativa. N pode ser 15 ou 20, padrão 15. Entram desvios nos dois sentidos.
- **Exibição em cascata:** todos os níveis que vão da raiz até cada etapa selecionada (decisão do usuário).
  - As etapas-mãe aparecem com seus **totais reais**, ou seja, somados de todos os filhos, não só dos selecionados (**decisão do builder**).
  - A ordem é a da EAP, por código. Cada etapa nível 5 selecionada mostra sua posição no ranking (#1…#N).
- **Cores:** Régua A positiva = vermelho (gastou mais do que andou); Régua B negativa = vermelho (**decisão do builder**).
- **Controles:** "EAP inteira / Maiores variações", seletor de N (15/20) e seletor da régua (A/B). Os estados ficam só na tela, sem persistir.

## INCC-DI

- **Tabela** `indices_incc (mes DATE PRIMARY KEY, variacao NUMERIC NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`, no schema `public`.
- **Fonte:** `https://api.bcb.gov.br/dados/serie/bcdata.sgs.192/dados?formato=json&dataInicial=01/01/2000`. A série 192 é o INCC-DI; foi conferida contra a tabela publicada (jul/26 0,61%, ago/26 0,66%).
  - Resposta: `[{data:"01/07/2026", valor:"0.61"}]`.
  - Gravação por upsert.
- **Sincronização:**
  - cron diário `CRON_SCHEDULE_INCC` (padrão `0 7 * * *`);
  - também ao subir o servidor, se a tabela estiver vazia;
  - botão "Atualizar índices" no quadrinho.
- **Falha** de rede ou da API: registra no log e mantém os índices já gravados. O painel funciona com o que houver e mostra "índices até mm/aaaa".
- **Quadrinho**, no topo do Painel 9:
  - mês-base da obra (editável);
  - último índice disponível;
  - fator acumulado (ex.: 1,0734 = +7,34%);
  - uma lista recolhível com os meses e as variações desde o mês-base.

## Mês-base por obra

- **Tabela** `orcamento_reajuste_obra (projeto_id TEXT PRIMARY KEY REFERENCES projetos(id_prevision) ON DELETE CASCADE, mes_base DATE NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`. O dia é sempre 01.
- O índice é fixo em INCC-DI, sem coluna para ele (YAGNI).
- **Editado no quadrinho do Painel 9:** campo `<input type="month">` com botão Salvar.

## API

- `GET  /api/painel-teorico?projectId=` →
  - `{ obra, importacao, reajuste: { mes_base, fator, ultimo_mes, meses: [{mes, variacao}] }, linhas: [...] }`
  - `linhas` é a EAP inteira (níveis 1 a 5), cada uma com: `codigo, descricao, nivel, orcamento_base, orcamento_reajustado, apropriado_nominal, apropriado_reajustado, saldo_contratos, saldo_pedidos, comprometido, custo_projetado, resultado, evolucao_financeira, medicao_fisica, resultado_teorico, regua_a, regua_b`. Também devolve `ranking: { A: [códigos], B: [códigos] }`, com os códigos nível 5 elegíveis já ordenados pelo |valor| da régua (função pura `rankingNivel5`, testada). A tela pega os N primeiros e monta a cascata: mostra as linhas cujo código é prefixo de algum selecionado.
- `PUT  /api/painel-teorico/mes-base` `{ projectId, mes_base: 'AAAA-MM' }`
- `POST /api/incc/sincronizar` → `{ meses_gravados, ultimo_mes }`

## Organização do código

- `server/painel-teorico.js`: cálculo **puro** (fator, fórmulas, agregação por nível, ranking), testado com `node --test`.
- `server/painel-teorico-db.js`: consultas e montagem. Reaproveita `valoresPorEtapa`, `obraDoProjeto`, `ultimaImportacao` e `classificadorDaObra` de `contratacoes-db.js`, exportando-os se ainda não forem exportados.
- `server/incc.js`: busca no Banco Central e upsert.
- `src/components/painel-teorico/PainelTeorico.tsx` (+ `.css`): a tela. Em `App.tsx`, só o botão "Painel 9: Teórico x Físico" e a renderização (`gestaoPanelTab === 'teorico'`).

## Riscos

- **Escala do `peso_realizado`:** o módulo de Curvas assume que ele está entre 0 e 1 por etapa, mas isso nunca foi validado com dados reais.
  - Antes de liberar, comparar a medição física GERAL do painel com a da planilha (54,68% na obra POTY).
  - Se não bater, a correção provável é usar `realizado / base` dos `pontos_mensais`.
- **Apropriado sem `cod_estruturado`:** apropriações do Mega sem etapa ficam fora das etapas. O total GERAL pode ficar abaixo da planilha, e o painel mostra essa diferença como "Apropriado sem etapa".

## Verificação

- **Testes do cálculo puro:**
  - fator INCC (mês-base excluído, meses faltantes);
  - as três fórmulas reproduzindo os números GERAL da planilha (OR 85.128.864,93; apropriado 49.654.793,17; projetado 83.976.455,27; MF 54,68%, gerando EF 58,33%, RT ≈ −3,11 mi e Régua B ≈ −5,00%);
  - agregação ponderada;
  - OR = 0;
  - ranking por valor absoluto, com 15 itens.
- **Teste do parser da resposta do Banco Central:** datas dd/mm/aaaa e valores em string.
- `npm run build` e `npm run test:server`.
- **Conferência manual** com a obra POTY contra a planilha da imagem.
