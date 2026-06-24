import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerDiscoveryTools, registerGraphTools } from '../src/graph-tools.js';
import type { GraphClient } from '../src/graph-client.js';

vi.mock('../src/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/generated/client.js', () => ({
  api: {
    endpoints: [
      {
        alias: 'send-mail',
        method: 'post',
        path: '/me/sendMail',
        description: 'Send mail',
        parameters: [{ name: 'body', type: 'Body', schema: z.any() }],
      },
      {
        alias: 'create-draft-email',
        method: 'post',
        path: '/me/messages',
        description: 'Create draft email',
        parameters: [{ name: 'body', type: 'Body', schema: z.any() }],
      },
      {
        alias: 'create-reply-draft',
        method: 'post',
        path: '/me/messages/:messageId/createReply',
        description: 'Create reply draft',
        parameters: [
          { name: 'messageId', type: 'Path', schema: z.string() },
          { name: 'body', type: 'Body', schema: z.any() },
        ],
      },
    ],
  },
}));

describe('Mail Body Formatting', () => {
  let mockServer: { tool: ReturnType<typeof vi.fn> };
  let mockGraphClient: GraphClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = { tool: vi.fn() };
    mockGraphClient = {
      graphRequest: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ id: 'message-1' }) }],
      }),
    } as unknown as GraphClient;
  });

  function getToolHandler(toolName: string) {
    registerGraphTools(mockServer, mockGraphClient, false);
    const call = mockServer.tool.mock.calls.find((c: unknown[]) => c[0] === toolName);
    expect(call).toBeDefined();
    return call![call!.length - 1] as (params: Record<string, unknown>) => Promise<unknown>;
  }

  function getRequestBody() {
    const options = (mockGraphClient.graphRequest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    return JSON.parse(options.body as string);
  }

  it('does not register direct send-mail tools', () => {
    registerGraphTools(mockServer, mockGraphClient, false);

    const toolNames = mockServer.tool.mock.calls.map((call: unknown[]) => call[0]);
    expect(toolNames).not.toContain('send-mail');
  });

  it('does not expose direct send-mail tools through discovery mode', async () => {
    registerDiscoveryTools(mockServer, mockGraphClient, false);

    const searchCall = mockServer.tool.mock.calls.find((c: unknown[]) => c[0] === 'search-tools');
    const executeCall = mockServer.tool.mock.calls.find((c: unknown[]) => c[0] === 'execute-tool');
    expect(searchCall).toBeDefined();
    expect(executeCall).toBeDefined();

    const searchHandler = searchCall![searchCall!.length - 1] as (
      params: Record<string, unknown>
    ) => Promise<{ content: Array<{ text: string }> }>;
    const executeHandler = executeCall![executeCall!.length - 1] as (
      params: Record<string, unknown>
    ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

    const searchResult = await searchHandler({ query: 'send', limit: 10 });
    const searchBody = JSON.parse(searchResult.content[0].text);
    const toolNames = searchBody.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).not.toContain('send-mail');

    const executeResult = await executeHandler({ tool_name: 'send-mail' });
    expect(executeResult.isError).toBe(true);
    expect(executeResult.content[0].text).toContain('Tool not found: send-mail');
  });

  it('converts plain-text draft message bodies to HTML paragraphs', async () => {
    const handler = getToolHandler('create-draft-email');

    await handler({
      body: {
        subject: 'Follow-up',
        body: {
          contentType: 'Text',
          content: 'Hello,\n\nCan you confirm the delivery window?',
        },
      },
    });

    const requestBody = getRequestBody();
    expect(requestBody.body.contentType).toBe('HTML');
    expect(requestBody.body.content).toBe(
      '<p>Hello,</p><p>Can you confirm the delivery window?</p>'
    );
  });

  it('preserves existing HTML body markup', async () => {
    const handler = getToolHandler('create-draft-email');

    await handler({
      body: {
        subject: 'Status update',
        body: {
          contentType: 'HTML',
          content: '<p>Hi Alex,</p><p>The shipment is ready.</p>',
        },
      },
    });

    const requestBody = getRequestBody();
    expect(requestBody.body.contentType).toBe('HTML');
    expect(requestBody.body.content).toBe('<p>Hi Alex,</p><p>The shipment is ready.</p>');
  });

  it('converts reply draft Message bodies to HTML paragraphs', async () => {
    const handler = getToolHandler('create-reply-draft');

    await handler({
      messageId: 'message-123',
      body: {
        Message: {
          body: {
            contentType: 'Text',
            content: 'Hi,\n\nI agree with the proposed next step.',
          },
        },
      },
    });

    const requestBody = getRequestBody();
    expect(requestBody.Message.body.contentType).toBe('HTML');
    expect(requestBody.Message.body.content).toBe(
      '<p>Hi,</p><p>I agree with the proposed next step.</p>'
    );
  });
});
