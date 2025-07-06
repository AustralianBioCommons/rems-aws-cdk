import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Secret as secretsManager } from "aws-cdk-lib/aws-secretsmanager";
import { Vpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  FargateTaskDefinition,
  ContainerImage,
  Secret,
  FargateService,
  LogDriver,
  PortMapping,
  AwsLogDriverMode,
  PropagatedTagSource,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { HostedZone, ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";
import { Config } from "./config";

interface ComputeStackProps extends StackProps {
  vpc: Vpc;
  db: DatabaseInstance;
  config: Config;
}

export class ComputeStack extends Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, db, config } = props;

    const cluster = new Cluster(this, "Cluster", { vpc, clusterName: "Rems" });

    const taskDef = new FargateTaskDefinition(this, "TaskDef");

    const container = taskDef.addContainer("RemsContainer", {
      image: ContainerImage.fromRegistry(config.containerImage),
      environment: {
        DB_NAME: config.dbName,
        DB_USER: config.dbUser,
      },
      secrets: {
        DB_PASSWORD: Secret.fromSecretsManager(db.secret!, "password"),
      },
      portMappings: [{ containerPort: 3000 }],
      logging: LogDriver.awsLogs({
        streamPrefix: "Rems",
        logRetention: 7, // days
        mode: AwsLogDriverMode.NON_BLOCKING,
      }),
    });

    const service = new FargateService(this, "Service", {
      cluster,
      taskDefinition: taskDef,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      propagateTags: PropagatedTagSource.SERVICE,
      enableECSManagedTags: true,
    });

    const lb = new ApplicationLoadBalancer(this, "LB", {
      vpc,
      internetFacing: true,
    });

    const cert = Certificate.fromCertificateArn(
      this,
      "Cert",
      config.certificateArn
    );

    const listener = lb.addListener("HttpsListener", {
      port: 443,
      certificates: [cert],
    });

    listener.addTargets("ECS", {
      port: 3000,
      protocol: ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/health",
        interval: Duration.seconds(30),
      },
    });
  }
}
