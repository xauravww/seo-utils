import mongoose from "mongoose";
import LinkedInPost from "../models/LinkedInPost.js";
import LinkedInComment from "../models/LinkedInComment.js";

class DatabaseConnection {
  constructor() {
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Connect to MongoDB with retry logic
   */
  async connect() {
    // Get MongoDB URI from environment variables
    const mongoUri =
      process.env.MONOGODB_URI ||
      process.env.MONGODB_URI ||
      "mongodb://localhost:27017/linkedin";

    if (this.isConnected) {
      console.log("📊 Database already connected");
      return;
    }

    console.log(
      `🔌 Attempting to connect to MongoDB: ${mongoUri.replace(/\/\/.*@/, "//***:***@")}`,
    );

    try {
      // Configure mongoose options for better connection handling
      const options = {
        serverSelectionTimeoutMS: 10000, // 10 second timeout
        socketTimeoutMS: 45000, // 45 second socket timeout
        maxPoolSize: 10, // Maximum number of connections
      };

      await mongoose.connect(mongoUri, options);

      this.isConnected = true;
      this.connectionAttempts = 0;

      console.log("✅ Successfully connected to MongoDB");
      console.log(`📈 Database: ${mongoose.connection.db.databaseName}`);

      // Handle connection events
      this.setupEventHandlers();
    } catch (error) {
      this.connectionAttempts++;
      console.error(
        `❌ MongoDB connection attempt ${this.connectionAttempts} failed:`,
        error.message,
      );

      if (this.connectionAttempts < this.maxRetries) {
        console.log(`🔄 Retrying in ${this.retryDelay / 1000} seconds...`);
        await this.delay(this.retryDelay);
        return this.connect(); // Retry connection
      } else {
        console.error(
          `💀 Failed to connect to MongoDB after ${this.maxRetries} attempts`,
        );
        throw new Error(`Database connection failed: ${error.message}`);
      }
    }
  }

  /**
   * Setup event handlers for mongoose connection
   */
  setupEventHandlers() {
    // Connection successful
    mongoose.connection.on("connected", () => {
      console.log("🟢 Mongoose connected to MongoDB");
      this.isConnected = true;
    });

    // Connection error
    mongoose.connection.on("error", (error) => {
      console.error("🔴 Mongoose connection error:", error.message);
      this.isConnected = false;
    });

    // Connection disconnected
    mongoose.connection.on("disconnected", () => {
      console.log("🟡 Mongoose disconnected from MongoDB");
      this.isConnected = false;
    });

    // Application termination
    process.on("SIGINT", async () => {
      await this.disconnect();
      process.exit(0);
    });

    // Heroku app termination
    process.on("SIGTERM", async () => {
      await this.disconnect();
      process.exit(0);
    });
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (!this.isConnected) {
      console.log("📊 Database already disconnected");
      return;
    }

    try {
      await mongoose.connection.close();
      this.isConnected = false;
      console.log("✅ Successfully disconnected from MongoDB");
    } catch (error) {
      console.error("❌ Error disconnecting from MongoDB:", error.message);
      throw error;
    }
  }

  /**
   * Check if database is connected
   */
  isDbConnected() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  /**
   * Get connection status info
   */
  getConnectionInfo() {
    const states = {
      0: "Disconnected",
      1: "Connected",
      2: "Connecting",
      3: "Disconnecting",
    };

    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      status: states[mongoose.connection.readyState] || "Unknown",
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      database: mongoose.connection.name,
    };
  }

  /**
   * Test database connection with a simple operation
   */
  async testConnection() {
    try {
      if (!this.isDbConnected()) {
        throw new Error("Database not connected");
      }

      // Try to ping the database
      const admin = mongoose.connection.db.admin();
      const result = await admin.ping();

      console.log("🏓 Database ping successful:", result);
      return true;
    } catch (error) {
      console.error("❌ Database ping failed:", error.message);
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    try {
      if (!this.isDbConnected()) {
        throw new Error("Database not connected");
      }

      const stats = await mongoose.connection.db.stats();
      return {
        database: mongoose.connection.db.databaseName,
        collections: stats.collections,
        documents: stats.objects,
        avgObjSize: Math.round(stats.avgObjSize * 100) / 100,
        dataSize: this.formatBytes(stats.dataSize),
        storageSize: this.formatBytes(stats.storageSize),
        indexes: stats.indexes,
        indexSize: this.formatBytes(stats.indexSize),
      };
    } catch (error) {
      console.error("❌ Error getting database stats:", error.message);
      throw error;
    }
  }

  /**
   * Format bytes into human readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up old data based on criteria
   */
  async cleanupOldData(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await LinkedInPost.deleteMany({
        scraped_at: { $lt: cutoffDate },
      });

      console.log(
        `🧹 Cleaned up ${result.deletedCount} old records older than ${daysOld} days`,
      );
      return result.deletedCount;
    } catch (error) {
      console.error("❌ Error cleaning up old data:", error.message);
      throw error;
    }
  }
}

// Create a singleton instance
const dbConnection = new DatabaseConnection();

// Also attaching models to the connection instance for easy access
dbConnection.LinkedInPost = LinkedInPost;
dbConnection.LinkedInComment = LinkedInComment;

export default dbConnection;
