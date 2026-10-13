import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { fetchModelPricing } from "./model-pricing-provider";

import type { Main } from "@freelensapp/extensions";

type HostFetch = typeof Main.Util.fetch;

const PUBLIC_PRICE_LIST_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

// A host fetch answering each URL from a map; any other URL fails.
const fetchFrom = (answers: Record<string, unknown>) =>
  vi.fn<HostFetch>(async (url) => {
    const key = String(url);
    if (!(key in answers)) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Awaited<ReturnType<HostFetch>>;
    }
    return { ok: true, status: 200, json: async () => answers[key] } as unknown as Awaited<ReturnType<HostFetch>>;
  });

const headersOf = (fetch: ReturnType<typeof fetchFrom>, url: string) =>
  fetch.mock.calls.find(([called]) => String(called) === url)?.[1]?.headers as Record<string, string> | undefined;

describe("fetchModelPricing", () => {
  it("asks nothing when no model is configured", async () => {
    const fetch = fetchFrom({});

    expect(await fetchModelPricing({ modelNames: [], openAIBaseUrl: "", apiKey: "key", fetch })).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes the prices from the endpoint's /model/info, sent with the key", async () => {
    const fetch = fetchFrom({
      "http://litellm.local:4000/model/info": {
        data: [{ model_name: "gpt-5.5", model_info: { input_cost_per_token: 1e-6, output_cost_per_token: 8e-6 } }],
      },
    });

    const pricing = await fetchModelPricing({
      modelNames: ["gpt-5.5"],
      openAIBaseUrl: "http://litellm.local:4000/",
      apiKey: "secret",
      fetch,
    });

    expect(pricing["gpt-5.5"]).toMatchObject({ inputCostPerToken: 1e-6, outputCostPerToken: 8e-6 });
    expect(headersOf(fetch, "http://litellm.local:4000/model/info")).toEqual({ authorization: "Bearer secret" });
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(PUBLIC_PRICE_LIST_URL);
  });

  it("falls back to the public price list, fetched without the key", async () => {
    const fetch = fetchFrom({
      [PUBLIC_PRICE_LIST_URL]: { "gpt-5.5": { input_cost_per_token: 2e-6, output_cost_per_token: 9e-6 } },
    });

    const pricing = await fetchModelPricing({
      modelNames: ["gpt-5.5"],
      openAIBaseUrl: DEFAULT_OPENAI_BASE_URL,
      apiKey: "secret",
      fetch,
    });

    expect(pricing["gpt-5.5"]).toMatchObject({ inputCostPerToken: 2e-6, outputCostPerToken: 9e-6 });
    // The stock OpenAI endpoint has no /model/info, so only the list is asked.
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([PUBLIC_PRICE_LIST_URL]);
    expect(headersOf(fetch, PUBLIC_PRICE_LIST_URL)).toEqual({});
  });

  it("degrades to no price when every source fails", async () => {
    const fetch = vi.fn<HostFetch>(async () => {
      throw new TypeError("fetch failed");
    });

    expect(
      await fetchModelPricing({
        modelNames: ["gpt-5.5"],
        openAIBaseUrl: "http://litellm.local:4000",
        apiKey: "k",
        fetch,
      }),
    ).toEqual({});
  });
});
