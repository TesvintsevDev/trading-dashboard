# Очистка чувствительных данных из истории Git

В репозитории ранее попали:

1. Локальная база `trading-dashboard-react/storage/` (реальные сделки, размеры позиций, PnL).
2. Путь к Node на Mac: `/Users/eduardtesvintsev/.cache/codex-runtimes/...` в README и скриптах.

Текущий коммит на `main` больше не отслеживает `storage/`, но **старые коммиты на GitHub всё ещё содержат эти данные**, пока историю не перепишете.

## Перед началом

- Сделайте резервную копию репозитория и локальной папки `trading-dashboard-react/storage/` (если нужны ваши сделки).
- Предупредите всех, кто клонировал репозиторий: после force push им понадобится заново клонировать или сбросить ветки.
- Установите [git-filter-repo](https://github.com/newren/git-filter-repo) (рекомендуется вместо устаревшего `filter-branch`).

```bash
# macOS (Homebrew)
brew install git-filter-repo

# или pip
pip install git-filter-repo
```

## Шаг 1. Удалить SQLite из всей истории

Из корня клона:

```bash
git filter-repo --path trading-dashboard-react/storage --invert-paths
```

Если `git filter-repo` отказывается работать из-за remote, сначала:

```bash
git remote remove origin
# выполните filter-repo
git remote add origin https://github.com/tesvintsevdev/trading-dashboard.git
```

## Шаг 2. Заменить личный путь в истории

Создайте файл `replacements.txt`:

```text
/Users/eduardtesvintsev==>REDACTED
eduardtesvintsev==>REDACTED
```

Затем:

```bash
git filter-repo --replace-text replacements.txt
```

Проверка, что в истории не осталось следов:

```bash
git log --all -S '/Users/eduard' --oneline
git log --all -S 'eduardtesvintsev' --oneline
git log --all -- trading-dashboard-react/storage --oneline
```

Все три команды должны вернуть пустой вывод.

## Шаг 3. Force push

```bash
git push origin --force --all
git push origin --force --tags
```

## Шаг 4. На GitHub (опционально)

- **Settings → Danger zone → Delete this repository** не нужен.
- Если репозиторий был публичным, считайте утёкшие данные уже скопированными; переписывание истории убирает их из **текущего** зеркала GitHub, но не из чужих форков/кэшей.
- При необходимости отзовите только те секреты, которые вы когда-либо коммитили (в этом проекте API-ключей в истории не было).

## Локальная работа после merge PR

1. `git pull` (после merge PR с `.gitignore`).
2. База создаётся заново при `npm run dev:full` или `npm run seed:state`.
3. Не добавляйте `storage/` в коммиты — папка в `.gitignore`.

## Что уже сделано в PR (без переписывания истории)

- Корневой `.gitignore` для `storage/`, `*.sqlite`, `.env`.
- Удаление отслеживаемых файлов SQLite из индекса Git.
- Эта инструкция.

Переписывание истории выполняете **вы локально** (шаги 1–3), когда будете готовы к force push.
