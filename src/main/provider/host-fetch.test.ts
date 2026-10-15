import { describe, expect, it, vi } from "vitest";
import { createStandardFetch } from "./host-fetch";

import type { Main } from "@freelensapp/extensions";

type HostFetch = typeof Main.Util.fetch;

describe("createStandardFetch", () => {
  const hostResponse = new Response("{}", { status: 200 });
  const hostFetch = vi.fn<HostFetch>(async () => hostResponse as unknown as Awaited<ReturnType<HostFetch>>);
  const standardFetch = createStandardFetch(hostFetch);

  it("hands a URL and its init to the host's fetch and returns its response as it is", async () => {
    const init = { method: "POST", headers: { authorization: "Bearer key" }, body: "{}" };

    expect(await standardFetch("https://api.example.com/v1/chat/completions", init)).toBe(hostResponse);
    expect(hostFetch).toHaveBeenLastCalledWith("https://api.example.com/v1/chat/completions", init);

    const url = new URL("https://api.example.com/v1/models");
    await standardFetch(url);
    expect(hostFetch).toHaveBeenLastCalledWith(url, undefined);
  });

  it("refuses a Request, whose method, headers and body would be lost", async () => {
    hostFetch.mockClear();

    await expect(standardFetch(new Request("https://api.example.com/v1/models"))).rejects.toThrow(
      "The host fetch takes a URL, not a Request.",
    );
    expect(hostFetch).not.toHaveBeenCalled();
  });
});
