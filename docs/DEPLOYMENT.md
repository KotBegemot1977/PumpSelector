# Deployment & Setup Guide

## System Requirements
Для запуска проекта на локальной машине необходимы:
*   **Python 3.14+**: Основной язык бэкенда.
*   **Node.js v24+**: Среда для сборки фронтенда.
*   **npm**: Менеджер пакетов.
*   **Docker & Docker Compose**: (Опционально) Для запуска в контейнерах.

---

## 1. Запуск через Виртуальное Окружение (Native)

### Шаг 1: Бэкенд
1. Откройте терминал в папке проекта.
2. Создайте venv: `python -m venv .venv`
3. Активируйте: `.venv\Scripts\activate` (Windows) или `source .venv/bin/activate` (Linux).
4. Установите зависимости: `pip install -r backend/requirements.txt`
5. Запустите: `python backend/main.py`
   * Backend будет доступен на `http://localhost:8000`.

### Шаг 2: Фронтенд
1. Перейдите в папку `frontend`.
2. Установите зависимости: `npm install`
3. Запустите режим разработки: `npm run dev`
   * Frontend будет доступен на `http://localhost:8081` (или другом порту, указанном в консоли).

---

## 2. Запуск через Docker (Recommended)
Если у вас установлен Docker, запуск производится одной командой из корня проекта:

```bash
docker-compose up --build
```

Система автоматически поднимет:
1.  **Backend**: FastAPI сервер.
2.  **Frontend**: Vite сервер с проксированием запросов.

---

## Проверка окружения (Self-Check)
Вы можете запустить встроенный скрипт проверки (если он есть) или использовать следующие команды:

```powershell
python --version 
node --version
docker --version
```

### Файлы конфигурации
*   `.env`: Содержит переменные окружения (API URL и т.д.).
*   `docker-compose.yml`: Настройки оркестрации.
*   `Caddyfile`: (Если используется) Настройки веб-сервера.
