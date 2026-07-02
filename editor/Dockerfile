# DJUI Editor - 多阶段 Docker 构建
#
# 推荐从仓库根目录执行：
#   docker build -f editor/Dockerfile -t djui-editor .

# Stage 1: 构建前端
FROM node:20-alpine AS frontend-build
WORKDIR /app/editor/frontend
COPY editor/frontend/package.json editor/frontend/package-lock.json ./
RUN npm ci
COPY editor/frontend/ ./
RUN npm run build

# Stage 2: 构建后端
FROM node:20-alpine AS backend-build
WORKDIR /app/editor/backend
COPY editor/backend/package.json editor/backend/package-lock.json ./
RUN npm ci
COPY editor/backend/ ./
RUN npm run build

# Stage 3: 生产运行
FROM node:20-alpine AS runtime
WORKDIR /app/editor/backend
COPY editor/backend/package.json editor/backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/editor/backend/dist ./dist
COPY --from=frontend-build /app/editor/frontend/dist ../frontend/dist
COPY runtime /app/runtime
COPY scripts /app/scripts
ENV NODE_ENV=production
ENV DJUI_PORT=37241
ENV DJUI_HOST=0.0.0.0
EXPOSE 37241
CMD ["node", "dist/server.js"]
