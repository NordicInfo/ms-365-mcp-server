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
      {
        alias: 'create-reply-all-draft',
        method: 'post',
        path: '/me/messages/:messageId/createReplyAll',
        description: 'Create reply-all draft',
        parameters: [
          { name: 'messageId', type: 'Path', schema: z.string() },
          { name: 'body', type: 'Body', schema: z.any() },
        ],
      },
      {
        alias: 'create-forward-draft',
        method: 'post',
        path: '/me/messages/:messageId/createForward',
        description: 'Create forward draft',
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
      makeRequest: vi.fn(),
      formatJsonResponse: vi.fn((data: unknown, _rawResponse = false, excludeResponse = false) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(excludeResponse ? { success: true } : data),
          },
        ],
      })),
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

  function getMakeRequestCalls() {
    return (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>).mock.calls;
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

  it('creates reply draft first and prepends generated HTML above quoted history', async () => {
    const handler = getToolHandler('create-reply-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'draft-1' })
      .mockResolvedValueOnce({
        id: 'draft-1',
        body: {
          contentType: 'HTML',
          content: '<div class="quoted">Original message</div>',
        },
      })
      .mockResolvedValueOnce({ message: 'OK!' })
      .mockResolvedValueOnce({
        id: 'draft-1',
        body: {
          contentType: 'HTML',
          content: '<p>Generated reply</p><br><div class="quoted">Original message</div>',
        },
      });

    const result = await handler({
      messageId: 'message-123',
      body: {
        Message: {
          body: {
            contentType: 'Text',
            content: 'Generated reply',
          },
        },
      },
    });

    expect(mockGraphClient.graphRequest).not.toHaveBeenCalled();

    const calls = getMakeRequestCalls();
    expect(calls[0][0]).toBe('/me/messages/message-123/createReply');
    expect(calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(calls[0][1].body)).toEqual({ Message: {} });

    expect(calls[1][0]).toBe('/me/messages/draft-1');
    expect(calls[1][1].headers.Prefer).toBe('outlook.body-content-type="html"');

    expect(calls[2][0]).toBe('/me/messages/draft-1');
    expect(calls[2][1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(calls[2][1].body)).toEqual({
      body: {
        contentType: 'HTML',
        content: '<p>Generated reply</p><br><div class="quoted">Original message</div>',
      },
    });

    expect(calls[3][0]).toBe('/me/messages/draft-1');
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: 'draft-1',
            body: {
              contentType: 'HTML',
              content: '<p>Generated reply</p><br><div class="quoted">Original message</div>',
            },
          }),
        },
      ],
    });
  });

  it('uses the same thread-preserving flow for reply-all drafts', async () => {
    const handler = getToolHandler('create-reply-all-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'draft-all-1' })
      .mockResolvedValueOnce({
        id: 'draft-all-1',
        body: { contentType: 'HTML', content: '<blockquote>Original all</blockquote>' },
      })
      .mockResolvedValueOnce({ message: 'OK!' })
      .mockResolvedValueOnce({ id: 'draft-all-1' });

    await handler({
      messageId: 'message-123',
      body: {
        Message: {
          body: {
            contentType: 'Text',
            content: 'Reply all text',
          },
        },
      },
    });

    const calls = getMakeRequestCalls();
    expect(calls[0][0]).toBe('/me/messages/message-123/createReplyAll');
    expect(JSON.parse(calls[2][1].body).body.content).toBe(
      '<p>Reply all text</p><br><blockquote>Original all</blockquote>'
    );
  });

  it('preserves forward recipients while stripping generated Message.body from the initial createForward request', async () => {
    const handler = getToolHandler('create-forward-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'forward-draft-1' })
      .mockResolvedValueOnce({
        id: 'forward-draft-1',
        body: { contentType: 'HTML', content: '<div>Forwarded history</div>' },
      })
      .mockResolvedValueOnce({ message: 'OK!' })
      .mockResolvedValueOnce({ id: 'forward-draft-1' });

    await handler({
      messageId: 'message-123',
      body: {
        Message: {
          toRecipients: [{ emailAddress: { address: 'alex@example.com' } }],
          body: {
            contentType: 'Text',
            content: 'Please see below.',
          },
        },
      },
    });

    const initialBody = JSON.parse(getMakeRequestCalls()[0][1].body);
    expect(initialBody).toEqual({
      Message: {
        toRecipients: [{ emailAddress: { address: 'alex@example.com' } }],
      },
    });
    expect(getMakeRequestCalls()[0][0]).toBe('/me/messages/message-123/createForward');
  });

  it('converts plain-text generated reply content to HTML before patching', async () => {
    const handler = getToolHandler('create-reply-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'draft-1' })
      .mockResolvedValueOnce({
        id: 'draft-1',
        body: { contentType: 'HTML', content: '<div>History</div>' },
      })
      .mockResolvedValueOnce({ message: 'OK!' })
      .mockResolvedValueOnce({ id: 'draft-1' });

    await handler({
      messageId: 'message-123',
      body: {
        Message: {
          body: {
            contentType: 'Text',
            content: 'Hi,\n\nThanks.',
          },
        },
      },
    });

    expect(JSON.parse(getMakeRequestCalls()[2][1].body).body.content).toBe(
      '<p>Hi,</p><p>Thanks.</p><br><div>History</div>'
    );
  });

  it('preserves existing generated HTML when patching the reply draft', async () => {
    const handler = getToolHandler('create-reply-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'draft-1' })
      .mockResolvedValueOnce({
        id: 'draft-1',
        body: { contentType: 'HTML', content: '<div>History</div>' },
      })
      .mockResolvedValueOnce({ message: 'OK!' })
      .mockResolvedValueOnce({ id: 'draft-1' });

    await handler({
      messageId: 'message-123',
      body: {
        Message: {
          body: {
            contentType: 'HTML',
            content: '<p>Hi,</p><p>Thanks.</p>',
          },
        },
      },
    });

    expect(JSON.parse(getMakeRequestCalls()[2][1].body).body.content).toBe(
      '<p>Hi,</p><p>Thanks.</p><br><div>History</div>'
    );
  });

  it('accepts Comment as generated draft content and strips it from the initial create request', async () => {
    const handler = getToolHandler('create-reply-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'draft-1' })
      .mockResolvedValueOnce({
        id: 'draft-1',
        body: { contentType: 'HTML', content: '<div>History</div>' },
      })
      .mockResolvedValueOnce({ message: 'OK!' })
      .mockResolvedValueOnce({ id: 'draft-1' });

    await handler({
      messageId: 'message-123',
      body: {
        Comment: 'Generated from comment',
      },
    });

    expect(JSON.parse(getMakeRequestCalls()[0][1].body)).toEqual({});
    expect(JSON.parse(getMakeRequestCalls()[2][1].body).body.content).toBe(
      '<p>Generated from comment</p><br><div>History</div>'
    );
  });

  it('falls back to the generic graphRequest flow when no generated reply content exists', async () => {
    const handler = getToolHandler('create-reply-draft');

    await handler({
      messageId: 'message-123',
      body: {
        Message: {
          importance: 'normal',
        },
      },
    });

    expect(mockGraphClient.makeRequest).not.toHaveBeenCalled();
    expect(mockGraphClient.graphRequest).toHaveBeenCalledTimes(1);
  });

  it('returns an MCP error when Graph createReply does not return a draft id', async () => {
    const handler = getToolHandler('create-reply-draft');

    (mockGraphClient.makeRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    const result = (await handler({
      messageId: 'message-123',
      body: {
        Message: {
          body: {
            content: 'Generated reply',
          },
        },
      },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('did not return a draft id');
  });
});
