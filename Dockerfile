# --- ЭТАП 1: Сборка фронтенда и бэкенда ---
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем package-файлы воркспейсов
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY db/package*.json ./db/

# Устанавливаем все зависимости (включая dev-инструменты для сборки)
RUN npm ci

# Копируем исходные файлы проекта
COPY . .

# Сборка React фронтенда и TypeScript бэкенда
RUN npm run build --workspace=frontend
RUN npm run build --workspace=backend

# --- ЭТАП 2: Легковесный продакшен-образ ---
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY db/package*.json ./db/

# Устанавливаем только продакшен-зависимости (без devDependencies)
RUN npm ci --omit=dev

# Переносим результат компиляции и файлы миграций
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/db ./db

EXPOSE 3000

# При старте контейнера накатываем миграции в БД и запускаем сервер
CMD ["sh", "-c", "node db/migrate.js && node backend/dist/server.js"]
