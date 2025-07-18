import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ISecret, Secret  } from "aws-cdk-lib/aws-secretsmanager";
import { Vpc, SubnetType, SecurityGroup, Port, Peer } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  FargateTaskDefinition,
  ContainerImage,
  Secret as ECSSecret,
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
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Config } from "../config/config";
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";

interface ComputeStackProps extends StackProps {
  vpc: Vpc;
  config: Config;
}

export class ComputeStack extends Stack {
  public readonly cluster: Cluster
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, config } = props;

    this.cluster = new Cluster(this, "Cluster", { vpc, clusterName: "Rems" });

    const dbSecretName = ssm.StringParameter.fromStringParameterAttributes(
      this,
      "DbSecretName",
      {
        parameterName: `/rems/${config.deployEnvironment}/db-secret-name`,
      }
    );

    const webAclArn = ssm.StringParameter.fromStringParameterAttributes(
      this,
      "webAclArn",
      {
        parameterName: `/rems/${config.deployEnvironment}/webAclArn`,
      }
    );

    const dbSecret = Secret.fromSecretNameV2(
      this,
      "DbSecret",
      dbSecretName.stringValue
    );

    const executionRole = new Role(this, "RemsExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Explicit execution role for REMS Fargate tasks",
      roleName: `${config.deployEnvironment}-rems-task-execution-role`,
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });

    const taskDef = new FargateTaskDefinition(this, "TaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole: executionRole,
    });

    const privateKeySecret = Secret.fromSecretNameV2(
      this,
      "PrivateKey",
      "rems/visa/private-key.jwk"
    );
    const publicKeySecret = Secret.fromSecretNameV2(
      this,
      "PublicKey",
      "rems/visa/public-key.jwk"
    );

    const oidcSecret = Secret.fromSecretCompleteArn(
      this,
      "OidcSecret",
      config.oidcClientSecretArn
    );

    executionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:rems/visa/*`,
        ],
      })
    );

    executionRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:rems-oidc-client-secret-??????`,
        ],
      })
    );

    executionRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ],
        resources: [
          `arn:aws:ecr:${this.region}:${this.account}:repository/rems`,
        ],
      })
    );

    executionRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      })
    );

    executionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        resources: ["*"],
      })
    );

    const container = taskDef.addContainer("RemsContainer", {
      image: ContainerImage.fromRegistry(config.containerImage),
      environment: {
        DB_NAME: config.dbName,
        DB_USER: config.dbUser,
        PUBLIC_URL: config.publicUrl,
        CMD: "start",
      },
      secrets: {
        DB_PASSWORD: ECSSecret.fromSecretsManager(dbSecret!, "password"),
        DB_HOST: ECSSecret.fromSecretsManager(dbSecret!, "host"),
        DB_PORT: ECSSecret.fromSecretsManager(dbSecret!, "port"),
        OIDC_METADATA_URL: ECSSecret.fromSecretsManager(
          oidcSecret,
          "oidc-metadata-url"
        ),
        OIDC_CLIENT_ID: ECSSecret.fromSecretsManager(
          oidcSecret,
          "oidc-client-id"
        ),
        OIDC_CLIENT_SECRET: ECSSecret.fromSecretsManager(
          oidcSecret,
          "oidc-client-secret"
        ),
      },
      portMappings: [{ containerPort: 3000 }],
      logging: LogDriver.awsLogs({
        streamPrefix: "Rems",
        logRetention: 7, // days
        mode: AwsLogDriverMode.NON_BLOCKING,
      }),
    });

    container.addSecret(
      "PRIVATE_KEY",
      ECSSecret.fromSecretsManager(privateKeySecret)
    );
    container.addSecret(
      "PUBLIC_KEY",
      ECSSecret.fromSecretsManager(publicKeySecret)
    );

    // Create SG for Fargate
    const fargateSG = new SecurityGroup(this, "FargateSG", {
      vpc,
      allowAllOutbound: true,
      description: "Security group for REMS Fargate service",
    });

    const service = new FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition: taskDef,
      securityGroups: [fargateSG],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      propagateTags: PropagatedTagSource.SERVICE,
      enableECSManagedTags: true,
      healthCheckGracePeriod: Duration.seconds(120),
      enableExecuteCommand: true,
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
        path: "/",
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });

    // Allow inbound from ALB on port 3000
    fargateSG.addIngressRule(
      lb.connections.securityGroups[0],
      Port.tcp(3000),
      "Allow ALB to access REMS container"
    );

    // Associate WAF to alb
    new wafv2.CfnWebACLAssociation(this, "WafAssociation", {
      resourceArn: lb.loadBalancerArn,
      webAclArn: webAclArn.stringValue,
    });

    // Route 53 Alias Records
    const zone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: config.hostZone,
    });

    new route53.ARecord(this, "RemsAliasRecord", {
      zone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(lb)
      ),
      recordName: config.hostName,
    });
  }
}
