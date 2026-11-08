# 03. Форматы сообщений и потоки приёма/отправки

[← к оглавлению](./README.md)

ASMail переносит сообщение как «конверт»: адресат, `msgType`, `plainTxtBody`, вложения и
произвольный `jsonBody`. Все понятия чата приложение упаковывает в `jsonBody`. Ниже — какие бывают
тела, как приходящее сообщение проходит по системе и что происходит при отправке.

## 1. Форматы сообщений

Все тела имеют `v: 1` и опциональный `groupChatId` (его отсутствие означает чат 1-1, идентификатор
которого — адрес отправителя из конверта). Двум типам тел этого недостаточно, потому что они
адресуются **собственному** адресу пользователя, где выводить чат 1-1 не из чего: `synchronization` и
`webrtc-call` несут ещё и явное поле `chatId: ChatIdObj`. У фантомов оно обязательное, у сигналов
звонка — необязательное (рядом продолжает отправляться `groupChatId`) и читается только когда
отправитель — этот же пользователь, см. [05-video-calls.md §3.1](05-video-calls.md).

Объединение — `ChatMessageJsonBody` ([types/asmail-msgs.types.ts:217-223](../types/asmail-msgs.types.ts#L217-L223)),
`msgType` всегда `'chat'` ([types/asmail-msgs.types.ts:453-461](../types/asmail-msgs.types.ts#L453-L461)).

| `chatMessageType` | Тип | Кому отправляется | Сохраняется в БД |
|---|---|---|---|
| `regular` | [ChatRegularMsgV1:74-87](../types/asmail-msgs.types.ts#L74-L87) | участникам чата | да |
| `system` | [ChatSystemMsgV1:59-72](../types/asmail-msgs.types.ts#L59-L72) | участникам чата | только те, у которых есть `chatMessageId` |
| `invitation` | [ChatInvitationMsgV1:89-101](../types/asmail-msgs.types.ts#L89-L101) | приглашаемым | да |
| `webrtc-call` | [ChatWebRTCMsgV1:211-215](../types/asmail-msgs.types.ts#L211-L215) | участникам звонка | нет (обрабатывается на лету) — стадия и `callSessionId`, см. [05-video-calls.md §3.1](05-video-calls.md) |
| `synchronization` | [ChatSyncMsgV1:121-131](../types/asmail-msgs.types.ts#L121-L131) | **самому себе** (`ownAddr`) | нет, применяется к записям |

### 1.0 Голосовые и видео-сообщения: поле, а не тип

Запись, сделанная в приложении, уезжает **обычным `regular`-сообщением** с одним вложением
(`.weba` для голоса, `.webm` для видео), а то, что делает её записью, лежит в необязательном поле
`recordings` того же тела: `Record<имя файла, {kind, durationMs, preview?}>`.

Почему не новый `chatMessageType: 'voice'`. `checkV1()` возвращает `undefined` для типа, которого
не знает, и сборка, получившая такое сообщение, **удаляет его из общего inbox** — то есть и у всех
остальных устройств пользователя. Незнакомое поле у известного типа, наоборот, просто
игнорируется: старый корреспондент увидит обычное аудио- или видео-вложение и откроет его
существующим просмотрщиком. Та же логика уже записана у `RestoreSnapshotSysMsgData`
([asmail-msgs.types.ts](../types/asmail-msgs.types.ts)).

Почему ключ — имя файла, а не «одно поле на сообщение»: получатель восстанавливает список вложений
из папки вложений ASMail, где порядок `listFolder` не гарантирован, а контейнер кладёт файлы именно
по имени (`addFileTo(container, file, name)`). Индекс спарил бы длительность не с тем файлом.

Почему длительность вообще едет по проводу: из файла её не достать. WebM от `MediaRecorder` не
содержит элемента Duration, а под `MediaSource` элемент до `endOfStream()` сообщает `Infinity` —
это уже описано в `readDuration()` в `useAudioView`. Превью едет по схожей причине: видео-сообщение
кратно больше `THUMBNAIL_AUTO_PREVIEW_LIMIT`, поэтому без присланного кадра его не увидел бы ни
получатель, ни сам отправитель; обе стороны кладут его в таблицу `thumbnails`, а не в запись
сообщения. Битрейты и лимиты — [09-attachment-streaming.md](09-attachment-streaming.md).

`chatMessageId` генерируется отправителем и имеет вид `<epoch-в-секундах>-<random10>`
([chat-ids.ts:45-53](../shared-libs/chat-ids.ts#L45-L53)). Из него извлекается примерное время,
что упрощает поиск в БД. Идентификатор доставки (`deliveryId`) — отдельная сущность:
`<timestamp>_<chatMessageId>` с префиксом `sync_` для фантомов
([chat-ids.ts:55-57](../shared-libs/chat-ids.ts#L55-L57),
[sending-primitives.ts:57-66](../src-deno/services/mail-sending-service/sending-primitives.ts#L57-L66)).

### 1.1 Системные события

`ChatSystemMessageData` — 18 вариантов
([types/asmail-msgs.types.ts:553-571](../types/asmail-msgs.types.ts#L553-L571)):

| Событие | Смысл | Отображается в истории |
|---|---|---|
| `update:status` ([374](../types/asmail-msgs.types.ts#L374)) | «доставлено»/«прочитано» для конкретного сообщения | нет |
| `update:msg-record` ([382](../types/asmail-msgs.types.ts#L382)) | авторитетный статус + `history` записи (только между своими устройствами) | нет |
| `resync:msg-record` ([419](../types/asmail-msgs.types.ts#L419)) | запрос переслать запись заново (только между своими устройствами) | нет |
| `update:body` ([398](../types/asmail-msgs.types.ts#L398)) | правка текста сообщения | нет (меняет само сообщение) |
| `update:reactions` ([390](../types/asmail-msgs.types.ts#L390)) | новый набор реакций | нет |
| `delete:message` ([313](../types/asmail-msgs.types.ts#L313)) | удалить одно / несколько / всю историю | нет |
| `update:chatName` ([342](../types/asmail-msgs.types.ts#L342)) | переименование чата | да |
| `update:settings` ([349](../types/asmail-msgs.types.ts#L349)) | смена настроек (авто-удаление) | да |
| `update:members` ([324](../types/asmail-msgs.types.ts#L324)) | изменение состава группы | да |
| `update:admins` ([333](../types/asmail-msgs.types.ts#L333)) | изменение администраторов | да |
| `member-left` ([359](../types/asmail-msgs.types.ts#L359)) | отправитель покинул чат | да |
| `member-removed` ([369](../types/asmail-msgs.types.ts#L369)) | получателя исключили / чат удалён | да |
| `accept:invitation` ([426](../types/asmail-msgs.types.ts#L426)) | приглашение принято | да |
| `call` ([434](../types/asmail-msgs.types.ts#L434)) | запись о звонке (создаётся локально, наружу не уходит) | да |
| `webrtc-call` ([470](../types/asmail-msgs.types.ts#L470)) | звонок отменён (исходящий/входящий) | да |
| `contact:blocked` ([456](../types/asmail-msgs.types.ts#L456)) | контакт заблокирован (запись чисто локальная, см. [10-contact-blocking.md](10-contact-blocking.md)) | да |
| `contact:unblocked` ([463](../types/asmail-msgs.types.ts#L463)) | контакт разблокирован (там же) | да |
| `restore:snapshot` ([514](../types/asmail-msgs.types.ts#L514)) | кусок снимка при восстановлении из архива (см. [08-backup-and-restore.md](08-backup-and-restore.md)) | нет |

Три из них — `call`, `contact:blocked` и `contact:unblocked` — **никогда не уходят пиру**: они
описывают решение, принятое на этой стороне. Первое при этом синхронизируется на другие устройства
пользователя фантомом, а два последних — нет, и почему именно, разобрано в
[10-contact-blocking.md §5.1](10-contact-blocking.md#51-почему-они-не-синхронизируются-между-устройствами).

Различие «отображается / не отображается» технически сводится к наличию `chatMessageId` в теле:
только с ним событие получает запись в `messages` и попадает в ленту
([addVisibleSystemSyncMsg](../src-deno/services/chat-service/utils/handle-incoming-sync.ts#L190-L224)).

**Штамп записи о событии пира — `deliveryTS`, а не `Date.now()`.** Правило общее для всех
отображаемых событий, приходящих от пира: сообщение лежит в общем ящике, и каждое устройство
пользователя создаёт запись из него самостоятельно (фантома для такой записи нет). История
сортируется строго по `timestamp` (`ORDER BY timestamp` в
[msgs-db.ts](../src-deno/dataset/msgs-db.ts)), поэтому устройство, подобравшее то же сообщение
catch-up-сканом часом позже, штампом собственных часов поставило бы событие в конец ленты — так
запись «приглашение принято» уехала за все последующие сообщения в прогоне 2026-08-14. `deliveryTS`
ставит сервер ASMail один раз, и все устройства выводят из него одну и ту же метку; из этого же
соображения от него берётся и токен упорядочивания (обоснование —
[chat-renaming.ts:146-154](../src-deno/services/chat-service/utils/chat-renaming.ts#L146-L154)).
Идиома — `msgDbEntryForIncomingSysMsg()`
([_msgs-related-methods.ts:100-125](../src-deno/services/chat-service/utils/_msgs-related-methods.ts#L100-L125));
`createDisplayableSystemMessage()` в
[chat-creation.ts](../src-deno/services/chat-service/utils/chat-creation.ts) получает `timestamp`
теми же соображениями и при повторной встрече того же inbox-сообщения **правит** штамп уже созданной
записи — идентификатор такой записи детерминирован, а сообщение переигрывается сканами все 15 дней,
пока лежит в ящике, так что испорченные ранее записи выравниваются без миграции.

## 2. Приём: от inbox до события в UI

```mermaid
flowchart TB
  Sub["w3n.mail.inbox.subscribe('message')"] --> HIM["handleIncomingMessage()"]
  Catchup["handleMissedInboxMessages()<br/>при старте"] --> HIM
  HIM -->|"msgType != 'chat'"| Drop1["игнорируется"]
  HIM -->|"уже в seenMsgIds"| Drop2["игнорируется"]
  HIM -->|"webrtc-call"| QW["webRTCMsgsQueue<br/>(SingleProc)"]
  HIM -->|"остальное"| QC["chatMsgsQueue<br/>(SingleProc)"]
  QW --> VS["videoChatSrv.handleIncomingWebRTCMsg()"]
  QC --> CS["chatsSrv.handleIncomingMsg()"]
  VS --> WM["setLastReceivedMessageTimestamp()"]
  CS --> WM
```

[inbox-dispatcher.ts:31-193](../src-deno/services/mail-service/inbox-dispatcher.ts#L31-L193).
Существенные решения:

- **Две независимые очереди**, каждая на своём `SingleProc`
  ([inbox-dispatcher.ts:40-44](../src-deno/services/mail-service/inbox-dispatcher.ts#L40-L44)):
  медленная обработка чата не задерживает латентно-критичный WebRTC-сигналинг.
- **Сообщение от заблокированного отправителя до очередей не доходит**: оно удаляется с сервера
  сразу и в базу не попадает — и в живом потоке
  ([:467](../src-deno/services/mail-service/inbox-dispatcher.ts#L467)), и в catch-up-скане
  ([:388](../src-deno/services/mail-service/inbox-dispatcher.ts#L388)). Кто заблокирован, знает
  `BlacklistTracker` ([10-contact-blocking.md](10-contact-blocking.md)).
- **Дедупликация по `seenMsgIds`**
  ([inbox-dispatcher.ts:56](../src-deno/services/mail-service/inbox-dispatcher.ts#L56)): одно и то
  же сообщение может попасть и в подписку, и в стартовое сканирование.
- **Watermark продвигается только после успешной обработки и после сброса БД на диск**
  ([inbox-dispatcher.ts](../src-deno/services/mail-service/inbox-dispatcher.ts)): падение между
  постановкой в очередь и обработкой не «съедает» сообщение. Порядок «`db.flush()` → watermark»
  существенен: watermark пишется в свой файл сразу и назад не откатывается, а записи БД батчатся
  ([02-data-model.md](02-data-model.md#111-запись-файла-батчится)) — при обратном порядке сбой
  оставил бы сообщения, которых уже нет в окне догона и ещё нет ни в одной БД. Сброс и продвижение
  делаются **на пачку** (по опустошении очереди либо каждые `INBOX_COMMIT_BATCH = 32` сообщения), а
  не на каждое сообщение: пакетный приём — как раз тот случай, ради которого записи и батчатся.
  Худший исход при сбое — повторная обработка пачки, а она идемпотентна (см. §7).
- **Стартовое сканирование** ([inbox-dispatcher.ts:108-151](../src-deno/services/mail-service/inbox-dispatcher.ts#L108-L151))
  берёт сообщения с `watermark - 60 c` и сортирует WebRTC-сигналы так, чтобы `start` шёл первым
  (`startStageFirst`, [_common.ts:74-84](../src-deno/services/video-chat-service/utils/_common.ts#L74-L84)) —
  иначе offer мог бы прийти раньше, чем создан объект звонка.

### 2.1 Разбор сообщения чата

[chat-service.ts:181-258](../src-deno/services/chat-service/chat-service.ts#L181-L258):

```mermaid
flowchart TB
  In["handleIncomingMsg(msg)"] --> Check["checkChatMessageJSON()"]
  Check -->|"не прошло"| Rm1["удалить из inbox сразу"]
  Check --> T{"chatMessageType"}
  T -->|invitation| Inv["chatCreation.handleChatInvitation()"]
  T -->|synchronization| Sync{"sourceDeviceId<br/>== своё?"}
  Sync -->|да| Defer1["только отложить удаление<br/>(другим устройствам ещё нужно)"]
  Sync -->|нет| HS["handleIncomingSync()"] --> Defer2["отложить удаление"]
  T -->|"regular / system"| Chat{"чат известен?"}
  Chat -->|нет| Rm2["удалить из inbox"]
  Chat -->|"группа, sender не участник"| Rm3["удалить из inbox"]
  Chat -->|system| Sys["handleSystemMsg() → switch по event"] --> Defer3["отложить удаление"]
  Chat -->|regular| Can{"canReceiveRegularMessages()"}
  Can -->|нет| Skip["ничего не делаем"]
  Can -->|да| Reg["msgSending.handleRegularMsg()"]
```

Ключевые точки:

- Фантом от **собственного** устройства не применяется повторно, но и не удаляется мгновенно
  ([chat-service.ts:206-212](../src-deno/services/chat-service/chat-service.ts#L206-L212)).
- `scheduleInboxMsgRemoval()` для системного сообщения вызывается **после** успешного применения
  ([chat-service.ts:356-359](../src-deno/services/chat-service/chat-service.ts#L356-L359)): если
  обработчик упал, сообщение останется в inbox и будет обработано при следующем старте.
- Маршрутизация системных событий — `switch` на 11 ветвей
  ([chat-service.ts:267-354](../src-deno/services/chat-service/chat-service.ts#L267-L354)); каждая
  делегирует своему модулю (`msg-status-updating`, `msg-deletion`, `chat-members-updating`,
  `chat-renaming`, `chat-setting-up`, `chat-member-removal`, `webrtc-call-reaction`, `msg-editing`,
  `msg-reactions`).

### 2.2 Сценарий: приём обычного сообщения

```mermaid
sequenceDiagram
    autonumber
    participant Peer as Отправитель
    participant SRV as ASMail сервер
    participant D as Deno: dispatcher
    participant CS as chat-service
    participant DB as SQLite
    participant OS as Уведомления ОС
    participant UI as Основной GUI

    Peer->>SRV: regular (jsonBody + вложения)
    SRV-->>D: inbox 'message'
    D->>CS: handleIncomingMsg()
    CS->>DB: getMessage() — уже есть?
    Note over CS,DB: повторная доставка внутри окна<br/>отложенного удаления возможна
    CS->>DB: addMessage(status='unread')
    CS->>UI: emit message.added → watch()
    CS->>OS: addNotification(cmd: open-chat-with)
    CS->>SRV: system update:status = 'sent' (отправителю)
    alt без вложений
      CS->>DB: scheduleInboxMsgRemoval(msgId)
    else с вложениями
      Note over CS: incomingMsgId сохраняется в записи,<br/>байты остаются в inbox
    end
```

Код: [msg-sending.ts:232-312](../src-deno/services/chat-service/utils/msg-sending.ts#L232-L312).
Обратите внимание: подтверждение `update:status: 'sent'` формирует **получатель**, поэтому у
отправителя статус «доставлено» появляется независимо от прогресса доставки.

Пометка «прочитано» — отдельное действие UI
([msg-status-updating.ts:87-103](../src-deno/services/chat-service/utils/msg-status-updating.ts#L87-L103)):
обновляется локальная запись, отправляется `update:status: 'read'` участникам и фантом своим
устройствам.

## 3. Отправка

```mermaid
flowchart LR
  UI["GUI: sendMessageInChat()"] --> CS["ChatSrv.sendRegularMessage()"]
  CS --> PREP["prepOutgoingAttachments()<br/>saveCopy до 20 МиБ, иначе saveLink<br/>→ attachments[].id"]
  PREP --> DB["addMessage(status='sending')"]
  DB --> PH["фантом своим устройствам<br/>(оптимистично)"]
  DB --> ADD["delivery.addMsg(recipients, msg, deliveryId, {localMeta})"]
  ADD --> MON["delivery.observeAllDeliveries()"]
  MON --> H{"localMeta.chatMessageType"}
  H -->|regular| HR["handleRegularSendingProgress"]
  H -->|invitation| HI["handleInvitationSendingProgress"]
  H -->|system| HS["handleSystemSendingProgress"]
  H -->|synchronization| HY["handleSyncSendingProgress"]
  H -->|webrtc-call| HW["allDone → rmMsg()"]
```

- Примитивы отправки — [sending-primitives.ts](../src-deno/services/mail-sending-service/sending-primitives.ts):
  `sendRegularMessage`, `sendSystemMessage`, `sendSystemDeletableMessage`, `sendChatInvitation`.
- **Заблокированные адреса вычёркиваются из получателей прямо перед `addMsg`**
  ([:74](../src-deno/services/mail-sending-service/sending-primitives.ts#L74)), а не там, где
  каждый вызывающий собирает свой список: таких мест около двадцати, и пропустить одно — вопрос
  времени. Если после этого получателей не осталось, доставка не начинается, но `deliveryId`
  возвращается, чтобы вызывающий не терял свой контракт. Полностью —
  [10-contact-blocking.md §4](10-contact-blocking.md#4-что-фильтруется-на-выходе).
- Фантомы своим устройствам живут отдельно, в
  [sync-phantoms.ts](../src-deno/services/mail-sending-service/sync-phantoms.ts): они не отправляются
  напрямую, а записываются в журнал и выпускаются оттуда
  (см. [04-multi-device-sync.md §4.1](./04-multi-device-sync.md#41-журнал-исходящих-фантомов)).
- `localMeta` (`LocalMetadataInDelivery`, [types/chat.types.ts:296-302](../types/chat.types.ts#L296-L302))
  — то, по чему монитор доставки понимает, что за сообщение он видит
  ([delivery-monitor.ts:48-102](../src-deno/services/mail-service/delivery-monitor.ts#L48-L102)).
- `sendImmediately: !message.attachments`
  ([sending-primitives.ts:69-72](../src-deno/services/mail-sending-service/sending-primitives.ts#L69-L72)):
  сообщения без вложений отправляются вне очереди, с вложениями — через обычную очередь доставки.

### 3.1 Сценарий: отправка обычного сообщения

```mermaid
sequenceDiagram
    autonumber
    participant UI as GUI
    participant CS as chat-service
    participant FS as file-store
    participant DB as SQLite
    participant DEL as ASMail delivery
    participant DM as delivery-monitor

    UI->>CS: sendRegularMessage({chatId, text, files, relatedMessage})
    CS->>DB: findChat() — иначе исключение chatNotFound
    CS->>FS: saveCopy() до 20 МиБ, иначе saveLink() — на каждое вложение
    CS->>DB: addMessage(status='sending', attachments[].id)
    CS->>DEL: фантом 'synchronization' на ownAddr
    CS->>DEL: addMsg(recipients, regular, deliveryId, localMeta)
    CS->>UI: emit message.added
    loop прогресс
      DEL-->>DM: progress (bytesSent, recipients)
      DM->>UI: emit sending-progress
      DM->>DB: status='sending' (если ещё не он)
    end
    DEL-->>DM: allDone = all-ok | with-errors
    DM->>DB: updateMessageRecord(status='sent'|'error', history)
    DM->>UI: emit message.updated
    DM->>DEL: rmMsg(deliveryId)
    DM->>DB: setSyncVersion('msg', …, 'status', token)
    DM->>DEL: фантом update:msg-record (терминальный статус)
```

Код: [msg-sending.ts:132-199](../src-deno/services/chat-service/utils/msg-sending.ts#L132-L199),
[handle-regular-sending-progress.ts:29-122](../src-deno/services/mail-sending-service/progress-handlers/handle-regular-sending-progress.ts#L29-L122).

Повторная отправка (`resend`) идёт тем же методом с уже существующим `chatMessageId`
([msg-sending.ts:153-168](../src-deno/services/chat-service/utils/msg-sending.ts#L153-L168)):
запись не создаётся заново, а переводится в `sending`, и своим устройствам уходит фантом статуса.

Отмена (`cancelSendingMessage`) — `delivery.rmMsg(deliveryId, true)` + статус `canceled` + **явный**
фантом, потому что удалённая доставка уже не пришлёт терминальный прогресс
([chat-service.ts:477-494](../src-deno/services/chat-service/chat-service.ts#L477-L494)).

### 3.2 Ошибки доставки

При `allDone === 'with-errors'` ошибки по адресатам складываются в `history.changes` записью типа
`error` ([handle-regular-sending-progress.ts:80-102](../src-deno/services/mail-sending-service/progress-handlers/handle-regular-sending-progress.ts#L80-L102)),
после чего статус становится `error`. Перед записью каждая ошибка проходит через
`serializeDeliveryError()` ([delivery-errors.ts](../src-deno/utils/delivery-errors.ts)), которая
приводит `DeliveryException`/`RuntimeException`/нативный `Error` к единому плоскому
`SerializedDeliveryError` (`{ message, type?, ...булевы флаги }`, [types/chat.types.ts](../types/chat.types.ts))
— без этого шага `history` сохраняется как JSON (`optJsonTransform`), а `JSON.stringify(new Error(...))`
даёт `{}`, и причина сбоя терялась (в частности, для `resolveStuckSyncingSelfMessages`,
[msg-status-updating.ts:152-184](../src-deno/services/chat-service/utils/msg-status-updating.ts#L152-L184),
которая создаёт такую ошибку напрямую). UI показывает нормализованную ошибку в «информации о
сообщении» ([chat-message-info-errors.vue](../src-main/common/components/messages/chat-message/chat-message-info/chat-message-info-errors.vue)),
с текстом `message` как запасным вариантом, если флаг ошибки не распознан.

Сообщение находится для обновления статуса через `progress.localMeta` (`LocalMetadataInDelivery`,
несёт и `chatId`, и `chatMessageId` — заполняется в `sendRegularMessage()` до постановки в очередь
доставки), а не разбором `deliveryId`: `chatMessageId` сам по себе не уникален в БД (первичный ключ
таблицы `messages` — `(chatMessageId, groupChatId, otoPeerCAddr)`), поэтому поиск только по нему мог
бы задеть чужую запись с тем же `chatMessageId` в другом чате.

## 4. Создание чата и приглашения

Единый модуль — [chat-creation.ts](../src-deno/services/chat-service/utils/chat-creation.ts).

```mermaid
sequenceDiagram
    autonumber
    participant A as Устройство A (инициатор)
    participant B as Устройство B (приглашённый)

    A->>A: ensureAllAddressesExist() — preflight адресов
    A->>A: addOneToOneChat(status='initiated') + запись invitation
    A->>A: фантом invitation своим устройствам
    A->>B: invitation (oto-chat-invite: имя инициатора)
    B->>B: addOneToOneChat(status='invited') + запись invitation (unread)
    B->>B: уведомление ОС «приглашение»
    Note over B: пользователь нажимает «Принять»
    B->>B: acceptChatInvitation(): статус чата → 'on'
    B->>B: фантом accept:invitation своим устройствам
    B->>A: invitation (invite-acceptance: имя принявшего)
    A->>A: статус чата → 'on', имя обновлено
    A->>A: системная запись accept:invitation в истории
```

- Проверка адресов до создания: `ensureAllAddressesExist()`
  ([chat-service.ts:365-373](../src-deno/services/chat-service/chat-service.ts#L365-L373),
  [address-checks.ts](../src-deno/utils/address-checks.ts)); при отказе бросается
  `chat-creation`-исключение со списком проблемных адресов.
- Группа: создатель всегда добавляется в участники и админы
  ([chat-service.ts:391-415](../src-deno/services/chat-service/chat-service.ts#L391-L415)); статус
  проходит `initiated → partially-on → on` по мере принятия приглашений
  ([chat-creation.ts:439-456](../src-deno/services/chat-service/utils/chat-creation.ts#L439-L456)).
- Принятие в группе рассылается всем участникам отдельным телом
  `updated-members-invitation-data` ([chat-creation.ts:460-483](../src-deno/services/chat-service/utils/chat-creation.ts#L460-L483)),
  которое принимается только от администратора
  ([chat-creation.ts:538-541](../src-deno/services/chat-service/utils/chat-creation.ts#L538-L541)).
- Видимая запись «X принял приглашение» дедуплицируется по детерминированному id
  `accept-invitation:<msgId>` ([chat-creation.ts:125-168](../src-deno/services/chat-service/utils/chat-creation.ts#L125-L168)) —
  повторная доставка не создаёт вторую запись.
- **`initiator` в теле `invite-acceptance`** — адрес, приславший исходное приглашение: в группе это
  `groupSender` записи приглашения, в чате 1-1 — собеседник чата (только входящее приглашение
  переводит чат в статус `invited`, поэтому собеседник и есть пригласивший),
  [chat-creation.ts:677-691](../src-deno/services/chat-service/utils/chat-creation.ts#L677-L691).
  Туда же уходит и само принятие. Получатель по этому полю понимает, он ли инициатор чата, и от
  этого зависит статус группы
  ([chat-creation.ts:443-460](../src-deno/services/chat-service/utils/chat-creation.ts#L443-L460)).
- Флаг `neverContactedInitiator` выводится из отсутствия `establishedSenderKeyChain`
  ([chat-creation.ts:581-582](../src-deno/services/chat-service/utils/chat-creation.ts#L581-L582)) —
  UI использует его, чтобы предупредить о приглашении от незнакомого адреса.

## 5. Удаление

Три разных операции ([msg-deletion.ts](../src-deno/services/chat-service/utils/msg-deletion.ts)):

| Операция | Локально | Своим устройствам | Участникам |
|---|---|---|---|
| `deleteMessage(id, forEveryone)` | удалить запись, удалить байты (inbox / вложения) | tombstone + фантом `delete:message` | `system delete:message`, если `forEveryone` |
| `deleteMessages(ids, forEveryone)` | то же пакетно; возвращает `{deleted, failed}` | tombstone на каждое **удавшееся** + один фантом | один `system delete:message` |
| `deleteMessagesInChat(chatId, forEveryone)` | удалить все записи чата и связанные байты | маркер `historyCleared` + фантом `allInChat` | `system delete:message` c `allInChat` |
| `deleteExpiredMessages(now)` | удалить истёкшие по `removeAfter` | **ничего** — каждое устройство истекает само | ничего |

Особенности:

- Синхронизация удаления идёт **всегда**, даже при «удалить только у себя»: это изменение локальной
  БД, и другие устройства пользователя должны его повторить
  ([msg-deletion.ts:108-113](../src-deno/services/chat-service/utils/msg-deletion.ts#L108-L113)).
- Пакетное удаление может пройти **частично**: удаление одного сообщения — это несколько шагов
  (строка БД, сообщение в inbox, файлы вложений), и любой может отказать для одного сообщения,
  удавшись для другого. Поэтому событие `messages-removed` несёт только фактически удалённые id,
  фантом и уведомление участникам — тоже, а вызывающему возвращается и список отказов
  ([msg-deletion.ts](../src-deno/services/chat-service/utils/msg-deletion.ts)). Безусловное «удалены
  все» оставляло бы интерфейс показывающим не то, что в БД, до следующей полной перезагрузки; GUI
  на непустой `failed` показывает уведомление
  ([messages.store.ts](../src-main/common/store/messages.store.ts)).
- Тем же правилом обрабатывается удаление, пришедшее от собеседника: сообщения, которых в БД нет,
  в событие не попадают.
- Очистку истории «для всех» в группе может сделать только администратор
  ([msg-deletion.ts:220-222](../src-deno/services/chat-service/utils/msg-deletion.ts#L220-L222)).
- При удалении не трогаются вложения записи, синхронизированной с другого устройства (её id
  принадлежат тому устройству) —
  [msg-deletion.ts:76-92](../src-deno/services/chat-service/utils/msg-deletion.ts#L76-L92).

## 6. Правки и реакции

Обе операции устроены одинаково: изменить запись → отправить участникам `system`-событие → вернуть
обновлённую view-модель в UI; фантом своим устройствам отправляет соответствующий модуль:

| Действие | Метод | Событие участникам |
|---|---|---|
| Правка текста | [chat-service.ts:513-550](../src-deno/services/chat-service/chat-service.ts#L513-L550) + [msg-editing.ts](../src-deno/services/chat-service/utils/msg-editing.ts) | `update:body` |
| Реакция | [chat-service.ts:552-593](../src-deno/services/chat-service/chat-service.ts#L552-L593) + [msg-reactions.ts](../src-deno/services/chat-service/utils/msg-reactions.ts) | `update:reactions` |

Оба события отправляются через `sendSystemDeletableMessage()` — то есть доставка сообщения
удаляется из очереди сразу после завершения
([handle-system-sending-progress.ts](../src-deno/services/mail-sending-service/progress-handlers/handle-system-sending-progress.ts)).

## 7. Что важно помнить

1. Один и тот же `chatMessageId` используется и как id записи, и как часть `deliveryId` — но
   пространства id фантомов и обычных сообщений разделены префиксом `sync_`
   ([sending-primitives.ts:57-66](../src-deno/services/mail-sending-service/sending-primitives.ts#L57-L66)).
2. Повторная доставка (в пределах 15-дневного окна отложенного удаления) — нормальная ситуация;
   обработчики обязаны быть идемпотентными, и в коде это сделано проверкой «запись уже есть»
   ([msg-sending.ts:242-251](../src-deno/services/chat-service/utils/msg-sending.ts#L242-L251),
   [chat-creation.ts:135-142](../src-deno/services/chat-service/utils/chat-creation.ts#L135-L142)).
3. Обычные сообщения принимаются только в чатах с подходящим статусом
   ([_msgs-related-methods.ts:271-280](../src-deno/services/chat-service/utils/_msgs-related-methods.ts#L271-L280)),
   поэтому сообщение в непринятый чат просто не сохранится.

---

Далее: [04-multi-device-sync.md](./04-multi-device-sync.md) — как расходятся и сходятся устройства
одного пользователя.
