FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pyproject.toml ./
RUN pip install "fastapi>=0.115" "uvicorn[standard]>=0.30" "networkx>=3.3" "psycopg[binary]>=3.2" \
    "pydantic>=2.8" "pydantic-settings>=2.4"

COPY app ./app
RUN useradd --create-home --uid 10001 engine
USER engine

EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
