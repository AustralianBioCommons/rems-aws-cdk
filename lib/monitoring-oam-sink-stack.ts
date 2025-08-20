import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as oam from "aws-cdk-lib/aws-oam";

interface OamSinkProps extends StackProps {
  sinkIdentifier: string

}

export class MonitoringOamSinkStack extends Stack {
  constructor(scope: Construct, id: string, props: OamSinkProps) {
    super(scope, id, props);

    new oam.CfnLink(this, "ProdToMonitoringLink", {
    sinkIdentifier: props.sinkIdentifier,
    labelTemplate: "prod-acdc-REMS",
    resourceTypes: [
        "AWS::CloudWatch::Metric",
        "AWS::Logs::LogGroup",
        "AWS::XRay::Trace",
    ],
    });
  }
}
