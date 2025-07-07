import { Stack, StackProps } from "aws-cdk-lib";
import {
  Vpc,
  IpAddresses,
  SecurityGroup,
  Peer,
  Port,
  InterfaceVpcEndpoint,
  InterfaceVpcEndpointAwsService,
  GatewayVpcEndpointAwsService,
} from "aws-cdk-lib/aws-ec2";
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
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Create a Security Group for the ECS cluster instances
    const endpointSecurityGroup = new SecurityGroup(
      this,
      "EndpointsSecurityGroup",
      {
        vpc: this.vpc,
        description: "Allow traffic to ECS cluster instances",
        allowAllOutbound: true, 
      }
    );

    // Add Ingress Rule to allow inbound SSH traffic (port 22)
    endpointSecurityGroup.addIngressRule(
      Peer.ipv4(config.vpcCidr),
      Port.tcp(443),
      "Allow port HTTPS from all vpc traffic"
    );

    this.vpc.addGatewayEndpoint("S3GatewayEndpoint", {
      service: GatewayVpcEndpointAwsService.S3,
    });

    new InterfaceVpcEndpoint(this, "S3Endpoint", {
      vpc: this.vpc,
      service: InterfaceVpcEndpointAwsService.S3,
      securityGroups: [endpointSecurityGroup],
    });

    new InterfaceVpcEndpoint(this, "SSMEndpoint", {
        vpc: this.vpc,
      service: InterfaceVpcEndpointAwsService.SSM,
      securityGroups: [endpointSecurityGroup],
    });

    new InterfaceVpcEndpoint(this, "SSMMessagesEndpoint", {
      vpc: this.vpc,
      service: InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      securityGroups: [endpointSecurityGroup],
    });

    new InterfaceVpcEndpoint(this, "EC2MessagesEndpoint", {
      vpc: this.vpc,
      service: InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      securityGroups: [endpointSecurityGroup],
    });

    new InterfaceVpcEndpoint(this, "SecretsManagerEndpoint", {
      vpc: this.vpc,
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      privateDnsEnabled: true,
      securityGroups: [endpointSecurityGroup],
    });
  }
}
