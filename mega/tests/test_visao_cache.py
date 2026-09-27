import numpy as np

import visao


def _visao_contando(monkeypatch):
    v = visao.Visao(page=None)
    chamadas = []

    def ocr_falso(cinza):
        chamadas.append(1)
        return {"text": ["Menu"], "left": [10], "top": [10], "width": [40],
                "height": [12], "conf": [90], "block_num": [1], "par_num": [1],
                "line_num": [1]}

    monkeypatch.setattr(v, "_ocr", ocr_falso)
    return v, chamadas


def test_mesma_captura_nao_repete_ocr(monkeypatch):
    v, chamadas = _visao_contando(monkeypatch)
    img = np.zeros((90, 160, 3), np.uint8)
    for _ in range(5):
        v.palavras_todas(img)
        v.achar_texto("Procurar", img=img)   # nao acha: percorre as 5 variantes
        v.dialogo_de_erro(img=img)
    assert len(chamadas) == len(visao.Visao.VARIANTES)


def test_captura_diferente_roda_ocr_de_novo(monkeypatch):
    v, chamadas = _visao_contando(monkeypatch)
    a = np.zeros((90, 160, 3), np.uint8)
    b = a.copy()
    b[0, 0] = 255
    v.palavras_todas(a)
    v.palavras_todas(b)
    assert len(chamadas) == 2 * len(visao.Visao.VARIANTES)
