import { DocumentClient } from "aws-sdk/clients/dynamodb";
import { generateId } from "../utils/KeyGenerator";
import * as aws from "@pulumi/aws";
import {
  deleteBatchOperation,
  updateBatchOperation,
  forEach,
  query,
  scan,
} from "./DynamoUtils";

const ROOM_ID_LENGTH = 6;
const HOST_KEY_LENGTH = 4;
const USER_KEY_LENGTH = 4;

export default class DbService {
  client: DocumentClient;
  tableName: string;

  constructor(tableName: string) {
    const { LOCALSTACK_HOSTNAME } = process.env;
    this.client =
      LOCALSTACK_HOSTNAME !== undefined
        ? new aws.sdk.DynamoDB.DocumentClient({
            endpoint: `http://${LOCALSTACK_HOSTNAME}:4566`,
          })
        : new aws.sdk.DynamoDB.DocumentClient();

    this.tableName = tableName;
  }

  async createRoom() {
    const roomId = generateId(ROOM_ID_LENGTH);
    const hostKey = generateId(HOST_KEY_LENGTH);
    const validSizes = "1 2 3 5 8 13 20 ? ∞";
    const createdOn = new Date().toISOString();
    const isRevealed = false;
    await this.client
      .put({
        TableName: this.tableName,
        Item: {
          PK: `ROOM:${roomId}`,
          SK: "ROOM",
          hostKey,
          validSizes,
          isRevealed,
          createdOn,
          updatedOn: createdOn,
        },
      })
      .promise();
    console.log(`Created room ${roomId}`);
    return {
      roomId,
      hostKey,
    };
  }

  async getRoom(roomId: string) {
    const queryParams = {
      TableName: this.tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `ROOM:${roomId}`,
      },
    };
    const roomData:
      | {
          roomId: string | undefined;
          validSizes: string[] | undefined;
          isRevealed: boolean | undefined;
          hostKey: string | undefined;
        }
      | undefined = {
      roomId: undefined,
      validSizes: undefined,
      isRevealed: undefined,
      hostKey: undefined,
    };
    const users: {
      userKey: string;
      userId: string;
      username?: string;
      vote?: string;
    }[] = [];
    await forEach(query(this.client, queryParams), async (item) => {
      if (item.SK === "ROOM") {
        roomData.roomId = item.PK.substring("ROOM:".length);
        roomData.validSizes = item.validSizes.split(" ");
        roomData.isRevealed = item.isRevealed;
        roomData.hostKey = item.hostKey;
      } else if (item.SK.startsWith("USER:")) {
        const userKey = item.SK.substring("USER:".length);
        users.push({
          userKey,
          userId: item.userId,
          username: item.username,
          vote: item.vote,
        });
      } else {
        console.log("Unexpected key pattern: ${item.PK}/${item.SK}");
      }
    });

    if (roomData.roomId === undefined) {
      return null;
    }

    return {
      ...roomData,
      users: Array.from(users.values()),
    };
  }
  async getRoomMetadata(roomId: string) {
    const output = await this.client
      .get({
        TableName: this.tableName,
        Key: { PK: `ROOM:${roomId}`, SK: "ROOM" },
      })
      .promise();
    return output.Item;
  }
  async addUser(roomId: string, username: string) {
    const room = await this.getRoomMetadata(roomId);
    if (room === null) {
      return null;
    }

    const userKey = generateId(USER_KEY_LENGTH);
    const userId = generateId(USER_KEY_LENGTH);
    const createdOn = new Date().toISOString();
    await this.client
      .put({
        TableName: this.tableName,
        Item: {
          PK: `ROOM:${roomId}`,
          SK: `USER:${userKey}`,
          userId,
          username,
          vote: "",
          createdOn,
          updatedOn: createdOn,
        },
      })
      .promise();
    console.log(`Added user ${username} with key ${userKey} to room ${roomId}`);
    return {
      roomId,
      username,
      userKey,
    };
  }
  async setVote(roomId: string, userKey: string, vote: string) {
    const pk = `ROOM:${roomId}`;
    const sk = `USER:${userKey}`;
    await this.client
      .update({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
        ConditionExpression: "PK = :pk AND SK = :sk",
        UpdateExpression: "set vote = :vote, updatedOn = :updatedOn",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": sk,
          ":vote": vote,
          ":updatedOn": new Date().toISOString(),
        },
      })
      .promise();
  }
  async setCardsRevealed(roomId: string, isRevealed: boolean) {
    const updatedOn = new Date();

    const queryParams = {
      TableName: this.tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `ROOM:${roomId}`,
      },
    };
    const updateOperation = updateBatchOperation(this.client, this.tableName);
    await forEach(query(this.client, queryParams), async (item) => {
      if (item.SK === "ROOM") {
        item.isRevealed = isRevealed;
        item.updatedOn = updatedOn.toISOString();
        updateOperation.push(item);
      } else if (item.SK.startsWith("USER:") && isRevealed == false) {
        // clear votes when hiding cards
        item.vote = "";
        item.updatedOn = updatedOn.toISOString();
        updateOperation.push(item);
      }
    });
    updateOperation.flush();
  }

  async deleteRoom(roomId: string) {
    const queryParams = {
      TableName: this.tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `ROOM:${roomId}`,
      },
    };
    const deleteOperation = deleteBatchOperation(this.client, this.tableName);
    await forEach(query(this.client, queryParams), async (item) => {
      await deleteOperation.push(item);
    });
    await deleteOperation.flush();
  }

  async deleteStaleRooms() {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 1);
    const cutoffDateString = cutoffDate.toISOString().substring(0, 10);
    console.log(`Scanning for items before ${cutoffDateString}`);

    const queryParams = {
      TableName: this.tableName,
      // ISO dates can be sorted/compared alphanumerically
      FilterExpression: "updatedOn < :cutoffDate",
      ProjectionExpression: "PK",
      ExpressionAttributeValues: {
        ":cutoffDate": cutoffDateString,
      },
    };

    let count = 0;
    await forEach(scan(this.client, queryParams), async (item) => {
      const roomId = item.PK.substring("ROOM:".length);
      await this.deleteRoom(roomId);
      count++;
    });

    return count;
  }

  async connectWebSocket(connectionId: string) {
    const createdOn = new Date().toISOString();
    await this.client
      .put({
        TableName: this.tableName,
        Item: {
          PK: `CONNECTION:${connectionId}`,
          SK: `CONNECTION`,
          createdOn,
        },
      })
      .promise();
    console.log(`Connected ${connectionId}`);
  }
  async disconnectWebSocket(connectionId: string) {
    await this.client
      .delete({
        TableName: this.tableName,
        Key: {
          PK: `CONNECTION:${connectionId}`,
          SK: `CONNECTION`,
        },
      })
      .promise();
    console.log(`Disconnected ${connectionId}`);
  }
}
