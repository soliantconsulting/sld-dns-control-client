#!/usr/bin/env node
import { Command, Option } from "@commander-js/extra-typings";
import { AuthProvider } from "./auth.js";
import { clearCache } from "./cache.js";
import { DnsControlClient, DnsControlError, type RecordType, recordTypes } from "./client.js";
import { defaultConfig, toRelativeName } from "./config.js";
import { issueCertificate } from "./issue-certificate.js";
import { loadProjectConfig } from "./project-config.js";
import { resolveStackTarget } from "./stack-target.js";

const collect = (value: string, previous: string[]): string[] => [...previous, value];

const program = new Command().name("sld-dns-control").description("Soliant Dev DNS control CLI");

program
    .command("login")
    .description("Authenticate with Entra and cache tokens for subsequent commands")
    .action(async () => {
        const auth = new AuthProvider();
        const account = await auth.login();
        process.stdout.write(`Signed in as ${account.username}\n`);
    });

program
    .command("logout")
    .description("Clear cached tokens")
    .action(async () => {
        const auth = new AuthProvider();
        await auth.logout();
        await clearCache();
        process.stdout.write("Signed out\n");
    });

program
    .command("upsert")
    .description("Upsert a DNS record")
    .argument("<name>", "subdomain relative to the zone (use '@' for the apex)")
    .argument("<type>", `record type (${recordTypes.join("|")})`)
    .argument("<value>", "record value (TXT values: send raw, will be quoted)")
    .addOption(
        new Option("--ttl <seconds>", "record TTL in seconds (60–86400)").argParser((value) => {
            const parsed = Number.parseInt(value, 10);

            if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86400) {
                throw new Error("--ttl must be an integer between 60 and 86400");
            }

            return parsed;
        }),
    )
    .action(async (name, typeArg, value, options) => {
        if (!recordTypes.includes(typeArg as RecordType)) {
            process.stderr.write(
                `Invalid type: ${typeArg}. Expected one of ${recordTypes.join(", ")}\n`,
            );
            process.exit(2);
        }

        const type = typeArg as RecordType;
        const client = new DnsControlClient();

        try {
            await client.upsertRecord({ name, type, value, ttl: options.ttl });
            process.stdout.write(`Upserted ${name} ${type}\n`);
        } catch (error) {
            if (error instanceof DnsControlError) {
                process.stderr.write(`API error (${error.status}): ${error.body}\n`);
                process.exit(1);
            }

            throw error;
        }
    });

program
    .command("point-staging-domain")
    .description("Point the configured staging subdomain at the deployed stack's target")
    .action(async () => {
        const projectConfig = await loadProjectConfig();
        const staging = projectConfig.staging;

        if (!staging) {
            process.stderr.write("No 'staging' entry in .sld-dns-control.json\n");
            process.exit(2);
        }

        const target = await resolveStackTarget({ stackName: staging.stack });
        const relativeName = toRelativeName(staging.domain, defaultConfig.zoneName);
        const client = new DnsControlClient();

        try {
            await client.upsertRecord({ name: relativeName, type: "CNAME", value: target });
            process.stdout.write(`Pointed ${staging.domain} at ${target}\n`);
        } catch (error) {
            if (error instanceof DnsControlError) {
                process.stderr.write(`API error (${error.status}): ${error.body}\n`);
                process.exit(1);
            }

            throw error;
        }
    });

program
    .command("issue-cert")
    .description("Request an ACM certificate with DNS validation and wait for it to issue")
    .argument("<domain>", "primary domain name (e.g. myapp.staging.soliant-dev.io)")
    .option("--region <region>", "ACM region (defaults to us-east-1; required for CloudFront)")
    .option(
        "--san <name>",
        "subject alternative name (repeat for multiple)",
        collect,
        [] as string[],
    )
    .option("--no-wait", "return after publishing validation records, don't wait for ISSUED")
    .action(async (domain, options) => {
        try {
            const certArn = await issueCertificate({
                domainName: domain,
                region: options.region,
                subjectAlternativeNames: options.san.length > 0 ? options.san : undefined,
                waitForIssued: options.wait,
                onProgress: (event) => {
                    if (event.kind === "requested") {
                        process.stderr.write(`Requested ${event.certificateArn}\n`);
                    } else if (event.kind === "validation-records-ready") {
                        process.stderr.write(
                            `Publishing ${event.records.length} validation record(s)…\n`,
                        );
                    } else if (event.kind === "validation-records-published") {
                        process.stderr.write(
                            "Validation records published, waiting for issuance…\n",
                        );
                    } else if (event.kind === "issued") {
                        process.stderr.write("Issued\n");
                    }
                },
            });
            process.stdout.write(`${certArn}\n`);
        } catch (error) {
            if (error instanceof DnsControlError) {
                process.stderr.write(`API error (${error.status}): ${error.body}\n`);
                process.exit(1);
            }

            throw error;
        }
    });

await program.parseAsync(process.argv);
