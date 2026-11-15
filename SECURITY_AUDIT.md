# Аудит безопасности: Traffic Switcher (ex-Proxy Switcher and Manager)

Версия расширения: 0.6.7
Дата аудита: 17 июля 2026

---

## Высокий риск

### 1. Маршрутизация трафика через случайные публичные SOCKS5-прокси
`data/panel/components/manual-view-search.js:83-89`

Кнопка «Search» fetch-ит список прокси с публичного GitHub-репозитория и применяет случайный SOCKS5 к **всему** HTTP/HTTPS/FTP-трафику пользователя. Публичные прокси из открытых списков — классический вектор MITM: оператор прокси видит SNI (домены всех HTTPS-запросов), может подменять сертификаты при отсутствии HSTS, инжектировать контент в HTTP, логировать трафик. Пользователь не предупреждается об опасности.

### 2. Неконтролируемая цепочка поставок списка прокси
`data/panel/components/manual-view-search.js:85`

URL захардкожен на ветку `main` стороннего репо `jetkai/proxy-list`:

```
https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/json/proxies.json
```

Без закрепления версии (commit SHA / SRI). Компрометация или передача репо злоумышленнику → возможность подсовывать всем пользователям вредоносный прокси. Нет подписи/чек-суммы ответа.

### 3. Импорт JSON без валидации → произвольная запись в storage + reload
`data/options/index.js:88-91`

```js
const json = JSON.parse(event.target.result);
chrome.storage.local.set(json, () => chrome.runtime.reload());
```

Любой распарсенный объект пишется в `chrome.storage.local` как есть, без проверки схемы. Модифицированный «бэкап» может:

- внедрить вредоносный inline-PAC-скрипт (ключ `script`) — полный контроль маршрутизации трафика;
- задать `startup-proxy`, профили с любыми хостами;
- перезаписать `profiles`/`profile.*` произвольно.

Затем `chrome.runtime.reload()` применяет это немедленно. Вектор — социальной инженерии («импортируй мои настройки»). PAC-скрипт — это исполняемый JS, так что импорт файла = выполнение чужого кода в контексте маршрутизации.

---

## Средний риск

### 4. Слабая «верификация» найденного прокси
`data/panel/components/manual-view-search.js:51-56`

Проверка прокси = HEAD-запрос к двум файлам на GitHub через кандидатный прокси. Успех (любой ответ) = «Looks good!». Вредоносный прокси может вернуть 200 на что угодно и пройти проверку. Реальной проверки доверия/корректности нет.

### 5. Передача пользовательских настроек в URL внешнего запроса
`data/panel/components/manual-view-search.js:6-10, 74-82`

Значение `validate-mode` и др. prefs сериализуются в query-string и отправляются на `raw.githubusercontent.com`. Это утекает в логи/реферер GitHub'у. Символы не URL-кодируются (`Object.entries(...).map(([k,v]) => k + '=' + v)`) — потенциальная инъекция параметров и неаккуратная обработка специальных символов.

### 6. `chrome.runtime.getBackgroundPage` в MV3 = null (функциональный баг с побочным эффектом)
`data/options/index.js:25`

```js
chrome.runtime.getBackgroundPage(bg => bg.chrome.proxy.settings.get({}, bg.icon));
```

В MV3 service worker `getBackgroundPage` возвращает `null` → выброс `TypeError`, сохранение опций частично падает. Не уязвимость, но из-за этого иконка не обновляется и ошибка маскирует другие проблемы.

### 7. Monkey-patch `chrome.proxy.settings.set` мутирует объект вызывающего
`data/panel/proxy.js:4-12`

Глобальная подмена API через `Proxy` удаляет `remoteDNS`/`noPrompt` из `args[0].value` (мутация in-place). Хак fragile: применяется только в документе панели, но не в worker'е (`worker.js` вызывает нативный API). Любой будущий код, ожидающий эти поля, получит молчаливо изменённый объект. Также создаёт неоднородное поведение panel vs worker.

---

## Низкий риск

### 8. CSS-селектор из данных профиля
`data/panel/components/manual-view.js:214`

```js
this.shadowRoot.querySelector(`.type [value="${scheme}"]`)
```

`scheme` берётся из сохранённого/импортированного профиля без санитизации. Значение с `"]` сломает селектор (выброс `SyntaxError`), не XSS — но крашит UI. Из импорта можно занести значение, ломающее панель.

### 9. PAC-reload трюк с localhost
`data/panel/components/pac-view.js:237-244`

Временно ставит PAC URL на `http://127.0.0.1:8888/dummy.pac`. Если на localhost слушает сервис, он получит запрос PAC-файла. Минимальное окно, но стоит знать.

### 10. Мёртвый/опасный код счётчика ошибок
`badge.js:8-9` использует `chrome.webRequest`, но `webRequest` **нет** в `permissions` (`manifest.json:30`). При активации `counter` (через импорт или managed storage) `badge.install()` выбросит ошибку. Ответчик `badge.js:57-61` на `{cmd:'fails'}` не вызывает `response(...)` — панель получает `undefined`.

### 11. Телеметрия/исходящие ссылки на оригинального автора
`worker.js:174-185`, `manifest.json:15`

При установке/обновлении открывается `webextension.org/.../proxy-switcher.html`, uninstall-URL шлёт имя/версию. После переименования ссылки всё ещё ведут на сайт оригинального автора. Не уязвимость, но неожиданная экзифильтрация для «своего» расширения.

### 12. `managed.js` — слепой импорт managed-JSON в local storage
`managed.js:21-27`

Политика предприятия может влить любой JSON в local storage и сделать reload. По задумке — но без валидации схемы. В managed-контексте это acceptable (админ и так всемогущ), но стоит зафиксировать.

---

## Положительные моменты

- **Минимальные permissions**: только `storage`, `notifications`, `proxy`. Нет `host_permissions`, нет `content_scripts`, нет `<all_urls>`.
- **Нет инъекций в HTML**: Web Components используют `shadow.innerHTML` только со статичными шаблонами; пользовательские данные ставятся через `.value`/`.textContent`/свойства DOM, не через `innerHTML`.
- **CSP**: MV3 default CSP строгий, кастомный не нужен.
- **Нет удалённого кода**: весь JS локальный (Ace bundled), `content_security_policy` не ослаблен.
- **Хранение**: профили в `chrome.storage.local`, без облачной синхронизации.

---

## Рекомендации

1. Либо удалить фичу «Search free proxy», либо: закрепить commit SHA списка, добавлять предупреждение пользователю, не применять прокси автоматически до явного подтверждения, проверять через HTTPS с валидацией ответа.
2. Валидировать импортируемый JSON по схеме (whitelist ключей) перед `storage.local.set`; особенно `script` (PAC) помечать как потенциально опасный.
3. Заменить `getBackgroundPage` на `chrome.runtime.sendMessage({method:'refresh-icon'})` (worker уже умеет `update-icon`).
4. Убрать передачу prefs в query-string; URL-кодировать параметры.
5. Санитизировать `scheme` перед вставкой в `querySelector` (или использовать map lookup).
6. Удалить мёртвый `badge.js`/`webRequest` или добавить permission и реализовать ответчик.
7. Обновить `homepage_url`/uninstall-URL, если не хотите ссылок на оригинального автора.
