#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EtlPatternsStack } from '../lib/etl-patterns-stack';

const app = new cdk.App();
new EtlPatternsStack(app, 'EtlPatternsStack');
