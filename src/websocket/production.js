const cluster = require('cluster');
const os = require('os');
const { WebSocketServer } = require('./server');
const { WebSocketMonitor } = require('./monitoring');

/**
 * Production WebSocket Deployment Configuration
 * Handles clustering, load balancing, and production optimizations
 */
class ProductionWebSocketDeployment {
  constructor(options = {}) {
    this.options = {
      // Clustering
      enableClustering: options.enableClustering ?? true,
      workerCount: options.workerCount || Math.min(os.cpus().length, 4),
      
      // Load balancing
      enableStickySession: options.enableStickySession ?? true,
      sessionAffinityKey: options.sessionAffinityKey || 'userId',
      
      // Performance
      maxConnectionsPerWorker: options.maxConnectionsPerWorker || 1000,
      enableCompression: options.enableCompression ?? true,
      compressionThreshold: options.compressionThreshold || 1024,
      
      // Security
      enableRateLimit: options.enableRateLimit ?? true,
      rateLimitWindow: options.rateLimitWindow || 60000,
      rateLimitMax: options.rateLimitMax || 100,
      enableOriginValidation: options.enableOriginValidation ?? true,
      allowedOrigins: options.allowedOrigins || [],
      
      // Monitoring
      enableMetrics: options.enableMetrics ?? true,
      metricsPort: options.metricsPort || 9090,
      enableHealthChecks: options.enableHealthChecks ?? true,
      healthCheckInterval: options.healthCheckInterval || 30000,
      
      // Logging
      logLevel: options.logLevel || 'info',
      enableStructuredLogging: options.enableStructuredLogging ?? true,
      
      // Graceful shutdown
      shutdownTimeout: options.shutdownTimeout || 30000,
      
      ...options
    };

    this.workers = new Map();
    this.monitor = null;
    this.isShuttingDown = false;
  }

  async start() {
    if (this.options.enableClustering && cluster.isPrimary) {
      await this.startCluster();
    } else {
      await this.startWorker();
    }
  }

