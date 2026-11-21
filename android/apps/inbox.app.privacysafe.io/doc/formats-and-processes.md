# Chat messages


## Sending/Receiving via ASMail

Inbox app uses value `msgType: 'mail'` in `MsgStruct` part of `OutgoingMessage` and `IncomingMessage`.

It also uses a second type, `msgType: 'app:inbox.app.privacysafe.io'`, for the
*phantoms* it sends to the user's own address to synchronize the user's devices
(see [multi-device-sync.md](./multi-device-sync.md)). `app:<app domain>` is the
platform's convention for messages of an application rather than of a user; the
core routes nothing by `msgType`, so builds that predate the feature filter such
a message out and ignore it rather than showing it to the user.

An inbox message is routed by its type in one place, `routeIncomingMsg()`. Every
other type - `'chat'`, `'webrtc-signaling'`, another app's `app:*` - is left
alone and **not removed**: the inbox is shared not only between the user's
devices, but between their applications.

```mermaid
flowchart TD
  nm(new message) --> t1{"msgType"}
  t1 -- is 'mail' --> PM("store as mail")
  t1 -- is 'app:inbox.app.privacysafe.io' --> PS("apply as a sync phantom")
  t1 -- is anything else --> e(("ignored, <br> body not read"))
```


## Message sending, receiving process

```mermaid
sequenceDiagram
  actor R as Romeo <br> device
  participant RS as 📬 Rome's <br> ASMail server
  participant JS as 📬 Juliet's <br> ASMail server
  actor J as Juliet <br> device

  R -) JS: Deliver message
  activate JS
  JS ->> J: New message
  deactivate JS

  J -) RS: Deliver message
  activate RS
  RS ->> R: New message
  deactivate RS

```
