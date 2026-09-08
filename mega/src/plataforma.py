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
