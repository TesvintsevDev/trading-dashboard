# Trading Dashboard App

Локальное приложение для premarket watchlist, post-open проверки, активных сделок и trade management.

## Запуск

```bash
/node/bin/node server.js
```

Затем открыть:

```text
http://localhost:8788
```

## Данные

- `data/state.json` создается автоматически из последнего `dashboard_data_YYYY-MM-DD.json`.
- `data/market-data-YYYY-MM-DD.json` хранит 5m бары.
- Кнопка `Обновить данные` дергает Yahoo Finance chart API и обновляет 5m JSON.

## Логика вкладок

- `Live` - текущий рабочий список.
- `Premarket` - snapshot первого premarket отбора, не должен затираться после открытия.
- `Post-open` - тикеры с флагом `postOpen: true`.
- `Trades` - активные сделки из `tradeManagement`.

## Следующий шаг

Когда появится `npm`/`pnpm`, этот MVP можно перенести в React + TypeScript, оставив API и формат данных почти без изменений.
