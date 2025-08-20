import { PostgresEngineVersion } from "aws-cdk-lib/aws-rds";
import { InstanceClass, InstanceSize } from "aws-cdk-lib/aws-ec2";

export interface Config {
  accountId: string;
  region: string;
  vpcCidr: string;
  publicUrl: string;
  hostName: string;
  hostZone: string;
  certificateArn: string;
  containerImage: string;
  dbName: string;
  dbUser: string;
  postgresVersion: PostgresEngineVersion;
  dbInstanceSize: InstanceSize;
  dbInstanceClass: InstanceClass;
  oidcClientSecretArn: string;
  natGatewayCount: number;
  deployEnvironment: string;
  dbRetention: number;
  remsTokenSecretArn: string;
  ampWorkspaceId: string; 
  monitoringAccountId: string; 

}

export function getConfig(): Config {
    const deployEnv = process.env.DEPLOY_ENV || "dev"; 
    const isProd = deployEnv === "prod" || deployEnv === "production";

    return {
      deployEnvironment: deployEnv,
      remsTokenSecretArn: process.env.REMS_TOKEN_ARN || "arn:aws:secretmanager:region:account:secret:rems-token-secret",
      oidcClientSecretArn:
        process.env.OIDC_SECRET_ARN ||
        "arn:aws:secretmanager:region:account:secret:rems-oidc-client-secret",
      accountId: process.env.CDK_ACCOUNT_ID || "000000000000",
      region: process.env.CDK_REGION || "ap-southeast-2",
      vpcCidr: process.env.VPC_CIDR || "192.168.0.0/24",
      publicUrl: process.env.PUBLIC_URL || "https://dev-rems.example.org/",
      hostName: process.env.HOST_NAME || "dev-rems.example.org",
      hostZone: process.env.HOST_ZONE || "example.org",
      certificateArn:
        process.env.CERTIFICATE_ARN ||
        "arn:aws:acm:region:account:certificate/dev",
      containerImage: process.env.CONTAINER_IMAGE || "cscfi/rems:latest",
      dbName: process.env.DB_NAME || "rems",
      dbUser: process.env.DB_USER || "rems",
      postgresVersion: getPostgresEngineVersion(
        process.env.POSTGRES_VERSION || "17.4"
      ),
      dbInstanceSize: getDBInstanceSize(
        process.env.DB_INSTANCE_SIZE || "micro"
      ),
      dbInstanceClass: getDBInstanceClass(
        process.env.DB_INSTANCE_CLASS || "burstable3"
      ),
      dbRetention: deployEnv === "prod" || deployEnv === "production" ? 30 : 7,
      natGatewayCount:
        deployEnv === "prod" || deployEnv === "production" ? 3 : 1,
      ampWorkspaceId: process.env.AMP_WORKSPACE_ID || "ws-XXXXXXXX", 
      monitoringAccountId: process.env.MONITORING_ACCOUNT_ID || "000000000000",
    };
}
  

export function getPostgresEngineVersion(version: string): PostgresEngineVersion {
  switch (version) {
    case "13.20":
      return PostgresEngineVersion.VER_13_20;
    case "14.9":
      return PostgresEngineVersion.VER_14_9;
    case "15.9":
      return PostgresEngineVersion.VER_15_9;
    case "16.8":
      return PostgresEngineVersion.VER_16_8;
    case "17.4":
      return PostgresEngineVersion.VER_17_4;
    default:
      throw new Error(`Unsupported Postgres version: ${version}`);
  }
}

export function getDBInstanceSize(
  size: string
): InstanceSize {
  switch (size.toLowerCase()) {
    case "micro":
      return InstanceSize.MICRO;
    case "small":
      return InstanceSize.SMALL;
    case "medium":
      return InstanceSize.MEDIUM;
    case "large":
      return InstanceSize.LARGE;;
    default:
      throw new Error(`Unsupported Postgres Instance size: ${size}`);
  }
}

export function getDBInstanceClass(cls: string): InstanceClass {
  switch (cls.toLowerCase()) {
    case "burstable2":
      return InstanceClass.BURSTABLE2;
    case "burstable3":
      return InstanceClass.BURSTABLE3;
    case "memory":
      return InstanceClass.MEMORY5;
    default:
      throw new Error(`Unsupported DB instance class: ${cls}`);
  }
}
  
