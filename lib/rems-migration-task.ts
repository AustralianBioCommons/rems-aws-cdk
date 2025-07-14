import { Stack, Duration, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import { Config } from "./config";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";

interface RemsMigrationTaskProps extends StackProps{
  cluster: ecs.ICluster;
  vpc: ec2.IVpc;
  containerImage: string;
  config: Config;
  db: DatabaseInstance;
}

export class RemsMigrationTask extends Stack {
  constructor(scope: Construct, id: string, props: RemsMigrationTaskProps) {
    super(scope, id, props);

    const { vpc, db, config } = props;

    const taskRole = new iam.Role(this, "RemsMigrateTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "RemsMigrateTaskDef",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        taskRole,
      }
    );

    taskDefinition.addContainer("RemsMigrateContainer", {
      image: ecs.ContainerImage.fromRegistry(props.containerImage),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "RemsMigrationTask",
        logRetention: 7, // days
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      environment: {
        DB_NAME: config.dbName,
        DB_USER: config.dbUser,
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        CMD: "migrate",
        PRIVATE_KEY: '{"kty":"oct","k":"dummy"}',
        PUBLIC_KEY: '{"kty":"oct","k":"dummy"}',
        OIDC_METADATA_URL: "https://dummy.com/.well-known/openid-configuration",
        OIDC_CLIENT_ID: "dummy",
        OIDC_CLIENT_SECRET: "dummy",
        PUBLIC_URL: config.publicUrl,
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
      },
    });

    taskDefinition.addToExecutionRolePolicy(
        new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
        })
    );

    taskDefinition.addToExecutionRolePolicy(
        new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
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

  }
}
