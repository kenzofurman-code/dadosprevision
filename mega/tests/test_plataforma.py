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
