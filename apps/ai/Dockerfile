# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies come from pyproject.toml, which is their single source of truth.
# (A hand-copied list here drifted from it once already.) Installing them before
# the source is copied means editing a prompt or a node does not reinstall the
# world.
COPY pyproject.toml ./
RUN python - <<'PY' > /tmp/requirements.txt
import tomllib
with open("pyproject.toml", "rb") as f:
    print("\n".join(tomllib.load(f)["project"]["dependencies"]))
PY
RUN pip install -r /tmp/requirements.txt

COPY app ./app

RUN useradd --uid 10001 --create-home app && chown -R app:app /app
USER app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
