# Frontend (Next.js) en contenedor, mas una etapa "migrar" que aplica las
# migraciones de Prisma. Para instalar fuera de Vercel; ver deploy/README.md.
# En Vercel no se usa.

FROM node:24-slim AS deps
# Prisma (migraciones) necesita openssl, que la imagen slim no trae.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/web
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# "prisma generate" (postinstall) lee prisma.config.ts, que exige
# DATABASE_URL aunque no se conecte: va una de relleno solo para este paso.
RUN DATABASE_URL=postgresql://sin-conexion@localhost:5432/build npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# La URL de la API que usa el navegador queda fija en el build. Con el proxy
# de deploy/Caddyfile, front y API comparten dominio y basta la ruta
# relativa: la misma imagen sirve para cualquier dominio.
ARG NEXT_PUBLIC_API_URL=/api/backend
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Aplica las migraciones pendientes y termina (docker compose run --rm migrar).
FROM deps AS migrar
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-slim AS web
WORKDIR /srv/web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN useradd --create-home --uid 10001 web
COPY --from=build --chown=web /srv/web/.next/standalone ./
COPY --from=build --chown=web /srv/web/.next/static ./.next/static
COPY --from=build --chown=web /srv/web/public ./public
USER web
EXPOSE 3000
CMD ["node", "server.js"]
