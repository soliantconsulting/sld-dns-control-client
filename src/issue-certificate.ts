import { setTimeout as sleep } from "node:timers/promises";
import {
    ACMClient,
    CertificateStatus,
    DescribeCertificateCommand,
    type DomainValidation,
    RequestCertificateCommand,
    ValidationMethod,
} from "@aws-sdk/client-acm";
import { DnsControlClient } from "./client.js";
import { defaultConfig, toRelativeName } from "./config.js";

export type IssueCertificateOptions = {
    domainName: string;
    region?: string;
    subjectAlternativeNames?: string[];
    waitForIssued?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
    dnsClient?: DnsControlClient;
    onProgress?: (event: IssueCertificateEvent) => void;
};

export type IssueCertificateEvent =
    | { kind: "requested"; certificateArn: string }
    | { kind: "validation-records-ready"; records: ValidationRecord[] }
    | { kind: "validation-records-published" }
    | { kind: "issued" };

export type ValidationRecord = {
    name: string;
    value: string;
};

const VALIDATION_DISCOVERY_TIMEOUT_MS = 60_000;
const ISSUANCE_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export const issueCertificate = async (options: IssueCertificateOptions): Promise<string> => {
    const acm = new ACMClient({ region: options.region ?? "us-east-1" });
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const request = await acm.send(
        new RequestCertificateCommand({
            DomainName: options.domainName,
            SubjectAlternativeNames: options.subjectAlternativeNames,
            ValidationMethod: ValidationMethod.DNS,
        }),
    );

    const certificateArn = request.CertificateArn;

    if (!certificateArn) {
        throw new Error("ACM did not return a certificate ARN");
    }

    options.onProgress?.({ kind: "requested", certificateArn });

    const records = await waitForValidationRecords(acm, certificateArn, {
        intervalMs: pollIntervalMs,
        timeoutMs: VALIDATION_DISCOVERY_TIMEOUT_MS,
    });

    options.onProgress?.({ kind: "validation-records-ready", records });

    const dns = options.dnsClient ?? new DnsControlClient();

    for (const record of records) {
        await dns.upsertRecord({
            name: toRelativeName(record.name, defaultConfig.zoneName),
            type: "CNAME",
            value: record.value,
        });
    }

    options.onProgress?.({ kind: "validation-records-published" });

    if (options.waitForIssued !== false) {
        await waitForCertificateIssued(acm, certificateArn, {
            intervalMs: pollIntervalMs,
            timeoutMs: options.timeoutMs ?? ISSUANCE_TIMEOUT_MS,
        });
        options.onProgress?.({ kind: "issued" });
    }

    return certificateArn;
};

type PollOptions = {
    intervalMs: number;
    timeoutMs: number;
};

const waitForValidationRecords = async (
    acm: ACMClient,
    certificateArn: string,
    poll: PollOptions,
): Promise<ValidationRecord[]> => {
    const deadline = Date.now() + poll.timeoutMs;

    while (Date.now() < deadline) {
        const records = await tryReadValidationRecords(acm, certificateArn);

        if (records) {
            return records;
        }

        await sleep(poll.intervalMs);
    }

    throw new Error(
        `Timed out waiting for ACM to publish validation records for ${certificateArn}`,
    );
};

const tryReadValidationRecords = async (
    acm: ACMClient,
    certificateArn: string,
): Promise<ValidationRecord[] | null> => {
    const response = await acm.send(
        new DescribeCertificateCommand({ CertificateArn: certificateArn }),
    );
    const validations = response.Certificate?.DomainValidationOptions ?? [];
    const records = validations
        .map(toValidationRecord)
        .filter((record): record is ValidationRecord => record !== null);

    if (records.length !== validations.length || records.length === 0) {
        return null;
    }

    return dedupeRecords(records);
};

const toValidationRecord = (validation: DomainValidation): ValidationRecord | null => {
    const record = validation.ResourceRecord;

    if (!(record?.Name && record.Value)) {
        return null;
    }

    return {
        name: stripTrailingDot(record.Name),
        value: stripTrailingDot(record.Value),
    };
};

const dedupeRecords = (records: ValidationRecord[]): ValidationRecord[] => {
    const seen = new Set<string>();
    const result: ValidationRecord[] = [];

    for (const record of records) {
        const key = `${record.name}|${record.value}`;

        if (!seen.has(key)) {
            seen.add(key);
            result.push(record);
        }
    }

    return result;
};

const waitForCertificateIssued = async (
    acm: ACMClient,
    certificateArn: string,
    poll: PollOptions,
): Promise<void> => {
    const deadline = Date.now() + poll.timeoutMs;

    while (Date.now() < deadline) {
        const response = await acm.send(
            new DescribeCertificateCommand({ CertificateArn: certificateArn }),
        );
        const status = response.Certificate?.Status;

        if (status === CertificateStatus.ISSUED) {
            return;
        }

        if (
            status === CertificateStatus.FAILED ||
            status === CertificateStatus.VALIDATION_TIMED_OUT
        ) {
            throw new Error(`Certificate ${certificateArn} reached status ${status}`);
        }

        await sleep(poll.intervalMs);
    }

    throw new Error(`Timed out waiting for ${certificateArn} to reach ISSUED`);
};

const stripTrailingDot = (value: string): string =>
    value.endsWith(".") ? value.slice(0, -1) : value;
