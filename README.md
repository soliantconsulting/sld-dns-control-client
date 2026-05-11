# @soliantconsulting/sld-dns-control-client

Client library and CLI for the Soliant Dev DNS control API. Authenticates against Microsoft Entra
using the OAuth 2.0 authorization-code-with-PKCE flow and upserts Route 53 records.

## Install

```sh
pnpm add @soliantconsulting/sld-dns-control-client
```

Or use the CLI without installing:

```sh
pnpx @soliantconsulting/sld-dns-control-client upsert api A 203.0.113.10
```

## CLI

```sh
sld-dns-control login                          # interactive sign-in
sld-dns-control logout                         # clear cached tokens
sld-dns-control upsert <name> <type> <value>   # upsert a record (TTL defaults to 300)
sld-dns-control upsert api A 203.0.113.10 --ttl 600
sld-dns-control point-staging-domain           # wire the staging CNAME to the deployed stack's target
sld-dns-control issue-cert <domain>            # request an ACM cert and publish its DNS validation records
```

The first command that needs a token (or explicit `login`) opens your browser for sign-in. Tokens
are cached at the OS user-config location (`~/.config/sld-dns-control/auth-cache.json` on Linux)
and refreshed silently on subsequent calls.

### `point-staging-domain`

Run this from the project root after a successful staging deploy. It reads `.sld-dns-control.json`,
finds the staging stack's CNAME target (CloudFront distribution domain or ALB DNS name), and
upserts the staging CNAME via the API.

The starter writes `.sld-dns-control.json` at scaffold time:

```json
{
    "staging": {
        "stack": "myapp-staging",
        "domain": "myapp.staging.soliant-dev.io"
    }
}
```

AWS credentials are read from the default provider chain (env vars, profile, SSO, OIDC) — the
same way the CDK deploy reads them. The CLI looks for either:

- a `DistributionDomainName` output (React/CloudFront starters)
- an output key ending in `LoadBalancerDNS` (Taxum/ALB starters — auto-emitted by
  `ApplicationLoadBalancedFargateService`)

### `issue-cert`

Requests an ACM certificate with DNS validation, publishes the validation CNAMEs via the DNS API,
and waits for the cert to issue.

```sh
sld-dns-control issue-cert myapp.staging.soliant-dev.io
sld-dns-control issue-cert "*.staging.soliant-dev.io" --san staging.soliant-dev.io
sld-dns-control issue-cert myapp.soliant-dev.io --region us-west-2 --no-wait
```

Defaults to `us-east-1` (required for CloudFront). `--no-wait` returns after publishing
validation records — useful when the caller wants to poll for issuance separately. The cert ARN
is written to stdout; progress goes to stderr.

The same flow is available as a library function:

```ts
import { issueCertificate } from "@soliantconsulting/sld-dns-control-client";

const certArn = await issueCertificate({
    domainName: "myapp.staging.soliant-dev.io",
    onProgress: (event) => console.log(event),
});
```

## Library

```ts
import { DnsControlClient } from "@soliantconsulting/sld-dns-control-client";

const client = new DnsControlClient();

await client.upsertRecord({
    name: "api",
    type: "A",
    value: "203.0.113.10",
    ttl: 300,
});
```

`DnsControlClient` lazily acquires a token on the first call. Use `name: "@"` for the zone apex.
TXT values are sent raw — the server quotes them.

### Overriding defaults

```ts
import { AuthProvider, DnsControlClient } from "@soliantconsulting/sld-dns-control-client";

const auth = new AuthProvider({
    config: {
        tenantId: "...",
        clientId: "...",
        scopes: ["api://.../.default"],
    },
});

const client = new DnsControlClient({
    config: { baseUrl: "https://other-api.example.com" },
    authProvider: auth,
});
```

## License

MIT
