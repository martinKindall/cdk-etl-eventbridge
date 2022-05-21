import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class EtlPatternsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const queue = new sqs.Queue(this, 'newObjectInBucketEventQueue', {
      visibilityTimeout: Duration.seconds(300)
    });

    const LAMBDA_THROTTLE_SIZE = 2;

    const table = new dynamodb.Table(this, 'TransformedData', {
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING}
    });

    const bucket = new s3.Bucket(this, 'LandingBucket', {});
  }
}
