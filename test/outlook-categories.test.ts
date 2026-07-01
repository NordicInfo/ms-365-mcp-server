import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGraphTools } from '../src/graph-tools.js';
import type GraphClient from '../src/graph-client.js';

vi.mock('../src/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Outlook categories', () => {
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

  it('patches message categories through update-mail-message', async () => {
    const handler = getToolHandler('update-mail-message');

    await handler({
      messageId: 'message-123',
      body: {
        categories: ['Follow up', 'Finance'],
      },
    });

    expect(mockGraphClient.graphRequest).toHaveBeenCalledWith(
      '/me/messages/message-123',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ categories: ['Follow up', 'Finance'] }),
      })
    );
  });

  it('registers category tools before similarly named mail folder tools', () => {
    registerGraphTools(mockServer, mockGraphClient, false);

    const toolNames = mockServer.tool.mock.calls.map((call: unknown[]) => call[0]);

    expect(toolNames.indexOf('list-outlook-categories')).toBeGreaterThanOrEqual(0);
    expect(toolNames.indexOf('list-outlook-categories')).toBeLessThan(
      toolNames.indexOf('list-mail-folders')
    );
    expect(toolNames).not.toContain('create-outlook-category');
    expect(toolNames).not.toContain('update-outlook-category');
    expect(toolNames).not.toContain('delete-outlook-category');
  });

  it('lists Outlook categories from the master category list', async () => {
    const handler = getToolHandler('list-outlook-categories');

    await handler({});

    expect(mockGraphClient.graphRequest).toHaveBeenCalledWith(
      '/me/outlook/masterCategories',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
