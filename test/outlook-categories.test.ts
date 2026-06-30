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
    expect(toolNames.indexOf('create-outlook-category')).toBeLessThan(
      toolNames.indexOf('list-mail-folders')
    );
    expect(toolNames.indexOf('update-outlook-category')).toBeLessThan(
      toolNames.indexOf('list-mail-folders')
    );
    expect(toolNames.indexOf('delete-outlook-category')).toBeLessThan(
      toolNames.indexOf('list-mail-folders')
    );
  });

  it('lists Outlook categories from the master category list', async () => {
    const handler = getToolHandler('list-outlook-categories');

    await handler({});

    expect(mockGraphClient.graphRequest).toHaveBeenCalledWith(
      '/me/outlook/masterCategories',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('creates Outlook categories in the master category list', async () => {
    const handler = getToolHandler('create-outlook-category');

    await handler({
      body: {
        displayName: 'Finance',
        color: 'preset0',
      },
    });

    expect(mockGraphClient.graphRequest).toHaveBeenCalledWith(
      '/me/outlook/masterCategories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ displayName: 'Finance', color: 'preset0' }),
      })
    );
  });

  it('updates Outlook category colors in the master category list', async () => {
    const handler = getToolHandler('update-outlook-category');

    await handler({
      outlookCategoryId: 'category-123',
      body: {
        color: 'preset7',
      },
    });

    expect(mockGraphClient.graphRequest).toHaveBeenCalledWith(
      '/me/outlook/masterCategories/category-123',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ color: 'preset7' }),
      })
    );
  });

  it('deletes Outlook categories from the master category list', async () => {
    const handler = getToolHandler('delete-outlook-category');

    await handler({
      outlookCategoryId: 'category-123',
    });

    expect(mockGraphClient.graphRequest).toHaveBeenCalledWith(
      '/me/outlook/masterCategories/category-123',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
