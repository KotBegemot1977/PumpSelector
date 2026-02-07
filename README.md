# RusPump Engineering Cockpit

Профессиональный инструмент для инженеров по расчету характеристик насосного оборудования и подбора рабочих точек.

## Быстрый запуск

### Способ 1: Использование Docker Compose (Рекомендуется)
Этот способ запускает всю инфраструктуру, включая Backend (FastAPI) и Frontend (через прокси-сервер Caddy).

1.  Убедитесь, что у вас установлен **Docker** и **Docker Compose**.
2.  Выполните команду в корне проекта:
    ```bash
    docker-compose up --build -d
    ```
3.  Откройте приложение в браузере:
    -   **Интерфейс**: [http://localhost:8081](http://localhost:8081)
    -   **API (FastAPI)**: [http://localhost:8000/docs](http://localhost:8000/docs)

### Способ 2: Локальный запуск (Debug Mode)
Используется для быстрой разработки и отладки бекенда без участия Docker.

1.  Создайте виртуальное окружение и установите зависимости:
    ```bash
    python -m venv .venv
    source .venv/bin/scripts/activate  # Для Windows: .venv\Scripts\activate
    pip install -r backend/requirements.txt
    ```
2.  Запустите сервер отладки:
    ```bash
    python debug_run.py
    ```
3.  Приложение будет доступно по адресу: [http://localhost:8081](http://localhost:8081)

---

## Структура проекта
- `/backend`: Серверная часть на FastAPI. Содержит логику расчетов и управления БД.
- `/frontend`: Клиентская часть (HTML/JS/CSS). Использует ECharts для графиков.
- `/backend/uploads`: Папка для хранения загруженных чертежей насосов.

## Базы данных (SQLite)
- `backend/pumps.db`: Основные технические данные и коэффициенты.
- `backend/sensitive.db`: Коммерческие данные (цены, названия компаний).
- `backend/drawings.db`: Хранилище файлов чертежей в формате BLOB.
