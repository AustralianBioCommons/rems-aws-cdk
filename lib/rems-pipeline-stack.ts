// CDK stack: REMS config sync using GitHub (private) via CodePipeline + CodeBuild
import {
  Stack,
  StackProps,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as cpactions,
  aws_codebuild as codebuild,
  aws_codestarconnections as codestar,
  aws_iam as iam,
  aws_s3 as s3,
  aws_secretsmanager as secrets,
  aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";

interface RemsPipelineStackProps extends StackProps {
  githubRepo: string; // e.g. 'your-org/rems-config'
  githubBranch?: string; // default: 'main'
  connectionArnSecretArn: string; // Secret ARN with 'connectionArn' key
  remsBaseUrl: string;
  remsApiTokenSecretArn: string; // Secret ARN with REMS_API_TOKEN key
}

export class RemsPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: RemsPipelineStackProps) {
    super(scope, id, props);

    const artifactBucket = new s3.Bucket(this, "RemsPipelineArtifacts");

    const sourceOutput = new codepipeline.Artifact();

    const githubConnectionSecret = secrets.Secret.fromSecretCompleteArn(
      this,
      "GithubConnectionSecret",
      props.connectionArnSecretArn
    );

    const githubConnectionArn = githubConnectionSecret
      .secretValueFromJson("connectionArn")
      .unsafeUnwrap();

    const buildProject = new codebuild.PipelineProject(
      this,
      "RemsSyncBuildProject",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            install: {
              commands: [
                "apt-get update && apt-get install -y git",
                "pip install -r requirements.txt",
              ],
            },
            build: {
              commands: ["python scripts/apply_config.py"],
            },
          },
          env: {
            secretsManager: {
              REMS_API_TOKEN: props.remsApiTokenSecretArn,
            },
            variables: {
              REMS_BASE_URL: props.remsBaseUrl,
            },
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
          computeType: codebuild.ComputeType.SMALL,
        },
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, "RemsPipelineLogGroup"),
          },
        },
      }
    );

    const pipeline = new codepipeline.Pipeline(this, "RemsConfigPipeline", {
      pipelineName: "RemsConfigSyncPipeline",
      artifactBucket,
    });

    pipeline.addStage({
      stageName: "Source",
      actions: [
        new cpactions.CodeStarConnectionsSourceAction({
          actionName: "GitHub_Source",
          connectionArn: githubConnectionArn,
          owner: props.githubRepo.split("/")[0],
          repo: props.githubRepo.split("/")[1],
          branch: props.githubBranch ?? "main",
          output: sourceOutput,
        }),
      ],
    });

    pipeline.addStage({
      stageName: "Approval",
      actions: [
        new cpactions.ManualApprovalAction({
          actionName: "ManualApprovalBeforeDeploy",
        }),
      ],
    });

    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "Run_REMS_Sync",
          input: sourceOutput,
          project: buildProject,
        }),
      ],
    });
  }
}
