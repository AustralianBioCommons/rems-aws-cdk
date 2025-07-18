#!/usr/bin/env node
import { App, Environment } from "aws-cdk-lib";
import { Tags } from "aws-cdk-lib";
import { getConfig } from "../config/config";
import { NetworkStack } from "../lib/network-stack";
import { DatabaseStack } from "../lib/database-stack";
import { ComputeStack } from "../lib/compute-stack";
import { RemsMigrationTask } from "../lib/rems-migration-task";
import { WafStack } from "../lib/waf-stack";

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
const wafStack = new WafStack(app, "REMS-WafStack", { env, config });

const databaseStack = new DatabaseStack(app, "REMS-DatabaseStack", {
  env,
  vpc: networkStack.vpc,
  config,
});

const computeStack = new ComputeStack(
  app,
  `REMS-ComputeStack-${config.deployEnvironment}`,
  {
    env,
    vpc: networkStack.vpc,
    config,

  }
);

computeStack.addDependency(databaseStack)
computeStack.addDependency(wafStack)

const remsMigrationStack = new RemsMigrationTask(app, `REMS-MigrationTask-${config.deployEnvironment}`, {
  cluster: computeStack.cluster,
  vpc: networkStack.vpc,
  containerImage: config.containerImage,
  config,
  env,
})

remsMigrationStack.addDependency(databaseStack)
