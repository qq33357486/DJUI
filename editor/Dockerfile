# DJUI Editor - 纯前端构建
# 所有文件操作通过 File System Access API 在浏览器中完成，无需后端

# Stage 1: 构建前端
FROM node:20-alpine AS frontend-build
WORKDIR /app/editor/frontend
COPY editor/frontend/package.json editor/frontend/package-lock.json ./
RUN npm ci
COPY editor/frontend/ ./
# runtime 和 scripts 通过 ?raw 导入打包到 JS bundle
COPY runtime /app/runtime
COPY scripts /app/scripts
RUN npm run build

# Stage 2: nginx 纯静态托管
FROM nginx:alpine AS runtime
COPY --from=frontend-build /app/editor/frontend/dist /usr/share/nginx/html
# nginx 默认配置即可 serve SPA（index.html fallback）
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
