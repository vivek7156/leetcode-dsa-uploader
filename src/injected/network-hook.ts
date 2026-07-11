type HookMessage = {
  source: "dsa-uploader";
  payload: Record<string, unknown>;
};

const originalFetch = window.fetch.bind(window);

window.fetch = async (...args: Parameters<typeof window.fetch>) => {
  const [input, init] = args;
  let url = "";
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof Request) {
    url = input.url;
  } else {
    url = String(input);
  }

  // attempt to capture body if provided
  let body: unknown = undefined;
  try {
    if (init && (init as RequestInit).body) {
      const b = (init as RequestInit).body;
      if (typeof b === "string") {
        body = b;
      } else if (b instanceof URLSearchParams) {
        body = b.toString();
      } else if ((b as any).toString) {
        body = String(b as any);
      }
    } else if (input instanceof Request) {
      try {
        const clonedReq = input.clone();
        body = await clonedReq.text();
      } catch (err) {
        // ignore
      }
    }
  } catch (err) {
    body = undefined;
  }

  const response = await originalFetch(...args);
  let responseBody: unknown = undefined;
  try {
    const cloned = response.clone();
    const text = await cloned.text();
    if (text) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = text;
      }
    }
  } catch {
    responseBody = undefined;
  }

  const isGraphql = url.includes("/graphql");
  const isSubmit = url.includes("/submit");
  const isCheck = url.includes("/check");

  if (isGraphql || isSubmit || isCheck) {
    // try parse JSON variables from body
    let parsed: any = undefined;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        parsed = body;
      }
    }

    window.postMessage({
      source: "dsa-uploader",
      payload: {
        kind: isGraphql ? "graphql-fetch" : isSubmit ? "submit-fetch" : "check-fetch",
        url,
        status: response.status,
        body: parsed,
        response: responseBody
      }
    } satisfies HookMessage, "*");
  }

  return response;
};

const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function open(
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null
) {
  (this as XMLHttpRequest & { __dsaUploaderUrl?: string; __dsaUploaderMethod?: string }).__dsaUploaderUrl = String(url);
  (this as XMLHttpRequest & { __dsaUploaderUrl?: string; __dsaUploaderMethod?: string }).__dsaUploaderMethod = method;
  return originalOpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.send = function send(body?: XMLHttpRequestBodyInit | null) {
  this.addEventListener("loadend", () => {
    const target = this as XMLHttpRequest & { __dsaUploaderUrl?: string; __dsaUploaderMethod?: string };
    const url = target.__dsaUploaderUrl || "";
    const isGraphql = url.includes("/graphql");
    const isSubmit = url.includes("/submit");
    const isCheck = url.includes("/check");

    if (isGraphql || isSubmit || isCheck) {
      let parsedBody: unknown = undefined;
      if (typeof body === "string") {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      } else if (body instanceof URLSearchParams) {
        parsedBody = body.toString();
      } else if (body) {
        parsedBody = String(body);
      }

      let responseBody: unknown = undefined;
      try {
        const text = this.responseText;
        if (text) {
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text;
          }
        }
      } catch {
        responseBody = undefined;
      }

      window.postMessage(
        {
          source: "dsa-uploader",
          payload: {
            kind: isGraphql ? "graphql-xhr" : isSubmit ? "submit-xhr" : "check-xhr",
            method: target.__dsaUploaderMethod,
            url: url,
            status: this.status,
            body: parsedBody,
            response: responseBody
          }
        } satisfies HookMessage,
        "*"
      );
    }
  });

  return originalSend.apply(this, [body] as [XMLHttpRequestBodyInit | null | undefined]);
};
