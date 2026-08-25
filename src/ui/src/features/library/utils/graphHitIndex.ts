export interface PositionedGraphNode {
  x?: number;
  y?: number;
}

export class GraphHitIndex<T extends PositionedGraphNode> {
  private readonly buckets = new Map<string, T[]>();

  constructor(private readonly cellSize: number) {}

  clear(): void {
    this.buckets.clear();
  }

  add(node: T): void {
    if (typeof node.x !== "number" || typeof node.y !== "number") return;
    const key = this.keyFor(node.x, node.y);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(node);
    else this.buckets.set(key, [node]);
  }

  closest(x: number, y: number, radius: number): T | null {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    let closest: T | null = null;
    let closestDistanceSquared = radiusSquared;

    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        for (const node of this.buckets.get(`${cellX},${cellY}`) ?? []) {
          const dx = x - (node.x ?? 0);
          const dy = y - (node.y ?? 0);
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < closestDistanceSquared) {
            closest = node;
            closestDistanceSquared = distanceSquared;
          }
        }
      }
    }

    return closest;
  }

  private keyFor(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }
}
