# Образ лендинга LidRadar для production (стек: Lidradar/deploy/production, ADR 0050).
# Собирается scripts/build-landing-image.sh из репозитория бэкенда: он берёт тег из git sha
# этого репозитория и отказывается собирать из незафиксированного дерева.
#
# Внутри только сайт и server.mjs (Node, зависимостей нет). Файл заявок leads.jsonl в образ не
# попадает: он лежит в томе /data и пишется при работе (см. .dockerignore).
FROM node:24-alpine

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="lidradar-landing" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5180 \
    TRUST_PROXY=1 \
    LEADS_FILE=/data/leads.jsonl

WORKDIR /app
COPY server.mjs index.html ./
COPY assets ./assets
COPY legal ./legal

# Код и сайт принадлежат root и доступны пользователю node только на чтение (права файлов из
# контекста сборки бывают любыми, например 600). Каталог заявок принадлежит node (uid 1000):
# именованный том при первом запуске наследует эти права.
RUN chmod -R a+rX /app && mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5180

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5180/api/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
