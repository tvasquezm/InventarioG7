# ===========================================================
# Dockerfile - Inventory Service (Grupo 7) - Mini Marketplace
# Node 20 LTS + TypeScript (compila a dist/ y corre con Node)
# ===========================================================
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (mejor cache de capas)
COPY package*.json ./
RUN npm ci

# Copiar el resto del codigo (incluye carpeta openapi/, que se sirve en /docs)
COPY . .

# Compilar TypeScript -> dist/
RUN npm run build

# Puerto del servicio segun el estandar del curso.
# En Render se ignora porque la plataforma inyecta su propio PORT.
ENV PORT=3006
EXPOSE 3006

CMD ["node", "dist/index.js"]
