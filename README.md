# CDK Patterns - ETL Eventbridge

The original proyect https://github.com/cdk-patterns/serverless/blob/main/the-eventbridge-etl/README.md.
I basically rewrited the project using the CDK 2.0.

## Deploy

Make sure to have the Docker daemon running, because this project builds a Docker image and pushes it to __ECR__.

```bash
npm run build
cdk deploy
```

## Usage

To trigger the ETL pipeline, upload the example .csv in the __data\_example__ folder.

## Debug

Every lambda writes logs to CloudWatch. The Observer lambda writes every event sent via Eventbridge to Cloudwatch too.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
