import {
    CloudFormationClient,
    DescribeStacksCommand,
    type Output,
} from "@aws-sdk/client-cloudformation";

export type StackTargetOptions = {
    stackName: string;
    region?: string;
};

export const resolveStackTarget = async (options: StackTargetOptions): Promise<string> => {
    const client = new CloudFormationClient({ region: options.region });
    const response = await client.send(new DescribeStacksCommand({ StackName: options.stackName }));
    const stack = response.Stacks?.[0];

    if (!stack) {
        throw new Error(`Stack ${options.stackName} not found`);
    }

    const outputs = stack.Outputs ?? [];
    const target = pickTargetOutput(outputs);

    if (!target) {
        throw new Error(
            `Stack ${options.stackName} has no DistributionDomainName or *LoadBalancerDNS[hash] output`,
        );
    }

    return target;
};

const pickTargetOutput = (outputs: Output[]): string | null => {
    const explicit = outputs.find((output) => output.OutputKey === "DistributionDomainName");

    if (explicit?.OutputValue) {
        return explicit.OutputValue;
    }

    // CDK suffixes the logical id of an output made inside a construct with an 8-character
    // hash, so ApplicationLoadBalancedFargateService's output is "ServiceLoadBalancerDNSEC5B149E",
    // not "ServiceLoadBalancerDNS".
    const albOutput = outputs.find((output) =>
        /LoadBalancerDNS(?:[0-9A-F]{8})?$/.test(output.OutputKey ?? ""),
    );
    return albOutput?.OutputValue ?? null;
};
