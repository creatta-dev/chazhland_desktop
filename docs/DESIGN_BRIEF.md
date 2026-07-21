# chazhland-desktop — дизайн-бриф

> ⚠️ **Снимок инвентаризации бэкенда на момент генерации, а не текущее состояние API.** Бэк с тех пор уехал вперёд, и часть утверждений устарела — например, регистрация теперь **по коду из письма** (`POST /auth/email-code` → `POST /auth/register {email, code, username, password}`), а не по инвайт-коду; `thumbnailUrl` у картинок бэк уже проставляет (асинхронно, JPEG/PNG). Перед тем как опираться на конкретный эндпоинт, сверьтесь со swagger бэка (`<API_BASE>/swagger-ui.html`) и [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md). Ценность этого файла — визуальный язык, перечень окон и «семена» промптов, а не каталог API.

> Сгенерировано из инвентаризации бэкенда (`com.chazhland.messenger`, 21 контроллер, 86 фич / 61 REST / 23 WS-назначений по 11 доменам). Источник истины — код, не OpenAPI.

Назначение файла: **что бэкенд уже умеет** (значит, дизайн обязан это показать) + **полный список окон/модалок** с готовыми «семенами» промптов под Claude design. Тема — тёмная, layout как Discord (можно менять).

## ⚠️ Поправки, проверенные по коду (свериться ПЕРЕД генерацией макетов)

- **DM есть в бэке** (`DmController`: `POST /dm/{userId}`, `GET /dm`) — добавлен в бриф (окно `win-dm-list` + вход «Написать» из профиля участника). Сама переписка идёт через обычную ленту канала.
- **Поиск по каналу** (`GET /channels/{channelId}/messages/search?q=`) возвращает обычный `List<MessageResponse>` БЕЗ подсветки/сниппетов — подсветку совпадений рисуем на клиенте.
- **thumbnailUrl у вложений всегда `null`** (тумбнейлы не генерируются) — превью картинок строить по основному `url` + `width`/`height`, не по thumbnailUrl.
- **Профиль чужого участника**: `statusMessage` недоступен (его нет в `MemberResponse`). Доступны только `userId/username/avatarUrl/role/status/joinedAt` — кастомный статус-текст другого юзера не рисовать.
- **Голосовой канал**: «кто говорит / заглушён / демонстрирует экран» — это состояние LiveKit-клиента, бэк его НЕ присылает (даёт только токен `POST /livekit/token` и `VOICE_UPDATE inVoice:true/false` через presence). Эти индикаторы — из LiveKit SDK.
- **Watch-источник** — это http(s) `url` (`POST /channels/{channelId}/watch/source`). Загрузка файла идёт через ОБЩИЙ presign (`POST /attachments/presign`), отдельного watch-аплоадера нет.
- **Смена роли** — единый флоу через одну модалку (`modal-change-role`); не плодить 4 точки входа (панель/админка/профиль) с разной логикой.
- **Состояния везде**: для каждого окна закладывать загрузку / пусто / ошибку / оффлайн (баннер реконнекта WS, блокировка композера, догон через `changesSince`).
- **Роли и 403**: скрытие модераторских кнопок по роли — лишь удобство. Бэкенд может вернуть 403 (роль в JWT устаревает за TTL); окна обязаны обрабатывать 403 и принудительный logout при reuse-detection / кике / смене пароля.
- **Доинвентаризированы по коду** (первый проход пропустил): массовые упоминания `@everyone`/`@here` (рендер спец-меншенов + автокомплит), и **«Прочитать всё»** (`POST /read-states/ack-all`). Учтены в домене «Сообщения и read-state».

## 1. Фичи по доменам — что бэкенд уже умеет

### Auth и онбординг  
*Роли: owner, admin, member, публичный*

- **Регистрация по инвайт-коду** — POST /auth/register: тело RegisterRequest {inviteCode, username(3-32), email(валидный, до 255), password(8-100)}. AuthService.register сначала атомарно активирует инвайт (InviteService.claimOrThrow → инкремент uses в одном UPDATE с проверкой revoked/maxUses/expiresAt; 0 строк = badRequest 'Invite expired, revoked or exhausted', неизвестный код = 'Invalid invite code'), затем проверяет уникальность username (409 'Username already taken') и email (409 'Email already registered'), создаёт User с argon2id-хешем пароля и Membership с ролью MEMBER в сервере инвайта. Сразу возвращает TokenResponse {accessToken, refreshToken, tokenType='Bearer', expiresIn(сек)} — пользователь залогинен без отдельного входа. Рейт-лимит: 5 регистраций / 15 мин на IP.
  
  → UI: Экран регистрации с полем инвайт-кода + username/email/password (валидация на фронте под те же лимиты: username 3-32, email, password 8-100). Раздельные сообщения об ошибках: невалидный/исчерпанный инвайт, занятый username, занятый email. После успеха — сразу залогинен (сохранить токены, перейти в приложение), отдельной формы логина не требуется. Регистрация невозможна без кода — нет публичного self-signup.
- **Логин по username или email** — POST /auth/login: тело LoginRequest {login, password}, где login — это username ИЛИ email (AuthService ищет сначала по username, затем по email). Неверные данные → 401 'Invalid credentials' (одинаковый ответ для несуществующего юзера и неверного пароля). Защита от перебора: LoginRateLimiter — скользящее окно неудач по ключу login.toLowerCase(); при превышении лимита (loginMaxAttempts за loginWindow из конфига) → 429 'Too many login attempts, try again later'. Успех сбрасывает счётчик и возвращает TokenResponse. Эндпоинт без своего IP-рейт-лимита (ограничение по логину). Роль в токене берётся из первого членства пользователя.
  
  → UI: Экран входа с ОДНИМ полем 'username или email' + пароль (не разделять на два поля). Обработка 401 (общая ошибка 'неверные данные') и 429 (показать 'слишком много попыток, попробуйте позже', желательно с подсказкой подождать). После успеха сохранить пару токенов.
- **Обновление access-токена (refresh с ротацией и reuse-detection)** — POST /auth/refresh: тело RefreshRequest {refreshToken}. AuthService.refresh: токен ищется по sha256-хешу. (1) Если найденный токен уже отозван (revoked) — трактуется как вероятная кража: гасятся ВСЕ refresh-токены пользователя (revokeAllForUser), ответ 401 'Refresh token already used'. (2) Просрочен — 401 'Refresh token expired'. (3) Иначе атомарная ротация revokeIfActive (UPDATE ... where revoked=false): если затронуто != 1 строки (гонка/двойное использование) — 401 'Refresh token already used'. (4) Иначе выпускается НОВАЯ пара токенов (старый refresh уже погашен). Рейт-лимит: 30 refresh / 1 мин на IP. Access-токен — JWT HS256, claims: sub=userId, username, role; iss/aud проверяются; TTL короткий (accessTtl из конфига, по комментариям ~15 мин).
  
  → UI: Прозрачный фоновой механизм: клиент хранит refreshToken, при 401 на бизнес-запросе или по истечении expiresIn дёргает /auth/refresh и ЗАМЕНЯЕТ обе сохранённые строки (refresh одноразовый — ротируется). КРИТИЧНО: после refresh выбросить старый refreshToken. Если refresh вернул 401 — все сессии погашены (возможна кража), нужно принудительно разлогинить пользователя и отправить на экран входа. Очередь/single-flight на refresh, чтобы параллельные запросы не словили reuse-detection.
