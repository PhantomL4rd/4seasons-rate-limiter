import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getStub() {
	const id = env.IP_RATE_LIMITER.newUniqueId();
	return env.IP_RATE_LIMITER.get(id);
}

async function consume(stub: DurableObjectStub, limit: number) {
	return stub.fetch('http://fake-host/consume', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ limit }),
	});
}

describe('POST /consume', () => {
	it('GET /consume は 404 を返す', async () => {
		const stub = getStub();
		const res = await stub.fetch('http://fake-host/consume');
		expect(res.status).toBe(404);
	});

	it('POST /other は 404 を返す', async () => {
		const stub = getStub();
		const res = await stub.fetch('http://fake-host/other', { method: 'POST' });
		expect(res.status).toBe(404);
	});

	it('limit を指定して消費できる', async () => {
		const stub = getStub();
		const res = await consume(stub, 5);
		const body = await res.json<{ allowed: boolean; remaining: number; limit: number }>();

		expect(res.status).toBe(200);
		expect(body).toEqual({ allowed: true, remaining: 4, limit: 5 });
	});

	it('limit: 1 のとき1回目は許可、2回目は429', async () => {
		const stub = getStub();

		const first = await consume(stub, 1);
		expect(first.status).toBe(200);
		const firstBody = await first.json<{ allowed: boolean; remaining: number; limit: number }>();
		expect(firstBody).toEqual({ allowed: true, remaining: 0, limit: 1 });

		const second = await consume(stub, 1);
		expect(second.status).toBe(429);
		const secondBody = await second.json<{ allowed: boolean; remaining: number; limit: number }>();
		expect(secondBody).toEqual({ allowed: false, remaining: 0, limit: 1 });
	});

	it('429レスポンスの limit が指定値を反映する', async () => {
		const stub = getStub();
		// limit: 2 で2回消費して枯渇させる
		await consume(stub, 2);
		await consume(stub, 2);

		const res = await consume(stub, 2);
		expect(res.status).toBe(429);
		const body = await res.json<{ allowed: boolean; remaining: number; limit: number }>();
		expect(body.limit).toBe(2);
	});

	it('同一DOに対し異なる limit で呼ぶと count は共有される', async () => {
		const stub = getStub();

		// limit: 5 で1回消費 → count: 1
		const first = await consume(stub, 5);
		const firstBody = await first.json<{ allowed: boolean; remaining: number; limit: number }>();
		expect(firstBody).toEqual({ allowed: true, remaining: 4, limit: 5 });

		// limit: 2 で呼ぶ → count: 1 >= 2 ではないので許可、count: 2
		const second = await consume(stub, 2);
		const secondBody = await second.json<{ allowed: boolean; remaining: number; limit: number }>();
		expect(secondBody).toEqual({ allowed: true, remaining: 0, limit: 2 });

		// limit: 2 で呼ぶ → count: 2 >= 2 なので429
		const third = await consume(stub, 2);
		expect(third.status).toBe(429);
	});
});

describe('limit バリデーション', () => {
	async function consumeRaw(stub: DurableObjectStub, body: string) {
		return stub.fetch('http://fake-host/consume', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
		});
	}

	it.each([
		['0', JSON.stringify({ limit: 0 })],
		['-1', JSON.stringify({ limit: -1 })],
		['101', JSON.stringify({ limit: 101 })],
		['2.5', JSON.stringify({ limit: 2.5 })],
		['"abc"', JSON.stringify({ limit: 'abc' })],
		['null', JSON.stringify({ limit: null })],
	])('limit: %s は 400 を返す', async (_label, body) => {
		const stub = getStub();
		const res = await consumeRaw(stub, body);
		expect(res.status).toBe(400);
	});

	it('不正JSON は 400 を返す', async () => {
		const stub = getStub();
		const res = await consumeRaw(stub, 'not json');
		expect(res.status).toBe(400);
	});

	it('ボディなし は 400 を返す', async () => {
		const stub = getStub();
		const res = await stub.fetch('http://fake-host/consume', { method: 'POST' });
		expect(res.status).toBe(400);
	});

	it('limit が欠落している は 400 を返す', async () => {
		const stub = getStub();
		const res = await consumeRaw(stub, JSON.stringify({}));
		expect(res.status).toBe(400);
	});
});
