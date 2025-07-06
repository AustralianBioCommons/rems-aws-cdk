#!/usr/bin/env node
import { App, Environment } from "aws-cdk-lib";
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

const networkStack = new NetworkStack(app, "NetworkStack", { env, config });
const databaseStack = new DatabaseStack(app, "DatabaseStack", {
  env,
  vpc: networkStack.vpc,
  config,
});
new ComputeStack(app, "ComputeStack", {
  env,
  vpc: networkStack.vpc,
  db: databaseStack.db,
  config,
});