- **Logout (выход с текущего устройства)** — POST /auth/logout: тело LogoutRequest {refreshToken}, ответ 204 No Content. AuthService.logout вызывает revokeIfActive — гасит только предъявленный refresh-токен (одну сессию), не трогая остальные устройства. Эндпоинт публичный (под /auth/**), идемпотентен (если токен уже погашен — всё равно 204).
  
  → UI: Кнопка 'Выйти' шлёт текущий refreshToken и затем локально чистит токены, переход на экран входа. Не разлогинивает другие устройства.
- **Logout-all (выход на всех устройствах)** — POST /users/me/logout-all (требует аутентификации), ответ 204. AuthService.logoutAll гасит ВСЕ refresh-токены текущего пользователя (revokeAllForUser). Access-токены остаются валидны до своего короткого TTL (нет серверного списка отзыва JWT), но обновиться уже не получится.
  
  → UI: В настройках безопасности/профиля кнопка 'Выйти на всех устройствах'. После вызова локально очистить токены. Полезно показывать как реакцию на подозрительную активность.
- **Смена собственного пароля** — PUT /users/me/password (аутентифицирован), тело ChangePasswordRequest {currentPassword, newPassword(8-100)}, ответ 204. AuthService.changePassword проверяет текущий пароль (неверный → 400 'Current password is incorrect'), сохраняет новый argon2-хеш и гасит ВСЕ refresh-токены пользователя — все сессии инвалидируются.
  
  → UI: Форма смены пароля (текущий + новый, валидация нового 8-100) в настройках. Предупредить пользователя, что после смены он будет разлогинен на всех устройствах — текущему клиенту нужно перелогиниться/обновиться. Обработать 400 для неверного текущего пароля.
- **Админский сброс пароля пользователю** — POST /admin/users/{userId}/reset-password — контроллер AdminController под @PreAuthorize(hasRole('ADMIN')) (owner проходит, т.к. в JwtAuthFilter роль OWNER получает и ROLE_ADMIN). Возвращает TempPasswordResponse {temporaryPassword}. AuthService.adminResetPassword генерирует случайный временный пароль (TokenGenerator.urlSafe(9)), ставит его argon2-хеш целевому пользователю (404 'User not found' если нет), гасит все его refresh-токены и атомарно пишет аудит 'user.reset-password'. Самого сброшенного пароля в БД нет — отдаётся вызывающему один раз для личной передачи.
  
  → UI: В админ-разделе у карточки пользователя кнопка 'Сбросить пароль'. После клика показать сгенерированный временный пароль ОДИН РАЗ (модалка с кнопкой копировать + предупреждение 'передайте лично, больше не покажем'). Доступно только admin/owner — прятать пункт от member.
- **Создание инвайт-кода** — POST /invites — InviteController под @PreAuthorize(hasRole('ADMIN')). Тело InviteCreateRequest {maxUses(>=1, опц., null=без лимита), expiresAt(Instant, опц., null=бессрочно)}, ответ 201 с InviteResponse {code, expiresAt, maxUses}. InviteService.create дополнительно проверяет свежее членство (AccessGuard.requireAdminMembership — роль из БД, не из JWT; иначе 403), создаёт инвайт в сервере создателя, в БД хранится только sha256-хеш кода, сырой code отдаётся ОДИН раз. Пишется аудит 'invite.create'.
  
  → UI: В админ-разделе форма создания инвайта: опциональные 'макс. использований' (>=1) и 'срок действия'. После создания показать сгенерированный code ОДИН РАЗ (копировать/поделиться ссылкой; предупредить, что повторно не отобразится). Пункт только для admin/owner.
- **Список инвайтов сервера** — GET /invites — @PreAuthorize(hasRole('ADMIN')). Возвращает List<InviteSummary> {id, expiresAt, maxUses, uses, revoked, createdBy, createdAt}, отсортирован по createdAt убыванию. Самих кодов в выдаче НЕТ (только хеши в БД). InviteService.list проверяет admin/owner-членство и отдаёт инвайты только своего сервера.
  
  → UI: Таблица/список инвайтов в админ-разделе: счётчик использований (uses из maxUses), срок, статус (активен/отозван/исчерпан/просрочен — вычислять на фронте по revoked + uses>=maxUses + expiresAt), кто и когда создал. Кода показать нельзя (только при создании). Кнопка 'Отозвать' у активных.
- **Отзыв инвайта** — DELETE /invites/{id} — @PreAuthorize(hasRole('ADMIN')), ответ 204. InviteService.revoke проверяет admin/owner-членство и принадлежность инвайта серверу (404 'Invite not found' иначе), помечает revoked=true (без удаления — история сохраняется), идемпотентно (повторный отзыв не пишет аудит). Пишется аудит 'invite.revoke'.
  
  → UI: Кнопка 'Отозвать' у каждого активного инвайта в списке (admin/owner). После отзыва инвайт остаётся в списке со статусом 'отозван', код перестаёт работать при регистрации.
- **Первичный bootstrap владельца и сервера** — BootstrapRunner (ApplicationRunner, не REST) — при старте приложения. Если servers.count()>0 — ничего не делает (уже инициализировано). Иначе при заданном BOOTSTRAP_OWNER_PASSWORD создаёт User-владельца (BOOTSTRAP_OWNER_USERNAME/EMAIL/PASSWORD), Server (BOOTSTRAP_SERVER_NAME) и Membership с ролью OWNER. Без owner-password — bootstrap пропускается с WARN-логом. Решает проблему 'курицы и яйца': без первого владельца некому выдать первый инвайт.
  
  → UI: НЕ эндпоинт — фронту экрана для этого не нужно. Следствие для UX: нет публичной регистрации первого/любого пользователя; единственный вход в систему — войти владельцем (заведён через env при деплое) и далее раздать инвайты. На фронте не должно быть никакой 'создать сервер'/'создать первого админа' формы.
- **JWT-аутентификация REST (Bearer) и argon2id** — JwtAuthFilter достаёт Bearer-токен из Authorization, проверяет HS256-подпись/issuer/audience (JwtService.parse), кладёт AuthenticatedUser{id, username, role} в SecurityContext; невалидный/просроченный токен → остаёмся неаутентифицированными (контекст очищается, не 500). OWNER получает и ROLE_ADMIN (проходит admin-проверки). SecurityConfig: stateless, CSRF off, CORS по app.cors.allowedOrigins (allowCredentials=true), публичны только /auth/**, /livekit/webhook, /ws/**, /actuator/health*; всё остальное authenticated. Неаутентифицированный запрос → 401 JSON {status:401, message:'Unauthorized'}. Пароли — Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8 (argon2id, нужен BouncyCastle).
  
  → UI: Клиент шлёт access-токен в заголовке Authorization: Bearer <token> на каждый защищённый REST-запрос. На 401 (тело JSON {status,message}) — пытаться refresh, при неудаче — на экран входа. CORS с credentials — учитывать домен фронта. Роль для отображения UI (admin/owner-пункты) можно декодировать из JWT claim 'role', но реальные права на сервере проверяются от свежего членства в БД (AccessGuard), поэтому скрытие пунктов в UI — только удобство, не безопасность.
- **Аутентификация WebSocket/STOMP при CONNECT** — StompAuthChannelInterceptor: т.к. браузер не может ставить HTTP-заголовки на WS-handshake, JWT передаётся в нативном заголовке Authorization (Bearer) STOMP-фрейма CONNECT. Невалидный/отсутствующий токен на CONNECT → ошибка соединения ('Missing or malformed Authorization header'/'Invalid access token'). На SUBSCRIBE авторизуется доступ: /topic/presence — любому участнику сервера (requireMembership), /topic/channel.{ULID} и /topic/watch.{ULID} — только при доступе к каналу (requireChannelAccess); wildcard и мусорные destination отсекаются по строгому ULID-формату.
  
  → UI: При установке STOMP-соединения передавать access-токен в CONNECT-заголовке Authorization: Bearer <token> (НЕ полагаться на handshake-заголовки). При reconnect после refresh — переподключаться уже с новым токеном. Обрабатывать отказ CONNECT (показать 'переподключение'/принудительный logout, если токен невалиден). Это часть онбординга real-time слоя, отдельного экрана не требует.

| метод | путь | назначение | роль |
|---|---|---|---|
| `POST` | `/auth/register` | Регистрация по инвайт-коду: атомарно активирует инвайт, создаёт пользователя (роль MEMBER) и сразу выдаёт пару токенов (TokenResponse). Тело RegisterRequest. Рейт-лимит 5/15мин на IP. | публичный |
| `POST` | `/auth/login` | Вход по username или email + пароль; возвращает пару токенов. Защита от перебора по логину (429 при превышении). 401 при неверных данных. | публичный |
| `POST` | `/auth/refresh` | Обновление access-токена по refresh-токену с ротацией (одноразовый refresh) и reuse-detection (предъявление отозванного → гашение всех сессий, 401). Рейт-лимит 30/мин на IP. | публичный |
| `POST` | `/auth/logout` | Выход с текущего устройства: гасит предъявленный refresh-токен. 204 No Content, идемпотентно. | публичный |
| `POST` | `/users/me/logout-all` | Выход на всех устройствах: гасит все refresh-токены текущего пользователя. 204. | member (любой аутентифицированный) |
| `PUT` | `/users/me/password` | Смена собственного пароля (проверка текущего, новый 8-100); инвалидирует все сессии пользователя. 204. 400 при неверном текущем пароле. | member (любой аутентифицированный) |
| `POST` | `/admin/users/{userId}/reset-password` | Админский сброс пароля: ставит случайный временный пароль, гасит сессии цели, пишет аудит; возвращает временный пароль один раз (TempPasswordResponse). | admin/owner |
| `POST` | `/invites` | Создание инвайт-кода (опц. maxUses, expiresAt) в сервере создателя; возвращает сырой code один раз (InviteResponse). 201. | admin/owner |
| `GET` | `/invites` | Список инвайтов своего сервера (InviteSummary с uses/maxUses/expiresAt/revoked/createdBy), без самих кодов, новейшие сверху. | admin/owner |
| `DELETE` | `/invites/{id}` | Отзыв инвайта (revoked=true, без удаления истории), идемпотентно. 204. | admin/owner |

WS:
- _connect_ `STOMP CONNECT-фрейм (нативный заголовок Authorization: Bearer <accessToken>)` — Аутентификация WS-сессии: JWT в STOMP CONNECT (не в HTTP-handshake). Парсится JwtService, в сессию кладётся AuthenticatedUser{id, username, role}. Отсутствие/невалидность токена → отказ соединения. (когда: При установке STOMP-соединения клиентом (и при каждом reconnect — уже с актуальным токеном после refresh).)
- _subscribe_ `/topic/channel.{channelId} и /topic/watch.{channelId} (авторизация подписки) и /topic/presence` — На фрейм SUBSCRIBE интерсептор авторизует доступ: presence — для участника сервера, channel/watch — только при доступе к каналу (свежая проверка членства/принадлежности в БД). Это контроль авторизации, не доставка данных. Wildcard/мусорные destination отклоняются по строгому ULID-формату. (когда: Когда клиент подписывается на топик канала/просмотра/присутствия после CONNECT.)

_Все факты сверены по реальному коду (контроллеры + сервисы + DTO + security), не по OpenAPI. Ключевые файлы домена (абсолютные пути): web/AuthController.java, web/InviteController.java, web/UserController.java (содержит смену пароля + logout-all), web/AdminController.java (содержит админский reset-password); сервисы service/AuthService.java, service/InviteService.java, service/BootstrapRunner.java, service/AccessGuard.java, service/LoginRateLimiter.java; security/ (JwtService, JwtAuthFilter, AuthenticatedUser, SecurityUtils); config/SecurityConfig.java (argon2id, публичные пути, CORS) и config/AppProperties.java (jwt.accessTtl/refreshTtl, ratelimit, bootstrap); ws/StompAuthChannelInterceptor.java (WS-аутентификация). Репозитории repo/RefreshTokenRepository.java и repo/InviteRepository.java реализуют атомарные ротацию/активацию.\n\nВажные нюансы для фронта/UI:\n1) Эндпоинты смены пароля и logout-all физически лежат под /users/me/* (в UserController), а админский сброс — под /admin/users/{userId}/reset-password (в AdminController), хотя бизнес-логика в AuthService.\n2) Нет публичной самостоятельной регистрации: вход в систему возможен только по инвайту (а самый первый пользователь — owner — создаётся через env при первом запуске, без REST). Соответственно НЕ должно быть форм 'создать сервер'/'создать первого админа'.\n3) refresh одноразовый и ротируется: при успехе клиент ОБЯЗАН заменить обе строки токенов; повторное использование старого/отозванного refresh → 401 и гашение ВСЕХ сессий (reuse-detection) — обрабатывать как принудительный logout. Желателен single-flight на refresh, чтобы параллельные запросы не триггерили ложное reuse-detection.\n4) Сырой invite code и временный пароль показываются ОДИН раз — нужна UX-модалка 'скопируйте, повторно не покажем'.\n5) login принимает username ИЛИ email одним полем.\n6) Роль из JWT claim 'role' годится только для показа/скрытия UI; реальные права сервер проверяет от свежего членства в БД (AccessGuard.requireAdminMembership/requireOwnerMembership), т.к. JWT живёт коротко и может содержать устаревшую роль. OWNER на уровне Spring Security автоматически имеет и ROLE_ADMIN.\n7) WS-аутентификация — через STOMP CONNECT-заголовок Authorization, не через handshake; при reconnect использовать свежий access-токен.\n8) Лимиты валидации DTO для фронта: username 3-32, email до 255, password 8-100, invite maxUses >=1._

### Профиль и уведомления  
*Роли: authenticated (любой залогиненный пользователь — действует над собственным аккаунтом), member (участник сервера — требуется для presign аватара и настроек уведомлений канала)*

- **Просмотр своего профиля** — GET /users/me возвращает username, email, avatarUrl, status (строка, дефолт 'offline'), statusMessage, role (OWNER/ADMIN/MEMBER из первого членства).
  
  → UI: Экран/панель «Мой профиль» или выпадающее меню пользователя: аватар, имя, e-mail, текущий статус и статус-сообщение, бейдж роли. Источник для шапки/боковой панели текущего юзера.
- **Редактирование профиля** — PATCH /users/me с опциональными username (3..32) и statusMessage (<=255). Пустой statusMessage очищает поле; смена username конфликтует при занятости (409).
  
  → UI: Форма редактирования профиля с полями «Имя пользователя» и «Статус-сообщение». Инлайн-валидация длины (3..32 и <=255), обработка 409 для занятого username, возможность очистить статус-сообщение (пустая строка). Поля e-mail и status в этой форме не редактируются.
- **Загрузка аватара (только растровые)** — Двухшаговый флоу: POST /attachments/presign (получить uploadUrl+objectKey, прямой PUT файла в MinIO), затем PUT /users/me/avatar с objectKey. Сервер допускает только png/jpeg/gif/webp; svg и нерастровые типы отклоняются с 400. Размер ограничен серверным лимитом.
  
  → UI: Контрол загрузки аватара: выбор файла с accept ограниченным растровыми (image/png, image/jpeg, image/gif, image/webp), загрузка напрямую по presigned URL с прогрессом, затем подтверждение через PUT avatar. Нужно показывать ошибки «не растровое изображение» и «превышен размер файла». Предпросмотр и кроппер по желанию фронта.
- **Смена пароля** — PUT /users/me/password: текущий + новый (8..100). При успехе все сессии инвалидируются (revokeAllForUser).
  
  → UI: Форма смены пароля (текущий пароль, новый пароль, подтверждение на клиенте). Минимальная длина 8. После успеха предупредить пользователя/перелогинить — все сессии разлогинятся.
- **Выход со всех устройств** — POST /users/me/logout-all гасит все refresh-токены пользователя. Ответ 204.
  
  → UI: Кнопка «Выйти на всех устройствах» в настройках безопасности. После нажатия — локальный логаут/редирект на вход.
- **Настройки уведомлений по каналам (all/mentions/muted)** — PUT /channels/{channelId}/notification-setting задаёт уровень ALL|MENTIONS|MUTED для канала (per-user). Доступ только к каналам своего сервера. Настройки персонализированы для пользователя.
  
  → UI: В контекстном меню/настройках канала переключатель уровня уведомлений из трёх вариантов: Все сообщения / Только упоминания / Без звука (muted). Состояние per-channel, привязано к текущему пользователю.
- **Синхронизация настроек уведомлений между устройствами** — GET /notification-settings возвращает все явно заданные пользователем настройки уведомлений (список channelId+level). Каналы без записи отсутствуют (дефолт применяется на клиенте).
  
  → UI: При старте клиента подгрузить карту настроек, чтобы отрисовать иконки mute/упоминаний у каналов и решать показ нотификаций. Каналы без явной настройки трактовать дефолтом (например ALL) на стороне клиента.

| метод | путь | назначение | роль |
|---|---|---|---|
| `GET` | `/users/me` | Просмотр собственного профиля. Возвращает UserResponse{id, username, email, avatarUrl, status, statusMessage, role}. role вычисляется из первого членства (по joinedAt), при отсутствии членства — MEMBER. status — строка (по умолчанию 'offline'). | authenticated (только свой профиль, owner аккаунта) |
| `PATCH` | `/users/me` | Редактирование своего профиля. Body ProfileUpdateRequest{username?(3..32), statusMessage?(<=255)} — оба поля опциональны, применяются только не-null. Пустой statusMessage очищает поле (сохраняется null). При смене username проверяется уникальность (409 Conflict 'Username already taken'). Возвращает обновлённый UserResponse. | authenticated (только свой профиль, owner аккаунта) |
| `PUT` | `/users/me/avatar` | Установка аватара по ссылке на уже загруженный в хранилище объект. Body MediaRefRequest{objectKey(<=255, обязателен)}. Сервер верифицирует объект (mediaService.verifyImage): сверяет владельца presign, фактический размер и тип через statObject и допускает ТОЛЬКО растровые картинки image/png, image/jpeg, image/gif, image/webp (svg запрещён — защита от stored-XSS), иначе 400 'Must be a raster image (png/jpeg/gif/webp)'. В avatarUrl пишется публичный URL. Возвращает UserResponse. | authenticated (только свой профиль, owner аккаунта) |
| `POST` | `/attachments/presign` | Шаг 1 загрузки аватара (общий механизм медиа): выдаёт presigned PUT URL для прямого аплоада в MinIO. Body PresignRequest{filename(<=255), contentType(<=128), size(>0)} — это предварительные данные, фактические тип/размер сверяются позже. Возвращает PresignResponse{uploadUrl, objectKey}. objectKey затем передаётся в PUT /users/me/avatar. Rate-limit 20 запросов/60с на пользователя. Требует членства на сервере. | member (требуется requireMembership — иначе 403 'Not a server member') |
| `PUT` | `/users/me/password` | Смена собственного пароля. Body ChangePasswordRequest{currentPassword(обязателен), newPassword(8..100)}. Проверяет текущий пароль (400 'Current password is incorrect' при несовпадении) и инвалидирует ВСЕ refresh-сессии пользователя. Ответ 204 No Content. | authenticated (только свой аккаунт) |
| `POST` | `/users/me/logout-all` | Выход на всех устройствах — гасит все refresh-токены текущего пользователя. Тела нет. Ответ 204 No Content. | authenticated (только свой аккаунт) |
| `PUT` | `/channels/{channelId}/notification-setting` | Задать уровень уведомлений для конкретного канала. Body NotificationSettingRequest{level: ALL|MENTIONS|MUTED, обязателен}. Проверяется доступ к каналу (канал существует и принадлежит серверу пользователя, иначе 404/403). Создаёт или обновляет запись (per-user, per-channel). Возвращает NotificationSettingResponse{channelId, level}. | member (requireChannelAccess: канал должен принадлежать серверу участника, иначе 403 'No access to this channel' / 404 'Channel not found') |
| `GET` | `/notification-settings` | Список всех настроек уведомлений текущего пользователя (для синхронизации между устройствами). Возвращает List<NotificationSettingResponse{channelId, level}>. Возвращаются только явно заданные настройки; каналы без записи в списке отсутствуют (подразумевается дефолт на клиенте). | authenticated (свои настройки) |

_В домене «Профиль и уведомления» WebSocket-эндпоинтов нет — UserController и NotificationSettingController чисто REST (массив ws пуст). Все эндпоинты домена требуют аутентификации: в SecurityConfig публичны только /auth/**, /livekit/webhook, /ws/**, /actuator/health*, остальное — .anyRequest().authenticated(). Понятие «роль» в UserResponse.role вычисляется из ПЕРВОГО членства пользователя (memberships.findFirstByUserIdOrderByJoinedAtAsc), при отсутствии членства подставляется MEMBER — это не глобальная роль аккаунта. Поле User.status — произвольная строка (по умолчанию 'offline'), отдельного эндпоинта смены status в этом домене нет (presence-домен отдельный). Эндпоинт presign (POST /attachments/presign) формально живёт в AttachmentController, но это обязательный первый шаг загрузки аватара, поэтому включён. Лимит размера файла и список разрешённых contentType берутся из MediaProperties (config), а для аватара дополнительно сужены до растровых image/png|jpeg|gif|webp в MediaService.verifyImage. Релевантные файлы: /Users/md/IdeaProjects/chazhland/backend/src/main/java/com/chazhland/messenger/web/UserController.java, .../web/NotificationSettingController.java, .../web/AttachmentController.java, .../web/dto/{UserResponse,ProfileUpdateRequest,MediaRefRequest,ChangePasswordRequest,NotificationSettingRequest,NotificationSettingResponse,PresignRequest,PresignResponse,AttachmentInput}.java, .../service/{UserService,NotificationSettingService,MediaService,AccessGuard,AuthService}.java, .../domain/{User,NotificationLevel,ChannelNotificationSetting}.java, .../config/SecurityConfig.java._

### Структура сервера (каналы / категории / настройки сервера)  
*Роли: owner, admin, member*

- **Дерево сервера (категории + каналы)** — GET /server/tree возвращает ServerTreeResponse { serverId, categories: CategoryResponse[], channels: ChannelResponse[] }. Бэкенд отдаёт ПЛОСКИЕ списки, отсортированные по position; каждый канал знает свой categoryId (может быть null = «без категории»). Дерево собирает сам клиент. Доступно любому участнику (requireMembership), сервер один — определяется по членству текущего пользователя.
  
  → UI: Левый сайдбар-навигатор сервера: список категорий-аккордеонов, под каждой — её каналы; отдельная группа для каналов с categoryId=null («без категории»). Сортировка строго по полю position. Иконки канала зависят от type (TEXT/VOICE/WATCH).
- **Переименование сервера** — PATCH /server с телом ServerUpdateRequest { name }, name @NotBlank @Size(max=100). Ответ 204 No Content (без тела). Меняет Server.name. Требует роль OWNER.
  
  → UI: В настройках сервера — поле ввода названия (макс 100 символов) с кнопкой сохранить, видимое только владельцу. После 204 фронт сам обновляет заголовок сервера в шапке/сайдбаре (тело не возвращается).
- **Иконка сервера** — PUT /server/icon с телом MediaRefRequest { objectKey } (@NotBlank @Size(max=255)) — ссылка на заранее загруженный объект в хранилище. Бэкенд верифицирует, что это изображение (mediaService.verifyImage), и сохраняет Server.iconUrl. Ответ 204 No Content. Требует роль OWNER.
  
  → UI: Загрузчик иконки сервела в настройках (только владелец): сначала аплоад файла в media-хранилище, получение objectKey, затем PUT /server/icon. Нужен превью-кружок иконки и состояние «загрузка». URL итоговой иконки фронт получает не из этого ответа — перечитать через /server/tree или иной источник.
- **Просмотр канала** — GET /channels/{id} возвращает ChannelResponse { id, serverId, categoryId, name, type, topic, position, userLimit, lastMessageId }. Доступно любому участнику (requireChannelAccess).
  
  → UI: Шапка экрана канала: имя, тема (topic) подзаголовком, иконка по типу. Для VOICE/WATCH — показ лимита участников userLimit. lastMessageId можно использовать как маркер непрочитанного.
- **Создание канала** — POST /channels с телом ChannelCreateRequest { name(@NotBlank,max=100), type(@NotNull ChannelType), categoryId(nullable), topic(max=1024,nullable), userLimit(Integer,nullable) }. Возвращает 201 + ChannelResponse. position назначается автоматически (maxPosition+1). categoryId валидируется на принадлежность серверу. Требует роль ADMIN (OWNER тоже проходит, т.к. owner получает ROLE_ADMIN).
  
  → UI: Модалка/форма «Создать канал»: выбор типа (TEXT/VOICE/WATCH — три варианта), имя, опционально категория (выпадающий список существующих категорий + «без категории»), тема (до 1024 симв.), лимит участников (число, актуально для VOICE/WATCH). Кнопка «+» рядом с категорией или в шапке сервера, видна admin/owner.
- **Редактирование канала** — PATCH /channels/{id} с телом ChannelUpdateRequest { name(@NotBlank,max=100), categoryId(nullable), topic(max=1024,nullable), userLimit(Integer,nullable) }. Возвращает ChannelResponse. ВАЖНО: это полная замена редактируемых полей — categoryId/topic/userLimit перезаписываются как есть (null = очистить / «без категории»); type не меняется (тип канала неизменяем). Требует роль ADMIN/OWNER.
  
  → UI: Экран «Настройки канала» (admin/owner): редактирование имени, темы, перенос в другую категорию (включая «без категории»), лимит участников. Тип канала показывать как read-only (нельзя изменить). Форма должна слать ВСЕ поля, иначе пустые сбросятся.
- **Удаление канала** — DELETE /channels/{id} → 204 No Content. Каскадно удаляет сообщения канала (FK ON DELETE CASCADE). Требует роль ADMIN/OWNER.
  
  → UI: Пункт «Удалить канал» в настройках/контекстном меню канала (admin/owner) с подтверждающим диалогом, предупреждающим, что вся история сообщений удалится безвозвратно.
- **Переупорядочивание каналов (drag-n-drop)** — PUT /channels/reorder с телом ReorderRequest { orderedIds: string[] (@NotEmpty) } → 204. Новые position = индексы в массиве. Ожидается ПОЛНЫЙ список каналов сервера: частичный список оставит остальным старые позиции (дыры/коллизии). Требует роль ADMIN/OWNER.
  
  → UI: Drag-and-drop перетаскивание каналов в сайдбаре (admin/owner). После дропа фронт собирает ПОЛНЫЙ упорядоченный список id всех каналов и шлёт его целиком. Оптимистичное обновление позиций до ответа 204.
- **Создание категории** — POST /categories с телом CategoryCreateRequest { name(@NotBlank,max=100) } → 201 + CategoryResponse { id, name, position }. position = maxPosition+1. Весь контроллер /categories защищён @PreAuthorize hasRole('ADMIN') (OWNER тоже проходит). Чтение категорий — только через GET /server/tree, отдельного GET нет.
  
  → UI: Кнопка «Создать категорию» в сайдбаре/настройках (admin/owner), простая форма с одним полем имени (до 100 симв.). Новая категория появляется внизу списка.
- **Редактирование категории** — PATCH /categories/{id} с телом CategoryUpdateRequest { name(@NotBlank,max=100) } → CategoryResponse. Меняется только имя (position не трогается). Требует роль ADMIN/OWNER.
  
  → UI: Инлайн-переименование или модалка для категории (admin/owner) — единственное поле «имя».
- **Удаление категории** — DELETE /categories/{id} → 204. FK channels.category_id ON DELETE SET NULL — каналы НЕ удаляются, а становятся «без категории» (categoryId=null). Требует роль ADMIN/OWNER.
  
  → UI: Пункт «Удалить категорию» с диалогом, поясняющим, что каналы не пропадут, а переедут в группу «без категории». После удаления эти каналы рендерятся в общей корневой группе.
- **Переупорядочивание категорий (drag-n-drop)** — PUT /categories/reorder с телом ReorderRequest { orderedIds: string[] (@NotEmpty) } → 204. Новые position = индексы в массиве; ожидается ПОЛНЫЙ список категорий сервера. Требует роль ADMIN/OWNER.
  
  → UI: Drag-and-drop перетаскивание заголовков категорий (admin/owner). Фронт шлёт полный упорядоченный список всех id категорий целиком.
- **Типы каналов TEXT / VOICE / WATCH** — enum ChannelType { TEXT, VOICE, WATCH }. Задаётся при создании канала (ChannelCreateRequest.type, @NotNull), хранится в Channel.type (EnumType.STRING), отдаётся в ChannelResponse.type. Неизменяем (в PATCH поля type нет). userLimit — отдельное nullable-поле, релевантно прежде всего для голосовых/watch-каналов.
  
  → UI: Селектор из ровно трёх типов в форме создания канала, у каждого своя иконка в дереве (текстовый #, голосовой, совместный просмотр). Поведение экрана канала ветвится по type: TEXT — лента сообщений, VOICE — голосовая комната, WATCH — совместный просмотр. Тип нельзя менять после создания.

| метод | путь | назначение | роль |
|---|---|---|---|
| `GET` | `/server/tree` | Дерево сервера: serverId + плоские списки категорий (CategoryResponse[]) и каналов (ChannelResponse[]), отсортированные по position. Сервер определяется по членству текущего пользователя. | member |
| `PATCH` | `/server` | Переименование сервера. Тело ServerUpdateRequest { name }. Ответ 204 No Content. | owner |
| `PUT` | `/server/icon` | Установка иконки сервера по ссылке на загруженный объект. Тело MediaRefRequest { objectKey }; бэкенд верифицирует изображение. Ответ 204 No Content. | owner |
| `GET` | `/channels/{id}` | Получить один канал. Ответ ChannelResponse { id, serverId, categoryId, name, type, topic, position, userLimit, lastMessageId }. | member |
| `POST` | `/channels` | Создать канал. Тело ChannelCreateRequest { name, type(TEXT/VOICE/WATCH), categoryId?, topic?, userLimit? }. Ответ 201 + ChannelResponse, position назначается автоматически. | admin (включая owner) |
| `PATCH` | `/channels/{id}` | Обновить канал (имя, категория, тема, лимит — полная замена полей; тип не меняется). Тело ChannelUpdateRequest { name, categoryId?, topic?, userLimit? }. Ответ ChannelResponse. | admin (включая owner) |
| `DELETE` | `/channels/{id}` | Удалить канал (каскадно удаляет сообщения). Ответ 204 No Content. | admin (включая owner) |
| `PUT` | `/channels/reorder` | Переупорядочить каналы. Тело ReorderRequest { orderedIds: string[] } — полный упорядоченный список id; position = индекс. Ответ 204 No Content. | admin (включая owner) |
| `POST` | `/categories` | Создать категорию. Тело CategoryCreateRequest { name }. Ответ 201 + CategoryResponse { id, name, position }, position назначается автоматически. | admin (включая owner) |
| `PATCH` | `/categories/{id}` | Переименовать категорию. Тело CategoryUpdateRequest { name }. Ответ CategoryResponse. | admin (включая owner) |
| `DELETE` | `/categories/{id}` | Удалить категорию. Каналы не удаляются — их categoryId становится null («без категории»). Ответ 204 No Content. | admin (включая owner) |
| `PUT` | `/categories/reorder` | Переупорядочить категории. Тело ReorderRequest { orderedIds: string[] } — полный упорядоченный список id; position = индекс. Ответ 204 No Content. | admin (включая owner) |

_Прочитанные файлы (все абсолютные пути): /Users/md/IdeaProjects/chazhland/backend/src/main/java/com/chazhland/messenger/web/ServerController.java, .../web/ChannelController.java, .../web/CategoryController.java, .../web/dto/ServerTreeResponse.java, ServerUpdateRequest.java, ChannelCreateRequest.java, ChannelUpdateRequest.java, ChannelResponse.java, CategoryCreateRequest.java, CategoryUpdateRequest.java, CategoryResponse.java, MediaRefRequest.java, ReorderRequest.java; .../domain/ChannelType.java, Channel.java, Category.java, Server.java; .../service/ChannelService.java, ServerService.java; .../security/JwtAuthFilter.java.

ВАЖНО про WebSocket: в домене «структура сервера» WS-событий НЕТ. Ни ServerController/ChannelController/CategoryController, ни ChannelService/ServerService не используют SimpMessagingTemplate/convertAndSend/@MessageMapping/@SendTo. Все мутации (rename, icon, CRUD каналов/категорий, reorder) — чисто REST, без рассылки изменений по сокету. Следствие для UI: после правок структуры другим админом текущий клиент НЕ получит push — нужно перечитывать GET /server/tree (по навигации/рефрешу), live-синхронизации дерева на этом этапе нет. (Поэтому массив ws пустой.)

Про роли: единственный сервер на инсталляцию; роль берётся из членства (Membership). В JwtAuthFilter роль OWNER получает дополнительно ROLE_ADMIN ("owner проходит admin-проверки"), поэтому все эндпоинты с hasRole('ADMIN') доступны и admin, и owner. Эндпоинты PATCH /server и PUT /server/icon требуют строго hasRole('OWNER'). GET /server/tree и GET /channels/{id} — любому участнику.

Прочие нюансы: ChannelResponse содержит lastMessageId, но эти эндпоинты его не устанавливают (поле принадлежит домену сообщений). Тип канала (type) задаётся только при создании и неизменяем — в ChannelUpdateRequest поля type нет. Контроллер /categories целиком под @PreAuthorize hasRole('ADMIN'); отдельного GET для категорий/каналов-списком нет — чтение дерева только через /server/tree. Reorder требует передавать ПОЛНЫЙ список id (частичный приведёт к коллизиям/дырам в position)._

### Сообщения и read-state  
*Роли: member, admin, owner*

- **Отправка сообщения** — POST /channels/{channelId}/messages. Поддерживает текст (<=4000), вложения (до 10, по objectKey), ответ на сообщение (replyToId, валидируется принадлежность тому же каналу и неудалённость). Только в каналах типа TEXT. Rate-limit 30/10с.
  
  → UI: Поле ввода (composer) внизу ленты с кнопкой отправки и прикрепления файлов; превью прикреплённых вложений до отправки; UI ответа-цитаты при replyToId; счётчик/ограничение 4000 символов; блокировка composer в не-TEXT каналах (голос).
- **Идемпотентная (оптимистичная) отправка по clientMessageId** — clientMessageId (nonce, <=64) уникален на автора; повторная отправка того же nonce (например после реконнекта) возвращает уже сохранённое сообщение вместо дубля (findByAuthorIdAndClientMessageId).
  
  → UI: Клиент генерирует clientMessageId, рисует сообщение оптимистично сразу (статус «отправляется»), при ответе сервера сопоставляет по clientMessageId и заменяет временную запись настоящей (с серверным id/createdAt); безопасный авто-ретрай при обрыве сети без риска дублей.
- **Курсорная пагинация по ULID** — GET /channels/{channelId}/messages с before/after/limit. id — это ULID (лексикографически = хронологически), курсор без offset. before — скролл вверх (старше), after — догон новее, без курсора — последние 50 (макс 100).
  
  → UI: Бесконечный скролл ленты: подгрузка истории вверх при достижении верха (before=id самого старого загруженного), подгрузка новых вниз (after=id самого свежего); индикатор загрузки; сохранение позиции скролла при подгрузке.
- **Дельта-догон changesSince** — GET /channels/{channelId}/messages/changes?since=. Возвращает только изменённые (правки/удаления) сообщения с момента since, по времени изменения, лимит 500. Курсор догона — changedAt (= max(editedAt, deletedAt)).
  
  → UI: После реконнекта/возврата из фона клиент дотягивает пропущенные правки и удаления, не перезагружая всю ленту; применяет изменения к уже отрисованным сообщениям; при >500 изменений повторяет запрос с since=changedAt последнего элемента.
- **Правка сообщения** — PATCH /messages/{messageId}. Только автор, только неудалённое; проставляет editedAt. Рассылает MESSAGE_EDITED.
  
  → UI: Пункт «Редактировать» в меню своего сообщения (inline-редактор); пометка «(изменено)» рядом с сообщением при editedAt != null; в реальном времени обновление текста у других участников.
- **Soft-delete / tombstone** — DELETE /messages/{messageId}. Помечает deletedAt, стирает content (tombstone). Идемпотентно. Автор удаляет своё; admin/owner — любое (с аудитом). В истории удалённые не отдаются, но приходят в changes и в WS как deleted=true с content=null.
  
  → UI: Пункт «Удалить» в меню (для своих — всем, для чужих — только модераторам, UI скрывает кнопку по роли); плашка «Сообщение удалено» вместо текста для tombstone, приходящего по WS/changes; нельзя реагировать/отвечать на удалённое.
- **Упоминания @user** — Парсинг @username (3..32 симв., [A-Za-z0-9_]) в тексте при отправке; создаётся Mention, атомарно растёт mention_count в read_state каждого упомянутого члена сервера (кроме автора и не-членов).
  
  → UI: Подсветка @упоминаний в тексте сообщения; автокомплит участников при вводе @ в composer; отдельный бейдж/счётчик упоминаний на канале (выделяется от обычного непрочитанного); навигация «перейти к упоминанию».
- **Массовые упоминания @everyone / @here** — Парсятся по границам слова (regex `(^|\s)@everyone(\s|$)` и `@here` — чтобы `foo@everyone.com` и `@everyonee` не триггерили). `@everyone` пингует всех участников сервера, `@here` — только тех, кто онлайн (по presence); поднимают mention_count так же, как обычные упоминания.
  
  → UI: В автокомплите по `@` показывать спец-пункты «everyone» и «here» с пояснением (все / только в сети); рендерить их выделенной плашкой-меншеном; учитывать в счётчике упоминаний и в desktop-уведомлениях (срабатывают даже для каналов на уровне MENTIONS).
- **Read-state (отметка прочитанного)** — PUT /channels/{channelId}/read-state с lastReadMessageId. Хранит на пару (user, channel) последнее прочитанное сообщение и счётчик упоминаний; пометка прочтения обнуляет mentionCount.
  
  → UI: Автоматическая отправка markRead при просмотре низа ленты/фокусе канала; разделитель «новые сообщения» по lastReadMessageId; сброс бейджей канала при открытии.
- **Счётчики непрочитанного и упоминаний** — GET /read-states отдаёт по всем каналам {channelId, lastReadMessageId, mentionCount}. Непрочитанность вычисляется клиентом сравнением lastReadMessageId с lastMessageId канала (на сервере это поле живёт в Channel, обновляется при отправке); mentionCount — точный счётчик из read_state.
  
  → UI: Точка/жирное выделение канала с непрочитанными в списке каналов; числовой бейдж количества упоминаний на канале и агрегированный на сервере; начальная загрузка всех read-state при старте приложения для отрисовки бейджей.
- **Отметить всё прочитанным (mark-all-read)** — POST /read-states/ack-all разом обнуляет непрочитанное и счётчики упоминаний по ВСЕМ каналам пользователя; возвращает обновлённый список ReadStateResponse.
  
  → UI: Действие «Прочитать всё» (в контекстном меню сервера / в шапке списка каналов / по агрегированному бейджу непрочитанного); после ответа массово сбросить бейджи каналов из возвращённого списка.
- **Realtime-рассылка по каналу (WebSocket/STOMP)** — Все события сообщений и typing идут одним топиком /topic/channel.{channelId} в виде ChatEvent с дискриминатором type. Рассылка строго после коммита транзакции (TransactionPhase.AFTER_COMMIT); при сбое рассылки сообщение остаётся в БД и добирается через changesSince/history.
  
  → UI: Одна STOMP-подписка на канал даёт создание/правку/удаление/typing/реакции; обработчик по полю type; устойчивость к разрыву WS за счёт догона дельтой; индикатор соединения/переподключения.

| метод | путь | назначение | роль |
|---|---|---|---|
| `POST` | `/channels/{channelId}/messages` | Отправка сообщения в текстовый канал. Идемпотентна по clientMessageId (повтор того же nonce после реконнекта возвращает уже сохранённое сообщение, без дубля). Принимает content (<=4000) и/или до 10 attachments (по objectKey уже загруженного объекта), опц. replyToId. Требует content ИЛИ attachments. Канал должен быть типа TEXT. Rate-limit 30 запросов / 10 сек на пользователя. Парсит @username-упоминания, поднимает mention_count у упомянутых. После коммита шлёт WS MESSAGE_CREATED. Ответ — MessageResponse. | member (член сервера, к которому относится канал) |
| `GET` | `/channels/{channelId}/messages` | История канала, курсорная пагинация по ULID (id). Без курсора — последние (по id убыв.); before=<ulid> — сообщения старше курсора (скролл вверх, по id убыв.); after=<ulid> — новее курсора (догон пропущенного, по id возр.); limit 1..100, по умолчанию 50. Удалённые (deletedAt) не возвращаются. Ответ — список MessageResponse с батч-загруженными вложениями и реакциями. | member |
| `GET` | `/channels/{channelId}/messages/changes` | Дельта правок/удалений с момента since (обяз., ISO-8601 UTC с суффиксом Z) — для догона состояния после реконнекта. Возвращает сообщения, у которых edited_at>since ИЛИ deleted_at>since, отсортированные по времени изменения (max(editedAt,deletedAt)) возр., лимит 500. Удалённые приходят как tombstone (content=null, deleted=true). Клиент догоняет, повторяя запрос с since = changedAt последнего элемента. Ответ — список MessageResponse. | member |
| `PATCH` | `/messages/{messageId}` | Правка текста сообщения. Тело: content (NotBlank, <=4000). Редактировать можно только своё сообщение (иначе 403); удалённое править нельзя (400). Проставляет editedAt=now. После коммита шлёт WS MESSAGE_EDITED. Ответ — обновлённый MessageResponse. | member (только автор сообщения) |
| `DELETE` | `/messages/{messageId}` | Soft-delete сообщения (tombstone): проставляет deletedAt=now и обнуляет content (содержимое не хранится). Идемпотентно (повторное удаление — no-op). Своё может удалить автор; чужое — только OWNER/ADMIN (удаление чужого пишется в аудит message.delete.admin). После коммита шлёт WS MESSAGE_DELETED. Ответ 204 No Content. | member (автор) или admin/owner (для чужих сообщений) |
| `PUT` | `/channels/{channelId}/read-state` | Отметить канал прочитанным до lastReadMessageId (тело: lastReadMessageId, NotBlank). Создаёт read-state при отсутствии, сбрасывает mentionCount в 0. Ответ — ReadStateResponse {channelId, lastReadMessageId, mentionCount}. | member |
| `GET` | `/read-states` | Все read-state текущего пользователя (по всем каналам) — для расчёта бейджей непрочитанного и счётчиков упоминаний на клиенте. Ответ — список ReadStateResponse {channelId, lastReadMessageId, mentionCount}. | member |
| `POST` | `/read-states/ack-all` | Отметить ВСЕ каналы прочитанными разом (mark-all-read): обнуляет mentionCount и подтягивает lastReadMessageId по всем каналам. Ответ — список ReadStateResponse. | member |

WS:
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent (единый дискриминируемый по type, поля с null опускаются JsonInclude.NON_NULL). type=MESSAGE_CREATED: channelId, message (полный MessageResponse), userId (=authorId). Срабатывает после коммита транзакции отправки сообщения. (когда: POST /channels/{channelId}/messages — после успешного коммита)
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent type=MESSAGE_EDITED: channelId, message (обновлённый MessageResponse с editedAt и changedAt), userId. Клиент заменяет сообщение в ленте по message.id. (когда: PATCH /messages/{messageId} — после коммита правки)
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent type=MESSAGE_DELETED: channelId, message (tombstone: content=null, deleted=true, deletedAt/changedAt заполнены), userId. Клиент заменяет сообщение на плашку «удалено» или скрывает. (когда: DELETE /messages/{messageId} — после коммита soft-delete)
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent type=TYPING: channelId, userId, username. Эфемерно, без записи в БД. Клиент показывает индикатор «печатает…» и сам гасит его по таймауту. (когда: Клиент шлёт send на /app/channel.{channelId}.typing)
- _send_ `/app/channel.{channelId}.typing` — Пустое тело (пользователь берётся из Principal сессии). Сервер проверяет доступ к каналу и ретранслирует TYPING-событие подписчикам /topic/channel.{channelId}. Относится к realtime-слою сообщений (домен read-state не задействует), включён для полноты картины ленты. (когда: Клиент шлёт при начале набора текста (с дебаунсом на стороне клиента))

_База: /Users/md/IdeaProjects/chazhland/backend/src/main/java/com/chazhland/messenger. Ключевые файлы: web/MessageController.java, web/ReadStateController.java, service/MessageService.java, service/ReadStateService.java, service/AccessGuard.java; DTO: web/dto/MessageCreateRequest.java, MessageEditRequest.java, MessageResponse.java, ReadStateResponse.java, ReadStateUpdateRequest.java, AttachmentInput.java, AttachmentResponse.java, ReactionGroup.java; домен: domain/Message.java, ReadState.java, ReadStateId.java, MessageType.java; репозитории: repo/MessageRepository.java, ReadStateRepository.java; WS: ws/ChatEvent.java, ChatEventType.java, ChatEventListener.java, ChatEventPublisher.java, MessageBroadcastEvent.java, TypingController.java.

Точная форма payload MessageResponse (поля): id, channelId, authorId, content (null если deleted), type (DEFAULT|SYSTEM), replyToId, createdAt, editedAt, deleted (boolean), deletedAt, changedAt (=max(editedAt,deletedAt) — единый курсор для changesSince), pinnedAt (null если deleted), attachments[] (AttachmentResponse: id, url, contentType, size, filename, width, height, thumbnailUrl), reactions[] (ReactionGroup: emoji, userIds[] — клиент сам считает count и «есть ли я»). У удалённого сообщения attachments/reactions пустые. ReadStateResponse: channelId, lastReadMessageId, mentionCount.

Важно по ролям/безопасности: на этих контроллерах НЕТ @PreAuthorize — доступ проверяется на уровне сервиса через AccessGuard. На MVP один сервер: «member» = любой член сервера (requireMembership через первую membership пользователя), доступ к каналу = принадлежность канала серверу пользователя (requireChannelAccess). Удаление чужого сообщения требует роли OWNER или ADMIN (проверяется по СВЕЖЕЙ роли из БД, не из JWT). Публичных эндпоинтов в домене нет — всё требует аутентификации и членства.

Чего в домене НЕТ (важно, чтобы фронт не закладывался): в коде MessageRepository есть searchInChannel (поиск по тексту) и findBy...PinnedAtIsNotNull (закреплённые), а в ChatEvent есть фабрики messagePinned/messageUnpinned и типы MESSAGE_PINNED/MESSAGE_UNPINNED/REACTION_ADDED/REACTION_REMOVED. НО в MessageController/ReadStateController НЕ выставлено REST-эндпоинтов поиска и пина — эти возможности либо обслуживаются другими контроллерами (реакции — отдельный ReactionController с POST/DELETE), либо ещё не подключены. В рамках домена «Сообщения и read-state» REST = 7 перечисленных эндпоинтов, WS = топик /topic/channel.{channelId} + send /app/channel.{channelId}.typing. Реакции и пины — смежные домены (ReactionController и др.), здесь не описываю, хотя их события прилетают в тот же топик канала.

Транспорт WS: STOMP, единый топик на канал. typing — единственный клиент->сервер send в realtime (через TypingController @MessageMapping /channel.{channelId}.typing, пользователь из Principal). HeartbeatMessage/PresenceService/WatchState относятся к presence-домену, не к сообщениям._

### Вложения и реакции (attachments & reactions)  
*Роли: member, owner, admin*

- **Presign-загрузка вложений (presign -> прямой PUT -> привязка к сообщению)** — Двухфазная схема. Фаза 1: клиент-участник запрашивает presigned PUT URL у бэка (POST /attachments/presign), передавая filename/contentType/size — это лишь ПРЕДВАРИТЕЛЬНЫЕ значения. MediaService валидирует contentType по белому списку (image/png,jpeg,gif,webp, video/mp4,webm, audio/mpeg,ogg, application/pdf, application/zip, text/plain) и size по лимиту (по умолчанию 100MB), генерирует objectKey вида attachments/{ULID}/{санитизированное_имя}, запоминает владельца presign'а в Redis на 1 час и возвращает {uploadUrl, objectKey}. Фаза 2: клиент сам делает прямой HTTP PUT файла в MinIO по uploadUrl (бэк в этом не участвует; срок жизни ссылки по умолчанию 10 минут / PT10M). Фаза 3: привязка к сообщению — клиент НЕ дергает отдельный attachment-эндпоинт, а передаёт objectKey в массиве attachments при отправке сообщения (POST /channels/{channelId}/messages). На сервере MediaService.verify() сверяет владельца (чужой не привяжет ваш объект -> 403), делает statObject и берёт ФАКТИЧЕСКИЕ contentType/size из хранилища (защита от подмены клиентом), отдаёт publicUrl. В ответе сообщения вложение приходит как AttachmentResponse {id, url, contentType, size, filename, width, height, thumbnailUrl}.
  
  → UI: Нужен компонент загрузки файла (drag-and-drop зона + кнопка-скрепка в композере сообщения), который: показывает прогресс прямого PUT-аплоада в MinIO, складывает полученные objectKey в черновик сообщения (до 10 вложений на сообщение, см. лимит attachments<=10) и отправляет их вместе с текстом. На стороне UI стоит заранее проверять размер (<=100MB) и тип файла по тому же белому списку, чтобы не ловить 400 после загрузки. Для отрисовки вложений в ленте нужны разные превью по contentType: картинка (с учётом width/height и thumbnailUrl для верстки без скачка layout), видео-плеер, аудио-плеер, иконка-карточка PDF/ZIP/txt со ссылкой url для скачивания. svg+xml в реакциях/картинках запрещён (есть verifyImage только для растровых), но в обычных вложениях svg в белом списке нет вообще.
- **Добавление реакции эмодзи (idempotent)** — POST /messages/{messageId}/reactions с телом {emoji}. ReactionService: валидирует эмодзи (непустой, <=64 символа), применяет rate-limit 30 реакций за 10 сек на пользователя, проверяет доступ к каналу сообщения, запрещает реакции на удалённое сообщение (400). Идемпотентно: повторный POST той же реакции тем же юзером — no-op (по составному ключу messageId+userId+emoji). При реальном добавлении сохраняет Reaction и шлёт WS-событие REACTION_ADDED. Ответ HTTP 204 No Content (тела нет).
  
  → UI: Нужен emoji-picker, вызываемый из контекстного меню/ховера сообщения, и кликабельные чипы-реакции под сообщением. Поскольку API возвращает 204 без агрегата, UI должен делать оптимистичное обновление локально и/или полагаться на WS-событие REACTION_ADDED для синхронизации. Свой клик безопасно повторять (идемпотентность).
- **Снятие реакции эмодзи (idempotent)** — DELETE /messages/{messageId}/reactions?emoji={emoji} (эмодзи передаётся как query-параметр, НЕ в теле). ReactionService валидирует эмодзи, проверяет доступ к каналу, удаляет свою реакцию по ключу messageId+userId+emoji. Идемпотентно: если реакции нет — no-op. При реальном удалении шлёт WS-событие REACTION_REMOVED. Ответ HTTP 204 No Content.
  
  → UI: Тот же чип-реакции работает как тоггл: повторный клик по эмодзи, которое уже поставил текущий пользователь, шлёт DELETE с emoji в query-string. UI определяет «поставил ли я» сам, сверяя свой userId со списком userIds в агрегате.
- **Агрегаты реакций и список вложений в ответах сообщений** — Отдельного GET-эндпоинта реакций/вложений НЕТ — оба приходят встроенными в MessageResponse (поля attachments: List<AttachmentResponse> и reactions: List<ReactionGroup>) при отправке/истории/догоне сообщений (POST и GET /channels/{channelId}/messages, /messages/changes, PATCH /messages/{id}). Реакции группируются по эмодзи в порядке появления: ReactionGroup {emoji, userIds:[...]} — бэк отдаёт СПИСОК userId, а count и флаг «реагировал ли я» клиент считает сам. Для удалённого сообщения (tombstone) и attachments, и reactions принудительно пустые.
  
  → UI: Рендер сообщения должен сразу отображать вложения и сгруппированные реакции из одного ответа (не делать доп. запросов). Чип реакции = emoji + длина userIds (количество) + подсветка, если в userIds есть текущий пользователь. По наведению можно показать «кто поставил», резолвя userIds в имена через данные участников. Удалённое сообщение рисуется как tombstone без вложений и реакций.

| метод | путь | назначение | роль |
|---|---|---|---|
| `POST` | `/attachments/presign` | Выдать presigned PUT URL и objectKey для прямого аплоада файла в MinIO. Тело PresignRequest {filename(<=255), contentType(<=128), size(>0)} — предварительные значения; ответ PresignResponse {uploadUrl, objectKey}. Rate-limit 20/60с. Реальная привязка к сообщению — через поле attachments в POST /channels/{channelId}/messages. | member |
| `POST` | `/messages/{messageId}/reactions` | Добавить свою реакцию-эмодзи к сообщению. Тело ReactionRequest {emoji(<=64)}. Идемпотентно, rate-limit 30/10с, нельзя реагировать на удалённое сообщение. Ответ 204 No Content; рассылает WS REACTION_ADDED. | member |
| `DELETE` | `/messages/{messageId}/reactions?emoji={emoji}` | Снять свою реакцию-эмодзи с сообщения (emoji — query-параметр). Идемпотентно. Ответ 204 No Content; рассылает WS REACTION_REMOVED. | member |

WS:
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent {type: REACTION_ADDED, channelId, userId (кто поставил), messageId, emoji}. Поля message/username = null. Сам пересчитанный агрегат НЕ присылается — клиент инкрементально обновляет состояние по userId+emoji. (когда: Любой участник, подписанный на топик канала, получает событие сразу после успешного коммита транзакции add-реакции (REACTION_ADDED).)
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent {type: REACTION_REMOVED, channelId, userId (кто снял), messageId, emoji}. message/username = null. Клиент сам убирает userId из соответствующей группы. (когда: Участники топика канала получают событие после коммита транзакции remove-реакции (REACTION_REMOVED).)

_Все три REST-эндпоинта требуют лишь membership (участник единственного сервера на MVP): /attachments/presign явно вызывает accessGuard.requireMembership; реакции — requireChannelAccess (членство + принадлежность канала серверу пользователя). Ролей owner/admin для этого домена НЕТ — они в roles перечислены только потому, что owner/admin тоже являются member и потому имеют доступ; повышенных прав здесь не требуется. Снятие реакции удаляет ТОЛЬКО свою реакцию (ключ включает userId) — модерационного «снять чужую реакцию» эндпоинта нет.

Привязка вложения к сообщению — НЕ отдельный attachment-эндпоинт, а поле attachments:List<AttachmentInput {objectKey, filename, width?, height?}> (макс 10) в MessageCreateRequest на POST /channels/{channelId}/messages (домен сообщений). На сервере MediaService.verify() заново берёт contentType/size из statObject MinIO, игнорируя присланные клиентом в presign (anti-spoofing); width/height — лишь подсказка для верстки.

Хранилище MinIO: два клиента — internalClient (stat/list/remove/bucket) и presignClient под публичным эндпоинтом (подпись URL для браузера). Бакет с анонимным read-only доступом на GetObject; приватность держится на неугадываемости ULID-ключа. publicUrl = publicEndpoint/bucket/objectKey (прямые публичные ссылки, как CDN). Есть OrphanGcJob (сборка непривязанных объектов) и MinioHealthIndicator — вне основного контракта фронта.

WS: единый топик канала /topic/channel.{channelId} (CHANNEL_TOPIC_PREFIX = "/topic/channel."). Реакции НЕ имеют отдельного /app send-эндпоинта — клиент шлёт add/remove только по REST; WS используется лишь для рассылки REACTION_ADDED/REACTION_REMOVED. Для вложений WS-событий нет (они приезжают внутри MESSAGE_CREATED через MessageResponse.attachments). ChatEvent помечен @JsonInclude(NON_NULL), поэтому в JSON реакционного события полей message и username не будет.

Лимиты (application.yml, переопределяемы env): media.max-file-size=100MB, media.presign-expiry=PT10M, белый список media.allowed-content-types=image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/ogg,application/pdf,application/zip,text/plain. Эмодзи — произвольная строка до 64 символов (не ограничен enum'ом — можно слать кастомные unicode-эмодзи). Поле thumbnailUrl в AttachmentResponse сейчас всегда null: конструктор Attachment его не заполняет (тумбнейлы пока не генерируются), хотя поле в схеме есть._

### Realtime WebSocket/STOMP  
*Роли: owner, admin, member*

- **STOMP-эндпоинт /ws + аутентификация на CONNECT** — Единственный WebSocket-эндпоинт /ws (ws/WebSocketConfig.java). HTTP-handshake открыт в SecurityConfig, реальная аутентификация — в STOMP CONNECT-фрейме: клиент кладёт нативный заголовок Authorization: Bearer <JWT> (браузер не может выставлять HTTP-заголовки на WS-handshake). StompAuthChannelInterceptor парсит JWT (JwtService), достаёт subject(id)/username/role, кладёт AuthenticatedUser в Principal сессии. Невалидный/отсутствующий токен -> MessagingException, CONNECT отклоняется. Брокер in-memory: SimpleBroker на /topic, applicationDestinationPrefix /app. allowedOrigins берётся из AppProperties.cors().allowedOrigins (CSV).
  
  → UI: Нужен слой WS-клиента (STOMP-over-WebSocket), который при подключении передаёт access-token в CONNECT-заголовке Authorization. При ошибке CONNECT (истёк/невалидный токен) — переподключение после refresh токена. Индикатор состояния соединения (online/reconnecting) в шапке/статус-баре.
- **Авторизация подписок по членству/доступу к каналу** — StompAuthChannelInterceptor на каждый SUBSCRIBE проверяет destination: /topic/presence -> требуется членство в сервере (AccessGuard.requireMembership); /topic/channel.{ULID} и /topic/watch.{ULID} -> требуется доступ к каналу (AccessGuard.requireChannelAccess: канал существует и принадлежит серверу пользователя). channelId извлекается строгим ULID-паттерном [0-9A-Za-z]{26}, что отсекает wildcard-подписки (.*, .**) и мусор. Любой другой destination -> подписка отклоняется (MessagingException). Тип канала (TEXT/WATCH) на подписке не проверяется — в «неправильный» топик ничего не публикуется, а write-пути тип проверяют.
  
  → UI: UI должен подписываться только на каналы, к которым у пользователя есть доступ; при отказе подписки (ошибка) — не показывать канал/просмотр. Список каналов и факт членства подгружать из REST до подписки.
- **Broadcast событий сообщений канала (MESSAGE_CREATED/EDITED/DELETED)** — ChatEventPublisher.toChannel шлёт ChatEvent в /topic/channel.{channelId}. События генерируются НЕ по WS, а как side-effect REST-операций над сообщениями (MessageService): создание -> MESSAGE_CREATED, правка -> MESSAGE_EDITED, удаление -> MESSAGE_DELETED (payload — tombstone: content=null, deleted=true). Рассылка идёт через MessageBroadcastEvent + ChatEventListener только AFTER_COMMIT транзакции (подписчики не получат событие об откатившемся сообщении). Если realtime-доставка упала — событие логируется, клиент догоняет через REST changesSince/history. Payload ChatEvent: {type, channelId, message:MessageResponse, userId(=authorId), username(null для этих типов), messageId(null), emoji(null)} (NON_NULL). MessageResponse: id, channelId, authorId, content, type, replyToId, createdAt, editedAt, deleted, deletedAt, changedAt(=max(editedAt,deletedAt)), pinnedAt, attachments[], reactions[].
  
  → UI: Лента сообщений канала, подписанная на /topic/channel.{id}: на MESSAGE_CREATED дорисовать сообщение (учесть replyToId, attachments), на MESSAGE_EDITED обновить текст и пометку «изменено», на MESSAGE_DELETED заменить на tombstone «сообщение удалено». Нужен дозагрузчик пропусков (changesSince) на случай потери realtime.
- **Broadcast закрепления/открепления (MESSAGE_PINNED/UNPINNED)** — Те же транзакционные события в /topic/channel.{channelId}: при закреплении/откреплении (MessageService.pin/unpin) рассылаются ChatEvent типа MESSAGE_PINNED/MESSAGE_UNPINNED. Payload содержит message:MessageResponse (с pinnedAt) и messageId (=message.id), userId=authorId.
  
  → UI: Виджет/панель закреплённых сообщений канала, обновляемая в реальном времени; индикатор «закреплено» на самом сообщении в ленте по pinnedAt.
- **Broadcast реакций (REACTION_ADDED/REACTION_REMOVED)** — ReactionService при добавлении/снятии эмодзи-реакции публикует (AFTER_COMMIT) ChatEvent reactionAdded/reactionRemoved в /topic/channel.{channelId}. Payload: {type, channelId, message:null, userId(кто реагировал), username:null, messageId, emoji}. message не передаётся — клиент обновляет счётчики реакций у сообщения по messageId/emoji.
  
  → UI: На сообщениях — строка реакций (эмодзи + счётчик), обновляемая в реальном времени по messageId/emoji; кнопка добавить/снять реакцию (само действие — через REST).
- **Индикатор «печатает…» (TYPING)** — Эфемерно, без БД. Клиент шлёт пустой фрейм в /app/channel.{channelId}.typing (TypingController.@MessageMapping). Сервер проверяет AccessGuard.requireChannelAccess и рассылает ChatEvent.typing в /topic/channel.{channelId}. Payload: {type:TYPING, channelId, userId, username} (message/messageId/emoji = null). Срабатывает при каждом сообщении клиента о наборе текста.
  
  → UI: Под полем ввода/в шапке канала показывать «{username} печатает…» при получении TYPING; собственный клиент периодически шлёт typing при наборе. Индикатор гасить по таймауту на стороне клиента (TTL не присылается).
- **Очередь ошибок WS (/user/queue/errors)** — WsExceptionHandler (@ControllerAdvice + @MessageExceptionHandler) ловит исключения из @MessageMapping-обработчиков (typing, presence.heartbeat, watch.control) и шлёт WsError ТОЛЬКО инициатору в /user/queue/errors (broadcast=false, SendToUser). WsError: {status:int, message:String}. ApiException -> реальный HTTP-статус и сообщение; прочее -> 400 'Invalid request'. Без этого обработчика ошибки по WS молча проглатывались бы.
  
  → UI: Клиент подписывается на /user/queue/errors и показывает тост/инлайн-ошибку по своим WS-действиям (например, отказ управления плеером, отказ typing). Различать по полю status (403 — нет доступа, 400 — некорректный запрос).
- **Присутствие: хартбит и рассылка статусов (PRESENCE_UPDATE/VOICE_UPDATE)** — Клиент шлёт хартбит в /app/presence.heartbeat (~каждые 30с, PresenceWsController). Тело HeartbeatMessage{status} опционально: online|idle|dnd (пустой — только продление онлайна). PresenceService на Redis (online — sorted set с TTL 60с, status — hash, voice — hash). Изменения присутствия рассылаются ВСЕМ участникам сервера в /topic/presence как PresenceEvent: PRESENCE_UPDATE {type, userId, status:'online|idle|dnd|offline'} либо VOICE_UPDATE {type, userId, channelId, inVoice:boolean} (NON_NULL). offline генерится фоном (PresenceSweeper) когда нет хартбита дольше TTL. VOICE_UPDATE наполняется из LiveKit-вебхуков (вход/выход в голосовой канал).
  
  → UI: Клиент шлёт периодический heartbeat пока вкладка активна (со status idle/dnd при смене). Подписка на /topic/presence: цветные точки online/idle/dnd/offline у пользователей в списке участников; индикаторы «в голосовом канале» рядом с именем/каналом по VOICE_UPDATE.
- **Снимок присутствия для начальной загрузки (REST)** — GET /presence (PresenceController) — PresenceSnapshot {online: [UserPresence{userId,status}], voice: Map<channelId,[userId]>}. Доступно участнику сервера (AccessGuard.requireMembership). Нужен для первичной загрузки состояния, дальше — дельты через /topic/presence.
  
  → UI: При входе подтянуть полный список онлайн-пользователей и состав голосовых каналов одним REST-запросом, затем поддерживать его дельтами из /topic/presence.
- **Совместный просмотр: управление по WS (play/pause/seek)** — Клиент шлёт WatchControl в /app/watch.{channelId}.control (WatchWsController). Payload WatchControl{action: PLAY|PAUSE|SEEK (@NotNull), positionSeconds: double}. WatchService.control проверяет доступ к каналу и что канал типа WATCH, обновляет состояние в Redis и рассылает WatchState в /topic/watch.{channelId}. Управлять может ЛЮБОЙ участник канала (доверенная группа), побеждает последнее действие по серверному времени. WatchState {url, paused, positionSeconds, updatedAt(epoch ms), hostId, lastActionBy} (NON_NULL). Если источник не загружен -> ошибка 'No video loaded' (придёт в /user/queue/errors). Ошибки валидации (action null) тоже уходят в очередь ошибок.
  
  → UI: Экран watch-канала с общим видеоплеером: подписка на /topic/watch.{id}; кнопки play/pause/seek шлют WatchControl с текущим positionSeconds; синхронизация позиции по формуле positionSeconds + (now - updatedAt) при !paused с коррекцией дрейфа. Показывать кто инициировал действие (lastActionBy).
- **Совместный просмотр: REST для источника и снимка** — GET /channels/{channelId}/watch — текущий WatchState (200) или 204 No Content если источник не задан. POST /channels/{channelId}/watch/source с WatchSourceRequest{url: @NotBlank @Size<=2048, http(s)} — задаёт источник (LOAD: пауза, позиция 0), возвращает WatchState и рассылает в /topic/watch.{id}. DELETE /channels/{channelId}/watch — остановить просмотр (очистить источник, url=null), рассылает в /topic/watch.{id}. Все — для участника watch-канала (требуется тип WATCH, иначе 400 'Not a watch channel').
  
  → UI: Кнопка «Загрузить видео» (ввод URL mp4/HLS) и «Остановить просмотр»; при открытии watch-канала тянуть GET снимок (обработать 204 как «нет источника»), дальше слушать /topic/watch.{id}.

| метод | путь | назначение | роль |
|---|---|---|---|
| `GET` | `/presence` | Снимок присутствия для начальной загрузки: список онлайн-пользователей (с online/idle/dnd) и состав голосовых каналов (channelId -> [userId]). | member |
| `GET` | `/channels/{channelId}/watch` | Текущее состояние совместного просмотра канала (WatchState) или 204 No Content, если источник не задан. Канал должен быть типа WATCH. | member |
| `POST` | `/channels/{channelId}/watch/source` | Задать источник видео (LOAD): сброс на паузу и позицию 0; возвращает WatchState и рассылает его подписчикам /topic/watch.{id}. URL http(s), до 2048 символов. Канал типа WATCH. | member |
| `DELETE` | `/channels/{channelId}/watch` | Остановить совместный просмотр (очистить источник, url=null); рассылает обнулённое состояние подписчикам. 204 No Content. Канал типа WATCH. | member |

WS:
- _subscribe_ `/topic/channel.{channelId}` — ChatEvent {type: MESSAGE_CREATED|MESSAGE_EDITED|MESSAGE_DELETED|MESSAGE_PINNED|MESSAGE_UNPINNED|TYPING|REACTION_ADDED|REACTION_REMOVED, channelId, message?:MessageResponse(id,channelId,authorId,content,type,replyToId,createdAt,editedAt,deleted,deletedAt,changedAt,pinnedAt,attachments[],reactions[]), userId?, username?, messageId?, emoji?} (NON_NULL — присутствуют только поля, релевантные типу). (когда: Сообщения/пины — после коммита REST-операций MessageService (AFTER_COMMIT); реакции — после коммита ReactionService; TYPING — при отправке клиентом в /app/channel.{id}.typing. Подписка требует доступа к каналу (ULID-валидация).)
- _subscribe_ `/topic/presence` — PresenceEvent {type: PRESENCE_UPDATE|VOICE_UPDATE, userId, status?('online'|'idle'|'dnd'|'offline'), channelId?, inVoice?:boolean} (NON_NULL). (когда: PRESENCE_UPDATE — при смене онлайн-статуса (хартбит выводит из офлайна/меняет статус) и при истечении TTL (sweeper шлёт offline). VOICE_UPDATE — вход/выход в голосовой канал (из LiveKit-вебхуков). Подписка требует членства в сервере.)
- _subscribe_ `/topic/watch.{channelId}` — WatchState {url(null=нет источника), paused:boolean, positionSeconds:double, updatedAt:long(epoch ms), hostId, lastActionBy} (NON_NULL). (когда: После любого изменения состояния просмотра: задание источника (REST /watch/source), play/pause/seek (WS /app/watch.{id}.control), остановка (REST DELETE /watch). Подписка требует доступа к каналу (ULID-валидация).)
- _subscribe_ `/user/queue/errors` — WsError {status:int, message:String}. status — HTTP-код из ApiException либо 400 для прочих ошибок. (когда: Когда @MessageMapping-обработчик (typing / presence.heartbeat / watch.control) бросает исключение. Доставляется только инициатору действия (broadcast=false).)
- _send_ `/app/channel.{channelId}.typing` — Без тела (пустой фрейм). Сервер сам подставляет userId/username из Principal. (когда: Клиент шлёт во время набора текста в канале. Сервер проверяет доступ к каналу и рассылает TYPING в /topic/channel.{id}.)
- _send_ `/app/presence.heartbeat` — HeartbeatMessage {status?: 'online'|'idle'|'dnd'} — опционально; пустое тело допустимо (только продление онлайна). (когда: Клиент шлёт периодически (~каждые 30с) пока активен; при смене статуса передаёт новый status. Продлевает онлайн (Redis TTL 60с) и при изменении рассылает PRESENCE_UPDATE.)
- _send_ `/app/watch.{channelId}.control` — WatchControl {action: PLAY|PAUSE|SEEK (обязательно), positionSeconds: double}. (когда: Клиент шлёт при нажатии play/pause/seek в общем плеере. Сервер проверяет доступ + тип WATCH + наличие загруженного источника, обновляет состояние в Redis и рассылает WatchState в /topic/watch.{id}. Управлять может любой участник канала.)

_Базовый путь WS: эндпоинт /ws, брокер in-memory (один инстанс; при масштабировании заменяется на Redis/RabbitMQ relay). Префиксы: подписки — /topic (и персональные /user/queue/...), отправка клиента — /app (@MessageMapping). Аутентификация ТОЛЬКО на CONNECT (JWT в нативном заголовке Authorization), далее Principal живёт в STOMP-сессии. Авторизация на каждом SUBSCRIBE: /topic/presence -> членство, /topic/channel.{ULID} и /topic/watch.{ULID} -> доступ к каналу; channelId валидируется строгим ULID-паттерном (26 символов), что блокирует wildcard-подписки.

Важно для фронта: события сообщений/пинов/реакций НЕ инициируются по WebSocket — их источник всегда REST-мутации в MessageService/ReactionService, а WS лишь рассылает их подписчикам ПОСЛЕ коммита транзакции (ChatEventListener @TransactionalEventListener AFTER_COMMIT). Realtime — best-effort: при сбое доставки сервер логирует, а клиент обязан догонять пропуски через REST (changesSince/history). Курсор догона в MessageResponse — поле changedAt (=max(editedAt, deletedAt)).

По ролям в этом домене: и текстовые сообщения/реакции/typing, и управление совместным просмотром доступны любому участнику канала (member). Отдельных owner/admin-ограничений на WS-операции и watch-REST в коде нет (роли owner/admin перечислены как существующие в системе и проверяются в других доменах). Управление плеером — намеренно «доверенная группа»: любой участник может play/pause/seek, побеждает последнее действие по серверному времени.

Голосовое присутствие (VOICE_UPDATE) приходит в /topic/presence, но триггерится не клиентским WS-фреймом, а серверными LiveKit-вебхуками (voiceJoin/voiceLeave), плюс реконсиляция (VoiceReconciler) — на стороне фронта это только подписка и отрисовка, отправлять во voice по STOMP не нужно.

WatchState.url == null означает «источник не задан / просмотр остановлен» — этот же null приходит и в снимке REST (там как 204 No Content)."_

### Presence (онлайн-статусы)  
*Роли: member, owner, admin*

- **Онлайн-статусы участников (online / idle / dnd / offline)** — Источник истины онлайна — WS-хартбиты, хранятся в Redis (sorted set presence:online со score = epoch последнего хартбита; онлайн = score в окне TTL 60 с). Сам статус (online|idle|dnd) хранится отдельно в hash presence:status и переживает кратковременный офлайн. При установке WS-сессии (SessionConnectedEvent) пользователь сразу помечается online, не дожидаясь первого хартбита. Допустимые статусы строго: online, idle, dnd (регистронезависимо, прочее игнорируется и трактуется как 'только продлить онлайн'). offline — не задаётся клиентом, а проставляется сервером (PresenceSweeper) при протухании хартбита.
  
  → UI: В списке участников рядом с каждым юзером нужен индикатор статуса (точка-кружок): зелёный online, жёлтый idle, красный dnd, серый/без точки offline. Нужен переключатель собственного статуса (меню 'online / idle / не беспокоить') — выбор уходит полем status в хартбите. UI должен помнить, что offline ставится сервером, его нельзя выставить вручную.
- **Heartbeat (продление онлайна) по WebSocket** — Клиент шлёт STOMP-сообщение в /app/presence.heartbeat примерно каждые ~30 с. Тело HeartbeatMessage{status} опционально: со статусом — меняет/подтверждает статус, пустое — только продлевает онлайн. Окно онлайна (TTL) — 60 секунд; без хартбита дольше TTL юзер уходит в offline. Хартбит атомарен (Lua-скрипт в Redis), рассылка PRESENCE_UPDATE происходит только при реальной смене статуса или при возврате из офлайна.
  
  → UI: Фронт должен держать открытый WS и слать heartbeat по таймеру (~30 с, безопасно меньше TTL 60 с). При смене собственного статуса в UI — слать heartbeat с новым status. Достаточно одного фонового таймера, отдельного экрана не требует.
- **Рассылка изменений присутствия (дельты) по WS** — Все изменения присутствия рассылаются всем участникам сервера в топик /topic/presence как PresenceEvent. type=PRESENCE_UPDATE при смене онлайн-статуса (online/idle/dnd/offline), type=VOICE_UPDATE при входе/выходе из голосового канала. Сервер шлёт только дельты, а не полный список.
  
  → UI: Клиент подписывается на /topic/presence один раз при заходе и инкрементально обновляет индикаторы статусов и список 'кто в голосовом' по приходящим событиям. Не нужно повторно дёргать REST на каждое изменение.
- **Начальный снимок присутствия (initial load)** — REST GET /presence отдаёт полный снимок PresenceSnapshot: список online (UserPresence{userId,status}) + карта voice (channelId -> [userId] — кто сейчас в каждом голосовом канале). Используется один раз для начальной отрисовки, далее состояние поддерживается дельтами из /topic/presence. Доступно любому участнику сервера (requireMembership).
  
  → UI: При загрузке приложения / списка участников и панели голосовых каналов сделать один GET /presence, чтобы сразу отрисовать кто онлайн и кто в каких голосовых, затем переключиться на дельты по WS. Экран: список участников + сайдбар голосовых каналов с их участниками.
- **Voice-presence: кто сейчас в голосовом канале (через LiveKit)** — Карта 'userId -> channelId' хранится в Redis hash voice:members и наполняется из LiveKit-вебхуков (методы PresenceService.voiceJoin / voiceLeave / voiceRoomFinished — вызываются вебхук-контроллером вне домена presence). Дубль join того же канала не шумит; leave снимает только если юзер числится именно в этом канале (защита от запоздавшего left при переходе). Изменения рассылаются как VOICE_UPDATE по /topic/presence; начальное состояние входит в снимок /presence.
  
  → UI: Под каждым голосовым каналом в сайдбаре показывать список участников, находящихся в нём прямо сейчас (аватарки/имена). Состав обновляется по VOICE_UPDATE: inVoice=true — добавить юзера в channelId, inVoice=false — убрать. Сам вход/выход в голос инициируется через LiveKit, не через presence-API.
- **Авто-офлайн по таймауту (sweeper) и реконсиляция голоса** — PresenceSweeper по расписанию (каждые 20 с) снимает онлайн с тех, кто не слал хартбит дольше TTL (краш/закрытие вкладки без disconnect) и рассылает offline-события; статус (idle/dnd) при этом в Redis не стирается. VoiceReconciler каждые 60 с сверяет voice:members с фактическим состоянием комнат LiveKit (источник истины) и снимает 'зависших' участников при потерянном participant_left. Офлайн НЕ ставится на WS-disconnect — это сделано осознанно ради мультисессий.
  
  → UI: Чисто серверное поведение, отдельного UI не требует. Фронт должен лишь корректно реагировать на приходящие offline (PRESENCE_UPDATE) и inVoice=false (VOICE_UPDATE) события и не считать пользователя онлайн/в голосе бесконечно. Закрытие вкладки → автоматический уход в offline через ~60-80 с, мгновенного исчезновения может не быть.

| метод | путь | назначение | роль |
|---|---|---|---|
| `GET` | `/presence` | Полный снимок присутствия для начальной загрузки: список онлайн-пользователей со статусами (online[].userId, online[].status) и карта голосовых каналов voice (channelId -> [userId]). Дальше состояние поддерживается дельтами по /topic/presence. | member |

WS:
- _send_ `/app/presence.heartbeat` — HeartbeatMessage { status?: 'online' | 'idle' | 'dnd' } — status опционален; пустое тело = только продлить онлайн без смены статуса. Недопустимые значения игнорируются. (когда: Клиент шлёт периодически (~каждые 30 с) для продления онлайна, а также при смене собственного статуса.)
- _subscribe_ `/topic/presence` — PresenceEvent { type: 'PRESENCE_UPDATE' | 'VOICE_UPDATE', userId, status?, channelId?, inVoice? } (поля с null опускаются). Для PRESENCE_UPDATE: status = online|idle|dnd|offline. Для VOICE_UPDATE: channelId + inVoice (true = вошёл, false = вышел). (когда: Сервер рассылает всем участникам при смене онлайн-статуса (хартбит сменил статус / возврат из офлайна / sweeper поставил offline) и при входе/выходе из голосового канала (LiveKit-вебхуки, реконсиляция).)

_Авторитетные исходники домена: /Users/md/IdeaProjects/chazhland/backend/src/main/java/com/chazhland/messenger/presence/ — PresenceController.java (REST GET /presence), PresenceWsController.java (@MessageMapping /presence.heartbeat), PresencePublisher.java (PRESENCE_TOPIC = "/topic/presence"), WebSocketPresenceListener.java (online при SessionConnectedEvent), PresenceService.java (вся логика, Redis-ключи, Lua-скрипты, voice*-методы), PresenceSnapshot.java, UserPresence.java, PresenceEvent.java, PresenceEventType.java, HeartbeatMessage.java, PresenceSweeper.java, VoiceReconciler.java.

Важные нюансы для фронта:
1) В этом домене ровно ОДИН REST-эндпоинт — GET /presence. Все остальные взаимодействия идут по WS. Не выдумывать POST для статуса — статус меняется только через heartbeat.
2) Роль: requireMembership (AccessGuard) — нужно быть участником сервера. Отдельных owner/admin-ограничений на presence НЕТ; owner/admin перечислены как роли проекта, но для presence достаточно member.
3) Статусы строго: online | idle | dnd (задаются клиентом) и offline (только сервер). 'status' нормализуется в нижний регистр; неизвестные значения молча игнорируются (трактуются как 'только продлить онлайн').
4) TTL онлайна = 60 с; sweeper бежит каждые 20 с; реконсилятор голоса — каждые 60 с. Heartbeat рекомендуется слать ~раз в 30 с. offline НЕ ставится на disconnect (мультисессии) — мгновенного ухода в офлайн не будет.
5) Voice-presence наполняется LiveKit-вебхуками (PresenceService.voiceJoin/voiceLeave/voiceRoomFinished вызываются вебхук-контроллером вне пакета presence — это НЕ presence-REST-эндпоинт). Источник истины голоса — LiveKit.
6) PresenceEvent сериализуется с JsonInclude.NON_NULL — поля status/channelId/inVoice присутствуют только когда релевантны (по type)._

### Голос и демонстрация экрана (LiveKit)  
*Роли: owner, admin, member, публичный (только вебхук, с проверкой подписи)*

- **Выдача access-токена голосового канала** — POST /livekit/token принимает {channelId}, проверяет через AccessGuard.requireChannelAccess, что пользователь — участник сервера и имеет доступ к каналу, и что канал именно типа VOICE (иначе 400 'Not a voice channel'). Имя комнаты LiveKit детерминированно: 'channel:' + channelId (LiveKitRoom.forChannel). LiveKitTokenService.mint() выпускает JWT (jjwt, подпись api-secret) c subject=userId, claim name=username и video-grant {room, roomJoin:true, canPublish:true, canSubscribe:true, canPublishData:true}, срок жизни = livekit.tokenTtl. Ответ LiveKitTokenResponse {token, url (wss-адрес сервера LiveKit из конфига), room}.
  
  → UI: Голосовой канал в списке каналов должен иметь кнопку 'Подключиться'/'Войти в звонок'. По клику клиент дёргает POST /livekit/token, получает token+url+room и инициализирует LiveKit-клиент (микрофон, прослушивание). Нужен экран/панель активного звонка: участники, кнопки mute/unmute, отключиться. Текстовый канал такой кнопки не показывает.
- **Go Live / демонстрация экрана (screenshare)** — Отдельного эндпоинта НЕТ. Право на screenshare заложено в тот же video-grant токена: canPublish:true разрешает публиковать любые треки (камера/экран), canPublishData:true — data-каналы. То есть один токен от /livekit/token одновременно даёт и микрофон, и демонстрацию экрана — никакого дополнительного запроса к бэкенду для 'Go Live' не требуется, всё делается клиентским LiveKit SDK.
  
  → UI: В панели активного звонка нужна кнопка 'Демонстрация экрана / Go Live' и кнопка её остановки. Поскольку отдельного backend-вызова нет, кнопка работает целиком через LiveKit SDK на токене, полученном при входе в канал. Можно показывать индикатор 'идёт демонстрация экрана' у участника.
- **WS-уведомления о входе/выходе из голосового канала** — Не отдельный эндпоинт домена, а следствие обработки вебхуков. PresenceService.voiceJoin/voiceLeave/voiceRoomFinished шлют PresenceEvent типа VOICE_UPDATE в /topic/presence: {type:'VOICE_UPDATE', userId, channelId, inVoice:true|false}. Источник — вебхуки LiveKit (participant_joined/left/room_finished), сверх того фоновый VoiceReconciler (раз в 60с) сверяет Redis-presence с реальными комнатами LiveKit и снимает зависших участников, тоже рассылая VOICE_UPDATE с inVoice:false.
  
  → UI: Рядом с голосовым каналом в дереве каналов нужно в реальном времени показывать список присутствующих (аватары/имена) и их количество; добавлять/убирать участника по приходу VOICE_UPDATE без перезагрузки. Индикатор 'X в голосовом' обновляется на лету.
- **Начальный снимок присутствия (кто в каких голосовых)** — GET /presence (PresenceController) для участника сервера возвращает PresenceSnapshot {online:[{userId,status}], voice: map channelId -> [userId]}. voice-часть наполняется из Redis hash voice:members, который пишется обработчиком вебхуков LiveKit.
  
  → UI: При начальной загрузке клиента сразу отрисовать, кто уже сидит в каждом голосовом канале (заполнить аватары участников у голосовых каналов), не дожидаясь WS-дельт. Дальше состояние поддерживается событиями VOICE_UPDATE из /topic/presence.
- **Приём вебхуков LiveKit (серверное, НЕ-UI)** — POST /livekit/webhook — публичный (permitAll в SecurityConfig), читает сырые байты тела (consumes=ALL) и заголовок Authorization. LiveKitWebhookService.handle проверяет JWT-подпись (api-secret) и сверяет claim sha256 с base64(SHA-256(тело)); при несовпадении — 401. Дедуп через Redis ключ webhook:seen:{event.id} (TTL 1ч) от at-least-once/replay. По event.event обновляет voice-presence: participant_joined->voiceJoin, participant_left->voiceLeave, room_finished->voiceRoomFinished; track_published/room_started и пр. игнорируются. room.name парсится обратно в channelId через LiveKitRoom.channelIdFrom (префикс 'channel:').
  
  → UI: НЕ-UI. Чисто серверный приём событий от инфраструктуры LiveKit. На клиенте не отображается и клиентом не вызывается; влияет на UI лишь косвенно через рассылку VOICE_UPDATE в /topic/presence.

| метод | путь | назначение | роль |
|---|---|---|---|
| `POST` | `/livekit/token` | Выдать LiveKit access-токен для входа в голосовой канал (микрофон + screenshare/Go Live в одном токене). Тело {channelId}; ответ {token, url(wss), room}. Канал должен быть типа VOICE, иначе 400. | member (любой участник сервера с доступом к каналу — AccessGuard.requireChannelAccess; неучастник -> 403, чужой канал -> 403, отсутствует -> 404) |
| `POST` | `/livekit/webhook` | Серверный приём вебхуков LiveKit (participant_joined/left, room_finished) для синхронизации voice-presence. НЕ-UI. | публичный (permitAll), но тело обязано пройти проверку JWT-подписи api-secret и хеша SHA-256 тела; иначе 401 |
| `GET` | `/presence` | Начальный снимок присутствия: онлайн-пользователи + карта channelId -> [userId], кто сейчас в голосовых каналах. Нужно для отрисовки состава звонков при загрузке. | member (AccessGuard.requireMembership) |

WS:
- _subscribe_ `/topic/presence` — PresenceEvent. Для голоса: {type:'VOICE_UPDATE', userId, channelId, inVoice:true|false} — поля status отсутствует (NON_NULL). Также через этот же топик идут PRESENCE_UPDATE {type, userId, status} — это онлайн-статусы, не голос. (когда: Срабатывает при обработке вебхука LiveKit participant_joined (inVoice:true) / participant_left (inVoice:false) / room_finished (inVoice:false для всех в комнате), а также при снятии зависшего участника фоновым VoiceReconciler (inVoice:false). Клиент слушает, чтобы в реальном времени показывать состав голосовых каналов.)
- _send_ `/app/presence.heartbeat` — HeartbeatMessage {status?} (online|idle|dnd). Прямого отношения к голосу не имеет — это общий хартбит онлайн-присутствия; включён, т.к. голосовой состав публикуется через тот же presence-механизм/топик. (когда: Клиент шлёт периодически (~раз в 30с) для поддержания онлайна; протухание (60с TTL) -> sweeper рассылает offline. К входу в звонок отношения не имеет, но без онлайна пользователь считается офлайн.)

_Ключевое: ОТДЕЛЬНОГО эндпоинта для 'Go Live'/screenshare НЕТ — права на демонстрацию экрана и микрофон выдаются одним JWT в POST /livekit/token (video-grant: canPublish/canSubscribe/canPublishData = true). Клиент входит в звонок и включает screenshare средствами LiveKit SDK, без дополнительных запросов к бэкенду. Токен выдаётся ТОЛЬКО участнику и ТОЛЬКО для канала типа VOICE; имя комнаты детерминированно 'channel:'+channelId. У /livekit/token нет аннотации @PreAuthorize — авторизацию полностью обеспечивают anyRequest().authenticated() (SecurityConfig) + AccessGuard.requireChannelAccess. Состав звонка (кто в голосовом) не приходит в ответе /livekit/token — его клиент берёт из GET /presence (снимок) и далее из WS-событий VOICE_UPDATE на /topic/presence; источник истины — вебхуки LiveKit + периодический VoiceReconciler. Файлы: web/LiveKitController.java, web/LiveKitWebhookController.java, web/dto/LiveKitTokenRequest.java, web/dto/LiveKitTokenResponse.java, service/LiveKitTokenService.java, service/LiveKitWebhookService.java, common/LiveKitRoom.java, config/LiveKitProperties.java, config/SecurityConfig.java (строки 46-49), presence/PresenceService.java, presence/PresenceEvent.java, presence/PresencePublisher.java, presence/PresenceController.java, presence/PresenceSnapshot.java, presence/VoiceReconciler.java._

### Watch-party (совместный просмотр)  
*Роли: member, owner, admin*

- **Канал типа WATCH** — Совместный просмотр работает только на каналах с ChannelType.WATCH (наряду с TEXT и VOICE). Любая операция watch сначала проверяет, что канал существует, принадлежит серверу пользователя и имеет тип WATCH; иначе 400 'Not a watch channel'. Состояние просмотра — одно на канал.
  
  → UI: В списке каналов нужен отдельный визуальный тип канала 'watch' со своей иконкой. Открытие такого канала ведёт на отдельный экран кинозала (видеоплеер + участники), а не на обычную текстовую ленту.
- **Единое синхронизированное состояние просмотра** — WatchState = { url, paused, positionSeconds, updatedAt (epoch millis серверного времени), hostId (кто задал источник), lastActionBy (кто сделал последнее действие) }. Хранится в Redis по ключу 'watch:{channelId}', сериализуется JSON. Клиент должен вычислять ожидаемую позицию = positionSeconds + (now - updatedAt) при !paused и корректировать дрейф. url == null означает 'нет источника / просмотр остановлен'. JSON-сериализация с NON_NULL (null-поля могут отсутствовать в payload).
  
  → UI: Плеер должен быть управляемым программно (seek/play/pause извне), а не только пользователем. Нужна логика синхронизации часов: подгонять локальную позицию под серверную (positionSeconds + дрейф). Показывать, кто хост (hostId) и кто сделал последнее действие (lastActionBy), например 'Аня перемотала'.
- **Источник: внешний URL или файл из MinIO** — Источник задаётся одним полем url (NotBlank, max 2048). Сервер валидирует: не пустой, длина <= 2048, начинается с http:// или https:// — иначе 400 'Invalid URL'/'URL must be http(s)'. По коду источник — это просто URL; согласно комментарию это либо прямая ссылка (mp4/HLS), либо публичный URL файла, ранее загруженного в MinIO. Отдельного загрузчика файла внутри watch-домена НЕТ — загрузка делается в другом домене (storage), сюда передаётся готовый публичный URL.
  
  → UI: В кинозале нужна форма 'Указать источник' с полем ввода URL (внешняя ссылка mp4/HLS). Плюс кнопка 'Выбрать из загруженных' / 'Загрузить файл', которая использует storage/MinIO-флоу и затем подставляет полученный публичный URL в это же поле. Валидацию http(s) и лимит 2048 символов дублировать на клиенте.
- **Управление воспроизведением по WebSocket (play/pause/seek)** — play/pause/seek идут по WS для низкой задержки (не по REST). Клиент шлёт WatchControl { action: PLAY|PAUSE|SEEK, positionSeconds } в /app/watch.{channelId}.control. Сервер требует, чтобы источник был загружен (иначе 400 'No video loaded'), вычисляет paused (PLAY->false, PAUSE->true, SEEK->сохраняет текущее paused), берёт max(0, position), обновляет updatedAt серверным временем, сохраняет в Redis и рассылает новое состояние всем. hostId сохраняется, lastActionBy = текущий пользователь.
  
  → UI: Кнопки Play/Pause и перемотка (seek-бар) должны слать WS-команды, а не менять локальный плеер напрямую — реальное состояние приходит обратно через /topic. UI должен оставаться отзывчивым при отсутствии источника (команды отклоняются с 'No video loaded'). При SEEK состояние паузы не меняется — учитывать при отрисовке.
- **Рассылка состояния подписчикам канала** — Любое изменение (setSource, control, stop) публикуется через WatchPublisher в топик /topic/watch.{channelId} как объект WatchState. Это единственный механизм, через который клиенты узнают актуальное состояние в реальном времени.
  
  → UI: Экран кинозала при входе подписывается на /topic/watch.{channelId} и реактивно применяет каждое пришедшее состояние к плееру (источник, play/pause, позиция). Нужна обработка события 'остановлено' (url==null) — показать пустой плеер/заглушку.
- **Право управления: любой участник канала** — Контроль (источник, play/pause/seek, stop) доступен ЛЮБОМУ участнику канала — это доверенная группа, отдельной роли 'ведущий' нет. AccessGuard.requireChannelAccess проверяет только членство на сервере и принадлежность канала серверу (404 если канала нет, 403 если канал чужого сервера). Конфликты разрешаются по принципу 'побеждает последнее действие по серверному времени'.
  
  → UI: Не нужно блокировать кнопки управления для не-хоста: управлять может каждый участник. Стоит показывать, кто только что совершил действие (lastActionBy), чтобы участники понимали причину внезапного seek/pause. Можно предупреждать о возможных 'войнах за пульт', но технических ограничений роли нет.
- **Снимок состояния и остановка просмотра** — GET /channels/{channelId}/watch возвращает текущее состояние или 204 No Content, если источник не задан. DELETE /channels/{channelId}/watch останавливает просмотр: удаляет ключ из Redis и рассылает 'пустое' состояние (url=null, paused=true, position=0, hostId=null, lastActionBy=инициатор).
  
  → UI: При открытии кинозала делать GET для начальной инициализации плеера (обработать 204 = ничего не запущено, показать экран выбора источника). Нужна кнопка 'Остановить просмотр', сбрасывающая плеер у всех участников.

| метод | путь | назначение | роль |
|---|---|---|---|
| `GET` | `/channels/{channelId}/watch` | Снимок текущего состояния совместного просмотра (WatchState). Возвращает 204 No Content, если источник не задан (просмотр не запущен). | member (любой участник сервера, которому принадлежит канал; проверяется только членство + принадлежность канала, не роль) |
| `POST` | `/channels/{channelId}/watch/source` | Задать источник видео (LOAD). Тело WatchSourceRequest { url }. Сбрасывает состояние на паузу с позицией 0, делает текущего пользователя hostId, сохраняет в Redis и рассылает в топик. Валидирует http(s) URL, max 2048. | member (любой участник канала) |
| `DELETE` | `/channels/{channelId}/watch` | Остановить просмотр: очистить источник (удалить состояние из Redis) и разослать пустое состояние (url=null). Отвечает 204 No Content. | member (любой участник канала) |

WS:
- _send_ `/app/watch.{channelId}.control` — WatchControl { action: PLAY|PAUSE|SEEK (NotNull), positionSeconds: double }. action диктует paused (PLAY->играем, PAUSE->пауза, SEEK->сохраняет текущую паузу), positionSeconds — целевая позиция (на сервере берётся max(0, position)). (когда: Когда участник нажимает Play/Pause или перематывает (seek) видео в кинозале. Требует уже загруженного источника, иначе 400 'No video loaded'. Результат прилетит обратно всем через топик.)
- _subscribe_ `/topic/watch.{channelId}` — WatchState { url, paused, positionSeconds, updatedAt (epoch millis серверного времени), hostId, lastActionBy }. JSON с NON_NULL — null-поля (например url при остановке) могут отсутствовать. (когда: Сервер публикует при любом изменении: задан источник (POST /source), команда play/pause/seek (WS control) и остановка (DELETE — приходит состояние с url=null). Клиент применяет состояние к плееру и корректирует дрейф позиции.)

_Все операции watch требуют только членства в сервере, владеющем каналом (AccessGuard.requireChannelAccess), и тип канала WATCH; отдельной роли 'ведущий/хост' с эксклюзивными правами в коде НЕТ — hostId лишь информационное поле (кто задал источник). Роли owner/admin перечислены, т.к. они тоже являются member и существуют в домене (Role: OWNER/ADMIN), но никаких особых watch-привилегий у них нет. Конфликт-резолюшн: 'last action wins' по серверному времени (updatedAt = Instant.now(), не клиентское). Состояние — единственный экземпляр на канал в Redis (ключ watch:{channelId}), TTL не выставляется (живёт до DELETE или перезаписи). MinIO нигде в watch-коде напрямую не используется — это только источник публичного URL, который передаётся как обычная http(s)-ссылка в POST /source; загрузка файлов реализована в отдельном домене storage (StorageService). Ключевые файлы: watch/WatchController.java (REST), watch/WatchWsController.java (WS control), watch/WatchService.java (бизнес-логика, Redis, валидация), watch/WatchPublisher.java (рассылка в /topic/watch.{channelId}), watch/WatchState.java, watch/WatchControl.java, watch/WatchAction.java, watch/WatchSourceRequest.java; доступ — service/AccessGuard.java; тип канала — domain/ChannelType.java._

### Админка и модерация (участники, роли, инвайты, журнал аудита, сброс пароля)  
*Роли: owner, admin, member*

- **Список участников** — GET /server/members возвращает участников с ролью, аватаром, временем входа и онлайн-статусом (online/idle/dnd/offline из presence). Доступно любому участнику.
  
  → UI: Экран/панель 'Участники сервера': список с аватаром, именем, бейджем роли (Owner/Admin/Member) и индикатором онлайн-статуса (цветная точка). У admin/owner рядом с каждой строкой — действия (кик, смена роли); видимость кнопок зависит от роли текущего пользователя.
- **Кик участника** — DELETE /members/{userId}, роль admin/owner. Нельзя кикнуть себя и нельзя кикнуть owner. Завершает все сессии исключённого (отзыв refresh-токенов).
  
  → UI: Пункт 'Исключить' в контекстном меню участника (только для admin/owner). Обязателен диалог подтверждения. Кнопку прятать/блокировать для самого себя и для строк с ролью Owner. Обрабатывать ошибки 400 (себя) и 403 (владельца) тостом.
- **Смена роли** — PATCH /members/{userId} {role}, только owner. Защита от самодемоушена и от снятия последнего владельца.
  
  → UI: Селектор роли (Owner/Admin/Member) в карточке участника, видимый только владельцу. Блокировать выбор, понижающий собственную роль, и понижение единственного owner; показывать поясняющую ошибку ('нельзя понизить последнего владельца', 'нельзя понизить себя').
- **Создание инвайта** — POST /invites с опциональными maxUses (>=1) и expiresAt. Сырой код возвращается один раз; в БД хранится только хеш.
  
  → UI: Кнопка 'Создать приглашение' (admin/owner) с формой: лимит использований (опц.) и срок действия (опц.). После создания — модалка с одноразовым показом кода/ссылки и кнопкой 'Скопировать' + предупреждение 'код больше не будет показан'.
- **Список и отзыв инвайтов** — GET /invites — метаданные без кодов (uses/maxUses, expiresAt, revoked, createdBy). DELETE /invites/{id} — отзыв с сохранением истории, идемпотентен.
  
  → UI: Таблица активных и отозванных приглашений: создатель, дата, прогресс использований (uses/maxUses), срок, статус (активен/отозван/истёк). Кнопка 'Отозвать' на активных строках; отозванные показывать как зачёркнутые/disabled. Сам код в списке недоступен — не пытаться его отрисовать.
- **Сброс пароля админом** — POST /admin/users/{userId}/reset-password возвращает одноразовый временный пароль для передачи пользователю лично.
  
  → UI: Действие 'Сбросить пароль' в админ-панели/карточке пользователя. После вызова — модалка с одноразовым показом временного пароля, кнопкой копирования и предупреждением передать его лично.
- **Журнал аудита** — GET /admin/audit?limit= (default 100, max 200) — последние действия модерации: actor, action, target, JSON-metadata, время.
  
  → UI: Экран 'Журнал аудита' (admin/owner): хронологическая лента/таблица (новейшие сверху) с колонками время, кто (actorId), действие (member.kick/member.role-change/invite.create/invite.revoke), цель (тип+id), детали (metadata, напр. новая роль). Управление количеством через limit (пагинация/'показать больше' до 200).
- **Иерархия ролей в авторизации** — OWNER получает и ROLE_OWNER, и ROLE_ADMIN — проходит admin-проверки. @PreAuthorize — лишь дешёвый предфильтр; реальная роль сверяется в AccessGuard по свежему состоянию БД (JWT живёт до 15 мин и может содержать устаревшую роль).
  
  → UI: В UI рассчитывать видимость admin-действий так, что owner = надмножество admin. Не доверять только клиентской роли: после смены роли/кика возможны 403 даже при, казалось бы, валидном токене — обрабатывать и при необходимости обновлять профиль/перелогинивать.

| метод | путь | назначение | роль |
|---|---|---|---|
| `GET` | `/server/members` | Список участников сервера: userId, username, avatarUrl, role (OWNER/ADMIN/MEMBER), status (online|idle|dnd|offline, берётся из presence; offline по умолчанию), joinedAt. Сервер на MVP один, берётся по членству вызывающего. | member |
| `DELETE` | `/members/{userId}` | Кик участника. Нельзя себя (400 Cannot remove yourself) и нельзя OWNER (403 Cannot remove an owner). При успехе гасит все refresh-токены исключённого (его сессии умирают) и пишет аудит member.kick. Ответ 204 No Content. | admin |
| `PATCH` | `/members/{userId}` | Смена роли участника. Тело RoleChangeRequest {role: OWNER|ADMIN|MEMBER}. Запрет самодемоушена (400 Cannot demote yourself, если меняешь себе роль не на OWNER). Запрет снять последнего владельца (400 Cannot demote the last owner, если цель — единственный OWNER и новая роль не OWNER). Аудит member.role-change с metadata {role}. Ответ 204 No Content. | owner |
| `POST` | `/invites` | Создать инвайт в сервере создателя. Тело InviteCreateRequest {maxUses?: int>=1 (null = без лимита), expiresAt?: Instant (null = без срока)}. Ответ 201 InviteResponse {code, expiresAt, maxUses} — сырой code отдаётся ОДИН раз (в БД только sha256-хеш). Аудит invite.create. | admin |
| `GET` | `/invites` | Список инвайтов сервера (новейшие сверху), без сырых кодов. Каждый InviteSummary: id, expiresAt, maxUses, uses (использовано), revoked, createdBy, createdAt. | admin |
| `DELETE` | `/invites/{id}` | Отозвать инвайт (revoked=true, история сохраняется, не удаляется). 404 Invite not found если чужой/нет. Идемпотентно: повторный отзыв ничего не делает. Аудит invite.revoke. Ответ 204 No Content. | admin |
| `POST` | `/admin/users/{userId}/reset-password` | Сброс пароля пользователю админом. Ответ TempPasswordResponse {temporaryPassword} — временный пароль показывается один раз, передать пользователю лично. Аудит пишется атомарно внутри сброса. | admin |
| `GET` | `/admin/audit` | Журнал аудита (новейшие сверху). Query limit? (по умолчанию 100, максимум 200, минимум 1). Каждый AuditLogResponse: id, actorId, action (напр. member.kick / member.role-change / invite.create / invite.revoke), targetType (user|invite), targetId, metadata (вложенный JSON, напр. {role} при смене роли), createdAt. | admin |

_Домен полностью REST — WebSocket-эндпоинтов в админке/модерации НЕТ (kick, смена роли, инвайты и аудит не публикуют WS-событий). Поле MemberResponse.status обогащается из presence-сервиса, но /server/members — это REST-снимок, а живые обновления онлайн-статуса идут через чужой домен presence (/topic/presence). Rate-limit на admin/member/invite-эндпоинты НЕ навешен: RateLimiter (Redis fixed-window) применяется только в auth (login/register/refresh), media (presign) и messaging (send/react), не в этом домене. Аудит пишется в той же транзакции, что и само действие (атомарно); metadata хранится как jsonb и отдаётся клиенту как вложенный JSON (@JsonRawValue), а не как строка. Сервер на MVP единственный — членство вызывающего определяет целевой сервер во всех операциях. Ключевые файлы: web/AdminController.java, web/MemberController.java, web/InviteController.java, service/MemberService.java, service/InviteService.java, service/AuditLogService.java, service/AccessGuard.java, security/JwtAuthFilter.java; DTO — web/dto/MemberResponse.java, RoleChangeRequest.java, InviteCreateRequest.java, InviteResponse.java, InviteSummary.java, AuditLogResponse.java, TempPasswordResponse.java; домен — domain/Role.java, domain/AuditLog.java._

### Личные сообщения (DM)  
*Роли: member*

- **Открыть/получить диалог 1-на-1** — POST /dm/{userId} — открывает или возвращает существующий личный диалог. Ответ DmResponse {channelId, otherUserId, otherUsername, otherAvatarUrl, lastMessageId}. DM реализован поверх обычного Channel — после открытия сообщения шлются через стандартный /channels/{channelId}/messages.
  
  → UI: Кнопка «Написать» из профиля/списка участников → POST /dm/{userId} → открыть channelId в обычной ленте (переиспользуем окно текстового канала).
- **Список моих диалогов** — GET /dm — List<DmResponse> моих личных диалогов (channelId, собеседник id/username/avatarUrl, lastMessageId).
  
  → UI: Раздел «Личные сообщения»: список диалогов (аватар+имя собеседника, индикатор непрочитанного по lastMessageId vs read-state).

| метод | путь | назначение | роль |
|---|---|---|---|
| `POST` | `/dm/{userId}` | открыть/получить личный диалог | member |
| `GET` | `/dm` | список моих диалогов | member |

WS:
- _subscribe_ `/topic/channel.{channelId}` — MESSAGE_CREATED/EDITED/DELETED для DM-канала (тот же механизм, что у обычных каналов) (когда: realtime в личке)

_DM использует ту же машинерию сообщений/реакций/вложений/read-state. Отдельного «статуса диалога» нет._

## 2. Окна (16)

### `win-login` — Вход
приоритет: **core**

Аутентификация существующего пользователя по username/email + пароль. Единственная точка входа в систему (публичная регистрация отсутствует, первый owner заводится через env).

- Фичи: Логин по username или email
- API: `POST /auth/login`, `POST /auth/refresh`
- Элементы:
    - Логотип/название chazhland по центру
    - Одно поле 'Имя пользователя или email' (НЕ два раздельных)
    - Поле 'Пароль' с кнопкой показать/скрыть
    - Основная кнопка 'Войти' (со спиннером загрузки)
    - Ссылка-переключатель 'У меня есть инвайт-код → Регистрация'
    - Инлайн-зона ошибки: общая 'неверные данные' для 401 и 'слишком много попыток' для 429
    - Чекбокс 'Запомнить меня' (опционально)

**Промпт:**

> Спроектируй экран входа десктопного мессенджера chazhland (Electron, Windows, тёмная тема в стиле Discord). Центрированная карточка ~420px на тёмном фоне. Сверху логотип и название 'chazhland'. Внутри карточки заголовок 'С возвращением', затем ОДНО текстовое поле с подписью 'Имя пользователя или e-mail', ниже поле 'Пароль' с иконкой-глазом. Под полями крупная акцентная кнопка 'Войти' во всю ширину (показать состояние загрузки со спиннером). Под кнопкой строка ошибки: покажи общую 'Неверные данные' и состояние превышения лимита попыток 'Слишком много попыток входа, попробуйте позже' с серой подсказкой подождать. Внизу карточки текст-ссылка 'Есть инвайт-код? Зарегистрироваться'. Без кнопок соцсетей, без 'создать сервер'. Тёмная палитра #1e1f22/#2b2d31, акцент сине-фиолетовый, скруглённые поля и кнопки.

### `win-register` — Регистрация по инвайту
приоритет: **core**

Создание аккаунта по инвайт-коду; после успеха пользователь сразу залогинен (получает пару токенов), отдельного входа не требуется.

- Фичи: Регистрация по инвайт-коду
- API: `POST /auth/register`
- Элементы:
    - Поле 'Инвайт-код' (обязательное, на первом месте)
    - Поле 'Имя пользователя' (валидация 3-32)
    - Поле 'E-mail' (валидный, до 255)
    - Поле 'Пароль' (8-100) с индикатором требований
    - Кнопка 'Создать аккаунт'
    - Раздельные сообщения ошибок: невалидный/исчерпанный/отозванный инвайт, занятый username (409), занятый email (409)
    - Ссылка 'Уже есть аккаунт? Войти'
    - Подсказка: 'Регистрация возможна только по приглашению'

**Промпт:**

> Спроектируй экран регистрации по инвайт-коду для десктопного мессенджера chazhland (Electron/Windows, тёмная тема в стиле Discord). Центрированная карточка ~440px. Заголовок 'Создать аккаунт' и подзаголовок-подсказка серым 'Регистрация только по приглашению'. Поля сверху вниз: 'Инвайт-код' (первым, моноширинный плейсхолдер), 'Имя пользователя' (под полем мелким серым подсказка '3–32 символа'), 'E-mail', 'Пароль' (подсказка '8–100 символов' + лёгкий индикатор силы/требований). Крупная акцентная кнопка 'Создать аккаунт' во всю ширину со спиннером. Покажи примеры инлайн-ошибок под конкретными полями: под кодом — 'Инвайт недействителен, отозван или исчерпан', под именем — 'Имя уже занято', под email — 'E-mail уже зарегистрирован'. Внизу ссылка 'Уже есть аккаунт? Войти'. Тёмная палитра, скруглённые поля, акцент сине-фиолетовый.

### `win-main-app` — Главное окно приложения (рамка)
приоритет: **core**

Каркас десктоп-клиента: трёхколоночный layout как Discord — список голосовых/панель сервера, сайдбар каналов с деревом категорий, центральная область канала, правая панель участников. Включает кастомный titlebar Windows.

- Фичи: Дерево сервера (категории + каналы), Типы каналов TEXT / VOICE / WATCH, Счётчики непрочитанного и упоминаний, Синхронизация настроек уведомлений между устройствами
- API: `GET /server/tree`, `GET /read-states`, `GET /notification-settings`, `GET /presence`, `STOMP CONNECT /ws`, `SUBSCRIBE /topic/presence`, `SUBSCRIBE /user/queue/errors`
- Элементы:
    - Кастомный titlebar Windows (название сервера, кнопки свернуть/развернуть/закрыть)
    - Левый узкий столбец: иконка сервера сверху, внизу аватар текущего пользователя с индикатором статуса
    - Сайдбар каналов: имя сервера в шапке (кнопка-меню настроек сервера для owner/admin), дерево категорий-аккордеонов и каналов с иконками по типу (#, динамик, экран)
    - Бейджи непрочитанного (точка) и счётчики упоминаний (число) у каналов; иконки mute/только-упоминания
    - Группа 'Без категории' для каналов с categoryId=null
    - Кнопки '+' для создания канала/категории (только owner/admin)
    - Нижняя панель пользователя в сайдбаре: аватар, имя, статус-сообщение, кнопки микрофона/настроек/статуса
    - Центральная область — контейнер активного канала (контент зависит от типа)
    - Правая панель участников (сворачиваемая)
    - Индикатор состояния WS-соединения

**Промпт:**

> Спроектируй главное окно десктопного мессенджера chazhland (Electron на Windows, тёмная тема, layout как Discord, кастомный titlebar). Сверху тонкий кастомный titlebar с названием сервера слева и системными кнопками свернуть/развернуть/закрыть справа (стиль Windows). Под ним трёх-четырёхколоночный layout: (1) узкий левый столбец ~72px с круглой иконкой сервера сверху (один сервер) и аватаром текущего пользователя с цветной точкой статуса внизу; (2) сайдбар каналов ~240px: шапка с именем сервера и шевроном-меню (для admin/owner), ниже дерево — заголовки категорий-аккордеонов (uppercase, со стрелкой сворачивания и плюсом для admin/owner), под ними каналы с иконкой по типу: '#' для TEXT, иконка динамика для VOICE, иконка экрана для WATCH; у каналов с непрочитанным — белый жирный текст и точка слева, у каналов с упоминаниями — красный бейдж с числом справа, у замьюченных — приглушённый цвет и иконка колокольчика-mute; внизу группа 'Без категории'; в самом низу панель пользователя с аватаром, именем, статус-сообщением и иконками микрофон/наушники/шестерёнка; (3) центральная широкая область с шапкой канала (имя, тема) и плейсхолдером ленты; (4) правая панель участников ~240px (сворачиваемая) со списком имён и точками статуса. Покажи маленький индикатор состояния соединения. Палитра #1e1f22 (фон сервера), #2b2d31 (сайдбар), #313338 (центр), акцент сине-фиолетовый, цвета статусов: зелёный/жёлтый/красный/серый.

### `win-text-channel` — Текстовый канал (лента сообщений)
приоритет: **core**

Основной экран общения: лента сообщений с бесконечным скроллом, отправка с вложениями/ответами/упоминаниями, правка/удаление, реакции, индикатор печати, поиск, закреплённые.

- Фичи: Отправка сообщения, Идемпотентная (оптимистичная) отправка по clientMessageId, Курсорная пагинация по ULID, Дельта-догон changesSince, Правка сообщения, Soft-delete / tombstone, Упоминания @user, Read-state (отметка прочитанного), Realtime-рассылка по каналу (WebSocket/STOMP), Индикатор «печатает…» (TYPING), Агрегаты реакций и список вложений в ответах сообщений, Добавление реакции эмодзи (idempotent), Снятие реакции эмодзи (idempotent), Presign-загрузка вложений, Broadcast закрепления/открепления (MESSAGE_PINNED/UNPINNED)
- API: `GET /channels/{id}`, `GET /channels/{channelId}/messages`, `GET /channels/{channelId}/messages/changes`, `POST /channels/{channelId}/messages`, `PATCH /messages/{messageId}`, `DELETE /messages/{messageId}`, `PUT /channels/{channelId}/read-state`, `POST /attachments/presign`, `POST /messages/{messageId}/reactions`, `DELETE /messages/{messageId}/reactions?emoji=`, `PUT /messages/{messageId}/pin`, `DELETE /messages/{messageId}/pin`, `GET /channels/{channelId}/pins`, `GET /channels/{channelId}/messages/search`, `SUBSCRIBE /topic/channel.{channelId}`, `SEND /app/channel.{channelId}.typing`
- Элементы:
    - Шапка канала: # имя, тема (topic) подзаголовком, иконки 'закреплённые', 'поиск', 'настройки уведомлений', 'участники'
    - Лента сообщений сгруппированная по автору: аватар, имя, время, текст, '(изменено)' при editedAt
    - Бесконечный скролл вверх (before) и догрузка вниз (after), индикатор загрузки, сохранение позиции скролла
    - Разделитель 'Новые сообщения' по lastReadMessageId
    - Цитата-ответ над сообщением при replyToId
    - Вложения: превью картинок (с width/height/thumbnailUrl), видео/аудио-плееры, карточки PDF/ZIP/txt со ссылкой скачать
    - Чипы реакций (emoji + количество, подсветка если реагировал я) — тоггл по клику; кнопка '+' добавить реакцию (emoji-picker)
    - Ховер-меню сообщения: реакция, ответить, редактировать (своё), закрепить, удалить (своё всем; чужое только admin/owner)
    - Tombstone-плашка 'Сообщение удалено' для удалённых
    - Композер внизу: поле ввода (лимит 4000 со счётчиком), скрепка/drag-and-drop для вложений (до 10, с прогрессом аплоада в MinIO), превью прикреплённых, кнопка отправки
    - Автокомплит @username при вводе @ (плюс спец-пункты @everyone — все, @here — только онлайн); подсветка всех упоминаний выделенной плашкой
    - Индикатор '{username} печатает…' под композером
    - Оптимистичный статус 'отправляется' у только что отправленного сообщения
    - Inline-редактор для правки своего сообщения

**Промпт:**

> Спроектируй экран текстового канала десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord). Сверху шапка канала: '# название-канала' жирным, рядом серым тема канала (topic), справа иконки — булавка (закреплённые), лупа (поиск), колокольчик (настройки уведомлений), люди (свернуть/развернуть участников). Центр — лента сообщений, сгруппированная по автору: круглый аватар, имя цветом роли, время мелким серым, текст; у изменённых — серая пометка '(изменено)'; покажи разделитель-черту 'Новые сообщения' красным. Один пример сообщения с цитатой-ответом (свёрнутая строка с автором и фрагментом сверху). Покажи разные вложения: картинку с фиксированными пропорциями, видео-плеер, аудио-дорожку, карточку файла PDF со скрепкой и кнопкой скачать. Под сообщениями — ряд чипов-реакций: эмодзи + число, один чип подсвечен (я реагировал), плюс кнопка '+' для добавления. На ховере сообщения справа всплывающее мини-меню: эмодзи-реакция, стрелка-ответить, карандаш-редактировать, булавка-закрепить, корзина-удалить. Покажи одну tombstone-плашку 'Сообщение удалено' приглушённым курсивом. Внизу — композер: широкое поле ввода с плейсхолдером 'Написать в #канал', слева кнопка-скрепка (+), внутри превью двух прикреплённых файлов с прогресс-баром и крестиком, справа счётчик '0/4000' и кнопка отправки; покажи всплывающий автокомплит @упоминаний над полем и строку '{имя} печатает…' с анимированными точками над композером. Одно сообщение покажи в состоянии inline-редактирования (поле с текстом и подсказкой 'Esc отменить • Enter сохранить'). Тёмная палитра #313338 для ленты, акцент сине-фиолетовый.

### `win-voice-channel` — Голосовой канал (звонок + демонстрация экрана)
приоритет: **core**

Экран активного голосового канала: подключение через LiveKit-токен, участники звонка, управление микрофоном, демонстрация экрана / Go Live, выход.

- Фичи: Выдача access-токена голосового канала, Go Live / демонстрация экрана (screenshare), WS-уведомления о входе/выходе из голосового канала, Начальный снимок присутствия (кто в каких голосовых)
- API: `POST /livekit/token`, `GET /presence`, `SUBSCRIBE /topic/presence (VOICE_UPDATE)`
- Элементы:
    - Заголовок голосового канала и кнопка 'Подключиться'/'Войти в звонок' (до входа)
    - Сетка участников звонка: аватары/имена, индикаторы говорит/заглушён, рамка активного спикера
    - Тайлы демонстрации экрана участников (видео), индикатор 'идёт демонстрация'
    - Нижняя панель управления звонком: микрофон mute/unmute, наушники, 'Демонстрация экрана / Go Live' и остановка, 'Отключиться'
    - Лимит участников (userLimit) и счётчик 'X в голосовом'
    - Состояние 'подключение…' при инициализации LiveKit-клиента
    - Текстовый чат канала-спутник (если применимо) или плейсхолдер

**Промпт:**

> Спроектируй экран голосового канала десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord). Сверху шапка с иконкой динамика и именем голосового канала, справа счётчик 'участников: 3 / лимит 10'. Покажи ДВА состояния: (1) до входа — крупная центральная карточка с иконкой звонка, текстом 'Голосовой канал' и большой акцентной кнопкой 'Войти в звонок' плюс мелким списком 'Сейчас в канале' с аватарами; (2) активный звонок — тёмная сцена с сеткой тайлов участников: квадратные карточки с круглым аватаром по центру, именем внизу, зелёной рамкой у активного спикера и иконкой перечёркнутого микрофона у заглушённых; один большой тайл — демонстрация экрана с меткой 'Аня демонстрирует экран'. Снизу по центру плавающая панель управления (pill-бар) с круглыми кнопками: микрофон (mute/unmute, перечёркнутый = выкл), наушники, кнопка 'Демонстрация экрана' (иконка монитора), и красная кнопка 'Отключиться' (трубка). Покажи также состояние 'Подключение…' со спиннером. Тёмная палитра #1e1f22, акцент сине-фиолетовый, активный спикер — зелёная обводка, красная кнопка выхода.

### `win-watch-channel` — Watch-канал (совместный просмотр)
приоритет: **core**

Кинозал: синхронизированный видеоплеер с управлением play/pause/seek по WS, выбор источника по URL, остановка, отображение хоста и последнего действия.

- Фичи: Канал типа WATCH, Единое синхронизированное состояние просмотра, Источник: внешний URL или файл из MinIO, Управление воспроизведением по WebSocket (play/pause/seek), Рассылка состояния подписчикам канала, Право управления: любой участник канала, Снимок состояния и остановка просмотра
- API: `GET /channels/{channelId}/watch`, `POST /channels/{channelId}/watch/source`, `DELETE /channels/{channelId}/watch`, `SEND /app/watch.{channelId}.control`, `SUBSCRIBE /topic/watch.{channelId}`, `POST /attachments/presign`
- Элементы:
    - Большой видеоплеер с программным управлением (play/pause/seek извне)
    - Кастомная панель плеера: play/pause, seek-бар, текущая позиция/длительность, громкость, фуллскрин
    - Плашка 'кто инициировал' (lastActionBy), например 'Аня перемотала' и метка хоста (hostId)
    - Состояние 'нет источника' (204): форма 'Указать источник' с полем URL (http(s), до 2048) + кнопка 'Загрузить файл'/'Выбрать из загруженных'
    - Кнопка 'Остановить просмотр' (DELETE, для всех)
    - Логика синхронизации дрейфа (позиция = positionSeconds + (now - updatedAt))
    - Список участников кинозала сбоку (опционально)
    - Сообщение об ошибке из /user/queue/errors ('No video loaded')

**Промпт:**

> Спроектируй экран watch-канала (совместный просмотр / кинозал) десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord). Сверху шапка с иконкой экрана и именем watch-канала. Покажи ДВА состояния: (1) нет источника (HTTP 204) — тёмный плеер-плейсхолдер с иконкой плёнки и центральной карточкой 'Укажите источник': поле ввода URL с плейсхолдером 'https://… mp4 или HLS', кнопка 'Загрузить' и второстепенная кнопка 'Загрузить файл / выбрать из хранилища'; (2) идёт просмотр — крупный видеоплеер во всю ширину с кастомной нижней панелью управления: кнопка play/pause, тонкий seek-бар с заполнением, тайминг '12:30 / 1:45:00', громкость, фуллскрин. Над панелью справа маленькая плашка 'Аня перемотала' (lastActionBy) и метка 'хост: Миша'. В правом верхнем углу плеера кнопка 'Остановить просмотр' (для всех). Сбоку компактный список участников кинозала с аватарами. Покажи также состояние тоста-ошибки 'Видео не загружено'. Подчеркни, что управление доступно любому участнику (нет блокировки кнопок). Тёмная палитра, акцент сине-фиолетовый, плеер на почти чёрном фоне.

### `win-members-panel` — Панель участников сервера
приоритет: **core**

Правая колонка / отдельный экран со списком участников: аватар, имя, роль, онлайн-статус; для owner/admin — действия модерации (кик, смена роли) и переход в профиль участника.

- Фичи: Список участников, Онлайн-статусы участников (online / idle / dnd / offline), Рассылка изменений присутствия (дельты) по WS, Иерархия ролей в авторизации, Кик участника, Смена роли
- API: `GET /server/members`, `GET /presence`, `SUBSCRIBE /topic/presence (PRESENCE_UPDATE)`, `DELETE /members/{userId}`, `PATCH /members/{userId}`
- Элементы:
    - Список участников, сгруппированный по статусу/роли: аватар, имя, бейдж роли (Owner/Admin/Member), цветная точка статуса (зелёный/жёлтый/красный/серый)
    - Индикатор 'в голосовом канале' рядом с именем
    - Контекстное меню по правому клику/ховеру (только owner/admin): 'Профиль', 'Изменить роль', 'Исключить' (кик)
    - Кнопки модерации скрыты для member и для строк с owner / самого себя
    - Realtime-обновление статусов без перезагрузки
    - Поиск/фильтр по списку (опционально)

**Промпт:**

> Спроектируй правую панель участников сервера десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord), ширина ~240px. Сверху заголовок 'Участники — 8'. Список сгруппирован по ролям/статусу: секции 'Онлайн' и 'Не в сети'. Каждая строка: круглый аватар с маленькой цветной точкой статуса в углу (зелёный online, жёлтый idle, красный dnd, серый offline), имя, справа компактный бейдж роли — 'OWNER' (золотой), 'ADMIN' (синий), без бейджа у member; у тех, кто в голосовом канале — мелкая иконка динамика. Покажи всплывающее контекстное меню (по клику) для admin/owner с пунктами 'Профиль', 'Изменить роль ▸' и красным 'Исключить'; для строки с ролью Owner и для самого себя пункты кика/смены роли отсутствуют/задизейблены. Тёмная палитра #2b2d31, hover-подсветка строк, акцент сине-фиолетовый, цвета статусов стандартные.

### `win-profile-settings` — Настройки: Мой аккаунт и профиль
приоритет: **core**

Просмотр и редактирование собственного профиля, аватара, статус-сообщения; смена пароля, выход на всех устройствах.

- Фичи: Просмотр своего профиля, Редактирование профиля, Загрузка аватара (только растровые), Смена пароля, Выход со всех устройств, Logout (выход с текущего устройства)
- API: `GET /users/me`, `PATCH /users/me`, `PUT /users/me/avatar`, `POST /attachments/presign`, `PUT /users/me/password`, `POST /users/me/logout-all`, `POST /auth/logout`
- Элементы:
    - Карточка профиля: аватар (с кнопкой 'Изменить'), username, e-mail (read-only), бейдж роли, статус-сообщение
    - Кнопка/контрол загрузки аватара: accept только image/png|jpeg|gif|webp, прогресс прямого PUT в MinIO, ошибки 'не растровое'/'превышен размер'
    - Форма редактирования: username (3-32, обработка 409 'занято'), статус-сообщение (<=255, можно очистить)
    - Секция 'Безопасность': форма смены пароля (текущий + новый 8-100 + подтверждение, предупреждение 'разлогинит на всех устройствах', обработка 400 'неверный текущий пароль')
    - Кнопка 'Выйти на всех устройствах' (logout-all)
    - Кнопка 'Выйти' (текущее устройство)

**Промпт:**

> Спроектируй экран настроек 'Мой аккаунт' десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord) — полноэкранный оверлей настроек с левым меню-навигацией ('Моя учётная запись', 'Профиль', 'Безопасность', 'Уведомления') и правой областью контента. На вкладке профиля сверху баннер-карточка с крупным круглым аватаром (по ховеру кнопка 'Изменить аватар'), рядом username и e-mail (e-mail помечен серым как нередактируемый) и бейдж роли. Ниже форма: поле 'Имя пользователя' с подсказкой '3–32' и примером ошибки 'Имя уже занято' под полем; поле 'Статус-сообщение' (textarea, '<=255', с подсказкой 'оставьте пустым, чтобы очистить'); кнопка 'Сохранить изменения'. Контрол аватара покажи с состоянием загрузки (прогресс-бар) и сообщением об ошибке 'Только PNG, JPEG, GIF или WebP'. Отдельная секция 'Безопасность': подформа смены пароля (три поля: текущий, новый '8–100', повтор) с жёлтым предупреждением 'После смены вы выйдете на всех устройствах' и примером ошибки 'Текущий пароль неверен'; ниже две кнопки — серая 'Выйти на всех устройствах' и обычная 'Выйти'. Тёмная палитра, скруглённые поля, акцент сине-фиолетовый.

### `win-notification-settings` — Настройки уведомлений по каналам
приоритет: **secondary**

Просмотр и изменение уровня уведомлений (ALL/MENTIONS/MUTED) для каждого канала; синхронизация между устройствами.

- Фичи: Настройки уведомлений по каналам (all/mentions/muted), Синхронизация настроек уведомлений между устройствами
- API: `GET /notification-settings`, `PUT /channels/{channelId}/notification-setting`, `GET /server/tree`
- Элементы:
    - Список всех каналов сервера (из дерева) с текущим уровнем уведомлений
    - Переключатель из трёх вариантов на канал: 'Все сообщения' / 'Только упоминания' / 'Без звука (mute)'
    - Иконки mute/упоминаний у каналов без явной настройки трактуются дефолтом
    - Группировка по категориям
    - Кнопка сброса к дефолту (опционально)

**Промпт:**

> Спроектируй вкладку 'Уведомления' в настройках десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord). Это список всех каналов сервера, сгруппированный по категориям (заголовки категорий uppercase). Каждая строка канала: иконка типа и имя слева, справа сегментированный переключатель из трёх кнопок — 'Все', 'Упоминания', 'Без звука' (активный сегмент подсвечен акцентом). У каналов 'Без звука' имя приглушённое с иконкой колокольчика-mute. Сверху пояснительная строка серым 'Каналы без явной настройки используют уровень по умолчанию (Все сообщения)'. Тёмная палитра #313338, сегментированные контролы со скруглением, акцент сине-фиолетовый.

### `win-admin-members` — Админка: Участники и роли
приоритет: **secondary**

Управление участниками для owner/admin: список с ролями и статусами, кик, смена роли, переход к сбросу пароля. Owner-only — смена роли; admin+ — кик.

- Фичи: Список участников, Кик участника, Смена роли, Сброс пароля админом, Иерархия ролей в авторизации
- API: `GET /server/members`, `DELETE /members/{userId}`, `PATCH /members/{userId}`, `POST /admin/users/{userId}/reset-password`, `GET /presence`
- Элементы:
    - Таблица участников: аватар, имя, роль (селектор для owner), статус, дата входа (joinedAt)
    - Действия в строке (по роли): 'Изменить роль' (owner; блокировка самодемоушена и снятия последнего owner), 'Исключить' (admin/owner; скрыто для себя и owner), 'Сбросить пароль' (admin/owner)
    - Обработка ошибок тостами: 400 'нельзя себя', 403 'нельзя владельца', 400 'нельзя понизить последнего владельца'
    - Поиск/фильтр участников
    - Раздел доступен только owner/admin (member не видит вкладку)

**Промпт:**

> Спроектируй админ-вкладку 'Участники' в настройках сервера chazhland (Electron/Windows, тёмная тема, как Discord), доступную только owner/admin. Таблица/список участников с колонками: аватар+имя, селектор роли (выпадающий 'Owner / Admin / Member', доступен только владельцу; для member роль показана статичным бейджем), цветная точка статуса, дата входа 'на сервере с 12 мар 2026', и колонка действий с иконками — 'Сбросить пароль' (ключ), 'Исключить' (красный крест). Покажи, что для строки самого себя и для владельца действия кика отключены/скрыты; для последнего владельца селектор роли заблокирован с тултипом 'Нельзя понизить последнего владельца'. Сверху строка поиска участников и счётчик. Покажи пример тоста-ошибки сверху 'Нельзя исключить владельца'. Тёмная палитра, акцентные бейджи ролей (золото/синий), скруглённые элементы.

### `win-admin-invites` — Админка: Приглашения (инвайты)
приоритет: **secondary**

Управление инвайт-кодами для owner/admin: создание, список с прогрессом использований и статусами, отзыв. Сырой код показывается один раз при создании.

- Фичи: Создание инвайт-кода, Список инвайтов сервера, Отзыв инвайта, Список и отзыв инвайтов
- API: `GET /invites`, `POST /invites`, `DELETE /invites/{id}`
- Элементы:
    - Кнопка 'Создать приглашение' (открывает модалку)
    - Таблица инвайтов (новейшие сверху): создатель (createdBy), дата (createdAt), прогресс 'uses/maxUses' (или '∞'), срок (expiresAt или 'бессрочно'), статус (вычисляется: активен/отозван/исчерпан/просрочен)
    - Кнопка 'Отозвать' у активных строк; отозванные — зачёркнуты/disabled
    - Сами коды в списке не показываются (только хеши в БД)
    - Раздел только для owner/admin

**Промпт:**

> Спроектируй админ-вкладку 'Приглашения' в настройках сервера chazhland (Electron/Windows, тёмная тема, как Discord), для owner/admin. Сверху заголовок 'Приглашения' и справа акцентная кнопка '+ Создать приглашение'. Ниже таблица: колонки 'Создал' (аватар+имя), 'Создано' (дата), 'Использовано' (прогресс-пилюля '3 / 10' или '5 / ∞'), 'Истекает' (дата или 'Бессрочно'), 'Статус' (цветной чип: зелёный 'Активен', серый 'Отозван', оранжевый 'Просрочен', серый 'Исчерпан'), и колонка действий с красной кнопкой 'Отозвать' только у активных. Отозванные/просроченные строки приглушены, кнопка отозвать у них отсутствует. Подчеркни серой подсказкой 'Сам код виден только в момент создания'. Тёмная палитра, цветные чипы статусов, акцент сине-фиолетовый.

### `win-admin-audit` — Админка: Журнал аудита
приоритет: **secondary**

Хронологическая лента действий модерации для owner/admin: кто, что, над кем, детали, когда.

- Фичи: Журнал аудита
- API: `GET /admin/audit`
- Элементы:
    - Хронологическая таблица/лента (новейшие сверху): время (createdAt), актор (actorId → имя), действие (member.kick / member.role-change / invite.create / invite.revoke), цель (targetType + targetId), детали (metadata JSON, напр. новая роль)
    - Управление количеством через limit (по умолчанию 100, макс 200): 'Показать больше'
    - Цветовые/иконочные маркеры типов действий
    - Раздел только для owner/admin

**Промпт:**

> Спроектируй админ-вкладку 'Журнал аудита' в настройках сервера chazhland (Electron/Windows, тёмная тема, как Discord), для owner/admin. Хронологическая лента (новейшие сверху), каждая запись — строка с иконкой-маркером действия слева (кик — красный человек-минус, смена роли — синяя стрелка, создание инвайта — зелёный плюс, отзыв инвайта — серый замок), текстом 'Миша исключил Аню', мелким серым типом и id цели ('user · 01HX…'), раскрывающимся блоком деталей metadata (например 'роль: ADMIN', моноширинным JSON) и временем справа '14:32, 16 июн'. Внизу кнопка 'Показать больше' (увеличивает limit до 200). Сверху фильтр-чипы по типу действия (опционально). Тёмная палитра, разделители между записями, акцент сине-фиолетовый.

### `win-server-settings` — Настройки сервера (название, иконка)
приоритет: **secondary**

Owner-only: переименование сервера и установка иконки сервера через загрузку изображения.

- Фичи: Переименование сервера, Иконка сервера
- API: `PATCH /server`, `PUT /server/icon`, `POST /attachments/presign`, `GET /server/tree`
- Элементы:
    - Поле 'Название сервера' (NotBlank, до 100) с кнопкой 'Сохранить' (после 204 фронт сам обновляет заголовок)
    - Загрузчик иконки: превью-кружок, кнопка 'Загрузить', прогресс PUT в MinIO, верификация изображения (URL перечитать из /server/tree)
    - Видно только owner
    - Состояния загрузки/ошибки

**Промпт:**

> Спроектируй вкладку 'Обзор сервера' в настройках chazhland (Electron/Windows, тёмная тема, как Discord), доступную только владельцу. Слева крупный круглый загрузчик иконки сервера: текущая иконка-превью, по ховеру оверлей 'Изменить', под ним подпись 'Минимум рекомендуется 512×512, PNG/JPEG/GIF/WebP' и состояние прогресса загрузки. Справа поле 'Название сервера' (с подсказкой 'до 100 символов') и кнопка 'Сохранить'. Внизу — плавающая панель 'Есть несохранённые изменения • Сбросить / Сохранить'. Тёмная палитра, акцент сине-фиолетовый, скруглённые поля.

### `win-channel-search-results` — Поиск по каналу (результаты)
приоритет: **secondary**

Панель результатов текстового поиска внутри канала по запросу q.

- Фичи: Отправка сообщения
- API: `GET /channels/{channelId}/messages/search`, `SUBSCRIBE /topic/channel.{channelId}`
- Элементы:
    - Поле ввода запроса (q) в шапке/правой панели
    - Список найденных сообщений: автор, время, фрагмент с подсветкой совпадения, кнопка 'Перейти к сообщению' (скролл в ленте)
    - Состояние 'ничего не найдено' и 'пустой запрос'
    - Закрытие панели возвращает к ленте

**Промпт:**

> Спроектируй панель результатов поиска внутри текстового канала chazhland (Electron/Windows, тёмная тема, как Discord) — выезжающая справа панель ~360px поверх/рядом с лентой. Сверху поле ввода с лупой и плейсхолдером 'Поиск в #канал' и крестиком закрыть. Ниже счётчик 'Найдено: 12' и список карточек результатов: круглый аватар автора, имя, дата, фрагмент текста с жёлтой подсветкой совпавших слов, по клику — 'перейти к сообщению'. Покажи пустое состояние с иконкой лупы и текстом 'Ничего не найдено'. Тёмная палитра #2b2d31, подсветка совпадений, акцент сине-фиолетовый.

### `win-pinned-messages` — Закреплённые сообщения канала
приоритет: **secondary**

Поповер/панель со списком закреплённых сообщений канала с возможностью перейти и открепить.

- Фичи: Broadcast закрепления/открепления (MESSAGE_PINNED/UNPINNED), Агрегаты реакций и список вложений в ответах сообщений
- API: `GET /channels/{channelId}/pins`, `DELETE /messages/{messageId}/pin`, `SUBSCRIBE /topic/channel.{channelId}`
- Элементы:
    - Список закреплённых сообщений: автор, время, текст/вложения
    - Кнопка 'Перейти к сообщению' и 'Открепить' (для имеющих доступ)
    - Realtime-обновление при MESSAGE_PINNED/UNPINNED
    - Пустое состояние 'Нет закреплённых сообщений'

**Промпт:**

> Спроектируй поповер 'Закреплённые сообщения' канала chazhland (Electron/Windows, тёмная тема, как Discord) — выпадающая панель ~420px из иконки-булавки в шапке канала. Заголовок 'Закреплённые' и крестик. Список карточек: аватар автора, имя, дата, текст сообщения (и миниатюра вложения если есть), по ховеру иконки 'Перейти' и 'Открепить' (крест). Покажи пустое состояние с иконкой булавки и текстом 'В этом канале пока нет закреплённых сообщений'. Тёмная карточная панель с тенью, акцент сине-фиолетовый.

### `win-dm-list` — Личные сообщения (список диалогов)
приоритет: **secondary**

Список личных диалогов 1-на-1 и переход в переписку

- Фичи: Список моих диалогов, Открыть/получить диалог 1-на-1
- API: `GET /dm`, `POST /dm/{userId}`, `GET /channels/{channelId}/messages`, `/topic/channel.{channelId}`
- Элементы:
    - список диалогов: аватар собеседника + presence-точка + имя + индикатор непрочитанного
    - сортировка по последней активности (lastMessageId)
    - поле поиска по людям
    - пустое состояние «Диалогов пока нет»
    - состояние загрузки (скелетоны)
    - клик → открыть ленту переписки (переиспользует окно текстового канала)

**Промпт:**

> Экран «Личные сообщения» десктоп-мессенджера (тёмная тема, как Discord). Слева вместо списка каналов — вертикальный список личных диалогов: у каждого аватар собеседника с presence-точкой (online/idle/dnd), имя, индикатор непрочитанного. Сверху заголовок «Личные сообщения» и поле поиска по людям. Выбранный диалог открывает справа обычную ленту переписки 1-на-1 (те же бабблы, композер, реакции, вложения, что и в канале). Состояния: загрузка списка (скелетоны), пустое «Здесь пока нет диалогов — начните из профиля участника». Вход в новый диалог — кнопка «Написать» в профиле участника.

## 3. Модалки (14)

### `modal-create-channel` — Создать канал

Форма создания нового канала: тип (TEXT/VOICE/WATCH), имя, категория, тема, лимит участников. Только owner/admin.

- Фичи: Создание канала, Типы каналов TEXT / VOICE / WATCH
- Элементы:
    - Селектор типа из трёх вариантов: TEXT (#), VOICE (динамик), WATCH (экран) — каждый с иконкой и описанием
    - Поле 'Имя канала' (NotBlank, до 100)
    - Выпадающий список 'Категория' (существующие + 'Без категории')
    - Поле 'Тема' (topic, до 1024, опционально)
    - Поле 'Лимит участников' (число, опционально — актуально для VOICE/WATCH)
    - Кнопки 'Отмена' / 'Создать канал'

**Промпт:**

> Спроектируй модальное окно 'Создать канал' десктопного мессенджера chazhland (Electron/Windows, тёмная тема, как Discord). По центру тёмная карточка ~440px. Заголовок 'Создать канал'. Сверху выбор типа канала — три выбираемых строки-радио с иконкой, названием и описанием: '# Текстовый — сообщения и файлы', 'Голосовой — общение и демонстрация экрана', 'Совместный просмотр — синхронный видеоплеер'; выбранная подсвечена акцентом. Ниже поле 'Название канала' (с '#'-префиксом для текстового, до 100), выпадающий список 'Категория' (с опцией 'Без категории'), поле 'Тема канала' (до 1024, опционально), и поле 'Лимит участников' (число, показывать выделенно для голосового/watch). Внизу справа кнопки 'Отмена' (текстовая) и акцентная 'Создать канал'. Тёмная палитра, скруглённые поля, акцент сине-фиолетовый.

### `modal-edit-channel` — Настройки канала

Редактирование канала: имя, категория, тема, лимит (полная замена полей; тип read-only). Удаление канала. Owner/admin.

- Фичи: Редактирование канала, Удаление канала
- Элементы:
    - Тип канала read-only (нельзя менять)
    - Поле 'Имя' (NotBlank, до 100)
    - Выпадающий 'Категория' (включая 'Без категории')
    - Поле 'Тема' (до 1024)
    - Поле 'Лимит участников'
    - Кнопка 'Сохранить' (шлёт ВСЕ поля)
    - Кнопка 'Удалить канал' (вызывает подтверждение)

**Промпт:**

> Спроектируй модальное окно/мини-настройки 'Настройки канала' chazhland (Electron/Windows, тёмная тема, как Discord), для owner/admin. Карточка с вкладками слева ('Обзор', 'Удалить'). На 'Обзор': read-only строка 'Тип: Текстовый' (с подсказкой 'тип нельзя изменить'), поле 'Название' (до 100), выпадающий 'Категория' (с 'Без категории'), 'Тема канала' (textarea, до 1024), 'Лимит участников' (число). Внизу справа 'Сохранить'. На вкладке 'Удалить' — красная зона с кнопкой 'Удалить канал' и предупреждением 'Вся история сообщений будет удалена безвозвратно'. Тёмная палитра, акцент сине-фиолетовый, опасные действия красным.

### `modal-create-category` — Создать категорию

Создание новой категории (одно поле имени). Owner/admin.

- Фичи: Создание категории
- Элементы:
    - Поле 'Имя категории' (NotBlank, до 100)
    - Кнопки 'Отмена' / 'Создать категорию'

**Промпт:**

> Спроектируй небольшое модальное окно 'Создать категорию' chazhland (Electron/Windows, тёмная тема, как Discord). Узкая карточка ~400px: заголовок 'Создать категорию', одно поле 'Название категории' (до 100, плейсхолдер 'Новая категория'), внизу 'Отмена' и акцентная 'Создать категорию'. Тёмная палитра, акцент сине-фиолетовый.

### `modal-edit-category` — Переименовать категорию

Переименование категории (одно поле) и удаление категории. Owner/admin.

- Фичи: Редактирование категории, Удаление категории
- Элементы:
    - Поле 'Имя категории' (NotBlank, до 100)
    - Кнопка 'Сохранить'
    - Кнопка 'Удалить категорию' (с пояснением, что каналы станут 'Без категории')

**Промпт:**

> Спроектируй модальное окно 'Настройки категории' chazhland (Electron/Windows, тёмная тема, как Discord) для owner/admin. Карточка ~420px: поле 'Название категории' (до 100) с кнопкой 'Сохранить', ниже разделитель и красная кнопка 'Удалить категорию' с пояснением серым 'Каналы не будут удалены — они станут «Без категории»'. Тёмная палитра, акцент сине-фиолетовый, опасное действие красным.

### `modal-create-invite` — Создать приглашение

Форма создания инвайта (опц. maxUses, expiresAt) и одноразовый показ сгенерированного кода. Owner/admin.

- Фичи: Создание инвайт-кода
- Элементы:
    - Поле 'Макс. использований' (>=1, опционально, пусто = без лимита)
    - Поле 'Срок действия' (datepicker, опционально, пусто = бессрочно)
    - Кнопка 'Создать'
    - После создания: одноразовый показ сырого code/ссылки с кнопкой 'Скопировать' и предупреждением 'код больше не будет показан'

**Промпт:**

> Спроектируй модальное окно 'Создать приглашение' chazhland (Electron/Windows, тёмная тема, как Discord) для owner/admin, в ДВУХ состояниях. Состояние 1 (форма): заголовок 'Новое приглашение', поле 'Максимум использований' (число >=1, плейсхолдер 'Без ограничений'), поле 'Срок действия' (выпадающий: 7 дней / 30 дней / Бессрочно / выбрать дату), кнопка 'Создать приглашение'. Состояние 2 (результат): крупное моноширинное поле с сгенерированным кодом/ссылкой, рядом кнопка-иконка 'Скопировать' (с состоянием 'Скопировано!'), и жёлтый предупреждающий блок 'Сохраните код сейчас — повторно он показан не будет'. Внизу кнопка 'Готово'. Тёмная палитра, акцент сине-фиолетовый, предупреждение жёлтым.

### `modal-member-profile` — Профиль участника

Карточка профиля другого участника по клику в списке: аватар, имя, роль, статус, статус-сообщение; для owner/admin — действия модерации.

- Фичи: Список участников, Онлайн-статусы участников (online / idle / dnd / offline), Кик участника, Смена роли, Сброс пароля админом
- Элементы:
    - Аватар, имя, бейдж роли, индикатор статуса и статус-сообщение, дата входа
    - Для owner/admin: кнопки 'Изменить роль' (owner), 'Сбросить пароль', 'Исключить'
    - Кнопки скрыты для собственного профиля и для owner-цели по правилам

**Промпт:**

> Спроектируй всплывающую карточку профиля участника chazhland (Electron/Windows, тёмная тема, как Discord) — компактный поповер, появляющийся при клике на участника в списке. Сверху цветной баннер, на нём круглый аватар с точкой статуса, под ним имя крупно, бейдж роли (OWNER золотой / ADMIN синий / MEMBER), строка статуса 'В сети' и статус-сообщение курсивом, ниже мелким 'На сервере с 12 мар 2026'. Для owner/admin внизу панель действий с кнопками: 'Изменить роль' (только владельцу), 'Сбросить пароль', и красная 'Исключить' (скрыты для собственной карточки и для владельца). Тёмная карточная панель с тенью, акцент сине-фиолетовый.

### `modal-change-role` — Изменить роль участника

Выбор новой роли (OWNER/ADMIN/MEMBER) с защитой от самодемоушена и снятия последнего владельца. Только owner.

- Фичи: Смена роли
- Элементы:
    - Радио/селектор роли: Owner / Admin / Member
    - Блокировки: нельзя понизить себя, нельзя понизить последнего owner (с пояснением)
    - Кнопки 'Отмена' / 'Применить'
    - Тосты ошибок 400

**Промпт:**

> Спроектируй модальное окно 'Изменить роль' для участника chazhland (Electron/Windows, тёмная тема, как Discord), доступное только владельцу. Заголовок 'Роль для {имя}'. Три выбираемые строки-радио: 'Owner — полный контроль', 'Admin — модерация и каналы', 'Member — обычный участник', с иконками и подсветкой выбранной. Под ними жёлтое предупреждение в заблокированных случаях: 'Нельзя понизить последнего владельца' или 'Нельзя понизить собственную роль'. Внизу 'Отмена' и акцентная 'Применить'. Тёмная палитра, акцент сине-фиолетовый, предупреждение жёлтым.

### `modal-confirm-kick` — Подтверждение исключения

Диалог подтверждения кика участника (необратимо завершает его сессии). Admin/owner.

- Фичи: Кик участника
- Элементы:
    - Текст 'Исключить {имя}?' с пояснением, что сессии завершатся
    - Кнопки 'Отмена' / 'Исключить' (красная)
    - Обработка 400 (себя) / 403 (владельца) тостом, если проскочило

**Промпт:**

> Спроектируй диалог подтверждения 'Исключить участника' chazhland (Electron/Windows, тёмная тема, как Discord). Небольшая карточка ~400px: заголовок 'Исключить {имя}?', тело серым 'Участник будет удалён с сервера, все его активные сессии завершатся. Он сможет вернуться только по новому приглашению.' Внизу 'Отмена' и красная кнопка 'Исключить'. Тёмная палитра, опасное действие красным.

### `modal-confirm-delete-channel` — Подтверждение удаления канала

Диалог подтверждения удаления канала (каскадно удаляет историю сообщений). Owner/admin.

- Фичи: Удаление канала
- Элементы:
    - Текст 'Удалить #канал?' с предупреждением о безвозвратном удалении сообщений
    - Кнопки 'Отмена' / 'Удалить' (красная)

**Промпт:**

> Спроектируй диалог 'Удалить канал' chazhland (Electron/Windows, тёмная тема, как Discord). Карточка ~400px: заголовок 'Удалить #{канал}?', тело красно-серым предупреждением 'Канал и ВСЯ история сообщений будут удалены безвозвратно. Это действие нельзя отменить.' Внизу 'Отмена' и красная 'Удалить канал'. Тёмная палитра, опасное действие красным.

### `modal-confirm-delete-category` — Подтверждение удаления категории

Диалог подтверждения удаления категории; каналы не удаляются, а становятся 'Без категории'. Owner/admin.

- Фичи: Удаление категории
- Элементы:
    - Текст 'Удалить категорию?' с пояснением, что каналы перейдут в 'Без категории'
    - Кнопки 'Отмена' / 'Удалить'

**Промпт:**

> Спроектируй диалог 'Удалить категорию' chazhland (Electron/Windows, тёмная тема, как Discord). Карточка ~400px: заголовок 'Удалить категорию «{имя}»?', тело серым 'Каналы внутри не будут удалены — они переместятся в группу «Без категории».' Внизу 'Отмена' и красная 'Удалить'. Тёмная палитра.

### `modal-confirm-revoke-invite` — Подтверждение отзыва приглашения

Диалог подтверждения отзыва инвайта (код перестаёт работать, история сохраняется). Owner/admin.

- Фичи: Отзыв инвайта
- Элементы:
    - Текст подтверждения отзыва
    - Кнопки 'Отмена' / 'Отозвать' (красная)

**Промпт:**

> Спроектируй компактный диалог 'Отозвать приглашение' chazhland (Electron/Windows, тёмная тема, как Discord). Карточка ~380px: заголовок 'Отозвать приглашение?', тело серым 'Код перестанет работать при регистрации. Запись останется в журнале со статусом «Отозвано».' Внизу 'Отмена' и красная 'Отозвать'. Тёмная палитра.

### `modal-temp-password` — Временный пароль (после сброса)

Одноразовый показ сгенерированного временного пароля после админского сброса; передать пользователю лично.

- Фичи: Админский сброс пароля пользователю, Сброс пароля админом
- Элементы:
    - Моноширинное поле с временным паролем + кнопка 'Скопировать'
    - Предупреждение 'передайте лично, повторно не покажем'
    - Кнопка 'Готово'

**Промпт:**

> Спроектируй модальное окно 'Пароль сброшен' chazhland (Electron/Windows, тёмная тема, как Discord) для owner/admin. Карточка ~420px: заголовок 'Временный пароль для {имя}', крупное моноширинное поле с паролем и кнопкой-иконкой 'Скопировать' (состояние 'Скопировано!'), жёлтый предупреждающий блок 'Передайте пароль пользователю лично — повторно он показан не будет'. Внизу кнопка 'Готово'. Тёмная палитра, предупреждение жёлтым, акцент сине-фиолетовый.

### `modal-emoji-picker` — Выбор эмодзи (reaction picker)

Палитра эмодзи для добавления реакции на сообщение (поддержка кастомных unicode, до 64 символов).

- Фичи: Добавление реакции эмодзи (idempotent), Снятие реакции эмодзи (idempotent)
- Элементы:
    - Сетка эмодзи по категориям
    - Поле поиска эмодзи
    - Недавно использованные
    - Поповер привязан к сообщению

**Промпт:**

> Спроектируй поповер выбора эмодзи (reaction picker) chazhland (Electron/Windows, тёмная тема, как Discord) — компактная панель ~360px, всплывающая из кнопки реакции у сообщения. Сверху поле поиска 'Поиск эмодзи', ряд категорий-иконок, ниже сетка эмодзи (8 в ряд), секция 'Недавние' сверху. По ховеру эмодзи увеличивается, снизу превью названия. Тёмная карточная панель с тенью.

### `modal-attachment-lightbox` — Просмотр вложения (лайтбокс)

Полноэкранный просмотр изображения/видео-вложения с возможностью скачать.

- Фичи: Агрегаты реакций и список вложений в ответах сообщений, Presign-загрузка вложений
- Элементы:
    - Большое изображение/видео по центру на затемнённом фоне
    - Кнопки 'Скачать' (url), 'Закрыть', навигация между вложениями сообщения
    - Метаданные: имя файла, размер

**Промпт:**

> Спроектируй полноэкранный лайтбокс просмотра вложения chazhland (Electron/Windows, тёмная тема, как Discord). Затемнённый полупрозрачный фон, по центру крупное изображение (или видео-плеер), сверху-справа кнопки 'Скачать' и 'Закрыть (X)', снизу подпись с именем файла и размером, по бокам стрелки навигации между вложениями сообщения. Минималистичный тёмный оверлей.

## 4. Оконный уровень приложения (global chrome)

- Кастомный titlebar Windows: drag-зона, название сервера/приложения по центру или слева, иконка приложения, системные кнопки свернуть/развернуть/закрыть в стиле Windows (Electron frameless). Высота ~30px, тёмный фон.
- Системный трей (system tray): иконка chazhland в трее Windows с бейджем непрочитанного/упоминаний; контекстное меню трея (Открыть, Статус online/idle/dnd, Выйти). Сворачивание в трей вместо закрытия.
- Нативные desktop-уведомления (Electron Notification): тосты ОС о новых сообщениях/упоминаниях с учётом уровня уведомлений канала (ALL/MENTIONS/MUTED из notification-settings); клик открывает нужный канал. Не показывать для MUTED-каналов.
- Индикатор/баннер состояния WebSocket-соединения: верхняя полоса 'Подключение…/Переподключение…' (жёлтая) при разрыве STOMP, 'В сети' при восстановлении; авто-reconnect после refresh токена с новым access-токеном в CONNECT.
- Оффлайн-баннер: полоса 'Нет соединения с сервером' при потере сети; блокировка композера/действий, авто-догон через changesSince и read-states при восстановлении.
- Тосты ошибок из /user/queue/errors (WsError {status, message}): инлайн/тост по WS-действиям (typing/heartbeat/watch.control) — 403 'нет доступа', 400 'некорректный запрос', 'Видео не загружено'.
- Принудительный logout-оверлей при reuse-detection (refresh вернул 401 → все сессии погашены): модалка 'Сессия завершена, войдите снова' с кнопкой на экран входа; то же при смене пароля/logout-all/кике (403 на запросах).
- Глобальный фоновый слой состояния: single-flight очередь на /auth/refresh, прозрачное обновление токенов по истечении expiresIn, периодический heartbeat ~30с в /app/presence.heartbeat пока окно активно, переключатель собственного статуса online/idle/dnd (в нижней панели пользователя).
- Глобальный переключатель собственного статуса: меню в нижней панели пользователя (online / idle / не беспокоить) — выбор уходит полем status в heartbeat; offline ставится только сервером, недоступен вручную.
- Контекстные меню правым кликом: на канале (для admin/owner — настройки/удалить, для всех — настройки уведомлений, отметить прочитанным), на категории (admin/owner), на сообщении (реакция/ответ/правка/закрепить/удалить/копировать), на участнике (профиль/модерация/«Написать» → открыть DM).
- Действие «Прочитать всё» (POST /read-states/ack-all): в контекстном меню сервера / по агрегированному бейджу непрочитанного — разом гасит непрочитанное и упоминания по всем каналам.

## 5. Проверка полноты (критик)

**Вердикт:** Список окон покрывает почти все фичи инвентаризации серверного домена (Auth, профиль, структура сервера, сообщения, реакции/вложения, realtime, presence, голос, watch, админка) — по этим доменам пробелов в покрытии нет. КРИТИЧЕСКИЙ пробел один, но крупный: в бэкенде реализован домен личных сообщений (DmController: POST /dm/{userId}, GET /dm), который вообще отсутствует и в инвентаризации, и в списке окон — нет ни списка диалогов, ни точки входа 'написать в личку'. Плюс мелкий: явное действие 'закрепить' (PUT /messages/{messageId}/pin) не привязано к API в окне-ленте. Среди issues главное — нереалистичный элемент в modal-member-profile (статус-сообщение чужого пользователя неоткуда взять), серверная подсветка поиска (её нет), дублирование точек смены роли/списка участников между панелью и админкой, и системно пропущенные состояния загрузки/пусто/оффлайн в большинстве окон. Готовность списка: высокая по серверным доменам, но требует доработки — добавить DM-окна и вычистить перечисленные несоответствия с реальным API."

**Замечания к проработке (учтены в поправках выше):**
- modal-member-profile нереалистичен в части данных: показывает 'статус-сообщение курсивом' другого участника, но в API нет эндпоинта получения чужого профиля. GET /users/me — только свой профиль; GET /server/members (MemberResponse) отдаёт userId/username/avatarUrl/role/status/joinedAt, но НЕ statusMessage. Значит статус-сообщение чужого пользователя отрисовать неоткуда — элемент нужно убрать либо пометить как недоступный.
- win-channel-search-results: 'фрагмент с подсветкой совпадения' подразумевает, что бэкенд возвращает выделенные фрагменты. GET /channels/{channelId}/messages/search возвращает обычный List<MessageResponse> без какой-либо подсветки/сниппетов — подсветку придётся целиком считать на клиенте по запросу q. Это реализуемо, но элемент не должен предполагать серверный highlight.
- Дублирование между win-members-panel и win-admin-members: оба покрывают список участников + кик + смену роли (GET /server/members, DELETE /members/{userId}, PATCH /members/{userId}). win-members-panel — правая колонка с контекстным меню модерации, win-admin-members — админ-таблица с теми же действиями. Функционально пересекаются; стоит развести: панель = только просмотр+быстрые действия, админ-вкладка = полноценное управление, либо объединить, чтобы не плодить два места смены роли.
- Дублирование точки 'смены роли': и win-admin-members (селектор роли в строке), и win-members-panel (пункт 'Изменить роль' в контекстном меню), и modal-member-profile (кнопка 'Изменить роль'), и modal-change-role — четыре входа в одно действие PATCH /members/{userId}. Нужно зафиксировать единый флоу (любой вход открывает modal-change-role), иначе риск рассинхрона UI.
- Роль-зависимые элементы заявлены, но не всегда явно проверяются по СВЕЖЕЙ роли из БД: смена роли требует hasRole('OWNER') (MemberController.changeRole), кик — hasRole('ADMIN') (MemberController.kick). В win-members-panel/modal-member-profile кнопки 'Изменить роль' и 'Исключить' нужно показывать строго по owner/admin соответственно, но скрытие в UI — лишь удобство: бэкенд может вернуть 403 даже при валидном токене (роль в JWT устаревает за TTL). Окна должны обрабатывать 403, а не только прятать кнопки.
- Пропущены состояния загрузки/пусто/ошибка в ряде окон. win-text-channel: нет явного состояния 'пустой канал (нет сообщений)' и 'ошибка загрузки истории'. win-members-panel/win-admin-members: нет состояния загрузки списка и пустого результата поиска. win-admin-audit: нет пустого состояния 'журнал пуст' и состояния загрузки. win-admin-invites: нет пустого состояния 'приглашений ещё нет'. win-notification-settings: нет состояния загрузки карты настроек.
- Оффлайн/реконнект-состояния заявлены только в globalChrome, но не отражены в самих окнах. Для win-text-channel критично показать блокировку композера и баннер при потере WS + догон через changesSince; для win-voice-channel и win-watch-channel — состояние при разрыве WS (watch: реакция на потерю /topic/watch.{id}; voice: переподключение LiveKit). Стоит явно перечислить эти состояния в элементах окон realtime.
- win-watch-channel и modal/форма источника: элемент 'Загрузить файл / выбрать из загруженных' через storage/MinIO заявлен, но в watch-домене НЕТ собственного загрузчика — источник это просто http(s) URL (POST /channels/{channelId}/watch/source). Загрузка идёт через общий presign-флоу (POST /attachments/presign), затем публичный URL подставляется в поле. Реализуемо, но окно должно явно опираться на POST /attachments/presign (он указан в apis — ок), и не предполагать отдельного watch-аплоада.
- modal-attachment-lightbox: 'навигация между вложениями сообщения' и 'скачать (url)' реалистичны (url есть в AttachmentResponse), но thumbnailUrl в AttachmentResponse сейчас ВСЕГДА null (тумбнейлы не генерируются). Превью картинок в win-text-channel и лайтбоксе должны опираться на основной url + width/height, а не на thumbnailUrl, иначе сломается верстка/превью.
- win-voice-channel: элементы 'тайлы демонстрации экрана', 'индикатор говорит/заглушён', 'активный спикер' — это полностью клиентское состояние LiveKit SDK, не приходит из бэкенда (бэк даёт только токен POST /livekit/token и VOICE_UPDATE inVoice true/false по presence). Кто говорит / кто заглушён / кто демонстрирует экран бэкенд НЕ сообщает — эти индикаторы реализуются только через LiveKit-клиент. Стоит пометить, чтобы не ожидать серверных данных о состоянии треков.
- Принудительный logout-оверлей (reuse-detection / 403 после кика/смены пароля) есть в globalChrome — корректно, но не хватает явной обработки сценария 'меня кикнули/понизили во время сессии': при кике сервер гасит refresh-токены (DELETE /members/{userId}), и следующий refresh вернёт 401 → нужен тот же принудительный logout. Это покрыто globalChrome-оверлеем, отдельного окна не требует — отмечаю как зависимость, а не пробел.