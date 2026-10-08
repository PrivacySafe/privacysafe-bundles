export interface RouteChats {
  name: 'chats';
}

export interface RouteChat {
  name: 'chat',
  params: {
    chatId: string;
    chatType: 'g' | 's';
  };
  query: {
    call?: 'yes';
    peerAddress?: string;
    callSessionId?: string;
    /** When the incoming-call command was issued (ms since epoch, as string). */
    callSentAt?: string;
    fwMsg?: 'yes',
    fwdMsgChatType?: 'g' | 's';
    fwdMsgChatId?: string;
    fwdMsgId?: string;
  };
}
