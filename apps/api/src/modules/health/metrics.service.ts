import { Inject, Injectable, Optional } from "@nestjs/common";
import { KOLBE_DB_HANDLE, type KolbeDbHandle } from "../../database/database.module";

interface HttpMetricEntry {
  method: string;
  path: string;
  status: number;
  count: number;
}

/**
 * Phase 4.9 Checkpoint C — Prometheus / OpenMetrics Exporter.
 *
 * Tracks request throughput, latency histograms, database connection pool
 * utilization, and node runtime diagnostics. Exposes standard Prometheus text
 * format without heavy third-party agent dependencies.
 */
@Injectable()
export class MetricsService {
  private readonly requestCounts = new Map<string, number>();
  private readonly durationSum = new Map<string, number>();
  private readonly durationBuckets = new Map<string, Map<number, number>>();
  private readonly bucketThresholds = [25, 50, 100, 250, 500, 1000, 2500, 5000];
  private readonly startTime = Date.now();

  constructor(
    @Optional() @Inject(KOLBE_DB_HANDLE) private readonly handle?: KolbeDbHandle,
  ) {}

  /**
   * Normalizes URLs into clean metrics route patterns to prevent high-cardinality explosions.
   */
  private normalizePath(rawPath: string): string {
    const clean = rawPath.split("?")[0].replace(/\/+$/, "") || "/";
    return clean
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
      .replace(/\/(usr|ord|chld|pout|shpm|pay|res|prod|var|off)_[a-zA-Z0-9_-]+/g, "/:$1_id")
      .replace(/\/\d+/g, "/:id");
  }

  recordHttpRequest(method: string, rawPath: string, status: number, durationMs: number): void {
    const path = this.normalizePath(rawPath);
    const key = `${method.toUpperCase()}|${path}|${status}`;

    this.requestCounts.set(key, (this.requestCounts.get(key) ?? 0) + 1);
    this.durationSum.set(key, (this.durationSum.get(key) ?? 0) + durationMs);

    if (!this.durationBuckets.has(key)) {
      this.durationBuckets.set(key, new Map());
    }
    const buckets = this.durationBuckets.get(key)!;
    for (const threshold of this.bucketThresholds) {
      if (durationMs <= threshold) {
        buckets.set(threshold, (buckets.get(threshold) ?? 0) + 1);
      }
    }
  }

  /**
   * Generates Prometheus / OpenMetrics text format.
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];

    // 1. Process and Memory Metrics
    const mem = process.memoryUsage();
    lines.push("# HELP process_uptime_seconds The uptime of the Node.js process in seconds.");
    lines.push("# TYPE process_uptime_seconds gauge");
    lines.push(`process_uptime_seconds ${((Date.now() - this.startTime) / 1000).toFixed(2)}`);

    lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes.");
    lines.push("# TYPE process_resident_memory_bytes gauge");
    lines.push(`process_resident_memory_bytes ${mem.rss}`);

    lines.push("# HELP nodejs_heap_size_total_bytes Process heap size total.");
    lines.push("# TYPE nodejs_heap_size_total_bytes gauge");
    lines.push(`nodejs_heap_size_total_bytes ${mem.heapTotal}`);

    lines.push("# HELP nodejs_heap_size_used_bytes Process heap size used.");
    lines.push("# TYPE nodejs_heap_size_used_bytes gauge");
    lines.push(`nodejs_heap_size_used_bytes ${mem.heapUsed}`);

    // 2. Database Connection Pool Metrics
    if (this.handle?.pool) {
      lines.push("# HELP kolbe_db_pool_total Total database pool connections.");
      lines.push("# TYPE kolbe_db_pool_total gauge");
      lines.push(`kolbe_db_pool_total ${this.handle.pool.totalCount}`);

      lines.push("# HELP kolbe_db_pool_idle Idle database pool connections.");
      lines.push("# TYPE kolbe_db_pool_idle gauge");
      lines.push(`kolbe_db_pool_idle ${this.handle.pool.idleCount}`);

      lines.push("# HELP kolbe_db_pool_waiting Clients waiting for a database connection.");
      lines.push("# TYPE kolbe_db_pool_waiting gauge");
      lines.push(`kolbe_db_pool_waiting ${this.handle.pool.waitingCount}`);
    }

    // 3. HTTP Request Counter
    lines.push("# HELP http_requests_total Total number of HTTP requests processed.");
    lines.push("# TYPE http_requests_total counter");
    for (const [key, count] of this.requestCounts.entries()) {
      const [method, path, status] = key.split("|");
      lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
    }

    // 4. HTTP Request Duration Sum
    lines.push("# HELP http_request_duration_ms_sum Total latency of HTTP requests in milliseconds.");
    lines.push("# TYPE http_request_duration_ms_sum counter");
    for (const [key, sum] of this.durationSum.entries()) {
      const [method, path, status] = key.split("|");
      lines.push(
        `http_request_duration_ms_sum{method="${method}",path="${path}",status="${status}"} ${sum.toFixed(2)}`,
      );
    }

    // 5. HTTP Request Duration Buckets
    lines.push("# HELP http_request_duration_ms Duration buckets for HTTP requests in milliseconds.");
    lines.push("# TYPE http_request_duration_ms histogram");
    for (const [key, buckets] of this.durationBuckets.entries()) {
      const [method, path, status] = key.split("|");
      for (const le of this.bucketThresholds) {
        const count = buckets.get(le) ?? 0;
        lines.push(
          `http_request_duration_ms_bucket{method="${method}",path="${path}",status="${status}",le="${le}"} ${count}`,
        );
      }
      const total = this.requestCounts.get(key) ?? 0;
      lines.push(
        `http_request_duration_ms_bucket{method="${method}",path="${path}",status="${status}",le="+Inf"} ${total}`,
      );
      lines.push(
        `http_request_duration_ms_count{method="${method}",path="${path}",status="${status}"} ${total}`,
      );
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Generates structured JSON diagnostic summary.
   */
  getDiagnosticsSummary(): Record<string, unknown> {
    const mem = process.memoryUsage();
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      pool: this.handle?.pool
        ? {
            total: this.handle.pool.totalCount,
            idle: this.handle.pool.idleCount,
            waiting: this.handle.pool.waitingCount,
          }
        : null,
      requestsCount: Array.from(this.requestCounts.values()).reduce((a, b) => a + b, 0),
    };
  }
}
