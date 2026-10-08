import { storeToRefs } from 'pinia';
import { useRouting } from '@main/desktop/composables/useRouting';
import { chatService } from '@main/common/services/external-services';
import { useAppStore } from '@main/common/store/app.store';
import { areAddressesEqual, toCanonicalAddress } from '@shared/address-utils';
import type { ChatIdObj } from '~/asmail-msgs.types';
import type { IncomingCallCmdArg, OpenChatCmdArg } from '~/chat-commands.types';
import { makeLogger } from '@shared/logger';

const log = makeLogger('CommandHandler');

export function useCommandHandler() {
  const { goToChatsRoute, goToChatRoute } = useRouting();
  const { user: ownAddr } = storeToRefs(useAppStore());

  async function findOneToOneChatWithPeer(peerAddr: string): Promise<ChatIdObj | undefined> {
    const chats = await chatService.getChatList();
    const peerCAddr = toCanonicalAddress(peerAddr);

    for (const chat of chats) {
      const { isGroupChat, chatId } = chat;

      if (!isGroupChat && chatId === peerCAddr) {
        return { isGroupChat, chatId };
      }
    }
  }

  async function openChatWith(cmdArg: OpenChatCmdArg): Promise<void> {
    const peerAddress = cmdArg?.peerAddress;
    if ((typeof peerAddress !== 'string') || !peerAddress) {
      log.error('Invalid peer address passed in open chat command');
      return;
    }

    if (areAddressesEqual(peerAddress, ownAddr.value)) {
      await goToChatsRoute();
      return;
    }

    const chatId = cmdArg.chatId
      ? cmdArg.chatId
      : await findOneToOneChatWithPeer(peerAddress);

    if (chatId) {
      await goToChatRoute(chatId);
    } else {
      await goToChatsRoute({ createNew: true });
    }
  }

  async function showIncomingCall(
    { chatId, peerAddress: callingPeer, callSessionId, sentAt }: IncomingCallCmdArg,
  ): Promise<void> {
    await goToChatRoute(chatId, { callingPeer, callSessionId, callSentAt: sentAt });
  }

  async function process({ cmd, params }: web3n.shell.commands.CmdParams): Promise<void> {
    // Before any routing, and at `info`: this line is the only proof that a
    // command reached this window at all. The platform hands commands to a
    // running instance through an observable with no replay, so one that
    // arrives before this composable subscribes is dropped with nothing said on
    // either side - and the backend's "UI requested" line is written whether or
    // not anybody was listening. Separating "never arrived" from "arrived and
    // got lost downstream" is otherwise impossible (live run of 2026-08-15,
    // where an incoming call rang on one device of a user and not on the other).
    log.info(`Received shell command '${cmd}' with ${params?.length ?? 0} parameter(s)`);
    try {
      switch (cmd) {
        case 'open-chat-with':
          return await openChatWith(params[0]);
        case 'incoming-call':
          return await showIncomingCall(params[0]);
        default:
          log.error(`🫤 Unknown/unimplemented command ${cmd}, with parameters ${(params || []).join(', ')}}`);
          break;
      }
    } catch (err) {
      log.error(`Error occurred while handing command ${cmd}`, err);
    }
  }

  async function start(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const unsub = w3n.shell!.watchStartCmds!({
      // Awaited through a catch, not fired and forgotten: the switch above
      // returns promises, so before this every asynchronous failure on the
      // command path - a rejected navigation, a route guard that threw - became
      // an unhandled rejection with no log line anywhere.
      next: cmdParams => {
        process(cmdParams).catch(err => {
          log.error(`Failed to handle command ${cmdParams.cmd}`, err);
        });
      },
      error: err => log.error(`Error in listening to commands for chat app:`, err),
      complete: () => console.info(`Listening to commands for chat app is closed by platform side.`),
    });

    const startCmd = await w3n.shell!.getStartedCmd!();
    if (startCmd) {
      await process(startCmd);
    }
  }

  return { start };
}
