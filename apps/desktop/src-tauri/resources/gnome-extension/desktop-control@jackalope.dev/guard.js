export function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}

export function sameBounds(a, b) {
  return (
    a &&
    b &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(a[key]) && a[key] === b[key])
  );
}

export function validBounds(bounds) {
  return (
    bounds &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(bounds[key])) &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.width * bounds.height <= 20000000
  );
}

export class WindowGrant {
  constructor(window, token, owner, now) {
    this.window = { ...window };
    this.token = token;
    this.owner = owner;
    this.status = 'paused';
    this.reason = 'Click Resume to begin';
    this.epoch = 1;
    this.lastSeen = now;
    this.bounds = null;
  }

  pause(reason) {
    if (this.status === 'canceled') return;
    this.status = 'paused';
    this.reason = reason;
    this.epoch++;
  }

  cancel(reason) {
    this.status = 'canceled';
    this.reason = reason;
    this.epoch++;
  }

  heartbeat(sender, now) {
    requireValue(sender === this.owner, 'Only the indicator can renew this grant.');
    requireValue(
      now - this.lastSeen <= 3000 && now >= this.lastSeen,
      'Indicator heartbeat expired.',
    );
    this.lastSeen = now;
  }

  resume(bounds, now) {
    requireValue(this.status === 'paused', 'This window grant cannot resume.');
    requireValue(
      now - this.lastSeen <= 3000 && now >= this.lastSeen,
      'Indicator heartbeat expired.',
    );
    requireValue(validBounds(bounds), 'Window bounds are unavailable or too large.');
    this.bounds = { ...bounds };
    this.status = 'active';
    this.reason = '';
    this.epoch++;
  }

  check(request, current, focused, held, now) {
    requireValue(
      this.status === 'active',
      'Window control is paused or canceled. Wait for the human to Resume.',
    );
    requireValue(
      request.token === this.token && request.epoch === this.epoch,
      'The desktop grant changed. Take a new snapshot.',
    );
    requireValue(
      now - this.lastSeen <= 3000 && now >= this.lastSeen,
      'Indicator heartbeat expired.',
    );
    requireValue(
      ['handle', 'pid', 'started', 'class'].every(
        (key) => request.window?.[key] === this.window[key] && current?.[key] === this.window[key],
      ),
      'The selected window identity changed.',
    );
    requireValue(focused, 'The selected window lost focus. Wait for the human to Resume.');
    requireValue(
      sameBounds(current.bounds, this.bounds),
      'Window moved or resized. Wait for the human to Resume.',
    );
    if (request.bounds)
      requireValue(
        sameBounds(request.bounds, current.bounds),
        'Take a fresh snapshot after window bounds change.',
      );
    requireValue(!held, 'Release keyboard keys, touches and mouse buttons before input.');
  }

  state() {
    return { status: this.status, epoch: this.epoch, reason: this.reason };
  }
}
