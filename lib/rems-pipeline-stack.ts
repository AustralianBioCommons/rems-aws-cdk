// CDK stack: CodePipeline + CodeBuild to sync REMS configuration via internal ALB using GitHub connection
import {
  Stack,
  StackProps,
  aws_codebuild as codebuild,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as codepipeline_actions,
  aws_ec2 as ec2,
  aws_iam as iam,
  aws_logs as logs,
  aws_secretsmanager as secretsmanager,
  aws_s3 as s3,
  aws_s3_assets as s3assets,
} from "aws-cdk-lib";
import { Construct } from "constructs";

interface RemsConfigSyncPipelineProps extends StackProps {
  vpc: ec2.IVpc;
  remsTokenSecretArn: string;
  internalRemsUrl: string;
  githubConnectionArn: string;
}

export class RemsConfigSyncPipelineStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: RemsConfigSyncPipelineProps
  ) {
    super(scope, id, props);

    const { vpc, remsTokenSecretArn, internalRemsUrl, githubConnectionArn } =
      props;

    const projectRole = new iam.Role(this, "RemsSyncCodeBuildRole", {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSCodeBuildAdminAccess"
        ),
      ],
    });

    projectRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [remsTokenSecretArn],
      })
    );

    const sourceArtifact = new codepipeline.Artifact();
    const buildArtifact = new codepipeline.Artifact();

    const buildProject = new codebuild.PipelineProject(
      this,
      "RemsSyncBuildProject",
      {
        vpc,
        subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [],
        role: projectRole,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          environmentVariables: {
            REMS_INTERNAL_URL: { value: internalRemsUrl },
          },
          privileged: false,
        },
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, "RemsSyncLogGroup"),
          },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            install: {
              commands: ["echo Installing deps", "pip install requests"],
            },
            pre_build: {
              commands: [
                "echo Retrieving token",
                `REMS_TOKEN=$(aws secretsmanager get-secret-value --secret-id ${remsTokenSecretArn} --query SecretString --output text)`,
              ],
            },
            build: {
              commands: [
                "echo Applying REMS config",
                "export REMS_API_TOKEN=$REMS_TOKEN",
                "python3 scripts/apply_config.py",
              ],
            },
          },
        }),
      }
    );

    new codepipeline.Pipeline(this, "RemsSyncPipeline", {
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipeline_actions.CodeStarConnectionsSourceAction({
              actionName: "GitHub_Source",
              owner: "AustralianBioCommons",
              repo: "rems-config",
              branch: "main",
              connectionArn: githubConnectionArn,
              output: sourceArtifact,
              triggerOnPush: true,
            }),
          ],
        },
        {
          stageName: "Build",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "Apply_REMS_Config",
              project: buildProject,
              input: sourceArtifact,
              outputs: [buildArtifact],
            }),
          ],
        },
      ],
    });
  }
}
