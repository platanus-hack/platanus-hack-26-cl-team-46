# Imagen ÚNICA del motor (la usan Modal —primario— y Render —fallback—).
# Hornea las herramientas APROBADAS como binarios: no hay Docker-in-Docker en
# Modal/Render, así que el adapter las corre directo (ver providers/semgrep.ts).
FROM node:22-slim

# semgrep (SAST, APROBADO en provenance). nuclei/ARTEX NO se hornean: aún no
# aprobados para ejecutar (ver providers/provenance.ts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip git ca-certificates \
 && pip3 install --break-system-packages --no-cache-dir semgrep==1.90.0 \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=8080
EXPOSE 8080
# Servidor del motor (POST /run). CLI: docker run ... node src/cli/run.ts --url ...
CMD ["node", "src/server.ts"]
