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
  Protocol,
  ContainerDependencyCondition
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationProtocolVersion,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Config } from "../config/config";
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import * as iam from "aws-cdk-lib/aws-iam";
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

    const ampWorkspaceId = config.ampWorkspaceId;                 // AMP workspace ID (from monitoring account)
    const monitoringAccountId = config.monitoringAccountId;           // Monitoring account ID
    const envName = config.deployEnvironment;             // Environment name (prod/staging)
    const region = this.region;
    const account = this.account;

    // Parameter names for the configs we created
    const adotParam = `/rems/${envName}/adot-config`;
    const jmxParam  = `/rems/${envName}/jmx-config`;

    const isProd = config.deployEnvironment === "prod" || config.deployEnvironment === "production";

    console.log("env:", config.deployEnvironment, "AMP:", config.ampWorkspaceId, "MON:", config.monitoringAccountId);

    const validAmp = !!config.ampWorkspaceId && /^ws-[0-9a-f-]+$/i.test(config.ampWorkspaceId);

    const validMonAcct = !!config.monitoringAccountId && /^[0-9]{12}$/.test(config.monitoringAccountId);

    if (isProd && (!validAmp || !validMonAcct)) {
      throw new Error("Prod requires valid ampWorkspaceId (ws-*) and monitoringAccountId (12 digits).");
    }


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

    // ---- TASK ROLE (app & collectors permissions AT RUNTIME) ----
    const taskRole = new iam.Role(this, "RemsTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS task runtime role for REMS app + ADOT collector",
    });


    const taskDef = new FargateTaskDefinition(this, "TaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole,
      executionRole,
    });

        // --- Main REMS application container ---
    // Note: this is the main app container, not the ADOT collector
    // It will run the REMS application itself

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

      // Shared volume for config files pulled from SSM
      const configVolumeName = "adot-config-vol";

    if(isProd) {
          // Allow ADOT to remote_write to AMP in the monitoring account
        taskRole.addToPolicy(new iam.PolicyStatement({
          actions: ["aps:RemoteWrite"],
          resources: [
            `arn:aws:aps:${region}:${monitoringAccountId}:workspace/${ampWorkspaceId}`,
          ],
        }));

        // Allow init container to read SSM params with configs
        taskRole.addToPolicy(new iam.PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:${region}:${account}:parameter${adotParam}`,
            `arn:aws:ssm:${region}:${account}:parameter${jmxParam}`,
          ],
        }));
    
      taskDef.addVolume({ name: configVolumeName });

      // --- Init container: downloads configs from SSM → /config ---
      const configLoader = taskDef.addContainer("adot-config-loader", {
        image: ContainerImage.fromRegistry("amazon/aws-cli:2.15.47"),
        essential: false,
        command: [
          "sh","-lc",
          [
            `mkdir -p /config`,
            `aws ssm get-parameter --name ${adotParam} --with-decryption --query Parameter.Value --output text > /config/adot.yaml`,
            `aws ssm get-parameter --name ${jmxParam}  --with-decryption --query Parameter.Value --output text > /config/jmx.yaml`,
            `curl -fsSL -o /opt/jmx/jmx_prometheus_javaagent.jar https://repo1.maven.org/maven2/io/prometheus/jmx/jmx_prometheus_javaagent/0.20.0/jmx_prometheus_javaagent-0.20.0.jar || wget -qO /opt/jmx/jmx_prometheus_javaagent.jar https://repo1.maven.org/maven2/io/prometheus/jmx/jmx_prometheus_javaagent/0.20.0/jmx_prometheus_javaagent-0.20.0.jar`,
            "ls -l /config /opt/jmx",
          ].join(" && "),
        ],
        environment: { "AWS_REGION": region },
        logging: LogDriver.awsLogs({ streamPrefix: "adot-config-loader" }),
      });

      configLoader.addMountPoints({ containerPath: "/config", readOnly: false, sourceVolume: configVolumeName });
      configLoader.addMountPoints({ containerPath: "/opt/jmx", readOnly: false, sourceVolume: configVolumeName });

      // --- ADOT collector sidecar (scrape → AMP) ---
      const adot = taskDef.addContainer("aws-otel-collector", {
        image: ContainerImage.fromRegistry("public.ecr.aws/aws-observability/aws-otel-collector:latest"),
        essential: true,
        command: ["--config=/config/adot.yaml"],
        environment: {
          AWS_REGION: region,
          AMP_WORKSPACE_ID: ampWorkspaceId,
        },
        logging: LogDriver.awsLogs({ streamPrefix: "adot" }),
      });
      adot.addMountPoints({ containerPath: "/config", readOnly: true, sourceVolume: configVolumeName });

      // Ensure config is present before these start
      adot.addContainerDependencies({ container: configLoader, condition: ContainerDependencyCondition.SUCCESS });

      container.addMountPoints(
        { containerPath: "/opt/jmx", sourceVolume: configVolumeName, readOnly: true },
        { containerPath: "/config",  readOnly: true, sourceVolume: configVolumeName }
      );

      container.addEnvironment("JAVA_TOOL_OPTIONS",
        "-javaagent:/opt/jmx/jmx_prometheus_javaagent.jar=9404:/config/jmx.yaml"
      );
    }

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
      protocolVersion: ApplicationProtocolVersion.HTTP1,
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
