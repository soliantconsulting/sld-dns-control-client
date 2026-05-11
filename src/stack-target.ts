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
            `Stack ${options.stackName} has no DistributionDomainName or *LoadBalancerDNS output`,
        );
    }

    return target;
};

const pickTargetOutput = (outputs: Output[]): string | null => {
    const explicit = outputs.find((output) => output.OutputKey === "DistributionDomainName");

    if (explicit?.OutputValue) {
        return explicit.OutputValue;
    }

    const albOutput = outputs.find((output) => output.OutputKey?.endsWith("LoadBalancerDNS"));
    return albOutput?.OutputValue ?? null;
};
