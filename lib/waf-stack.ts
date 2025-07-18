import { Stack, StackProps } from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as fs from "fs";
import * as path from "path";
import { Construct } from "constructs";
import { Config } from "../config/config";

interface WafStackProps extends StackProps {
    config: Config
}

export class WafStack extends Stack {
  public readonly webAclArn: string;
  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const wafConfigPath = path.resolve(__dirname, "../config/waf-config.json");
    const wafConfig = JSON.parse(fs.readFileSync(wafConfigPath, "utf-8"));

    const rules: wafv2.CfnWebACL.RuleProperty[] = [];

    // Add allowList rule first (if any)
    if (wafConfig.allowList?.length) {
      const allowlist = new wafv2.CfnIPSet(this, "Allowlist", {
        addresses: wafConfig.allowList,
        ipAddressVersion: "IPV4",
        scope: "REGIONAL",
        name: "AllowedIPs",
      });

      rules.push({
        name: "AllowListedIPs",
        priority: 0,
        action: { allow: {} },
        statement: {
          ipSetReferenceStatement: {
            arn: allowlist.attrArn,
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "AllowListedIPs",
        },
      });
    }

    // Add other rules, offsetting priority if allowList is present
    wafConfig.rules.forEach((rule: any, index: number) => {
      const priorityOffset = wafConfig.allowList?.length ? 1 : 0;

      const ruleProps: wafv2.CfnWebACL.RuleProperty = {
        name: rule.name,
        priority: index + priorityOffset,
        statement: rule.statement,
        visibilityConfig: rule.visibilityConfig,
        ...(rule.action && { action: { [rule.action]: {} } }),
        ...(rule.overrideAction && { overrideAction: rule.overrideAction }),
      };

      if (rule.action && rule.overrideAction) {
        throw new Error(
          `Rule '${rule.name}' must not have both 'action' and 'overrideAction'. Only one is allowed.`
        );
      }
      
      rules.push(ruleProps);
    });
      
      

    const webAcl = new wafv2.CfnWebACL(this, "WAF", {
      name: `REMS-WAF-${props.config.deployEnvironment}`,
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "REMS-WAF",
        sampledRequestsEnabled: true,
      },
      rules,
    });

    new ssm.StringParameter(this, "webalcArnNameParameter", {
        parameterName: `/rems/${props.config.deployEnvironment}/webAclArn`,
        stringValue: webAcl.attrArn || "",
    });

    this.webAclArn = webAcl.attrArn
  }
}
