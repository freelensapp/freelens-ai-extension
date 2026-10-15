// The one place the extension asserts a host type. `Main.Util.fetch` is typed
// with the structural `Fetch` of the extension API, a supertype of the fetch
// implementations Freelens runs, which is not assignable to the standard
// `fetch` a bundled client such as the OpenAI SDK takes: the standard type
// admits `Request` inputs and `Blob` or `FormData` bodies, and its `Response`
// has members (`clone()`, `url`, ...) the structural one does not name. At
// runtime main's fetch is undici's, whose `Response` is a full one, so the
// assertion below narrows nothing that exists; the host asserts at the same
// boundary itself.

import type { Main } from "@freelensapp/extensions";

type HostFetch = typeof Main.Util.fetch;
type HostFetchInit = NonNullable<Parameters<HostFetch>[1]>;

/**
 * Wraps the host's fetch as a standard `fetch`. A `Request` input is refused:
 * its method, headers and body would be lost, and the clients that use this
 * fetch pass a URL and an init.
 */
export const createStandardFetch =
  (hostFetch: HostFetch): typeof globalThis.fetch =>
  async (input, init) => {
    if (typeof input !== "string" && !(input instanceof URL)) {
      throw new TypeError("The host fetch takes a URL, not a Request.");
    }
    const response = await hostFetch(input, init as HostFetchInit | undefined);
    return response as unknown as Response;
  };
