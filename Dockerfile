# Another Tavern —— 全栈单容器镜像（API + Web 静态资源 + SQLite）
# 数据库文件位于 /app/data（挂载卷持久化聊天记录与设置）。

FROM node:22-alpine AS build
WORKDIR /repo
ENV CI=true
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @another-tavern/server deploy --prod /out

FROM node:22-alpine
WORKDIR /app
ENV PORT=3001 \
    DB_PATH=data/app.db \
    MIGRATIONS_DIR=drizzle \
    STATIC_DIR=web-dist \
    NODE_ENV=production
COPY --from=build /out ./
COPY --from=build /repo/packages/web/dist ./web-dist
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "dist/main.js"]
