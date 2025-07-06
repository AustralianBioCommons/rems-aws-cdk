import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc, IpAddresses } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { Config } from "./config";

interface NetworkStackProps extends StackProps {
  config: Config;
}

export class NetworkStack extends Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.vpc = new Vpc(this, "Vpc", {
      maxAzs: 3,
      ipAddresses: IpAddresses.cidr(config.vpcCidr),
    });
  }
}
