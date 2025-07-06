import { Stack, StackProps } from "aws-cdk-lib";
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
import { Construct } from "constructs";
import { Config } from "./config";

interface DatabaseStackProps extends StackProps {
  vpc: Vpc;
  config: Config;
}

export class DatabaseStack extends Stack {
  public readonly db: DatabaseInstance;

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
    });
  }
}
