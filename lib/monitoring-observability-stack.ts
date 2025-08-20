import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as aps from "aws-cdk-lib/aws-aps";        // AMP
import * as grafana from "aws-cdk-lib/aws-grafana"; // AMG
import * as iam from "aws-cdk-lib/aws-iam";

interface MonitoringObsProps extends StackProps {
  grafanaName?: string;
}

export class MonitoringObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringObsProps) {
    super(scope, id, props);

    // 1) AMP workspace (receives remote_write from prod)
    const amp = new aps.CfnWorkspace(this, "AmpWorkspace", {
      alias: "rems-central",
    });

    const grafanaRole = new iam.Role(this, "GrafanaCustomerManagedRole", {
        assumedBy: new iam.ServicePrincipal("grafana.amazonaws.com"),
        description: "Customer-managed role for AMG to query CW + AMP",
    });

    // 2) Grafana service role for querying AMP + CloudWatch
    grafanaRole.addManagedPolicy(
    iam.ManagedPolicy.fromManagedPolicyArn(
        this,
        "GrafanaCloudWatchAccess",
        "arn:aws:iam::aws:policy/service-role/AmazonGrafanaCloudWatchAccess" // note: service-role path
    )
    );
    grafanaRole.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonPrometheusQueryAccess")
    );
    // 3) AMG workspace (SSO via IAM Identity Center)
    const amg = new grafana.CfnWorkspace(this, "GrafanaWorkspace", {
      name: props.grafanaName ?? "rems-central",
      authenticationProviders: ["AWS_SSO"],          // Use Identity Center
      permissionType: "SERVICE_MANAGED",             // AMG manages the role
      roleArn: grafanaRole.roleArn,                  // For data source access
      dataSources: ["PROMETHEUS", "CLOUDWATCH"],     // Show both in Grafana
      accountAccessType: "CURRENT_ACCOUNT",          // Required property
    });

    // ---- Outputs you’ll need in the prod account and for operators ----
    new CfnOutput(this, "AmpWorkspaceArn", { value: amp.attrArn });
    new CfnOutput(this, "AmpWorkspaceId",  { value: amp.attrWorkspaceId });
    new CfnOutput(this, "AmpRemoteWriteEndpoint", {
      value: `${amp.attrPrometheusEndpoint}/api/v1/remote_write`,
    });
    new CfnOutput(this, "GrafanaUrl",   { value: amg.attrEndpoint });
    new CfnOutput(this, "GrafanaId",    { value: amg.attrId! });
  }
}
