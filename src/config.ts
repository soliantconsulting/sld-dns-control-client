export type ClientConfig = {
    baseUrl: string;
    zoneName: string;
    tenantId: string;
    clientId: string;
    scopes: string[];
};

export const defaultConfig: ClientConfig = {
    baseUrl: "https://ww05l9r3q1.execute-api.us-east-1.amazonaws.com",
    zoneName: "soliant-dev.io",
    tenantId: "dac9d173-599d-4670-a410-7a81ded8f12b",
    clientId: "1b7e3e24-0e8a-474f-95a5-45498d302c57",
    scopes: ["1b7e3e24-0e8a-474f-95a5-45498d302c57/.default"],
};

export const toRelativeName = (fqdn: string, zoneName: string): string => {
    if (fqdn === zoneName) {
        return "@";
    }

    const suffix = `.${zoneName}`;

    if (!fqdn.endsWith(suffix)) {
        throw new Error(`Domain "${fqdn}" is not within the configured zone "${zoneName}"`);
    }

    return fqdn.slice(0, -suffix.length);
};
