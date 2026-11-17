import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQuizSocketHeartbeat, startQuizSocketHeartbeat } from './socket-heartbeat.js';

class Socket extends EventTarget {
	readyState: WebSocket['readyState'] = 0;
	send = vi.fn<(data: string) => void>();
	close = vi.fn<(code?: number, reason?: string) => void>();
}
afterEach(() => vi.useRealTimers());

describe('quiz WebSocket heartbeat', () => {
	it('keeps a reading student alive for fifteen minutes behind a sixty-second idle timeout', () => {
		vi.useFakeTimers();
		const socket = new Socket();
		socket.readyState = 1;
		let idle: ReturnType<typeof setTimeout>;
		const armIdle = () => {
			clearTimeout(idle);
			idle = setTimeout(() => {
				socket.readyState = 3;
				socket.dispatchEvent(new Event('close'));
			}, 60_000);
		};
		socket.send.mockImplementation(() => {
			armIdle();
			socket.dispatchEvent(new MessageEvent('message', { data: 'pong' }));
		});
		armIdle();
		const stop = startQuizSocketHeartbeat(socket);
		vi.advanceTimersByTime(15 * 60_000);
		expect(socket.readyState).toBe(1);
		expect(socket.send).toHaveBeenCalledTimes(45);
		expect(socket.send.mock.calls.every(([data]) => data === 'ping')).toBe(true);
		stop();
		vi.advanceTimersByTime(60_000);
		expect(socket.readyState).toBe(3);
		expect(socket.send).toHaveBeenCalledTimes(45);
	});
	it.each(['close', 'error'])('does not send while connecting and releases its timer on %s', (event) => {
		vi.useFakeTimers();
		const socket = new Socket();
		const stop = startQuizSocketHeartbeat(socket);
		vi.advanceTimersByTime(20_000);
		expect(socket.send).not.toHaveBeenCalled();
		socket.readyState = 1;
		vi.advanceTimersByTime(20_000);
		expect(socket.send).toHaveBeenCalledTimes(1);
		socket.dispatchEvent(new Event(event));
		vi.advanceTimersByTime(60_000);
		expect(socket.send).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		stop();
	});
	it('interrupts a silent open socket exactly once without waiting for its close event', () => {
		vi.useFakeTimers();
		const socket = new Socket();
		socket.readyState = 1;
		const interrupted = vi.fn();
		startQuizSocketHeartbeat(socket, interrupted);
		vi.advanceTimersByTime(34_999);
		expect(interrupted).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(socket.close).toHaveBeenCalledWith(3001, 'Heartbeat interrupted');
		expect(interrupted).toHaveBeenCalledTimes(1);
		// Transport stays OPEN and never dispatches close, as with a blackholed connection.
		vi.advanceTimersByTime(120_000);
		expect(interrupted).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('clears a pending watchdog on cleanup and does not let non-pong messages acknowledge a ping', () => {
		vi.useFakeTimers();
		const socket = new Socket();
		socket.readyState = 1;
		const interrupted = vi.fn();
		const stop = startQuizSocketHeartbeat(socket, interrupted);
		vi.advanceTimersByTime(20_000);
		socket.dispatchEvent(new MessageEvent('message', { data: '{"type":"state"}' }));
		expect(vi.getTimerCount()).toBe(2);
		stop();
		vi.advanceTimersByTime(60_000);
		expect(interrupted).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('recovers when sending throws and does not duplicate recovery on a synchronous close', () => {
		vi.useFakeTimers();
		const socket = new Socket();
		socket.readyState = 1;
		socket.send.mockImplementation(() => {
			throw new Error('Transport unavailable');
		});
		socket.close.mockImplementation(() => socket.dispatchEvent(new Event('close')));
		const interrupted = vi.fn();
		startQuizSocketHeartbeat(socket, interrupted);
		vi.advanceTimersByTime(60_000);
		expect(interrupted).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('recognizes pong without treating it as a saved answer or accepting arbitrary messages', () => {
		expect(isQuizSocketHeartbeat('pong')).toBe(true);
		for (const value of ['ping', 'PONG', '{}', { type: 'pong' }, null])
			expect(isQuizSocketHeartbeat(value)).toBe(false);
	});
});
