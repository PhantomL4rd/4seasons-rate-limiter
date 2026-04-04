import { DurableObject } from 'cloudflare:workers';

interface RateState {
	date: string;
	count: number;
}

const DEFAULT_LIMIT = 3;

function parseLimit(raw: unknown): number | null {
	if (
		typeof raw === 'number' &&
		Number.isInteger(raw) &&
		raw >= 1 &&
		raw <= 100
	) {
		return raw;
	}
	return null;
}

export class IpRateLimiter extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method !== 'POST' || url.pathname !== '/consume') {
			return new Response('Not found', { status: 404 });
		}

		// リクエストボディから limit を取得（必須、1〜100の整数）
		let limit: number;
		try {
			const text = await request.text();
			if (!text) {
				return Response.json(
					{ error: 'limit is required (1-100)' },
					{ status: 400 },
				);
			}
			const body = JSON.parse(text);
			const parsed = body && typeof body === 'object' ? parseLimit(body.limit) : null;
			if (parsed === null) {
				return Response.json(
					{ error: 'limit is required (1-100)' },
					{ status: 400 },
				);
			}
			limit = parsed;
		} catch {
			return Response.json(
				{ error: 'limit is required (1-100)' },
				{ status: 400 },
			);
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

		if (state.count >= limit) {
			return Response.json(
				{ allowed: false, remaining: 0, limit },
				{ status: 429 },
			);
		}

		state.count += 1;
		await this.ctx.storage.put('state', state);

		return Response.json({
			allowed: true,
			remaining: limit - state.count,
			limit,
		});
	}
}

export default {
	async fetch(): Promise<Response> {
		return new Response('fourseason-rate-limiter worker');
	},
} satisfies ExportedHandler;
