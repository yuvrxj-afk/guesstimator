import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as apigateway from "@pulumi/aws-apigateway";
import { createRouter } from "./lambda/Router";
import Database from "./Database";
import dynamoTableAccessPolicy from "./policies/LambdaPolicy";

interface ApiArgs {
  subDomain: string;
  apexDomain: string;
  database: Database;
  tags: { [key: string]: string };
}

const LAMBDA_ASSUME_POLICY_ROLE = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Action: "sts:AssumeRole",
      Principal: {
        Service: "lambda.amazonaws.com",
      },
      Effect: "Allow",
      Sid: "",
    },
  ],
});

export default class Api extends pulumi.ComponentResource {
  domain;
  url;
  apiKey;

  constructor(
    name: string,
    args: ApiArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("pkg:index:Api", name, args, opts);

    this.domain = `${args.subDomain}.${args.apexDomain}`;

    const tags = args.tags;

    // Create lambda role with basic execution policy
    const lambdaRole = new aws.iam.Role(`${name}-ProxyRole`, {
      assumeRolePolicy: LAMBDA_ASSUME_POLICY_ROLE,
      tags,
    });

    new aws.iam.RolePolicyAttachment(
      `${name}-ProxyBasicExecutionRolePolicyAttachment`,
      {
        role: lambdaRole,
        policyArn: aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
      }
    );

    // Attach policy to allow DB access
    const tableAccessPolicy = args.database.table.arn.apply((arn) =>
      dynamoTableAccessPolicy("AgilePokerTable", arn, tags)
    );

    new aws.iam.RolePolicyAttachment(`${name}-ProxyRolePolicyAttachment`, {
      role: lambdaRole,
      policyArn: tableAccessPolicy.arn,
    });

    const callbackFunction = new aws.lambda.CallbackFunction(
      `${name}-ProxyFunction`,
      {
        role: lambdaRole,
        callback: createRouter(args.database.table.name),
        tags,
      }
    );

    const api = new apigateway.RestAPI(`${name}-Api`, {
      routes: [
        {
          method: "OPTIONS",
          path: "/{proxy+}",
          eventHandler: callbackFunction,
          apiKeyRequired: false,
        },
        {
          method: "GET",
          path: "/{proxy+}",
          eventHandler: callbackFunction,
          apiKeyRequired: true,
        },
        {
          method: "POST",
          path: "/{proxy+}",
          eventHandler: callbackFunction,
          apiKeyRequired: true,
        },
        {
          method: "PUT",
          path: "/{proxy+}",
          eventHandler: callbackFunction,
          apiKeyRequired: true,
        },
        {
          method: "DELETE",
          path: "/{proxy+}",
          eventHandler: callbackFunction,
          apiKeyRequired: true,
        },
      ],
    });

    const apiKey = new aws.apigateway.ApiKey(`${name}-GlobalApiKey`, {
      name: `${name}-GlobalApiKey`,
      description: "Global API Key",
      enabled: true,
      tags,
    });

    const usagePlan = new aws.apigateway.UsagePlan(`${name}-UsagePlan`, {
      description: "Global Usage Plan",
      apiStages: [
        {
          apiId: api.api.id,
          stage: api.stage.stageName,
        },
      ],
      quotaSettings: {
        limit: 5_000_000,
        period: "MONTH",
      },
      throttleSettings: {
        burstLimit: 1000,
        rateLimit: 500,
      },
      tags,
    });

    new aws.apigateway.UsagePlanKey(`${name}-UsagePlanKey`, {
      keyId: apiKey.id,
      keyType: "API_KEY",
      usagePlanId: usagePlan.id,
    });

    this.apiKey = apiKey.value;

    const hostedZone = aws.route53.getZone({ name: args.apexDomain });
    const hostedZoneId = hostedZone.then((hostedZone) => hostedZone.zoneId);

    const certificate = new aws.acm.Certificate(`${name}-Certificate`, {
      domainName: this.domain,
      validationMethod: "DNS",
      tags,
    });

    const certificateValidationDomain = new aws.route53.Record(
      `${name}-DnsValidationRecord`,
      {
        name: certificate.domainValidationOptions[0].resourceRecordName,
        zoneId: hostedZoneId,
        type: certificate.domainValidationOptions[0].resourceRecordType,
        records: [certificate.domainValidationOptions[0].resourceRecordValue],
        ttl: 300,
      },
      tags
    );

    const certificateValidation = new aws.acm.CertificateValidation(
      `${name}-CertificateValidation`,
      {
        certificateArn: certificate.arn,
        validationRecordFqdns: [certificateValidationDomain.fqdn],
      }
    );

    const apiDomainName = new aws.apigateway.DomainName(`${name}-DomainName`, {
      certificateArn: certificateValidation.certificateArn,
      domainName: this.domain,
      tags,
    });
    new aws.route53.Record(`${name}-DnsRecord`, {
      zoneId: hostedZoneId,
      type: "A",
      name: this.domain,
      aliases: [
        {
          name: apiDomainName.cloudfrontDomainName,
          evaluateTargetHealth: false,
          zoneId: apiDomainName.cloudfrontZoneId,
        },
      ],
    });

    new aws.apigateway.BasePathMapping(
      `${name}-BasePathMapping`,
      {
        restApi: api.api.id,
        stageName: api.stage.stageName,
        domainName: apiDomainName.domainName,
      },
      tags
    );

    this.url = `https://${this.domain}`;
  }
}