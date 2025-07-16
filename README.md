# REMS AWS CDK Deployment

This project provisions infrastructure for deploying [REMS](https://github.com/CSCfi/rems) on AWS using the [AWS Cloud Development Kit (CDK)](https://docs.aws.amazon.com/cdk/).

## 🧱 Infrastructure Overview

The CDK stack provisions:

- VPC with public/private subnets
- RDS (PostgreSQL) with Secrets Manager integration
- ECS Fargate service for REMS
- Application Load Balancer (ALB) with ACM certificate
- Optional Route 53 support (manual DNS configuration recommended)

## 🚀 Environments

| Branch      | Environment | Description                  |
|-------------|-------------|------------------------------|
| `develop`   | Dev         | Auto-deploys on push         |
| `main`      | Staging     | Deploys after test pass      |
| `main`      | Production  | Manual approval required     |

## 🔐 GitHub Actions with OIDC

Deployment uses GitHub Actions + AWS IAM OIDC to securely assume roles without secrets.

### Required GitHub Secrets (per environment):

- `AWS_ROLE_ARN_<ENV>`
- `CDK_REGION_<ENV>`
- `CDK_ACCOUNT_ID_<ENV>`
- `VPC_CIDR_<ENV>`
- `PUBLIC_URL_<ENV>`
- `CERTIFICATE_ARN_<ENV>`
- `CONTAINER_IMAGE_<ENV>`
- `OIDC_SECRET_ARN_<ENV>`

## 🛠 Setup

```bash
npm install
npx cdk synth
```

To deploy:

```bash
npx cdk deploy --all
```

## 📦 Environment Variables

These are passed at runtime to configure deployment:

```bash
CDK_ACCOUNT_ID=
CDK_REGION=
VPC_CIDR=
PUBLIC_URL=
CERTIFICATE_ARN=
CONTAINER_IMAGE=
DB_NAME=rems
DB_USER=rems
POSTGRES_VERSION=17.4
DB_INSTANCE_SIZE=micro
DB_INSTANCE_CLASS=burstable3
```

## ⚠️ DNS Setup

DNS records (e.g. `rems.example.org`) must be configured manually in Route 53 or another provider after deployment.

## 🧪 Testing

Unit tests run automatically on every branch via GitHub Actions.

## 🧪 DB Migration

Running DB migration

Obtain the migration task definition from the console or CLI, and then run the command below:
```
  aws ecs run-task \
  --cluster Rems \
  --launch-type FARGATE \
  --task-definition REMSMigrationTaskRemsMigrateTaskDefxxxxx \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-xxxxxxxx],securityGroups=[sg-xxxxxxxx],assignPublicIp=DISABLED}'
```

---

Maintained by Australian BioCommons / REMS deployment team.
