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
