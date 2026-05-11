import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import envPaths from "env-paths";

export type { ICachePlugin } from "@azure/msal-node";

export const cacheFilePath = (): string =>
    `${envPaths("sld-dns-control", { suffix: "" }).config}/auth-cache.json`;

export const createFileCachePlugin = (path: string = cacheFilePath()): ICachePlugin => ({
    beforeCacheAccess: async (context: TokenCacheContext): Promise<void> => {
        try {
            const data = await readFile(path, "utf8");
            context.tokenCache.deserialize(data);
        } catch (error) {
            if (!isFileNotFound(error)) {
                throw error;
            }
        }
    },
    afterCacheAccess: async (context: TokenCacheContext): Promise<void> => {
        if (!context.cacheHasChanged) {
            return;
        }

        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, context.tokenCache.serialize(), { mode: 0o600 });
    },
});

export const clearCache = async (path: string = cacheFilePath()): Promise<void> => {
    await rm(path, { force: true });
};

const isFileNotFound = (error: unknown): boolean =>
    error instanceof Error && "code" in error && error.code === "ENOENT";
