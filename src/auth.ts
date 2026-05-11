import { spawn } from "node:child_process";
import { platform } from "node:process";
import {
    type AccountInfo,
    type AuthenticationResult,
    InteractionRequiredAuthError,
    PublicClientApplication,
} from "@azure/msal-node";
import { createFileCachePlugin, type ICachePlugin } from "./cache.js";
import { type ClientConfig, defaultConfig } from "./config.js";

export type AuthProviderOptions = {
    config?: Partial<ClientConfig>;
    cachePlugin?: ICachePlugin;
    openBrowser?: (url: string) => Promise<void>;
};

export class AuthProvider {
    private readonly pca: PublicClientApplication;
    private readonly scopes: string[];
    private readonly openBrowser: (url: string) => Promise<void>;

    public constructor(options: AuthProviderOptions = {}) {
        const config = { ...defaultConfig, ...options.config };
        this.pca = new PublicClientApplication({
            auth: {
                clientId: config.clientId,
                authority: `https://login.microsoftonline.com/${config.tenantId}`,
            },
            cache: {
                cachePlugin: options.cachePlugin ?? createFileCachePlugin(),
            },
        });
        this.scopes = config.scopes;
        this.openBrowser = options.openBrowser ?? defaultOpenBrowser;
    }

    public async getAccessToken(): Promise<string> {
        const account = await this.getStoredAccount();

        if (account) {
            try {
                const result = await this.pca.acquireTokenSilent({
                    account,
                    scopes: this.scopes,
                });

                return result.accessToken;
            } catch (error) {
                if (!(error instanceof InteractionRequiredAuthError)) {
                    throw error;
                }
            }
        }

        const result = await this.acquireInteractive();
        return result.accessToken;
    }

    public async login(): Promise<AccountInfo> {
        const result = await this.acquireInteractive();
        return result.account ?? raiseMissingAccount();
    }

    public async logout(): Promise<void> {
        const cache = this.pca.getTokenCache();
        const accounts = await cache.getAllAccounts();

        for (const account of accounts) {
            await cache.removeAccount(account);
        }
    }

    private async getStoredAccount(): Promise<AccountInfo | null> {
        const accounts = await this.pca.getTokenCache().getAllAccounts();
        return accounts[0] ?? null;
    }

    private acquireInteractive(): Promise<AuthenticationResult> {
        return this.pca.acquireTokenInteractive({
            scopes: this.scopes,
            openBrowser: this.openBrowser,
        });
    }
}

const defaultOpenBrowser = async (url: string): Promise<void> => {
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
};

const raiseMissingAccount = (): never => {
    throw new Error("Interactive auth completed without returning an account");
};
