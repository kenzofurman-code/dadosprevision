# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from biblioteca import achar_botao_fechar

VERMELHO_BGR = (82, 81, 198)     # o X do titulo das janelas do ERP (RGB 198,81,82)


def _tela(): return np.full((900, 1600, 3), 255, np.uint8)


def test_acha_o_x_vermelho_do_modal():
    img = _tela()
    img[203:220, 1188:1225] = VERMELHO_BGR      # ~37x17, como nas capturas reais
    assert achar_botao_fechar(img) == (1206, 211)


def test_tela_sem_modal_nao_acha_nada():
    assert achar_botao_fechar(_tela()) is None


def test_ignora_vermelho_pequeno_como_asterisco_de_campo_obrigatorio():
    img = _tela()
    img[300:306, 500:505] = VERMELHO_BGR
    assert achar_botao_fechar(img) is None


def test_ignora_vermelho_fora_da_area_util():
    img = _tela()
    img[20:37, 1500:1537] = VERMELHO_BGR        # barra do topo, y < 100
    assert achar_botao_fechar(img) is None
