import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_target from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export class EtlPatternsStack extends Stack {
  private LAMBDA_THROTTLE_SIZE = 2;
  private eventBridgePutPolicy: iam.PolicyStatement;
  private queue: sqs.Queue;
  private table: dynamodb.Table;
  private bucket: s3.Bucket;
  private vpc: ec2.Vpc;
  private cluster: ecs.Cluster;
  private taskDefinition: ecs.TaskDefinition;
  private container: ecs.ContainerDefinition;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.createResources();

    this.eventBridgePutPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: ['events:PutEvents']
    });

    this.fargateSetup();
    this.lambdaExtractSetup();
    this.lambdaTransformSetup();
    this.lambdaLoadSetup();
    this.lambdaObserverSetup();
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
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: 'TheEventBridgeETL',
      logRetention: logs.RetentionDays.ONE_WEEK
    });

    this.cluster = new ecs.Cluster(this, 'EcsCluster', {vpc: this.vpc});

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'FargateTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    this.taskDefinition.addToTaskRolePolicy(this.eventBridgePutPolicy);

    this.bucket.grantRead(this.taskDefinition.taskRole);

    this.container = this.taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromAsset('container/dataExtractionTask'),
      logging,
      environment: {
        'S3_BUCKET_NAME': this.bucket.bucketName,
        'S3_OBJECT_KEY': ''
      }
    });
  }

  private lambdaExtractSetup() {
    const extractLambda = new lambda.Function(this, 'extractLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns/extract'),
      handler: 's3SqsEventConsumer.handler',
      reservedConcurrentExecutions: this.LAMBDA_THROTTLE_SIZE,
      environment: {
        CLUSTER_NAME: this.cluster.clusterName,
        TASK_DEFINITION: this.taskDefinition.taskDefinitionArn,
        SUBNETS: JSON.stringify(Array.from(this.vpc.privateSubnets, x => x.subnetId)),
        CONTAINER_NAME: this.container.containerName
      }
    });

    this.queue.grantConsumeMessages(extractLambda);
    extractLambda.addEventSource(new SqsEventSource(this.queue, {}));
    extractLambda.addToRolePolicy(this.eventBridgePutPolicy);

    const runTaskPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        this.taskDefinition.taskDefinitionArn
      ],
      actions: [
        'ecs:RunTask'
      ]
    });

    extractLambda.addToRolePolicy(runTaskPolicyStatement);

    const taskExecutionRolePolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:PassRole'
      ],
      resources: [
        this.taskDefinition.obtainExecutionRole().roleArn,
        this.taskDefinition.taskRole.roleArn
      ]
    });

    extractLambda.addToRolePolicy(taskExecutionRolePolicyStatement);
  }

  private lambdaTransformSetup() {
    const transformLambda = new lambda.Function(this, 'TransformLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns/transform'),
      handler: 'transform.handler',
      reservedConcurrentExecutions: this.LAMBDA_THROTTLE_SIZE,
      timeout: Duration.seconds(3)
    });

    transformLambda.addToRolePolicy(this.eventBridgePutPolicy);

    const transformRule = new events.Rule(this, 'transformRule', {
      description: 'Data extracted from S3, needs to be transformed',
      eventPattern: {
        source: ['cdkpatterns.the-eventbridge-etl'],
        detailType: ['s3RecordExtraction'],
        detail: {
          status: ['extracted']
        }
      }
    });

    transformRule.addTarget(new events_target.LambdaFunction(transformLambda));
  }

  private lambdaLoadSetup() {
    const loadLambda = new lambda.Function(this, 'LoadLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns/load'),
      handler: 'load.handler',
      timeout: Duration.seconds(3),
      reservedConcurrentExecutions: this.LAMBDA_THROTTLE_SIZE,
      environment: {
        TABLE_NAME: this.table.tableName
      }
    });

    loadLambda.addToRolePolicy(this.eventBridgePutPolicy);
    this.table.grantReadWriteData(loadLambda);

    const loadRule = new events.Rule(this, 'loadRule', {
      description: 'Data transformed, Needs loaded into dynamoDB',
      eventPattern: {
        source: ['cdkpatterns.the-eventbridge-etl'],
        detailType: ['transform'],
        detail: {
          status: ['transformed']
        }
      }
    });

    loadRule.addTarget(new events_target.LambdaFunction(loadLambda));
  }

  private lambdaObserverSetup() {
    const observeLambda = new lambda.Function(this, 'ObserverLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns/observe'),
      handler: 'observe.handler',
      timeout: Duration.seconds(3)
    });

    const observerRule = new events.Rule(this, 'observeRule', {
      description: 'all events are caught here and logged centrally',
      eventPattern: {
        source: ['cdkpatterns.the-eventbridge-etl']
      }
    });

    observerRule.addTarget(new events_target.LambdaFunction(observeLambda));
  }
}
