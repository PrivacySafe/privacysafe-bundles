import type { DeepReadonly, InjectionKey, Ref } from 'vue';

interface MarkedMessagesInjection {
  markedMessages: DeepReadonly<Ref<string[]>>;
  markMessage: (msgId: string) => void;
  setMarkedMessages: (value: string[]) => void;
  resetMarkMessages: () => void;
}

export const MARKED_MESSAGES_INJECTION_KEY = Symbol() as InjectionKey<MarkedMessagesInjection>;
