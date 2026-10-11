# Architecture docs

Inbox is a 3NWeb app that sends messages via ASMail messaging protocol, implemented by 3NWeb platform, and provided in capabilities.

["Formats and Processes" docs](./formats-and-processes.md) outline message formats and scenarios.

[Implementation docs](./implementation.md) (should) reflect most notable implementation aspects, reasoning behind, and potential quirks, if such happen.

[Multi-device synchronization](./multi-device-sync.md) — how the copies of the app's data on the user's devices converge, the app's data living in each device's local file system.

[Backup and restore](./backup-and-restore.md) — the archive format, the two modes a restore can follow, and why a restore invents no merge rules of its own but is expressed in the ones synchronization already has.

[Contact blocking](./contact-blocking.md) — the blacklist belongs to the contacts app; what this one does with it, where mail from a blocked sender is dropped, and why mail received before a blocking is never touched.
