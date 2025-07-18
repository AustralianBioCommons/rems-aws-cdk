import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  InstanceType,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  Credentials,
} from "aws-cdk-lib/aws-rds";
import { Peer, Port } from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { Config } from "../config/config";

interface DatabaseStackProps extends StackProps {
  vpc: Vpc;
  config: Config;
}

export class DatabaseStack extends Stack {
  public readonly db: DatabaseInstance;
  public readonly secretName: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, config } = props;

    this.db = new DatabaseInstance(this, "RemsDb", {
      engine: DatabaseInstanceEngine.postgres({
        version: config.postgresVersion,
      }),
      instanceType: InstanceType.of(
        config.dbInstanceClass,
        config.dbInstanceSize
      ),
      vpc,
      multiAz: true,
      allocatedStorage: 20,
      publiclyAccessible: false,
      credentials: Credentials.fromGeneratedSecret("rems"),
      databaseName: config.dbName,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      removalPolicy: RemovalPolicy.RETAIN,

      // Backup & PITR settings
      backupRetention: Duration.days(config.dbRetention), // daily snapshots retained
      deletionProtection: true,
      enablePerformanceInsights: true, // enables detailed metrics
      storageEncrypted: true, // encryption required for PITR
      copyTagsToSnapshot: true, // tags copied to automated snapshots
      autoMinorVersionUpgrade: true, // keeps minor version up-to-date
    });

    this.secretName = this.db.secret?.secretName ?? "";

    new ssm.StringParameter(this, "DbSecretNameParameter", {
      parameterName: `/rems/${config.deployEnvironment}/db-secret-name`,
      stringValue: this.db.secret?.secretName || "",
    });

    // Get all private subnets in the VPC
    const privateSubnets = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
    }).subnets;

    // Allow each private subnet's CIDR to access the DB
    for (const subnet of privateSubnets) {
      this.db.connections.allowFrom(
        Peer.ipv4(subnet.ipv4CidrBlock),
        Port.tcp(5432),
        "Allow PostgreSQL access from private subnet"
      );
    }
  }
}
