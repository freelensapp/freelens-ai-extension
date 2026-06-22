import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGES_KEY,
  CONVERSATION_ID_KEY,
  type KeyValueStorage,
  loadChatMessages,
  loadConversationId,
  saveChatMessages,
  saveConversationId,
} from "./chat-session-storage";

import type { MessageObject } from "../business/objects/message-object";

const createStorage = (initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } => {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
};

const message = (text: string): MessageObject => ({ text }) as MessageObject;

describe("chat-session-storage", () => {
  describe("loadChatMessages", () => {
    it("returns an empty array when nothing is stored", () => {
      expect(loadChatMessages(createStorage())).toEqual([]);
    });

    it("returns the persisted transcript", () => {
      const messages = [message("hello"), message("world")];
      const storage = createStorage({ [CHAT_MESSAGES_KEY]: JSON.stringify(messages) });
      expect(loadChatMessages(storage)).toEqual(messages);
    });

    it("returns an empty array when the stored value is corrupt", () => {
      const storage = createStorage({ [CHAT_MESSAGES_KEY]: "{ not json" });
      expect(loadChatMessages(storage)).toEqual([]);
    });

    it("returns an empty array when the stored value is not an array", () => {
      const storage = createStorage({ [CHAT_MESSAGES_KEY]: JSON.stringify({ foo: "bar" }) });
      expect(loadChatMessages(storage)).toEqual([]);
    });
  });

  describe("saveChatMessages", () => {
    it("round-trips through loadChatMessages", () => {
      const storage = createStorage();
      const messages = [message("a"), message("b")];
      saveChatMessages(storage, messages);
      expect(loadChatMessages(storage)).toEqual(messages);
    });

    it("persists an empty transcript when cleared", () => {
      const storage = createStorage({ [CHAT_MESSAGES_KEY]: JSON.stringify([message("a")]) });
      saveChatMessages(storage, []);
      expect(storage.data[CHAT_MESSAGES_KEY]).toBe("[]");
      expect(loadChatMessages(storage)).toEqual([]);
    });
  });

  describe("conversation id", () => {
    it("returns null when none is stored", () => {
      expect(loadConversationId(createStorage())).toBeNull();
    });

    it("round-trips the conversation id", () => {
      const storage = createStorage();
      saveConversationId(storage, "abc-123");
      expect(storage.data[CONVERSATION_ID_KEY]).toBe("abc-123");
      expect(loadConversationId(storage)).toBe("abc-123");
    });
  });
});
