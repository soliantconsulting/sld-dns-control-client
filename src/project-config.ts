import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const CONFIG_FILE_NAME = ".sld-dns-control.json";

const envSchema = z.object({
    stack: z.string().min(1),
    domain: z.hostname(),
});

const projectConfigSchema = z.object({
    staging: envSchema.optional(),
    production: envSchema.optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const findProjectConfigPath = async (startDir: string = process.cwd()): Promise<string> => {
    let current = resolve(startDir);

    while (true) {
        const candidate = resolve(current, CONFIG_FILE_NAME);

        try {
            await readFile(candidate);
            return candidate;
        } catch (error) {
            if (!isFileNotFound(error)) {
                throw error;
            }
        }

        const parent = dirname(current);

        if (parent === current) {
            throw new Error(`${CONFIG_FILE_NAME} not found in ${startDir} or any parent directory`);
        }

        current = parent;
    }
};

export const loadProjectConfig = async (path?: string): Promise<ProjectConfig> => {
    const configPath = path ?? (await findProjectConfigPath());
    const raw = await readFile(configPath, "utf8");
    return projectConfigSchema.parse(JSON.parse(raw));
};

const isFileNotFound = (error: unknown): boolean =>
    error instanceof Error && "code" in error && error.code === "ENOENT";