  async startCluster() {
    console.log(`🚀 Starting WebSocket cluster with ${this.options.workerCount} workers`);

    // Set up cluster event handlers
    cluster.on('exit', (worker, code, signal) => {
      if (!this.isShuttingDown) {
        console.log(`⚠️ Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
        this.spawnWorker();
      }
    });

    cluster.on('online', (worker) => {
      console.log(`✅ Worker ${worker.process.pid} is online`);
    });

    // Spawn workers
    for (let i = 0; i < this.options.workerCount; i++) {
      this.spawnWorker();
    }

    // Set up graceful shutdown
    this.setupGracefulShutdown();

    // Start monitoring if enabled
    if (this.options.enableMetrics) {
      await this.startMonitoring();
    }
  }

  spawnWorker() {
    const worker = cluster.fork({
      WORKER_ID: this.workers.size,
      ...process.env
    });

    this.workers.set(worker.id, {
      worker,
      connections: 0,
      startTime: Date.now(),
      lastHealthCheck: Date.now()
    });

    // Handle worker messages
    worker.on('message', (message) => {
      this.handleWorkerMessage(worker, message);
    });

    return worker;
  }

  handleWorkerMessage(worker, message) {
    const workerInfo = this.workers.get(worker.id);
    if (!workerInfo) return;

    switch (message.type) {
      case 'connection_count':
        workerInfo.connections = message.count;
        break;
      
      case 'health_check':
        workerInfo.lastHealthCheck = Date.now();
        workerInfo.status = message.status;
        break;
      
      case 'metrics':
        if (this.monitor) {
          this.monitor.recordWorkerMetrics(worker.id, message.data);
        }
        break;
      
      case 'error':
        console.error(`❌ Worker ${worker.process.pid} error:`, message.error);
        break;
    }
  }

  async startWorker() {
    const workerId = process.env.WORKER_ID || '0';
    console.log(`🔧 Starting WebSocket worker ${workerId} (PID: ${process.pid})`);

    try {
      // Create WebSocket server with production configuration
      const wsServer = new WebSocketServer({
        port: process.env.WS_PORT || 8081,
        host: process.env.WS_HOST || '0.0.0.0',
        maxConnections: this.options.maxConnectionsPerWorker,
        heartbeatInterval: 30000,
        connectionTimeout: 10000,
        enableCompression: this.options.enableCompression,
        compressionThreshold: this.options.compressionThreshold,
        enableRateLimit: this.options.enableRateLimit,
        rateLimitWindow: this.options.rateLimitWindow,
        rateLimitMax: this.options.rateLimitMax
      });

      // Start the server
      const wsManager = await wsServer.start();

      // Set up worker-specific monitoring
      this.setupWorkerMonitoring(wsManager);

      // Set up graceful shutdown for worker
      this.setupWorkerShutdown(wsServer);

      console.log(`✅ WebSocket worker ${workerId} started successfully`);

    } catch (error) {
      console.error(`❌ Failed to start WebSocket worker ${workerId}:`, error);
      process.exit(1);
    }
  }

  setupWorkerMonitoring(wsManager) {
    // Report connection count to master
    setInterval(() => {
      if (process.send) {
        process.send({
          type: 'connection_count',
          count: wsManager.clients.size
        });
      }
    }, 5000);

    // Report health status
    setInterval(() => {
      if (process.send) {
        const metrics = wsManager.getMetrics();
        process.send({
          type: 'health_check',
          status: this.calculateWorkerHealth(metrics)
        });
      }
    }, this.options.healthCheckInterval);

    // Report detailed metrics
    if (this.options.enableMetrics) {
      setInterval(() => {
        if (process.send) {
          const metrics = wsManager.getMetrics();
          process.send({
            type: 'metrics',
            data: metrics
          });
        }
      }, 10000);
    }
  }

  calculateWorkerHealth(metrics) {
    const memoryUsage = process.memoryUsage();
    const memoryRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;
    
    if (memoryRatio > 0.9 || metrics.errors > 100) {
      return 'critical';
    } else if (memoryRatio > 0.7 || metrics.errors > 50) {
      return 'warning';
    }
    
    return 'healthy';
  }

  async startMonitoring() {
    const express = require('express');
    const app = express();

    // Metrics endpoint
    app.get('/metrics', (req, res) => {
      const clusterMetrics = this.getClusterMetrics();
      res.json(clusterMetrics);
    });

    // Prometheus metrics endpoint
    app.get('/metrics/prometheus', (req, res) => {
      const prometheusMetrics = this.generatePrometheusMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(prometheusMetrics);
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      const health = this.getClusterHealth();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    });

    // Worker status endpoint
    app.get('/workers', (req, res) => {
      const workers = Array.from(this.workers.values()).map(info => ({
        pid: info.worker.process.pid,
        connections: info.connections,
        uptime: Date.now() - info.startTime,
        status: info.status || 'unknown',
        lastHealthCheck: info.lastHealthCheck
      }));
      res.json({ workers, count: workers.length });
    });

    app.listen(this.options.metricsPort, () => {
      console.log(`📊 Monitoring server listening on port ${this.options.metricsPort}`);
    });
  }

  getClusterMetrics() {
    const workers = Array.from(this.workers.values());
    const totalConnections = workers.reduce((sum, w) => sum + w.connections, 0);
    const healthyWorkers = workers.filter(w => w.status === 'healthy').length;

    return {
      cluster: {
        workerCount: workers.length,
        healthyWorkers,
        totalConnections,
        averageConnectionsPerWorker: workers.length > 0 ? totalConnections / workers.length : 0
      },
      workers: workers.map(info => ({
        pid: info.worker.process.pid,
        connections: info.connections,
        uptime: Date.now() - info.startTime,
        status: info.status || 'unknown'
      })),
      timestamp: new Date().toISOString()
    };
  }

  getClusterHealth() {
    const workers = Array.from(this.workers.values());
    const healthyWorkers = workers.filter(w => w.status === 'healthy').length;
    const totalWorkers = workers.length;
    const healthRatio = totalWorkers > 0 ? healthyWorkers / totalWorkers : 0;

    let status = 'healthy';
    if (healthRatio < 0.5) {
      status = 'critical';
    } else if (healthRatio < 0.8) {
      status = 'warning';
    }

    return {
      status,
      healthyWorkers,
      totalWorkers,
      healthRatio,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  generatePrometheusMetrics() {
    const metrics = this.getClusterMetrics();
    return [
      `# HELP websocket_cluster_workers Total number of WebSocket workers`,
      `# TYPE websocket_cluster_workers gauge`,
      `websocket_cluster_workers ${metrics.cluster.workerCount}`,
      ``,
      `# HELP websocket_cluster_healthy_workers Number of healthy WebSocket workers`,
      `# TYPE websocket_cluster_healthy_workers gauge`,
      `websocket_cluster_healthy_workers ${metrics.cluster.healthyWorkers}`,
      ``,
      `# HELP websocket_cluster_connections Total connections across all workers`,
      `# TYPE websocket_cluster_connections gauge`,
      `websocket_cluster_connections ${metrics.cluster.totalConnections}`,
      ``
    ].join('\n');
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`🔄 Received ${signal}, initiating graceful shutdown...`);
      this.isShuttingDown = true;

      // Stop accepting new connections
      for (const [id, info] of this.workers) {
        info.worker.send({ type: 'shutdown' });
      }

      // Wait for workers to finish
      const shutdownPromises = Array.from(this.workers.values()).map(info => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`⚠️ Force killing worker ${info.worker.process.pid}`);
            info.worker.kill('SIGKILL');
            resolve();
          }, this.options.shutdownTimeout);

          info.worker.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      });

      await Promise.all(shutdownPromises);
      console.log('✅ All workers shut down gracefully');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  setupWorkerShutdown(wsServer) {
    const shutdown = async () => {
      console.log(`🔄 Worker ${process.pid} shutting down...`);
      await wsServer.shutdown();
      process.exit(0);
    };

    process.on('message', (message) => {
      if (message.type === 'shutdown') {
        shutdown();
      }
    });

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

// Load balancing utilities for sticky sessions
class LoadBalancer {
  static hashUserId(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  static selectWorker(userId, workerCount) {
    const hash = this.hashUserId(userId);
    return hash % workerCount;
  }
}

module.exports = { 
  ProductionWebSocketDeployment, 
  LoadBalancer 
};

// If this file is run directly, start production deployment
if (require.main === module) {
  const deployment = new ProductionWebSocketDeployment({
    enableClustering: process.env.NODE_ENV === 'production',
    workerCount: parseInt(process.env.WS_WORKERS) || undefined,
    enableMetrics: true,
    enableHealthChecks: true
  });

  deployment.start().catch((error) => {
    console.error('❌ Failed to start production WebSocket deployment:', error);
    process.exit(1);
  });
}
