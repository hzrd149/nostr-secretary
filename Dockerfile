FROM oven/bun:1.2
WORKDIR /app

ENV NODE_ENV=production
COPY . .
RUN bun install --frozen-lockfile --production

# Create a volume for the config
VOLUME /app/data

ENV CONFIG=/app/data/config.json
ENV PORT=8080

# run the app
USER bun
EXPOSE 8080/tcp
ENTRYPOINT [ "bun", "run", "index.ts" ]
