/** Binary min-heap keyed by number, carrying an integer payload. */
export class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);

    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { key: number; value: number } | undefined {
    if (this.keys.length === 0) return undefined;

    const key = this.keys[0];
    const value = this.values[0];
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;

    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      this.siftDown(0);
    }
    return { key, value };
  }

  private siftDown(start: number): void {
    const size = this.keys.length;
    let i = start;

    for (;;) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = left + 1;

      if (left < size && this.keys[left] < this.keys[smallest]) smallest = left;
      if (right < size && this.keys[right] < this.keys[smallest]) smallest = right;
      if (smallest === i) return;

      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.values[a], this.values[b]] = [this.values[b], this.values[a]];
  }
}
