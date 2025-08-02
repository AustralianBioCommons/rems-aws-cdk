// CDK stack: Admin-only ECS task to run psql securely via execute-command
import {
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_iam as iam,
  aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";

interface RemsAdminPsqlTaskProps extends StackProps {}

export class RemsAdminPsqlTaskStack extends Stack {
  constructor(scope: Construct, id: string, props: RemsAdminPsqlTaskProps) {
    super(scope, id, props);

    const taskRole = new iam.Role(this, "RemsAdminTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    const logGroup = new logs.LogGroup(this, "PsqlTaskLogGroup");

    const taskDef = new ecs.FargateTaskDefinition(this, "AdminPsqlTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole,
    });

    taskDef.addContainer("PsqlContainer", {
      image: ecs.ContainerImage.fromRegistry("postgres:15"),
      command: ["/bin/sh", "-c", "sleep 3600"], // Long sleep to allow exec
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "psql-admin", logGroup }),
    });

    // Grant execute-command access manually:
    // aws ecs execute-command --cluster <cluster> --task <task> --interactive --command "/bin/bash"
    // Inside: psql -h <dbHost> -U <user> -d rems
  }
}
