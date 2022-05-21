import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class EtlPatternsStack extends Stack {
  private LAMBDA_THROTTLE_SIZE = 2;
  private eventBridgePutPolicy: iam.PolicyStatement;
  private queue: sqs.Queue;
  private table: dynamodb.Table;
  private bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.createResources();

    this.eventBridgePutPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: ['events:PutEvents']
    });

    this.fargateSetup();
  }

  private createResources() {
    this.queue = new sqs.Queue(this, 'newObjectInBucketEventQueue', {
      visibilityTimeout: Duration.seconds(300)
    });

    this.table = new dynamodb.Table(this, 'TransformedData', {
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING}
    });

    this.bucket = new s3.Bucket(this, 'LandingBucket', {});
    this.bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(this.queue));
  }

  private fargateSetup() {
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: 'TheEventBridgeETL',
      logRetention: logs.RetentionDays.ONE_WEEK
    });

    const cluster = new ecs.Cluster(this, 'EcsCluster', {vpc});

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'FargateTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    taskDefinition.addToTaskRolePolicy(this.eventBridgePutPolicy);

    this.bucket.grantRead(taskDefinition.taskRole);
  }
}
