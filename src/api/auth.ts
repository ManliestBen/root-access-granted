/**
 * Passkey (WebAuthn) auth API and helpers.
 * Browser credential options must use ArrayBuffer; server uses base64url.
 */

const API_BASE = (import.meta.env.VITE_GARDYN_API_URL ?? "").trim();

function base64urlToBuffer(s: string): ArrayBuffer {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBuffer(id: string | number[]): ArrayBuffer {
  if (typeof id === "string") return base64urlToBuffer(id);
  return new Uint8Array(id).buffer;
}

function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function prepareCredentialForServer(cred: PublicKeyCredential): Record<string, unknown> {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  };
}

function prepareCreationCredentialForServer(cred: PublicKeyCredential): Record<string, unknown> {
  const response = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
    },
  };
}

export type RegisterOptions = {
  rp: { name: string; id: string };
  user: { id: string | number[]; name: string; displayName?: string; display_name?: string };
  challenge: string;
  pubKeyCredParams: { type: string; alg: number }[];
  timeout?: number;
  authenticatorSelection?: Record<string, unknown>;
};

export type LoginOptions = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: { type: string; id: string }[];
};

export const authApi = {
  getRegisterOptions: (email: string): Promise<RegisterOptions> => {
    const params = new URLSearchParams();
    if (email.trim()) params.set("email", email.trim().toLowerCase());
    const qs = params.toString();
    const url = `${API_BASE}/auth/register/options${qs ? `?${qs}` : ""}`;
    return fetch(url).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      return data as RegisterOptions;
    });
  },

  register: (credential: Record<string, unknown>, email: string): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, email: email.trim().toLowerCase() || undefined }),
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      return data;
    }),

  getLoginOptions: (): Promise<LoginOptions> =>
    fetch(`${API_BASE}/auth/login/options`).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      return data as LoginOptions;
    }),

  login: (
    credential: Record<string, unknown>
  ): Promise<{ token: string; user: { id: number; name: string } }> =>
    fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      return data;
    }),

  me: (token: string): Promise<{ user: { id: number; name: string } }> =>
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (r) => {
      if (!r.ok) throw new Error("Unauthorized");
      return r.json();
    }),
};

/**
 * Convert server options to PublicKeyCredentialCreationOptions for the browser.
 */
export function toCreationOptions(serverOptions: RegisterOptions): CredentialCreationOptions {
  const user = serverOptions.user;
  return {
    publicKey: {
      rp: serverOptions.rp,
      user: {
        id: toBuffer(user.id),
        name: user.name,
        displayName: user.displayName ?? user.display_name ?? user.name,
      },
      challenge: base64urlToBuffer(serverOptions.challenge),
      pubKeyCredParams: serverOptions.pubKeyCredParams,
      timeout: serverOptions.timeout,
      authenticatorSelection: serverOptions.authenticatorSelection,
    },
  };
}

/**
 * Convert server options to PublicKeyCredentialRequestOptions for the browser.
 */
export function toRequestOptions(serverOptions: LoginOptions): CredentialRequestOptions {
  return {
    publicKey: {
      challenge: base64urlToBuffer(serverOptions.challenge),
      timeout: serverOptions.timeout,
      rpId: serverOptions.rpId,
      allowCredentials: serverOptions.allowCredentials?.map((c) => ({
        type: "public-key" as const,
        id: base64urlToBuffer(c.id),
      })),
    },
  };
}

export async function registerPasskey(email: string): Promise<void> {
  const options = await authApi.getRegisterOptions(email);
  const cred = await navigator.credentials.create(toCreationOptions(options));
  if (!cred || !(cred instanceof PublicKeyCredential)) throw new Error("Failed to create credential");
  await authApi.register(prepareCreationCredentialForServer(cred), email);
}

export async function loginPasskey(): Promise<{ token: string; user: { id: number; name: string } }> {
  const options = await authApi.getLoginOptions();
  const cred = await navigator.credentials.get(toRequestOptions(options));
  if (!cred || !(cred instanceof PublicKeyCredential)) throw new Error("Failed to get credential");
  return authApi.login(prepareCredentialForServer(cred));
}
