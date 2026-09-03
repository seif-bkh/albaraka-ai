# rag-assistant — FastAPI + LangChain (ADR-009)
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --upgrade pip && pip install .

# non-root
RUN useradd -m -u 10001 rag && chown -R rag:rag /app
USER rag

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/v1/rag/health',timeout=3)"

CMD ["uvicorn", "rag_assistant.main:app", "--host", "0.0.0.0", "--port", "8000"]
