# API (FastAPI) en contenedor: para instalar fuera de Vercel (un servidor
# propio, AWS o Google Cloud). En Vercel no se usa: alla el backend corre
# como servicio de vercel.json. Ver deploy/README.md.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/backend

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Sin usuario root: la API no necesita mas que leer su codigo y escribir en
# media/ (fotos en modo local, montado como volumen).
RUN useradd --create-home --uid 10001 api && mkdir -p media && chown api media
USER api

EXPOSE 8000
# Varios procesos por contenedor; ajustar con WEB_CONCURRENCY segun la maquina.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*'"]
