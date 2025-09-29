const EventEmitter = require('events');

/**
 * WebSocket Monitoring and Metrics Collection
 * Provides comprehensive monitoring for production WebSocket deployments
 */
class WebSocketMonitor extends EventEmitter {
  constructor(wsManager) {
    super();
    this.wsManager = wsManager;
    this.metrics = {
      // Connection metrics
      totalConnections: 0,
      activeConnections: 0,
      peakConnections: 0,
      rejectedConnections: 0,
      
      // Message metrics
      messagesReceived: 0,
      messagesSent: 0,
      messagesPerSecond: 0,
      
      // Error metrics
      connectionErrors: 0,
      messageErrors: 0,
      tokenErrors: 0,
      
      // Performance metrics
      averageConnectionTime: 0,
      averageMessageLatency: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      
      // Rate limiting
      rateLimitHits: 0,
      circuitBreakerTrips: 0,
      
      // Health status
      status: 'healthy',
      uptime: 0,
      lastHealthCheck: new Date(),
      
      // Per-user metrics
      userConnections: new Map(),
      userMessageCounts: new Map(),
      
      // Time-series data (last 60 minutes)
      timeSeries: {
        connections: [],
        messages: [],
        errors: [],
        latency: []
      }
    };

    this.alerts = {
      highConnectionCount: { threshold: 800, enabled: true },
      highErrorRate: { threshold: 0.05, enabled: true }, // 5%
      highLatency: { threshold: 5000, enabled: true }, // 5 seconds
      memoryUsage: { threshold: 0.8, enabled: true }, // 80%
      cpuUsage: { threshold: 0.8, enabled: true } // 80%
    };

    this.startMonitoring();
  }

  startMonitoring() {
    // Collect metrics every 10 seconds
    setInterval(() => {
      this.collectMetrics();
    }, 10000);

    // Health check every 30 seconds
    setInterval(() => {
      this.performHealthCheck();
    }, 30000);

    // Cleanup old time-series data every 5 minutes
    setInterval(() => {
      this.cleanupTimeSeries();
    }, 300000);

    // Set up WebSocket manager event listeners
    this.setupEventListeners();

    console.log('📊 WebSocket monitoring started');
  }

  setupEventListeners() {
    if (!this.wsManager) return;

    this.wsManager.on('connection', (ws) => {
      this.metrics.totalConnections++;
      this.metrics.activeConnections++;
      this.metrics.peakConnections = Math.max(
        this.metrics.peakConnections, 
        this.metrics.activeConnections
      );

      // Track per-user connections
      if (ws.userId) {
        const userConnections = this.metrics.userConnections.get(ws.userId) || 0;
        this.metrics.userConnections.set(ws.userId, userConnections + 1);
      }

      this.recordTimeSeriesData('connections', this.metrics.activeConnections);
    });

    this.wsManager.on('disconnect', (ws) => {
      this.metrics.activeConnections--;

      // Update per-user connections
      if (ws.userId) {
        const userConnections = this.metrics.userConnections.get(ws.userId) || 1;
        if (userConnections <= 1) {
          this.metrics.userConnections.delete(ws.userId);
        } else {
          this.metrics.userConnections.set(ws.userId, userConnections - 1);
        }
      }

      this.recordTimeSeriesData('connections', this.metrics.activeConnections);
    });

    this.wsManager.on('message', (ws, message) => {
      this.metrics.messagesReceived++;
      
      // Track per-user message counts
      if (ws.userId) {
        const userMessages = this.metrics.userMessageCounts.get(ws.userId) || 0;
        this.metrics.userMessageCounts.set(ws.userId, userMessages + 1);
      }

      this.recordTimeSeriesData('messages', this.metrics.messagesReceived);
    });

    this.wsManager.on('error', (error) => {
      this.metrics.connectionErrors++;
      this.recordTimeSeriesData('errors', this.metrics.connectionErrors);
      
      // Classify error types
      if (error.message.includes('token') || error.message.includes('auth')) {
        this.metrics.tokenErrors++;
      } else {
        this.metrics.messageErrors++;
      }
    });
  }

  collectMetrics() {
    // Update system metrics
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
    
    // Calculate messages per second
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const recentMessages = this.metrics.timeSeries.messages.filter(
      point => point.timestamp > oneSecondAgo
    );
    this.metrics.messagesPerSecond = recentMessages.length;

    // Update uptime
    this.metrics.uptime = process.uptime();

    // Get WebSocket manager metrics if available
    if (this.wsManager && typeof this.wsManager.getMetrics === 'function') {
      const wsMetrics = this.wsManager.getMetrics();
      Object.assign(this.metrics, wsMetrics);
    }
  }

  performHealthCheck() {
    const now = new Date();
    let status = 'healthy';
    const issues = [];

    // Check connection count
    if (this.alerts.highConnectionCount.enabled && 
        this.metrics.activeConnections > this.alerts.highConnectionCount.threshold) {
      status = 'warning';
      issues.push(`High connection count: ${this.metrics.activeConnections}`);
    }

    // Check error rate
    const totalOperations = this.metrics.messagesReceived + this.metrics.messagesSent;
    const errorRate = totalOperations > 0 ? 
      (this.metrics.connectionErrors + this.metrics.messageErrors) / totalOperations : 0;
    
    if (this.alerts.highErrorRate.enabled && errorRate > this.alerts.highErrorRate.threshold) {
      status = 'critical';
      issues.push(`High error rate: ${(errorRate * 100).toFixed(2)}%`);
    }

    // Check memory usage
    if (this.alerts.memoryUsage.enabled && 
        this.metrics.memoryUsage > this.alerts.memoryUsage.threshold) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push(`High memory usage: ${(this.metrics.memoryUsage * 100).toFixed(1)}%`);
    }

