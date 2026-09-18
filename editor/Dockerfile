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
COPY CHANGELOG.md /app/CHANGELOG.md
RUN npm run build

# Stage 2: nginx 纯静态托管
FROM nginx:alpine AS runtime
# 2026-09 实证：新版 nginx:alpine 的 ipv6 检测脚本卡死在 apk manifest 管道上，
# nginx 主进程永远起不来；DJUI 纯静态托管不依赖该脚本，直接移除。
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
COPY --from=frontend-build /app/editor/frontend/dist /usr/share/nginx/html
# nginx 默认配置即可 serve SPA（index.html fallback）
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
