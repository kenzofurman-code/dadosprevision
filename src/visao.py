# -*- coding: utf-8 -*-
"""Enxerga a tela transmitida do ERP.

A interface do Mega chega como imagem: nao ha DOM, nao ha seletores. Mas quase
todo alvo util e TEXTO ("Filtrar", "Exportar", "Excel", o nome da empresa). Por
isso a estrategia principal e OCR com caixas delimitadoras, e nao uma biblioteca
de recortes de imagem: texto nao envelhece quando a tela muda de lugar, e nao
exige capturar ativos por ambiente.

Recorte de imagem fica so para os poucos alvos que sao icones (lupa, pessoa).
"""
import io
import unicodedata
from collections import namedtuple
from difflib import SequenceMatcher

import cv2
import numpy as np
import pytesseract
from PIL import Image

Caixa = namedtuple("Caixa", "x y largura altura texto confianca")


def centro(c):
    return (c.x + c.largura // 2, c.y + c.altura // 2)


def _normalizar(t):
    t = unicodedata.normalize("NFKD", str(t))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(t.lower().split())


def _razao(texto, alvo_normalizado):
    """Quanto o texto lido se parece com o alvo, de 0 a 1."""
    t = _normalizar(texto)
    if t == alvo_normalizado:
        return 1.0
    if abs(len(t) - len(alvo_normalizado)) > 3:
        return 0.0
    return SequenceMatcher(None, t, alvo_normalizado).ratio()


def _parecido(texto, alvo_normalizado, minimo):
    """Compara com tolerancia, em vez de exigir igualdade.

    Necessario porque o Mega SUBLINHA a letra de atalho dos botoes, e o
    Tesseract le o traco como parte do caractere: "Filtrar" vira "Eiltrar".
    Exigir igualdade faria o robo nunca achar botao nenhum.
    """
    t = _normalizar(texto)
    if t == alvo_normalizado:
        return True
    if abs(len(t) - len(alvo_normalizado)) > 3:
        return False
    return SequenceMatcher(None, t, alvo_normalizado).ratio() >= minimo


class Visao:
    def __init__(self, page, binario_tesseract=None, idioma="por", escala=2.0):
        self.page = page
        self.idioma = idioma
        self.escala = escala
        if binario_tesseract:
            pytesseract.pytesseract.tesseract_cmd = binario_tesseract
        self._cache_img = None

    # ------------------------------------------------------------------ captura
    def cutucar(self, ponto=None):
        """Forca o gateway a repintar o canvas antes de capturar.

        VALIDADO EM CAMPO: o gateway HTML5 so envia quadro novo quando algo muda
        na tela remota. Capturar sem cutucar devolve quadro velho ou em branco —
        e o OCR entao "nao acha" elementos que estao visiveis.

        Mas o cutucao MOVE O MOUSE, e isso fecha submenu que depende de hover:
        ao esperar o submenu "Excel" aparecer, o proprio cutucao tirava o cursor
        de cima de "Exportar" e fechava o que eu estava esperando. Por isso ele
        aceita um ponto: ao navegar menu, cutuque DENTRO do item.
        """
        x, y = ponto if ponto else (800, 450)
        try:
            self.page.mouse.move(x, y)
            self.page.wait_for_timeout(400)
            self.page.mouse.move(x + 2, y + 2)
            self.page.wait_for_timeout(1200)
        except Exception:
            pass

    def capturar(self, regiao=None, cutucar=False, ponto=None):
        """Captura a viewport inteira como imagem BGR."""
        if cutucar:
            self.cutucar(ponto)
        png = self.page.screenshot(type="png")
        img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
        if regiao:
            x, y, w, h = regiao
            img = img[y:y + h, x:x + w]
        self._cache_img = img
        return img

    # ---------------------------------------------------------------------- OCR
    def _ocr(self, cinza):
        try:
            return pytesseract.image_to_data(
                cinza, lang=self.idioma, output_type=pytesseract.Output.DICT)
        except pytesseract.TesseractError:
            return pytesseract.image_to_data(
                cinza, lang="eng", output_type=pytesseract.Output.DICT)

    # Nao existe um pre-processamento que sirva para a tela toda. Medido em campo:
    # o painel lateral (texto branco fino sobre fundo escuro) so e lido na escala
    # 1 — ampliar borra e o resultado vira ruido; ja o texto pequeno do ERP sobre
    # fundo claro so e lido ampliado. Por isso variantes, tentadas em ordem.
    VARIANTES = ((2.0, False), (1.0, False), (2.0, True), (1.0, True))

    def _palavras(self, img, escala=None, inverter=False):
        """Roda OCR numa variante e devolve palavras com posicao na escala original."""
        escala = self.escala if escala is None else escala
        if escala != 1.0:
            base = cv2.resize(img, None, fx=escala, fy=escala,
                              interpolation=cv2.INTER_CUBIC)
        else:
            base = img
        cinza = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
        if inverter:
            cinza = cv2.bitwise_not(cinza)
        dados = self._ocr(cinza)
        saida = []
        for i in range(len(dados["text"])):
            txt = dados["text"][i].strip()
            if not txt:
                continue
            saida.append({
                "texto": txt,
                "x": int(dados["left"][i] / escala),
                "y": int(dados["top"][i] / escala),
                "w": int(dados["width"][i] / escala),
                "h": int(dados["height"][i] / escala),
                "conf": float(dados["conf"][i]),
                "linha": (dados["block_num"][i], dados["par_num"][i], dados["line_num"][i]),
            })
        return saida

    def achar_texto(self, alvo, img=None, regiao=None, min_conf=40,
                    similaridade=0.82):
        """Acha 'alvo' na tela e devolve a Caixa que o envolve.

        Casa sequencias de palavras dentro da mesma linha, entao funciona tanto
        para "Filtrar" quanto para "Mostrar apenas Itens Solicitados".
        """
        img = self.capturar(regiao) if img is None else img
        dx, dy = (regiao[0], regiao[1]) if regiao else (0, 0)
        alvo_n = _normalizar(alvo)
        for escala, inverter in self.VARIANTES:
            achado = self._achar_numa_variante(
                img, alvo_n, escala, inverter, min_conf, similaridade, dx, dy)
            if achado:
                return achado
        return None

    def _achar_numa_variante(self, img, alvo_n, escala, inverter,
                             min_conf, similaridade, dx, dy):
        palavras = [p for p in self._palavras(img, escala, inverter)
                    if p["conf"] >= min_conf]

        linhas = {}
        for p in palavras:
            linhas.setdefault(p["linha"], []).append(p)

        melhor, melhor_razao = None, 0.0
        for _, grupo in linhas.items():
            grupo.sort(key=lambda p: p["x"])
            for i in range(len(grupo)):
                acumulado = ""
                for j in range(i, min(i + 12, len(grupo))):
                    acumulado = (acumulado + " " + grupo[j]["texto"]).strip()
                    razao = _razao(acumulado, alvo_n)
                    if razao >= similaridade:
                        pedaco = grupo[i:j + 1]
                        x0 = min(p["x"] for p in pedaco)
                        y0 = min(p["y"] for p in pedaco)
                        x1 = max(p["x"] + p["w"] for p in pedaco)
                        y1 = max(p["y"] + p["h"] for p in pedaco)
                        conf = sum(p["conf"] for p in pedaco) / len(pedaco)
                        cand = Caixa(x0 + dx, y0 + dy, x1 - x0, y1 - y0, acumulado, conf)
                        # DESEMPATAR PELA SEMELHANCA, nao pela confianca do OCR.
                        # "Exportar para Excel (xls)" e "Exportar para Excel 2007
                        # (xlsx)" convivem no mesmo menu e diferem em poucos
                        # caracteres. Escolher pela confianca ja fez o robo clicar
                        # no item errado e gravar um .xls com nome .xlsx — arquivo
                        # com o nome certo, os dados certos e o formato errado.
                        if melhor is None or razao > melhor_razao:
                            melhor, melhor_razao = cand, razao
                    if len(_normalizar(acumulado)) > len(alvo_n) + 4:
                        break
        return melhor

    def palavras_todas(self, img):
        """Uniao das variantes. Usado onde interessa varrer a tela inteira."""
        vistas, saida = set(), []
        for escala, inverter in self.VARIANTES:
            for p in self._palavras(img, escala, inverter):
                chave = (p["texto"], p["x"] // 12, p["y"] // 8)
                if chave in vistas:
                    continue
                vistas.add(chave)
                saida.append(p)
        return saida

    def contem_texto(self, alvo, img=None, regiao=None):
        """Verificacao de ancora: o texto esta na tela?"""
        img = self.capturar(regiao) if img is None else img
        alvo_n = _normalizar(alvo)
        inteiro = _normalizar(" ".join(p["texto"] for p in self._palavras(img)))
        return alvo_n in inteiro

    def texto_da_regiao(self, regiao):
        """Le o texto de uma faixa — usado na barra do topo (empresa ativa)."""
        img = self.capturar(regiao)
        return " ".join(p["texto"] for p in self._palavras(img))

    # ------------------------------------------------------------------- imagem
    def achar_imagem(self, caminho_template, img=None, limiar=0.85):
        """Para os poucos alvos que sao icone, nao texto."""
        img = self.capturar() if img is None else img
        tpl = cv2.imread(str(caminho_template), cv2.IMREAD_COLOR)
        if tpl is None:
            raise FileNotFoundError("template nao encontrado: %s" % caminho_template)
        res = cv2.matchTemplate(img, tpl, cv2.TM_CCOEFF_NORMED)
        _, valor, _, pos = cv2.minMaxLoc(res)
        if valor < limiar:
            return None
        h, w = tpl.shape[:2]
        return Caixa(pos[0], pos[1], w, h, str(caminho_template), valor)

    # -------------------------------------------------------------------- erros
    # Marcadores INEQUIVOCOS do modal de erro do Mega. Uma versao anterior
    # incluia a palavra solta "erro" e casava com qualquer ruido do OCR que
    # contivesse essas quatro letras — um falso positivo abortava a execucao
    # logo na primeira tela. Frases longas nao tem esse problema.
    MARCADORES_DE_ERRO = ("detalhes tecnicos", "consultar solucao",
                          "data invalida", "acesso negado")

    def dialogo_de_erro(self, img=None):
        """Um modal de erro bloqueia toda entrada e passa despercebido se a
        verificacao olhar so um recorte. Por isso, sempre a tela inteira."""
        img = self.capturar() if img is None else img
        inteiro = _normalizar(" ".join(p["texto"] for p in self.palavras_todas(img)))
        for marcador in self.MARCADORES_DE_ERRO:
            if marcador in inteiro:
                return marcador
        return None
