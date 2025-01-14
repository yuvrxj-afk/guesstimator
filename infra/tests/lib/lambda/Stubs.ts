import {
  APIGatewayProxyEvent,
  APIGatewayProxyWebsocketEventV2,
} from "aws-lambda";

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export function stubWebSocketEvent(
  event: DeepPartial<APIGatewayProxyWebsocketEventV2>
): APIGatewayProxyWebsocketEventV2 {
  return {
    requestContext: {
      routeKey: "",
      messageId: "",
      eventType: "MESSAGE",
      extendedRequestId: "",
      requestTime: "",
      messageDirection: "IN",
      stage: "",
      connectedAt: 0,
      requestTimeEpoch: 0,
      requestId: "",
      domainName: "",
      connectionId: "",
      apiId: "",
      ...event.requestContext,
    },
    isBase64Encoded: event.isBase64Encoded || false,
    body: event.body,
    stageVariables: {
      ...event.stageVariables,
    },
  };
}

export function stubEvent(
  event: DeepPartial<APIGatewayProxyEvent>
): APIGatewayProxyEvent {
  return {
    body: "",
    headers: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/",
    pathParameters: null, // APIGatewayProxyEventPathParameters | null;
    queryStringParameters: null, // APIGatewayProxyEventQueryStringParameters | null;
    stageVariables: null, // APIGatewayProxyEventStageVariables | null;
    resource: "not used",
    ...event,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null, // APIGatewayProxyEventMultiValueQueryStringParameters | null;
    requestContext: {
      accountId: "not used",
      apiId: "not used",
      authorizer: null,
      protocol: "not used",
      httpMethod: "not used",
      path: "not used",
      stage: "not used",
      requestId: "not used",
      requestTimeEpoch: 0,
      resourceId: "not used",
      resourcePath: "not used",
      ...event.requestContext,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: "not used",
        user: null,
        userAgent: null,
        userArn: null,
      },
    },
  };
}
