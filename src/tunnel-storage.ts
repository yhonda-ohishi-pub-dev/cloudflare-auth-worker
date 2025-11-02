/**
 * Tunnel Storage Durable Object
 * Manages Cloudflare Tunnel URLs for each client
 */

export interface TunnelInfo {
  clientId: string;
  tunnelUrl: string;
  updatedAt: number;
  createdAt: number;
}

export class TunnelStorage {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // PUT /store - Tunnel URL登録/更新
      if (path === '/store' && request.method === 'POST') {
        const body = await request.json<{ clientId: string; tunnelUrl: string }>();
        const { clientId, tunnelUrl } = body;

        if (!clientId || !tunnelUrl) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing clientId or tunnelUrl' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const now = Date.now();
        const key = `tunnel:${clientId}`;
        const existing = await this.state.storage.get<TunnelInfo>(key);

        const tunnelInfo: TunnelInfo = {
          clientId,
          tunnelUrl,
          updatedAt: now,
          createdAt: existing?.createdAt || now,
        };

        await this.state.storage.put(key, tunnelInfo);

        return new Response(JSON.stringify({ success: true, data: tunnelInfo }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /get/{clientId} - Tunnel URL取得
      if (path.startsWith('/get/') && request.method === 'GET') {
        const clientId = path.substring(5);

        if (!clientId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing clientId' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const key = `tunnel:${clientId}`;
        const tunnelInfo = await this.state.storage.get<TunnelInfo>(key);

        if (!tunnelInfo) {
          return new Response(
            JSON.stringify({ success: false, error: 'Tunnel not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({ success: true, data: tunnelInfo }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /list - 全てのTunnel URL取得
      if (path === '/list' && request.method === 'GET') {
        const allEntries = await this.state.storage.list<TunnelInfo>({ prefix: 'tunnel:' });
        const tunnels: TunnelInfo[] = [];

        allEntries.forEach((value) => {
          tunnels.push(value);
        });

        return new Response(
          JSON.stringify({ success: true, data: tunnels, count: tunnels.length }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // DELETE /delete/{clientId} - Tunnel URL削除
      if (path.startsWith('/delete/') && request.method === 'DELETE') {
        const clientId = path.substring(8);

        if (!clientId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing clientId' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const key = `tunnel:${clientId}`;
        await this.state.storage.delete(key);

        return new Response(
          JSON.stringify({ success: true, message: `Tunnel for ${clientId} deleted` }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('TunnelStorage error:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Internal error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
}
