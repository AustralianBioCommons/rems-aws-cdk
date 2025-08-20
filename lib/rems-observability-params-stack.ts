import { Stack, StackProps, aws_ssm as ssm } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";

interface RemsObsParamsProps extends StackProps {
  deployEnvironment: "prod" | "staging" | string;
}

export class RemsObservabilityParamsStack extends Stack {
  constructor(scope: Construct, id: string, props: RemsObsParamsProps) {
    super(scope, id, props);

    const adotConfig = fs.readFileSync(path.join(__dirname, "../observability/adot-config.yaml"), "utf8");
    const jmxConfig  = fs.readFileSync(path.join(__dirname, "../observability/jmx-config.yaml"), "utf8");

    new ssm.StringParameter(this, "AdotConfigParam", {
      parameterName: `/rems/${props.deployEnvironment}/adot-config`,
      stringValue: adotConfig,
    });

    new ssm.StringParameter(this, "JmxConfigParam", {
      parameterName: `/rems/${props.deployEnvironment}/jmx-config`,
      stringValue: jmxConfig,
    });
  }
}
