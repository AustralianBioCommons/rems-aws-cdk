import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Secret as secretsManager } from "aws-cdk-lib/aws-secretsmanager";
import { Vpc, SubnetType } from "aws-cdk-lib/aws-ec2";
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
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { readFileSync } from "fs";
import { join } from "path";
import { Config } from "./config";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

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
    
    const remsConfigSsmParam = StringParameter.fromStringParameterName(
      this,
      "ImportedRemsConfig",
      "/rems/config/config.edn"
    );

    const privateKeySecret = secretsManager.fromSecretNameV2(
      this,
      "PrivateKey",
      "rems/visa/private-key.jwk"
    );
    const publicKeySecret = secretsManager.fromSecretNameV2(
      this,
      "PublicKey",
      "rems/visa/public-key.jwk"
    );

    const oidcSecret = secretsManager.fromSecretNameV2(
      this,
      "OidcSecret",
      config.oidcClientSecretName
    );


    taskDef.addToTaskRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/rems/config/config.edn`,
        ],
      })
    );

    taskDef.addToTaskRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:/rems/visa/*`,
        ],
      })
    );

    const container = taskDef.addContainer("RemsContainer", {
      image: ContainerImage.fromRegistry(config.containerImage),
      environment: {
        DB_NAME: config.dbName,
        DB_USER: config.dbUser,
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        PUBLIC_URL: config.publicUrl,
      },
      secrets: {
        DB_PASSWORD: ECSSecret.fromSecretsManager(db.secret!, "password"),
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

    container.addSecret(
      "REMS_CONFIG_EDN",
      ECSSecret.fromSsmParameter(remsConfigSsmParam)
    );
      

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
