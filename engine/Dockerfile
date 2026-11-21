# Contenedor del MOTOR (separado de la app diagnosticada).
FROM node:22-slim
WORKDIR /app
# Sin dependencias externas: el motor usa solo stdlib + type-stripping de Node.
COPY package.json ./
COPY src ./src
ENV PORT=8080
EXPOSE 8080
# Ejecuta el servidor (POST /run). Para CLI: docker run ... node src/cli/run.ts --url ...
CMD ["node", "src/server.ts"]
