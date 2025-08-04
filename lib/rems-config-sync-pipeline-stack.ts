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
  baseRemsUrl: string;
  githubConnectionArn: string;
}

export class RemsConfigSyncPipelineStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: RemsConfigSyncPipelineProps
  ) {
    super(scope, id, props);

    const { vpc, remsTokenSecretArn, baseRemsUrl, githubConnectionArn } =
      props;

    // Extract GitHub connection ARN from Secrets Manager
    const githubConnectionSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GitHubConnectionSecret",
      githubConnectionArn
    );

    const remsAdminUserId = secretsmanager.Secret.fromSecretNameV2(
      this,
      "RemsAdminUserId",
      "/rems/remsAdminUserId"
    )

    const githubConnectionArnValue =
      githubConnectionSecret.secretValue.unsafeUnwrap();

    const projectRole = new iam.Role(this, "RemsSyncCodeBuildRole", {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess"),
      ],
    });

    projectRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [remsTokenSecretArn, remsAdminUserId.secretArn],
      })
    );

    projectRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "codebuild:CreateReportGroup",
          "codebuild:CreateReport",
          "codebuild:UpdateReport",
          "codebuild:BatchGetBuilds",
          "codebuild:BatchPutTestCases",
          "codebuild:BatchPutCodeCoverages",
          "codebuild:StartBuild",
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeDhcpOptions",
          "ec2:DescribeVpcs",
          "ec2:CreateNetworkInterfacePermission",
        ],
        resources: ["*"],
      })
    );

    const sourceArtifact = new codepipeline.Artifact();
    const buildArtifact = new codepipeline.Artifact();

    const buildSG = new ec2.SecurityGroup(this, "RemsSyncBuildSG", {
      vpc,
      description: "Allow outbound HTTPS for CodeBuild",
    });

    buildSG.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS outbound"
    );


    const buildProject = new codebuild.PipelineProject(
      this,
      "RemsSyncBuildProject",
      {
        vpc,
        subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [buildSG],
        role: projectRole,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          environmentVariables: {
            REMS_BASE_URL: { value: baseRemsUrl },
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
              commands: [
                "echo Installing deps",
                "pip install -r requirements.txt",
              ],
            },
            pre_build: {
              commands: [
                "echo Retrieving token",
                `REMS_TOKEN=$(aws secretsmanager get-secret-value --secret-id ${remsTokenSecretArn} --query SecretString --output text)`,
                `REMS_USER_ID=$(aws secretsmanager get-secret-value --secret-id /rems/remsAdminUserId --query SecretString --output text)`,

              ],
            },
            build: {
              commands: [
                "echo Applying REMS config",
                "export REMS_API_TOKEN=$REMS_TOKEN",
                "export REMS_USER_ID=$REMS_USER_ID",
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
              connectionArn: githubConnectionArnValue,
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
