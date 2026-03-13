import { DurableObject } from 'cloudflare:workers';

interface RateState {
  date: string;
  count: number;
}

const DAILY_LIMIT = 5;

export class IpRateLimiter extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/consume') {
      return new Response('Not found', { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);
    let state = (await this.ctx.storage.get<RateState>('state')) ?? {
      date: today,
      count: 0,
    };

    // 日付が変わったらリセット
    if (state.date !== today) {
      state = { date: today, count: 0 };
    }

    if (state.count >= DAILY_LIMIT) {
      return Response.json(
        { allowed: false, remaining: 0, limit: DAILY_LIMIT },
        { status: 429 }
      );
    }

    state.count += 1;
    await this.ctx.storage.put('state', state);

    return Response.json({
      allowed: true,
      remaining: DAILY_LIMIT - state.count,
      limit: DAILY_LIMIT,
    });
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response('fourseason-rate-limiter worker');
  },
} satisfies ExportedHandler;
