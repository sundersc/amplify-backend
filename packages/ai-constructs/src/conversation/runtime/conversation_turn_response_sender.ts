import { ConversationTurnEvent, StreamingResponseChunk } from './types.js';
import type { ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { GraphqlRequestExecutor } from './graphql_request_executor';

export type MutationResponseInput = {
  input: {
    conversationId: string;
    content: ContentBlock[];
    associatedUserMessageId: string;
  };
};

export type MutationStreamingResponseInput = {
  input: StreamingResponseChunk;
};

/**
 * This class is responsible for sending a response produced by Bedrock back to AppSync
 * in a form of mutation.
 */
export class ConversationTurnResponseSender {
  /**
   * Creates conversation turn response sender.
   */
  constructor(
    private readonly event: ConversationTurnEvent,
    private readonly graphqlRequestExecutor = new GraphqlRequestExecutor(
      event.graphqlApiEndpoint,
      event.request.headers.authorization,
      event.request.headers['x-amz-user-agent']
    ),
    private readonly logger = console
  ) {}

  sendResponse = async (message: ContentBlock[]) => {
    const responseMutationRequest = this.createMutationRequest(message);
    this.logger.debug('Sending response mutation:', responseMutationRequest);
    await this.graphqlRequestExecutor.executeGraphql<
      MutationResponseInput,
      void
    >(responseMutationRequest);
  };

  sendResponseChunk = async (chunk: StreamingResponseChunk) => {
    const responseMutationRequest = this.createStreamingMutationRequest(chunk);
    this.logger.debug('Sending response mutation:', responseMutationRequest);
    await this.graphqlRequestExecutor.executeGraphql<
      MutationStreamingResponseInput,
      void
    >(responseMutationRequest);
  };

  private createMutationRequest = (content: ContentBlock[]) => {
    const query = `
        mutation PublishModelResponse($input: ${this.event.responseMutation.inputTypeName}!) {
            ${this.event.responseMutation.name}(input: $input) {
                ${this.event.responseMutation.selectionSet}
            }
        }
    `;
    content = this.serializeContent(content);
    const variables: MutationResponseInput = {
      input: {
        conversationId: this.event.conversationId,
        content,
        associatedUserMessageId: this.event.currentMessageId,
      },
    };
    return { query, variables };
  };

  private createStreamingMutationRequest = (chunk: StreamingResponseChunk) => {
    const query = `
        mutation PublishModelResponse($input: ${this.event.responseMutation.inputTypeName}!) {
            ${this.event.responseMutation.name}(input: $input) {
                ${this.event.responseMutation.selectionSet}
            }
        }
    `;
    chunk = {
      ...chunk,
      accumulatedTurnContent: this.serializeContent(
        chunk.accumulatedTurnContent
      ),
    };
    const variables: MutationStreamingResponseInput = {
      input: chunk,
    };
    return { query, variables };
  };

  private serializeContent = (content: ContentBlock[]) => {
    return content.map((block) => {
      if (block.toolUse) {
        // The `input` field is typed as `AWS JSON` in the GraphQL API because it can represent
        // arbitrary JSON values.
        // We need to stringify it before sending it to AppSync to prevent type errors.
        const input = JSON.stringify(block.toolUse.input);
        return { toolUse: { ...block.toolUse, input } };
      }
      return block;
    });
  };
}
