import { AuthProvider, type AuthProviderOptions } from "./auth.js";
import { type ClientConfig, defaultConfig } from "./config.js";

export const recordTypes = ["A", "AAAA", "CNAME", "TXT"] as const;
export type RecordType = (typeof recordTypes)[number];

export type UpsertRecordInput = {
    name: string;
    type: RecordType;
    value: string;
    ttl?: number;
};

export type DnsControlClientOptions = {
    config?: Partial<ClientConfig>;
    authProvider?: AuthProvider;
    auth?: AuthProviderOptions;
};

export class DnsControlClient {
    private readonly baseUrl: string;
    private readonly authProvider: AuthProvider;

    public constructor(options: DnsControlClientOptions = {}) {
        const config = { ...defaultConfig, ...options.config };
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.authProvider = options.authProvider ?? new AuthProvider({ ...options.auth, config });
    }

    public async upsertRecord(input: UpsertRecordInput): Promise<void> {
        const token = await this.authProvider.getAccessToken();
        const url = `${this.baseUrl}/records/${encodeURIComponent(input.name)}/${input.type}`;
        const body: Record<string, unknown> = { value: input.value };

        if (input.ttl !== undefined) {
            body.ttl = input.ttl;
        }

        const response = await fetch(url, {
            method: "PUT",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
        });

        if (response.status === 204) {
            return;
        }

        const text = await response.text();
        throw new DnsControlError(response.status, text);
    }
}

export class DnsControlError extends Error {
    public readonly status: number;
    public readonly body: string;

    public constructor(status: number, body: string) {
        super(`DNS control API returned ${status}: ${body}`);
        this.name = "DnsControlError";
        this.status = status;
        this.body = body;
    }
}
