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


def traduzir_colunas(df, relatorio_id, aba=None):
    chave = (relatorio_id, aba)
    descartar = COLUNAS_DESCARTAR.get(chave, COLUNAS_DESCARTAR.get(relatorio_id, []))
    df = df.drop(columns=[c for c in descartar if c in df.columns])
    manual = RENOMEIO_MANUAL.get(chave, RENOMEIO_MANUAL.get(relatorio_id, {}))
    novo_nome = {c: manual.get(c, normalizar_nome_coluna(c)) for c in df.columns}
    return df.rename(columns=novo_nome)


COLUNAS_DESCARTAR = {
    "itens_solicitados": [
        # "Codigo da cotacao" (sem sufixo) tem menos valores preenchidos
        # (25024 de 25358) que "Codigo da cotacao.1" (25358 de 25358, 100%) —
        # confirmado com o usuario: usar a que tem mais valores, descartar a
        # outra em vez de traduzir as duas.
        "Código da cotação",
    ],
    ("analise_saldo_solicitacao", "Pedidos"): [
        # "Codigo.1" e "Codigo Processo" tem sempre o mesmo valor (184 de 184
        # nao-nulos nos dois, na amostra); confirmado com o usuario: manter a
        # que tem mais valores — empate na amostra, ficou "Codigo Processo"
        # (que ja normaliza bem sozinha) e descartou-se "Codigo.1".
        "Código.1",
    ],
    ("analise_saldo_solicitacao", "Contratos"): [
        # Confirmado com o usuario: sempre vazias na amostra, sem uso
        # conhecido — descartar como as colunas fiscais.
        "Cód. Alternativo.3", "Descrição.2",
    ],
    "pedidos_compra": [
        # Confirmado com o usuario: sempre vazias na amostra, sem uso
        # conhecido — descartar como as colunas fiscais.
        "Característica Estoque.1", "Código",
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

RENOMEIO_MANUAL = {
    "itens_solicitados": {
        # "Código da cotação" (sem sufixo) descartada em COLUNAS_DESCARTAR
        # (tinha menos valores preenchidos); esta e a que sobra, renomeada.
        "Código da cotação.1": "codigo_cotacao",
        # As 3 entradas abaixo NAO estao na normalizacao automatica: sao os
        # nomes que compoem a chave_natural deste relatorio em config.yaml
        # ("Código da solicitação", "Nr. RM", "Sequencial do item") e precisam
        # bater exatamente com as colunas de destino da tabela no banco.
        "Código da solicitação": "codigo_solicitacao",
        "Nr. RM": "numero_rm",
        "Sequencial do item": "sequencial_item",
    },
    "visualizacao_itens": {
        # NAO e uma hierarquia de niveis — confirmado com o usuario: sao 4
        # dimensoes de classificacao INDEPENDENTES. A linha de titulo mesclada
        # do Excel (descartada por linha_cabecalho=2, mas inspecionada a parte)
        # confirma o rotulo de cada par Codigo/Descricao: "Classe", "Aplicacao",
        # "Centro de Custo", "Projeto", nessa ordem.
        "Código": "codigo_classe", "Descrição.1": "descricao_classe",
        "Código.1": "codigo_aplicacao", "Descrição.2": "descricao_aplicacao",
        "Código.2": "codigo_centro_custo", "Descrição.3": "descricao_centro_custo",
        "Código.3": "codigo_projeto", "Descrição.4": "descricao_projeto",
        # "Fornecedor" (sem sufixo) e parte da chave_natural deste relatorio em
        # config.yaml (["Solicitação", "Sequência", "Fornecedor"]) e da PRIMARY
        # KEY da tabela no banco — por isso fica sem sufixo, e nao
        # "fornecedor_cotacao" como a adjacencia com Cod. Cotacao sugeriria.
        "Fornecedor": "fornecedor",
        "Fornecedor.1": "fornecedor_contrato",   # ligado a Cod. Contrato
    },
    ("analise_saldo_solicitacao", "Pedidos"): {
        # "Codigo.1" (sempre igual a "Codigo Processo") descartada em
        # COLUNAS_DESCARTAR — "Codigo Processo" ja normaliza bem sozinha.
        "Código": "codigo_pedido",
    },
    ("analise_saldo_solicitacao", "Contratos"): {
        "Código": "codigo_contrato",
        "Cód. Alternativo.2": "codigo_contrato_alternativo",
        # "Cód. Alternativo.3" e "Descrição.2" descartadas em COLUNAS_DESCARTAR
        # (confirmado com o usuario: sempre vazias, sem uso conhecido).
    },
    # "Característica Estoque.1" e "Código" de pedidos_compra descartadas em
    # COLUNAS_DESCARTAR (confirmado com o usuario: sempre vazias, sem uso
    # conhecido, mesmo tratamento das colunas fiscais).
}
