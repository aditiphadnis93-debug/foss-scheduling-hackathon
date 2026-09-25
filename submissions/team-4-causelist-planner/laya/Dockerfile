# Laya (Apache-2.0) as a sidecar: a Jev-compatible typed-decision server on CPU.
# The app calls POST /v1/systemone; agents/decide.py falls back to rules when this is down.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HOME=/models LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_DEVICE=cpu
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "laya[serve]==0.3.11"

EXPOSE 8000
CMD ["laya-serve"]
