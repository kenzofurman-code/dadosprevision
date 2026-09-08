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
