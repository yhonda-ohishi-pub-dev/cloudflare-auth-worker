// Durable Object: チャレンジ管理
export class ChallengeStorage {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /store - チャレンジを保存
      if (path === '/store' && request.method === 'POST') {
        const { clientId, challenge, expiresAt } = await request.json<{
          clientId: string;
          challenge: string;
          expiresAt: number;
        }>();

        await this.state.storage.put(clientId, {
          challenge,
          expiresAt,
        });

        return Response.json({ success: true });
      }

      // GET /get/:clientId - チャレンジを取得
      if (path.startsWith('/get/') && request.method === 'GET') {
        const clientId = path.substring(5); // "/get/" の後
        const data = await this.state.storage.get<{
          challenge: string;
          expiresAt: number;
        }>(clientId);

        if (!data) {
          return Response.json({ error: 'Challenge not found' }, { status: 404 });
        }

        return Response.json(data);
      }

      // DELETE /delete/:clientId - チャレンジを削除
      if (path.startsWith('/delete/') && request.method === 'DELETE') {
        const clientId = path.substring(8); // "/delete/" の後
        await this.state.storage.delete(clientId);

        return Response.json({ success: true });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
      console.error('ChallengeStorage error:', error);
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }
  }
}
