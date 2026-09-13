import { SignatureV4 } from "@aws-sdk/signature-v4";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Sha256 } from "@aws-crypto/sha256-js";

/**
 * AWS exposes OpenAI-compatible endpoints (e.g. Bedrock's
 * `https://bedrock-mantle.<region>.api.aws/openai/v1`) that authenticate with SigV4 rather
 * than a Bearer key. The OpenAI SDK only knows how to send `Authorization: Bearer <apiKey>`,
 * so we hand it a custom `fetch` that signs each request with the standard AWS credential
 * chain (env vars, AWS_PROFILE, SSO, instance role). That means no API key has to be minted,
 * pasted into config, or stored at rest.
 *
 * Returns a fetch-compatible function suitable for `configuration.fetch`.
 */
export function createAwsSigV4Fetch({ region, service = "bedrock", credentials } = {}) {
  if (!region) {
    throw new Error("awsSigv4 requires a region");
  }

  const signer = new SignatureV4({
    service,
    region,
    credentials: credentials || defaultProvider(),
    sha256: Sha256
  });

  return async function sigV4Fetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();

    // Normalize headers coming from the OpenAI SDK (Headers instance, array, or object).
    const headers = {};
    const rawHeaders = init.headers || (typeof input !== "string" ? input.headers : undefined);
    if (rawHeaders) {
      if (typeof rawHeaders.forEach === "function" && !Array.isArray(rawHeaders)) {
        rawHeaders.forEach((value, key) => { headers[key] = value; });
      } else {
        for (const [key, value] of Object.entries(rawHeaders)) headers[key] = value;
      }
    }

    // The SDK's Bearer placeholder must not participate in the signature.
    delete headers.authorization;
    delete headers.Authorization;
    headers.host = url.host;

    const body = init.body !== undefined ? init.body : undefined;

    const signed = await signer.sign({
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body: typeof body === "string" ? body : body ? String(body) : undefined
    });

    return fetch(url.toString(), { ...init, method, headers: signed.headers, body });
  };
}
