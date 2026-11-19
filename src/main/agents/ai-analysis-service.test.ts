import { Main } from "@freelensapp/extensions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIProviders } from "../../common/provider/ai-models";
import { PreferencesStore } from "../../common/store";
import { useAiAnalysisService } from "./ai-analysis-service";

const preferences = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

// A streamed answer of the Responses API: its text arrives as content blocks,
// not as a string.
const responsesStream = (texts: string[]) => {
  const response = { id: "resp_1", object: "response", created_at: 0, model: "gpt-6.1-sol", output: [] };
  const message = { type: "message", id: "msg_1", role: "assistant" };
  const events = [
    { type: "response.created", response: { ...response, status: "in_progress" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...message, status: "in_progress", content: [] },
    },
    ...texts.map((delta) => ({
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta,
    })),
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        ...message,
        status: "completed",
        content: [{ type: "output_text", text: texts.join(""), annotations: [] }],
      },
    },
    {
      type: "response.completed",
      response: {
        ...response,
        status: "completed",
        usage: { input_tokens: 3, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2 },
      },
    },
  ];
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

beforeEach(() => {
  PreferencesStore.resetInstance();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.mocked(Main.Util.fetch).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("useAiAnalysisService().analyze", () => {
  it("yields the text of a model answered through the Responses API", async () => {
    vi.mocked(Main.Util.fetch).mockImplementation(
      async () => responsesStream(["The event ", "is a warning."]) as never,
    );
    preferences().openAIKey = "preferences-key";
    preferences().models = [{ provider: AIProviders.OPEN_AI, name: "gpt-6.1-sol" }];
    preferences().selectedModel = "gpt-6.1-sol";

    const chunks: string[] = [];
    for await (const chunk of useAiAnalysisService().analyze("Back-off restarting", new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(String(vi.mocked(Main.Util.fetch).mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/responses");
    expect(chunks.join("")).toBe("The event is a warning.");
  });
});
