#!/usr/bin/env node
import { App, Environment } from "aws-cdk-lib";
import { Tags } from "aws-cdk-lib";
import { getConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { DatabaseStack } from "../lib/database-stack";
import { ComputeStack } from "../lib/compute-stack";

const app = new App();
const config = getConfig();

const env: Environment = {
  account: config.accountId,
  region: config.region,
};

// Apply tags globally to all stacks in the app
Tags.of(app).add('Project', process.env.PROJECT || 'ACDC');
Tags.of(app).add('Environment', process.env.DEPLOY_ENV || 'dev');
Tags.of(app).add("Application", "REMS");
Tags.of(app).add('Owner', process.env.OWNER || 'biocloud');

const networkStack = new NetworkStack(app, "REMS-NetworkStack", { env, config });
const databaseStack = new DatabaseStack(app, "REMS-DatabaseStack", {
  env,
  vpc: networkStack.vpc,
  config,
});
new ComputeStack(app, "REMS-ComputeStack", {
  env,
  vpc: networkStack.vpc,
  db: databaseStack.db,
  config,
});
