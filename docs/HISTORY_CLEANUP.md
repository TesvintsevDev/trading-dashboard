# Очистка чувствительных данных из истории Git

В репозитории ранее попали:

1. Локальная база `trading-dashboard-react/storage/` (реальные сделки, размеры позиций, PnL).
2. Путь к Node на Mac: `/Users/eduardtesvintsev/.cache/codex-runtimes/...` в README и скриптах (типичный след запуска через Codex / Cursor agent, не для публичного репо).
3. Копия MVP в `trading-dashboard-react/legacy/` (дубликат с теми же путями; с дерева файлов уже удалена, в истории коммитов остаётся).

Файлов **Cursor Skills** (`SKILL.md`, `.cursor/skills/`) в текущем дереве нет — в `.gitignore` они добавлены, чтобы случайно не закоммитить.

Текущий коммит на `main` ещё может отслеживать `storage/`, пока не смержен PR с `.gitignore`. **Старые коммиты на GitHub всё ещё содержат эти данные**, пока историю не перепишете.

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

## Шаг 1. Удалить SQLite и legacy из всей истории

Из корня клона (можно одной командой):

```bash
git filter-repo \
  --path trading-dashboard-react/storage --invert-paths \
  --path trading-dashboard-react/legacy --invert-paths
```

Если `git filter-repo` отказывается работать из-за remote, сначала:

```bash
git remote remove origin
# выполните filter-repo
git remote add origin https://github.com/TesvintsevDev/trading-dashboard.git
```

Если когда-либо коммитили `.cursor/` или `skills/`, добавьте пути:

```bash
git filter-repo --path .cursor --invert-paths --path skills --invert-paths
```

## Шаг 2. Заменить личные пути и следы Codex в истории

Создайте файл `replacements.txt`:

```text
/Users/eduardtesvintsev==>REDACTED
eduardtesvintsev==>REDACTED
codex-runtimes==>REDACTED
codex-primary-runtime==>REDACTED
```

Затем:

```bash
git filter-repo --replace-text replacements.txt
```

Проверка, что в истории не осталось следов:

```bash
git log --all -S '/Users/eduard' --oneline
git log --all -S 'eduardtesvintsev' --oneline
git log --all -S 'codex-runtimes' --oneline
git log --all -- trading-dashboard-react/storage --oneline
git log --all -- trading-dashboard-react/legacy --oneline
```

Все команды должны вернуть пустой вывод.

## Шаг 3. Force push

```bash
git push origin --force --all
git push origin --force --tags
```

## Шаг 4. На GitHub (опционально)

- Если репозиторий был публичным, считайте утёкшие данные уже скопированными; переписывание истории убирает их из **текущего** зеркала GitHub, но не из чужих форков/кэшей.
- При необходимости отзовите только те секреты, которые вы когда-либо коммитили (в этом проекте API-ключей в истории не было).

## Локальная работа после merge PR

1. `git pull` (после merge PR с `.gitignore`).
2. База создаётся заново при `npm run dev:full` или `npm run seed:state`.
3. Не добавляйте `storage/`, `.cursor/`, `skills/`, `SKILL.md` в коммиты.

## Что уже сделано в PR (без переписывания истории)

- Корневой `.gitignore` для `storage/`, `*.sqlite`, `.env`, `.cursor/`, skills.
- Удаление отслеживаемых файлов SQLite из индекса Git.
- Удалён одноразовый скрипт `build-morning-state-2026-05-15.mjs` (генерация state агентом, не нужен в репо).
- Эта инструкция.

Переписывание истории выполняете **вы локально** (шаги 1–3), когда будете готовы к force push.