    this.metrics.status = status;
    this.metrics.lastHealthCheck = now;

    if (issues.length > 0) {
      this.emit('healthAlert', { status, issues, timestamp: now });
      console.warn(`🚨 WebSocket health alert (${status}):`, issues.join(', '));
    }

    this.emit('healthCheck', { status, issues, timestamp: now });
  }

  recordTimeSeriesData(metric, value) {
    const timestamp = Date.now();
    const dataPoint = { timestamp, value };

    if (!this.metrics.timeSeries[metric]) {
      this.metrics.timeSeries[metric] = [];
    }

    this.metrics.timeSeries[metric].push(dataPoint);

    // Keep only last hour of data
    const oneHourAgo = timestamp - (60 * 60 * 1000);
    this.metrics.timeSeries[metric] = this.metrics.timeSeries[metric].filter(
      point => point.timestamp > oneHourAgo
    );
  }

  cleanupTimeSeries() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    Object.keys(this.metrics.timeSeries).forEach(metric => {
      this.metrics.timeSeries[metric] = this.metrics.timeSeries[metric].filter(
        point => point.timestamp > oneHourAgo
      );
    });

    console.log('🧹 Cleaned up old time-series data');
  }

  // Public API
  getMetrics() {
    return {
      ...this.metrics,
      timestamp: new Date().toISOString(),
      userConnections: Object.fromEntries(this.metrics.userConnections),
      userMessageCounts: Object.fromEntries(this.metrics.userMessageCounts)
    };
  }

  getHealthStatus() {
    return {
      status: this.metrics.status,
      uptime: this.metrics.uptime,
      lastHealthCheck: this.metrics.lastHealthCheck,
      activeConnections: this.metrics.activeConnections,
      messagesPerSecond: this.metrics.messagesPerSecond,
      memoryUsage: this.metrics.memoryUsage,
      errorRate: this.calculateErrorRate()
    };
  }

  calculateErrorRate() {
    const totalOperations = this.metrics.messagesReceived + this.metrics.messagesSent;
    const totalErrors = this.metrics.connectionErrors + this.metrics.messageErrors;
    return totalOperations > 0 ? totalErrors / totalOperations : 0;
  }

  getTimeSeriesData(metric, duration = 3600000) { // Default 1 hour
    const cutoff = Date.now() - duration;
    return this.metrics.timeSeries[metric]?.filter(
      point => point.timestamp > cutoff
    ) || [];
  }

  getUserMetrics() {
    return {
      totalUsers: this.metrics.userConnections.size,
      activeUsers: Array.from(this.metrics.userConnections.keys()),
      topMessageUsers: Array.from(this.metrics.userMessageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, count]) => ({ userId, messageCount: count }))
    };
  }

  // Alert configuration
  updateAlertThreshold(alertType, threshold, enabled = true) {
    if (this.alerts[alertType]) {
      this.alerts[alertType].threshold = threshold;
      this.alerts[alertType].enabled = enabled;
      console.log(`📊 Updated alert threshold for ${alertType}: ${threshold} (enabled: ${enabled})`);
    }
  }

  // Export metrics for external monitoring systems
  exportPrometheusMetrics() {
    const metrics = this.getMetrics();
    return [
      `# HELP websocket_connections_total Total WebSocket connections`,
      `# TYPE websocket_connections_total counter`,
      `websocket_connections_total ${metrics.totalConnections}`,
      ``,
      `# HELP websocket_connections_active Active WebSocket connections`,
      `# TYPE websocket_connections_active gauge`,
      `websocket_connections_active ${metrics.activeConnections}`,
      ``,
      `# HELP websocket_messages_received_total Total messages received`,
      `# TYPE websocket_messages_received_total counter`,
      `websocket_messages_received_total ${metrics.messagesReceived}`,
      ``,
      `# HELP websocket_messages_sent_total Total messages sent`,
      `# TYPE websocket_messages_sent_total counter`,
      `websocket_messages_sent_total ${metrics.messagesSent}`,
      ``,
      `# HELP websocket_errors_total Total WebSocket errors`,
      `# TYPE websocket_errors_total counter`,
      `websocket_errors_total ${metrics.connectionErrors + metrics.messageErrors}`,
      ``,
      `# HELP websocket_memory_usage Memory usage ratio`,
      `# TYPE websocket_memory_usage gauge`,
      `websocket_memory_usage ${metrics.memoryUsage}`,
      ``,
      `# HELP websocket_uptime_seconds Server uptime in seconds`,
      `# TYPE websocket_uptime_seconds counter`,
      `websocket_uptime_seconds ${metrics.uptime}`
    ].join('\n');
  }

  // Reset metrics (useful for testing)
  resetMetrics() {
    Object.assign(this.metrics, {
      totalConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      connectionErrors: 0,
      messageErrors: 0,
      tokenErrors: 0,
      rateLimitHits: 0,
      circuitBreakerTrips: 0
    });
    
    this.metrics.userConnections.clear();
    this.metrics.userMessageCounts.clear();
    
    Object.keys(this.metrics.timeSeries).forEach(metric => {
      this.metrics.timeSeries[metric] = [];
    });
    
    console.log('📊 WebSocket metrics reset');
  }
}

module.exports = { WebSocketMonitor };
