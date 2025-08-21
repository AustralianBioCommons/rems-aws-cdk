#!/usr/bin/env node
import { App, Environment, Tags } from "aws-cdk-lib";
import { MonitoringObservabilityStack } from "../lib/monitoring-observability-stack";
import { MonitoringOamSinkStack } from "../lib/monitoring-oam-sink-stack";
import { RemsObservabilityParamsStack } from "../lib/rems-observability-params-stack";

const app = new App();

const monitoringEnv: Environment = {
  account: process.env.MONITORING_ACCOUNT_ID ?? process.env.CDK_DEFAULT_ACCOUNT,
  region:  process.env.MONITORING_REGION      ?? process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2",
};

const appEnv: Environment = {
  account: process.env.APP_ACCOUNT_ID ?? process.env.CDK_DEFAULT_ACCOUNT,
  region:  process.env.APP_REGION      ?? process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2",
};

// Global tags 
Tags.of(app).add("Project",     process.env.PROJECT      || "ACDC");
Tags.of(app).add("Environment", process.env.DEPLOY_ENV   || "prod");
Tags.of(app).add("Application", "Observability");
Tags.of(app).add("Owner",       process.env.OWNER        || "biocloud");

// 1) AMP + Grafana
const obs = new MonitoringObservabilityStack(app, "Monitoring-Observability", { env: monitoringEnv });


new MonitoringOamSinkStack(app, "Monitoring-OAM-Sink", {
env: appEnv,
sinkIdentifier: process.env.MONITORING_OAM_SINK_ID! 
})

new RemsObservabilityParamsStack(app, "Rems-Observability-Params", {
  env: appEnv,
  deployEnvironment: process.env.DEPLOY_ENV || "prod",
});
//AMP + Grafana
/*
npx cdk deploy Monitoring-Observability \
  --app "npx ts-node --prefer-ts-exts bin/monitoring.ts" \
  --profile monitoring
*/
    
// OAM Sink Link
/*
export MONITORING_ACCOUNT_ID=12345678922                                                                                               
MONITORING_OAM_SINK_ID="arn:aws:oam:ap-southeast-2:12345678922:sink/12344-9c0f-4ae3-1234-8abcdfgtre" 
APP_ACCOUNT_ID=12345678922  \
npx cdk deploy Monitoring-OAM-Sink \
  --app "npx ts-node --prefer-ts-exts bin/monitoring.ts"
*/